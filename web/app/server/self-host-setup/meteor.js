// The setup link on a self-hosted Slatebox: the Meteor side of core.mjs. On Slatebox Cloud
// (settings.public.env is not 'selfhost', or the edition is 'cloud') nothing here is registered.
//
//   GET  /setup/<token>        the setup form (or why the link does not work)
//   POST /setup/<token>        create the first account: server administrator, owner of the first team
//   POST /setup/<token>/sso    single sign-on instead: keep the link in an HttpOnly cookie for the
//                              round trip; /sso/callback makes the first SSO account the admin
//                              (completeSetupWith, called from server/sso/index.js)
//
// Before setup every page is "This Slatebox isn't set up yet", and no account of any kind can be
// made (Accounts.validateNewUser); a guest from before setup links existed cannot save itself
// either (users.identify asks setupRequired). Nothing here logs a link or a token.
import { randomBytes } from 'node:crypto'
import { Meteor } from 'meteor/meteor'
import { WebApp } from 'meteor/webapp'
import { Accounts } from 'meteor/accounts-base'
import CONSTANTS from '../../imports/api/common/constants'
import { Permissions, SystemSettings } from '../../imports/api/common/models'
import { createTeamFor } from '../methods/organizations'
import { guestLoginToken } from '../common/accounts'
import { ssoSettings } from '../sso/policy.mjs'
import { markSetUp, setupAppliesHere, setupRequired } from './state.js'
import {
  NOT_SET_UP_MESSAGE, SETUP_COOKIE, SETUP_ID, claimFilter, completedModifier, cookieValue, formErrors, gatedRequest, linkProblemPage,
  linkState, notSetUpPage, pageHeaders, parseForm, parseSetupPath, setupCookie, setupFormPage, signedInPage, suggestedTeam,
} from './core.mjs'

const applies = setupAppliesHere
// Set for the one account the setup link makes; validateNewUser lets only that one through.
const making = new Meteor.EnvironmentVariable()

export { setupRequired }

const readDoc = () => SystemSettings.findOneAsync({ _id: SETUP_ID })

/**
 * Use a setup link once: claim it, make the account with makeAccount() (which returns its id),
 * then make that account the server administrator and the owner of the first team, and mark
 * setup done. If the account cannot be made, the link is released for another try.
 */
export async function completeSetupWith(token, makeAccount, { teamName, via }) {
  if (!applies) throw new Meteor.Error(404, 'Not found')
  const claimed = await SystemSettings.rawCollection().updateOne(claimFilter(token), { $set: { claimedAt: new Date() } })
  if (claimed.modifiedCount !== 1) throw new Meteor.Error('setup-link', 'This setup link has expired or was already used.')
  let userId
  try {
    userId = await making.withValue(true, () => makeAccount())
  } catch (error) {
    await SystemSettings.rawCollection().updateOne({ _id: SETUP_ID, completedAt: { $exists: false } }, { $unset: { claimedAt: '' } })
    throw error
  }
  if (!(await Permissions.findOneAsync({ userId, claimId: CONSTANTS.claims.uberMensch._id }))) {
    await Permissions.insertAsync({ userId, claimId: CONSTANTS.claims.uberMensch._id })
  }
  const user = await Meteor.users.findOneAsync({ _id: userId }, { fields: { orgId: 1, isEducationCertified: 1 } })
  if (!user.orgId) await createTeamFor(user, teamName || 'Our team')
  await SystemSettings.rawCollection().updateOne({ _id: SETUP_ID }, completedModifier(userId, { via }))
  markSetUp()
  console.log(`[setup] the first administrator was created (${via}); sign-up now follows this server's normal rules`)
  return userId
}

/** The setup link a browser carried through a single sign-on round trip, when it is still good. */
export async function pendingSsoSetup(req) {
  if (!(await setupRequired())) return null
  const token = cookieValue(req.headers.cookie, SETUP_COOKIE)
  if (!token) return null
  const doc = await readDoc()
  return linkState(doc, token) === 'ok' ? { token, teamName: doc.teamName } : null
}

export const clearSetupCookie = () => setupCookie('', { secure: Meteor.absoluteUrl().startsWith('https:'), clear: true })

function send(res, status, html, { nonce, cookie } = {}) {
  res.writeHead(status, { ...pageHeaders(nonce), ...(cookie ? { 'Set-Cookie': cookie } : {}) })
  res.end(html)
}

function readBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function setupRoute(req, res) {
  const parsed = parseSetupPath(req.url)
  if (!parsed) return false
  const sso = ssoSettings(Meteor.settings)
  const ssoOffer = sso ? { only: sso.only } : null
  const doc = await readDoc()
  const state = linkState(doc, parsed.token)
  if (state !== 'ok') {
    send(res, state === 'set-up' ? 200 : 410, linkProblemPage(state))
    return true
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    send(res, 200, setupFormPage({ token: parsed.token, values: { team: suggestedTeam(Meteor.absoluteUrl()) }, sso: ssoOffer }))
    return true
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'GET, POST', 'Cache-Control': 'no-store' })
    res.end()
    return true
  }
  let values
  try {
    values = parseForm(await readBody(req))
  } catch {
    send(res, 413, setupFormPage({ token: parsed.token, sso: ssoOffer, problem: 'That was too much to send. Try again.' }))
    return true
  }
  if (parsed.sso) {
    if (!sso) {
      send(res, 404, linkProblemPage('invalid'))
      return true
    }
    const errors = formErrors(values, { passwords: false })
    if (Object.keys(errors).length) {
      send(res, 400, setupFormPage({ token: parsed.token, values, errors, sso: ssoOffer }))
      return true
    }
    // The team name waits beside the link; the account comes back from the identity provider.
    await SystemSettings.rawCollection().updateOne({ _id: SETUP_ID, completedAt: { $exists: false } }, { $set: { teamName: values.team } })
    res.writeHead(303, {
      Location: '/login', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'Set-Cookie': setupCookie(parsed.token, { secure: Meteor.absoluteUrl().startsWith('https:') }),
    })
    res.end()
    return true
  }
  if (sso?.only) {
    send(res, 400, setupFormPage({ token: parsed.token, values, sso: ssoOffer, problem: 'This Slatebox uses single sign-on only. Continue with single sign-on.' }))
    return true
  }
  const errors = formErrors(values)
  if (Object.keys(errors).length) {
    send(res, 400, setupFormPage({ token: parsed.token, values, errors, sso: ssoOffer }))
    return true
  }
  let userId
  try {
    userId = await completeSetupWith(parsed.token, () => Accounts.createUserAsync({
      email: values.email, password: values.password, profile: { firstName: values.firstName, lastName: values.lastName },
    }), { teamName: values.team, via: 'password' })
  } catch (error) {
    if (error?.error === 'setup-link') {
      send(res, 410, linkProblemPage('invalid'))
      return true
    }
    console.error('[setup] the first account could not be created:', error?.reason || error?.message)
    send(res, 400, setupFormPage({ token: parsed.token, values, sso: ssoOffer, problem: error?.reason || 'The account could not be created. Try again.' }))
    return true
  }
  const token = await guestLoginToken(userId)
  const nonce = randomBytes(16).toString('base64')
  send(res, 200, signedInPage({ userId, token, expires: Accounts._tokenExpiration(new Date()), nonce }), { nonce })
  return true
}

if (applies) {
  Accounts.validateNewUser(async (user) => {
    if (making.get() === true) return true
    if (await setupRequired()) throw new Meteor.Error(403, NOT_SET_UP_MESSAGE)
    return true
  })

  const handlers = WebApp.handlers || WebApp.connectHandlers
  handlers.use(async (req, res, next) => {
    try {
      if (req.url.startsWith('/setup/')) {
        if (!(await setupRoute(req, res))) send(res, 404, linkProblemPage('invalid'))
        return
      }
      if (!gatedRequest(req.method, req.url) || !(await setupRequired())) {
        next()
        return
      }
      // A browser on its way through single sign-on with a good setup link sees the sign-in pages.
      if (await pendingSsoSetup(req)) {
        next()
        return
      }
      send(res, 200, notSetUpPage())
    } catch (error) {
      console.error('[setup]', error?.message)
      next(error)
    }
  })

  // An install that already had accounts before setup links existed is set up.
  Meteor.startup(async () => {
    const doc = await readDoc()
    if (doc?.completedAt) {
      markSetUp()
      return
    }
    const registered = await Meteor.users.findOneAsync({ isAnonymous: { $ne: true } }, { fields: { _id: 1 } })
    if (registered) {
      await SystemSettings.rawCollection().updateOne(
        { _id: SETUP_ID },
        { $set: { completedAt: new Date(), via: 'existing-accounts' }, $unset: { tokenHash: '', expiresAt: '', claimedAt: '' } },
        { upsert: true },
      )
      markSetUp()
      return
    }
    console.log('[setup] waiting for the first administrator: open the setup link from your install (slatebox setup-link prints a new one)')
  })
}
