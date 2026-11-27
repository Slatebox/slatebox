// "Sign in with SSO": the Meteor side, in Slatebox Cloud and on a self-hosted server alike.
//
// Each team can have its own connections (Team settings > Sign-in & security): OpenID Connect
// (Okta, Entra ID, Google Workspace, any OIDC provider) or SAML 2.0, each signing in the addresses
// of the domains the team proved it owns. A self-hosted server's bundled Keycloak
// (Meteor.settings.sso, SLATEBOX_SSO=keycloak) is one more connection, "keycloak", of the default
// team, started by the button on the sign-in page and set by the server administrator.
// The protocol, the account rules and the policies live in the plain modules beside this file and
// are unit-tested there.
//
//   POST /sso/discover {email}       which connection signs in this address: { connectionId, label,
//                                    requireSso } or {} (rate limited)
//   GET  /sso/start?c=&next=&verifier=
//                                    starts a sign-in; without c, the server's own connection. The
//                                    verifier is a random value the browser tab keeps: the sign-in
//                                    is bound to it
//   GET  /sso/callback               finishes an OpenID Connect sign-in
//   POST /sso/saml/:id/acs           finishes a SAML sign-in
//   GET  /sso/saml/:id/metadata      the SP metadata for a team's IdP
//   POST /sso/oidc/:id/backchannel-logout
//                                    the provider ended a person's session: theirs here end too
// Both callbacks hand the browser a one-time ticket in the URL fragment of /sso/done, which the
// same tab exchanges, with its verifier, for a Meteor session through the "sso" login handler.
//
// Background jobs, each under a lease so one server process does it at a time: the session check
// (a refused refresh at the provider signs the account out everywhere), the session length of
// each team connection, and the daily DNS check of every verified domain.
import { Meteor } from 'meteor/meteor'
import { WebApp } from 'meteor/webapp'
import { Accounts } from 'meteor/accounts-base'
import { Mongo } from 'meteor/mongo'
import { Email } from 'meteor/email'
import { Random } from 'meteor/random'
import express from 'express'
import dns from 'node:dns/promises'
import { hkdfSync } from 'node:crypto'
import { APILinks, LoginLinks, Organizations, Permissions, SlateApiTokens, SystemSettings } from '../../imports/api/common/models'
import CONSTANTS from '../../imports/api/common/constants'
import { isCloudEdition } from '../../imports/api/common/edition.mjs'
import { teamSecurityOn } from '../../imports/api/common/team-security.mjs'
import { withTrustedFields } from '../common/accounts'
import { createPublicFetch } from '../common/public-fetch.mjs'
import { loadMasterKey, open } from '../metering/vault.mjs'
import { STATE_COOKIE, SsoError, beginSignIn, completeSignIn, discover, endSessionUrl, openState, refreshSession, verifyLogoutToken } from './oidc.mjs'
import { beginSamlSignIn, completeSamlSignIn, mongoSamlStore, spMetadata } from './saml.mjs'
import {
  SESSION_CHECK_CAP, SESSION_CHECK_ID, connectionIssuer, decideAccount, decideTeamAccount, isBreakGlass, joinTeamUpdate, linkModifier,
  newUserDocument, revokeCredentials, revokedModifier, sessionCheckQuery, sessionCheckRecord, ssoIdentity, ssoService, teamIdentity, teamToJoin,
} from './accounts.mjs'
import {
  METHODS_CLOSED_UNDER_SSO_ONLY, REQUIRE_SSO_MESSAGE, SESSION_ENDED, SSO_ONLY_MESSAGE, closedPathUnderSsoOnly, loginRefusal, mayCreateUser,
  requestAddress, requireSsoCovers, resumeRefusal, ssoSessionExpired, ssoSettings, teamPolicyRefusal,
} from './policy.mjs'
import { MANAGED_KEYCLOAK_ID, SsoConfigError, assertedEmail, domainOf, managedConnection, routableDomains } from './connections.mjs'
import { afterCheck, dueForRecheck, justStoppedRouting, lookupChallenge } from './domains.mjs'
import { TeamSsoError, createTeamSso, secretOwner } from './admin.mjs'
import { createTicketStore, mongoTicketStorage } from './tickets.mjs'
import { takeLease } from './lease.mjs'
import { Passkeys } from '../passkeys/meteor'
import { gateHandlers } from './gate.mjs'
import { membersChanged } from '../methods/business'
import { clearSetupCookie, completeSetupWith, defaultTeamId, pendingSsoSetup } from '../self-host-setup/meteor'
import { audit } from '../audit/recorder.mjs'

export const SsoConnections = new Mongo.Collection('ssoConnections')
const SsoDomainClaims = new Mongo.Collection('ssoDomainClaims')
const SsoTickets = new Mongo.Collection('ssoTickets')
const SsoRequests = new Mongo.Collection('ssoRequests')
const SsoLeases = new Mongo.Collection('ssoLeases')

const log = (line) => console.log(`sso: ${line}`)
const sso = ssoSettings(Meteor.settings)
const cloud = isCloudEdition(Meteor.settings)
const master = loadMasterKey()
// The sealed state cookie's key: the server's own SSO key, else one derived from the key that
// seals secrets. Without either, team connections over OpenID Connect cannot start a sign-in.
const stateKey = sso?.stateKey ||
  (master ? Buffer.from(hkdfSync('sha256', master.key, Buffer.from('slatebox-sso'), Buffer.from('state-cookie'), 32)).toString('base64url') : null)
const origin = () => String(Meteor.settings.public?.baseUrl || Meteor.absoluteUrl()).replace(/\/$/, '')
// Slatebox Cloud reaches a team's identity provider only at a public address (https, checked
// DNS); a self-hosted server may use one on its own network.
const providerFetch = cloud ? createPublicFetch() : undefined
const tickets = createTicketStore({ storage: mongoTicketStorage(SsoTickets.rawCollection()) })
const requests = mongoSamlStore(SsoRequests.rawCollection())
const credentials = { apiTokens: SlateApiTokens, loginLinks: LoginLinks, apiLinks: APILinks, passkeys: Passkeys }
const secure = () => origin().startsWith('https:')

// ---- connections ----

const CACHE_MS = 5000
const cache = new Map()
const forget = (id) => cache.delete(id)

