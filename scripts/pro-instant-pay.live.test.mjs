// Live: Slatebox Pro paid at once from the site's link, in a real browser against a locally started
// app with Stripe in TEST mode (card 4242 4242 4242 4242). Never production, never live keys.
//
//   SLATEBOX_APP_URL=http://localhost:3300 \
//   SLATEBOX_MONGO_URL=mongodb://127.0.0.1:3301/meteor \
//   SLATEBOX_MAIL_DIR=<dir an SMTP sink writes .eml files to (the app's MAIL_URL)> \
//   STRIPE_TEST_KEY=<the app's sk_test_/rk_test_ key> \
//   PLAYWRIGHT_DIR=<a checkout with @playwright/test, e.g. ../slateboxjs-v2> \
//   SHOTS_DIR=<where screenshots go> \
//   node --test --test-concurrency=1 scripts/pro-instant-pay.live.test.mjs
//
// Without SLATEBOX_APP_URL every test is skipped. Webhooks: where `stripe listen` is not available
// the test hands the app the real event's id at /stripehooks, which reads the event back from Stripe
// itself (stripeHooks.js), so it is the webhook's own path, not a stand-in.
//
// Covers: a new visitor → /pro?plan=yearly → the sheet preselected, an email field → test card → Pro
// on, the email named on the account, a confirmation email, then the optional password; the tab closed
// mid-payment (the webhook alone switches Pro on and names the account); a signed-in member → the
// sheet at once, no email field; an email that already has an account → nothing attached, nobody
// signed in, a move link to that address, and opening it moves Pro and the guest's slates.
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { registeredUser as probeUser, closeAll, connect, digest } from './ddp-client.mjs'

const base = (process.env.SLATEBOX_APP_URL || '').replace(/\/$/, '')
const mongoUrl = process.env.SLATEBOX_MONGO_URL || 'mongodb://127.0.0.1:3301/meteor'
const mailDir = process.env.SLATEBOX_MAIL_DIR || ''
const stripeKey = process.env.STRIPE_TEST_KEY || ''
const shots = resolve(process.env.SHOTS_DIR || 'pro-instant-pay-shots')
const live = { skip: base ? false : 'set SLATEBOX_APP_URL to a locally started app' }
if (base && /slatebox\.com/.test(base)) throw new Error('pro-instant-pay.live: never run against a hosted app')
if (stripeKey && !/^(sk|rk)_test_/.test(stripeKey)) throw new Error('pro-instant-pay.live: STRIPE_TEST_KEY must be a test-mode key')

const playwrightDir = resolve(process.env.PLAYWRIGHT_DIR || '../slateboxjs-v2')
let chromium
let browser
const tag = () => randomBytes(4).toString('hex')
// a registered account with a deliverable-looking address (the probe helper's .invalid ones are refused by the sheet)
async function registeredUser(label) {
  const email = `${label}-${tag()}@example.com`
  const client = await probeUser(label, { email })
  client.email = email
  return client
}

// ---- Mongo, through mongosh (no driver dependency in the app) ----
function mongo(expression) {
  const out = execFileSync('mongosh', [mongoUrl, '--quiet', '--eval', `EJSON.stringify(${expression}, { relaxed: true })`], { encoding: 'utf8' })
  return JSON.parse(out.trim() || 'null')
}
const userById = id => mongo(`db.users.findOne({ _id: ${JSON.stringify(id)} }, { isAnonymous: 1, emails: 1, pro: 1, checkoutClaim: 1, 'services.password': 1 })`)
const userByEmail = email => mongo(`db.users.findOne({ 'emails.address': ${JSON.stringify(email)} }, { isAnonymous: 1, emails: 1, pro: 1, checkoutClaim: 1 })`)

// ---- mail captured by the SMTP sink ----
const mailsTo = address => (mailDir && existsSync(mailDir) ? readdirSync(mailDir).filter(f => f.endsWith('.eml')).sort()
  .map(f => readFileSync(join(mailDir, f), 'utf8').replace(/=\r?\n/g, '').replace(/=3D/g, '='))
  .filter(text => new RegExp(`^To: .*${address.replace(/[.+]/g, '\\$&')}`, 'mi').test(text)) : [])

