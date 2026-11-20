// OpenID Connect for "Sign in with SSO": the authorization code flow with PKCE (S256), a state
// and a nonce, for a confidential client. Nothing here imports Meteor, so the flow is unit-tested
// with node alone (scripts/sso.test.mjs).
//
// The code is exchanged on the back channel: the app calls the token endpoint itself, server to
// server (in the self-host image, Keycloak on the container's loopback). OpenID Connect Core
// 3.1.3.7 lets a client that receives the ID token directly from the token endpoint rely on that
// channel instead of checking the token's signature; the issuer, audience, expiry and nonce are
// still checked here.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const STATE_COOKIE = 'slatebox_sso'
const STATE_MAX_AGE_MS = 10 * 60_000
const CLOCK_SKEW_S = 60
const SCOPE = 'openid email profile offline_access'

export class SsoError extends Error {
  constructor(code, message) {
    super(message || code)
    this.code = code
  }
}

const random = () => randomBytes(32).toString('base64url')

export function createPkce() {
  const verifier = random()
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/** Only a path on this site may be returned to after signing in. */
export function safeNext(next) {
  return typeof next === 'string' && /^\/(?![/\\])[^\s]*$/.test(next) ? next.slice(0, 512) : '/'
}

/** The sign-in in progress, carried by the browser in an HMAC-sealed cookie. */
export function sealState(key, data) {
  const body = Buffer.from(JSON.stringify(data)).toString('base64url')
  const mac = createHmac('sha256', key).update(body).digest('base64url')
  return `${body}.${mac}`
}

export function openState(key, sealed, now = Date.now()) {
  if (typeof sealed !== 'string' || !sealed.includes('.')) return null
  const [body, mac] = sealed.split('.')
  const expected = createHmac('sha256', key).update(body).digest()
  let given
  try { given = Buffer.from(mac, 'base64url') } catch { return null }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  let data
  try { data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) } catch { return null }
  if (!data || typeof data.at !== 'number' || now - data.at > STATE_MAX_AGE_MS || data.at - now > CLOCK_SKEW_S * 1000) return null
  return data
}

/** Start a sign-in: the address to send the browser to, and the cookie that remembers it. */
export function beginSignIn({ config, key, now = Date.now(), next }) {
  const { verifier, challenge } = createPkce()
  const state = random()
  const nonce = random()
  const url = new URL(config.authorizationEndpoint)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: SCOPE,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString()
  return { url: url.toString(), cookie: sealState(key, { state, nonce, verifier, next: safeNext(next), at: now }) }
}

function decodeJwtPayload(token) {
  if (typeof token !== 'string') throw new SsoError('id-token', 'no ID token')
  const parts = token.split('.')
  if (parts.length !== 3) throw new SsoError('id-token', 'malformed ID token')
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) } catch {
    throw new SsoError('id-token', 'malformed ID token')
  }
}

export function verifyIdToken(token, { issuer, clientId, nonce, now = Date.now() }) {
  const claims = decodeJwtPayload(token)
  const seconds = now / 1000
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (claims.iss !== issuer) throw new SsoError('id-token', 'issuer')
  if (!audience.includes(clientId)) throw new SsoError('id-token', 'audience')
  if (audience.length > 1 && claims.azp && claims.azp !== clientId) throw new SsoError('id-token', 'authorized party')
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < seconds) throw new SsoError('id-token', 'expired')
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > seconds) throw new SsoError('id-token', 'issued in the future')
  if (!nonce || claims.nonce !== nonce) throw new SsoError('id-token', 'nonce')
  if (typeof claims.sub !== 'string' || !claims.sub) throw new SsoError('id-token', 'subject')
  return claims
}

async function tokenRequest(config, fetch, params) {
  const response = await fetch(config.tokenEndpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ ...params, client_id: config.clientId, client_secret: config.clientSecret }).toString(),
  })
  let body = {}
  try { body = await response.json() } catch { /* not JSON */ }
  return { status: response.status, ok: response.ok, body: body || {} }
}

/** Finish a sign-in from the callback's query and the sealed cookie. Throws an SsoError. */
export async function completeSignIn({ config, key, now = Date.now(), cookie, query, fetch = globalThis.fetch }) {
  const started = openState(key, cookie, now)
  if (!started) throw new SsoError('no-sign-in', 'the sign-in expired or was not started here')
  if (typeof query?.state !== 'string' || query.state.length !== started.state.length ||
      !timingSafeEqual(Buffer.from(query.state), Buffer.from(started.state))) {
    throw new SsoError('state', 'state does not match')
  }
  if (query.error) throw new SsoError('denied', 'the identity provider did not sign the person in')
  if (typeof query.code !== 'string' || !query.code) throw new SsoError('no-code', 'no authorization code')
  const reply = await tokenRequest(config, fetch, {
    grant_type: 'authorization_code', code: query.code, redirect_uri: config.redirectUri, code_verifier: started.verifier,
  })
  if (!reply.ok) throw new SsoError('token', `the token endpoint answered ${reply.status}`)
  const claims = verifyIdToken(reply.body.id_token, { issuer: config.issuer, clientId: config.clientId, nonce: started.nonce, now })
  return { claims, refreshToken: typeof reply.body.refresh_token === 'string' ? reply.body.refresh_token : undefined, next: started.next }
}

/**
 * Is the person's SSO session still good? A refused refresh token (invalid_grant) means the user
 * was disabled or removed, or the session was ended in the identity provider: revoked. Anything
 * else that fails, such as an outage, is unknown, and nobody is signed out for it.
 */
export async function refreshSession({ config, refreshToken, fetch = globalThis.fetch }) {
  let reply
  try {
    reply = await tokenRequest(config, fetch, { grant_type: 'refresh_token', refresh_token: refreshToken })
  } catch {
    return { status: 'unknown' }
  }
  if (reply.ok) return { status: 'active', refreshToken: reply.body.refresh_token || refreshToken }
  if (reply.status === 400 && reply.body.error === 'invalid_grant') return { status: 'revoked' }
  return { status: 'unknown' }
}
