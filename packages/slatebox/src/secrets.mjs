// Secrets: the key encryption key the installer generates, references to keys
// the admin supplies (env:NAME, file:/path, prompt), env files compose reads
// literally, and the redaction filter every line of output passes through.
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { InstallError } from './errors.mjs'

/** SLATEBOX_KEY_ENCRYPTION_KEY: 32 random bytes in standard base64, as `openssl rand -base64 32` prints. */
export function generateKek() {
  return randomBytes(32).toString('base64')
}

export const REF = /^(env:[A-Za-z_][A-Za-z0-9_]*|file:.+|prompt|none|stored)$/

// Prefixes that API keys and tokens start with (and AWS access key IDs).
const KEY_PREFIX = /^(gsk_|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|glpat|hf_|r8_|xox[abprs]|sk_|rk_|pk_live|pk_test|nvapi|AKIA[0-9A-Z]{12}|ASIA[0-9A-Z]{12})/

/**
 * Does something given as the NAME of an environment variable look like a key
 * pasted by mistake? Variable names are words; keys are long runs of mixed case
 * and digits. Callers never repeat the value in their message.
 */
export function looksLikeKey(name) {
  const text = String(name)
  if (KEY_PREFIX.test(text)) return true
  if (text.length >= 20 && /[a-z]/.test(text) && /[A-Z]/.test(text) && /[0-9]/.test(text)) return true
  if (text.length >= 40 && !text.includes('_')) return true
  return false
}

export function isRef(value) {
  return typeof value === 'string' && REF.test(value)
}

/**
 * The value a reference points at, or undefined when it cannot be read now
 * (unset variable, missing file, nobody to ask). A literal is refused: secrets
 * are given by reference so that answers files and records never hold them.
 */
export async function resolveRef(ref, { env = process.env, ask } = {}) {
  if (!isRef(ref)) throw new InstallError(2, 'A key must be given as a reference (env:NAME, file:/path or prompt), never as its value.')
  if (ref === 'none' || ref === 'stored') return undefined
  if (ref === 'prompt') return ask ? ask() : undefined
  if (ref.startsWith('env:')) {
    const value = env[ref.slice(4)]
    return value ? value : undefined
  }
  const path = ref.slice(5).replace(/^~(?=\/)/, env.HOME || '')
  try {
    const value = (await readFile(path, 'utf8')).replace(/\r?\n$/, '')
    return value || undefined
  } catch {
    return undefined
  }
}

// ------------------------------------------------------------ env files
// Values are single-quoted, which Docker Compose reads literally (no $
// interpolation, no escapes). A value compose cannot hold that way is refused.

export function envFileText(values, header = '') {
  const lines = header ? header.split('\n').map(line => `# ${line}`) : []
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue
    const text = String(value)
    if (text.includes("'") || /[\r\n]/.test(text)) {
      throw new InstallError(2, `${name} contains a single quote or a line break, which an env file cannot hold literally. Percent-encode it (a quote is %27 in a URL).`)
    }
    lines.push(`${name}='${text}'`)
  }
  return lines.join('\n') + '\n'
}

export function parseEnvFile(text) {
  const out = {}
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
    if (!match) continue
    let value = match[2]
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) value = value.slice(1, -1)
    else if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = JSON.parse(value)
    out[match[1]] = value
  }
  return out
}

// ------------------------------------------------------------ redaction

const MIN_SECRET = 6

/** Every secret the installer has seen is replaced by *** in anything it prints or logs. */
export class Redactor {
  constructor() {
    this.values = new Set()
  }

  add(value) {
    if (typeof value !== 'string' || value.length < MIN_SECRET) return
    for (const form of [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1), Buffer.from(value).toString('base64')]) {
      if (form.length >= MIN_SECRET) this.values.add(form)
    }
    // A URL's password on its own (mail URLs carry one).
    try {
      const url = new URL(value)
      if (url.password) this.add(decodeURIComponent(url.password))
      if (url.password) this.add(url.password)
    } catch { /* not a URL */ }
  }

  redact(text) {
    let out = String(text)
    // Longest first, so a value that contains another is removed whole.
    for (const value of [...this.values].sort((a, b) => b.length - a.length)) {
      if (out.includes(value)) out = out.split(value).join('***')
    }
    return out
  }
}
