// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Signing in to an outside agent's server (OAuth 2.1 as MCP's authorization spec requires), with
// no Meteor and no stores: the pure steps, each checked. signin.mjs runs them for a person.
//
//   1. Protected resource metadata (RFC 9728): the 401's resource_metadata, else the two
//      well-known addresses. Its `resource` must be the server being invited (same origin, and the
//      address sits under its path), or the document is refused.
//   2. Authorization server metadata (RFC 8414 / OpenID discovery), tried in the spec's order.
//      Its `issuer` must equal the issuer the address was built from, exactly.
//   3. PKCE S256 must be advertised, or Slatebox refuses to sign in. Only S256 is ever sent.
//   4. Every endpoint (authorization, token, registration, revocation) must be https and pass the
//      same address checks as an agent's address (no private, loopback or metadata addresses).
//   5. Registration, in order: an app registered ahead of time (settings.connectors.oauthApps),
//      Slatebox's published client document (CIMD, https origins only), automatic registration
//      (DCR, application_type "web"), else the person pastes a client id.
//   6. The authorization request always carries `resource`, a single-use `state` and the S256
//      challenge; the redirect is fixed: <origin>/connectors/oauth/callback.
//   7. The callback checks `iss` (RFC 9207): required when the server says it sends it, compared
//      exactly whenever present. The server's error text is never shown to anyone.
//   8. Token requests carry `code_verifier` (or the refresh token) and `resource`.
// All network goes through the guarded fetch handed in (mcp-fetch.mjs, GET allowed, no redirects).
import { createHash, randomBytes } from 'node:crypto'
import { checkMcpUrl, McpFetchRefused } from './mcp-fetch.mjs'

export const CALLBACK_PATH = '/connectors/oauth/callback'
export const START_PATH = '/connectors/oauth/start'
export const CLIENT_DOCUMENT_PATH = '/oauth/mcp-client.json'
export const OAUTH_LIMITS = Object.freeze({ flowMinutes: 10, metadataChars: 64 * 1024, tokenChars: 8192, scopes: 24, scopeChars: 1000 })

// Apps Slatebox registers with a vendor ahead of time (vendors with no CIMD and no DCR). The
// client id and secret come from settings.connectors.oauthApps.<provider>, never from code.
export const KNOWN_PROVIDERS = Object.freeze({
  github: Object.freeze({
    issuer: 'https://github.com/login/oauth',
    name: 'GitHub',
    // The only MCP servers a GitHub sign-in is ever sent to (by origin). GitHub tokens are not
    // tied to one audience (GitHub ignores `resource`), so a server that merely names GitHub as
    // its sign-in server must never receive one.
    resources: Object.freeze(['https://api.githubcopilot.com']),
    // GitHub's OAuth apps have no read-only scope for code. public_repo reaches public
    // repositories only (read and write: code, issues, pull requests); read:org lets lookups see
    // which organisations the person belongs to. Nothing private, no profile email, packages,
    // gists or notifications. settings.connectors.oauthApps.github.scopes may widen it (e.g.
    // "repo" for private repositories) on purpose; the consent screen then says so (reachOf).
    scopes: Object.freeze(['public_repo', 'read:org']),
    // GitHub's token endpoint answers form-encoded unless asked for JSON.
    tokenAccept: 'application/json',
  }),
})

// What a person is told. Never the server's own words.
export class SignInProblem extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SignInProblem'
    this.code = code
  }
}
const fail = (code, message) => {
  throw new SignInProblem(code, message)
}

const UNSAFE = 'This server\'s sign-in details point somewhere Slatebox won\'t go.'
const NOT_STANDARD = 'This server\'s sign-in doesn\'t meet the security standard Slatebox needs.'
const UNVERIFIED = 'Sign-in couldn\'t be verified. Try again.'

export const b64url = (buffer) => Buffer.from(buffer).toString('base64url')
export const sha256 = (text) => createHash('sha256').update(String(text)).digest()

/** A PKCE pair, S256 only (RFC 7636): 43-char verifier from 32 random bytes. */
export function pkcePair(random = randomBytes) {
  const verifier = b64url(random(32))
  return { verifier, challenge: b64url(sha256(verifier)), method: 'S256' }
}

export const challengeOf = (verifier) => b64url(sha256(verifier))

