// OpenID Connect for "Sign in with SSO", on openid-client (panva; an OpenID-certified relying
// party): the authorization code flow with PKCE (S256), a state and a nonce, for a confidential
// client. The ID token's signature is checked against the provider's published keys (JWKS), as are
// its issuer, audience, expiry and nonce: a team's identity provider is anywhere on the internet,
// so the back channel alone is not proof enough. Nothing here imports Meteor, so the flow is
// unit-tested with node alone (scripts/sso.test.mjs, scripts/sso-oidc.test.mjs).
//
// A connection's endpoints are a plain `config`:
//   { issuer, authorizationEndpoint, tokenEndpoint, jwksUri, endSessionEndpoint?, clientId,
//     clientSecret, redirectUri, allowHttp? }
// read from the provider's discovery document (discover) or, for the self-hosted server's bundled
// Keycloak, from settings.sso (its token endpoint and keys are on the container's loopback).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import native from './native.cjs'

const { openidClient: client, jose: { createLocalJWKSet, jwtVerify } } = native

export const STATE_COOKIE = 'slatebox_sso'
const STATE_MAX_AGE_MS = 10 * 60_000
const CLOCK_SKEW_S = 60
const SCOPE = 'openid email profile offline_access'
const LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout'

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

/** The hash of the random value the browser tab keeps while it signs in (see tickets.mjs). */
export const bindingFor = verifier => createHash('sha256').update(String(verifier)).digest('base64url')
const VERIFIER = /^[A-Za-z0-9_-]{43,128}$/
export const validVerifier = (value) => typeof value === 'string' && VERIFIER.test(value)

/** The endpoints from a provider's discovery document (openid-client's serverMetadata()). */
export function endpointsFrom(metadata) {
  return {
    issuer: metadata.issuer,
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
    jwksUri: metadata.jwks_uri,
    ...(metadata.end_session_endpoint && { endSessionEndpoint: metadata.end_session_endpoint }),
    ...(metadata.authorization_response_iss_parameter_supported && { issParameter: true }),
    backchannelLogout: metadata.backchannel_logout_supported === true,
  }
}

/**
 * Read a provider's discovery document (/.well-known/openid-configuration) through `fetch` (in
 * Slatebox Cloud, one that reaches public addresses only). The issuer it names must be the one
 * asked for. Throws SsoError('discovery').
 */
export async function discover(issuer, { fetch, allowHttp = false } = {}) {
  try {
    const found = await client.discovery(new URL(issuer), 'slatebox-discovery', undefined, undefined, {
      ...(fetch && { [client.customFetch]: fetch }),
      ...(allowHttp && { execute: [client.allowInsecureRequests] }),
      timeout: 15,
    })
    const endpoints = endpointsFrom(found.serverMetadata())
    if (!endpoints.authorizationEndpoint || !endpoints.tokenEndpoint || !endpoints.jwksUri) {
      throw new SsoError('discovery', 'the provider does not publish an authorization endpoint, a token endpoint and its keys')
    }
    return endpoints
  } catch (error) {
    if (error instanceof SsoError) throw error
    throw new SsoError('discovery', `the provider's discovery document could not be read (${error?.message || 'failed'})`)
  }
}

/** openid-client's Configuration for one sign-in, with `now` as the clock it checks tokens against. */
export function configurationFor(config, { fetch, now = Date.now() } = {}) {
  const server = {
    issuer: config.issuer,
    authorization_endpoint: config.authorizationEndpoint,
    token_endpoint: config.tokenEndpoint,
    ...(config.jwksUri && { jwks_uri: config.jwksUri }),
    ...(config.endSessionEndpoint && { end_session_endpoint: config.endSessionEndpoint }),
    ...(config.issParameter && { authorization_response_iss_parameter_supported: true }),
  }
  const metadata = {
    client_secret: config.clientSecret,
    [client.clockSkew]: Math.round((now - Date.now()) / 1000),
    [client.clockTolerance]: CLOCK_SKEW_S,
  }
  const configuration = new client.Configuration(server, config.clientId, metadata, client.ClientSecretPost(config.clientSecret))
  if (fetch) configuration[client.customFetch] = fetch
  if (config.allowHttp) client.allowInsecureRequests(configuration)
  // The ID token's signature is checked against the provider's keys, never skipped.
  if (!config.jwksUri) throw new SsoError('config', 'the connection has no signing keys address (jwks_uri)')
  client.enableNonRepudiationChecks(configuration)
  return configuration
}

/**
 * Start a sign-in: the address to send the browser to, and the cookie that remembers it.
 * `verifier` is a random value the browser tab made and keeps in its sessionStorage; only its
 * hash travels in the sealed state, and the one-time ticket can only be redeemed with it. So a
 * ticket from someone else's sign-in cannot sign this browser in to their account.
 * extra: more fields for the sealed state (the connection id, a "try it" request).
 */
export function beginSignIn({ config, key, now = Date.now(), next, verifier: tab, extra = {}, loginHint }) {
  if (!validVerifier(tab)) throw new SsoError('no-binding', 'the sign-in was not started from the sign-in page')
  const { verifier, challenge } = createPkce()
  const state = random()
  const nonce = random()
  const url = new URL(config.authorizationEndpoint)
  const params = {
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: SCOPE,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(typeof loginHint === 'string' && loginHint && loginHint.length <= 254 && { login_hint: loginHint }),
  }
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  return { url: url.toString(), cookie: sealState(key, { ...extra, state, nonce, verifier, binding: bindingFor(tab), next: safeNext(next), at: now }) }
}

