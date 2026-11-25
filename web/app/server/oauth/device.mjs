// Device-code sign-in (RFC 8628) on Slatebox's own OAuth server, for first-party command-line
// clients that have no browser of their own: `npx slatebox install` asks for a code, the person
// approves it on /device while signed in, and the command polls the token endpoint until then.
//
//   client   a first-party public client from DEVICE_CLIENTS (no secret, never registered over
//            /oauth/register). Each offers sign-ins for one or more purposes: each purpose names the
//            only scopes it may ask for and the one resource its token is bound to. A request asks
//            for the scopes of one purpose only, so a device token never works on /mcp, and on
//            /api/v1 only for the actions its purpose names (a move: team.export and teamMove.*).
//   grant    one request (oauthDeviceGrants): only sha256 of the device code and of the user code
//            are kept, it lives 10 minutes, and it is used once.
//   token    one row in slateApiTokens, kind 'oauth' (sbo_), bound to the client's resource, with a
//            short access token and no refresh token.
//
// MIT, runs without Meteor (scripts/oauth-device.test.mjs); server/oauth/meteor.js wires it.
// Which purposes are offered is the caller's `enabled(purpose)` (team addresses and moves run only
// on Slatebox Cloud); where none is, every device address answers 404, and asking for the scopes
// of a purpose not offered here answers invalid_scope.
/* eslint-disable no-underscore-dangle */
import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto'
import { hashApiToken } from '../api-token-core.mjs'
import { CONNECTED_APP_LIMIT } from './core.mjs'

export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
// RFC 8628 §6.1: twenty consonants, no vowels (no words), no look-alikes.
export const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'
export const USER_CODE_LENGTH = 8
export const DEVICE_SECONDS = 10 * 60
export const POLL_SECONDS = 5
export const SLOW_DOWN_STEP = 5
export const WRONG_CODE_LIMIT = 5
export const TEAM_ADDRESSES_SCOPE = 'team-addresses'
export const DEVICE_PATHS = { authorization: '/oauth/device_authorization', page: '/device' }
// Grants are removed by a TTL index on purgeAt a day after they lapse.
const PURGE_AFTER_MS = 24 * 60 * 60 * 1000

// A move signs in for exactly these two scopes, and its token works on /api/v1 for exactly these
// actions (server/actions/mount.js): export the team here, or move a team here, nothing else.
export const MOVE_SCOPES = Object.freeze(['team:export', 'team:move'])
export const MOVE_ACTIONS = Object.freeze(['team.export', 'teamMove.start', 'teamMove.list', 'teamMove.get', 'teamMove.confirm', 'teamMove.discard', 'teamMove.invite'])
export const MOVE_RESOURCE_PATH = '/api/v1/team/moves'

// The first-party clients. team-addresses is a route scope (enterprise/team-addresses), not an
// action scope: it is never in API_TOKEN_SCOPES, so no personal token, MCP tool or exec call
// carries it, and '*' or admin tokens never imply it. The move scopes are action scopes, but the
// token a move sign-in issues is bound to MOVE_RESOURCE_PATH, which /api/v1 takes for
// MOVE_ACTIONS only.
export const DEVICE_CLIENTS = Object.freeze({
  'slatebox-cli': Object.freeze({
    name: 'Slatebox installer',
    purposes: Object.freeze({
      teamAddresses: Object.freeze({
        scopes: Object.freeze([TEAM_ADDRESSES_SCOPE]),
        resourcePath: '/api/v1/team-addresses',
        tokenSeconds: 15 * 60,
        grants: Object.freeze({ [TEAM_ADDRESSES_SCOPE]: 'claim and manage team addresses on your account' }),
        cannot: 'It will not be able to read or change your slates.',
      }),
      move: Object.freeze({
        title: 'Move your team',
        scopes: MOVE_SCOPES,
        resourcePath: MOVE_RESOURCE_PATH,
        // A move downloads and uploads a whole team: an hour, still with no refresh token.
        tokenSeconds: 60 * 60,
        actions: MOVE_ACTIONS,
        grants: Object.freeze({
          'team:export': 'move your team: export everything your team owns here, if you are its admin',
          'team:move': 'move your team: bring a team here from another Slatebox server, waiting for your confirmation',
        }),
        cannot: 'It can do nothing else: it will not be able to open, change or share your slates one by one, and the sign-in ends after an hour.',
      }),
    }),
  }),
})

