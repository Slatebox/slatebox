// "Sign in with SSO": the Meteor side. Off unless Meteor.settings.sso.enabled is true (the
// self-host image sets it with SLATEBOX_SSO=keycloak). The protocol, the account matching and
// the "SSO only" rules live in the plain modules beside this file and are unit-tested there.
//
//   GET /sso/login?next=/path&verifier=…
//                               starts the sign-in (authorization code + PKCE); the verifier is
//                               a random value the browser tab keeps, and binds the sign-in to it
//   GET /sso/callback           finishes it and hands the browser a one-time ticket in the
//                               URL fragment, which the same tab exchanges, with its verifier,
//                               for a Meteor session through the "sso" login handler
//
// Every checkSeconds the server refreshes each signed-in SSO user's offline session at the
// identity provider. A refused refresh (the user was disabled or deleted, or their sessions were
// ended there) removes every Slatebox session of that user, which also closes their open tabs,
// revokes their API tokens and sign-in links, and refuses any later sign-in but SSO.
import { Meteor } from 'meteor/meteor'
import { WebApp } from 'meteor/webapp'
import { Accounts } from 'meteor/accounts-base'
import { APILinks, LoginLinks, SlateApiTokens, SystemSettings } from '../../imports/api/common/models'
import { withTrustedFields } from '../common/accounts'
import { STATE_COOKIE, SsoError, beginSignIn, completeSignIn, refreshSession } from './oidc.mjs'
import {
  SESSION_CHECK_CAP, SESSION_CHECK_ID, decideAccount, joinTeamUpdate, linkModifier, newUserDocument, revokeCredentials, revokedModifier,
  sessionCheckQuery, sessionCheckRecord, ssoIdentity, ssoService, teamToJoin,
} from './accounts.mjs'
import {
  METHODS_CLOSED_UNDER_SSO_ONLY, SSO_ONLY_MESSAGE, closedPathUnderSsoOnly, loginRefusal, mayCreateUser, ssoSettings,
} from './policy.mjs'
import { createTicketStore } from './tickets.mjs'
import { Passkeys } from '../passkeys/meteor'
import { gateHandlers } from './gate.mjs'
import { clearSetupCookie, completeSetupWith, defaultTeamId, pendingSsoSetup } from '../self-host-setup/meteor'

const tickets = createTicketStore()
const credentials = { apiTokens: SlateApiTokens, loginLinks: LoginLinks, apiLinks: APILinks, passkeys: Passkeys }
const log = (line) => console.log(`sso: ${line}`)

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return undefined
}

