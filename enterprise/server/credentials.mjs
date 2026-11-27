// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The sign-in vault: one row per (person, agent server address), holding what that server issued
// to that person. Access and refresh tokens, pasted keys and registration secrets are sealed with
// AES-256-GCM by the app's own vault (web/app/server/metering/vault.mjs) under the app's master
// key (SLATEBOX_KEY_ENCRYPTION_KEY, never generated here). The additional data binds each sealed
// value to its owner, address, issuer and field, so a value copied to another row, person or
// server does not open.
//
// Tokens never leave this module except to the session that calls the server they were issued
// for. They never reach a browser, the model, an exec script, a publication or a log line.
//
// Refresh is lazy and runs under a lease (claim the row for leaseMs), so two app processes never
// both spend a rotating refresh token. A refused refresh (invalid_grant) marks the sign-in as
// needed and stops: no retry loop.
import { randomBytes, createHash } from 'node:crypto'
import { open, seal } from '/server/metering/vault.mjs'
import { refreshTokens, revocationOf, revokesAccessOnly, revokeToken } from './oauth.mjs'

export const VAULT_LIMITS = Object.freeze({ refreshAheadMs: 60000, leaseMs: 30000, waitStepMs: 200 })

export class SignInNeeded extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SignInNeeded'
    this.code = code
  }
}

/** The row id for a person and an address (stable; not a secret). */
const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

export const credentialId = (userId, address) => 'k' + createHash('sha256').update(`${userId}\n${address}`).digest('hex').slice(0, 32)

const ownerOf = (doc, field) => ({ ownerType: 'mcp', ownerId: doc.ownerId, provider: `${doc.address}|${doc.issuer}|${field}` })

/**
 * store: { get(id), put(doc), update(id, set), claim(id, leaseId, until, now) -> bool,
 *          release(id, leaseId), remove(id) }
 * master: loadMasterKey() result (null: sign-in servers are not offered)
 * fetch: the guarded sign-in fetch; secretFor(registration) -> the pre-registered app's secret (or a
 *   promise of it), asked on every refresh and revocation (Admin › Integration apps or settings)
 * log: (entry) -> void, told when a server did not confirm a revocation: hosts and a reason only,
 *   never a token, a secret or the server's words
 */
