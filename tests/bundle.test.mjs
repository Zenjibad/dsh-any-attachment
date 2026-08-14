import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Structural guards on the shipped client bundle. These pin the failure
 * classes found in E2E: a debug-log strip that deleted code, a factory that
 * forgot `return module.exports`, a missing `dsh.client` declaration, and
 * missing files in the publish list.
 */

const bundle = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('bundle carries no debug markers', () => {
  assert.equal(bundle.includes('[dbg]'), false, 'debug logging must not ship')
  assert.equal((bundle.match(/console\.error/g) || []).length, 1, 'only the intentional upload-failure report may log')
})

test('bundle inserts uploads as reference chips, not plain text', () => {
  assert.ok(bundle.includes('insertReference(mention, { start: state.draft.length, end: state.draft.length, draftRev: state.draftRev })'),
    'uploads must insert reference chips at the draft end')
  assert.ok(!bundle.includes('mentionOf'), 'the plain-text mention composer must be gone')
})

test('bundle registers the @file source with chip picks and an exact-path codec', () => {
  assert.ok(bundle.includes("trigger: '@'"), 'must bind the @ trigger')
  assert.ok(bundle.includes("name: 'file'"), 'must register the file source')
  assert.ok(bundle.includes('registerSource'), 'must register via ctx.inputTriggers')
  assert.ok(bundle.includes('source: \'file\',\n                ref: pick.candidate.name,'), 'pick must return a reference insert')
  assert.ok(bundle.includes("'@' + ref + ' (' + path + ')'"), 'the codec must serialize the exact path into the sent text')
})

test('draft-side mentions stay pathless; paths resolve only at submit', () => {
  assert.ok(bundle.includes("label: '@' + a.name"), 'chip labels are pathless')
  assert.ok(!bundle.includes("'@' + attachment.name + ' (' + attachment.path + ')'"), 'no pathful composition in the draft path')
})

test('drop interception resets the built-in overlay via synthetic dragend', () => {
  assert.ok(bundle.includes("window.dispatchEvent(new Event('dragend'));"),
    'intercepted drops must dispatch the window dragend reset so the built-in overlay hides')
})

test('no rail/send machinery remains', () => {
  assert.equal(bundle.includes('Send with files'), false)
  assert.equal(bundle.includes('conversation.input.dock'), false)
  assert.equal(bundle.includes('blocks.set'), false)
})

test('factory returns module.exports and exports the plugin contract', () => {
  assert.ok(bundle.includes('return module.exports;'), 'factory must return module.exports')
  assert.match(bundle, /module\.exports = \{ name: 'dsh-any-attachment', inject: \[[^\]]+\], apply: apply \};/)
})

test('manifest declares the client export and dsh.client', () => {
  assert.equal(manifest.exports['./client'], './client/client.js')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('conversation'))
})

test('manifest ships every host file it imports', () => {
  const files = new Set(manifest.files)
  assert.ok(files.has('lib/index.mjs'), 'index must ship')
  assert.ok(files.has('lib/handler.mjs'), 'handler must ship (index imports it)')
  assert.ok(files.has('lib/validate.mjs'), 'validate must ship (handler imports it)')
  assert.ok(files.has('client/client.js'), 'client bundle must ship')
})