async function managed() {
  return sso ? managedConnection(sso, await defaultTeamId(sso)) : null
}

async function connectionById(id) {
  if (typeof id !== 'string' || !id) return null
  if (id === MANAGED_KEYCLOAK_ID) return managed()
  const hit = cache.get(id)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.connection
  const connection = await SsoConnections.findOneAsync({ _id: id })
  cache.set(id, { at: Date.now(), connection })
  return connection
}

async function connectionForAddress(email) {
  const domain = domainOf(email)
  if (!domain) return null
  const claim = await SsoDomainClaims.findOneAsync({ _id: domain })
  if (!claim) return null
  const connection = await connectionById(claim.connectionId)
  return connection && connection.orgId === claim.orgId && routableDomains(connection).includes(domain) ? connection : null
}

const managedConfig = sso && {
  issuer: sso.issuer,
  authorizationEndpoint: sso.authorizationEndpoint,
  tokenEndpoint: sso.tokenEndpoint,
  jwksUri: sso.jwksUri,
  ...(sso.endSessionEndpoint && { endSessionEndpoint: sso.endSessionEndpoint }),
  clientId: sso.clientId,
  clientSecret: sso.clientSecret,
  redirectUri: sso.redirectUri,
  // the bundled Keycloak's token endpoint and keys are on the container's loopback
  allowHttp: true,
}

const DISCOVERY_MS = 10 * 60_000
const discovered = new Map()
async function endpointsOf(connection) {
  const hit = discovered.get(connection._id)
  if (hit && hit.issuer === connection.oidc.issuer && Date.now() - hit.at < DISCOVERY_MS) return hit.endpoints
  const endpoints = await discover(connection.oidc.issuer, { fetch: providerFetch })
  discovered.set(connection._id, { at: Date.now(), issuer: connection.oidc.issuer, endpoints })
  return endpoints
}

/** The endpoints and client of an OpenID Connect connection, with its secret opened for this call. */
async function oidcConfig(connection) {
  if (connection.managed) return managedConfig
  if (!master) throw new SsoError('config', 'client secrets need SLATEBOX_KEY_ENCRYPTION_KEY on this server')
  const endpoints = await endpointsOf(connection)
  return {
    ...endpoints,
    clientId: connection.oidc.clientId,
    clientSecret: open({ master, owner: secretOwner(connection), cipher: connection.oidc.secret }),
    redirectUri: `${origin()}/sso/callback`,
  }
}

async function teamOf(orgId) {
  return orgId ? Organizations.findOneAsync({ _id: orgId }) : null
}
const gateFor = async (orgId) => teamSecurityOn({ settings: Meteor.settings, org: await teamOf(orgId) })

// ---- accounts ----

// An account in no team yet joins the default team as a Member (no people claims, not the owner).
// Anyone already in a team, the first admin and team owners included, keeps their team and roles.
async function joinDefaultTeam(user) {
  const orgId = teamToJoin(user, { defaultRole: sso.defaultRole, defaultTeamId: await defaultTeamId(sso) })
  if (!orgId) return
  const { selector, modifier } = joinTeamUpdate(user._id, orgId)
  if (await Meteor.users.updateAsync(selector, modifier)) {
    log(`account ${user._id} joined the default team as a member`)
    membersChanged(orgId)
  }
}

async function credentialCounts(user) {
  if (!user) return { apiTokens: 0, passkeys: 0 }
  return {
    apiTokens: await SlateApiTokens.find({ userId: user._id, revokedAt: null }).countAsync(),
    passkeys: await Passkeys.find({ userId: user._id }).countAsync(),
  }
}

// The server's own connection (the bundled Keycloak): the server's account rules.
async function managedAccountFor(claims, refreshToken) {
  const identity = { ...ssoIdentity(claims, sso.provider), connectionId: MANAGED_KEYCLOAK_ID }
  const bySubject = await Meteor.users.findOneAsync({ 'services.sso.issuer': sso.provider, 'services.sso.subject': identity.subject })
  const byEmail = !bySubject && identity.email ? await Accounts.findUserByEmail(identity.email) : undefined
  const counts = await credentialCounts(byEmail)
  const decision = decideAccount(identity, { bySubject, byEmail, byEmailApiTokens: counts.apiTokens, byEmailPasskeys: counts.passkeys, domains: sso.domains })
  if (decision.action === 'refuse') throw new SsoError('account', decision.reason)
  if (decision.action === 'create') {
    // Null while the setup link makes the first admin: completeSetupWith gives that account its own team.
    const orgId = teamToJoin({}, { defaultRole: sso.defaultRole, defaultTeamId: await defaultTeamId(sso) })
    const doc = newUserDocument(identity, refreshToken, Date.now(), { orgId })
    const userId = await withTrustedFields(orgId ? { orgId } : {}, () => Accounts.insertUserDoc({ profile: doc.profile }, doc))
    log(`account ${userId} created at first sign-in${orgId ? ', a member of the default team' : ''}`)
    if (orgId) membersChanged(orgId)
    return userId
  }
  if (decision.action === 'link') {
    // From here on the account signs in with SSO only: no password, no earlier session, no
    // earlier API token, sign-in link or passkey.
    await Meteor.users.updateAsync({ _id: byEmail._id }, linkModifier(byEmail, identity, refreshToken))
    await revokeCredentials(credentials, byEmail._id)
    log(`account ${byEmail._id} linked to its single sign-on identity; its password, sessions, API tokens and passkeys ended`)
    // An invitation keeps the team it was made for; an account in no team joins the default one.
    await joinDefaultTeam(byEmail)
    return byEmail._id
  }
  const set = { 'services.sso': ssoService(identity, refreshToken) }
  const index = (bySubject.emails || []).findIndex(entry => entry.address?.toLowerCase() === identity.email)
  if (index >= 0) set[`emails.${index}.verified`] = true
  await Meteor.users.updateAsync({ _id: bySubject._id }, { $set: set })
  // An account made at first sign-in before accounts joined the default team gets there now.
  await joinDefaultTeam(bySubject)
  return bySubject._id
}

