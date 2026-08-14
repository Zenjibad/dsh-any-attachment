import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChannelHandler } from '../lib/handler.mjs'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-any-store-'))
  const store = join(root, 'store')
  mkdirSync(store, { recursive: true })
  const handler = createChannelHandler({ storeRoot: store, maxBytes: 1024 })
  return { root, store, handler }
}

const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value }
const err = (r) => { assert.equal(r.ok, false, JSON.stringify(r)); return r.error }

test('upload stores a text file in the private store and returns extracted text', async () => {
  const { store, handler } = setup()
  const value = ok(await handler('upload', {
    name: 'note.md', data: Buffer.from('hello 世界').toString('base64'),
  }, new AbortController().signal))
  assert.equal(value.kind, 'text')
  assert.equal(value.name, 'note.md')
  assert.equal(value.extractedText, 'hello 世界')
  assert.equal(value.id, 'note.md')
  assert.equal(readFileSync(join(store, 'note.md'), 'utf8'), 'hello 世界')
})

test('upload of binary bytes returns kind binary and no extraction', async () => {
  const { store, handler } = setup()
  const value = ok(await handler('upload', {
    name: 'blob.bin', data: Buffer.from([0xff, 0xfe, 0x00]).toString('base64'),
  }, new AbortController().signal))
  assert.equal(value.kind, 'binary')
  assert.equal(value.extractedText, undefined)
  assert.ok(existsSync(join(store, 'blob.bin')))
})

test('upload dedupes name collisions with a numeric suffix', async () => {
  const { store, handler } = setup()
  writeFileSync(join(store, 'a.txt'), 'existing')
  const first = ok(await handler('upload', {
    name: 'a.txt', data: Buffer.from('one').toString('base64'),
  }, new AbortController().signal))
  const second = ok(await handler('upload', {
    name: 'a.txt', data: Buffer.from('two').toString('base64'),
  }, new AbortController().signal))
  assert.equal(first.id, 'a-2.txt')
  assert.equal(second.id, 'a-3.txt')
  assert.equal(readFileSync(join(store, 'a.txt'), 'utf8'), 'existing')
  assert.equal(readFileSync(join(store, 'a-2.txt'), 'utf8'), 'one')
  assert.equal(readFileSync(join(store, 'a-3.txt'), 'utf8'), 'two')
})

test('upload rejects traversal names, non-canonical base64, oversize', async () => {
  const { handler } = setup()
  const sig = new AbortController().signal
  assert.equal(err(await handler('upload', { name: '../evil', data: 'AQ==' }, sig)).details.reason, 'INVALID_NAME')
  assert.equal(err(await handler('upload', { name: 'x.txt', data: 'ab' }, sig)).details.reason, 'INVALID_BASE64')
  assert.equal(err(await handler('upload', { name: 'x.txt', data: Buffer.alloc(2049).toString('base64') }, sig)).details.reason, 'TOO_LARGE')
})

test('read returns bytes for a store id and rejects ids outside the store', async () => {
  const { store, handler } = setup()
  writeFileSync(join(store, 'file.txt'), 'payload')
  const sig = new AbortController().signal
  const value = ok(await handler('read', { id: 'file.txt' }, sig))
  assert.equal(value.name, 'file.txt')
  assert.equal(value.size, 7)
  assert.equal(Buffer.from(value.data, 'base64').toString('utf8'), 'payload')
  assert.equal(err(await handler('read', { id: '../outside.txt' }, sig)).details.reason, 'NOT_INSIDE_STORE')
  assert.equal(err(await handler('read', { id: 'missing.txt' }, sig)).details.reason, 'READ_FAILED')
})

test('unknown endpoint returns not-found', async () => {
  const { handler } = setup()
  assert.equal(err(await handler('delete', {}, new AbortController().signal)).code, 'not-found')
})
