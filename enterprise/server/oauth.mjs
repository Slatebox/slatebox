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

// What Slatebox asks Slack for: exactly what the Slack card's features call, nothing more (the
// Slack app's User Token Scopes must list these same 14: docs/slack-app-manifest.json).
// Slack's MCP metadata lists 30, more than OAUTH_LIMITS.scopes, and asking for all of them cut
// the list at 24 in Slack's order, which dropped search and users:read (review, 2026-11-27).
// Each scope and the feature it serves (enterprise/common/gallery.mjs, the Slack card):
export const SLACK_SCOPES = Object.freeze([
  'canvases:read', // "Slack canvas" ask: slack_read_canvas brings a canvas onto the slate
  'canvases:write', // "Create Slack canvas" write: slack_create_canvas, after the person approves its card
  'channels:history', // "From the channel" ask: slack_read_channel (and its threads) in a public channel
  'channels:read', // finding the public channel a person names ("#launch") for a read or a post
  'chat:write', // "Post in Slack" write: slack_send_message, after the person approves its card
  'groups:history', // "From the channel" ask in a private channel the person is in
  'groups:read', // finding the private channel a person names
  'im:history', // reading a direct message a search found, as the person who is in it
  'mpim:history', // reading a group direct message a search found, as a person who is in it
  'search:read.public', // "From Slack" ask (slack_search_public), and About you's `from:me` look-around
  'search:read.private', // "From Slack" ask over private channels (slack_search_public_and_private)
  'search:read.im', // the same search over the person's own direct messages
  'search:read.mpim', // the same search over the person's group direct messages
  'users:read', // About you's look-around (slack_read_user_profile), and naming who said what
])

