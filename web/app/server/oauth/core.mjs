// OAuth 2.1 for the hosted MCP endpoint (MCP authorization spec, 2026-07-28): Slatebox is its
// own authorization server. The HTTP endpoints are the MCP SDK's handlers (routes.mjs); this is
// the provider behind them, the consent decision the app's page makes, and the metadata.
//
//   client     registered over RFC 7591 (oauthClients). A confidential client's secret is kept
//              as its SHA-256 only; routes.mjs hashes what the client sends before comparing.
//   request    one authorization request waiting for the person (oauthRequests, 10 minutes).
//   code       one authorization code (oauthCodes, by its hash, 2 minutes, used once).
//   token      a connection: one row in slateApiTokens, kind 'oauth', like a personal token
//              but bound to the /mcp resource, with a 1-hour access token and a 30-day refresh
//              token, both rotated on refresh. Revoking the row (the client's revoke, or
//              Disconnect in Profile → Developer) ends both.
//   first-party  a pre-registered public client (firstParty: the viewer app, viewer.mjs), never
//              registered over RFC 7591: it may ask for its own scopes only, and its tokens are
//              bound to its own resource (origin + resourcePath), never /mcp.
//
// Scopes are the personal-token scopes, and actions check them the same way. Only a signed-in
// account may authorize; a guest (anonymous) account never can.
/* eslint-disable no-underscore-dangle */
import { randomBytes } from 'node:crypto'
import { API_TOKEN_SCOPES, hashApiToken } from '../api-token-core.mjs'

export const ACCESS_TOKEN_SECONDS = 60 * 60
export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60
export const CODE_SECONDS = 2 * 60
export const REQUEST_SECONDS = 10 * 60
export const CONNECTED_APP_LIMIT = 25
export const DEFAULT_SCOPES = ['slates:read', 'slates:write']
export const REQUEST_ID = /^[0-9a-f]{32}$/
// Requests and codes are removed by a TTL index on purgeAt (a Date) a day after they were made.
const PURGE_AFTER_MS = 24 * 60 * 60 * 1000

export const OAUTH_PATHS = {
  authorize: '/oauth/authorize',
  token: '/oauth/token',
  register: '/oauth/register',
  revoke: '/oauth/revoke',
  consent: '/oauth/consent',
  resource: '/mcp',
  resourceMetadata: '/.well-known/oauth-protected-resource/mcp',
}

export function oauthUrls(origin) {
  const at = new URL(origin).origin
  return {
    issuer: at,
    resource: at + OAUTH_PATHS.resource,
    resourceMetadata: at + OAUTH_PATHS.resourceMetadata,
    authorize: at + OAUTH_PATHS.authorize,
    token: at + OAUTH_PATHS.token,
    register: at + OAUTH_PATHS.register,
    revoke: at + OAUTH_PATHS.revoke,
    consent: OAUTH_PATHS.consent,
  }
}

// RFC 9728.
// scopes: what the actions need (registry.neededScopes()), so a client can ask for every scope a
// tool uses at once; the token vocabulary when no registry is at hand.
export const protectedResourceMetadata = (urls, scopes = API_TOKEN_SCOPES) => ({
  resource: urls.resource,
  authorization_servers: [urls.issuer],
  scopes_supported: [...scopes],
  bearer_methods_supported: ['header'],
  resource_name: 'Slatebox',
  resource_documentation: 'https://docs.slatebox.com/developers/slateboxapi/terminal-and-agents/',
})

// RFC 8414.
export const authorizationServerMetadata = (urls, scopes = API_TOKEN_SCOPES) => ({
  issuer: urls.issuer,
  authorization_endpoint: urls.authorize,
  token_endpoint: urls.token,
  registration_endpoint: urls.register,
  revocation_endpoint: urls.revoke,
  response_types_supported: ['code'],
  response_modes_supported: ['query'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  scopes_supported: [...scopes],
  authorization_response_iss_parameter_supported: true,
  service_documentation: 'https://docs.slatebox.com/developers/slateboxapi/terminal-and-agents/',
})

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])
// eslint-disable-next-line no-script-url
const REFUSED_SCHEMES = new Set(['http:', 'https:', 'javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:', 'ws:', 'wss:', 'ftp:'])

// Where a client may send the person back: https anywhere, http only to this computer
// (RFC 8252 loopback), or an app's own scheme (cursor://, vscode://). Never a fragment.
export function allowedRedirect(value) {
  if (typeof value !== 'string' || value.length > 2000) return false
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.hash || value.includes('#')) return false
  if (url.protocol === 'https:') return Boolean(url.hostname)
  if (url.protocol === 'http:') return LOOPBACK.has(url.hostname)
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !REFUSED_SCHEMES.has(url.protocol)
}

