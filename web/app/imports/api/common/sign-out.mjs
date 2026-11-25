// Signing out (owner report 2026-11-24: Sign out landed on a new guest's empty slate). After a member
// signs out, or their session ends while a page is open (another tab signed out, the token was
// revoked), they land on the sign-in page with no guest made and no slate made. A guest is still made
// when someone deliberately opens /new, /start, a starter or Sign up afterwards (a click in the app, a
// typed or pasted link), never by Back or by a page that only bounced them there. Shared slate links
// work signed out as before. The browser side: imports/api/client/signOut.js.

// This browser had a member who signed out. Kept until anyone signs in (a member, or a new guest).
export const SIGNED_OUT_KEY = 'slatebox:signed-out'
// The member signed in on this browser, so a session that fails to resume on load is known to be theirs.
export const MEMBER_KEY = 'slatebox:member'
export const SIGN_IN_PATH = '/login'

// The old session's keys: Meteor's login token, its expiry and user id (namespaced variants too), and
// the earlier token key. Preferences (dark mode, a slate's last board) stay.
const SESSION_KEYS = [/^Meteor\.loginToken/, /^Meteor\.userId/, /^meteor_token$/]

const read = (storage, key) => { try { return storage?.getItem(key) ?? null } catch { return null } }
const write = (storage, key, value) => { try { storage?.setItem(key, value) } catch { /* Private windows can refuse storage. */ } }
const remove = (storage, key) => { try { storage?.removeItem(key) } catch { /* As above. */ } }

export const markSignedOut = (storage) => write(storage, SIGNED_OUT_KEY, '1')
export const clearSignedOut = (storage) => remove(storage, SIGNED_OUT_KEY)
export const isSignedOut = (storage) => read(storage, SIGNED_OUT_KEY) === '1'

export const rememberMember = (storage, userId) => { if (userId) write(storage, MEMBER_KEY, userId) }
export const forgetMember = (storage) => remove(storage, MEMBER_KEY)
export const storedMember = (storage) => read(storage, MEMBER_KEY)

export function clearSession(storage) {
  if (!storage) return []
  const keys = []
  try { for (let i = 0; i < storage.length; i += 1) keys.push(storage.key(i)) } catch { return [] }
  const gone = keys.filter(key => typeof key === 'string' && SESSION_KEYS.some(pattern => pattern.test(key)))
  gone.forEach(key => remove(storage, key))
  forgetMember(storage)
  return gone
}

// Where a page that needs an account sends someone who has none: the sign-in page once a member signed
// out on this browser, otherwise the start page (a first visit tries Slatebox as a guest).
export const noAccountPath = (storage) => (isSignedOut(storage) ? SIGN_IN_PATH : '/start')

// Did the person choose to arrive here? A link or button in the app (PUSH, or a REPLACE that one led
// to), or a page opened afresh by a typed, pasted or clicked link, is a choice. Back and Forward (POP
// inside the app, or a whole page brought back by the browser) is not.
//   navigationType: react-router's 'POP' | 'PUSH' | 'REPLACE'
//   firstEntry: this is the first place this page load showed
//   documentNavigation: the page load's own type ('navigate' | 'reload' | 'back_forward' | 'prerender')
export function deliberateArrival({ navigationType, firstEntry, documentNavigation }) {
  if (navigationType && navigationType !== 'POP') return true
  return Boolean(firstEntry) && documentNavigation !== 'back_forward'
}

// A page that makes a guest by itself (the start page, a starter, Sign up) may do so unless a member
// signed out here and the person did not choose to come.
export const mayStartGuest = ({ storage, ...arrival }) => !isSignedOut(storage) || deliberateArrival(arrival)

// After a session ends. `leaving`: our own Sign out is already taking them to the sign-in page.
// `quiet`: a page logged out on purpose and goes on by itself (an invalid sign-in link). A member's
// session ending while the page was open goes to the sign-in page; one that failed to resume as the
// page loaded (an expired token) is only marked, so a shared link still opens and a private page
// sends them to sign in.
export function afterLogout({ leaving = false, quiet = false, memberInPage = false, memberStored = false, path = '' }) {
  if (leaving || quiet) return { mark: false, clear: false, go: null }
  if (!memberInPage && !memberStored) return { mark: false, clear: false, go: null }
  const go = memberInPage && !path.startsWith(SIGN_IN_PATH) ? SIGN_IN_PATH : null
  return { mark: true, clear: true, go }
}

// Our own Sign out: mark this browser, end the session on the server (or, if the server cannot be
// reached in time, here only), clear the old session's keys and leave for the sign-in page with a
// whole new page load, so nothing of the session stays in memory and Back cannot return to it.
export async function signOutAndLeave({ logout, logoutHere, storage, leave, timeoutMs = 4000 }) {
  markSignedOut(storage)
  let timer
  const ended = await Promise.race([
    Promise.resolve().then(logout).then(() => true, () => false),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs) }),
  ])
  clearTimeout(timer)
  if (!ended) { try { await logoutHere() } catch { /* The keys below are cleared either way. */ } }
  clearSession(storage)
  markSignedOut(storage)
  leave(SIGN_IN_PATH)
  return ended
}