/** A single-use state value (unguessable, 256 bits). */
export const newState = (random = randomBytes) => b64url(random(32))

/** The parameters of a WWW-Authenticate Bearer challenge (quoted or token values). */
export function parseChallenge(header) {
  const text = String(header || '')
  const match = text.match(/^\s*Bearer\b(.*)$/is)
  if (!match) return null
  const params = {}
  const re = /([A-Za-z_][\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g
  let m
  while ((m = re.exec(match[1])) !== null) params[m[1].toLowerCase()] = (m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3]).slice(0, 2000)
  return params
}

const trimSlash = (path) => path.replace(/\/+$/, '')

/** The addresses tried for protected resource metadata, after the challenge's own (RFC 9728 §3.1). */
export function resourceMetadataUrls(address) {
  const url = new URL(address)
  const path = trimSlash(url.pathname)
  return [...new Set([`${url.origin}/.well-known/oauth-protected-resource${path}`, `${url.origin}/.well-known/oauth-protected-resource`])]
}

/** The addresses tried for authorization server metadata, in the MCP spec's order. */
export function serverMetadataUrls(issuer) {
  const url = new URL(issuer)
  const path = trimSlash(url.pathname)
  if (!path) return [`${url.origin}/.well-known/oauth-authorization-server`, `${url.origin}/.well-known/openid-configuration`]
  return [
    `${url.origin}/.well-known/oauth-authorization-server${path}`,
    `${url.origin}/.well-known/openid-configuration${path}`,
    `${url.origin}${path}/.well-known/openid-configuration`,
  ]
}

/** The resource names this server: same origin, and the address sits at or under its path. */
export function resourceMatches(resource, address) {
  let r
  let a
  try {
    r = new URL(resource)
    a = new URL(address)
  } catch {
    return false
  }
  if (r.origin !== a.origin || r.search || r.hash) return false
  const rp = trimSlash(r.pathname)
  const ap = trimSlash(a.pathname)
  return ap === rp || ap.startsWith(rp + '/')
}

// An endpoint a server names: https (or a local test origin), public, no credentials, no script.
export function checkEndpoint(raw, { devOrigins = [] } = {}) {
  if (typeof raw !== 'string' || raw.length > 2000) fail('sign_in_unsafe', UNSAFE)
  if (!/^https?:\/\//i.test(raw)) fail('sign_in_unsafe', UNSAFE)
  try {
    return checkMcpUrl(raw, { devOrigins }).url.href
  } catch (error) {
    if (error instanceof McpFetchRefused) fail('sign_in_unsafe', UNSAFE)
    throw error
  }
}

async function readJson(response, max = OAUTH_LIMITS.metadataChars) {
  const text = await response.text()
  if (text.length > max) fail('sign_in_unsafe', 'This server sent sign-in details that are too large.')
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

async function getJson(fetch, url) {
  let response
  try {
    response = await fetch(url, { method: 'GET', headers: { accept: 'application/json' } })
  } catch (error) {
    if (error instanceof McpFetchRefused) {
      if (['private_address', 'not_https', 'credentials', 'bad_address', 'redirects', 'bad_redirect'].includes(error.code)) fail('sign_in_unsafe', UNSAFE)
      return null
    }
    throw error
  }
  if (!response.ok) {
    await response.body?.cancel?.().catch(() => {})
    return null
  }
  return readJson(response)
}

const stringList = (value, max = OAUTH_LIMITS.scopes) =>
  Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.length <= 200).slice(0, max) : []

const scopeList = (value) =>
  typeof value === 'string' ? value.split(/\s+/).filter((s) => s && s.length <= 200 && /^[\x21\x23-\x5b\x5d-\x7e]+$/.test(s)).slice(0, OAUTH_LIMITS.scopes) : []

/**
 * Steps 1-4: what signing in to this server takes.
 * → { resource, issuer, server: { issuer, authorizationEndpoint, tokenEndpoint, registrationEndpoint?,
 *     revocationEndpoint?, issParameter, cimd, authMethods }, scopes: { challenge, resource, server } }
 */
export async function discoverSignIn({ address, challenge = null, fetch, devOrigins = [] }) {
  const tried = []
  if (challenge?.resource_metadata) tried.push(checkEndpoint(challenge.resource_metadata, { devOrigins }))
  for (const url of resourceMetadataUrls(address)) if (!tried.includes(url)) tried.push(url)
  let prm = null
  for (const url of tried) {
    prm = await getJson(fetch, url)
    if (prm) break
  }
  if (!prm) fail('no_sign_in_details', 'This server asks for sign-in but doesn\'t say how. Paste a key or token if it gives you one.')
  if (typeof prm.resource !== 'string' || !resourceMatches(prm.resource, address)) fail('sign_in_unsafe', UNSAFE)
  const servers = stringList(prm.authorization_servers, 8)
  if (!servers.length) fail('no_sign_in_details', 'This server asks for sign-in but doesn\'t say how. Paste a key or token if it gives you one.')
  // The first server it names (keeping separate state per server is the flow's job).
  const issuer = servers[0]
  checkEndpoint(issuer, { devOrigins })
  let meta = null
  for (const url of serverMetadataUrls(issuer)) {
    meta = await getJson(fetch, url)
    if (meta) break
  }
  if (!meta) fail('no_sign_in_details', 'Couldn\'t read this server\'s sign-in details. Try again later.')
  if (meta.issuer !== issuer) fail('sign_in_unsafe', UNSAFE)
  const methods = stringList(meta.code_challenge_methods_supported)
  if (!methods.includes('S256')) fail('no_pkce', NOT_STANDARD)
  const responseTypes = stringList(meta.response_types_supported)
  if (responseTypes.length && !responseTypes.includes('code')) fail('no_pkce', NOT_STANDARD)
  const server = {
    issuer,
    authorizationEndpoint: checkEndpoint(meta.authorization_endpoint, { devOrigins }),
    tokenEndpoint: checkEndpoint(meta.token_endpoint, { devOrigins }),
    ...(meta.registration_endpoint && { registrationEndpoint: checkEndpoint(meta.registration_endpoint, { devOrigins }) }),
    ...(meta.revocation_endpoint && { revocationEndpoint: checkEndpoint(meta.revocation_endpoint, { devOrigins }) }),
    issParameter: meta.authorization_response_iss_parameter_supported === true,
    cimd: meta.client_id_metadata_document_supported === true,
    authMethods: stringList(meta.token_endpoint_auth_methods_supported),
    offlineAccess: stringList(meta.scopes_supported, 64).includes('offline_access'),
  }
  return {
    resource: prm.resource,
    issuer,
    server,
    scopes: { challenge: scopeList(challenge?.scope), resource: stringList(prm.scopes_supported, 64) },
  }
}

const originOf = (url) => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** The MCP server origins a provider's sign-in may be sent to: the known provider's, plus settings' own. */
export function resourcesOf(provider, app = {}) {
  const known = KNOWN_PROVIDERS[provider]
  return [...new Set([...(known?.resources || []), ...(Array.isArray(app?.resources) ? app.resources : [])].map(originOf).filter(Boolean))]
}

/**
 * The pre-registered app for an issuer, from settings (an exact issuer match), or null. With
 * `resource` (the server being invited), the app also has to be allowed to serve that server:
 * → the app, or { refused: name } when the issuer is the app's but the server is not one of its.
 */
export function appFor(issuer, apps = {}, resource = undefined) {
  for (const [provider, app] of Object.entries(apps || {})) {
    if (!app || typeof app.clientId !== 'string' || !app.clientId) continue
    const known = KNOWN_PROVIDERS[provider]
    const appIssuer = known?.issuer || (typeof app.issuer === 'string' ? app.issuer : null)
    if (appIssuer && appIssuer === issuer) {
      if (resource !== undefined && !resourcesOf(provider, app).includes(originOf(resource))) return { refused: known?.name || provider }
      return {
        provider,
        clientId: app.clientId,
        ...(typeof app.clientSecret === 'string' && app.clientSecret && { clientSecret: app.clientSecret }),
        scopes: stringList(app.scopes).length ? stringList(app.scopes) : [...(known?.scopes || [])],
        tokenAccept: known?.tokenAccept || 'application/json',
        name: known?.name || provider,
      }
    }
  }
  return null
}

/**
 * What a sign-in lets Slatebox do, in plain words, for the consent screen. Known scopes are named;
 * anything else is shown as the server's scope names.
 */
const SCOPE_WORDS = Object.freeze({
  public_repo: 'read and change your public repositories (code, issues and pull requests)',
  repo: 'read and change all your repositories, private ones too (code, issues, pull requests and settings)',
  'read:org': 'see which organisations you belong to',
  'read:user': 'read your profile',
})
export function reachOf(scopes = []) {
  const words = scopes.filter((s) => s !== 'offline_access').map((s) => SCOPE_WORDS[s] || null)
  if (!words.length) return ''
  if (words.some((w) => w === null)) return `It asks for: ${scopes.filter((s) => s !== 'offline_access').join(', ')}.`
  const list = words.length > 1 ? words.slice(0, -1).join(', ') + ' and ' + words.at(-1) : words[0]
  return `It lets Slatebox ${list}.`
}

/** The known provider an issuer belongs to (for its name and the fact that it needs an app), or null. */
export const knownProvider = (issuer) => Object.entries(KNOWN_PROVIDERS).find(([, p]) => p.issuer === issuer)?.[0] || null

/** The scopes asked for: the app's own; else the challenge's (narrowed to what the resource lists); else the resource's list. */
export function chooseScopes({ app, scopes, server }) {
  let list
  if (app?.scopes?.length) list = [...app.scopes]
  else if (scopes.challenge.length) list = scopes.resource.length ? scopes.challenge.filter((s) => scopes.resource.includes(s)) : [...scopes.challenge]
  else list = [...scopes.resource]
  if (!list.length && scopes.challenge.length) list = [...scopes.challenge]
  if (!app && server.offlineAccess && !list.includes('offline_access')) list.push('offline_access')
  return [...new Set(list)].slice(0, OAUTH_LIMITS.scopes)
}

/** Slatebox's Client ID Metadata Document, served at <origin>/oauth/mcp-client.json. */
export function clientDocument(origin) {
  const base = String(origin).replace(/\/+$/, '')
  return {
    client_id: base + CLIENT_DOCUMENT_PATH,
    client_name: 'Slatebox',
    client_uri: 'https://slatebox.com',
    redirect_uris: [base + CALLBACK_PATH],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
  }
}

export const redirectUriFor = (origin) => String(origin).replace(/\/+$/, '') + CALLBACK_PATH
export const cimdUsable = (origin) => /^https:\/\//.test(String(origin))

/**
 * Step 5: how Slatebox identifies itself to this server, in priority order.
 * → { kind: 'preregistered'|'cimd'|'dcr'|'pasted', clientId?, clientSecret?, app? } or
 *   { kind: 'needs_client_id' } (the person must paste one).
 */
export function chooseRegistration({ server, apps, origin, pastedClientId = null, resource = undefined }) {
  const app = appFor(server.issuer, apps, resource)
  // A server naming a pre-registered provider's sign-in for itself: its token would go to that server.
  if (app?.refused) fail('sign_in_unsafe', `This server asks for your ${app.refused} sign-in, but Slatebox only sends ${app.refused} sign-ins to ${app.refused}'s own server.`)
  if (app) return { kind: 'preregistered', clientId: app.clientId, ...(app.clientSecret && { clientSecret: app.clientSecret }), app }
  if (pastedClientId) return { kind: 'pasted', clientId: pastedClientId }
  if (server.cimd && cimdUsable(origin)) return { kind: 'cimd', clientId: clientDocument(origin).client_id }
  if (server.registrationEndpoint) return { kind: 'dcr' }
  return { kind: 'needs_client_id' }
}

/** Dynamic Client Registration (RFC 7591), application_type "web", public client. */
export async function registerClient({ server, origin, fetch }) {
  const body = JSON.stringify({
    client_name: 'Slatebox',
    client_uri: 'https://slatebox.com',
    redirect_uris: [redirectUriFor(origin)],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
  })
  let response
  try {
    response = await fetch(server.registrationEndpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body })
  } catch (error) {
    if (error instanceof McpFetchRefused) fail('registration_failed', 'Slatebox couldn\'t register with this server. Paste a client id if it gives you one.')
    throw error
  }
  const json = response.ok || response.status === 201 ? await readJson(response) : (await response.body?.cancel?.().catch(() => {}), null)
  if (!json || typeof json.client_id !== 'string' || !json.client_id || json.client_id.length > 500)
    fail('registration_failed', 'Slatebox couldn\'t register with this server. Paste a client id if it gives you one.')
  return {
    clientId: json.client_id,
    ...(typeof json.client_secret === 'string' && json.client_secret && { clientSecret: json.client_secret }),
  }
}

/** Step 6: the address the sign-in popup is sent to. */
export function authorizationUrl({ server, clientId, redirectUri, challenge, state, resource, scopes }) {
  const url = new URL(server.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('resource', resource)
  if (scopes?.length) url.searchParams.set('scope', scopes.join(' '))
  return url.href
}

/**
 * Step 7: the callback's query, checked against the flow it claims. Returns { code } or throws.
 * flow: { issuer, issParameter, expiresAt }. The state was already matched (single use) by the caller.
 */
export function checkCallback(query, flow, now = Date.now()) {
  if (!flow) fail('unverified', UNVERIFIED)
  if (flow.expiresAt && now > new Date(flow.expiresAt).getTime()) fail('expired', 'That sign-in took too long. Sign in again.')
  const iss = typeof query.iss === 'string' ? query.iss : null
  // RFC 9207: compared exactly whenever present (error answers included), required when promised.
  if (iss !== null && iss !== flow.issuer) fail('unverified', UNVERIFIED)
  if (iss === null && flow.issParameter) fail('unverified', UNVERIFIED)
  if (typeof query.error === 'string') {
    if (query.error === 'access_denied') fail('cancelled', 'Sign-in was cancelled.')
    fail('denied', 'The server didn\'t finish the sign-in. Try again.')
  }
  if (typeof query.code !== 'string' || !query.code || query.code.length > 2000) fail('unverified', UNVERIFIED)
  return { code: query.code }
}

/** A token answer, checked: a bearer access token, its lifetime and an optional refresh token. */
export function tokenResult(json, now = Date.now()) {
  if (!json || typeof json !== 'object') return null
  if (typeof json.error === 'string') return { error: json.error === 'invalid_grant' ? 'invalid_grant' : 'token_error' }
  const access = json.access_token
  if (typeof access !== 'string' || !access || access.length > OAUTH_LIMITS.tokenChars || /\s/.test(access)) return null
  if (json.token_type && String(json.token_type).toLowerCase() !== 'bearer') return null
  const refresh = typeof json.refresh_token === 'string' && json.refresh_token.length <= OAUTH_LIMITS.tokenChars ? json.refresh_token : null
  const lifetime = Number(json.expires_in)
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: Number.isFinite(lifetime) && lifetime > 0 ? now + Math.min(lifetime, 365 * 86400) * 1000 : null,
    scopes: scopeList(json.scope),
  }
}

function clientAuth({ clientId, clientSecret }, params) {
  // A secret (a pre-registered app, or one a registration returned) goes in the body
  // (client_secret_post): every vendor in the gallery accepts it.
  params.set('client_id', clientId)
  if (clientSecret) params.set('client_secret', clientSecret)
}

async function tokenRequest({ server, client, params, fetch, accept = 'application/json' }) {
  clientAuth(client, params)
  let response
  try {
    response = await fetch(server.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept },
      body: params.toString(),
    })
  } catch (error) {
    if (error instanceof McpFetchRefused) return { error: 'unreachable' }
    throw error
  }
  const json = await readJson(response, 32 * 1024).catch(() => null)
  const result = tokenResult(json)
  if (!result) return { error: response.ok ? 'token_error' : response.status === 400 || response.status === 401 ? 'invalid_grant' : 'token_error' }
  return result
}

/** Step 8: the code for tokens, with the verifier and the resource. */
export function exchangeCode({ server, client, code, verifier, redirectUri, resource, fetch, accept }) {
  const params = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, resource })
  return tokenRequest({ server, client, params, fetch, accept })
}

/** A refresh, with the resource (the caller holds the lease). */
export function refreshTokens({ server, client, refreshToken, resource, scopes, fetch, accept }) {
  const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, resource })
  if (scopes?.length) params.set('scope', scopes.join(' '))
  return tokenRequest({ server, client, params, fetch, accept })
}

/** Revocation (RFC 7009) when the server offers it. Best effort: never throws. */
export async function revokeToken({ server, client, token, hint, fetch }) {
  if (!server?.revocationEndpoint || !token) return false
  const params = new URLSearchParams({ token, ...(hint && { token_type_hint: hint }) })
  clientAuth(client, params)
  try {
    const response = await fetch(server.revocationEndpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() })
    await response.body?.cancel?.().catch(() => {})
    return response.ok
  } catch {
    return false
  }
}
