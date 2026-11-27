// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// A person signing in to an outside agent's server, in a popup, without Meteor:
//
//   plan    what signing in takes (read from the server's own metadata, every check in oauth.mjs)
//   start   a sign-in flow for one person and one address: PKCE verifier (sealed), a single-use
//           state, the registration (pre-registered app, CIMD, DCR or a pasted client id).
//           → a flow id. Nothing a token holder could forward: no address to open.
//   begin   the start route (POST, from the signed-in Slatebox page itself, with its login token):
//           only the person the flow belongs to may claim it, once; it is tied to this browser (an
//           HttpOnly cookie, so a callback link sent to someone else cannot finish it), and the
//           page sends its popup to the server's sign-in page. Someone sent a flow id cannot open
//           it: their browser is not signed in as the flow's owner.
//   finish  the callback route (<origin>/connectors/oauth/callback): the state is taken once, the
//           browser must be the one that began, and the one that began must be the flow's owner, `iss` is checked, the code is exchanged with the
//           verifier and the resource, and the tokens go into the vault (credentials.mjs)
//   status  the walkthrough's poll: pending, done or failed (with plain words)
//
// Flows expire after 10 minutes and are used once; a used or unknown state is refused.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { open, seal } from '/server/metering/vault.mjs'
import {
  authorizationUrl, checkCallback, chooseRegistration, chooseScopes, discoverSignIn, exchangeCode, knownProvider, KNOWN_PROVIDERS, newState,
  OAUTH_LIMITS, parseChallenge, pkcePair, reachOf, redirectUriFor, registerClient, SignInProblem,
} from './oauth.mjs'
import { McpFetchRefused } from './mcp-fetch.mjs'

const hash = (text) => createHash('sha256').update(String(text)).digest('hex')
const sameHash = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const fail = (code, message) => {
  throw new SignInProblem(code, message)
}

export const FLOW_ID = /^f[A-Za-z0-9_-]{20,64}$/
export const KEY_PATTERN = /^[\x21-\x7e]{8,4096}$/
export const CLIENT_ID_PATTERN = /^[\x21-\x7e]{1,500}$/

/**
 * Asks the server once, with no token, and reads its sign-in challenge.
 * → { open: true } (no sign-in) | { challenge } (401 Bearer) | throws McpFetchRefused
 */
export async function probe(address, fetch) {
  const response = await fetch(address, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Slatebox', version: '1.0.0' } } }),
  })
  await response.body?.cancel?.().catch(() => {})
  if (response.status === 401) return { challenge: parseChallenge(response.headers.get('www-authenticate')) || {} }
  return { open: true, status: response.status }
}

/**
 * flows: { insert(doc), get(id), claim(id, from, set) -> doc|null (atomic status change),
 *          takeByState(stateHash) -> doc|null (atomic: 'opened' → 'used'), update(id, set) }
 * clients: { get(id), put(doc) } (automatic registrations, kept per issuer and redirect address)
 * vault: credentials.mjs; master: the app's master key; fetch: the sign-in fetch (GET allowed, no redirects)
 * apps(): the pre-registered apps (settings.connectors.oauthApps with Admin › Integration apps on top,
 *   integration-apps.mjs), or a promise of them: asked again on every plan, start and callback
 * origin(): this Slatebox's own origin
 */