// Team addresses are offered only where Slatebox Cloud runs the claim service: its Cloudflare
// settings present (enterprise/team-addresses). The caller adds the Cloud key check.
export const teamClaimsConfigured = (settings) => {
  const claims = settings?.cloudflare?.teamClaims
  return Boolean(claims && typeof claims === 'object' && claims.token && claims.accountId && claims.zoneId)
}

export class DeviceError extends Error {
  constructor(error, description, status = 400) {
    super(description)
    this.error = error
    this.status = status
  }
}

// What the person typed, as the stored form: letters only, upper case, eight of the alphabet.
export function normalizeUserCode(input) {
  if (typeof input !== 'string' || input.length > 40) return null
  const code = input.toUpperCase().replace(/[\s-]/g, '')
  if (code.length !== USER_CODE_LENGTH) return null
  for (const ch of code) if (!USER_CODE_ALPHABET.includes(ch)) return null
  return code
}

export const formatUserCode = (code) => `${code.slice(0, 4)}-${code.slice(4)}`

// The device's own name for itself (its host name): display only, printable, short.
export function sanitizeLabel(label) {
  if (typeof label !== 'string') return null
  const clean = label.replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim().slice(0, 64)
  return clean || null
}

// A country from the edge's own header (Cloudflare's CF-IPCountry), for the consent page only.
export function regionFrom(headers = {}) {
  const value = headers['cf-ipcountry']
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value) && value !== 'XX' && value !== 'T1' ? value : null
}

// A counter per key per window, kept in a store every app process shares (Meteor: one Mongo
// collection, the shape actions/rate-limit.mjs uses). take(key, limit, windowMs) → { allowed, retryAfter }
export function createWindowCounter({ collection, now = Date.now }) {
  return {
    async take(key, limit, windowMs) {
      const at = now()
      const window = Math.floor(at / windowMs)
      const resetAt = (window + 1) * windowMs
      const doc = await collection.findOneAndUpdate(
        { _id: `${key}:${windowMs}:${window}` },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(resetAt + windowMs) } },
        { upsert: true, returnDocument: 'after', includeResultMetadata: false }
      )
      const count = doc?.count ?? 1
      return { allowed: count <= limit, retryAfter: Math.max(1, Math.ceil((resetAt - at) / 1000)) }
    },
    // How many were taken in the current window, without taking one.
    async peek(key, windowMs) {
      const window = Math.floor(now() / windowMs)
      const doc = await collection.findOne({ _id: `${key}:${windowMs}:${window}` })
      return doc?.count ?? 0
    },
  }
}

