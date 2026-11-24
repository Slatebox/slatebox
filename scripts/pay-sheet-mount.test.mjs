import './pay-sheet-render-hooks.mjs'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// The pay sheet makes one payment session and one Payment Element per open (owner report 2026-11-24:
// Link's first code did not arrive; "Resend code" did). Each Payment Element the processor creates
// starts its own Link sign-in for the session's email and sends a code, so a second element (a
// remount: StrictMode, a changed key, a second session, the sheet remade) would replace the first
// code. This renders the real PaySheetHost → PaySheet → ProPane → StripeCheckout with the real
// @stripe/react-stripe-js provider against a stand-in SDK that counts what the sheet asks of it.

const appRequire = createRequire(new URL('../web/app/package.json', import.meta.url))
const appImport = name => import(pathToFileURL(appRequire.resolve(name)).href)
const { JSDOM } = await appImport('jsdom')

const dom = new JSDOM('<!doctype html><html><body><div id="react-target"></div></body></html>', { url: 'http://localhost/profile', pretendToBeVisual: true })
const win = dom.window
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLIFrameElement', 'Element', 'Node', 'SVGElement', 'DocumentFragment', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'FocusEvent']) {
  Object.defineProperty(globalThis, k, { value: win[k], configurable: true, writable: true })
}
let phone = false
win.matchMedia = query => ({ matches: phone && /max-width/.test(query), media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
globalThis.matchMedia = win.matchMedia

const wait = ms => new Promise(r => setTimeout(r, ms))
async function until(check, label, ms = 4000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (check()) return; await wait(10) } // eslint-disable-line no-await-in-loop
  assert.fail(`timed out waiting for ${label}`)
}

// The world the stand-ins read: the server's answers, the account, and the counted SDK.
const world = {
  counts: null, sessions: 0, summaryMs: 0, accountReady: true, watchers: new Set(),
  reset() {
    this.sessions = 0
    this.counts = { loadStripe: 0, init: 0, initSecrets: [], paymentCreated: 0, paymentDestroyed: 0, expressCreated: 0, changeAppearance: 0, checkoutCalls: [] }
  },
}
world.reset()
const element = kind => {
  const handlers = {}
  return {
    mount() { setTimeout(() => (handlers.ready || []).forEach(f => f(kind === 'express' ? { availablePaymentMethods: { link: true } } : {})), 20) },
    on(e, f) { (handlers[e] ||= []).push(f) },
    off(e, f) { handlers[e] = (handlers[e] || []).filter(x => x !== f) },
    update() {},
    destroy() { if (kind === 'payment') world.counts.paymentDestroyed++ },
    focus() {},
  }
}
const session = {
  total: { subtotal: { amount: '$5.00' }, taxExclusive: { amount: '$0.00' }, total: { amount: '$5.00' } },
  tax: { status: 'requires_address' }, status: { type: 'open' }, canConfirm: false,
}
globalThis.__paySheetTest = {
  settings: { public: { stripe: { inApp: true, publishableKey: 'pk_test_sheet' }, baseUrl: 'http://localhost' } },
  userId: () => 'u1',
  user: () => ({ _id: 'u1', isAnonymous: false }),
  subscribe: () => ({ ready: () => world.accountReady }),
  watch(f) { world.watchers.add(f); return () => world.watchers.delete(f) },
  async call(name, args) {
    if (name.endsWith('checkout')) {
      world.counts.checkoutCalls.push(args)
      world.sessions += 1
      const n = world.sessions
      await wait(30)
      return { ui: 'elements', clientSecret: `cs_test_${n}_secret`, sessionId: `cs_test_${n}` }
    }
    if (name.endsWith('summary')) {
      await wait(world.summaryMs)
      return { proState: null, credits: { draftsPerMonth: 300, draftsPerDay: 30, voiceHours: 5, videoHours: 1 }, topUpAmounts: [1000] }
    }
    return null
  },
  async loadStripe() {
    world.counts.loadStripe++
    return {
      elements() {}, createToken() {}, createPaymentMethod() {}, confirmCardPayment() {}, registerAppInfo() {}, handleNextAction: async () => ({}),
      initCheckoutElementsSdk(options) {
        world.counts.init++
        world.counts.initSecrets.push(options.clientSecret)
        return {
          loadActions: async () => ({ type: 'success', actions: { getSession: () => session } }),
          on() {},
          changeAppearance() { world.counts.changeAppearance++ },
          loadFonts() {},
          createPaymentElement() { world.counts.paymentCreated++; return element('payment') },
          createExpressCheckoutElement() { world.counts.expressCreated++; return element('express') },
        }
      },
    }
  },
}
const rerunTrackers = () => world.watchers.forEach(f => f())

const React = (await import('app:react')).default
const { createRoot } = await import('app:react-dom/client')
const { flushSync } = await import('app:react-dom')
const { Provider } = await import('app:jotai')
const { MemoryRouter } = await import('app:react-router-dom')
const { ThemeProvider, createTheme } = await import('app:@mui/material/styles')
const Host = await import('../web/app/imports/ui/components/billing/pay/PaySheetHost.jsx')
const { default: PayNotice } = await import('../web/app/imports/ui/components/PayNotice.jsx')

const h = React.createElement
let openSheet = null
function Opener() { openSheet = Host.usePaySheet().open; return null }

// One app per case: a fresh store, router and sheet.
async function mountApp({ path = '/profile?tab=credits', mode = 'light', chat = null } = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const render = themeMode => flushSync(() => root.render(
    h(Provider, null, h(ThemeProvider, { theme: createTheme({ palette: { mode: themeMode } }) }, h(MemoryRouter, { initialEntries: [path] }, h(Host.default, null, h(Opener), chat ? chat() : null)))),
  ))
  render(mode)
  await wait(20)
  return { render, unmount: () => { root.unmount(); host.remove() } }
}
after(() => win.close())

const stage = () => document.querySelector('[data-pay-stage]')?.getAttribute('data-pay-stage')
const paymentReady = () => world.counts.paymentCreated > 0 && stage() === 'ready'

test('one open makes one session, one checkout and one Payment Element; later renders remake none', async () => {
  world.reset(); world.summaryMs = 120; phone = false
  const app = await mountApp()
  openSheet({ action: 'pro', choice: { interval: 'month' } })
  await until(paymentReady, 'the Payment Element')
  // the summary lands after the fields are in, the account's trackers rerun: nothing is remade
  await wait(200)
  rerunTrackers()
  await wait(150)
  assert.equal(world.counts.checkoutCalls.length, 1, 'one payment session per open')
  assert.equal(world.counts.init, 1, 'one checkout per open')
  assert.equal(world.counts.paymentCreated, 1, 'one Payment Element per open (each one starts a Link sign-in and sends a code)')
  assert.equal(world.counts.paymentDestroyed, 0, 'the Payment Element is never remade while the sheet is open')
  assert.equal(world.counts.expressCreated, 1)
  assert.equal(world.counts.loadStripe, 1)
  assert.equal(world.counts.changeAppearance, 0, 'the new fields are not re-styled on open')
  app.unmount()
})

test('a phone, and a summary that lands before the session, still make one Payment Element', async () => {
  world.reset(); world.summaryMs = 0; phone = true
  const app = await mountApp()
  openSheet({ action: 'pro', choice: { interval: 'year' } })
  await until(paymentReady, 'the Payment Element')
  await wait(100)
  rerunTrackers()
  await wait(150)
  assert.equal(world.counts.checkoutCalls.length, 1)
  assert.equal(world.counts.init, 1)
  assert.equal(world.counts.paymentCreated, 1)
  assert.equal(world.counts.paymentDestroyed, 0)
  assert.ok(document.querySelector('.MuiDrawer-root'), 'the sheet is the bottom drawer on a phone')
  phone = false
  app.unmount()
})

test('a ?pay=pro link opened before the account has loaded opens once, with one Payment Element', async () => {
  world.reset(); world.summaryMs = 50; world.accountReady = false
  const app = await mountApp({ path: '/?pay=pro&plan=monthly' })
  await wait(50)
  assert.equal(world.counts.checkoutCalls.length, 0, 'nothing opens before the account is known')
  world.accountReady = true
  rerunTrackers()
  await until(paymentReady, 'the Payment Element')
  await wait(100)
  rerunTrackers()
  await wait(150)
  assert.equal(world.counts.checkoutCalls.length, 1)
  assert.equal(world.counts.init, 1)
  assert.equal(world.counts.paymentCreated, 1)
  assert.equal(world.counts.paymentDestroyed, 0)
  app.unmount()
})

test('a theme change while open re-styles the fields once, through the provider, without remaking them', async () => {
  world.reset(); world.summaryMs = 0
  const app = await mountApp()
  openSheet({ action: 'pro', choice: { interval: 'month' } })
  await until(paymentReady, 'the Payment Element')
  await wait(50)
  app.render('dark')
  await wait(50)
  assert.equal(world.counts.changeAppearance, 1, 'dark mode reaches the fields')
  assert.equal(world.counts.paymentCreated, 1)
  assert.equal(world.counts.paymentDestroyed, 0)
  app.unmount()
})

test('choosing the other interval is a new session: the old Payment Element goes, one new one comes', async () => {
  world.reset(); world.summaryMs = 0
  const app = await mountApp()
  openSheet({ action: 'pro', choice: { interval: 'month' } })
  await until(paymentReady, 'the Payment Element')
  const year = document.querySelector('input[type="radio"][value="year"]')
  assert.ok(year, 'the yearly choice')
  year.click()
  await until(() => world.counts.paymentCreated === 2 && stage() === 'ready', 'the yearly session\'s Payment Element')
  await wait(150)
  assert.deepEqual(world.counts.checkoutCalls.map(c => c.interval), ['month', 'year'])
  assert.deepEqual(world.counts.initSecrets, ['cs_test_1_secret', 'cs_test_2_secret'])
  assert.equal(world.counts.paymentCreated, 2)
  assert.equal(world.counts.paymentDestroyed, 1)
  app.unmount()
})

test('a chat turn\'s inline "Get Slatebox Pro" opens the same one sheet: one session, one Payment Element, the chat re-rendering remakes none', async () => {
  world.reset(); world.summaryMs = 0; phone = false
  let retried = 0
  const refusal = { code: 'pro', reason: 'AI on Slatebox comes with Slatebox Pro, $5 a month, or a balance.', details: { pay: { action: 'pro', wallet: null } } }
  // the refusing chat message itself, as WorkshopConversation and NativeCanvasConversation render it
  const chat = () => h('div', { 'data-chat-turn': '' }, h(PayNotice, { refusal, from: 'draft', retry: () => { retried += 1 }, inline: true }))
  const app = await mountApp({ chat })
  await until(() => document.querySelector('[data-inline-pay] [data-pay-action="pro"]'), 'the inline Pro button')
  assert.equal(world.counts.checkoutCalls.length, 0, 'nothing is asked of the processor before the click')
  document.querySelector('[data-inline-pay] [data-pay-action="pro"]').click()
  await until(paymentReady, 'the Payment Element')
  // the chat keeps re-rendering (new turns, the summary landing, the account's trackers): the open sheet is not remade
  app.render('light')
  await wait(100)
  rerunTrackers()
  await wait(150)
  assert.equal(document.querySelectorAll('[data-pay-stage]').length, 1, 'one pay sheet, the app root\'s')
  assert.equal(world.counts.checkoutCalls.length, 1, 'one payment session per open')
  assert.equal(world.counts.checkoutCalls[0].interval, 'month', 'the inline button opens Pro for a month')
  assert.equal(world.counts.init, 1, 'one checkout per open')
  assert.equal(world.counts.paymentCreated, 1, 'one Payment Element per open')
  assert.equal(world.counts.paymentDestroyed, 0)
  assert.equal(world.counts.changeAppearance, 0)
  assert.equal(retried, 0, 'the request is not run again before the server has the payment')
  app.unmount()
})
