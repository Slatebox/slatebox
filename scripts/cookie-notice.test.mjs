// The cookie notice (owner report 2026-11-23: on phones it could stay over the foot of the screen after Got it):
// its answer is kept in the cookie the earlier notice used and in localStorage, so a browser that drops one still
// remembers it, and someone who answered the earlier notice is never asked again. The phone itself:
// scripts/cookie-notice-phone.spec.mjs.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { answerCookieNotice, cookieNoticeAnswered } from '../web/app/imports/api/common/cookie-notice.mjs'

const jar = () => {
  const cookies = new Map()
  return {
    get cookie() { return [...cookies].map(([k, v]) => k + '=' + v).join('; ') },
    set cookie(line) { const [pair] = line.split(';'); const [k, v] = pair.split('='); cookies.set(k.trim(), v) },
    lines: [],
  }
}
const store = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) } }

test('an answer is kept twice, and either one is enough', () => {
  const doc = jar(), storage = store()
  assert.equal(cookieNoticeAnswered(doc, storage), false)
  answerCookieNotice(doc, storage, true)
  assert.equal(cookieNoticeAnswered(doc, storage), true)
  // A browser that dropped the cookie still remembers it; one without storage reads the cookie.
  assert.equal(cookieNoticeAnswered(jar(), storage), true)
  assert.equal(cookieNoticeAnswered(doc, store()), true)
  // Someone who answered the earlier notice (its cookie, CookieConsent=true) is not asked again.
  const earlier = jar(); earlier.cookie = 'CookieConsent=true; path=/'
  assert.equal(cookieNoticeAnswered(earlier, store()), true)
  assert.equal(cookieNoticeAnswered({ cookie: 'NotCookieConsent=true' }, store()), false)
})

test('a browser that refuses both still lets the notice go for this page, and never throws', () => {
  const hostile = { get cookie() { throw new Error('blocked') }, set cookie(_) { throw new Error('blocked') } }
  const locked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.doesNotThrow(() => answerCookieNotice(hostile, locked, true))
  assert.equal(cookieNoticeAnswered(hostile, locked), false)
})

test('the cookie is a year long, lax, and secure on https', () => {
  let line = ''
  answerCookieNotice({ set cookie(value) { line = value } }, store(), true)
  assert.match(line, /^CookieConsent=true; max-age=31536000; path=\/; samesite=lax; secure$/)
  answerCookieNotice({ set cookie(value) { line = value } }, store(), false)
  assert.doesNotMatch(line, /secure/)
})

test('Got it answers on the finger lift as well as a click, and stops the tap reaching what lies under the notice', () => {
  const source = readFileSync(new URL('../web/app/imports/ui/components/CookieNotice.jsx', import.meta.url), 'utf8')
  assert.match(source, /onClick=\{event => \{ own\(event\); answer\(\) \}\}/)
  assert.match(source, /onTouchEnd=\{event => \{ own\(event\); if \(event\.cancelable\) event\.preventDefault\(\); answer\(\) \}\}/)
  assert.match(source, /if \(answered\) return null/, 'answered, it leaves the page (the canvas gets its room back)')
  assert.match(source, /addEventListener\('storage'/, 'answered in another tab, it goes here too')
})

test('Got it is a finger\'s size to touch: its touch area is at least 44px each way', () => {
  const main = readFileSync(new URL('../web/app/imports/ui/Main.jsx', import.meta.url), 'utf8')
  assert.match(main, /'& #rcc-confirm-button::after': \{ content: '""', position: 'absolute'.*width: 'max\(100%, 44px\)', height: 'max\(100%, 44px\)'/)
  assert.match(main, /'& #rcc-confirm-button': \{ position: 'relative', minWidth: 44 \}/)
})