// Apps Slatebox registers with a vendor ahead of time (vendors with no CIMD and no DCR). The
// client id and secret come from Admin › Integration apps (integration-apps.mjs, the secret sealed)
// or settings.connectors.oauthApps.<provider>, never from code.
//
// `revoke`: how Disconnect ends a sign-in at the vendor when its metadata names no
// revocation_endpoint (a metadata endpoint, RFC 7009, always wins), each from the vendor's own
// documentation (metadata probed 2026-11-27). Also the fallback for sign-ins saved before
// Slatebox stored an endpoint (revocationOf). style says how its answer is read:
//   (none)   RFC 7009: a form POST of the token with the client's credentials; a 2xx is success
//   slack    auth.revoke: a form POST of the token; Slack answers 200 even when it fails, so only
//            {"ok":true} is success
//   zoom     a form POST with the client in an Authorization header; only {"status":"success"} is success
//   github   DELETE /applications/{client_id}/token with the client as Basic auth and the access
//            token in a JSON body; only 204 is success (OAuth apps issue no refresh token)
// `revoke: null`: the vendor has no endpoint that ends one sign-in (Microsoft Entra), so Disconnect
// says the person may remove Slatebox's access in their account settings.
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
    // which organizations the person belongs to. Nothing private, no profile email, packages,
    // gists or notifications. settings.connectors.oauthApps.github.scopes may widen it (e.g.
    // "repo" for private repositories) on purpose; the consent screen then says so (reachOf).
    scopes: Object.freeze(['public_repo', 'read:org']),
    // GitHub's token endpoint answers form-encoded unless asked for JSON.
    tokenAccept: 'application/json',
    revoke: Object.freeze({ url: 'https://api.github.com/applications/{client_id}/token', style: 'github' }),
  }),
  // The vendors below offer no open automatic registration (no DCR anyone may use, no Client ID
  // Metadata Document; Salesforce's registration endpoint needs an initial access token), so an
  // operator registers one app with each and gives Slatebox its client id and secret
  // (settings.connectors.oauthApps.<provider>; docs/integrations.md says how). Their issuers and the
  // only MCP servers their sign-ins are sent to are fixed here, from each vendor's own metadata
  // (probed 2026-11-26), so settings carry the client only. With no `scopes`, a sign-in asks for what
  // the server's challenge or metadata names (or the provider's own `scopes`, or `scopesFor` its server: the least it needs).
  // Exceptions to the standard steps, each a documented fact of that vendor, never a setting:
  //   metadataIssuer  the issuer its metadata document states, when it is not the protected resource
  //                   metadata's spelling exactly (a trailing slash; Microsoft's {tenantid} template)
  //   pkce            'documented': PKCE S256 works though the metadata does not say so (Microsoft)
  //   resourceParam   false: its token service refuses RFC 8707 `resource` (Microsoft identity v2)
  //   tokenAuth       'basic': the client secret goes in an Authorization header (Zoom accepts nothing else)
  //   authorizeParams fixed extra words on the sign-in address (Google: a refresh token needs offline access)
  // Slack: the explicit list above, never the metadata's 30 (settings' `scopes` may still change it
  // on purpose, and then the Slack app has to list the same scopes).
  slack: Object.freeze({
    issuer: 'https://mcp.slack.com',
    name: 'Slack',
    resources: Object.freeze(['https://mcp.slack.com']),
    scopes: SLACK_SCOPES,
    revoke: Object.freeze({ url: 'https://slack.com/api/auth.revoke', style: 'slack' }),
  }),
  asana: Object.freeze({ issuer: 'https://app.asana.com', name: 'Asana', resources: Object.freeze(['https://mcp.asana.com']), revoke: Object.freeze({ url: 'https://app.asana.com/-/oauth_revoke' }) }),
  hubspot: Object.freeze({ issuer: 'https://mcp.hubspot.com', name: 'HubSpot', resources: Object.freeze(['https://mcp.hubspot.com']), revoke: Object.freeze({ url: 'https://mcp.hubspot.com/oauth/v3/token/revoke' }) }),
  box: Object.freeze({ issuer: 'https://api.box.com/', metadataIssuer: 'https://api.box.com', name: 'Box', resources: Object.freeze(['https://mcp.box.com']), revoke: Object.freeze({ url: 'https://api.box.com/oauth2/revoke' }) }),
  // Zoom's metadata lists every scope its server has, writes and deletes included (meetings, docs,
  // workflows), and its challenge names none: the card reads, so it asks for the read scopes only.
  zoom: Object.freeze({
    issuer: 'https://zoom.us',
    name: 'Zoom',
    resources: Object.freeze(['https://mcp.zoom.us']),
    scopesFor: Object.freeze({
      'https://mcp.zoom.us': Object.freeze(['meeting:read:search', 'meeting:read:assets', 'cloud_recording:read:content', 'cloud_recording:read:list_user_recordings',
        'my_notes:read:content', 'hub:read:content', 'agentic_search:read:search', 'agentic_search:read:ask']),
    }),
    tokenAuth: 'basic',
    revoke: Object.freeze({ url: 'https://zoom.us/oauth/revoke', style: 'zoom' }),
  }),
  pitch: Object.freeze({ issuer: 'https://auth.pitch.com/', name: 'Pitch', resources: Object.freeze(['https://mcp.pitch.com']), revoke: Object.freeze({ url: 'https://auth.pitch.com/oauth/revoke' }) }),
  salesforce: Object.freeze({ issuer: 'https://login.salesforce.com', name: 'Salesforce', resources: Object.freeze(['https://api.salesforce.com']), revoke: Object.freeze({ url: 'https://login.salesforce.com/services/oauth2/revoke' }) }),
  // Microsoft's own remote MCP servers (Work IQ for Microsoft 365, the Entra directory server, Azure
  // DevOps): one multi-tenant Entra app, which each tenant's administrator consents to.
  microsoft: Object.freeze({
    issuer: 'https://login.microsoftonline.com/organizations/v2.0',
    metadataIssuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
    name: 'Microsoft',
    resources: Object.freeze(['https://workiq.svc.cloud.microsoft', 'https://mcp.svc.cloud.microsoft', 'https://mcp.dev.azure.com']),
    // Each server's own permission as its metadata names it. Work IQ has one, WorkIQAgent.Ask, which
    // reads and writes (mail, events, files): its write tools start off (the card's recipe.tools).
    // offline_access: Entra issues no refresh token without it.
    scopesFor: Object.freeze({
      'https://workiq.svc.cloud.microsoft': Object.freeze(['fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask', 'offline_access']),
      'https://mcp.svc.cloud.microsoft': Object.freeze(['api://e8c77dc2-69b3-43f4-bc51-3213c9d915b4/.default', 'offline_access']),
      'https://mcp.dev.azure.com': Object.freeze(['https://mcp.dev.azure.com/.default', 'offline_access']),
    }),
    pkce: 'documented',
    resourceParam: false,
    // Entra has no endpoint that ends one sign-in (only an administrator's revokeSignInSessions,
    // which signs the person out of everything): the person removes Slatebox's access themselves.
    revoke: null,
  }),
  // Google Workspace's own remote MCP servers: one Google Cloud OAuth client for all of them. Read-only
  // scopes by default; `scopes` in settings widens them on purpose (drafts, events).
  google: Object.freeze({
    issuer: 'https://accounts.google.com/',
    metadataIssuer: 'https://accounts.google.com',
    name: 'Google',
    resources: Object.freeze(['https://gmailmcp.googleapis.com', 'https://calendarmcp.googleapis.com', 'https://docsmcp.googleapis.com', 'https://sheetsmcp.googleapis.com',
      'https://chatmcp.googleapis.com', 'https://drivemcp.googleapis.com', 'https://slidesmcp.googleapis.com', 'https://tasksmcp.googleapis.com']),
    scopesFor: Object.freeze({
      'https://gmailmcp.googleapis.com': Object.freeze(['https://www.googleapis.com/auth/gmail.readonly']),
      'https://calendarmcp.googleapis.com': Object.freeze(['https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events.readonly']),
      'https://docsmcp.googleapis.com': Object.freeze(['https://www.googleapis.com/auth/documents.readonly', 'https://www.googleapis.com/auth/drive.readonly']),
      'https://sheetsmcp.googleapis.com': Object.freeze(['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.readonly']),
      'https://chatmcp.googleapis.com': Object.freeze(['https://www.googleapis.com/auth/chat.spaces.readonly', 'https://www.googleapis.com/auth/chat.messages.readonly']),
      'https://drivemcp.googleapis.com': Object.freeze(['https://www.googleapis.com/auth/drive.readonly']),
      'https://slidesmcp.googleapis.com': Object.freeze(['https://www.googleapis.com/auth/presentations.readonly', 'https://www.googleapis.com/auth/drive.readonly']),
      'https://tasksmcp.googleapis.com': Object.freeze(['https://www.googleapis.com/auth/tasks.readonly']),
    }),
    authorizeParams: Object.freeze({ access_type: 'offline', prompt: 'consent' }),
    revoke: Object.freeze({ url: 'https://oauth2.googleapis.com/revoke' }),
  }),
})