/** What a team connection's sign-in would do, read only: the address, the identity and the decision. */
async function planTeamAccount(connection, claims) {
  let email
  try {
    email = assertedEmail(connection, claims)
  } catch (error) {
    if (error instanceof SsoConfigError) return { decision: { action: 'refuse', reason: error.message } }
    throw error
  }
  const identity = teamIdentity(claims, connection, email)
  const bySubject = await Meteor.users.findOneAsync({ 'services.sso.issuer': identity.issuer, 'services.sso.subject': identity.subject })
  const byEmail = !bySubject ? await Accounts.findUserByEmail(email) : undefined
  const counts = await credentialCounts(byEmail)
  const decision = decideTeamAccount(identity, { connection, bySubject, byEmail, byEmailApiTokens: counts.apiTokens, byEmailPasskeys: counts.passkeys })
  return { email, identity, decision, bySubject, byEmail }
}

async function joinTeam(userId, orgId) {
  const { selector, modifier } = joinTeamUpdate(userId, orgId)
  if (await Meteor.users.updateAsync(selector, modifier)) {
    log(`account ${userId} joined team ${orgId} as a member at single sign-on`)
    membersChanged(orgId)
  }
}

async function teamAccountFor(connection, claims, refreshToken) {
  const { identity, decision, bySubject, byEmail } = await planTeamAccount(connection, claims)
  if (decision.action === 'refuse') throw new SsoError('account', decision.reason)
  if (decision.action === 'create') {
    const doc = newUserDocument(identity, refreshToken, Date.now(), { orgId: connection.orgId })
    const userId = await withTrustedFields({ orgId: connection.orgId }, () => Accounts.insertUserDoc({ profile: doc.profile }, doc))
    log(`account ${userId} created at first sign-in, a member of team ${connection.orgId}`)
    membersChanged(connection.orgId)
    return userId
  }
  if (decision.action === 'link') {
    const keep = isBreakGlass(byEmail, connection)
    await Meteor.users.updateAsync({ _id: byEmail._id }, linkModifier(byEmail, identity, refreshToken, Date.now(), { keepPassword: keep }))
    await revokeCredentials(credentials, byEmail._id, Date.now(), { keepPasskeys: keep })
    log(`account ${byEmail._id} linked to connection ${connection._id}${keep ? ' (break-glass: its password and passkeys stay)' : '; its password, sessions, API tokens and passkeys ended'}`)
    if (decision.join) await joinTeam(byEmail._id, connection.orgId)
    return byEmail._id
  }
  const set = { 'services.sso': ssoService(identity, refreshToken) }
  const index = (bySubject.emails || []).findIndex(entry => entry.address?.toLowerCase() === identity.email)
  if (index >= 0) set[`emails.${index}.verified`] = true
  await Meteor.users.updateAsync({ _id: bySubject._id }, { $set: set })
  if (decision.join) await joinTeam(bySubject._id, connection.orgId)
  return bySubject._id
}

// ---- HTTP ----

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return undefined
}

function stateCookie(value, { maxAge }) {
  return `${STATE_COOKIE}=${value}; Path=/sso; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure() ? '; Secure' : ''}`
}

function redirect(res, location, cookie) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) })
  res.end()
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// "Try it" (Team settings): the admin signs in once in a popup and sees what Slatebox would do,
// with nothing linked, made or signed in.
const TRIED_CLAIMS = ['sub', 'email', 'email_verified', 'given_name', 'family_name', 'name', 'preferred_username', 'upn', 'tid', 'xms_edov', 'hd']
async function renderTry(res, connection, claims) {
  const plan = await planTeamAccount(connection, claims)
  const outcome = {
    create: `A new account for ${plan.email} would be made, a Member of your team.`,
    link: `The existing account ${plan.email} would be linked to this connection${plan.decision.join ? ' and join your team' : ''}.`,
    login: `${plan.email} would sign in to the account already linked to this connection.`,
    refuse: `The sign-in would be refused: ${plan.decision.reason}.`,
  }[plan.decision.action]
  const rows = TRIED_CLAIMS.filter((name) => claims[name] !== undefined)
    .map((name) => `<tr><th>${escapeHtml(name)}</th><td>${escapeHtml(typeof claims[name] === 'string' ? claims[name] : JSON.stringify(claims[name]))}</td></tr>`).join('')
  const ok = plan.decision.action !== 'refuse'
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" })
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Single sign-on test</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px;color:#1d2a22}h1{font-size:20px}p.r{padding:10px 12px;border-radius:8px;background:${ok ? '#e7f4ea' : '#fbe9e7'}}table{border-collapse:collapse}th,td{text-align:left;padding:4px 10px;border-bottom:1px solid #e1e3d6;font-size:14px}th{color:#58645c;font-weight:600}</style></head>
<body><h1>${escapeHtml(connection.label)}: test sign-in</h1><p class="r" data-sso-try="${ok ? 'ok' : 'refused'}">${escapeHtml(outcome)}</p>
<p>Nothing was saved and nobody was signed in. What the identity provider sent:</p><table>${rows}</table>
<p>You can close this window.</p></body></html>`)
}

async function finishSignIn(req, res, { connection, claims, refreshToken, binding, next, started, clear }) {
  if (started.try) {
    const tried = await requests.take(`try:${started.try}`)
    if (!tried || JSON.parse(tried).connectionId !== connection._id) throw new SsoError('no-sign-in', 'the test sign-in expired')
    await renderTry(res, connection, claims)
    return
  }
  // A self-hosted server's first sign-in through its setup link (the server's own connection, the
  // only one before setup) makes the server administrator.
  const setup = connection.managed ? await pendingSsoSetup(req) : null
  let userId
  if (setup) userId = await completeSetupWith(setup.token, () => managedAccountFor(claims, refreshToken), { teamName: setup.teamName, via: 'sso' })
  else if (connection.managed) userId = await managedAccountFor(claims, refreshToken)
  else userId = await teamAccountFor(connection, claims, refreshToken)
  const fragment = new URLSearchParams({ ticket: await tickets.issue(userId, binding, { connectionId: connection._id }), next })
  redirect(res, `/sso/done#${fragment}`, setup ? [clear, clearSetupCookie()].filter(Boolean) : clear)
}

