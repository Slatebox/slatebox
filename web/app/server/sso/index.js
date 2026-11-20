// "Sign in with SSO": the Meteor side. Off unless Meteor.settings.sso.enabled is true (the
// self-host image sets it with SLATEBOX_SSO=keycloak). The protocol, the account matching and
// the "SSO only" rules live in the plain modules beside this file and are unit-tested there.
//
//   GET /sso/login?next=/path   starts the sign-in (authorization code + PKCE)
//   GET /sso/callback           finishes it and hands the browser a one-time ticket in the
//                               URL fragment, which the client exchanges for a Meteor session
//                               with the "sso" login handler
//
// Every checkSeconds the server refreshes each signed-in SSO user's offline session at the
// identity provider. A refused refresh (the user was disabled or deleted, or their sessions were
// ended there) removes every Slatebox session of that user, which also closes their open tabs.
import { Meteor } from 'meteor/meteor'
import { WebApp } from 'meteor/webapp'
import { Accounts } from 'meteor/accounts-base'
import { Random } from 'meteor/random'
import { STATE_COOKIE, SsoError, beginSignIn, completeSignIn, refreshSession } from './oidc.mjs'
import { decideAccount, newUserDocument, ssoIdentity, ssoService } from './accounts.mjs'
import { METHODS_CLOSED_UNDER_SSO_ONLY, SSO_ONLY_MESSAGE, loginRefusal, mayCreateUser, ssoSettings } from './policy.mjs'

const TICKET_MS = 60_000
const tickets = new Map()
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

async function accountFor(sso, claims, refreshToken) {
  const identity = ssoIdentity(claims, sso.issuer)
  const bySubject = await Meteor.users.findOneAsync({ 'services.sso.issuer': sso.issuer, 'services.sso.subject': identity.subject })
  const byEmail = !bySubject && identity.email ? await Accounts.findUserByEmail(identity.email) : undefined
  const decision = decideAccount(identity, { bySubject, byEmail })
  if (decision.action === 'refuse') throw new SsoError('account', decision.reason)
  if (decision.action === 'create') {
    const doc = newUserDocument(identity, refreshToken)
    const userId = await Accounts.insertUserDoc({ profile: doc.profile }, doc)
    log(`account ${userId} created at first sign-in`)
    return userId
  }
  const user = decision.action === 'login' ? bySubject : byEmail
  const set = { 'services.sso': ssoService(identity, refreshToken) }
  const index = (user.emails || []).findIndex(entry => entry.address?.toLowerCase() === identity.email)
  if (index >= 0) set[`emails.${index}.verified`] = true
  await Meteor.users.updateAsync({ _id: user._id }, { $set: set })
  if (decision.action === 'link') log(`account ${user._id} linked to its single sign-on identity`)
  return user._id
}

function issueTicket(userId) {
  const ticket = Random.secret(43)
  tickets.set(ticket, { userId, expires: Date.now() + TICKET_MS })
  for (const [key, entry] of tickets) if (entry.expires < Date.now()) tickets.delete(key)
  return ticket
}

function routes(sso) {
  const handlers = WebApp.handlers || WebApp.connectHandlers
  const secure = new URL(sso.redirectUri).protocol === 'https:'
  handlers.use('/sso/login', (req, res) => {
    const next = new URL(req.url, 'http://x').searchParams.get('next')
    const started = beginSignIn({ config: sso, key: sso.stateKey, next })
    redirect(res, started.url, stateCookie(started.cookie, { secure, maxAge: 600 }))
  })
  handlers.use('/sso/callback', async (req, res) => {
    const query = Object.fromEntries(new URL(req.url, 'http://x').searchParams)
    const clear = stateCookie('', { secure, maxAge: 0 })
    try {
      const result = await completeSignIn({ config: sso, key: sso.stateKey, cookie: cookieValue(req.headers.cookie, STATE_COOKIE), query })
      const userId = await accountFor(sso, result.claims, result.refreshToken)
      const fragment = new URLSearchParams({ ticket: issueTicket(userId), next: result.next })
      redirect(res, `/sso/done#${fragment}`, clear)
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
    const entry = tickets.get(options.ssoTicket)
    tickets.delete(options.ssoTicket)
    if (!entry || entry.expires < Date.now()) return { error: new Meteor.Error(403, 'The sign-in expired. Try again.') }
    return { userId: entry.userId }
  })
  Accounts.validateLoginAttempt((attempt) => {
    const refusal = loginRefusal(attempt, sso)
    if (refusal) throw new Meteor.Error(403, refusal)
    if (attempt.type === 'resume' && attempt.user?.services?.sso?.revokedAt) {
      throw new Meteor.Error(403, 'Your single sign-on account no longer has access. Sign in again.')
    }
    return attempt.allowed
  })
  Accounts.validateNewUser((user) => {
    if (!mayCreateUser(user, sso)) throw new Meteor.Error(403, SSO_ONLY_MESSAGE)
    return true
  })
  if (sso.only) {
    Meteor.startup(() => {
      for (const name of METHODS_CLOSED_UNDER_SSO_ONLY) {
        if (!Meteor.server.method_handlers[name]) continue
        Meteor.server.method_handlers[name] = function closedUnderSsoOnly() {
          throw new Meteor.Error(403, SSO_ONLY_MESSAGE)
        }
      }
    })
  }
}

// Each SSO user with a Slatebox session is checked at most every checkSeconds.
async function checkSessions(sso) {
  const due = new Date(Date.now() - sso.checkSeconds * 1000)
  const users = await Meteor.users.find(
    { 'services.sso.refreshToken': { $exists: true }, 'services.resume.loginTokens.0': { $exists: true }, 'services.sso.checkedAt': { $lt: due } },
    { fields: { _id: 1, 'services.sso.refreshToken': 1 }, limit: 500 },
  ).fetchAsync()
  for (const user of users) {
    const outcome = await refreshSession({ config: sso, refreshToken: user.services.sso.refreshToken })
    if (outcome.status === 'active') {
      await Meteor.users.updateAsync({ _id: user._id }, { $set: { 'services.sso.refreshToken': outcome.refreshToken, 'services.sso.checkedAt': new Date() } })
    } else if (outcome.status === 'revoked') {
      await Meteor.users.updateAsync({ _id: user._id }, {
        $set: { 'services.resume.loginTokens': [], 'services.sso.revokedAt': new Date(), 'services.sso.checkedAt': new Date() },
        $unset: { 'services.sso.refreshToken': '' },
      })
      log(`account ${user._id} signed out: the identity provider refused its session`)
    }
  }
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
  log(`on, issuer ${sso.issuer}${sso.only ? ', single sign-on only' : ''}`)
}
