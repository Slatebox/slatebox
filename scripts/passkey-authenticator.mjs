// A software passkey authenticator for the passkey tests (scripts/passkeys*.test.mjs): it answers
// the options server/passkeys/core.mjs makes the way a browser and a platform authenticator do,
// with a real P-256 key, 'none' attestation, and every flag and field the server checks, so the
// server's own SimpleWebAuthn verification runs end to end without a browser. Dev only.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { createRequire } from 'node:module'

// @simplewebauthn/server lives in web/app's node_modules; its CBOR encoder builds the attestation.
const require = createRequire(new URL('../web/app/package.json', import.meta.url))
const { isoCBOR } = require('@simplewebauthn/server/helpers')

const b64url = (bytes) => Buffer.from(bytes).toString('base64url')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest()
const u32 = (value) => { const out = Buffer.alloc(4); out.writeUInt32BE(value >>> 0); return out }
const u16 = (value) => { const out = Buffer.alloc(2); out.writeUInt16BE(value); return out }

const FLAG = { up: 0x01, uv: 0x04, be: 0x08, bs: 0x10, at: 0x40 }
export const AAGUID_GOOGLE = 'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4'

/**
 * One authenticator holding passkeys. Options change what it does wrong, for the refusal tests:
 * { origin, rpId (the one it signs for, else the options' rp.id), userVerified, counter: n | 'fixed',
 *   synced, aaguid, type, crossOrigin, challenge (answer another challenge) }.
 */
export function createAuthenticator({ origin, aaguid = AAGUID_GOOGLE, synced = true } = {}) {
  const credentials = new Map()

  function authData({ rpId, userVerified, counter, synced: backed, attested }) {
    let flags = FLAG.up | (userVerified ? FLAG.uv : 0)
    if (backed) flags |= FLAG.be | FLAG.bs
    if (attested) flags |= FLAG.at
    const parts = [sha256(Buffer.from(rpId)), Buffer.from([flags]), u32(counter)]
    if (attested) parts.push(attested)
    return Buffer.concat(parts)
  }

  function clientData({ type, challenge, at, crossOrigin = false }) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: at, crossOrigin }))
  }

  return {
    credentials,
    /** navigator.credentials.create(): the RegistrationResponseJSON startRegistration returns. */
    create(options, overrides = {}) {
      const rpId = overrides.rpId || options.rp.id
      const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      const jwk = publicKey.export({ format: 'jwk' })
      const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]])
      const id = randomBytes(16)
      const guid = Buffer.from(String(overrides.aaguid ?? aaguid).replace(/-/g, ''), 'hex')
      const attested = Buffer.concat([guid, u16(id.length), id, Buffer.from(isoCBOR.encode(cose))])
      const backed = overrides.synced ?? synced
      const data = authData({ rpId, userVerified: overrides.userVerified ?? true, counter: 0, synced: backed, attested })
      const attestationObject = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', data]]))
      const json = clientData({ type: overrides.type || 'webauthn.create', challenge: overrides.challenge || options.challenge, at: overrides.origin || origin, crossOrigin: overrides.crossOrigin })
      const credential = { id: b64url(id), privateKey, rpId, userHandle: options.user.id, counter: 0, synced: backed }
      credentials.set(credential.id, credential)
      return {
        id: credential.id,
        rawId: credential.id,
        type: 'public-key',
        response: { clientDataJSON: b64url(json), attestationObject: b64url(attestationObject), transports: ['internal', 'hybrid'] },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      }
    },
    /** navigator.credentials.get(): the AuthenticationResponseJSON startAuthentication returns. */
    get(options, overrides = {}) {
      const credential = overrides.credentialId ? credentials.get(overrides.credentialId) : [...credentials.values()].at(-1)
      if (!credential) throw new Error('no passkey for this site')
      let counter = 0
      if (overrides.counter === 'fixed') counter = credential.counter
      else if (Number.isInteger(overrides.counter)) counter = overrides.counter
      else if (!credential.synced) counter = credential.counter + 1
      credential.counter = counter
      const data = authData({ rpId: overrides.rpId || credential.rpId, userVerified: overrides.userVerified ?? true, counter, synced: credential.synced })
      const json = clientData({ type: overrides.type || 'webauthn.get', challenge: overrides.challenge || options.challenge, at: overrides.origin || origin, crossOrigin: overrides.crossOrigin })
      const signature = sign('sha256', Buffer.concat([data, sha256(json)]), credential.privateKey)
      return {
        id: credential.id,
        rawId: credential.id,
        type: 'public-key',
        response: {
          clientDataJSON: b64url(json),
          authenticatorData: b64url(data),
          signature: b64url(signature),
          userHandle: overrides.userHandle === undefined ? credential.userHandle : overrides.userHandle,
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      }
    },
  }
}
