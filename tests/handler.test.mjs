import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createChannelHandler } from '../lib/handler.mjs'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-any-attach-'))
  const ws = join(root, 'workspace')
  mkdirSync(ws, { recursive: true })
  const sessions = new Map([['sess-1', { header: { cwd: ws } }]])
  const handler = createChannelHandler({
    resolveCwd: (id) => sessions.get(id)?.header.cwd,
    maxBytes: 1024,
  })
  return { root, ws, handler }
}

const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value }
const err = (r) => { assert.equal(r.ok, false, JSON.stringify(r)); return r.error }

test('upload writes a text file into the session cwd and returns extracted text', async () => {
  const { ws, handler } = setup()
  const value = ok(await handler('upload', {
    sessionId: 'sess-1', name: 'note.md', data: Buffer.from('hello 世界').toString('base64'),
  }, new AbortController().signal))
  assert.equal(value.kind, 'text')
  assert.equal(value.extractedText, 'hello 世界')
  assert.equal(value.path, resolve(ws, 'note.md'))
  assert.equal(readFileSync(value.path, 'utf8'), 'hello 世界')
})

test('upload of binary bytes returns kind binary and no extraction', async () => {
  const { ws, handler } = setup()
  const value = ok(await handler('upload', {
    sessionId: 'sess-1', name: 'blob.bin', data: Buffer.from([0xff, 0xfe, 0x00]).toString('base64'),
  }, new AbortController().signal))
  assert.equal(value.kind, 'binary')
  assert.equal(value.extractedText, undefined)
  assert.ok(existsSync(join(ws, 'blob.bin')))
})

test('upload dedupes name collisions with a numeric suffix', async () => {
  const { ws, handler } = setup()
  writeFileSync(join(ws, 'a.txt'), 'existing')
  const first = ok(await handler('upload', {
    sessionId: 'sess-1', name: 'a.txt', data: Buffer.from('one').toString('base64'),
  }, new AbortController().signal))
  const second = ok(await handler('upload', {
    sessionId: 'sess-1', name: 'a.txt', data: Buffer.from('two').toString('base64'),
  }, new AbortController().signal))
  assert.equal(first.path, join(ws, 'a-2.txt'))
  assert.equal(second.path, join(ws, 'a-3.txt'))
  assert.equal(readFileSync(join(ws, 'a.txt'), 'utf8'), 'existing')
  assert.equal(readFileSync(join(ws, 'a-2.txt'), 'utf8'), 'one')
  assert.equal(readFileSync(join(ws, 'a-3.txt'), 'utf8'), 'two')
})

test('upload rejects traversal names, non-canonical base64, oversize, unknown session', async () => {
  const { handler } = setup()
  const sig = new AbortController().signal
  assert.equal(err(await handler('upload', { sessionId: 'sess-1', name: '../evil', data: 'AQ==' }, sig)).details.reason, 'INVALID_NAME')
  assert.equal(err(await handler('upload', { sessionId: 'sess-1', name: 'x.txt', data: 'ab' }, sig)).details.reason, 'INVALID_BASE64') // 'ab' re-encodes as 'aQ=='
  assert.equal(err(await handler('upload', { sessionId: 'sess-1', name: 'x.txt', data: Buffer.alloc(2049).toString('base64') }, sig)).details.reason, 'TOO_LARGE')
  assert.equal(err(await handler('upload', { sessionId: 'missing', name: 'x.txt', data: Buffer.from('a').toString('base64') }, sig)).details.reason, 'SESSION_NOT_FOUND')
})

test('read returns bytes inside the cwd and rejects paths outside', async () => {
  const { root, ws, handler } = setup()
  writeFileSync(join(ws, 'file.txt'), 'payload')
  const sig = new AbortController().signal
  const value = ok(await handler('read', { sessionId: 'sess-1', path: join(ws, 'file.txt') }, sig))
  assert.equal(value.name, 'file.txt')
  assert.equal(value.size, 7)
  assert.equal(Buffer.from(value.data, 'base64').toString('utf8'), 'payload')
  writeFileSync(join(root, 'outside.txt'), 'secret')
  assert.equal(err(await handler('read', { sessionId: 'sess-1', path: join(root, 'outside.txt') }, sig)).details.reason, 'NOT_INSIDE_CWD')
  assert.equal(err(await handler('read', { sessionId: 'sess-1', path: join(ws, 'missing.txt') }, sig)).details.reason, 'READ_FAILED')
})

test('unknown endpoint returns not-found', async () => {
  const { handler } = setup()
  assert.equal(err(await handler('delete', {}, new AbortController().signal)).code, 'not-found')
})