function stateCookie(value, { secure, maxAge }) {
  return `${STATE_COOKIE}=${value}; Path=/sso; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

function redirect(res, location, cookie) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) })
  res.end()
}

// An account in no team yet joins the default team as a Member (no people claims, not the owner).
// Anyone already in a team, the first admin and team owners included, keeps their team and roles.
async function joinDefaultTeam(sso, user) {
  const orgId = teamToJoin(user, { defaultRole: sso.defaultRole, defaultTeamId: await defaultTeamId(sso) })
  if (!orgId) return
  const { selector, modifier } = joinTeamUpdate(user._id, orgId)
  if (await Meteor.users.updateAsync(selector, modifier)) log(`account ${user._id} joined the default team as a member`)
}

async function accountFor(sso, claims, refreshToken) {
  const identity = ssoIdentity(claims, sso.provider)
  const bySubject = await Meteor.users.findOneAsync({ 'services.sso.issuer': sso.provider, 'services.sso.subject': identity.subject })
  const byEmail = !bySubject && identity.email ? await Accounts.findUserByEmail(identity.email) : undefined
  const byEmailApiTokens = byEmail ? await SlateApiTokens.find({ userId: byEmail._id, revokedAt: null }).countAsync() : 0
  const byEmailPasskeys = byEmail ? await Passkeys.find({ userId: byEmail._id }).countAsync() : 0
  const decision = decideAccount(identity, { bySubject, byEmail, byEmailApiTokens, byEmailPasskeys, domains: sso.domains })
  if (decision.action === 'refuse') throw new SsoError('account', decision.reason)
  if (decision.action === 'create') {
    // Null while the setup link makes the first admin: completeSetupWith gives that account its own team.
    const orgId = teamToJoin({}, { defaultRole: sso.defaultRole, defaultTeamId: await defaultTeamId(sso) })
    const doc = newUserDocument(identity, refreshToken, Date.now(), { orgId })
    const userId = await withTrustedFields(orgId ? { orgId } : {}, () => Accounts.insertUserDoc({ profile: doc.profile }, doc))
    log(`account ${userId} created at first sign-in${orgId ? ', a member of the default team' : ''}`)
    return userId
  }
  if (decision.action === 'link') {
    // From here on the account signs in with SSO only: no password, no earlier session, no
    // earlier API token, sign-in link or passkey.
    await Meteor.users.updateAsync({ _id: byEmail._id }, linkModifier(byEmail, identity, refreshToken))
    await revokeCredentials(credentials, byEmail._id)
    log(`account ${byEmail._id} linked to its single sign-on identity; its password, sessions, API tokens and passkeys ended`)
    // An invitation keeps the team it was made for; an account in no team joins the default one.
    await joinDefaultTeam(sso, byEmail)
    return byEmail._id
  }
  const set = { 'services.sso': ssoService(identity, refreshToken) }
  const index = (bySubject.emails || []).findIndex(entry => entry.address?.toLowerCase() === identity.email)
  if (index >= 0) set[`emails.${index}.verified`] = true
  await Meteor.users.updateAsync({ _id: bySubject._id }, { $set: set })
  // An account made at first sign-in before accounts joined the default team gets there now.
  await joinDefaultTeam(sso, bySubject)
  return bySubject._id
}

function routes(sso) {
  const handlers = WebApp.handlers || WebApp.connectHandlers
  const secure = new URL(sso.redirectUri).protocol === 'https:'
  handlers.use('/sso/login', (req, res) => {
    const params = new URL(req.url, 'http://x').searchParams
    let started
    try {
      started = beginSignIn({ config: sso, key: sso.stateKey, next: params.get('next'), verifier: params.get('verifier') })
    } catch (error) {
      if (!(error instanceof SsoError)) throw error
      redirect(res, '/login?sso=no-sign-in')
      return
    }
    redirect(res, started.url, stateCookie(started.cookie, { secure, maxAge: 600 }))
  })
  handlers.use('/sso/callback', async (req, res) => {
    const query = Object.fromEntries(new URL(req.url, 'http://x').searchParams)
    const clear = stateCookie('', { secure, maxAge: 0 })
    try {
      const result = await completeSignIn({ config: sso, key: sso.stateKey, cookie: cookieValue(req.headers.cookie, STATE_COOKIE), query })
      // A self-hosted server's first sign-in through its setup link makes the server administrator.
      const setup = await pendingSsoSetup(req)
      const userId = setup
        ? await completeSetupWith(setup.token, () => accountFor(sso, result.claims, result.refreshToken), { teamName: setup.teamName, via: 'sso' })
        : await accountFor(sso, result.claims, result.refreshToken)
      const fragment = new URLSearchParams({ ticket: tickets.issue(userId, result.binding), next: result.next })
      redirect(res, `/sso/done#${fragment}`, setup ? [clear, clearSetupCookie()] : clear)
    } catch (error) {
      const code = error instanceof SsoError ? error.code : 'failed'
      log(`sign-in refused (${code}${error instanceof SsoError && code === 'account' ? `: ${error.message}` : ''})`)
      if (!(error instanceof SsoError)) console.error('sso: sign-in failed', error?.message)
      redirect(res, `/login?sso=${encodeURIComponent(code)}`, clear)
    }
  })
}

