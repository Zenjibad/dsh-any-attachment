import { sanitizeName, decodeBase64 } from './validate.mjs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import * as nodeFs from 'node:fs/promises'

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024

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

  const MAX_LIST_DEPTH = 4
  const DEFAULT_MAX_LIST_ENTRIES = 500

  async function list(payload) {
    const { sessionId } = payload ?? {}
    const cwd = deps.resolveCwd?.(String(sessionId ?? ''))
    if (cwd === undefined) return fail('SESSION_NOT_FOUND', `session "${String(sessionId)}" is not attached`)
    const maxEntries = deps.maxListEntries ?? DEFAULT_MAX_LIST_ENTRIES
    const files = []
    try {
      await walk(fs, cwd, '', 0, files, maxEntries)
    } catch (e) {
      return fail('LIST_FAILED', `failed to list workspace files: ${String(e?.message ?? e)}`)
    }
    return { ok: true, value: { files } }
  }

  async function walk(fs, dir, prefix, depth, files, maxEntries) {
    if (files.length >= maxEntries) return
    const entries = await fs.readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (files.length >= maxEntries) return
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const rel = prefix === '' ? entry.name : prefix + '/' + entry.name
      if (entry.isDirectory()) {
        if (depth < MAX_LIST_DEPTH) await walk(fs, join(dir, entry.name), rel, depth + 1, files, maxEntries)
        continue
      }
      files.push(rel)
    }
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
    try {
      await fs.mkdir(storeRoot, { recursive: true })
    } catch (e) {
      return fail('WRITE_FAILED', `failed to create store: ${String(e?.message ?? e)}`)
    }
    const id = await uniqueTarget(fs, storeRoot, safeName)
    try {
      await fs.writeFile(resolve(storeRoot, id), bytes)
    } catch (e) {
      return fail('WRITE_FAILED', `failed to write attachment: ${String(e?.message ?? e)}`)
    }
    return { ok: true, value: { name: safeName, path: resolve(storeRoot, id) } }
  }

  return async function handler(endpoint, payload, signal) {
    signal?.throwIfAborted?.()
    if (endpoint === 'upload') return upload(payload)
    if (endpoint === 'list') return list(payload)
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
