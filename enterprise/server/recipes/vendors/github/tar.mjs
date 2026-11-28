// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// GitHub's repository tarball (GET /repos/{o}/{r}/tarball/{ref}) read without a dependency: gunzip,
// then ustar records (with pax and GNU long names). Only the paths `want(path)` accepts are kept,
// each at most maxFileBytes (larger ones are listed in skipped); the top folder GitHub adds
// (<owner>-<repo>-<sha>/) is taken off every path. Bodies are text, never logged.

/** Gunzip (when gzipped) through the platform's own zlib: node:zlib on the server. */
async function gunzip(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes
  const { gunzipSync } = await import('node:zlib')
  return gunzipSync(bytes, { maxOutputLength: 400 * 1024 * 1024 })
}

const text = (buf, start, length) => {
  const slice = buf.subarray(start, start + length)
  const end = slice.indexOf(0)
  return new TextDecoder().decode(end >= 0 ? slice.subarray(0, end) : slice)
}
const octal = (buf, start, length) => parseInt(text(buf, start, length).trim() || '0', 8) || 0

function paxPath(body) {
  const records = new TextDecoder().decode(body)
  let at = 0
  let found = null
  while (at < records.length) {
    const space = records.indexOf(' ', at)
    if (space < 0) break
    const len = Number(records.slice(at, space))
    if (!len) break
    const record = records.slice(space + 1, at + len - 1)
    if (record.startsWith('path=')) found = record.slice(5)
    at += len
  }
  return found
}

/**
 * The tarball's matching files. → { files: Map<path, text>, skipped: [{ path, size }], entries }
 * options: want(path) → boolean; maxFileBytes (1 MB); maxFiles (20,000 kept).
 */
export async function readTarball(input, { want = () => true, maxFileBytes = 1024 * 1024, maxFiles = 20000 } = {}) {
  const buf = await gunzip(input instanceof Uint8Array ? input : new Uint8Array(input))
  const files = new Map()
  const skipped = []
  let entries = 0
  let at = 0
  let longName = null
  let paxName = null
  while (at + 512 <= buf.length) {
    const header = buf.subarray(at, at + 512)
    if (header.every((b) => b === 0)) break
    const size = octal(buf, at + 124, 12)
    const type = String.fromCharCode(header[156] || 48)
    const prefix = text(buf, at + 345, 155)
    let name = longName || paxName || (prefix ? `${prefix}/${text(buf, at, 100)}` : text(buf, at, 100))
    const bodyStart = at + 512
    const body = buf.subarray(bodyStart, bodyStart + size)
    at = bodyStart + Math.ceil(size / 512) * 512
    if (type === 'L') {
      longName = text(body, 0, body.length)
      continue
    }
    if (type === 'x') {
      paxName = paxPath(body)
      continue
    }
    if (type === 'g') continue
    longName = null
    paxName = null
    if (type !== '0' && type !== '\0' && type !== '7') continue
    entries += 1
    // GitHub's top folder: <owner>-<repo>-<sha>/
    name = name.replace(/^[^/]+\//, '')
    if (!name || !want(name)) continue
    if (size > maxFileBytes) {
      skipped.push({ path: name, size })
      continue
    }
    if (files.size >= maxFiles) {
      skipped.push({ path: name, size })
      continue
    }
    files.set(name, new TextDecoder().decode(body))
  }
  return { files, skipped, entries }
}

/** A tarball of files (for tests and fixtures): ustar records, no compression. */
export function writeTarball(files, { top = 'acme-repo-0000000/' } = {}) {
  const chunks = []
  const enc = new TextEncoder()
  const put = (buf, start, value, length) => buf.set(enc.encode(value).subarray(0, length), start)
  for (const [path, content] of files) {
    const body = enc.encode(content)
    const header = new Uint8Array(512)
    const name = `${top}${path}`
    // ustar: a long name is split at a slash into prefix (155) and name (100).
    let prefix = ''
    let short = name
    if (name.length > 100) {
      // the first slash that leaves at most 100 characters after it, with at most 155 before
      let at = -1
      for (let i = name.indexOf('/'); i >= 0 && at < 0; i = name.indexOf('/', i + 1)) if (name.length - i - 1 <= 100 && i <= 155) at = i
      if (at < 0) throw new Error(`A path too long for a tarball: ${name.slice(0, 40)}…`)
      prefix = name.slice(0, at)
      short = name.slice(at + 1)
    }
    put(header, 0, short, 100)
    put(header, 100, '0000644\0', 8)
    put(header, 108, '0000000\0', 8)
    put(header, 116, '0000000\0', 8)
    put(header, 124, `${body.length.toString(8).padStart(11, '0')}\0`, 12)
    put(header, 136, '00000000000\0', 12)
    put(header, 148, '        ', 8)
    header[156] = 48
    put(header, 257, 'ustar\0', 6)
    put(header, 263, '00', 2)
    if (prefix) put(header, 345, prefix, 155)
    let sum = 0
    for (const b of header) sum += b
    put(header, 148, `${sum.toString(8).padStart(6, '0')}\0 `, 8)
    chunks.push(header, body, new Uint8Array((512 - (body.length % 512)) % 512))
  }
  chunks.push(new Uint8Array(1024))
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}