const isResponseError = (error) => error instanceof client.ResponseBodyError || error?.code === 'OAUTH_RESPONSE_BODY_ERROR'
const isTransport = (error) => error?.name === 'AbortError' || error?.name === 'TimeoutError' || error?.code === 'OAUTH_RESPONSE_IS_NOT_CONFORM' ||
  error?.code === 'OAUTH_RESPONSE_IS_NOT_JSON' || error?.cause?.code === 'ECONNREFUSED' || /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN/.test(String(error?.message))

/** Finish a sign-in from the callback's query and the sealed cookie. Throws an SsoError. */
export async function completeSignIn({ config, key, now = Date.now(), cookie, query, fetch }) {
  const started = openState(key, cookie, now)
  if (!started) throw new SsoError('no-sign-in', 'the sign-in expired or was not started here')
  if (typeof query?.state !== 'string' || query.state.length !== started.state.length ||
      !timingSafeEqual(Buffer.from(query.state), Buffer.from(started.state))) {
    throw new SsoError('state', 'state does not match')
  }
  if (query.error) throw new SsoError('denied', 'the identity provider did not sign the person in')
  if (typeof query.code !== 'string' || !query.code) throw new SsoError('no-code', 'no authorization code')
  if (typeof started.binding !== 'string' || !started.binding) throw new SsoError('no-sign-in', 'the sign-in was not bound to a browser')
  const configuration = configurationFor(config, { fetch, now })
  const currentUrl = new URL(config.redirectUri)
  for (const [name, value] of Object.entries(query)) if (typeof value === 'string') currentUrl.searchParams.set(name, value)
  let tokens
  try {
    tokens = await client.authorizationCodeGrant(configuration, currentUrl, {
      pkceCodeVerifier: started.verifier, expectedNonce: started.nonce, expectedState: started.state, idTokenExpected: true,
    })
  } catch (error) {
    if (isResponseError(error)) throw new SsoError('token', `the token endpoint answered ${error.status}`)
    if (isTransport(error)) throw new SsoError('token', 'the token endpoint could not be reached')
    throw new SsoError('id-token', error?.message || 'the ID token was refused')
  }
  const claims = tokens.claims()
  if (!claims || typeof claims.sub !== 'string' || !claims.sub) throw new SsoError('id-token', 'subject')
  return {
    claims,
    refreshToken: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : undefined,
    idToken: typeof tokens.id_token === 'string' ? tokens.id_token : undefined,
    next: started.next,
    binding: started.binding,
    started,
  }
}

/**
 * Is the person's SSO session still good? A refused refresh token (invalid_grant) means the user
 * was disabled or removed, or the session was ended in the identity provider: revoked. Anything
 * else that fails, such as an outage, is unknown, and nobody is signed out for it.
 */
export async function refreshSession({ config, refreshToken, fetch, now = Date.now() }) {
  let tokens
  try {
    tokens = await client.refreshTokenGrant(configurationFor(config, { fetch, now }), refreshToken)
  } catch (error) {
    if (isResponseError(error) && error.status === 400 && error.error === 'invalid_grant') return { status: 'revoked' }
    return { status: 'unknown' }
  }
  return { status: 'active', refreshToken: tokens.refresh_token || refreshToken }
}

/** Where the browser goes to sign out at the identity provider too, or null when it has no such page. */
export function endSessionUrl({ config, idToken, postLogoutRedirectUri }) {
  if (!config.endSessionEndpoint) return null
  const url = new URL(config.endSessionEndpoint)
  url.searchParams.set('client_id', config.clientId)
  if (idToken) url.searchParams.set('id_token_hint', idToken)
  if (postLogoutRedirectUri) url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri)
  return url.toString()
}

/**
 * OpenID Connect Back-Channel Logout 1.0: the provider POSTs a signed logout token when a person's
 * session ends there. jwks: the provider's key set ({ keys }). Returns { subject, sessionId, jti }
 * or throws SsoError('logout-token').
 */
export async function verifyLogoutToken(token, { config, jwks, now = Date.now() }) {
  let payload
  try {
    ({ payload } = await jwtVerify(String(token || ''), createLocalJWKSet(jwks), {
      issuer: config.issuer,
      audience: config.clientId,
      clockTolerance: CLOCK_SKEW_S,
      currentDate: new Date(now),
      requiredClaims: ['iat', 'jti', 'events'],
      algorithms: ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'],
    }))
  } catch (error) {
    throw new SsoError('logout-token', error?.code || 'the logout token was refused')
  }
  if (!payload.events || typeof payload.events !== 'object' || !Object.hasOwn(payload.events, LOGOUT_EVENT)) throw new SsoError('logout-token', 'events')
  if (payload.nonce !== undefined) throw new SsoError('logout-token', 'a logout token carries no nonce')
  if (typeof payload.sub !== 'string' && typeof payload.sid !== 'string') throw new SsoError('logout-token', 'neither sub nor sid')
  if (typeof payload.iat !== 'number' || now / 1000 - payload.iat > 10 * 60) throw new SsoError('logout-token', 'too old')
  return { subject: typeof payload.sub === 'string' ? payload.sub : null, sessionId: typeof payload.sid === 'string' ? payload.sid : null, jti: payload.jti }
}
