import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Structural guards on the shipped client bundle. These pin the failure
 * classes found in E2E: a debug-log strip that removed the setPending
 * continuation, a factory that forgot `return module.exports`, and a missing
 * `dsh.client` declaration. The bundle is factory-form CJS served verbatim,
 * so the assertions read the served text.
 */

const bundle = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('bundle carries no debug markers', () => {
  assert.equal(bundle.includes('[dbg]'), false, 'debug logging must not ship')
  assert.equal((bundle.match(/console\.error/g) || []).length, 1, 'only the intentional upload-failure report may log')
})

test('intake keeps the setPending continuation after uploads', () => {
  const intake = bundle.slice(bundle.indexOf('Promise.all(accepted.map'))
  const thenPos = intake.indexOf('.then(function (uploaded) { setPending(sessionId, pending.concat(uploaded)); })')
  const catchPos = intake.indexOf('.catch(')
  assert.ok(thenPos !== -1 && catchPos !== -1, 'setPending .then must precede the .catch')
  assert.ok(thenPos < catchPos, '.then must come before .catch')
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
