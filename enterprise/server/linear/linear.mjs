// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Linear for recipes: one click to connect (Connect, Authorize on Linear, done), through the public
// Linear OAuth app Slatebox registers once (Admin › Integration apps › Linear: client id, client
// secret and the webhook signing secret). Recipes read Linear's GraphQL API as the person who set
// them up (actor=user, their own rights in Linear) with a token that lasts a day and a refresh token
// that rotates; both are sealed in the vault (credentials.mjs, address linear://workspace), renewed
// under its lease, so two server processes never spend one refresh token twice.
//
// This is not the Linear card in the agents gallery: that one is Linear's MCP server, for chat on a
// slate. Recipes run with nobody present, so they need a grant that keeps working (Linear's own
// guidance: the API, not MCP, for headless work).
//
// Scopes: read (every recipe), issues:create (create and update issues: a recipe's state write-back)
// and comments:create (its optional comment). Never write or admin. A write still needs the person's
// standing permission per recipe, or their approval on a card (enterprise/server/recipes/permissions.mjs).
import { SignInProblem, tokenResult } from '../oauth.mjs'

export const LINEAR_ADDRESS = 'linear://workspace'
export const LINEAR_ISSUER = 'https://linear.app'
export const LINEAR_HOSTS = Object.freeze(['linear.app', 'api.linear.app'])
export const LINEAR_ENDPOINTS = Object.freeze({
  authorize: 'https://linear.app/oauth/authorize',
  token: 'https://api.linear.app/oauth/token',
  revoke: 'https://api.linear.app/oauth/revoke',
  graphql: 'https://api.linear.app/graphql',
})
export const LINEAR_SCOPES = Object.freeze(['read', 'issues:create', 'comments:create'])
// Scopes Slatebox never keeps: a grant holding one is refused and revoked.
const TOO_WIDE = new Set(['write', 'admin', 'oauth:create', 'customer:write', 'initiative:write'])
const ID = /^[0-9a-f-]{8,64}$/i
const URL_KEY = /^[a-z0-9-]{1,64}$/i

export class LinearRefused extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}
const refuse = (status, code, message) => {
  throw new LinearRefused(status, code, message)
}
const failSignIn = (code, message) => {
  throw new SignInProblem(code, message)
}

/** Linear answers its scopes as one string (spaces or commas), or a list from older apps. */
export const linearScopes = (raw) => (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : []).map((s) => String(s).trim()).filter(Boolean)

/** Only Linear's own hosts, https (a development fake's origin when listed). */
export function linearOnlyFetch(fetch, { devOrigins = [] } = {}) {
  return (input, init) => {
    let url
    try {
      url = new URL(String(input))
    } catch {
      throw new LinearRefused(400, 'blocked', 'That is not a Linear address.')
    }
    const linear = url.protocol === 'https:' && LINEAR_HOSTS.includes(url.hostname)
    if (!linear && !devOrigins.includes(url.origin)) throw new LinearRefused(400, 'blocked', 'That is not a Linear address.')
    return fetch(url.href, init)
  }
}

/** The sign-in address on Linear's own page: the person's own rights (actor=user), the three scopes. */
export function linearAuthorizeUrl({ clientId, state, redirectUri, endpoints = LINEAR_ENDPOINTS }) {
  return `${endpoints.authorize}?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: LINEAR_SCOPES.join(','), state, actor: 'user', prompt: 'consent' })}`
}

/**
 * deps: { vault, accounts { get(userId), put(doc), remove(userId) }, signIn (signin.mjs), fetch
 *         (linearOnlyFetch over the guarded fetch), apps() → { linear: { clientId, clientSecret,
 *         signingSecret } }, enabled() → bool, endpoints, audit, now }
 */