function refused(res, error, clear) {
  const code = error instanceof SsoError ? error.code : 'failed'
  log(`sign-in refused (${code}${error instanceof SsoError && ['account', 'saml', 'discovery', 'config'].includes(code) ? `: ${error.message}` : ''})`)
  if (!(error instanceof SsoError)) console.error('sso: sign-in failed', error?.message)
  redirect(res, `/login?sso=${encodeURIComponent(code)}`, clear)
}

// Behind the proxies in front of the app (HTTP_FORWARDED_COUNT): policy.mjs requestAddress.
const forwardedCount = Number.parseInt(process.env.HTTP_FORWARDED_COUNT, 10) || 0

// The routes anyone may call without a session, per address a minute: asking which connection
// signs in an address (20), starting a sign-in (30: each start stores a request or fetches the
// provider's discovery) and a provider's back-channel logout (60: each fetches its keys). A full
// table drops its stale windows, never the live ones (clearing it all would reset every limit).
function perAddress(limit) {
  const seen = new Map()
  return (req) => {
    const key = requestAddress(req, forwardedCount)
    const now = Date.now()
    const window = (seen.get(key) || []).filter((at) => now - at < 60_000)
    window.push(now)
    seen.set(key, window)
    if (seen.size > 10_000) {
      for (const [other, times] of seen) if (!times.some((at) => now - at < 60_000)) seen.delete(other)
    }
    return window.length > limit
  }
}
const tooMany = perAddress(20)
const tooManyStarts = perAddress(30)
const tooManyLogouts = perAddress(60)

function routes() {
  const handlers = WebApp.handlers || WebApp.connectHandlers
  const json = express.json({ limit: '2kb' })
  const form = express.urlencoded({ extended: false, limit: '600kb' })

  handlers.use('/sso/discover', json, async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, {})
    if (tooMany(req)) return sendJson(res, 429, { error: 'Too many tries. Wait a minute.' })
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : ''
    const connection = email.includes('@') ? await connectionForAddress(email) : null
    if (!connection) return sendJson(res, 200, {})
    return sendJson(res, 200, { connectionId: connection._id, label: connection.label, requireSso: connection.policy?.requireSso === true })
  })

  handlers.use('/sso/start', async (req, res) => {
    const params = new URL(req.url, 'http://x').searchParams
    if (tooManyStarts(req)) return refused(res, new SsoError('too-many', 'too many sign-ins started from one address'))
    try {
      const connection = await connectionById(params.get('c') || (sso ? MANAGED_KEYCLOAK_ID : ''))
      if (!connection?.enabled) throw new SsoError('no-connection', 'no such connection')
      const tryToken = params.get('try')
      const extra = { c: connection._id, ...(tryToken && { try: tryToken.slice(0, 64) }) }
      if (tryToken) {
        const pending = await requests.get(`try:${extra.try}`)
        if (!pending || JSON.parse(pending).connectionId !== connection._id) throw new SsoError('no-sign-in', 'the test sign-in expired')
      }
      // without a team that may use it, a connection signs nobody in (the switch, team-security.mjs, never locks a team out)
      if (!connection.managed && !connection.orgId) throw new SsoError('no-connection', 'the connection has no team')
      if (connection.protocol === 'saml') {
        const started = await beginSamlSignIn({ connection, origin: origin(), store: requests, next: params.get('next'), verifier: params.get('verifier'), extra })
        return redirect(res, started.url)
      }
      if (!stateKey) throw new SsoError('config', 'single sign-on needs SLATEBOX_KEY_ENCRYPTION_KEY on this server')
      const config = await oidcConfig(connection)
      const started = beginSignIn({ config, key: stateKey, next: params.get('next'), verifier: params.get('verifier'), extra, loginHint: params.get('email') })
      return redirect(res, started.url, stateCookie(started.cookie, { maxAge: 600 }))
    } catch (error) {
      return refused(res, error instanceof SsoError ? error : new SsoError('failed', error?.message))
    }
  })

  handlers.use('/sso/callback', async (req, res) => {
    const query = Object.fromEntries(new URL(req.url, 'http://x').searchParams)
    const clear = stateCookie('', { maxAge: 0 })
    try {
      const cookie = cookieValue(req.headers.cookie, STATE_COOKIE)
      const peek = stateKey ? openState(stateKey, cookie) : null
      if (!peek) throw new SsoError('no-sign-in', 'the sign-in expired or was not started here')
      const connection = await connectionById(peek.c || MANAGED_KEYCLOAK_ID)
      if (!connection?.enabled || connection.protocol !== 'oidc') throw new SsoError('no-connection', 'the connection is gone or off')
      const result = await completeSignIn({ config: await oidcConfig(connection), key: stateKey, cookie, query, fetch: providerFetch })
      await finishSignIn(req, res, { connection, claims: result.claims, refreshToken: result.refreshToken, binding: result.binding, next: result.next, started: result.started, clear })
    } catch (error) {
      refused(res, error, clear)
    }
  })

  handlers.use('/sso/saml', form, async (req, res) => {
    const match = /^\/([A-Za-z0-9]{1,40})\/(acs|metadata)\/?(\?.*)?$/.exec(req.url)
    const connection = match ? await connectionById(match[1]) : null
    if (!connection || connection.protocol !== 'saml') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('No such connection.')
    }
    if (match[2] === 'metadata') {
      res.writeHead(200, { 'Content-Type': 'application/samlmetadata+xml; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(spMetadata(connection, { origin: origin() }))
    }
    if (req.method !== 'POST') return redirect(res, '/login?sso=no-sign-in')
    try {
      if (!connection.enabled) throw new SsoError('no-connection', 'the connection is off')
      const result = await completeSamlSignIn({ connection, origin: origin(), store: requests, body: req.body })
      return await finishSignIn(req, res, { connection, claims: result.claims, binding: result.binding, next: result.next, started: result.started })
    } catch (error) {
      return refused(res, error)
    }
  })

  handlers.use('/sso/oidc', form, async (req, res) => {
    const match = /^\/([A-Za-z0-9]{1,40})\/backchannel-logout\/?$/.exec(req.url)
    if (!match || req.method !== 'POST') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('Not found.')
    }
    if (tooManyLogouts(req)) return sendJson(res, 429, { error: 'too_many_requests' })
    try {
      const connection = await connectionById(match[1])
      if (!connection || connection.protocol !== 'oidc') throw new SsoError('no-connection', 'no such connection')
      const config = await oidcConfig(connection)
      const jwks = await (await (providerFetch || fetch)(config.jwksUri, { headers: { accept: 'application/json' } })).json()
      const { subject } = await verifyLogoutToken(req.body?.logout_token, { config, jwks })
      if (subject) {
        const issuer = connection.managed ? sso.provider : connectionIssuer(connection)
        const user = await Meteor.users.findOneAsync({ 'services.sso.issuer': issuer, 'services.sso.subject': subject }, { fields: { _id: 1 } })
        if (user) {
          await Meteor.users.updateAsync({ _id: user._id }, { $pull: { 'services.resume.loginTokens': { ssoConnectionId: connection._id } } })
          log(`account ${user._id} signed out: its identity provider ended the session (back-channel logout)`)
        }
      }
      res.writeHead(200, { 'Cache-Control': 'no-store' })
      return res.end()
    } catch (error) {
      log(`back-channel logout refused (${error instanceof SsoError ? error.message : 'failed'})`)
      res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      return res.end(JSON.stringify({ error: 'invalid_request' }))
    }
  })
}

