// The collaboration relay's room token (v2). collaborators.init hands one to each viewer of a
// slate it may read; the relay (the Slatebox fork of y-websocket, src/auth) checks it when a socket
// connects.
//
// - Key: relayKey = HKDF-SHA256(ikm = the org's secretKey, salt 'slatebox-relay', info
//   'room-token-v1', 32 bytes). The relay already holds the secretKey for the publicKey
//   (API_KEYS, or the organization's record), so no new secret is shared.
// - Token: base64url(JSON {v: 2, pk, room, role, exp, n}) + '.' + base64url(HMAC-SHA256(relayKey,
//   that base64url payload)). room is the slate's own id (the engine's options.id) from the
//   server's record, role 'read' or 'write', exp unix seconds, n a random nonce.
//
// A token is a credential: never log one (scripts/relay-token.test.mjs checks the methods do not).
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

export const RELAY_TOKEN_VERSION = 2
export const RELAY_TOKEN_TTL_SECONDS = 15 * 60
export const RELAY_TOKEN_SKEW_SECONDS = 60
export const RELAY_ROLES = Object.freeze(['read', 'write'])
const SALT = 'slatebox-relay'
const INFO = 'room-token-v1'

const isKey = (value) => typeof value === 'string' && value.length > 0
const b64url = (buffer) => Buffer.from(buffer).toString('base64url')

/** The key the relay token is signed with, derived from the org's API secret. */
export function relayKey(secretKey) {
  if (!isKey(secretKey)) throw new TypeError('relayKey needs the API secret key')
  return Buffer.from(hkdfSync('sha256', Buffer.from(secretKey, 'utf8'), Buffer.from(SALT, 'utf8'), Buffer.from(INFO, 'utf8'), 32))
}

const signPayload = (key, payload) => b64url(createHmac('sha256', key).update(payload).digest())

/**
 * A room token for one slate. room must come from the server's record of the slate, never from a
 * caller. Returns { token, exp } (exp in unix seconds).
 */
export function mintRoomToken({ publicKey, secretKey, room, role, now = Date.now(), ttlSeconds = RELAY_TOKEN_TTL_SECONDS, nonce } = {}) {
  if (!isKey(publicKey) || !isKey(secretKey)) throw new TypeError('mintRoomToken needs the API key pair')
  if (!isKey(room)) throw new TypeError('mintRoomToken needs the room')
  if (!RELAY_ROLES.includes(role)) throw new TypeError('mintRoomToken role is read or write')
  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? Math.floor(ttlSeconds) : RELAY_TOKEN_TTL_SECONDS
  const exp = Math.floor(now / 1000) + ttl
  const n = isKey(nonce) ? nonce : b64url(randomBytes(12))
  const payload = b64url(JSON.stringify({ v: RELAY_TOKEN_VERSION, pk: publicKey, room, role, exp, n }))
  return { token: `${payload}.${signPayload(relayKey(secretKey), payload)}`, exp }
}

/** The payload of a token, unchecked (for reading pk before the secret is looked up). */
export function readRoomToken(token) {
  if (typeof token !== 'string' || token.length > 4096) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  try {
    const claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    return claims && typeof claims === 'object' ? claims : null
  } catch {
    return null
  }
}

/**
 * The relay's check, kept here so the app's tests prove what it mints is what the relay accepts:
 * the signature (constant time), exp not past (60 s skew) and the room the socket asked for.
 * secretFor(publicKey) returns the org's secretKey or null. Returns the claims or null.
 */
export function verifyRoomToken(token, { room, secretFor, now = Date.now(), skewSeconds = RELAY_TOKEN_SKEW_SECONDS } = {}) {
  const claims = readRoomToken(token)
  if (!claims || claims.v !== RELAY_TOKEN_VERSION || !isKey(claims.pk) || !isKey(claims.room)) return null
  if (!RELAY_ROLES.includes(claims.role) || !Number.isFinite(claims.exp)) return null
  const secretKey = secretFor?.(claims.pk)
  if (!isKey(secretKey)) return null
  const [payload, signature] = token.split('.')
  const expected = Buffer.from(signPayload(relayKey(secretKey), payload))
  const sent = Buffer.from(signature)
  if (expected.length !== sent.length || !timingSafeEqual(expected, sent)) return null
  if (claims.exp + skewSeconds < Math.floor(now / 1000)) return null
  if (claims.room !== room) return null
  return claims
}
