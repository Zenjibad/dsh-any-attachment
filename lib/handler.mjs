import { sanitizeName, decodeBase64, sniffAndExtract } from './validate.mjs'
import { resolve } from 'node:path'
import * as nodeFs from 'node:fs/promises'

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024
const EXTRACT_CAP = 50 * 1024

const fail = (reason, message) => ({ ok: false, error: { code: 'attachment-error', message, details: { reason } } })
const notFound = (message) => ({ ok: false, error: { code: 'not-found', message, details: {} } })

export function createChannelHandler(deps) {
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES
  const fs = deps.fs ?? nodeFs

  async function upload(payload) {
    const { sessionId, name, data } = payload ?? {}
    const cwd = deps.resolveCwd(String(sessionId ?? ''))
    if (cwd === undefined) return fail('SESSION_NOT_FOUND', `session "${String(sessionId)}" is not attached`)
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
    const target = await uniqueTarget(fs, cwd, safeName)
    try {
      await fs.writeFile(target, bytes)
    } catch (e) {
      return fail('WRITE_FAILED', `failed to write attachment: ${String(e?.message ?? e)}`)
    }
    const sniffed = sniffAndExtract(bytes, EXTRACT_CAP)
    return {
      ok: true,
      value: sniffed.kind === 'text'
        ? { path: target, kind: 'text', extractedText: sniffed.text }
        : { path: target, kind: 'binary' },
    }
  }

  async function read(payload) {
    const { sessionId, path } = payload ?? {}
    const cwd = deps.resolveCwd(String(sessionId ?? ''))
    if (cwd === undefined) return fail('SESSION_NOT_FOUND', `session "${String(sessionId)}" is not attached`)
    const realCwd = await fs.realpath(cwd)
    let realTarget
    try {
      realTarget = await fs.realpath(String(path))
    } catch {
      return fail('READ_FAILED', 'attachment file not found')
    }
    if (realTarget !== realCwd && !realTarget.startsWith(realCwd + (process.platform === 'win32' ? '\\' : '/'))) {
      return fail('NOT_INSIDE_CWD', 'attachment path escapes the session cwd')
    }
    let contents
    try {
      contents = await fs.readFile(realTarget)
    } catch {
      return fail('READ_FAILED', 'attachment file unreadable')
    }
    return {
      ok: true,
      value: {
        name: basename(realTarget),
        size: contents.byteLength,
        data: Buffer.from(contents).toString('base64'),
      },
    }
  }

  return async function handler(endpoint, payload, signal) {
    signal?.throwIfAborted?.()
    if (endpoint === 'upload') return upload(payload)
    if (endpoint === 'read') return read(payload)
    return notFound(`unknown /attachments-any endpoint "${String(endpoint)}"`)
  }
}

function basename(p) {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

async function uniqueTarget(fs, cwd, name) {
  const first = resolve(cwd, name)
  if (!(await exists(fs, first))) return first
  const dot = name.lastIndexOf('.')
  const stem = dot <= 0 ? name : name.slice(0, dot)
  const ext = dot <= 0 ? '' : name.slice(dot)
  for (let i = 2; i < 1000; i++) {
    const candidate = resolve(cwd, `${stem}-${i}${ext}`)
    if (!(await exists(fs, candidate))) return candidate
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
