// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Plain text and links for what recipes put on a slate. Recipes import nothing from the server
// (design B.7), so these small rules live here: one line of plain text, capped; https links only.
import { createHash } from 'node:crypto'

// Control characters and the bidirectional overrides that can make a note read differently than it is.
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g

/** Plain text on one line (or keeping line breaks with lines: true), at most max characters. */
export function plain(raw, max = 200, { lines = false } = {}) {
  if (raw === null || raw === undefined) return ''
  let text = String(raw).replace(UNSAFE, '')
  text = lines ? text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : text.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, '') + '…'
}

/** An https link a note may carry, or null. */
export function https(raw) {
  if (typeof raw !== 'string' || raw.length > 2000) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

/** A short stable hash of a value (hex), for change detection and keys. */
export function hashOf(value, length = 16) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, length)
}

/** A lowercase key of words (letters and digits), for matching names across sources. */
export function normalKey(raw) {
  return String(raw ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

/** "1 note", "3 notes". */
export const count = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** A date as "Nov 30" (UTC, US English). */
export const shortDate = (date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** The ISO day (YYYY-MM-DD) of a date in UTC. */
export const isoDay = (date) => new Date(date).toISOString().slice(0, 10)

/**
 * 64-bit simhash of a text's word 3-grams, as a hex string; similarity(a, b) is the share of equal
 * bits (1 = same). Used to skip redrafting when a document barely changed.
 */
export function simhash(text) {
  const words = normalKey(text).split(' ').filter(Boolean)
  const weights = new Array(64).fill(0)
  const grams = words.length < 3 ? [words.join(' ')] : words.slice(0, -2).map((_, i) => words.slice(i, i + 3).join(' '))
  for (const gram of grams) {
    const digest = createHash('sha1').update(gram).digest()
    for (let bit = 0; bit < 64; bit++) weights[bit] += (digest[bit >> 3] >> (bit & 7)) & 1 ? 1 : -1
  }
  let hex = ''
  for (let nibble = 0; nibble < 16; nibble++) {
    let value = 0
    for (let b = 0; b < 4; b++) if (weights[nibble * 4 + b] > 0) value |= 1 << b
    hex += value.toString(16)
  }
  return hex
}

export function similarity(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return 0
  let same = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    let diff = 0
    while (x) {
      diff += x & 1
      x >>= 1
    }
    same += 4 - diff
  }
  return same / (a.length * 4)
}
