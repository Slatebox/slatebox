// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The team-address claim service (Slatebox Cloud only): a free https://<name>.slatebox.team for a
// self-hosted Slatebox, served through a Cloudflare Tunnel in Slatebox's own Cloudflare account.
// The install's cloudflared connects outbound with a connector token; nobody sets up DNS, ports or
// certificates.
//
// A claim (teamAddresses):
//   { _id: 'ta_…', name, ownerId, status: pending|active|suspended|releasing|released|failed,
//     cf: { tunnelId, tunnelName: 'sbx-<instance>-<_id>' (legacy 'sbx-<_id>'), dnsRecordId, configVersion },
//     installCredential: { prefix, hash, createdAt, lastUsedAt, rotatedAt } (sha256 of sbxi_… only),
//     idempotencyKey, createdAt, updatedAt, activatedAt, releasedAt, lastSeen: { at, connections, connectedAt },
//     suspension: { at, by, reason, notice } | null, previousNames: [{ name, until, dnsRecordId }],
//     label, needsCleanup? }
//
// Rules this file keeps:
//   - the connector token is never stored or logged: each fetch asks Cloudflare and hands it on;
//   - no request field reaches the tunnel's ingress: the service is a constant origin and the
//     host is derived from a validated name (ingressFor);
//   - "unavailable" is the one answer for reserved, blocked, taken and held names; a signed-in
//     claim or rename of a reserved name (Slatebox's own list, public in names.mjs) also says
//     why (reason "reserved"), never for a blocked, taken or held one;
//   - create is an idempotent saga: a replay resumes it, a hard failure undoes it in reverse, and
//     nothing half-made is ever handed out;
//   - every step is audited, without tokens, credentials or Cloudflare response bodies.
import { createHash, createHmac, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto'
import { hashApiToken } from '/server/api-token-core.mjs'
import { CloudflareError, dnsCommentFor, instanceOf, legacyTunnelName, tunnelNameFor, tunnelTarget } from './cf.mjs'
import { checkName, E2E_PREFIX, NON_PROD_PREFIXES, namePrefixFor, normalizeName, refusal, suggestionsFor, validShape } from './names.mjs'

export const DAY_MS = 86_400_000
export const LIMITS = Object.freeze({
  perAccount: 3,
  newPerDay: 5,
  newPer30Days: 20,
  renamesPer30Days: 3,
  checksPerMinutePerIp: 30,
  checksPerDayPerAccount: 300,
  tokenFetchesPerHour: 12,
  claimsPerHourEverywhere: 50,
  maxTunnels: 800,
  alertTunnels: 600,
})
export const HOLD_MS = 30 * DAY_MS
export const TAKEDOWN_HOLD_MS = 365 * DAY_MS
export const RENAME_GRACE_MS = DAY_MS
// The one origin a tunnel ever points at: Caddy inside the install's own container, which routes
// /live to the relay and /auth to Keycloak. It resolves inside the customer's connector, so even a
// wrong value could only reach the customer's own network, never ours.
export const ORIGIN_SERVICE = 'http://localhost:7070'
const ORIGIN_SHAPE = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/
export const CREDENTIAL_SHAPE = /^sbxi_([0-9a-f]{8})_([A-Za-z0-9_-]{43})$/
export const CLAIM_ID = /^ta_[0-9a-z]{20}$/

const STATUS = Object.freeze({
  invalid_name: 400,
  unauthorized: 401,
  unverified: 403,
  limit_reached: 403,
  suspended: 403,
  forbidden: 403,
  not_found: 404,
  unavailable: 409,
  conflict: 409,
  rate_limited: 429,
  upstream_unavailable: 502,
  paused: 503,
})

export class TeamAddressError extends Error {
  constructor(code, message, { retryAfter, details } = {}) {
    super(message)
    this.name = 'TeamAddressError'
    this.code = code
    this.status = STATUS[code] || 500
    if (retryAfter !== undefined) this.retryAfter = retryAfter
    if (details !== undefined) this.details = details
  }
}

const refuse = (code, message, extra) => new TeamAddressError(code, message, extra)
const UNAVAILABLE = (name) => refuse('unavailable', `${name} isn't available.`)
// Reserved names are Slatebox's own (names.mjs, published): saying so gives nothing away.
const RESERVED = (host, name, namePrefix = '') =>
  refuse(
    'unavailable',
    name.startsWith(E2E_PREFIX)
      ? `${host} is reserved: e2e-… names are kept for Slatebox's own end-to-end tests. Choose another name.`
      : namePrefix && !name.startsWith(namePrefix)
        ? `${host} is reserved: on this ${namePrefix.slice(0, -1)} server, team addresses start with ${namePrefix}. Choose a name like ${namePrefix}${name}.`
        : !namePrefix && NON_PROD_PREFIXES.some((prefix) => name.startsWith(prefix))
          ? `${host} is reserved: ${NON_PROD_PREFIXES.map((prefix) => `${prefix}…`).join(', ')} names are kept for Slatebox's own test servers. Choose another name.`
          : `${host} is reserved: names like www, admin, support and test are kept for Slatebox itself. Choose another name.`,
    { details: { reason: 'reserved' } }
  )
const notAvailable = (host, name, checked, namePrefix = '') => (checked.reason === 'reserved' ? RESERVED(host, name, namePrefix) : UNAVAILABLE(host))
const UPSTREAM = () => refuse('upstream_unavailable', 'The team address service could not finish right now. Nothing half-made was kept. Try again in a minute.', { retryAfter: 30 })
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

/** The tunnel ingress for these hosts: each to the one origin, everything else 404. */
export function ingressFor(hosts, origin = ORIGIN_SERVICE) {
  return {
    ingress: [
      ...hosts.map((hostname) => ({ hostname, service: origin, originRequest: { httpHostHeader: hostname, connectTimeout: 10, noTLSVerify: false } })),
      { service: 'http_status:404' },
    ],
    'warp-routing': { enabled: false },
  }
}
// A takedown: every request answers 451 at Cloudflare's edge within seconds.
export const SUSPENDED_INGRESS = Object.freeze({ ingress: [{ service: 'http_status:451' }], 'warp-routing': { enabled: false } })

/** What the owner (and the install) may see of a claim. */
export function publicClaim(doc, zoneName) {
  return {
    id: doc._id,
    name: doc.name,
    host: `${doc.name}.${zoneName}`,
    status: doc.status,
    createdAt: doc.createdAt,
    lastSeen: doc.lastSeen || null,
    ...(doc.label && { label: doc.label }),
    ...(doc.previousNames?.length && { previousHosts: doc.previousNames.map((entry) => `${entry.name}.${zoneName}`) }),
    ...(doc.status === 'suspended' && { suspension: { at: doc.suspension?.at ?? null, notice: doc.suspension?.notice || 'This team address was suspended. Write to abuse@slatebox.com to appeal.' } }),
  }
}

/**
 * @param {object} options
 * @param {ReturnType<import('./store.mjs').memoryStore>} options.store
 * @param {ReturnType<import('./cf.mjs').createCloudflare>} options.cf
 * @param {() => object} options.config   settings.cloudflare.teamClaims as it stands now
 * @param {(userId: string) => Promise<object|null>} options.findUser
 * @param {(message: { userId: string|null, subject: string, text: string }) => Promise<void>|void} [options.notify]
 * @param {(line: string) => void} [options.log]
 */
export function createTeamAddressService({ store, cf, config, findUser, notify = () => {}, log = () => {}, now = Date.now, randomBytes = nodeRandomBytes, limits = LIMITS }) {
  const settings = () => {
    const raw = config() || {}
    const instance = instanceOf(raw)
    return {
      instance,
      // Non-prod instances claim in their own name space (test-…, dev-…) so they never take a prod name.
      namePrefix: namePrefixFor(instance, raw.namePrefix),
      zoneName: typeof raw.zoneName === 'string' && raw.zoneName ? raw.zoneName : 'slatebox.team',
      origin: ORIGIN_SHAPE.test(raw.originService || '') ? raw.originService : ORIGIN_SERVICE,
      maxTunnels: Number.isInteger(raw.maxTunnels) && raw.maxTunnels > 0 ? raw.maxTunnels : limits.maxTunnels,
      alertTunnels: Number.isInteger(raw.alertTunnels) && raw.alertTunnels > 0 ? raw.alertTunnels : limits.alertTunnels,
      paused: raw.paused === true,
      e2eAccounts: Array.isArray(raw.e2eAccounts) ? raw.e2eAccounts.map(String) : [],
      pepper: raw.auditPepper || sha256(`slatebox-team-claims-audit:${raw.token || ''}`),
    }
  }
  const hostOf = (name) => `${name}.${settings().zoneName}`
  const ingress = (hosts) => ingressFor(hosts, settings().origin)
  const ipHash = (ip) => (ip ? createHmac('sha256', settings().pepper).update(String(ip)).digest('hex').slice(0, 32) : null)
  const shortUa = (ua) => (typeof ua === 'string' ? ua.replace(/[^\x20-\x7e]/g, '').slice(0, 60) : null)
  const say = (line) => log(`[team-addresses] ${line}`)

  async function audit({ actor, action, claim, name, ok = true, error, ip, ua }) {
    const entry = {
      at: now(),
      actor: { kind: actor?.kind || 'system', id: actor?.id ?? null },
      action,
      claimId: claim?._id ?? null,
      name: name ?? claim?.name ?? null,
      ok,
      ipHash: ipHash(ip),
      uaShort: shortUa(ua),
    }
    if (error) {
      entry.error = { code: error.code || (error instanceof CloudflareError ? 'cloudflare' : 'error') }
      // Cloudflare's own codes and messages only; never a body, never a header.
      if (error instanceof CloudflareError) entry.error.cloudflare = { status: error.status, errors: error.errors }
    }
    try {
      await store.audit.append(entry)
    } catch (appendError) {
      say(`audit append failed: ${appendError?.message || appendError}`)
    }
  }

  const tell = async (message) => {
    try {
      await notify(message)
    } catch (error) {
      say(`notice not sent: ${error?.message || error}`)
    }
  }

  async function limit(key, max, windowMs, message) {
    const taken = await store.counter.take(key, max, windowMs)
    if (!taken.allowed) throw refuse('rate_limited', message, { retryAfter: taken.retryAfter })
  }

  // `refused` names the step for the audit when the email is unconfirmed (every refusal is audited).
  async function account(user, refused = {}) {
    if (!user?._id) throw refuse('unauthorized', 'Sign in to Slatebox to manage team addresses.')
    const found = await findUser(user._id)
    if (!found || found.isAnonymous || found.isDisabled) throw refuse('unauthorized', 'Sign in to Slatebox to manage team addresses.')
    if (found.emails?.[0]?.verified !== true) {
      const name = normalizeName(refused.name)
      await audit({ actor: { kind: 'user', id: user._id }, action: refused.action || 'claim', claim: refused.claim, name: validShape(name) ? name : refused.claim?.name, ok: false, error: { code: 'unverified' }, ip: refused.ip, ua: refused.ua })
      throw refuse('unverified', 'Confirm your email address before you claim a team address: open the link in the email Slatebox sent you (Profile can send it again), then run the install again.')
    }
    return found
  }

  async function blocklist() {
    try {
      return await store.blocklist.list()
    } catch {
      return []
    }
  }

  // Whether a well-shaped name is free for this owner (a held name is free only to its holder).
  async function free(name, ownerId) {
    if (await store.claims.liveByName(name)) return false
    const hold = await store.tombstones.get(name)
    return !hold || (hold.ownerId !== null && hold.ownerId === ownerId)
  }

  async function owned(user, id) {
    if (typeof id !== 'string' || !CLAIM_ID.test(id)) throw refuse('not_found', 'No such team address on your account.')
    const doc = await store.claims.get(id)
    if (!doc || doc.ownerId !== user._id || ['released', 'failed'].includes(doc.status)) throw refuse('not_found', 'No such team address on your account.')
    return doc
  }

  const newId = () => {
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
    return `ta_${[...randomBytes(20)].map((byte) => alphabet[byte % 36]).join('')}`
  }

  function mintCredential() {
    const prefix = randomBytes(4).toString('hex')
    const value = `sbxi_${prefix}_${randomBytes(32).toString('base64url')}`
    return { value, record: { prefix, hash: hashApiToken(value), createdAt: now(), lastUsedAt: null, rotatedAt: null } }
  }

  // ---- Cloudflare steps -------------------------------------------------------------------

  // Undo what a claim made at Cloudflare, newest first. A step that fails leaves needsCleanup and
  // the ids, for the reconciler. → true when everything is gone.
  async function compensate(doc) {
    let clean = true
    const dns = [doc.cf?.dnsRecordId, ...(doc.previousNames || []).map((entry) => entry.dnsRecordId)].filter(Boolean)
    for (const id of dns) {
      try {
        await cf.deleteDns(id)
      } catch {
        clean = false
      }
    }
    if (doc.cf?.tunnelId) {
      try {
        await cf.deleteConnections(doc.cf.tunnelId)
        await cf.deleteTunnel(doc.cf.tunnelId)
      } catch {
        clean = false
      }
    }
    await store.claims.update(doc._id, clean ? { needsCleanup: false, updatedAt: now() } : { needsCleanup: true, updatedAt: now() })
    return clean
  }

  // Steps 3–5 of create, each safe to run again: tunnel, ingress, DNS. Mutates and returns doc.
  async function provisionCloudflare(doc) {
    const host = hostOf(doc.name)
    doc.cf = doc.cf || {}
    if (!doc.cf.tunnelId) {
      const tunnelName = tunnelNameFor(settings().instance, doc._id)
      // A claim started before names carried the instance may have its legacy tunnel already.
      const found = (await cf.findTunnel(tunnelName)) || (await cf.findTunnel(legacyTunnelName(doc._id))) || (await cf.createTunnel(tunnelName))
      if (!found?.id) throw new CloudflareError('Cloudflare made no tunnel', { status: 502 })
      doc.cf.tunnelId = found.id
      doc.cf.tunnelName = tunnelName
      await store.claims.update(doc._id, { 'cf.tunnelId': found.id, 'cf.tunnelName': tunnelName, updatedAt: now() })
    }
    await cf.putConfig(doc.cf.tunnelId, ingress([host]))
    doc.cf.configVersion = (doc.cf.configVersion || 0) + 1
    await store.claims.update(doc._id, { 'cf.configVersion': doc.cf.configVersion, updatedAt: now() })
    if (!doc.cf.dnsRecordId) {
      const existing = await cf.findCname(host)
      let recordId
      if (existing) {
        // Our database decides who owns a name; a record pointing elsewhere is a fault, never reused.
        if (existing.content !== tunnelTarget(doc.cf.tunnelId)) throw Object.assign(new CloudflareError('A DNS record for this name points elsewhere', { status: 409 }), { conflict: true })
        recordId = existing.id
      } else {
        recordId = (await cf.createCname({ name: host, content: tunnelTarget(doc.cf.tunnelId), comment: dnsCommentFor(settings().instance, doc._id) }))?.id
      }
      if (!recordId) throw new CloudflareError('Cloudflare made no DNS record', { status: 502 })
      doc.cf.dnsRecordId = recordId
      await store.claims.update(doc._id, { 'cf.dnsRecordId': recordId, updatedAt: now() })
    }
    return doc
  }

  // Runs (or resumes) a pending claim to active. → { doc, connectorToken, installCredential }
  async function provision(doc, { actor, ip, ua }) {
    let connectorToken
    try {
      await provisionCloudflare(doc)
      // The token before the credential: a credential is only ever minted for a claim that can
      // also hand out its token in the same answer.
      connectorToken = await cf.tunnelToken(doc.cf.tunnelId)
    } catch (error) {
      await audit({ actor, action: 'cf_error', claim: doc, ok: false, error, ip, ua })
      if (error instanceof CloudflareError && error.retryable) {
        // Cloudflare is down or slow: the claim stays pending and a replay resumes it.
        say(`claim ${doc._id} paused at a Cloudflare step (retryable)`)
        throw UPSTREAM()
      }
      const clean = await compensate(doc)
      await store.claims.update(doc._id, { status: 'failed', updatedAt: now() })
      await audit({ actor: { kind: 'system' }, action: 'claim', claim: doc, ok: false, error: { code: clean ? 'rolled_back' : 'needs_cleanup' }, ip, ua })
      if (error?.conflict) {
        say(`claim ${doc._id}: a DNS record for its name pointed elsewhere; rolled back`)
        await tell({ userId: null, subject: 'Team address DNS conflict', text: `A claim found a DNS record it does not own (claim ${doc._id}). It was rolled back.` })
        throw refuse('conflict', 'This team address could not be set up. Try another name.')
      }
      throw UPSTREAM()
    }
    let installCredential = null
    if (!doc.installCredential?.hash) {
      const minted = mintCredential()
      installCredential = minted.value
      doc.installCredential = minted.record
    }
    const activatedAt = doc.activatedAt || now()
    const ok = await store.claims.update(
      doc._id,
      { status: 'active', activatedAt, updatedAt: now(), ...(installCredential && { installCredential: doc.installCredential }) },
      { status: ['pending', 'active'] }
    )
    if (!ok) throw refuse('conflict', 'This team address changed while it was being set up. Try again.')
    doc.status = 'active'
    doc.activatedAt = activatedAt
    await audit({ actor, action: 'activate', claim: doc, ip, ua })
    return { doc, connectorToken, installCredential }
  }

  async function rotate(doc) {
    await cf.rotateSecret(doc.cf.tunnelId, randomBytes(32).toString('base64'))
    // Drops every connector, a stolen copy too; the owner's reconnects with the new token.
    await cf.deleteConnections(doc.cf.tunnelId)
    return cf.tunnelToken(doc.cf.tunnelId)
  }

  // Releases a claim at Cloudflare and in the database; each step counts a 404 as done.
  // hold: who may claim the name again before `until` (the owner, or nobody after a takedown).
  async function release(doc, { actor, ip, ua, hold }) {
    if (['released', 'failed'].includes(doc.status)) return { status: doc.status }
    // A suspended address released by its owner or its install keeps the takedown's hold: held
    // from everyone, the owner too, for a year. Otherwise the owner could release it and claim the
    // same name straight back on a fresh, unsuspended tunnel.
    const holdWith = hold || doc.releaseHold || (doc.status === 'suspended' ? { ownerId: null, until: now() + TAKEDOWN_HOLD_MS } : { ownerId: doc.ownerId, until: now() + HOLD_MS })
    await store.claims.update(doc._id, { status: 'releasing', updatedAt: now(), releaseHold: holdWith })
    try {
      for (const id of [doc.cf?.dnsRecordId, ...(doc.previousNames || []).map((entry) => entry.dnsRecordId)].filter(Boolean)) await cf.deleteDns(id)
      if (doc.cf?.tunnelId) {
        await cf.deleteConnections(doc.cf.tunnelId)
        await cf.deleteTunnel(doc.cf.tunnelId)
      }
    } catch (error) {
      await audit({ actor, action: 'cf_error', claim: doc, ok: false, error, ip, ua })
      say(`release of ${doc._id} left for the reconciler`)
      return { status: 'releasing' }
    }
    await store.claims.update(
      doc._id,
      { status: 'released', releasedAt: now(), updatedAt: now(), needsCleanup: false, previousNames: [], ...(doc.installCredential && { 'installCredential.revokedAt': now() }) },
      { unset: [...(doc.installCredential ? ['installCredential.hash'] : []), 'releaseHold'] }
    )
    for (const name of [doc.name, ...(doc.previousNames || []).map((entry) => entry.name)]) await store.tombstones.put({ name, ...holdWith })
    await audit({ actor, action: actor?.kind === 'system' ? 'reap' : 'release', claim: doc, ip, ua })
    return { status: 'released' }
  }

  // Ends a rename: only the new host stays in the ingress, the old records go.
  async function finishRename(doc) {
    if (!doc.previousNames?.length || !doc.cf?.tunnelId) return doc
    if (doc.status === 'active') await cf.putConfig(doc.cf.tunnelId, ingress([hostOf(doc.name)]))
    for (const entry of doc.previousNames) if (entry.dnsRecordId) await cf.deleteDns(entry.dnsRecordId)
    await store.claims.update(doc._id, { previousNames: [], updatedAt: now() })
    return { ...doc, previousNames: [] }
  }

  async function gateNew() {
    const s = settings()
    if (s.paused || (await store.flags.get('paused')) === true) throw refuse('paused', 'New team addresses are paused for a moment. Your install can use --local or --domain meanwhile.', { retryAfter: 600 })
    const count = await store.claims.countLive()
    if (count >= s.maxTunnels) {
      say(`new claims refused: ${count} live claims, cap ${s.maxTunnels}`)
      throw refuse('paused', 'New team addresses are paused for a moment. Your install can use --local or --domain meanwhile.', { retryAfter: 3600 })
    }
    if (count >= s.alertTunnels) say(`alert: ${count} live claims (alert at ${s.alertTunnels}, cap ${s.maxTunnels})`)
  }

  // ---- what callers use ----------------------------------------------------------------------

  return {
    hostOf,
    ingress,
    compensate,
    release,
    finishRename,
    audit,
    settings,

    /** GET /availability: from the database only (never Cloudflare). */
    async availability({ name: input, user, ip }) {
      await limit(`check-ip:${ipHash(ip) || 'unknown'}`, limits.checksPerMinutePerIp, 60_000, 'Too many checks. Wait a minute.')
      if (user?._id) await limit(`check-account:${user._id}`, limits.checksPerDayPerAccount, DAY_MS, 'Too many checks today.')
      const s = settings()
      const extra = await blocklist()
      const checked = checkName(input, extra, { e2e: Boolean(user?._id && s.e2eAccounts.includes(user._id)), namePrefix: s.namePrefix })
      if (checked.code === 'invalid_name') throw refuse('invalid_name', checked.message)
      const name = checked.name
      const available = checked.ok && (await free(name, user?._id ?? null))
      const body = { name, available }
      if (!available && user?._id) {
        const suggestions = []
        for (const candidate of suggestionsFor(name, { extra, namePrefix: s.namePrefix })) {
          if (suggestions.length >= 3) break
          if (await free(candidate, user._id)) suggestions.push(candidate)
        }
        body.suggestions = suggestions
      }
      return body
    },

    /** POST /: claim a name (idempotent). → { status, body } */
    async claim({ user, name: input, clientKey, label, idempotencyKey, ip, ua }) {
      const actor = { kind: 'user', id: user?._id }
      const owner = await account(user, { action: 'claim', name: input, ip, ua })
      const s = settings()
      const checked = checkName(input, await blocklist(), { e2e: s.e2eAccounts.includes(owner._id), namePrefix: s.namePrefix })
      if (checked.code === 'invalid_name') throw refuse('invalid_name', checked.message)
      const name = checked.name
      const key = sha256([owner._id, name, `${clientKey || ''}`.slice(0, 200), `${idempotencyKey || ''}`.slice(0, 200)].join('|'))
      const existing = await store.claims.byKey(owner._id, key)
      if (existing) {
        if (existing.status === 'active') {
          // A replay hands out the token again: the same hourly limit as /self/connector-token.
          await limit(`token:${existing._id}`, limits.tokenFetchesPerHour, 3_600_000, 'Too many token requests for this team address. Try again within the hour.')
          const connectorToken = await cf.tunnelToken(existing.cf.tunnelId).catch(() => {
            throw UPSTREAM()
          })
          await audit({ actor, action: 'token_fetch', claim: existing, ip, ua })
          return {
            status: 200,
            body: {
              claim: publicClaim(existing, s.zoneName),
              installCredential: null,
              connectorToken,
              hint: 'This claim was already made. Its install credential was given once; if it is lost, mint a new one (POST /:id/install-credential).',
            },
          }
        }
        const resumed = await provision(existing, { actor, ip, ua })
        return { status: 201, body: { claim: publicClaim(resumed.doc, s.zoneName), installCredential: resumed.installCredential, connectorToken: resumed.connectorToken } }
      }
      await gateNew()
      // A claim attempt answers "unavailable" like a check does, so it counts against the same
      // daily check limit: claiming is not a way round it to probe names or the blocklist.
      await limit(`check-account:${owner._id}`, limits.checksPerDayPerAccount, DAY_MS, 'Too many checks today.')
      if (!checked.ok || !(await free(name, owner._id))) {
        await audit({ actor, action: 'claim', name, ok: false, error: { code: 'unavailable' }, ip, ua })
        throw notAvailable(hostOf(name), name, checked, s.namePrefix)
      }
      if ((await store.claims.countLive(owner._id)) >= limits.perAccount)
        throw refuse('limit_reached', `An account may hold ${limits.perAccount} team addresses. Release one first (slatebox address release).`)
      await limit(`claims-day:${owner._id}`, limits.newPerDay, DAY_MS, 'Too many new team addresses today. Try again tomorrow.')
      await limit(`claims-30d:${owner._id}`, limits.newPer30Days, 30 * DAY_MS, 'Too many new team addresses this month.')
      const everywhere = await store.counter.take('claims-everywhere', limits.claimsPerHourEverywhere, 3_600_000)
      if (!everywhere.allowed) {
        // The circuit breaker: an unusual burst pauses new claims until an administrator looks.
        await store.flags.set('paused', true, 'circuit-breaker')
        say(`circuit breaker: more than ${limits.claimsPerHourEverywhere} claims in an hour; new claims paused`)
        await tell({ userId: null, subject: 'Team addresses paused by the circuit breaker', text: `More than ${limits.claimsPerHourEverywhere} claims in an hour. New claims are paused until an administrator unpauses them.` })
        throw refuse('paused', 'New team addresses are paused for a moment. Your install can use --local or --domain meanwhile.', { retryAfter: 600 })
      }
      const at = now()
      const doc = {
        _id: newId(),
        name,
        ownerId: owner._id,
        status: 'pending',
        cf: {},
        installCredential: null,
        idempotencyKey: key,
        createdAt: at,
        updatedAt: at,
        activatedAt: null,
        releasedAt: null,
        lastSeen: null,
        suspension: null,
        previousNames: [],
        label: typeof label === 'string' ? label.replace(/[^\x20-\x7e]/g, '').trim().slice(0, 64) || null : null,
      }
      try {
        await store.claims.insert(doc)
      } catch (error) {
        if (error?.code !== 11000) throw error
        await audit({ actor, action: 'claim', name, ok: false, error: { code: 'unavailable' }, ip, ua })
        throw UNAVAILABLE(hostOf(name))
      }
      await audit({ actor, action: 'claim', claim: doc, ip, ua })
      const made = await provision(doc, { actor, ip, ua })
      await tell({ userId: owner._id, subject: `Team address ${hostOf(name)} claimed`, text: `The team address ${hostOf(name)} was claimed on your Slatebox account${doc.label ? ` from "${doc.label}"` : ''}. Not you? Release it in Slatebox, or write to abuse@slatebox.com.` })
      return { status: 201, body: { claim: publicClaim(made.doc, s.zoneName), installCredential: made.installCredential, connectorToken: made.connectorToken } }
    },

    /** GET /: my claims. */
    async list({ user }) {
      if (!user?._id) throw refuse('unauthorized', 'Sign in to Slatebox to manage team addresses.')
      const zone = settings().zoneName
      return { claims: (await store.claims.byOwner(user._id)).map((doc) => publicClaim(doc, zone)) }
    },

    /** POST /:id/rename: the new name joins the tunnel; the install confirms with renameComplete. */
    async rename({ user, id, name: input, ip, ua }) {
      const actor = { kind: 'user', id: user?._id }
      await account(user, { action: 'rename', name: input, ip, ua })
      const doc = await owned(user, id)
      if (doc.status === 'suspended') throw refuse('suspended', doc.suspension?.notice || 'This team address is suspended.')
      if (doc.status !== 'active') throw refuse('conflict', 'This team address is not active yet.')
      const s = settings()
      const checked = checkName(input, await blocklist(), { e2e: s.e2eAccounts.includes(user._id), namePrefix: s.namePrefix })
      if (checked.code === 'invalid_name') throw refuse('invalid_name', checked.message)
      const name = checked.name
      if (name === doc.name) return { claim: publicClaim(doc, s.zoneName) }
      if (!checked.ok || !(await free(name, user._id))) {
        await audit({ actor, action: 'rename', claim: doc, ok: false, error: { code: 'unavailable' }, ip, ua })
        throw notAvailable(hostOf(name), name, checked, s.namePrefix)
      }
      await limit(`renames:${doc._id}`, limits.renamesPer30Days, 30 * DAY_MS, `A team address may be renamed ${limits.renamesPer30Days} times in 30 days.`)
      // Moving back to a name still in its grace period takes that name out of previousNames, so
      // finishing the rename never deletes the record the claim now answers on.
      const previous = [...(doc.previousNames || []).filter((entry) => entry.name !== name), { name: doc.name, until: now() + RENAME_GRACE_MS, dnsRecordId: doc.cf.dnsRecordId || null }]
      try {
        const ok = await store.claims.update(doc._id, { name, previousNames: previous, 'cf.dnsRecordId': null, updatedAt: now() }, { status: 'active' })
        if (!ok) throw refuse('conflict', 'This team address changed meanwhile. Try again.')
      } catch (error) {
        if (error?.code === 11000) throw UNAVAILABLE(hostOf(name))
        throw error
      }
      // The old name stays this owner's for 30 days.
      await store.tombstones.put({ name: doc.name, ownerId: doc.ownerId, until: now() + HOLD_MS })
      const next = { ...doc, name, previousNames: previous, cf: { ...doc.cf, dnsRecordId: null } }
      try {
        await cf.putConfig(doc.cf.tunnelId, ingress([hostOf(name), ...previous.map((entry) => hostOf(entry.name))]))
        const host = hostOf(name)
        const existing = await cf.findCname(host)
        if (existing && existing.content !== tunnelTarget(doc.cf.tunnelId)) throw Object.assign(new CloudflareError('A DNS record for this name points elsewhere', { status: 409 }), { conflict: true })
        const recordId = existing?.id || (await cf.createCname({ name: host, content: tunnelTarget(doc.cf.tunnelId), comment: dnsCommentFor(settings().instance, doc._id) }))?.id
        next.cf.dnsRecordId = recordId
        await store.claims.update(doc._id, { 'cf.dnsRecordId': recordId, updatedAt: now() })
      } catch (error) {
        await audit({ actor, action: 'cf_error', claim: next, ok: false, error, ip, ua })
        // Back to the old name, as it was.
        if (next.cf.dnsRecordId) await cf.deleteDns(next.cf.dnsRecordId).catch(() => {})
        await store.claims.update(doc._id, { name: doc.name, previousNames: doc.previousNames || [], 'cf.dnsRecordId': doc.cf.dnsRecordId, updatedAt: now() })
        await cf.putConfig(doc.cf.tunnelId, ingress([hostOf(doc.name), ...(doc.previousNames || []).map((entry) => hostOf(entry.name))])).catch(() => {})
        if (error?.conflict) throw refuse('conflict', 'This name could not be set up. Try another.')
        throw UPSTREAM()
      }
      await audit({ actor, action: 'rename', claim: next, ip, ua })
      await tell({ userId: doc.ownerId, subject: `Team address renamed to ${hostOf(name)}`, text: `${hostOf(doc.name)} is now ${hostOf(name)}. The old address works until your install confirms the move, at most 24 hours.` })
      return { claim: publicClaim(next, s.zoneName) }
    },

    /** POST /self/rename-complete: the install answers on its new address; the old one goes. */
    async renameComplete({ claim, ip, ua }) {
      const done = await finishRename(claim)
      await audit({ actor: { kind: 'install', id: claim._id }, action: 'rename', claim: done, ip, ua })
      return { claim: publicClaim(done, settings().zoneName) }
    },

    /** DELETE /:id by the owner. */
    async releaseByOwner({ user, id, ip, ua }) {
      await account(user, { action: 'release', ip, ua })
      const doc = await owned(user, id)
      const result = await release(doc, { actor: { kind: 'user', id: user._id }, ip, ua })
      return { status: result.status === 'released' ? 200 : 202, body: { id: doc._id, status: result.status } }
    },

    /** DELETE /self by the install (uninstall). */
    async releaseSelf({ claim, ip, ua }) {
      const result = await release(claim, { actor: { kind: 'install', id: claim._id }, ip, ua })
      return { status: result.status === 'released' ? 200 : 202, body: { id: claim._id, status: result.status } }
    },

    /** POST /:id/install-credential: a new credential (the old one stops), and a rotated tunnel. */
    async mintInstallCredential({ user, id, ip, ua }) {
      await account(user, { action: 'credential_mint', ip, ua })
      const doc = await owned(user, id)
      if (doc.status === 'suspended') throw refuse('suspended', doc.suspension?.notice || 'This team address is suspended.')
      if (doc.status !== 'active') throw refuse('conflict', 'This team address is not active yet.')
      let connectorToken
      try {
        connectorToken = await rotate(doc)
      } catch (error) {
        await audit({ actor: { kind: 'user', id: user._id }, action: 'cf_error', claim: doc, ok: false, error, ip, ua })
        throw UPSTREAM()
      }
      const minted = mintCredential()
      minted.record.rotatedAt = now()
      await store.claims.update(doc._id, { installCredential: minted.record, updatedAt: now() })
      await audit({ actor: { kind: 'user', id: user._id }, action: 'credential_mint', claim: doc, ip, ua })
      await audit({ actor: { kind: 'user', id: user._id }, action: 'token_rotate', claim: doc, ip, ua })
      await tell({ userId: doc.ownerId, subject: `New install credential for ${hostOf(doc.name)}`, text: `A new install credential was made for ${hostOf(doc.name)}, and the old one stopped working. Not you? Release the address in Slatebox, or write to abuse@slatebox.com.` })
      return { claim: publicClaim(doc, settings().zoneName), installCredential: minted.value, connectorToken }
    },

    /** The claim an install credential belongs to, or null. */
    async authenticateInstall(bearer) {
      const match = typeof bearer === 'string' ? bearer.match(CREDENTIAL_SHAPE) : null
      if (!match) return null
      const doc = await store.claims.byCredentialPrefix(match[1])
      const want = doc?.installCredential?.hash
      if (!want || ['released', 'failed'].includes(doc.status)) return null
      const have = hashApiToken(bearer)
      if (want.length !== have.length || !timingSafeEqual(Buffer.from(want), Buffer.from(have))) return null
      return doc
    },

    /** GET /self */
    self({ claim }) {
      return { claim: publicClaim(claim, settings().zoneName) }
    },

    /** POST /self/connector-token: fetched from Cloudflare, handed on, never kept. */
    async connectorToken({ claim, rotate: rotating = false, ip, ua }) {
      const actor = { kind: 'install', id: claim._id }
      if (claim.status === 'suspended') throw refuse('suspended', claim.suspension?.notice || 'This team address was suspended. Write to abuse@slatebox.com to appeal.')
      if (claim.status !== 'active') throw refuse('not_found', 'This team address is not active.')
      await limit(`token:${claim._id}`, limits.tokenFetchesPerHour, 3_600_000, 'Too many token requests for this team address. Try again within the hour.')
      let connectorToken
      try {
        connectorToken = rotating ? await rotate(claim) : await cf.tunnelToken(claim.cf.tunnelId)
      } catch (error) {
        await audit({ actor, action: 'cf_error', claim, ok: false, error, ip, ua })
        throw UPSTREAM()
      }
      await store.claims.update(claim._id, { 'installCredential.lastUsedAt': now(), ...(rotating && { 'installCredential.rotatedAt': now() }) })
      await audit({ actor, action: rotating ? 'token_rotate' : 'token_fetch', claim, ip, ua })
      return { connectorToken }
    },

    // ---- administrators (Cloud's administrators only; meteor.js checks the claim) --------------

    async adminList({ q, describeOwner = async () => null } = {}) {
      const zone = settings().zoneName
      const rows = await store.claims.search({ q, limit: 200 })
      const extra = await blocklist()
      return {
        paused: settings().paused || (await store.flags.get('paused')) === true,
        pausedBySettings: settings().paused,
        live: await store.claims.countLive(),
        maxTunnels: settings().maxTunnels,
        claims: await Promise.all(
          rows.map(async (doc) => ({
            ...publicClaim(doc, zone),
            ownerId: doc.ownerId,
            owner: await describeOwner(doc.ownerId),
            tunnelId: doc.cf?.tunnelId || null,
            suspension: doc.suspension || null,
            needsCleanup: Boolean(doc.needsCleanup),
            releasedAt: doc.releasedAt || null,
            // Only administrators see why a name is refused.
            refusal: refusal(doc.name, extra),
          }))
        ),
      }
    },

    async adminWhy(input) {
      const name = normalizeName(input)
      const checked = checkName(name, await blocklist(), { e2e: true, namePrefix: settings().namePrefix })
      if (checked.code === 'invalid_name') return { name, reason: 'invalid_name' }
      if (checked.reason) return { name, reason: checked.reason }
      if (await store.claims.liveByName(name)) return { name, reason: 'taken' }
      const hold = await store.tombstones.get(name)
      if (hold) return { name, reason: hold.ownerId === null ? 'taken_down' : 'held', until: hold.until }
      return { name, reason: null }
    },

    async suspend({ admin, id, reason, notice, ip }) {
      const doc = await store.claims.get(id)
      if (!doc || !['active', 'pending'].includes(doc.status)) throw refuse('not_found', 'No live team address with that id.')
      if (doc.cf?.tunnelId) {
        try {
          await cf.putConfig(doc.cf.tunnelId, SUSPENDED_INGRESS)
        } catch (error) {
          await audit({ actor: { kind: 'admin', id: admin }, action: 'cf_error', claim: doc, ok: false, error, ip })
          throw UPSTREAM()
        }
      }
      const suspension = { at: now(), by: admin, reason: `${reason || ''}`.slice(0, 500), notice: `${notice || 'This team address was suspended. Write to abuse@slatebox.com to appeal.'}`.slice(0, 500) }
      await store.claims.update(doc._id, { status: 'suspended', suspension, updatedAt: now() })
      await audit({ actor: { kind: 'admin', id: admin }, action: 'suspend', claim: doc, ip })
      await tell({ userId: doc.ownerId, subject: `Team address ${hostOf(doc.name)} suspended`, text: `${suspension.notice}\n\nTo appeal, write to abuse@slatebox.com.` })
      return { id: doc._id, status: 'suspended' }
    },

    async unsuspend({ admin, id, ip }) {
      const doc = await store.claims.get(id)
      if (!doc || doc.status !== 'suspended') throw refuse('not_found', 'No suspended team address with that id.')
      // A claim suspended before it was set up has no tunnel to restore: it goes back to pending,
      // where a replay of the claim finishes it (or the reaper releases it).
      const status = doc.activatedAt ? 'active' : 'pending'
      if (doc.cf?.tunnelId) {
        try {
          await cf.putConfig(doc.cf.tunnelId, ingress([hostOf(doc.name), ...(doc.previousNames || []).map((entry) => hostOf(entry.name))]))
        } catch (error) {
          await audit({ actor: { kind: 'admin', id: admin }, action: 'cf_error', claim: doc, ok: false, error, ip })
          throw UPSTREAM()
        }
      }
      await store.claims.update(doc._id, { status, suspension: null, updatedAt: now() }, { status: 'suspended' })
      await audit({ actor: { kind: 'admin', id: admin }, action: 'unsuspend', claim: doc, ip })
      return { id: doc._id, status }
    },

    // A takedown's end: released, and the name held from everyone for a year.
    async forceRelease({ admin, id, ip }) {
      const doc = await store.claims.get(id)
      if (!doc || ['released', 'failed'].includes(doc.status)) throw refuse('not_found', 'No live team address with that id.')
      const result = await release(doc, { actor: { kind: 'admin', id: admin }, ip, hold: { ownerId: null, until: now() + TAKEDOWN_HOLD_MS } })
      return { id: doc._id, status: result.status }
    },

    async setPaused({ admin, paused }) {
      await store.flags.set('paused', paused === true, admin)
      await audit({ actor: { kind: 'admin', id: admin }, action: paused ? 'pause' : 'unpause', name: '*' })
      return { paused: paused === true }
    },

    blocklistList: () => store.blocklist.list(),
    async blocklistAdd({ admin, pattern, kind, reason }) {
      const clean = normalizeName(pattern)?.replace(/[^a-z0-9-]/g, '')
      if (!clean || clean.length > 32) throw refuse('invalid_name', 'A blocklist pattern is a–z, 0–9 and hyphens, at most 32 characters.')
      const id = await store.blocklist.add({ pattern: clean, kind: kind === 'substring' ? 'substring' : 'exact', reason: `${reason || ''}`.slice(0, 200), by: admin, at: now() })
      return { id }
    },
    blocklistRemove: ({ id }) => store.blocklist.remove(id),
    auditList: ({ claimId, limit: count = 100 } = {}) => store.audit.list({ claimId, limit: Math.min(500, count) }),
  }
}