// ---- Stripe, test mode: the real event handed to the app's webhook ----
async function stripeGet(path, params = {}) {
  const url = new URL(`https://api.stripe.com/v1/${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${stripeKey}` } })
  return res.json()
}
async function deliverCheckoutEvent(userId, since) {
  for (let i = 0; i < 30; i += 1) {
    const listed = await stripeGet('events', { type: 'checkout.session.completed', 'created[gte]': String(since), limit: '20' })
    const event = (listed.data || []).find(e => e.data?.object?.client_reference_id === userId)
    if (event) {
      const res = await fetch(`${base}/stripehooks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: event.id }) })
      assert.equal(res.status, 200, 'the app took the webhook')
      return event
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error('no checkout.session.completed event for ' + userId)
}

// ---- the browser ----
const shot = (page, name) => page.screenshot({ path: join(shots, `${name}.png`), fullPage: false })
async function freshPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const page = await context.newPage()
  page.on('pageerror', err => console.log('[page error]', err.message)) // eslint-disable-line no-console
  return { context, page }
}
const meteorUserId = page => page.evaluate(() => localStorage.getItem('Meteor.userId'))

async function payWithTestCard(page) {
  const frame = page.frameLocator('[data-pay-fields] iframe[title*="Secure payment input"]').first()
  const card = frame.locator('input[name="number"]')
  await card.waitFor({ timeout: 30000 })
  await card.fill('4242424242424242')
  await frame.locator('input[name="expiry"]').fill('12 / 34')
  await frame.locator('input[name="cvc"]').fill('123')
  const country = frame.locator('select[name="country"]')
  if (await country.count()) await country.selectOption('US')
  const zip = frame.locator('input[name="postalCode"]')
  if (await zip.count()) await zip.fill('10001')
}
const payButton = page => page.locator('.pay-sheet button').filter({ hasText: /^Pay / })

before(async () => {
  if (!base) return
  mkdirSync(shots, { recursive: true })
  chromium = createRequire(join(playwrightDir, 'package.json'))('@playwright/test').chromium
  browser = await chromium.launch()
  // the local app sells Pro as Slatebox Cloud does (the admin switch, settings.free.proRequiredFrom 'now'); the meter
  // reads its settings again within 15 s
  const was = mongo(`db.systemSettings.findOne({ _id: 'metering' }, { 'free.proRequiredFrom': 1 })`)?.free?.proRequiredFrom
  if (was !== 'now') {
    mongo(`db.systemSettings.updateOne({ _id: 'metering' }, { $set: { 'free.proRequiredFrom': 'now' } }, { upsert: true }).modifiedCount`)
    await new Promise(r => setTimeout(r, 16000))
  }
})
after(async () => { await browser?.close(); closeAll() })

test('a new visitor: site link → the sheet on the plan picked → test card → Pro on → email named → optional password', live, async () => {
  const email = `buyer-${tag()}@example.com`
  const { context, page } = await freshPage()
  await page.goto(`${base}/pro?plan=yearly`)
  const sheet = page.locator('.pay-sheet[data-pay-stage="ready"]')
  await sheet.waitFor({ timeout: 60000 })
  assert.equal(await page.evaluate(() => location.pathname), '/', 'the sheet opens over My Slates')
  const userId = await meteorUserId(page)
  assert.ok(userId, 'a guest was made for the visitor')
  assert.equal(userById(userId).isAnonymous, true)
  // the yearly choice is the one selected, and no sign-up wall stands in the way
  await page.locator('[data-pay-pane="pro"]').waitFor()
  assert.match(await page.locator('[data-pay-pane="pro"]').innerText(), /\$50 a year/)
  assert.equal(await page.getByText('Save my Slatebox').count(), 0)
  const emailField = page.locator('input[data-pay-email]')
  await emailField.waitFor({ timeout: 30000 })
  await shot(page, '01-guest-sheet-yearly')
  await emailField.fill(email)
  await emailField.blur()
  await payWithTestCard(page)
  await page.waitForFunction(() => [...document.querySelectorAll('.pay-sheet button')].some(b => /^Pay \$/.test(b.textContent) && !b.disabled && !/\+ tax/.test(b.textContent)), null, { timeout: 30000 })
  const label = await payButton(page).innerText()
  assert.match(label, /^Pay \$5\d\.\d\d$/, 'yearly $50 plus the tax Stripe Tax computed: ' + label)
  await shot(page, '02-guest-card-filled')
  const since = Math.floor(Date.now() / 1000) - 5
  await payButton(page).click()
  await page.locator('[data-pay-welcome="ready"]').waitFor({ timeout: 60000 })
  await page.locator('[data-pay-claim="attached"]').waitFor({ timeout: 10000 })
  await page.waitForTimeout(1300) // the celebration's motion settles
  await shot(page, '03-guest-welcome-password-prompt')
  const u = userById(userId)
  assert.equal(u.isAnonymous, false, 'the guest account is the buyer\'s account now')
  assert.deepEqual(u.emails, [{ address: email, verified: false }])
  assert.equal(u.pro.status, 'active')
  assert.equal(u.pro.interval, 'year')
  assert.equal(u.checkoutClaim.kind, 'attached')
  if (mailDir) assert.ok(mailsTo(email).some(m => /verify-email/.test(m)), 'a confirmation email went to the buyer')
  // the optional password: never required, saved when given
  await page.locator('input[data-pay-claim-password]').fill('correct-horse-9')
  await page.locator('[data-pay-claim-save]').click()
  await page.getByText('Password saved').waitFor({ timeout: 10000 })
  await shot(page, '04-guest-password-saved')
  assert.equal(userById(userId).checkoutClaim.passwordSet, true)
  // the buyer can now sign in anywhere with that email and password
  const elsewhere = await connect()
  const signedIn = await elsewhere.call('login', { user: { email }, password: digest('correct-horse-9') })
  assert.equal(signedIn.id, userId, 'the password signs in to the account the payment named')
  // the webhook for the same checkout changes nothing more (idempotent)
  if (stripeKey) {
    await deliverCheckoutEvent(userId, since)
    assert.equal(mailsTo(email).filter(m => /verify-email/.test(m)).length, mailDir ? 1 : 0)
  }
  await context.close()
})

test('the tab closed mid-payment: the webhook alone switches Pro on and names the account', { skip: live.skip || (!stripeKey && 'set STRIPE_TEST_KEY') }, async () => {
  const email = `closer-${tag()}@example.com`
  const { context, page } = await freshPage()
  await page.goto(`${base}/pro?plan=monthly`)
  await page.locator('.pay-sheet[data-pay-stage="ready"]').waitFor({ timeout: 60000 })
  const userId = await meteorUserId(page)
  assert.match(await page.locator('[data-pay-pane="pro"]').innerText(), /\$5 a month/)
  await page.locator('input[data-pay-email]').fill(email)
  await page.locator('input[data-pay-email]').blur()
  await payWithTestCard(page)
  await page.waitForFunction(() => [...document.querySelectorAll('.pay-sheet button')].some(b => /^Pay \$/.test(b.textContent) && !b.disabled && !/\+ tax/.test(b.textContent)), null, { timeout: 30000 })
  const since = Math.floor(Date.now() / 1000) - 5
  await payButton(page).click()
  // paid in the browser; the sheet would ask the server a second later. Close before it can.
  await page.locator('.pay-sheet[data-pay-stage="finalizing"]').waitFor({ timeout: 60000 })
  await context.close()
  assert.equal(userById(userId).pro?.status ?? null, null, 'nothing was confirmed from the closed tab')
  await deliverCheckoutEvent(userId, since)
  const u = userById(userId)
  assert.equal(u.pro.status, 'active')
  assert.equal(u.pro.interval, 'month')
  assert.equal(u.isAnonymous, false)
  assert.equal(u.emails[0].address, email)
})

test('a signed-in member: the site link opens the sheet at once, with no email field', live, async () => {
  const member = await registeredUser('member')
  const { context, page } = await freshPage()
  await page.goto(`${base}/login`)
  await page.evaluate(([id, token]) => { localStorage.setItem('Meteor.userId', id); localStorage.setItem('Meteor.loginToken', token); localStorage.setItem('Meteor.loginTokenExpires', new Date(Date.now() + 864e5).toString()) }, [member.userId, member.token])
  await page.goto(`${base}/pro?plan=monthly`)
  await page.locator('.pay-sheet[data-pay-stage="ready"]').waitFor({ timeout: 60000 })
  assert.equal(await meteorUserId(page), member.userId, 'no guest was made for a member')
  assert.equal(await page.locator('input[data-pay-email]').count(), 0, 'the member pays with their own address')
  assert.match(await page.locator('[data-pay-pane="pro"]').innerText(), /\$5 a month/)
  await payWithTestCard(page)
  await page.waitForFunction(() => [...document.querySelectorAll('.pay-sheet button')].some(b => /^Pay \$/.test(b.textContent) && !b.disabled && !/\+ tax/.test(b.textContent)), null, { timeout: 30000 })
  await shot(page, '05-member-sheet-monthly')
  await payButton(page).click()
  await page.locator('[data-pay-welcome="ready"]').waitFor({ timeout: 60000 })
  assert.equal(await page.locator('[data-pay-claim]').count(), 0, 'no claim step for a member')
  await page.waitForTimeout(1300)
  await shot(page, '06-member-welcome')
  const u = userById(member.userId)
  assert.equal(u.pro.status, 'active')
  assert.equal(u.emails[0].address, member.email)
  // the old site link sends a member to their own Credits tab, a guest or visitor to the sheet
  await page.goto(`${base}/profile?tab=credits`)
  await page.waitForTimeout(1500)
  assert.equal(await page.evaluate(() => location.pathname), '/profile')
  await context.close()
})

test('an email that already has an account: nothing attached, nobody signed in, a move link that moves Pro and slates', live, async () => {
  const owner = await registeredUser('owner')
  const typed = owner.email.toUpperCase()
  const { context, page } = await freshPage()
  // the old site link leads a visitor into the same sheet
  await page.goto(`${base}/profile?tab=credits`)
  await page.locator('.pay-sheet[data-pay-stage="ready"]').waitFor({ timeout: 60000 })
  const guestId = await meteorUserId(page)
  assert.notEqual(guestId, owner.userId)
  mongo(`db.slates.insertOne({ _id: 'guestslate${tag()}', userId: ${JSON.stringify(guestId)}, shareId: 'gs${tag()}', options: { name: 'Guest board' }, nodes: [] })`)
  await page.locator('input[data-pay-email]').fill(typed)
  await page.locator('input[data-pay-email]').blur()
  await payWithTestCard(page)
  await page.waitForFunction(() => [...document.querySelectorAll('.pay-sheet button')].some(b => /^Pay \$/.test(b.textContent) && !b.disabled && !/\+ tax/.test(b.textContent)), null, { timeout: 30000 })
  await payButton(page).click()
  await page.locator('[data-pay-welcome="ready"]').waitFor({ timeout: 60000 })
  await page.locator('[data-pay-claim="existing"]').waitFor({ timeout: 10000 })
  await page.waitForTimeout(1300)
  await shot(page, '07-existing-email-welcome')
  // the buyer is still the guest: never signed in to the owner's account
  assert.equal(await meteorUserId(page), guestId)
  const g = userById(guestId)
  assert.equal(g.isAnonymous, true)
  assert.match(g.emails[0].address, /@anonymous\.slatebox\.invalid$/)
  assert.equal(g.pro.status, 'active', 'Pro is on where it was paid, until the link is opened')
  const o = userById(owner.userId)
  assert.equal(o.pro ?? null, null, 'the owner\'s account is untouched')
  assert.equal(o.emails[0].address, owner.email)
  assert.equal(userByEmail(owner.email.toLowerCase())?._id ?? owner.userId, owner.userId)
  // the link went to the owner's address only
  const mail = mailDir ? mailsTo(owner.email.toLowerCase()).find(m => /Move your Slatebox Pro/.test(m)) : null
  if (!mailDir) return context.close()
  assert.ok(mail, 'a move link went to the owner\'s address')
  const link = mail.match(/https?:\/\/\S+\/login-link\/[A-Za-z0-9_-]+/)[0].replace(/^https?:\/\/[^/]+/, base)
  // the owner opens it (their own browser)
  const ownerBrowser = await freshPage()
  await ownerBrowser.page.goto(link)
  await ownerBrowser.page.waitForFunction(id => localStorage.getItem('Meteor.userId') === id, owner.userId, { timeout: 30000 })
  await ownerBrowser.page.waitForTimeout(1500)
  await shot(ownerBrowser.page, '08-owner-after-move-link')
  const moved = userById(owner.userId)
  assert.equal(moved.pro.status, 'active', 'Pro moved to the owner\'s account')
  assert.equal(moved.pro.subscriptionId, g.pro.subscriptionId)
  assert.equal(userById(guestId).pro, null)
  assert.equal(userById(guestId).checkoutClaim.kind, 'merged')
  assert.equal(mongo(`db.slates.countDocuments({ userId: ${JSON.stringify(guestId)} })`), 0)
  assert.ok(mongo(`db.slates.countDocuments({ userId: ${JSON.stringify(owner.userId)}, 'options.name': 'Guest board' })`) >= 1, 'the guest\'s slate moved too')
  // a second open does nothing
  const again = await freshPage()
  await again.page.goto(link)
  await again.page.waitForURL(/\/login/, { timeout: 30000 })
  assert.notEqual(await meteorUserId(again.page), owner.userId)
  // and the guest's own browser was never signed in to the owner's account
  assert.equal(await meteorUserId(page), guestId)
  await Promise.all([context.close(), ownerBrowser.context.close(), again.context.close()])
})