// ---- sign-in rules ----

async function teamAdminEmails(orgId) {
  const admins = await Permissions.find({ orgId, claimId: CONSTANTS.claims.admin._id }, { fields: { userId: 1 } }).fetchAsync()
  const people = await Meteor.users.find({ orgId, $or: [{ isOrgOwner: true }, { _id: { $in: admins.map((a) => a.userId) } }] }, { fields: { emails: 1 } }).fetchAsync()
  return people.map((p) => p.emails?.[0]?.address).filter(Boolean)
}


const findLoginToken = (user, token) => {
  if (typeof token !== 'string' || !token) return null
  const hashed = Accounts._hashLoginToken(token)
  return (user?.services?.resume?.loginTokens || []).find((entry) => entry.hashedToken === hashed) || null
}

/** The team connection whose "Require single sign-on" covers this account, or null. */
async function requiredConnectionFor(user) {
  if (!user || user.isAnonymous || !user.orgId) return null
  for (const entry of user.emails || []) {
    const connection = await connectionForAddress(entry?.address)
    if (connection?.policy?.requireSso && requireSsoCovers(user, connection, { domains: routableDomains(connection), breakGlass: isBreakGlass(user, connection) })) {
      return connection
    }
  }
  return null
}

/** Whether this account signs in only with a team connection's single sign-on (sessions from elsewhere do not count). */
async function teamSsoOnly(user) {
  if (!user || user.isAnonymous) return false
  const linkedId = user.services?.sso?.connectionId
  if (linkedId && linkedId !== MANAGED_KEYCLOAK_ID) {
    const linked = await connectionById(linkedId)
    if (linked && !isBreakGlass(user, linked)) return true
  }
  return Boolean(await requiredConnectionFor(user))
}

async function breakGlassFor(user) {
  const connectionId = user?.services?.sso?.connectionId
  if (!connectionId || connectionId === MANAGED_KEYCLOAK_ID) return false
  const connection = await connectionById(connectionId)
  return Boolean(connection) && isBreakGlass(user, connection)
}

function accountsHooks() {
  Accounts.registerLoginHandler('sso', async (options) => {
    if (typeof options?.ssoTicket !== 'string') return undefined
    const entry = await tickets.take(options.ssoTicket, options.ssoVerifier)
    if (!entry) return { error: new Meteor.Error(403, 'The sign-in expired or was started in another browser. Try again.') }
    // The session remembers the connection it came from: its team's session length applies.
    const stamped = { ...Accounts._generateStampedLoginToken(), ...(entry.connectionId && { ssoConnectionId: entry.connectionId }) }
    await Accounts._insertLoginToken(entry.userId, stamped)
    return { userId: entry.userId, stampedLoginToken: stamped }
  })

  Accounts.validateLoginAttempt(async (attempt) => {
    const user = attempt.user
    const refusal = loginRefusal(attempt, sso, { breakGlass: await breakGlassFor(user) })
    if (refusal) throw new Meteor.Error(403, refusal)
    if (attempt.type !== 'sso') {
      const policy = teamPolicyRefusal(attempt, { covered: Boolean(await requiredConnectionFor(user)) })
      if (policy) throw new Meteor.Error(403, policy)
    }
    if (attempt.type === 'resume') {
      const loginToken = findLoginToken(user, attempt.methodArguments?.[0]?.resume)
      // A saved session of an account that signs in only through a team connection (covered by its
      // "Require single sign-on", or linked to it and not break-glass) must be one single sign-on
      // made. Sessions made any other way (an emailed sign-in link, an API login link, a guest's
      // purchase link) never went through a login attempt this rule saw.
      const notSso = loginToken && !loginToken.ssoConnectionId ? resumeRefusal(loginToken, { teamSsoOnly: await teamSsoOnly(user) }) : null
      if (notSso) throw new Meteor.Error(403, notSso)
      if (loginToken?.ssoConnectionId && loginToken.ssoConnectionId !== MANAGED_KEYCLOAK_ID) {
        const connection = await connectionById(loginToken.ssoConnectionId)
        if (!connection || ssoSessionExpired({ loginToken, sessionHours: connection.policy?.sessionHours })) throw new Meteor.Error(403, SESSION_ENDED)
      }
    }
    return attempt.allowed
  })

  Accounts.validateNewUser(async (user) => {
    if (!mayCreateUser(user, sso)) throw new Meteor.Error(403, SSO_ONLY_MESSAGE)
    // A password sign-up with an address a team requires single sign-on for goes through SSO instead.
    if (user?.services?.password && !user.services.sso) {
      for (const entry of user.emails || []) {
        const connection = await connectionForAddress(entry?.address)
        if (connection?.policy?.requireSso) throw new Meteor.Error(403, REQUIRE_SSO_MESSAGE)
      }
    }
    return true
  })

  // A new sign-in clears an earlier revocation.
  Accounts.onLogin(async ({ type, user }) => {
    if (type === 'sso' && user?.services?.sso?.revokedAt) {
      await Meteor.users.updateAsync({ _id: user._id }, { $unset: { 'services.sso.revokedAt': '' } })
    }
  })

  // A break-glass sign-in (the owner or a named admin signing in with a password or passkey while
  // the team requires single sign-on) is logged, and the team's other admins are emailed.
  Accounts.onLogin(async ({ type, user }) => {
    if (!['password', 'passkey'].includes(type) || !user?.orgId) return
    for (const entry of user.emails || []) {
      const connection = await connectionForAddress(entry?.address)
      if (!connection?.policy?.requireSso || connection.orgId !== user.orgId || !isBreakGlass(user, connection)) continue
      log(`break-glass sign-in (${type}) by account ${user._id} of team ${user.orgId}`)
      audit.record({
        action: 'signin.breakGlass', actor: { kind: 'person', userId: user._id }, via: 'app', orgId: user.orgId,
        target: { type: 'connection', id: connection._id, name: connection.label }, details: { method: type },
      })
      const to = (await teamAdminEmails(user.orgId)).filter((address) => !(user.emails || []).some((e) => e.address === address))
      if (to.length) {
        await Email.sendAsync({
          from: Meteor.settings.mailFrom || 'no-reply@slatebox.com',
          to,
          subject: 'A break-glass sign-in to your Slatebox team',
          text: `${entry.address} signed in to Slatebox with a ${type === 'passkey' ? 'passkey' : 'password'} instead of single sign-on (${connection.label}), at ${new Date().toUTCString()}.\n\nThe team requires single sign-on; the owner and up to two named admins may still sign in this way when the identity provider is down. If this was not expected, check Team settings > Sign-in & security.\n`,
        }).catch((error) => console.error('sso: break-glass email failed', error?.message))
      }
      return
    }
  })

  if (sso?.only) ssoOnlyOnTheServer()
  requireSsoOnTheServer()
}

