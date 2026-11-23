// Own keys, encrypted at rest with AES-256-GCM. The additional data binds a stored key
// to its owner and provider, so a cipher copied to another owner does not decrypt.
// The master key comes from the environment (SLATEBOX_KEY_ENCRYPTION_KEY, 32 bytes in
// base64), never from a settings file. Without it, own keys are not offered at all.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const NOT_AVAILABLE = 'Own keys are not available on this server.'
export const PROVIDERS = Object.freeze(['deepinfra', 'openai-compatible', 'daily'])

export function loadMasterKey(env = process.env) {
  const raw = env.SLATEBOX_KEY_ENCRYPTION_KEY
  if (typeof raw !== 'string' || !raw) return null
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) return null
  return { key, keyId: createHash('sha256').update(key).digest('hex').slice(0, 8) }
}

const aad = ({ ownerType, ownerId, provider }) => Buffer.from(`${ownerType}:${ownerId}:${provider}`)

export function seal({ master, owner, plaintext }) {
  if (!master) throw new Error(NOT_AVAILABLE)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', master.key, iv)
  cipher.setAAD(aad(owner))
  const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  return { v: 1, keyId: master.keyId, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
}

export function open({ master, owner, cipher }) {
  if (!master) throw new Error(NOT_AVAILABLE)
  if (cipher?.v !== 1 || cipher.keyId !== master.keyId) throw new Error('This key was saved under a master key that has been rotated. Add it again.')
  const decipher = createDecipheriv('aes-256-gcm', master.key, Buffer.from(cipher.iv, 'base64'))
  decipher.setAAD(aad(owner))
  decipher.setAuthTag(Buffer.from(cipher.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(cipher.data, 'base64')), decipher.final()]).toString('utf8')
}

export const last4 = value => String(value ?? '').slice(-4)

// The stored document. The plaintext is never part of it.
export function keyDocument({ master, owner, plaintext, baseUrl, model, now }) {
  return {
    ownerType: owner.ownerType, ownerId: owner.ownerId, provider: owner.provider,
    ...(baseUrl && { baseUrl }), ...(model && { model }),
    cipher: seal({ master, owner, plaintext: plaintext ?? '' }),
    last4: plaintext ? last4(plaintext) : '',
    created: now, lastUsedAt: null, lastError: null,
  }
}

const NAMES = { deepinfra: 'DeepInfra key', daily: 'Daily key' }

// What a person may see about a stored key.
export function describeKey(doc) {
  let label
  if (doc.provider === 'openai-compatible') {
    let host = doc.baseUrl
    try { host = new URL(doc.baseUrl).host } catch {}
    label = `Your model at ${host}`
  } else {
    label = `${NAMES[doc.provider] || 'Key'} ending ${doc.last4}`
  }
  return { provider: doc.provider, label, lastError: doc.lastError ?? null }
}
