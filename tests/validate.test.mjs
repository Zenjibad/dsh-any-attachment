import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeName, decodeBase64 } from '../lib/validate.mjs'

test('sanitizeName accepts a plain basename', () => {
  assert.equal(sanitizeName('test.xml'), 'test.xml')
  assert.equal(sanitizeName('my file v2.txt'), 'my file v2.txt')
})

test('sanitizeName rejects traversal, separators, drives, control chars', () => {
  for (const bad of ['../evil', 'a/b', 'a\\b', 'C:\\evil', 'C:/evil', '..', '.', '', 'a\u0000b', 'a\nb']) {
    assert.throws(() => sanitizeName(bad), (e) => e.code === 'INVALID_NAME', `expected rejection for ${JSON.stringify(bad)}`)
  }
})

test('decodeBase64 accepts canonical base64 and rejects non-canonical', () => {
  assert.deepEqual(decodeBase64('AQID'), Uint8Array.of(1, 2, 3))
  assert.throws(() => decodeBase64('AQID=='), (e) => e.code === 'INVALID_BASE64')
  assert.throws(() => decodeBase64('not-base64!'), (e) => e.code === 'INVALID_BASE64')
})