// Under a team's "Require single sign-on", the server refuses to send its members a sign-in link
// or a password reset (a sign-in link is a session before any login attempt is checked), and a
// guest saving an account with a password at an address the team requires single sign-on for.
function requireSsoOnTheServer() {
  const guard = (name, refuses) => {
    const handler = Meteor.server.method_handlers[name]
    if (!handler) {
      console.warn(`sso: "${name}" is not a registered method; nothing to guard`)
      return
    }
    Meteor.server.method_handlers[name] = async function requireSsoGuard(...args) {
      const email = typeof args[0]?.email === 'string' ? args[0].email.trim() : ''
      if (email && await refuses(email, args[0])) throw new Meteor.Error(403, REQUIRE_SSO_MESSAGE)
      return handler.apply(this, args)
    }
  }
  const memberCovered = async (email) => {
    const user = await Accounts.findUserByEmail(email)
    return Boolean(user && await requiredConnectionFor(user))
  }
  const passwordSignUp = async (email, opts) => typeof opts?.password === 'string' && Boolean((await connectionForAddress(email))?.policy?.requireSso)
  Meteor.startup(() => {
    guard(CONSTANTS.methods.users.generateSpecialUseLoginToken, memberCovered)
    guard('forgotPassword', memberCovered)
    guard(CONSTANTS.methods.users.identify, passwordSignUp)
  })
}

// Under SSO only, the server refuses what the sign-in page no longer offers, and everything else
// to anyone without a session: the redirect to /login in the browser is not the only guard.
function ssoOnlyOnTheServer() {
  const refuse = () => new Meteor.Error(403, SSO_ONLY_MESSAGE)
  const handlers = WebApp.handlers || WebApp.connectHandlers
  handlers.use((req, res, next) => {
    if (!closedPathUnderSsoOnly(req.url)) return next()
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(SSO_ONLY_MESSAGE)
    return undefined
  })
  const gateAll = () => {
    gateHandlers(Meteor.server.method_handlers, { kind: 'method', refuse })
    gateHandlers(Meteor.server.publish_handlers, { kind: 'publication', refuse })
  }
  Meteor.startup(() => {
    for (const name of METHODS_CLOSED_UNDER_SSO_ONLY) {
      if (!Meteor.server.method_handlers[name]) {
        console.warn(`sso: "${name}" is not a registered method; nothing to close`)
        continue
      }
      Meteor.server.method_handlers[name] = function closedUnderSsoOnly() { throw refuse() }
    }
    gateAll()
    // A method or publication registered later is gated as it is registered.
    const methods = Meteor.methods
    Meteor.methods = function gatedMethods(...args) {
      const result = methods.apply(this, args)
      gateAll()
      return result
    }
    const publish = Meteor.publish
    Meteor.publish = function gatedPublish(...args) {
      const result = publish.apply(this, args)
      gateAll()
      return result
    }
  })
}

// ---- background jobs ----

let lastOverCapLog = 0

// Each SSO user with a refresh token is checked at most every checkSeconds, SESSION_CHECK_CAP
// per pass (oldest check first). The pass is recorded (counts only) for `slatebox status`.
async function checkSessions(checkSeconds) {
  const query = sessionCheckQuery(Date.now(), checkSeconds)
  const due = await Meteor.users.find(query).countAsync()
  const users = await Meteor.users.find(
    query,
    { fields: { _id: 1, 'services.sso.refreshToken': 1, 'services.sso.connectionId': 1 }, sort: { 'services.sso.checkedAt': 1 }, limit: SESSION_CHECK_CAP },
  ).fetchAsync()
  let revoked = 0
  for (const user of users) {
    const connection = await connectionById(user.services.sso.connectionId || MANAGED_KEYCLOAK_ID)
    let outcome = { status: 'unknown' }
    if (connection?.protocol === 'oidc') {
      try {
        outcome = await refreshSession({ config: await oidcConfig(connection), refreshToken: user.services.sso.refreshToken, fetch: providerFetch })
      } catch { /* the provider could not be asked: unknown */ }
    }
    if (outcome.status === 'active') {
      await Meteor.users.updateAsync({ _id: user._id }, { $set: { 'services.sso.refreshToken': outcome.refreshToken, 'services.sso.checkedAt': new Date() } })
    } else if (outcome.status === 'revoked') {
      revoked += 1
      await Meteor.users.updateAsync({ _id: user._id }, revokedModifier())
      await revokeCredentials(credentials, user._id)
      log(`account ${user._id} signed out: the identity provider refused its session; its API tokens are revoked; its passkeys are removed`)
    } else {
      // asked again in a later pass, not at once
      await Meteor.users.updateAsync({ _id: user._id }, { $set: { 'services.sso.checkedAt': new Date() } })
    }
  }
  if (due > SESSION_CHECK_CAP && Date.now() - lastOverCapLog > 3600_000) {
    lastOverCapLog = Date.now()
    log(`session check: ${due} accounts were due, ${SESSION_CHECK_CAP} are checked per pass; the rest wait for a later pass (see slatebox status)`)
  }
  await SystemSettings.rawCollection().updateOne(
    { _id: SESSION_CHECK_ID },
    sessionCheckRecord({ due, checked: users.length, revoked, checkSeconds }),
    { upsert: true },
  )
}