const sameResource = (a, b) => `${a}`.replace(/\/+$/, '') === `${b}`.replace(/\/+$/, '')

// An error the consent page shows (code, message).
const consentError = (code, message) => Object.assign(new Error(message), { code })

// refreshFamily: one record per rotated refresh token, { _id: its SHA-256, tokenId, clientId,
// purgeAt }; never the token itself. Presenting any of them again ends the whole connection.
// firstParty: the pre-registered public clients, [{ clientId, name, redirects, scopes, resourcePath }].
export function createOAuthCore({ clients, requests, codes, refreshFamily, apiTokens, users, origin, errors, firstParty = [], now = Date.now, randomBytesImpl = randomBytes }) {
  const urls = oauthUrls(origin)
  const random = (bytes) => randomBytesImpl(bytes)
  const seconds = () => Math.floor(now() / 1000)
  const own = new Map(firstParty.filter(Boolean).map((client) => [client.clientId, client]))
  const firstPartyOf = (clientId) => (typeof clientId === 'string' && own.has(clientId) ? own.get(clientId) : null)
  const resourceOf = (clientId) => {
    const client = firstPartyOf(clientId)
    return client ? urls.issuer + client.resourcePath : urls.resource
  }

  // ---- clients (RFC 7591) -----------------------------------------------------------------
  const clientsStore = {
    async getClient(clientId) {
      if (typeof clientId !== 'string' || clientId.length > 100) return undefined
      // A first-party client is never a registered one: no registration can take its id.
      const first = firstPartyOf(clientId)
      if (first)
        return {
          client_id: first.clientId,
          client_name: first.name,
          redirect_uris: [...first.redirects],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: first.scopes.join(' '),
        }
      const doc = await clients.findOneAsync({ _id: clientId })
      if (!doc) return undefined
      const { _id, secretHash, createdAt, ...metadata } = doc
      // The SDK compares the secret the client sends (hashed by routes.mjs) with this.
      return { ...metadata, client_id: _id, ...(secretHash && { client_secret: secretHash, client_secret_expires_at: 0 }) }
    },
    async registerClient(info) {
      const { InvalidClientMetadataError } = errors
      const redirects = info.redirect_uris || []
      if (!redirects.length || redirects.length > 10) throw new InvalidClientMetadataError('Give between 1 and 10 redirect_uris.')
      const refused = redirects.find((uri) => !allowedRedirect(uri))
      if (refused) throw new InvalidClientMetadataError(`redirect_uri ${String(refused).slice(0, 120)} is not allowed: use https, http on localhost, or an app scheme, without a fragment.`)
      const grants = info.grant_types || ['authorization_code', 'refresh_token']
      if (grants.some((grant) => !['authorization_code', 'refresh_token'].includes(grant)))
        throw new InvalidClientMetadataError('grant_types may be authorization_code and refresh_token.')
      const responses = info.response_types || ['code']
      if (responses.some((type) => type !== 'code')) throw new InvalidClientMetadataError('response_types may be code only.')
      const method = info.token_endpoint_auth_method ?? 'client_secret_post'
      if (!['none', 'client_secret_post'].includes(method))
        throw new InvalidClientMetadataError('token_endpoint_auth_method may be none or client_secret_post.')
      if (info.scope !== undefined && `${info.scope}`.split(' ').some((scope) => scope && !API_TOKEN_SCOPES.includes(scope)))
        throw new InvalidClientMetadataError(`scope may name ${API_TOKEN_SCOPES.join(', ')}.`)
      const name = typeof info.client_name === 'string' && info.client_name.trim() ? info.client_name.trim().slice(0, 80) : 'An MCP app'
      const clientId = info.client_id || random(16).toString('hex')
      if (firstPartyOf(clientId)) throw new InvalidClientMetadataError('That client_id is taken.')
      const doc = {
        _id: clientId,
        client_name: name,
        redirect_uris: redirects,
        grant_types: grants,
        response_types: responses,
        token_endpoint_auth_method: method,
        ...(info.client_uri && { client_uri: `${info.client_uri}`.slice(0, 2000) }),
        ...(info.scope && { scope: info.scope }),
        ...(info.software_id && { software_id: `${info.software_id}`.slice(0, 200) }),
        ...(info.software_version && { software_version: `${info.software_version}`.slice(0, 80) }),
        client_id_issued_at: info.client_id_issued_at ?? seconds(),
        createdAt: now(),
        // A public client (none) has no secret; the SDK made one for the others.
        ...(method !== 'none' && info.client_secret && { secretHash: hashApiToken(info.client_secret) }),
      }
      await clients.insertAsync(doc)
      const { _id, secretHash, createdAt, ...metadata } = doc
      return {
        ...metadata,
        client_id: clientId,
        ...(method !== 'none' && info.client_secret && { client_secret: info.client_secret, client_secret_expires_at: 0 }),
      }
    },
  }

  // ---- tokens -------------------------------------------------------------------------------
  const mint = (kind) => {
    const prefix = random(4).toString('hex')
    return { prefix, value: `${kind}_${prefix}_${random(32).toString('base64url')}` }
  }

  function issued(doc, access, refresh) {
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_SECONDS,
      refresh_token: refresh,
      scope: doc.scopes.join(' '),
    }
  }

  async function validAccount(userId) {
    const account = await users.findOneAsync({ _id: userId }, { fields: { _id: 1, isAnonymous: 1 } })
    return Boolean(account && !account.isAnonymous)
  }

  const revokeWhere = (selector) => apiTokens.updateAsync({ ...selector, revokedAt: null }, { $set: { revokedAt: now() } })

  async function activeConnections(userId) {
    const rows = await apiTokens.find({ userId, kind: 'oauth', revokedAt: null }).fetchAsync()
    return rows.filter((row) => row.refreshExpiresAt > now()).length
  }

  // ---- the provider the SDK's handlers call -----------------------------------------------
  const provider = {
    get clientsStore() {
      return clientsStore
    },

    // After the SDK checked the client, the redirect and PKCE's presence: check the scopes and
    // the resource, keep the request, and send the person to the consent page.
    async authorize(client, params, res) {
      const { InvalidScopeError, InvalidTargetError } = errors
      const asked = (params.scopes || []).filter(Boolean)
      const first = firstPartyOf(client.client_id)
      const resource = resourceOf(client.client_id)
      if (first) {
        // A first-party app asks for its own scopes only (none means all of them).
        const outside = asked.filter((scope) => !first.scopes.includes(scope))
        if (outside.length) throw new InvalidScopeError(`${first.name} may ask for ${first.scopes.join(', ')} only.`)
      }
      const unknown = asked.filter((scope) => !API_TOKEN_SCOPES.includes(scope))
      if (unknown.length) throw new InvalidScopeError(`Unknown scope ${unknown[0].slice(0, 40)}. Slatebox offers ${API_TOKEN_SCOPES.join(', ')}.`)
      if (params.resource && !sameResource(params.resource.href, resource))
        throw new InvalidTargetError(`This server issues tokens for ${resource} only.`)
      const id = random(16).toString('hex')
      await requests.insertAsync({
        _id: id,
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        scopes: asked.length ? [...new Set(asked)] : [...(first ? first.scopes : DEFAULT_SCOPES)],
        state: params.state ?? null,
        resource,
        createdAt: now(),
        expiresAt: now() + REQUEST_SECONDS * 1000,
        decidedAt: null,
        purgeAt: new Date(now() + PURGE_AFTER_MS),
      })
      res.redirect(302, `${urls.consent}?request=${id}`)
    },

    async challengeForAuthorizationCode(client, code) {
      const row = typeof code === 'string' ? await codes.findOneAsync({ _id: hashApiToken(code) }) : null
      if (!row || row.clientId !== client.client_id) throw new errors.InvalidGrantError('The authorization code is not valid.')
      return row.codeChallenge
    },

    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
      const { InvalidGrantError, InvalidTargetError } = errors
      const codeHash = hashApiToken(code)
      const row = await codes.findOneAsync({ _id: codeHash })
      if (!row || row.clientId !== client.client_id) throw new InvalidGrantError('The authorization code is not valid.')
      if (row.usedAt) {
        // A code used twice was copied: end what the first use issued (OAuth 2.1 §4.1.3).
        await revokeWhere({ codeHash })
        throw new InvalidGrantError('The authorization code was already used.')
      }
      if (row.expiresAt <= now()) throw new InvalidGrantError('The authorization code has expired.')
      if (redirectUri !== undefined && redirectUri !== row.redirectUri) throw new InvalidGrantError('redirect_uri does not match the authorization request.')
      if (resource && !sameResource(resource.href, row.resource)) throw new InvalidTargetError(`This code is for ${row.resource}.`)
      if (!(await codes.updateAsync({ _id: codeHash, usedAt: null }, { $set: { usedAt: now() } }))) {
        await revokeWhere({ codeHash })
        throw new InvalidGrantError('The authorization code was already used.')
      }
      if (!(await validAccount(row.userId))) throw new InvalidGrantError('The account that authorized this app is not available.')
      const access = mint('sbo')
      const refresh = mint('sbr')
      const doc = {
        userId: row.userId,
        kind: 'oauth',
        name: (await clientsStore.getClient(client.client_id))?.client_name || 'An MCP app',
        clientId: client.client_id,
        prefix: access.prefix,
        tokenHash: hashApiToken(access.value),
        refreshHash: hashApiToken(refresh.value),
        refreshHashPrev: null,
        codeHash,
        // scopes are this access token's; grantedScopes what the person agreed to, which a
        // refresh may narrow for one access token but never shrinks (RFC 6749 §6).
        scopes: row.scopes,
        grantedScopes: row.scopes,
        resource: row.resource,
        createdAt: now(),
        expiresAt: now() + ACCESS_TOKEN_SECONDS * 1000,
        refreshExpiresAt: now() + REFRESH_TOKEN_SECONDS * 1000,
        lastUsedAt: null,
        revokedAt: null,
      }
      await apiTokens.insertAsync(doc)
      return issued(doc, access.value, refresh.value)
    },

    async exchangeRefreshToken(client, refreshToken, scopes, resource) {
      const { InvalidGrantError, InvalidScopeError, InvalidTargetError } = errors
      const refreshHash = hashApiToken(`${refreshToken}`)
      // Reuse of any refresh token already rotated away (OAuth 2.1 §4.3.1): someone else holds a
      // copy, so the whole connection ends: its access token and its current refresh token.
      const endConnection = async (tokenId) => {
        await revokeWhere({ _id: tokenId })
        throw new InvalidGrantError('The refresh token is not valid.')
      }
      const row = await apiTokens.findOneAsync({ refreshHash })
      if (!row) {
        const used = await refreshFamily.findOneAsync({ _id: refreshHash })
        if (used && used.clientId === client.client_id) await endConnection(used.tokenId)
        // Rows rotated before the family record existed keep the one previous hash.
        const copied = await apiTokens.findOneAsync({ refreshHashPrev: refreshHash })
        if (copied && copied.clientId === client.client_id) await endConnection(copied._id)
        throw new InvalidGrantError('The refresh token is not valid.')
      }
      if (row.kind !== 'oauth' || row.clientId !== client.client_id || row.revokedAt || row.refreshExpiresAt <= now())
        throw new InvalidGrantError('The refresh token is not valid.')
      if (resource && !sameResource(resource.href, row.resource)) throw new InvalidTargetError(`This token is for ${row.resource}.`)
      const asked = (scopes || []).filter(Boolean)
      const grant = row.grantedScopes || row.scopes
      if (asked.some((scope) => !grant.includes(scope))) throw new InvalidScopeError('A refresh may not add scopes the person did not grant.')
      if (!(await validAccount(row.userId))) throw new InvalidGrantError('The account that authorized this app is not available.')
      // Claim this refresh token once: a second claim (two refreshes racing with one token) is
      // reuse. Mongo refuses a second record with the same _id.
      try {
        await refreshFamily.insertAsync({ _id: refreshHash, tokenId: row._id, clientId: row.clientId, usedAt: now(), purgeAt: new Date(now() + REFRESH_TOKEN_SECONDS * 1000) })
      } catch (error) {
        if (error?.code !== 11000) throw error
        await endConnection(row._id)
      }
      const access = mint('sbo')
      const refresh = mint('sbr')
      const granted = asked.length ? grant.filter((scope) => asked.includes(scope)) : grant
      const rotated = await apiTokens.updateAsync(
        { _id: row._id, refreshHash, revokedAt: null },
        {
          $set: {
            prefix: access.prefix,
            tokenHash: hashApiToken(access.value),
            refreshHash: hashApiToken(refresh.value),
            refreshHashPrev: refreshHash,
            scopes: granted,
            grantedScopes: grant,
            expiresAt: now() + ACCESS_TOKEN_SECONDS * 1000,
            refreshExpiresAt: now() + REFRESH_TOKEN_SECONDS * 1000,
          },
        }
      )
      if (!rotated) await endConnection(row._id)
      // The family lives as long as the connection can: each refresh moves every record's purge.
      await refreshFamily.updateAsync({ tokenId: row._id }, { $set: { purgeAt: new Date(now() + REFRESH_TOKEN_SECONDS * 1000) } }, { multi: true })
      return issued({ scopes: granted }, access.value, refresh.value)
    },

    // The SDK's interface; /mcp itself authenticates through api-token-core (audience-bound).
    async verifyAccessToken(token) {
      const row = await apiTokens.findOneAsync({ tokenHash: hashApiToken(`${token}`), revokedAt: null })
      if (!row || row.kind !== 'oauth' || row.expiresAt <= now()) throw new errors.InvalidTokenError('The access token is not valid.')
      return { token, clientId: row.clientId, scopes: row.scopes, expiresAt: Math.floor(row.expiresAt / 1000), resource: new URL(row.resource) }
    },

    // RFC 7009: either token ends the connection; unknown tokens and other clients' are ignored.
    async revokeToken(client, request) {
      const hash = hashApiToken(`${request.token}`)
      const row = (await apiTokens.findOneAsync({ tokenHash: hash })) || (await apiTokens.findOneAsync({ refreshHash: hash }))
      if (row && row.kind === 'oauth' && row.clientId === client.client_id) await revokeWhere({ _id: row._id })
    },
  }

  // ---- the consent page -----------------------------------------------------------------------
  async function pending(requestId) {
    if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) return null
    const request = await requests.findOneAsync({ _id: requestId })
    if (!request || request.decidedAt || request.expiresAt <= now()) return null
    return request
  }

  // What the page shows: the app's own name (unverified), where it sends the person back, the scopes.
  // A first-party client (the viewer app) is Slatebox's own: its consent name, marked verified, so the
  // page lists its read-only scopes instead of warning about an unchecked app.
  async function describeRequest(requestId) {
    const request = await pending(requestId)
    if (!request) return null
    const client = await clientsStore.getClient(request.clientId)
    if (!client) return null
    // Where the person goes back to: the host for a web address, the scheme for an app
    // (com.slatebox.viewer://oauth reads as com.slatebox.viewer, not as "oauth").
    const back = new URL(request.redirectUri)
    const web = back.protocol === 'https:' || back.protocol === 'http:'
    const redirectHost = (web && back.host) || back.protocol.replace(/:$/, '')
    const first = firstPartyOf(request.clientId)
    return {
      client: first
        ? { name: first.consentName || first.name, redirectHost, verified: true }
        : { name: client.client_name, redirectHost },
      scopes: request.scopes,
      expiresAt: request.expiresAt,
    }
  }

  // The person's answer. user is the signed-in account (null when signed out). scopes, when
  // given, narrows the request; it never adds to it. Returns where to send the browser.
  async function decide({ requestId, user, allow, scopes }) {
    if (!user?._id) throw consentError('sign_in_required', 'Sign in to Slatebox to connect this app.')
    if (user.isAnonymous) throw consentError('guest_account', 'Guest accounts cannot connect apps. Create an account or sign in first.')
    const request = await pending(requestId)
    if (!request) throw consentError('not_pending', 'This request is no longer waiting. Start connecting again from the app.')
    const granted = Array.isArray(scopes) ? request.scopes.filter((scope) => scopes.includes(scope)) : request.scopes
    if (allow && !granted.length) throw consentError('no_scopes', 'Choose at least one permission, or deny.')
    if (allow && (await activeConnections(user._id)) >= CONNECTED_APP_LIMIT)
      throw consentError('too_many_apps', `You have ${CONNECTED_APP_LIMIT} connected apps. Disconnect one in Profile → Developer first.`)
    if (!(await requests.updateAsync({ _id: request._id, decidedAt: null }, { $set: { decidedAt: now(), userId: user._id, allowed: Boolean(allow) } })))
      throw consentError('not_pending', 'This request is no longer waiting. Start connecting again from the app.')
    const back = new URL(request.redirectUri)
    if (request.state !== null) back.searchParams.set('state', request.state)
    back.searchParams.set('iss', urls.issuer)
    if (!allow) {
      back.searchParams.set('error', 'access_denied')
      back.searchParams.set('error_description', 'The person did not allow the app.')
      return { redirectTo: back.href }
    }
    const code = random(32).toString('base64url')
    await codes.insertAsync({
      _id: hashApiToken(code),
      clientId: request.clientId,
      userId: user._id,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      scopes: granted,
      resource: request.resource,
      createdAt: now(),
      expiresAt: now() + CODE_SECONDS * 1000,
      usedAt: null,
      // A used code is kept a day, so a replay still finds it and ends what it issued.
      purgeAt: new Date(now() + PURGE_AFTER_MS),
    })
    back.searchParams.set('code', code)
    return { redirectTo: back.href }
  }

  return { urls, provider, describeRequest, decide }
}
