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

test('upload stores the file in the private store and returns its path', async () => {
  const { store, handler } = setup()
  const value = ok(await handler('upload', {
    name: 'test.xml', data: Buffer.from('<a>hi</a>').toString('base64'),
  }, new AbortController().signal))
  assert.equal(value.name, 'test.xml')
  assert.equal(value.path, join(store, 'test.xml'))
  assert.equal(readFileSync(join(store, 'test.xml'), 'utf8'), '<a>hi</a>')
  assert.ok(existsSync(value.path))
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
  assert.equal(first.path, join(store, 'a-2.txt'))
  assert.equal(second.path, join(store, 'a-3.txt'))
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

test('stores binary bytes verbatim', async () => {
  const { store, handler } = setup()
  const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x80])
  const value = ok(await handler('upload', {
    name: 'blob.bin', data: bytes.toString('base64'),
  }, new AbortController().signal))
  assert.deepEqual(readFileSync(join(store, 'blob.bin')), bytes)
  assert.equal(value.name, 'blob.bin')
})

test('removed read endpoint returns not-found', async () => {
  const { handler } = setup()
  assert.equal(err(await handler('read', { id: 'x' }, new AbortController().signal)).code, 'not-found')
})

test('unknown endpoint returns not-found', async () => {
  const { handler } = setup()
  assert.equal(err(await handler('delete', {}, new AbortController().signal)).code, 'not-found')
})

test('list returns recursive relative paths, sorted, skipping hidden and node_modules', async () => {
  const { root, handler } = setup()
  const ws = join(root, 'ws')
  mkdirSync(join(ws, 'src', 'lib'), { recursive: true })
  writeFileSync(join(ws, 'readme.md'), 'r')
  writeFileSync(join(ws, 'src', 'main.ts'), 'm')
  writeFileSync(join(ws, 'src', 'lib', 'util.js'), 'u')
  writeFileSync(join(ws, '.hidden.txt'), 'h')
  mkdirSync(join(ws, 'node_modules'), { recursive: true })
  writeFileSync(join(ws, 'node_modules', 'dep.js'), 'd')
  const sessions = new Map([['s-1', { header: { cwd: ws } }]])
  const lister = createChannelHandler({ storeRoot: join(root, 'store'), resolveCwd: (id) => sessions.get(id)?.header.cwd })
  const value = ok(await lister('list', { sessionId: 's-1' }, new AbortController().signal))
  assert.deepEqual(value.files, ['readme.md', 'src/lib/util.js', 'src/main.ts'])
})

test('list respects the depth cap and entry cap', async () => {
  const { root, handler } = setup()
  const ws = join(root, 'ws')
  for (let d = 0; d < 5; d++) mkdirSync(join(ws, 'd' + d), { recursive: true })
  mkdirSync(join(ws, 'd0', 'd1', 'd2', 'd3', 'd4'), { recursive: true })
  writeFileSync(join(ws, 'd0', 'f0.txt'), 'x')
  writeFileSync(join(ws, 'd0', 'd1', 'f1.txt'), 'x')
  writeFileSync(join(ws, 'd0', 'd1', 'd2', 'f2.txt'), 'x')
  writeFileSync(join(ws, 'd0', 'd1', 'd2', 'd3', 'f3.txt'), 'x')
  writeFileSync(join(ws, 'd0', 'd1', 'd2', 'd3', 'd4', 'f4.txt'), 'x')
  const sessions = new Map([['s-1', { header: { cwd: ws } }]])
  const lister = createChannelHandler({ storeRoot: join(root, 'store'), resolveCwd: (id) => sessions.get(id)?.header.cwd, maxListEntries: 2 })
  const value = ok(await lister('list', { sessionId: 's-1' }, new AbortController().signal))
  assert.equal(value.files.length, 2, 'entry cap must truncate')
})

test('list reports SESSION_NOT_FOUND and LIST_FAILED', async () => {
  const { handler } = setup()
  assert.equal(err(await handler('list', { sessionId: 'missing' }, new AbortController().signal)).details.reason, 'SESSION_NOT_FOUND')
  const broken = createChannelHandler({ resolveCwd: () => 'Z:\\definitely\\missing\\dir' })
  assert.equal(err(await broken('list', { sessionId: 's-1' }, new AbortController().signal)).details.reason, 'LIST_FAILED')
})