// Sessions a team connection made end after the team's session length; Meteor then closes the
// tabs that used them (sso.jsx reloads them to the sign-in page).
async function sweepSessionLengths() {
  const connections = await SsoConnections.find({}, { fields: { _id: 1, 'policy.sessionHours': 1 } }).fetchAsync()
  for (const connection of connections) {
    const hours = connection.policy?.sessionHours
    if (!Number.isFinite(hours) || hours <= 0) continue
    const old = { ssoConnectionId: connection._id, when: { $lt: new Date(Date.now() - hours * 3600_000) } }
    await Meteor.users.updateAsync({ 'services.resume.loginTokens': { $elemMatch: old } }, { $pull: { 'services.resume.loginTokens': old } }, { multi: true })
  }
}

async function recheckDomains() {
  const connections = await SsoConnections.find({ 'domains.verifiedAt': { $ne: null } }).fetchAsync()
  for (const connection of connections) {
    for (const entry of connection.domains || []) {
      if (!dueForRecheck(entry)) continue
      const { status } = await lookupChallenge({ domain: entry.domain, token: entry.token, resolveTxt: dns.resolveTxt })
      const next = afterCheck(entry, status)
      await SsoConnections.rawCollection().updateOne({ _id: connection._id, 'domains.domain': entry.domain }, { $set: { 'domains.$': next } })
      forget(connection._id)
      if (justStoppedRouting(entry, next)) {
        log(`domain ${entry.domain} of connection ${connection._id} stopped routing sign-ins: its DNS record has been missing for seven days`)
        audit.record({
          action: 'sso.domainLost', actor: { kind: 'system' }, via: 'system', orgId: connection.orgId,
          target: { type: 'connection', id: connection._id, name: connection.label }, details: { domain: entry.domain },
        })
        const to = await teamAdminEmails(connection.orgId)
        if (to.length) {
          await Email.sendAsync({
            from: Meteor.settings.mailFrom || 'no-reply@slatebox.com',
            to,
            subject: `Single sign-on for ${entry.domain} is paused`,
            text: `The DNS record that proves your team owns ${entry.domain} has been missing for seven days, so "${connection.label}" no longer signs in addresses at ${entry.domain}.\n\nAdd the record again (Team settings > Sign-in & security shows it) and press Check. Until then people at ${entry.domain} sign in the way they did before single sign-on.\n`,
          }).catch((error) => console.error('sso: domain email failed', error?.message))
        }
      }
    }
  }
}

function every(name, ms, job) {
  let running = false
  Meteor.setInterval(async () => {
    if (running) return
    running = true
    try {
      if (await takeLease(SsoLeases.rawCollection(), name, { ttlMs: Math.max(ms * 2, 60_000) })) await job()
    } catch (error) {
      console.error(`sso: ${name} failed`, error?.message)
    } finally {
      running = false
    }
  }, ms)
}

// ---- the admin service (server/actions/team-sso.mjs) ----

async function teamAdmins(orgId) {
  const claims = await Permissions.find({ orgId, claimId: CONSTANTS.claims.admin._id }, { fields: { userId: 1 } }).fetchAsync()
  const people = await Meteor.users.find(
    { orgId, $or: [{ isOrgOwner: true }, { _id: { $in: claims.map((c) => c.userId) } }] },
    { fields: { emails: 1, profile: 1, isOrgOwner: 1 } },
  ).fetchAsync()
  return people.map((p) => ({
    _id: p._id,
    isOrgOwner: p.isOrgOwner === true,
    email: p.emails?.[0]?.address ?? '',
    name: [p.profile?.firstName, p.profile?.lastName].filter(Boolean).join(' '),
  }))
}

