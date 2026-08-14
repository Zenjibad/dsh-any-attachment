import { sanitizeName, decodeBase64, sniffAndExtract } from './validate.mjs'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import * as nodeFs from 'node:fs/promises'

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024
const EXTRACT_CAP = 50 * 1024

const fail = (reason, message) => ({ ok: false, error: { code: 'attachment-error', message, details: { reason } } })
const notFound = (message) => ({ ok: false, error: { code: 'not-found', message, details: {} } })

/** The private store root: $DSH_HOME/attachments-any (never a workspace). */
export function defaultStoreRoot() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'attachments-any')
}

export function createChannelHandler(deps) {
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES
  const fs = deps.fs ?? nodeFs
  const storeRoot = resolve(deps.storeRoot ?? defaultStoreRoot())

  async function ensureStore() {
    await fs.mkdir(storeRoot, { recursive: true })
  }

  async function upload(payload) {
    const { name, data } = payload ?? {}
    let bytes
    try {
      bytes = decodeBase64(data)
    } catch (e) {
      return fail('INVALID_BASE64', e.message)
    }
    if (bytes.byteLength > maxBytes) return fail('TOO_LARGE', `attachment exceeds ${maxBytes} bytes`)
    let safeName
    try {
      safeName = sanitizeName(name)
    } catch (e) {
      return fail('INVALID_NAME', e.message)
    }
    await ensureStore()
    const id = await uniqueTarget(fs, storeRoot, safeName)
    try {
      await fs.writeFile(resolve(storeRoot, id), bytes)
    } catch (e) {
      return fail('WRITE_FAILED', `failed to write attachment: ${String(e?.message ?? e)}`)
    }
    const sniffed = sniffAndExtract(bytes, EXTRACT_CAP)
    return {
      ok: true,
      value: sniffed.kind === 'text'
        ? { id, name: safeName, size: bytes.byteLength, kind: 'text', extractedText: sniffed.text }
        : { id, name: safeName, size: bytes.byteLength, kind: 'binary' },
    }
  }

  async function read(payload) {
    const { id } = payload ?? {}
    let safeId
    try {
      safeId = sanitizeName(id)
    } catch {
      return fail('NOT_INSIDE_STORE', 'attachment id is not a store entry')
    }
    const target = resolve(storeRoot, safeId)
    if (!target.startsWith(storeRoot + (process.platform === 'win32' ? '\\' : '/'))) {
      return fail('NOT_INSIDE_STORE', 'attachment id escapes the store')
    }
    let contents
    try {
      contents = await fs.readFile(target)
    } catch {
      return fail('READ_FAILED', 'attachment file not found')
    }
    return {
      ok: true,
      value: { name: safeId, size: contents.byteLength, data: Buffer.from(contents).toString('base64') },
    }
  }

  return async function handler(endpoint, payload, signal) {
    signal?.throwIfAborted?.()
    if (endpoint === 'upload') return upload(payload)
    if (endpoint === 'read') return read(payload)
    return notFound(`unknown /attachments-any endpoint "${String(endpoint)}"`)
  }
}

async function uniqueTarget(fs, dir, name) {
  const first = resolve(dir, name)
  if (!(await exists(fs, first))) return name
  const dot = name.lastIndexOf('.')
  const stem = dot <= 0 ? name : name.slice(0, dot)
  const ext = dot <= 0 ? '' : name.slice(dot)
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem}-${i}${ext}`
    if (!(await exists(fs, resolve(dir, candidate)))) return candidate
  }
  throw new Error('too many name collisions')
}

async function exists(fs, p) {
  try {
    await fs.realpath(p)
    return true
  } catch {
    return false
  }
}