export function createLinearService({ vault, accounts, signIn, fetch, apps, enabled = async () => true, endpoints = LINEAR_ENDPOINTS, audit = () => {}, now = Date.now }) {
  const appOf = async () => ((await apps()) || {}).linear || null

  async function requirePerson(principal) {
    if (!principal?.userId || principal.kind === 'guest' || principal.kind === 'visitor') refuse(401, 'sign_in', 'Save your account to connect Linear.')
  }

  async function post(url, params, headers = {}) {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', ...headers }, body: new URLSearchParams(params).toString() })
    const text = await response.text().catch(() => '')
    let json = null
    try {
      json = text && text.length <= 32 * 1024 ? JSON.parse(text) : null
    } catch {}
    return { status: response.status, ok: response.ok, json }
  }

  async function revokeQuietly(token, app) {
    if (!token) return
    await post(endpoints.revoke, { token, token_type_hint: 'access_token', client_id: app?.clientId || '', ...(app?.clientSecret && { client_secret: app.clientSecret }) }, { authorization: `Bearer ${token}` }).catch(() => {})
  }

  /** Whether Linear works here and for this person: never a token. */
  async function status(principal) {
    await requirePerson(principal)
    const app = await appOf()
    const row = await accounts.get(principal.userId)
    return {
      enabled: await enabled(),
      configured: Boolean(app?.clientId && app?.clientSecret && vault?.available?.()),
      connected: Boolean(row && row.status === 'active'),
      scopes: [...LINEAR_SCOPES],
      workspace: row?.organizationName || null,
      ...(row && { status: row.status }),
    }
  }

  /** Connect: a sign-in on Linear's own page (one click: Authorize). → { flowId, authHost } for the popup. */
  async function connect(principal) {
    await requirePerson(principal)
    if (!(await enabled())) refuse(403, 'disabled', 'Linear is turned off on this server.')
    const app = await appOf()
    if (!app?.clientId || !app?.clientSecret) refuse(422, 'not_configured', 'Linear is not set up on this server yet. An admin adds it in Admin › Integration apps.')
    if (!vault?.available?.()) refuse(422, 'vault_off', 'Linear needs the server\'s key-encryption key, which is not set.')
    try {
      return await signIn.startNative({ userId: principal.userId, kind: 'linear', issuer: LINEAR_ISSUER, authorize: (state, redirectUri) => linearAuthorizeUrl({ clientId: app.clientId, state, redirectUri, endpoints }) })
    } catch (error) {
      if (error instanceof SignInProblem) refuse(422, error.code, error.message)
      throw error
    }
  }

  /** Who the token is: the person in Linear and their workspace (one GraphQL call). */
  async function viewerOf(token) {
    const response = await fetch(endpoints.graphql, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ query: 'query Viewer { viewer { id name organization { id name urlKey } } }' }) })
    const json = await response.json().catch(() => null)
    const viewer = json?.data?.viewer
    const org = viewer?.organization
    if (!response.ok || !viewer || !ID.test(String(viewer.id || '')) || !ID.test(String(org?.id || ''))) return null
    return { linearUserId: viewer.id, organizationId: org.id, organizationName: String(org.name || 'Linear').slice(0, 80), urlKey: URL_KEY.test(String(org.urlKey || '')) ? org.urlKey : null }
  }

  /**
   * The sign-in callback's code (signin.mjs finish, for flows of kind 'linear'): exchanged at
   * Linear's token endpoint, checked (a bearer token, the scopes asked for and none wider), sealed,
   * and the person's Linear account row made or renewed. Throws SignInProblem with plain words.
   */
  async function finishInstall(flow, code) {
    const app = await appOf()
    if (!app?.clientId || !app?.clientSecret) failSignIn('not_configured', 'Linear is not set up on this server yet.')
    let answer
    try {
      answer = await post(endpoints.token, { grant_type: 'authorization_code', code, redirect_uri: flow.redirectUri, client_id: app.clientId, client_secret: app.clientSecret })
    } catch {
      failSignIn('token_failed', 'Couldn\'t reach Linear. Try again in a minute.')
    }
    const tokens = answer.ok ? tokenResult(answer.json, now()) : null
    if (!tokens || tokens.error || !tokens.accessToken) failSignIn('token_failed', 'Linear didn\'t finish the sign-in. Try again.')
    const scopes = linearScopes(answer.json.scope)
    const granted = scopes.length ? scopes : ['read']
    if (!granted.includes('read')) {
      await revokeQuietly(tokens.accessToken, app)
      failSignIn('scope_missing', 'Linear didn\'t allow reading. Connect again and allow it.')
    }
    if (granted.some((s) => TOO_WIDE.has(s))) {
      await revokeQuietly(tokens.accessToken, app)
      failSignIn('scope_wrong', 'Linear granted more access than Slatebox asks for, so Slatebox did not keep it.')
    }
    const who = await viewerOf(tokens.accessToken).catch(() => null)
    if (!who) {
      await revokeQuietly(tokens.accessToken, app)
      failSignIn('token_failed', 'Linear didn\'t say which workspace this is. Try again.')
    }
    await vault.save({
      userId: flow.userId,
      address: LINEAR_ADDRESS,
      resource: null,
      issuer: LINEAR_ISSUER,
      kind: 'oauth',
      registration: { kind: 'preregistered', provider: 'linear', clientId: app.clientId },
      server: { issuer: LINEAR_ISSUER, tokenEndpoint: endpoints.token, revocationEndpoint: endpoints.revoke, noResource: true },
      tokens: { ...tokens, scopes: granted },
    })
    const at = new Date(now())
    const before = await accounts.get(flow.userId)
    await accounts.put({ _id: flow.userId, ownerId: flow.userId, ...who, scopes: granted, status: 'active', connectedAt: before?.connectedAt || at, updatedAt: at })
    audit({ action: 'linear.connected', userId: flow.userId, organizationId: who.organizationId })
    return { host: 'linear.app' }
  }

  /** Disconnect: the grant ended at Linear (best effort) and forgotten here. Recipes needing it wait for Connect. */
  async function disconnect(principal) {
    await requirePerson(principal)
    const removed = await vault.remove(principal.userId, LINEAR_ADDRESS)
    await accounts.remove(principal.userId)
    audit({ action: 'linear.disconnected', userId: principal.userId })
    return { disconnected: true, revoked: Boolean(removed?.revoked) }
  }

  /** A removed account, or Linear saying the app was revoked: forgotten without asking Linear again. */
  async function forgetPerson(userId, { revoke = true } = {}) {
    await vault.remove(userId, LINEAR_ADDRESS, { revoke }).catch(() => {})
    await accounts.remove(userId).catch(() => {})
  }

  /** Linear said the app was revoked for a workspace: every person there signs in again. */
  async function revokedFor(organizationId) {
    if (!ID.test(String(organizationId || ''))) return 0
    const rows = await accounts.inOrganization(organizationId)
    for (const row of rows) {
      await vault.remove(row.ownerId, LINEAR_ADDRESS, { revoke: false }).catch(() => {})
      await accounts.put({ ...row, status: 'needs_sign_in', updatedAt: new Date(now()) })
    }
    return rows.length
  }

  return { status, connect, finishInstall, disconnect, forgetPerson, revokedFor, signingSecret: async () => (await appOf())?.signingSecret || null }
}
