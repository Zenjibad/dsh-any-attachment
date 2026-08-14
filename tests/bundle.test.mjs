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

test('bundle inserts the mention into the draft on upload', () => {
  assert.ok(bundle.includes("inputActions.setDraft(draft + separator + stored.map(mentionOf).join(' '));"),
    'uploads must compose one mention text and set it as the draft')
  assert.ok(bundle.includes("return '@' + attachment.name;"),
    'the mention must be pathless (name only)')
})

test('bundle registers the @file trigger source with a pathless mention', () => {
  assert.ok(bundle.includes("trigger: '@'"), 'must bind the @ trigger')
  assert.ok(bundle.includes("name: 'file'"), 'must register the file source')
  assert.ok(bundle.includes('registerSource'), 'must register via ctx.inputTriggers')
  assert.ok(bundle.includes("return { text: '@' + pick.candidate.name }"), 'pick must replace the span with the pathless mention')
  assert.ok(!bundle.includes("'@' + attachment.name + ' (' + attachment.path + ')'"), 'drop mentions must not carry the path')
})

test('mentions never carry absolute paths', () => {
  assert.ok(bundle.includes("return { text: '@' + pick.candidate.name };"))
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