// The same counter in memory, for tests and single-process tools.
export function memoryWindowCounter({ now = Date.now } = {}) {
  const counts = new Map()
  return {
    counts,
    async take(key, limit, windowMs) {
      const at = now()
      const window = Math.floor(at / windowMs)
      const id = `${key}:${windowMs}:${window}`
      const count = (counts.get(id) || 0) + 1
      counts.set(id, count)
      return { allowed: count <= limit, retryAfter: Math.max(1, Math.ceil(((window + 1) * windowMs - at) / 1000)) }
    },
    async peek(key, windowMs) {
      return counts.get(`${key}:${windowMs}:${Math.floor(now() / windowMs)}`) || 0
    },
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

/**
 * @param {object} options
 * @param {object} options.grants      oauthDeviceGrants (Meteor collection API: insertAsync, findOneAsync, updateAsync)
 * @param {object} options.apiTokens   slateApiTokens
 * @param {object} options.users       Meteor.users
 * @param {string} options.origin      the app's own origin (the verification page and the token's resource)
 * @param {object} options.counter     createWindowCounter / memoryWindowCounter
 * @param {() => boolean} [options.enabled]  whether device sign-in is offered here at all
 * @param {string} [options.pepper]    key for the requester's address hash (never the address itself)
 */
export function createDeviceFlow({
  grants,
  apiTokens,
  users,
  origin,
  counter,
  enabled = () => true,
  clients = DEVICE_CLIENTS,
  pepper = 'slatebox-device',
  now = Date.now,
  randomBytesImpl = randomBytes,
  randomIntImpl = randomInt,
}) {
  const at = new URL(origin).origin
  const verificationUri = at + DEVICE_PATHS.page
  const ipHash = (ip) => (ip ? createHmac('sha256', pepper).update(String(ip)).digest('hex').slice(0, 32) : null)
  const clientFor = (clientId) => (typeof clientId === 'string' && Object.hasOwn(clients, clientId) ? clients[clientId] : null)
  // enabled() with no purpose (an older caller): every purpose follows it.
  const offered = (name) => Boolean(enabled(name))
  const purposesOf = (client) => Object.entries(client?.purposes || {})
  const purposeOf = (client, name) => (client && Object.hasOwn(client.purposes || {}, name) ? client.purposes[name] : null)
  // The purpose a grant (or a token row) was made for: its scopes are all in one purpose.
  const purposeForScopes = (client, scopes) => purposesOf(client).find(([, purpose]) => scopes.every((scope) => purpose.scopes.includes(scope))) || null
  const resourceFor = (client, name) => {
    const purpose = name ? purposeOf(client, name) : purposesOf(client)[0]?.[1]
    return purpose ? at + purpose.resourcePath : null
  }

  const assertEnabled = () => {
    if (!Object.values(clients).some((client) => purposesOf(client).some(([name]) => offered(name))))
      throw new DeviceError('not_found', 'Nothing is published at this address.', 404)
  }

  const newUserCode = () => {
    let code = ''
    for (let i = 0; i < USER_CODE_LENGTH; i += 1) code += USER_CODE_ALPHABET[randomIntImpl(USER_CODE_ALPHABET.length)]
    return code
  }

  // POST /oauth/device_authorization
  async function authorize({ clientId, scope, label, ip, region }) {
    assertEnabled()
    const client = clientFor(clientId)
    if (!client) throw new DeviceError('invalid_client', 'Unknown client.', 401)
    const asked = typeof scope === 'string' && scope.trim() ? [...new Set(scope.trim().split(/\s+/))] : [...(purposesOf(client)[0]?.[1].scopes || [])]
    const found = purposeForScopes(client, asked)
    if (!found) throw new DeviceError('invalid_scope', `This client may ask for ${purposesOf(client).map(([, purpose]) => purpose.scopes.join(' ')).join(', or ')} only, one purpose at a time.`)
    if (!offered(found[0])) throw new DeviceError('invalid_scope', `This server does not offer ${asked.join(' ')} sign-ins.`)
    const key = `device:${ipHash(ip) || 'unknown'}`
    for (const [limit, windowMs] of [[10, 60_000], [50, 86_400_000]]) {
      const taken = await counter.take(key, limit, windowMs)
      if (!taken.allowed) throw Object.assign(new DeviceError('slow_down', 'Too many sign-in requests from this address. Try again later.', 429), { retryAfter: taken.retryAfter })
    }
    const deviceCode = randomBytesImpl(32).toString('base64url')
    // A live grant with the same user code is vanishingly rare; draw again if there is one.
    let userCode = newUserCode()
    for (let tries = 0; tries < 5 && (await grants.findOneAsync({ userCodeHash: sha256(userCode), status: 'pending' })); tries += 1) userCode = newUserCode()
    const created = now()
    await grants.insertAsync({
      _id: randomBytesImpl(16).toString('hex'),
      deviceHash: sha256(deviceCode),
      userCodeHash: sha256(userCode),
      clientId,
      purpose: found[0],
      scopes: asked,
      label: sanitizeLabel(label),
      region: region || null,
      ipHash: ipHash(ip),
      createdAt: created,
      expiresAt: created + DEVICE_SECONDS * 1000,
      interval: POLL_SECONDS,
      lastPolledAt: null,
      status: 'pending',
      userId: null,
      purgeAt: new Date(created + DEVICE_SECONDS * 1000 + PURGE_AFTER_MS),
    })
    const shown = formatUserCode(userCode)
    return {
      device_code: deviceCode,
      user_code: shown,
      verification_uri: verificationUri,
      verification_uri_complete: `${verificationUri}?code=${shown}`,
      expires_in: DEVICE_SECONDS,
      interval: POLL_SECONDS,
    }
  }

  // POST /oauth/token with grant_type urn:ietf:params:oauth:grant-type:device_code
  async function poll({ clientId, deviceCode }) {
    assertEnabled()
    const client = clientFor(clientId)
    if (!client) throw new DeviceError('invalid_client', 'Unknown client.', 401)
    if (typeof deviceCode !== 'string' || !deviceCode || deviceCode.length > 200) throw new DeviceError('invalid_request', 'device_code is required.')
    const grant = await grants.findOneAsync({ deviceHash: sha256(deviceCode) })
    if (!grant || grant.clientId !== clientId) throw new DeviceError('invalid_grant', 'The device code is not valid.')
    const t = now()
    if (grant.expiresAt <= t) throw new DeviceError('expired_token', 'The code expired. Start signing in again.')
    if (grant.status === 'used') throw new DeviceError('invalid_grant', 'The device code was already used.')
    if (grant.status === 'denied') throw new DeviceError('access_denied', 'The person did not approve this sign-in.')
    // Polling faster than the interval: slow down, and the interval grows (RFC 8628 §3.5).
    if (grant.lastPolledAt && t - grant.lastPolledAt < grant.interval * 1000) {
      await grants.updateAsync({ _id: grant._id }, { $set: { lastPolledAt: t, interval: grant.interval + SLOW_DOWN_STEP } })
      throw new DeviceError('slow_down', `Poll at most every ${grant.interval + SLOW_DOWN_STEP} seconds.`)
    }
    await grants.updateAsync({ _id: grant._id }, { $set: { lastPolledAt: t } })
    if (grant.status === 'pending') throw new DeviceError('authorization_pending', 'Waiting for the person to approve.')
    if (grant.status !== 'approved') throw new DeviceError('invalid_grant', 'The device code is not valid.')
    // Used once: only one poll flips approved to used.
    if (!(await grants.updateAsync({ _id: grant._id, status: 'approved' }, { $set: { status: 'used', usedAt: t } })))
      throw new DeviceError('invalid_grant', 'The device code was already used.')
    const account = await users.findOneAsync({ _id: grant.userId }, { fields: { _id: 1, isAnonymous: 1, isDisabled: 1 } })
    if (!account || account.isAnonymous || account.isDisabled) throw new DeviceError('invalid_grant', 'The account that approved this sign-in is not available.')
    const purpose = purposeOf(client, grant.purpose) || purposeForScopes(client, grant.scopes)?.[1]
    if (!purpose) throw new DeviceError('invalid_grant', 'The device code is not valid.')
    const prefix = randomBytesImpl(4).toString('hex')
    const access = `sbo_${prefix}_${randomBytesImpl(32).toString('base64url')}`
    const expiresAt = t + purpose.tokenSeconds * 1000
    await apiTokens.insertAsync({
      userId: grant.userId,
      kind: 'oauth',
      name: `${purpose.title ? `${client.name}: ${purpose.title.toLowerCase()}` : client.name}${grant.label ? ` on ${grant.label}` : ''}`,
      clientId,
      prefix,
      tokenHash: hashApiToken(access),
      scopes: grant.scopes,
      grantedScopes: grant.scopes,
      resource: at + purpose.resourcePath,
      deviceGrantId: grant._id,
      createdAt: t,
      expiresAt,
      // No refresh token: the connection ends with the access token.
      refreshExpiresAt: expiresAt,
      lastUsedAt: null,
      revokedAt: null,
    })
    return { access_token: access, token_type: 'Bearer', expires_in: purpose.tokenSeconds, scope: grant.scopes.join(' ') }
  }

  // Wrong entries per person: after WRONG_CODE_LIMIT in ten minutes, entering codes is refused
  // for the rest of the window, so codes cannot be guessed from a signed-in session.
  async function lookup(userCode, userId) {
    const blocked = () => Object.assign(new DeviceError('too_many_attempts', 'Too many wrong codes. Wait a few minutes, then start signing in again on your device.', 429), { retryAfter: 60 })
    // Checked before the code is: a person past the limit learns nothing about any code.
    if ((await counter.peek(`device-wrong:${userId}`, DEVICE_SECONDS * 1000)) >= WRONG_CODE_LIMIT) throw blocked()
    const code = normalizeUserCode(userCode)
    const grant = code ? await grants.findOneAsync({ userCodeHash: sha256(code), status: 'pending' }) : null
    if (grant && grant.expiresAt > now()) return grant
    await counter.take(`device-wrong:${userId}`, WRONG_CODE_LIMIT, DEVICE_SECONDS * 1000)
    return null
  }

  const signedIn = (user) => {
    if (!user?._id) throw new DeviceError('sign_in_required', 'Sign in to Slatebox first.', 401)
    if (user.isAnonymous) throw new DeviceError('guest_account', 'Guest accounts cannot approve a sign-in. Create an account or sign in first.', 403)
  }

  // What /device shows for a code: who asks, from where, and exactly what it gets. null when the
  // code is unknown, used or lapsed (the same answer for each).
  async function describe({ userCode, user }) {
    assertEnabled()
    signedIn(user)
    const entry = await counter.take(`device-entry:${user._id}`, 10, 60_000)
    if (!entry.allowed) throw Object.assign(new DeviceError('slow_down', 'Too many codes entered. Wait a minute.', 429), { retryAfter: entry.retryAfter })
    const grant = await lookup(userCode, user._id)
    if (!grant) return null
    const client = clientFor(grant.clientId)
    const purpose = purposeOf(client, grant.purpose) || purposeForScopes(client, grant.scopes)?.[1]
    if (!client || !purpose) return null
    return {
      client: client.name,
      ...(purpose.title && { title: purpose.title }),
      label: grant.label,
      region: grant.region,
      grants: grant.scopes.map((scope) => purpose.grants[scope] || scope),
      cannot: purpose.cannot,
      expiresAt: grant.expiresAt,
    }
  }

  async function decide({ userCode, user, allow }) {
    assertEnabled()
    signedIn(user)
    const grant = await lookup(userCode, user._id)
    if (!grant) throw new DeviceError('not_pending', 'This code is no longer waiting. Start signing in again on your device.')
    if (allow) {
      const rows = await apiTokens.find({ userId: user._id, kind: 'oauth', revokedAt: null }).fetchAsync()
      if (rows.filter((row) => row.refreshExpiresAt > now()).length >= CONNECTED_APP_LIMIT)
        throw new DeviceError('too_many_apps', `You have ${CONNECTED_APP_LIMIT} connected apps. Disconnect one in Profile → Developer first.`)
    }
    const status = allow ? 'approved' : 'denied'
    if (!(await grants.updateAsync({ _id: grant._id, status: 'pending' }, { $set: { status, userId: user._id, decidedAt: now() } })))
      throw new DeviceError('not_pending', 'This code is no longer waiting. Start signing in again on your device.')
    return { status }
  }

  // resourceFor(clientId[, purpose]): the resource its tokens are bound to (the first purpose by default).
  return { verificationUri, authorize, poll, describe, decide, resourceFor: (clientId, name) => resourceFor(clientFor(clientId), name) }
}

// The JSON an RFC 8628 client reads for a refusal.
export function deviceErrorBody(error) {
  if (error instanceof DeviceError) return { status: error.status, body: { error: error.error, error_description: error.message }, retryAfter: error.retryAfter }
  return { status: 500, body: { error: 'server_error', error_description: 'The request could not be completed.' } }
}
