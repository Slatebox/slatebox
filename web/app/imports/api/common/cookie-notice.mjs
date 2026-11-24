// The cookie notice's answer, kept twice (CookieNotice.jsx): the cookie the earlier notice used, and localStorage.

const COOKIE = 'CookieConsent'
export const COOKIE_NOTICE_KEY = 'sb-cookie-notice'
const KEY = COOKIE_NOTICE_KEY

/** Whether this browser has answered the notice (the cookie, or the copy kept in localStorage). */
export function cookieNoticeAnswered(doc = globalThis.document, storage = globalThis.localStorage) {
  try { if (new RegExp('(?:^|;\\s*)' + COOKIE + '=true(?:;|$)').test(doc?.cookie ?? '')) return true } catch { /* no cookies here */ }
  try { if (storage?.getItem(KEY) === 'answered') return true } catch { /* no storage here */ }
  return false
}

/** Keep the answer: the cookie for a year (lax, secure on https), and localStorage. */
export function answerCookieNotice(doc = globalThis.document, storage = globalThis.localStorage, secure = globalThis.location?.protocol === 'https:') {
  try { doc.cookie = COOKIE + '=true; max-age=' + 365 * 24 * 3600 + '; path=/; samesite=lax' + (secure ? '; secure' : '') } catch { /* no cookies here */ }
  try { storage?.setItem(KEY, 'answered') } catch { /* no storage here */ }
}