function accountsHooks(sso) {
  Accounts.registerLoginHandler('sso', async (options) => {
    if (typeof options?.ssoTicket !== 'string') return undefined
    const userId = tickets.redeem(options.ssoTicket, options.ssoVerifier)
    if (!userId) return { error: new Meteor.Error(403, 'The sign-in expired or was started in another browser. Try again.') }
    return { userId }
  })
  Accounts.validateLoginAttempt((attempt) => {
    const refusal = loginRefusal(attempt, sso)
    if (refusal) throw new Meteor.Error(403, refusal)
    return attempt.allowed
  })
  Accounts.validateNewUser((user) => {
    if (!mayCreateUser(user, sso)) throw new Meteor.Error(403, SSO_ONLY_MESSAGE)
    return true
  })
  if (sso.only) ssoOnlyOnTheServer()
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

let lastOverCapLog = 0

// Each SSO user with a Slatebox session is checked at most every checkSeconds, SESSION_CHECK_CAP
// per pass (oldest check first). The pass is recorded (counts only) for `slatebox status`.
async function checkSessions(sso) {
  const query = sessionCheckQuery(Date.now(), sso.checkSeconds)
  const due = await Meteor.users.find(query).countAsync()
  const users = await Meteor.users.find(
    query,
    { fields: { _id: 1, 'services.sso.refreshToken': 1 }, sort: { 'services.sso.checkedAt': 1 }, limit: SESSION_CHECK_CAP },
  ).fetchAsync()
  let revoked = 0
  for (const user of users) {
    const outcome = await refreshSession({ config: sso, refreshToken: user.services.sso.refreshToken })
    if (outcome.status === 'active') {
      await Meteor.users.updateAsync({ _id: user._id }, { $set: { 'services.sso.refreshToken': outcome.refreshToken, 'services.sso.checkedAt': new Date() } })
    } else if (outcome.status === 'revoked') {
      revoked += 1
      await Meteor.users.updateAsync({ _id: user._id }, revokedModifier())
      await revokeCredentials(credentials, user._id)
      log(`account ${user._id} signed out: the identity provider refused its session; its API tokens are revoked; its passkeys are removed`)
    }
  }
  if (due > SESSION_CHECK_CAP && Date.now() - lastOverCapLog > 3600_000) {
    lastOverCapLog = Date.now()
    log(`session check: ${due} accounts were due, ${SESSION_CHECK_CAP} are checked per pass; the rest wait for a later pass (see slatebox status)`)
  }
  await SystemSettings.rawCollection().updateOne(
    { _id: SESSION_CHECK_ID },
    sessionCheckRecord({ due, checked: users.length, revoked, checkSeconds: sso.checkSeconds }),
    { upsert: true },
  )
}

function sessionChecks(sso) {
  let running = false
  Meteor.setInterval(async () => {
    if (running) return
    running = true
    try { await checkSessions(sso) } catch (error) { console.error('sso: session check failed', error?.message) } finally { running = false }
  }, Math.min(sso.checkSeconds, 30) * 1000)
}

const sso = ssoSettings(Meteor.settings)
if (sso) {
  routes(sso)
  accountsHooks(sso)
  sessionChecks(sso)
  // A new sign-in clears an earlier revocation.
  Accounts.onLogin(async ({ type, user }) => {
    if (type === 'sso' && user?.services?.sso?.revokedAt) {
      await Meteor.users.updateAsync({ _id: user._id }, { $unset: { 'services.sso.revokedAt': '' } })
    }
  })
  log(`on, issuer ${sso.issuer}${sso.only ? ', single sign-on only' : ''}${sso.defaultRole === 'none' ? ', new accounts join a team only by invitation' : ''}${sso.domains.length ? `, ${sso.domains.length} allowed email domain${sso.domains.length === 1 ? '' : 's'}` : ''}`)
}
