/* eslint-disable no-underscore-dangle, no-await-in-loop, no-restricted-syntax, no-continue */
// SCIM tokens: what a team's identity provider sends to /scim/v2 (Authorization: Bearer). Pure
// apart from node:crypto; the store is injected.
//
// - sbscim_<8 hex>_<32 random bytes, base64url>. The team is the token's: no team in the address.
// - Stored as SHA-256 only (the pattern of API tokens, server/api-token-core.mjs), compared in
//   constant time, shown once when made.
// - At most two active per team, so a new one can be set at the provider before the old one is
//   revoked. lastUsedAt and revokedAt are kept; a revoked token answers 401 at once.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const SCIM_TOKEN_PREFIX = 'sbscim_'
export const ACTIVE_SCIM_TOKENS = 2
export const SCIM_RATE_PER_MINUTE = 600
// lastUsedAt is written at most this often per token: a sync of thousands of people is not a
// write per request.
export const LAST_USED_EVERY_MS = 60_000
const SHAPE = /^sbscim_([0-9a-f]{8})_([A-Za-z0-9_-]{43})$/

export const hashScimToken = (token) => createHash('sha256').update(token).digest('hex')

/** A new token: { token (to show once), prefix, tokenHash }. */
export function mintScimToken(random = randomBytes) {
  const prefix = random(4).toString('hex')
  const token = `${SCIM_TOKEN_PREFIX}${prefix}_${random(32).toString('base64url')}`
  return { token, prefix, tokenHash: hashScimToken(token) }
}

/** The token from an Authorization header, or null when it is not a SCIM token. */
export function bearerScimToken(header) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(String(header || ''))
  return match && SHAPE.test(match[1]) ? match[1] : null
}

const sameHash = (a, b) => {
  const left = Buffer.from(String(a), 'hex')
  const right = Buffer.from(String(b), 'hex')
  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right)
}

/**
 * store: { insert(doc) → id, findActiveByPrefix(prefix) → [doc], listForTeam(orgId) → [doc],
 *          countActive(orgId) → n, revoke(orgId, id, at) → boolean, touch(id, at) }
 */
export function createScimTokens({ store, now = Date.now, random = randomBytes }) {
  // Which team a request is for, or null: the token must be well formed, known, not revoked.
  async function authenticate(header) {
    const token = bearerScimToken(header)
    if (!token) return null
    const prefix = SHAPE.exec(token)[1]
    const hash = hashScimToken(token)
    const candidates = await store.findActiveByPrefix(prefix)
    const found = candidates.find((doc) => !doc.revokedAt && sameHash(doc.tokenHash, hash))
    if (!found) return null
    const at = now()
    if (!found.lastUsedAt || at - found.lastUsedAt >= LAST_USED_EVERY_MS) await store.touch(found._id, at)
    return { tokenId: found._id, orgId: found.orgId }
  }

  async function create({ orgId, userId, name }) {
    if ((await store.countActive(orgId)) >= ACTIVE_SCIM_TOKENS) {
      const error = new Error(`A team has at most ${ACTIVE_SCIM_TOKENS} SCIM tokens. Revoke one first.`)
      error.code = 'too_many_tokens'
      throw error
    }
    const { token, prefix, tokenHash } = mintScimToken(random)
    const doc = {
      orgId,
      prefix,
      tokenHash,
      name: String(name || 'SCIM').trim().slice(0, 80) || 'SCIM',
      createdAt: now(),
      createdBy: userId,
      lastUsedAt: null,
      revokedAt: null,
    }
    const id = await store.insert(doc)
    return { id, token, prefix, name: doc.name, createdAt: doc.createdAt }
  }

  // Without hashes.
  const list = async (orgId) => (await store.listForTeam(orgId)).map(({ tokenHash: _hash, ...doc }) => doc)

  const revoke = (orgId, id) => store.revoke(orgId, id, now())

  return { authenticate, create, list, revoke }
}