export const teamSso = createTeamSso({
  store: {
    connections: {
      async forTeam(orgId) {
        const own = await SsoConnections.find({ orgId }, { sort: { createdAt: 1 } }).fetchAsync()
        const server = await managed()
        return server && server.orgId === orgId ? [server, ...own] : own
      },
      byId: (id) => (id === MANAGED_KEYCLOAK_ID ? managed() : SsoConnections.findOneAsync({ _id: id })),
      async insert(doc) { await SsoConnections.insertAsync(doc); forget(doc._id) },
      async set(id, $set, unset = []) {
        const modifier = { $set }
        if (unset.length) modifier.$unset = Object.fromEntries(unset.map((name) => [name, '']))
        await SsoConnections.updateAsync({ _id: id }, modifier)
        forget(id)
        discovered.delete(id)
      },
      async remove(id) { await SsoConnections.removeAsync({ _id: id }); forget(id); discovered.delete(id) },
      async pushDomain(id, entry) { await SsoConnections.updateAsync({ _id: id }, { $push: { domains: entry } }); forget(id) },
      async setDomain(id, domain, entry) { await SsoConnections.rawCollection().updateOne({ _id: id, 'domains.domain': domain }, { $set: { 'domains.$': entry } }); forget(id) },
      async pullDomain(id, domain) { await SsoConnections.updateAsync({ _id: id }, { $pull: { domains: { domain } } }); forget(id) },
    },
    claims: {
      async claim(domain, { orgId, connectionId, at }) {
        try {
          await SsoDomainClaims.rawCollection().insertOne({ _id: domain, orgId, connectionId, at })
          return true
        } catch (error) {
          if (error?.code !== 11000) throw error
          // this connection's own claim (a check pressed twice) is still its own
          const held = await SsoDomainClaims.findOneAsync({ _id: domain })
          return held?.connectionId === connectionId
        }
      },
      async release(domain, connectionId) { await SsoDomainClaims.removeAsync({ _id: domain, connectionId }) },
      owner: (domain) => SsoDomainClaims.findOneAsync({ _id: domain }),
    },
    people: {
      teamAdmins,
      person: (userId) => Meteor.users.findOneAsync({ _id: userId }, { fields: { orgId: 1, isOrgOwner: 1, 'services.sso.connectionId': 1, emails: 1 } }),
      teamMembers: (orgId) => Meteor.users.find({ orgId }, { fields: { orgId: 1, isOrgOwner: 1, emails: 1, isAnonymous: 1, 'services.sso.connectionId': 1 } }).fetchAsync(),
      async unlinkConnection(connectionId) {
        await Meteor.users.updateAsync({ 'services.resume.loginTokens.ssoConnectionId': connectionId },
          { $pull: { 'services.resume.loginTokens': { ssoConnectionId: connectionId } } }, { multi: true })
        const unlinked = await Meteor.users.updateAsync({ 'services.sso.connectionId': connectionId }, { $unset: { 'services.sso': '' } }, { multi: true })
        if (unlinked) log(`connection ${connectionId} removed: ${unlinked} account${unlinked === 1 ? '' : 's'} no longer linked to it`)
      },
      async endSessions(userIds) {
        await Meteor.users.updateAsync({ _id: { $in: userIds } }, { $set: { 'services.resume.loginTokens': [] } }, { multi: true })
        // Their API tokens and sign-in links end too: a token made with a password session must not
        // outlive the rule. Passkeys stay (a covered member's passkey sign-in is refused anyway).
        for (const userId of userIds) await revokeCredentials(credentials, userId, Date.now(), { keepPasskeys: true })
        log(`require single sign-on: ${userIds.length} member${userIds.length === 1 ? '' : 's'} signed out to sign in again with single sign-on; their API tokens and sign-in links ended`)
      },
    },
  },
  env: {
    cloud,
    master,
    get origin() { return origin() },
    newId: () => Random.id(),
    resolveTxt: dns.resolveTxt,
    gate: gateFor,
    record: (entry) => audit.record(entry),
    async serverAdmin(userId) {
      return Boolean(await Permissions.findOneAsync({ userId, claimId: CONSTANTS.claims.uberMensch._id }, { fields: { _id: 1 } }))
    },
    async discover(connection) {
      if (connection.protocol !== 'oidc') return
      try {
        await discover(connection.oidc.issuer, { fetch: providerFetch })
      } catch {
        throw new TeamSsoError('invalid_input', `Slatebox could not read ${connection.oidc.issuer}/.well-known/openid-configuration. Check the issuer address.`)
      }
    },
  },
})

/**
 * The server's own connection as SCIM reads a team's connections (server/scim/meteor.js): on a
 * self-hosted server with the bundled Keycloak, the default team's, with the email domains the
 * server administrator set (SLATEBOX_SSO_DOMAINS) as its verified domains, since they run the
 * server. None without a domain list: SCIM never provisions addresses nobody vouched for.
 */
export async function serverConnectionsFor(orgId) {
  if (!sso || !sso.domains.length || !orgId || orgId !== await defaultTeamId(sso)) return []
  const at = new Date(0)
  return [{ _id: MANAGED_KEYCLOAK_ID, managed: 'keycloak', orgId, enabled: true, domains: sso.domains.map((domain) => ({ domain, verifiedAt: at, verifiedBy: 'server-admin' })) }]
}

/** "Try it": a one-time test sign-in in a popup for a team admin (teamSso.tryConnection). */
export async function startTry(caller, connectionId) {
  const connection = await connectionById(connectionId)
  if (!connection || connection.orgId !== caller.orgId || connection.managed) return null
  const token = Random.secret(32)
  await requests.put(`try:${token}`, JSON.stringify({ connectionId, userId: caller._id }), new Date(Date.now() + 10 * 60_000))
  return { url: `/sso/start?${new URLSearchParams({ c: connectionId, try: token })}` }
}

/** Where the browser goes after signing out, to sign out at the identity provider too, or null. */
export async function signOutUrl(userId) {
  const user = await Meteor.users.findOneAsync({ _id: userId }, { fields: { 'services.sso.connectionId': 1 } })
  const connection = await connectionById(user?.services?.sso?.connectionId)
  if (!connection?.policy?.signOutOfIdp || connection.protocol !== 'oidc') return null
  try {
    return endSessionUrl({ config: await oidcConfig(connection), postLogoutRedirectUri: `${origin()}/login` })
  } catch {
    return null
  }
}

// ---- start ----

Meteor.startup(async () => {
  const raw = (c) => c.rawCollection()
  await raw(SsoConnections).createIndex({ orgId: 1 })
  await raw(SsoTickets).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  await raw(SsoRequests).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  await raw(Meteor.users).createIndex({ 'services.sso.issuer': 1, 'services.sso.subject': 1 }, { sparse: true })
  await raw(Meteor.users).createIndex({ 'services.resume.loginTokens.ssoConnectionId': 1 }, { sparse: true })
  // Accounts linked to the bundled Keycloak before connections had ids are its connection's.
  if (sso) {
    await raw(Meteor.users).updateMany(
      { 'services.sso.issuer': sso.provider, 'services.sso.connectionId': { $exists: false } },
      { $set: { 'services.sso.connectionId': MANAGED_KEYCLOAK_ID } },
    )
  }
})

routes()
accountsHooks()
if (sso) every('sso-session-check', Math.min(sso.checkSeconds, 30) * 1000, () => checkSessions(sso.checkSeconds))
else every('sso-session-check', 30_000, () => checkSessions(60))
every('sso-session-length', 60_000, sweepSessionLengths)
every('sso-domain-recheck', 3600_000, recheckDomains)
if (sso) {
  log(`on, issuer ${sso.issuer}${sso.only ? ', single sign-on only' : ''}${sso.defaultRole === 'none' ? ', new accounts join a team only by invitation' : ''}${sso.domains.length ? `, ${sso.domains.length} allowed email domain${sso.domains.length === 1 ? '' : 's'}` : ''}`)
}
log(`team connections ${cloud ? 'in Slatebox Cloud' : 'on this server'}${stateKey ? '' : ' (OpenID Connect needs SLATEBOX_KEY_ENCRYPTION_KEY)'}`)
