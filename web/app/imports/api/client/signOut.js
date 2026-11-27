// Sign out, and what follows any session's end, in the browser (the rules: imports/api/common/sign-out.mjs).
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import { Tracker } from 'meteor/tracker'
import { useLocation, useNavigationType } from 'react-router-dom'
import {
  afterLogout, clearSession, clearSignedOut, forgetMember, isSignedOut, markSignedOut, mayStartGuest, noAccountPath,
  rememberMember, signOutAndLeave, storedMember, SIGN_IN_PATH,
} from '../common/sign-out.mjs'

const storage = () => { try { return window.localStorage } catch { return null } }
const leave = (path) => window.location.replace(path)

let leaving = false
let quiet = false
let memberId = null

// The account menu's Sign out (on wide screens and in the phone's sheet).
// When the person's team asks that signing out of Slatebox also signs them out at their identity
// provider, the browser goes there afterwards (it sends them back to the sign-in page).
export async function signOut() {
  if (leaving) return undefined
  leaving = true
  let provider = null
  try { provider = (await Meteor.callAsync('sso.signOutUrl'))?.url || null } catch { /* sign out here only */ }
  return signOutAndLeave({
    logout: () => new Promise((resolve, reject) => Meteor.logout(error => (error ? reject(error) : resolve()))),
    logoutHere: () => Accounts.makeClientLoggedOut(),
    storage: storage(),
    leave: (path) => leave(provider || path),
  })
}

// A page that logs out on purpose and then goes on by itself (an invalid sign-in link, a guest who
// is signing in to an existing account).
export function logoutQuietly(callback) {
  quiet = true
  Meteor.logout((error) => { quiet = false; callback?.(error) })
}

export const signedOutPath = () => noAccountPath(storage())
export const signedOut = () => isSignedOut(storage())

// The first place this page load showed, for telling a fresh visit from Back.
let firstKey = null
const documentNavigation = () => {
  try { return window.performance?.getEntriesByType?.('navigation')?.[0]?.type } catch { return undefined }
}

// May a page that makes a guest by itself (the start page, a starter, Sign up) make one now?
export function useMayStartGuest() {
  const navigationType = useNavigationType()
  const { key } = useLocation()
  if (firstKey === null) firstKey = key
  return mayStartGuest({ storage: storage(), navigationType, firstEntry: key === firstKey, documentNavigation: documentNavigation() })
}

Meteor.startup(() => {
  // Who is signed in here: a member is remembered, so that a session ending later is known to be theirs.
  Tracker.autorun(() => {
    const user = Meteor.user({ fields: { isAnonymous: 1 } })
    if (!user || typeof user.isAnonymous !== 'boolean') return
    if (user.isAnonymous) { memberId = null; forgetMember(storage()) } else { memberId = user._id; rememberMember(storage(), user._id) }
  })
  Accounts.onLogin(() => clearSignedOut(storage()))
  Accounts.onLogout(() => {
    const id = Meteor.userId()
    const next = afterLogout({
      leaving, quiet,
      memberInPage: Boolean(id && id === memberId),
      memberStored: Boolean(id && id === storedMember(storage())),
      path: window.location.pathname,
    })
    memberId = null
    if (next.clear) clearSession(storage())
    if (next.mark) markSignedOut(storage())
    if (next.go) { leaving = true; leave(next.go) }
  })
  // A signed-out page the browser kept and brought back with Back: start again from the sign-in page.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && isSignedOut(storage()) && !Meteor.userId() && !window.location.pathname.startsWith(SIGN_IN_PATH)) leave(SIGN_IN_PATH)
  })
})