export function createSignIn({ flows, clients, vault, master, fetch, apps = () => ({}), origin, devOrigins = [], now = Date.now, random = randomBytes }) {
  const sealed = (owner, text) => seal({ master, owner, plaintext: text })
  const opened = (owner, cipher) => open({ master, owner, cipher })
  const flowOwner = (flow) => ({ ownerType: 'mcp-flow', ownerId: flow.userId, provider: flow._id })
  const clientOwner = (issuer) => ({ ownerType: 'mcp-client', ownerId: issuer, provider: redirectUriFor(origin()) })

  async function discoverFor(address, challenge) {
    try {
      return await discoverSignIn({ address, challenge, fetch, devOrigins })
    } catch (error) {
      if (error instanceof McpFetchRefused) fail('sign_in_unsafe', 'This server\'s sign-in details point somewhere Slatebox won\'t go.')
      throw error
    }
  }

  /** What signing in to this address takes, in words the walkthrough shows. */
  async function plan({ address, challenge }) {
    if (!vault.available()) fail('vault_off', 'Agents that need sign-in are not available on this server.')
    const found = await discoverFor(address, challenge)
    const registration = chooseRegistration({ server: found.server, apps: await apps(), origin: origin(), resource: found.resource })
    const provider = knownProvider(found.issuer)
    let authHost = ''
    let sendsTo = ''
    try {
      authHost = new URL(found.server.authorizationEndpoint).host
      sendsTo = new URL(found.resource).host
    } catch {}
    const scopes = chooseScopes({ app: registration.app, scopes: found.scopes, server: found.server, resource: found.resource })
    return {
      method: 'oauth',
      authHost,
      // Where what the sign-in issues is sent: always the invited server itself (shown beside the sign-in host).
      sendsTo,
      reach: reachOf(scopes),
      provider: provider ? KNOWN_PROVIDERS[provider].name : null,
      registration: registration.kind,
      needsClientId: registration.kind === 'needs_client_id',
      scopes,
    }
  }

  async function dcrClient(server) {
    const id = hash(`${server.issuer}\n${redirectUriFor(origin())}`)
    const cached = await clients.get(id)
    if (cached?.clientId && cached.issuer === server.issuer) {
      return { clientId: cached.clientId, ...(cached.clientSecret && { clientSecret: opened(clientOwner(server.issuer), cached.clientSecret) }) }
    }
    const registered = await registerClient({ server, origin: origin(), fetch })
    await clients.put({
      _id: id,
      issuer: server.issuer,
      redirectUri: redirectUriFor(origin()),
      clientId: registered.clientId,
      clientSecret: registered.clientSecret ? sealed(clientOwner(server.issuer), registered.clientSecret) : null,
      createdAt: new Date(now()),
    })
    return registered
  }

  /** A sign-in flow for this person and address. → { flowId, authHost } */
  async function start({ userId, address, challenge, clientId: pasted = null }) {
    if (!vault.available()) fail('vault_off', 'Agents that need sign-in are not available on this server.')
    if (pasted !== null && (typeof pasted !== 'string' || !CLIENT_ID_PATTERN.test(pasted))) fail('bad_client_id', 'That client id doesn\'t look right.')
    const found = await discoverFor(address, challenge)
    let registration = chooseRegistration({ server: found.server, apps: await apps(), origin: origin(), pastedClientId: pasted, resource: found.resource })
    if (registration.kind === 'needs_client_id') fail('needs_client_id', 'This server needs a registered app. Paste a client id from the server, or paste a key or token.')
    if (registration.kind === 'dcr') registration = { kind: 'dcr', ...(await dcrClient(found.server)) }
    const scopes = chooseScopes({ app: registration.app, scopes: found.scopes, server: found.server, resource: found.resource })
    const pkce = pkcePair(random)
    const state = newState(random)
    const flowId = 'f' + random(24).toString('base64url')
    const redirectUri = redirectUriFor(origin())
    const flow = {
      _id: flowId,
      userId,
      address,
      resource: found.resource,
      issuer: found.issuer,
      ...(found.server.metadataIssuer && { metadataIssuer: found.server.metadataIssuer }),
      issParameter: found.server.issParameter,
      server: {
        issuer: found.server.issuer,
        tokenEndpoint: found.server.tokenEndpoint,
        ...(found.server.revocationEndpoint && { revocationEndpoint: found.server.revocationEndpoint }),
        ...(found.server.revocation && { revocation: found.server.revocation }),
        ...(registration.app?.tokenAccept && { tokenAccept: registration.app.tokenAccept }),
        // a known provider's documented exceptions (oauth.mjs KNOWN_PROVIDERS), kept for refresh and revocation
        ...(found.server.noResource && { noResource: true }),
        ...(found.server.tokenAuth && { tokenAuth: found.server.tokenAuth }),
      },
      registration: { kind: registration.kind, clientId: registration.clientId, ...(registration.app && { provider: registration.app.provider }) },
      scopes,
      stateHash: hash(state),
      redirectUri,
      status: 'created',
      createdAt: new Date(now()),
      expiresAt: new Date(now() + OAUTH_LIMITS.flowMinutes * 60000),
    }
    flow.verifier = sealed(flowOwner(flow), pkce.verifier)
    // A registration secret (DCR) travels with the flow, sealed; a pre-registered app's stays in settings.
    if (registration.kind === 'dcr' && registration.clientSecret) flow.clientSecret = sealed(flowOwner(flow), registration.clientSecret)
    flow.authorizeUrl = authorizationUrl({ server: found.server, clientId: registration.clientId, redirectUri, challenge: pkce.challenge, state, resource: found.resource, scopes })
    await flows.insert(flow)
    let authHost = ''
    try {
      authHost = new URL(found.server.authorizationEndpoint).host
    } catch {}
    return { flowId, authHost }
  }

  /**
   * The start route: once per flow, and only by the person it belongs to (userId: whoever the
   * request's login token signs in, or null). → { authorizeUrl, binding } (binding goes in an
   * HttpOnly cookie)
   */
  async function begin({ flowId, userId }) {
    if (typeof flowId !== 'string' || !FLOW_ID.test(flowId)) fail('unverified', 'This sign-in link is not valid. Start again from Slatebox.')
    if (typeof userId !== 'string' || !userId) fail('signed_out', 'Sign in to Slatebox in this browser, then start again from your slate.')
    const owned = await flows.get(flowId)
    // Someone else's flow looks exactly like a missing one: nothing about it is told.
    if (!owned || owned.userId !== userId) fail('unverified', 'This sign-in link is not valid. Start again from Slatebox.')
    const binding = random(32).toString('base64url')
    const flow = await flows.claim(flowId, 'created', { status: 'opened', bindingHash: hash(binding), openedBy: userId, openedAt: new Date(now()) })
    if (!flow) fail('unverified', 'This sign-in link was already used. Start again from Slatebox.')
    if (now() > new Date(flow.expiresAt).getTime()) fail('expired', 'That sign-in took too long. Start again from Slatebox.')
    return { authorizeUrl: flow.authorizeUrl, binding, flowId }
  }

  async function failFlow(flow, error) {
    const code = error instanceof SignInProblem ? error.code : 'token_failed'
    const message = error instanceof SignInProblem ? error.message : 'Sign-in didn\'t finish. Try again.'
    if (flow) await flows.update(flow._id, { status: 'failed', code, message, verifier: null, clientSecret: null }).catch(() => {})
    return { ok: false, flowId: flow?._id || null, code, message }
  }

  /**
   * The callback route. bindingFor(flowId) reads this browser's cookie for that flow.
   * → { ok, flowId, host?, code?, message? } (never throws: the route always shows a page)
   */
  async function finish({ query = {}, bindingFor }) {
    const state = typeof query.state === 'string' && query.state.length <= 200 ? query.state : null
    if (!state) return failFlow(null, new SignInProblem('unverified', 'Sign-in couldn\'t be verified. Try again.'))
    const flow = await flows.takeByState(hash(state))
    if (!flow) return failFlow(null, new SignInProblem('unverified', 'Sign-in couldn\'t be verified. Try again.'))
    try {
      const binding = bindingFor(flow._id)
      if (!binding || !sameHash(hash(binding), flow.bindingHash)) fail('unverified', 'Sign-in couldn\'t be verified. Finish it in the window Slatebox opened.')
      if (!flow.openedBy || flow.openedBy !== flow.userId) fail('unverified', 'Sign-in couldn\'t be verified. Start again from Slatebox.')
      const { code } = checkCallback(query, flow, now())
      const verifier = opened(flowOwner(flow), flow.verifier)
      const app = flow.registration.kind === 'preregistered' ? ((await apps()) || {})[flow.registration.provider] : null
      const clientSecret = app?.clientSecret || (flow.clientSecret ? opened(flowOwner(flow), flow.clientSecret) : null)
      const client = { clientId: flow.registration.clientId, ...(clientSecret && { clientSecret }) }
      const tokens = await exchangeCode({ server: flow.server, client, code, verifier, redirectUri: flow.redirectUri, resource: flow.resource, fetch, accept: flow.server.tokenAccept })
      if (tokens.error) fail('token_failed', 'The server didn\'t finish the sign-in. Try again.')
      await vault.save({
        userId: flow.userId,
        address: flow.address,
        resource: flow.resource,
        issuer: flow.issuer,
        kind: 'oauth',
        registration: { ...flow.registration, ...(flow.registration.kind === 'dcr' && clientSecret && { clientSecret }) },
        server: flow.server,
        tokens,
      })
      await flows.update(flow._id, { status: 'done', verifier: null, clientSecret: null, doneAt: new Date(now()) })
      let host = ''
      try {
        host = new URL(flow.address).host
      } catch {}
      return { ok: true, flowId: flow._id, host }
    } catch (error) {
      return failFlow(flow, error)
    }
  }

  /** The walkthrough's poll (only the person who started it). */
  async function status({ userId, flowId }) {
    const flow = typeof flowId === 'string' && FLOW_ID.test(flowId) ? await flows.get(flowId) : null
    if (!flow || flow.userId !== userId) return { status: 'unknown', message: 'Start the sign-in again.' }
    if (flow.status === 'done') return { status: 'done' }
    if (flow.status === 'failed') return { status: 'failed', code: flow.code, message: flow.message }
    if (now() > new Date(flow.expiresAt).getTime()) return { status: 'failed', code: 'expired', message: 'That sign-in took too long. Sign in again.' }
    return { status: 'pending', opened: flow.status !== 'created' }
  }

  return { plan, start, begin, finish, status }
}

export { parseChallenge }