export function createVault({ store, master, fetch, secretFor = () => null, log = () => {}, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), leaseMs = VAULT_LIMITS.leaseMs }) {
  const available = () => Boolean(master)
  const sealField = (doc, field, value) => (value ? seal({ master, owner: ownerOf(doc, field), plaintext: value }) : null)
  // A value sealed under another master key, or moved to another row, does not open: sign in again.
  const openField = (doc, field) => {
    if (!doc[field]) return null
    try {
      return open({ master, owner: ownerOf(doc, field), cipher: doc[field] })
    } catch {
      throw new SignInNeeded('needs_sign_in', 'Sign in again to keep using this agent.')
    }
  }
  const openQuietly = (doc, field) => {
    try {
      return openField(doc, field)
    } catch {
      return null
    }
  }

  async function clientOf(doc) {
    const reg = doc.registration || {}
    const secret = reg.kind === 'preregistered' ? await secretFor(reg) : reg.clientSecret ? openField(doc, 'clientSecret') : null
    return { clientId: reg.clientId, ...(secret && { clientSecret: secret }) }
  }

  /** Stores what a server issued. tokens: { accessToken, refreshToken?, expiresAt?, scopes? }. */
  async function save({ userId, address, resource, issuer, kind, registration = null, server = null, tokens }) {
    if (!master) throw new SignInNeeded('vault_off', 'Agents that need sign-in are not available on this server.')
    const base = { _id: credentialId(userId, address), ownerId: userId, address, resource, issuer: issuer || 'key', kind }
    const doc = {
      ...base,
      registration: registration && { kind: registration.kind, clientId: registration.clientId, ...(registration.provider && { provider: registration.provider }) },
      server: server && {
        issuer: server.issuer,
        tokenEndpoint: server.tokenEndpoint,
        ...(server.revocationEndpoint && { revocationEndpoint: server.revocationEndpoint }),
        ...(server.revocation && { revocation: server.revocation }),
        ...(server.tokenAccept && { tokenAccept: server.tokenAccept }),
        ...(server.noResource && { noResource: true }),
        ...(server.tokenAuth && { tokenAuth: server.tokenAuth }),
      },
      access: sealField(base, 'access', tokens.accessToken),
      refresh: sealField(base, 'refresh', tokens.refreshToken),
      clientSecret: registration?.kind !== 'preregistered' ? sealField(base, 'clientSecret', registration?.clientSecret) : null,
      expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
      scopes: tokens.scopes || [],
      status: 'ok',
      lease: null,
      createdAt: new Date(now()),
      updatedAt: new Date(now()),
    }
    await store.put(doc)
    return { credentialId: doc._id, kind, issuer: doc.issuer }
  }

  /** What anyone may know about a sign-in: never a token. */
  async function describe(userId, address) {
    const doc = await store.get(credentialId(userId, address))
    if (!doc) return null
    return { kind: doc.kind, issuer: doc.issuer, status: doc.status, scopes: doc.scopes || [] }
  }

  const fresh = (doc) => !doc.expiresAt || new Date(doc.expiresAt).getTime() - now() > VAULT_LIMITS.refreshAheadMs

  async function needsSignIn(doc) {
    await store.update(doc._id, { status: 'needs_sign_in', access: null, refresh: null, lease: null, updatedAt: new Date(now()) })
    throw new SignInNeeded('needs_sign_in', 'Sign in again to keep using this agent.')
  }

  async function refreshUnderLease(doc) {
    const leaseId = randomBytes(9).toString('hex')
    const claimed = await store.claim(doc._id, leaseId, new Date(now() + leaseMs), new Date(now()))
    if (!claimed) {
      // Another process is refreshing: wait for its answer, never spend the refresh token twice.
      const until = now() + leaseMs
      while (now() < until) {
        await sleep(VAULT_LIMITS.waitStepMs)
        const current = await store.get(doc._id)
        if (!current) throw new SignInNeeded('needs_sign_in', 'Sign in again to keep using this agent.')
        if (current.status === 'needs_sign_in') throw new SignInNeeded('needs_sign_in', 'Sign in again to keep using this agent.')
        if (!current.lease && fresh(current)) return openField(current, 'access')
      }
      throw new SignInNeeded('busy', 'This agent\'s sign-in is being renewed. Try again in a moment.')
    }
    let result
    try {
      result = await refreshTokens({
        server: doc.server,
        client: await clientOf(doc),
        refreshToken: openField(doc, 'refresh'),
        resource: doc.resource,
        fetch,
        accept: doc.server?.tokenAccept,
      })
    } catch (error) {
      await store.release(doc._id, leaseId)
      throw error
    }
    if (result.error === 'invalid_grant') return needsSignIn(doc)
    if (result.error) {
      await store.release(doc._id, leaseId)
      throw new SignInNeeded('refresh_failed', 'Couldn\'t renew this agent\'s sign-in. Try again in a minute.')
    }
    const set = {
      access: sealField(doc, 'access', result.accessToken),
      // A rotating server sends a new refresh token; one that doesn't keeps the old one valid.
      refresh: result.refreshToken ? sealField(doc, 'refresh', result.refreshToken) : doc.refresh,
      expiresAt: result.expiresAt ? new Date(result.expiresAt) : null,
      ...(result.scopes.length && { scopes: result.scopes }),
      status: 'ok',
      lease: null,
      updatedAt: new Date(now()),
    }
    await store.update(doc._id, set)
    return result.accessToken
  }

  /**
   * The token to send to this address for this person: null when they never signed in to it;
   * throws SignInNeeded when the sign-in has to be done again. force: refresh even if not expired
   * (after the server answered 401).
   */
  async function tokenFor(userId, address, { force = false } = {}) {
    if (!master) return null
    const doc = await store.get(credentialId(userId, address))
    if (!doc || doc.address !== address || doc.ownerId !== userId) return null
    if (doc.status === 'needs_sign_in') throw new SignInNeeded('needs_sign_in', 'Sign in again to keep using this agent.')
    if (doc.kind === 'key') {
      if (force) return needsSignIn(doc)
      return openField(doc, 'access')
    }
    if (!force && fresh(doc)) return openField(doc, 'access')
    if (!doc.refresh) return needsSignIn(doc)
    return refreshUnderLease(doc)
  }

  /**
   * Forgets a sign-in, revoking it at its server first. The server's endpoint is the one saved with
   * the sign-in, else (a sign-in saved before Slatebox kept one, or one whose server's metadata names
   * none) the known provider's (oauth.mjs revocationOf). revokeFailed: the server did not confirm
   * that the sign-in ended, or it offers no way to end it.
   */
  async function remove(userId, address) {
    const doc = await store.get(credentialId(userId, address))
    if (!doc) return { removed: false, revoked: false }
    let revoked = false
    let failed = false
    // Telling the server to end the sign-in is best effort: a refusal, a timeout or a broken
    // client never keeps the sign-in here.
    if (doc.kind === 'oauth') {
      const revocation = revocationOf(doc.server)
      const refresh = master ? openQuietly(doc, 'refresh') : null
      let access = master ? openQuietly(doc, 'access') : null
      if (revocation && (refresh || access)) {
        try {
          const client = await clientOf(doc)
          if (revokesAccessOnly(revocation)) {
            // Slack's and GitHub's revocation take an access token only, and an expired one is
            // refused: renew it once (best effort) so the grant itself can be ended.
            if (refresh && (!access || !fresh(doc))) {
              const renewed = await refreshTokens({ server: doc.server, client, refreshToken: refresh, resource: doc.resource, fetch, accept: doc.server?.tokenAccept }).catch(() => null)
              if (renewed?.accessToken) access = renewed.accessToken
            }
          } else if (refresh) revoked = (await revokeToken({ server: doc.server, client, token: refresh, hint: 'refresh_token', fetch })) || revoked
          if (access) revoked = (await revokeToken({ server: doc.server, client, token: access, hint: 'access_token', fetch })) || revoked
        } catch {}
      }
      failed = !revoked
      if (failed) {
        const reason = !revocation ? 'not_offered' : refresh || access ? 'not_confirmed' : 'no_token'
        try {
          log({ kind: 'revoke_failed', reason, server: hostOf(revocation?.url || doc.server?.tokenEndpoint), address: hostOf(doc.address) })
        } catch {}
      }
    }
    await store.remove(doc._id)
    return { removed: true, revoked, ...(failed && { revokeFailed: true }) }
  }

  return { available, save, describe, tokenFor, remove }
}