/** The known provider an issuer (as the protected resource metadata names it) belongs to, or null. */
const knownOf = (issuer) => Object.values(KNOWN_PROVIDERS).find((p) => p.issuer === issuer) || null

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
  // A known provider's metadata may spell its issuer its own documented way (KNOWN_PROVIDERS), never any other.
  const known = knownOf(issuer)
  if (meta.issuer !== issuer && !(known?.metadataIssuer && meta.issuer === known.metadataIssuer)) fail('sign_in_unsafe', UNSAFE)
  const methods = stringList(meta.code_challenge_methods_supported)
  // S256 advertised, or (a known provider that documents PKCE but does not advertise it) nothing advertised at all.
  if (!methods.includes('S256') && !(known?.pkce === 'documented' && !methods.length)) fail('no_pkce', NOT_STANDARD)
  const responseTypes = stringList(meta.response_types_supported)
  if (responseTypes.length && !responseTypes.includes('code')) fail('no_pkce', NOT_STANDARD)
  const server = {
    issuer,
    authorizationEndpoint: checkEndpoint(meta.authorization_endpoint, { devOrigins }),
    tokenEndpoint: checkEndpoint(meta.token_endpoint, { devOrigins }),
    ...(meta.registration_endpoint && { registrationEndpoint: checkEndpoint(meta.registration_endpoint, { devOrigins }) }),
    // The metadata's revocation endpoint (RFC 7009), else the known provider's documented one.
    ...(meta.revocation_endpoint
      ? { revocationEndpoint: checkEndpoint(meta.revocation_endpoint, { devOrigins }) }
      : known?.revoke && { revocationEndpoint: known.revoke.url, ...(known.revoke.style && { revocation: known.revoke.style }) }),
    issParameter: meta.authorization_response_iss_parameter_supported === true,
    cimd: meta.client_id_metadata_document_supported === true,
    authMethods: stringList(meta.token_endpoint_auth_methods_supported),
    offlineAccess: stringList(meta.scopes_supported, 64).includes('offline_access'),
    ...(known?.metadataIssuer && { metadataIssuer: known.metadataIssuer }),
    ...(known?.resourceParam === false && { noResource: true }),
    ...(known?.tokenAuth && { tokenAuth: known.tokenAuth }),
    ...(known?.authorizeParams && { authorizeParams: { ...known.authorizeParams } }),
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
        scopes: stringList(app.scopes).length ? stringList(app.scopes) : [...(known?.scopesFor?.[originOf(resource)] || known?.scopes || [])],
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
  'read:org': 'see which organizations you belong to',
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

// Servers with automatic registration whose metadata lists every scope they have, writes included,
// and whose challenge names none, by origin: the least their card needs, when the server lists it.
// PagerDuty lists about 90 (its card reads incidents, schedules and services: `read` covers them).
export const LEAST_SCOPES = Object.freeze({
  'https://mcp.pagerduty.com': Object.freeze(['read']),
})

/**
 * The scopes asked for: the app's own; else the challenge's (narrowed to what the resource lists);
 * else the least the server's card needs (LEAST_SCOPES, those the resource lists); else the resource's list.
 */
export function chooseScopes({ app, scopes, server, resource = undefined }) {
  let list
  const least = (LEAST_SCOPES[originOf(resource)] || []).filter((s) => scopes.resource.includes(s))
  if (app?.scopes?.length) list = [...app.scopes]
  else if (scopes.challenge.length) list = scopes.resource.length ? scopes.challenge.filter((s) => scopes.resource.includes(s)) : [...scopes.challenge]
  else if (least.length) list = least
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
  if (!server.noResource) url.searchParams.set('resource', resource)
  if (scopes?.length) url.searchParams.set('scope', scopes.join(' '))
  // A known provider's fixed extras (Google's offline access), never one of the words above.
  for (const [key, value] of Object.entries(server.authorizeParams || {})) if (!url.searchParams.has(key)) url.searchParams.set(key, String(value))
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
  if (iss !== null && iss !== flow.issuer && !(flow.metadataIssuer && iss === flow.metadataIssuer)) fail('unverified', UNVERIFIED)
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

function clientAuth({ clientId, clientSecret }, params, method = 'post') {
  // A secret (a pre-registered app, or one a registration returned) goes in the body
  // (client_secret_post), which every vendor in the gallery but Zoom accepts; Zoom's goes in an
  // Authorization header (client_secret_basic, RFC 6749 §2.3.1). → the extra headers
  params.set('client_id', clientId)
  if (!clientSecret) return {}
  if (method === 'basic') return { authorization: 'Basic ' + Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64') }
  params.set('client_secret', clientSecret)
  return {}
}

async function tokenRequest({ server, client, params, fetch, accept = 'application/json' }) {
  const auth = clientAuth(client, params, server.tokenAuth)
  let response
  try {
    response = await fetch(server.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept, ...auth },
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
  const params = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier })
  if (!server.noResource) params.set('resource', resource)
  return tokenRequest({ server, client, params, fetch, accept })
}

/** A refresh, with the resource (the caller holds the lease). */
export function refreshTokens({ server, client, refreshToken, resource, scopes, fetch, accept }) {
  const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
  // An MCP server's sign-in names its resource (RFC 8707); Google's own sign-in has none.
  if (resource && !server?.noResource) params.set('resource', resource)
  if (scopes?.length) params.set('scope', scopes.join(' '))
  return tokenRequest({ server, client, params, fetch, accept })
}

/**
 * How a sign-in is ended at its server: the endpoint saved with it (from the metadata, or a known
 * provider's at sign-in), else the known provider's (a sign-in saved before Slatebox kept one).
 * → { url, style } or null (the server offers none).
 */
export function revocationOf(server) {
  if (!server || typeof server !== 'object') return null
  if (typeof server.revocationEndpoint === 'string' && server.revocationEndpoint) return { url: server.revocationEndpoint, style: server.revocation || 'rfc7009' }
  const known = knownOf(server.issuer)?.revoke
  return known ? { url: known.url, style: known.style || 'rfc7009' } : null
}

async function answerOf(response) {
  try {
    const text = await response.text()
    return text.length <= 8192 ? JSON.parse(text) : null
  } catch {
    return null
  }
}

/**
 * Ends one token at its server (revocationOf), reading the vendor's own way of saying it worked.
 * Best effort: never throws, never logs. → true only when the server confirmed it.
 */
export async function revokeToken({ server, client, token, hint, fetch }) {
  const revocation = revocationOf(server)
  if (!revocation || !token) return false
  try {
    if (revocation.style === 'github') {
      // OAuth apps have access tokens only, and GitHub needs the app's own secret to end one.
      if (hint === 'refresh_token' || !client?.clientId || !client?.clientSecret) return false
      const response = await fetch(revocation.url.replace('{client_id}', encodeURIComponent(client.clientId)), {
        method: 'DELETE',
        headers: {
          authorization: 'Basic ' + Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64'),
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({ access_token: token }),
      })
      await response.body?.cancel?.().catch(() => {})
      return response.status === 204
    }
    const params = new URLSearchParams({ token })
    let auth = {}
    // Slack's auth.revoke takes the token alone (it is its own proof); every other style names the client.
    if (revocation.style !== 'slack') {
      if (hint) params.set('token_type_hint', hint)
      auth = clientAuth(client, params, revocation.style === 'zoom' ? 'basic' : server.tokenAuth)
    }
    const response = await fetch(revocation.url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...auth }, body: params.toString() })
    if (revocation.style === 'slack') return response.ok && (await answerOf(response))?.ok === true
    if (revocation.style === 'zoom') return response.ok && (await answerOf(response))?.status === 'success'
    await response.body?.cancel?.().catch(() => {})
    return response.ok
  } catch {
    return false
  }
}
