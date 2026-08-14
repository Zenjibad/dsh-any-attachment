const NAME_PATTERN = /^[^/\\\u0000-\u001f]+$/
const INVALID_NAME = () => Object.assign(new Error('attachment name is not a bare basename'), { code: 'INVALID_NAME' })
const INVALID_BASE64 = () => Object.assign(new Error('attachment data is not canonical base64'), { code: 'INVALID_BASE64' })

export function sanitizeName(name) {
  const trimmed = String(name).trim()
  if (trimmed === '' || trimmed === '.' || trimmed === '..' || !NAME_PATTERN.test(trimmed)
    || /^[a-zA-Z]:/.test(trimmed)) {
    throw INVALID_NAME()
  }
  return trimmed
}

export function decodeBase64(data) {
  const decoded = Buffer.from(data, 'base64')
  if (decoded.length === 0 && data !== '') throw INVALID_BASE64()
  if (decoded.toString('base64') !== data) throw INVALID_BASE64()
  return new Uint8Array(decoded)
}

export function sniffAndExtract(bytes, cap) {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let text
  try {
    text = decoder.decode(bytes)
  } catch {
    return { kind: 'binary' }
  }
  const chars = Array.from(text)
  return { kind: 'text', text: chars.length > cap ? chars.slice(0, cap).join('') : text }
}
