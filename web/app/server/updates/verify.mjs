// Release signatures for self-hosted updates: one file, byte-identical in the installer
// (packages/slatebox/src/updater/verify.mjs), the app (web/app/server/updates/verify.mjs) and so in
// the image (/opt/slatebox/installer/src/updater/verify.mjs). scripts/updates-verify-parity.test.mjs
// keeps the copies the same. No dependencies: node:crypto only, works offline.
//
// A signed document (a release manifest, or the channel feed) is canonical JSON: keys sorted at every
// level, no spaces. Its detached signature is one line:
//
//   sbrel1.<key id>.<Ed25519 signature of "sbrel1.<key id>." + canonical JSON, base64url>
//
// The key list holds public halves only (SPKI DER, base64). A new key is added beside the old one
// and the old one is never swapped out, so every image ever shipped can still check what is signed
// with the key it knows. The private half lives in the GitHub environment "release" (v* tags, and main for the daily feed refresh)
// and a second, offline one with the owner (docs/releasing.md).
import { createPrivateKey, createPublicKey, sign as signBytes, verify as verifyBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const SIGNATURE_FORMAT = 'sbrel1'

// The production release keys. Empty until the owner creates the first pair
// (node scripts/release-manifest.mjs keygen --id slatebox-rel-2026-11) and adds its public half
// here in a release commit. Until then every signed document is refused ("no release key"), so
// no install can be talked into an update by anyone.
export const RELEASE_KEYS = Object.freeze({})

// Test builds (and only test builds) add keys as files in this folder: one JSON object
// { "<key id>": "<SPKI DER, base64>" } per file. A release image never has the folder; the image
// workflow refuses to publish one that does.
export const TEST_KEYS_DIR = '/opt/slatebox/release-keys.d'

/** The keys this copy trusts: the production list, plus test keys only where a test build put them. */
export function trustedKeys({ keys = RELEASE_KEYS, dir = TEST_KEYS_DIR, exists = existsSync, list = readdirSync, read = readFileSync } = {}) {
  const out = { ...keys }
  if (!dir || !exists(dir)) return out
  for (const file of list(dir).filter(name => name.endsWith('.json')).sort()) {
    try {
      const extra = JSON.parse(read(join(dir, file), 'utf8'))
      for (const [id, spki] of Object.entries(extra)) if (!(id in out) && typeof spki === 'string') out[id] = spki
    } catch { /* an unreadable key file adds nothing */ }
  }
  return out
}

/** Canonical JSON: sorted keys at every level, no whitespace. Rejects what JSON cannot say exactly. */
export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON has no NaN or Infinity')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  throw new Error(`canonical JSON cannot hold a ${typeof value}`)
}

const KEY_ID = /^[a-z0-9][a-z0-9-]{2,63}$/
const signedText = (keyId, canonical) => `${SIGNATURE_FORMAT}.${keyId}.${canonical}`

/** Sign a document with a private key (PKCS#8 PEM). For the release tooling and the tests. */
export function signDocument(document, { keyId, privateKeyPem }) {
  if (!KEY_ID.test(keyId)) throw new Error('A key id is 3-64 lowercase letters, digits and hyphens.')
  const key = createPrivateKey(privateKeyPem)
  const signature = signBytes(null, Buffer.from(signedText(keyId, canonicalJson(document)), 'utf8'), key)
  return `${SIGNATURE_FORMAT}.${keyId}.${signature.toString('base64url')}`
}

export class SignatureError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/**
 * Check a detached signature over the exact bytes received. The document is parsed only after the
 * signature checks out, and its canonical form must be the bytes that were signed (so two JSON
 * spellings of different meaning cannot share one signature).
 * @returns {{ document: object, keyId: string }}
 */
export function verifyDocument(bytes, signatureLine, { keys = trustedKeys() } = {}) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes ?? '')
  const parts = String(signatureLine ?? '').trim().split('.')
  if (parts.length !== 3 || parts[0] !== SIGNATURE_FORMAT || !KEY_ID.test(parts[1]) || !/^[A-Za-z0-9_-]{80,90}$/.test(parts[2])) {
    throw new SignatureError('malformed', 'The signature is not an sbrel1 signature.')
  }
  const [, keyId, sig] = parts
  if (!Object.keys(keys).length) throw new SignatureError('no-keys', 'This copy of Slatebox has no release key yet, so it cannot check an update.')
  const spki = keys[keyId]
  if (!spki) throw new SignatureError('unknown-key', `The release is signed with a key this copy does not know (${keyId}).`)
  let document
  try { document = JSON.parse(text) } catch { throw new SignatureError('malformed', 'The signed document is not JSON.') }
  const canonical = canonicalJson(document)
  if (canonical !== text.replace(/\n$/, '')) throw new SignatureError('not-canonical', 'The signed document is not in canonical form.')
  let good = false
  try {
    const key = createPublicKey({ key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki' })
    good = verifyBytes(null, Buffer.from(signedText(keyId, canonical), 'utf8'), key, Buffer.from(sig, 'base64url'))
  } catch { good = false }
  if (!good) throw new SignatureError('bad-signature', 'The signature does not match: the file was changed or is not from Slatebox.')
  return { document, keyId }
}
