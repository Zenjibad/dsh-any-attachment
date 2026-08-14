import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeName, decodeBase64, sniffAndExtract } from '../lib/validate.mjs'

test('sanitizeName accepts a plain basename', () => {
  assert.equal(sanitizeName('report.pdf'), 'report.pdf')
  assert.equal(sanitizeName('my file v2.txt'), 'my file v2.txt')
})

test('sanitizeName rejects traversal, separators, drives, control chars', () => {
  for (const bad of ['../evil', 'a/b', 'a\\b', 'C:\\evil', 'C:/evil', '..', '.', '', 'a\u0000b', 'a\nb']) {
    assert.throws(() => sanitizeName(bad), (e) => e.code === 'INVALID_NAME', `expected rejection for ${JSON.stringify(bad)}`)
  }
})

test('decodeBase64 accepts canonical base64 and rejects non-canonical', () => {
  assert.deepEqual(decodeBase64('AQID'), Uint8Array.of(1, 2, 3))
  // Non-canonical: AQID== has trailing padding for 3 bytes.
  assert.throws(() => decodeBase64('AQID=='), (e) => e.code === 'INVALID_BASE64')
  assert.throws(() => decodeBase64('not-base64!'), (e) => e.code === 'INVALID_BASE64')
})

test('sniffAndExtract returns text for valid UTF-8 and binary otherwise', () => {
  assert.deepEqual(sniffAndExtract(new TextEncoder().encode('hello 世界'), 100),
    { kind: 'text', text: 'hello 世界' })
  // Invalid UTF-8 sequence 0xFF 0xFE.
  assert.deepEqual(sniffAndExtract(Uint8Array.of(0xff, 0xfe, 0x00), 100), { kind: 'binary' })
  // NUL bytes are still valid UTF-8 — treat as text but cap the output.
  assert.deepEqual(sniffAndExtract(new TextEncoder().encode('abcdef'), 3),
    { kind: 'text', text: 'abc' })
})
