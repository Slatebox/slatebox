import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  bankKind, brandName, longDate, manageOutcome, manageView, receiptRows, runBankStep,
} from '../web/app/imports/ui/components/billing/pay/manage-view.mjs'

// Lane D (design §5.1 Manage, §6 Manage actions, §3.2): Your Pro in the sheet is one list: the
// status, then switch (with the server's preview) or the pending monthly switch, the card, receipts,
// stop renewing or keep Pro, and the billing page as the fallback. Pure: what the pane shows for a
// meter.summary, and what each server answer means for the sheet.
// Dates are the person's local calendar date (billing-date.mjs); these fixtures are written in UTC
// (PREVIEW.nextDate is midnight UTC), so this file reads them in UTC. billing-date.test.mjs checks
// other zones.
process.env.TZ = 'UTC'
const RENEWS = '2026-12-22T12:00:00.000Z'
const YEAR_END = '2027-11-22T12:00:00.000Z'
const monthly = (over = {}) => ({
  proAvailable: true,
  emailVerified: true,
  inApp: true,
  proState: { active: true, status: 'active', interval: 'month', renewsOn: RENEWS, endsOn: null, cancelAtPeriodEnd: false, pastDue: false, onHold: false },
  proRenews: true,
  proActionNeeded: false,
  proPending: null,
  proSwitchExpired: false,
  proCard: { brand: 'visa', last4: '4242', expMonth: 4, expYear: 2029 },
  ...over,
})
const yearly = (over = {}) => monthly({ proState: { ...monthly().proState, interval: 'year', renewsOn: YEAR_END }, ...over })
const PREVIEW = { interval: 'year', atRenewal: false, todayCents: 4462, taxCents: 312, nextAmountCents: 5000, nextDate: '2027-11-22T00:00:00.000Z' }
const row = (view, key) => view.rows.find(r => r.key === key)

test('dates and card brands read the way the mock does', () => {
  assert.equal(longDate(RENEWS), 'December 22, 2026')
  assert.equal(longDate(null), '')
  assert.equal(brandName('visa'), 'Visa')
  assert.equal(brandName('mastercard'), 'Mastercard')
  assert.equal(brandName('amex'), 'American Express')
  assert.equal(brandName('something_new'), 'Card')
})

test('monthly Pro: status, pay yearly with the server\'s figure, card, receipts, stop renewing, billing page', () => {
  const view = manageView(monthly(), { preview: PREVIEW, invoices: [] })
  assert.equal(view.status.title, 'Pro is on · monthly, $5 plus tax')
  assert.equal(view.status.when, 'Renews on December 22, 2026')
  assert.equal(view.status.warn, false)
  assert.equal(view.pinned, null)
  assert.deepEqual(view.rows.map(r => r.key), ['switch', 'card', 'receipts', 'renewal'])
  const sw = row(view, 'switch')
  assert.equal(sw.title, 'Pay yearly instead')
  assert.equal(sw.sub, '$50 a year. You pay $44.62 today, tax included, after credit for the rest of this month.')
  assert.equal(sw.button, 'Switch')
  assert.equal(sw.job, 'to-year')
  assert.equal(sw.confirm.text, 'Pay yearly: $44.62 today, tax included. Pro then renews on November 22, 2027.')
  assert.equal(sw.confirm.yes, 'Pay $44.62 and switch')
  assert.equal(sw.confirm.no, 'Not now')
  assert.equal(sw.disabled, false)
  const card = row(view, 'card')
  assert.equal(card.title, 'Visa ending 4242')
  assert.equal(card.sub, 'Expires 04/29')
  assert.equal(card.button, 'Change card')
  const stop = row(view, 'renewal')
  assert.equal(stop.title, 'Stop renewing')
  assert.equal(stop.sub, 'Pro stays on until December 22, 2026.')
  assert.equal(stop.job, 'stop')
  assert.equal(stop.confirm.text, 'Stop renewing? Pro stays on until December 22, 2026, then ends. Nothing more is charged.')
  assert.equal(stop.confirm.yes, 'Stop renewing')
  assert.equal(stop.confirm.no, 'Keep Pro')
  assert.equal(view.portal.show, true)
  assert.equal(view.portal.note, null)
})

test('the switch never shows a figure the server has not worked out', () => {
  const loading = row(manageView(monthly(), { preview: undefined }), 'switch')
  assert.equal(loading.sub, '$50 a year, 2 months free. Working out what you pay today…')
  assert.equal(loading.disabled, true)
  const failed = row(manageView(monthly(), { preview: null }), 'switch')
  assert.equal(failed.sub, '$50 a year, 2 months free. You pay the difference today, after credit for the rest of this month.')
  assert.equal(failed.disabled, false)
  assert.equal(failed.confirm.text, 'Pay yearly: the difference is charged today, after credit for the rest of this month.')
  assert.equal(failed.confirm.yes, 'Pay and switch')
  // no tax on the preview: the words do not claim any
  const untaxed = row(manageView(monthly(), { preview: { ...PREVIEW, taxCents: 0, todayCents: 4150 } }), 'switch')
  assert.equal(untaxed.sub, '$50 a year. You pay $41.50 today, after credit for the rest of this month.')
})

test('yearly Pro: pay monthly at renewal; once asked, "Monthly from …" with Keep yearly, and the billing page note', () => {
  const view = manageView(yearly(), { invoices: [] })
  assert.equal(view.status.title, 'Pro is on · yearly, $50 plus tax')
  const sw = row(view, 'switch')
  assert.equal(sw.title, 'Pay monthly instead')
  assert.equal(sw.sub, '$5 a month plus tax from November 22, 2027, when this year ends. Nothing changes until then.')
  assert.equal(sw.job, 'to-month')
  assert.equal(sw.confirm.text, 'Switch to monthly from November 22, 2027? Your year runs to the end, and nothing is refunded.')
  assert.equal(sw.confirm.yes, 'Switch at renewal')

  const pending = manageView(yearly({ proPending: { interval: 'month', from: YEAR_END } }), { invoices: [] })
  assert.deepEqual(pending.rows.map(r => r.key), ['pending', 'card', 'receipts', 'renewal'])
  const p = row(pending, 'pending')
  assert.equal(p.title, 'Monthly from November 22, 2027')
  assert.equal(p.sub, 'Your year runs to the end, then $5 a month plus tax.')
  assert.equal(p.button, 'Keep yearly')
  assert.equal(p.job, 'keep-year')
  assert.equal(p.confirm, null)
  // stopping drops the pending switch, and the confirm says so
  assert.match(row(pending, 'renewal').confirm.text, /Your switch to monthly is dropped\.$/)
  // the billing page cannot stop or switch a subscription with a schedule attached (lane B's finding)
  assert.equal(pending.portal.show, true)
  assert.equal(pending.portal.note, 'While monthly is waiting, the billing page can change your card and show receipts, but not stop or switch Pro.')
})

test('Pro that will not renew: Keep Pro, and no switch', () => {
  const view = manageView(monthly({ proState: { ...monthly().proState, renewsOn: null, endsOn: RENEWS, cancelAtPeriodEnd: true }, proRenews: false }), { invoices: [] })
  assert.equal(view.status.title, 'Pro is on until December 22, 2026')
  assert.equal(view.status.when, 'It will not renew.')
  assert.deepEqual(view.rows.map(r => r.key), ['card', 'receipts', 'renewal'])
  const keep = row(view, 'renewal')
  assert.equal(keep.title, 'Keep Pro')
  assert.equal(keep.sub, 'Pro renews on December 22, 2026 again, $5 a month plus tax.')
  assert.equal(keep.button, 'Keep Pro')
  assert.equal(keep.job, 'keep')
  assert.equal(keep.confirm, null)
})

test('past due: "Update your card" is pinned and the switch waits', () => {
  const view = manageView(monthly({ proState: { ...monthly().proState, active: false, status: 'past_due', pastDue: true, renewsOn: null } }), { invoices: [] })
  assert.equal(view.status.title, "Pro's last payment didn't go through")
  assert.equal(view.status.warn, true)
  assert.deepEqual(view.pinned, { key: 'past-due', title: 'Update your card', sub: 'Your Pro credits are paused. Add a card and we try the payment again at once.', button: 'Update card' })
  assert.equal(row(view, 'switch'), undefined)
})

test('a payment that waits for the bank: "Confirm your card" is pinned above everything', () => {
  const view = manageView(monthly({ proActionNeeded: true }), { invoices: [] })
  assert.deepEqual(view.pinned, { key: 'confirm', title: 'Confirm your card', sub: 'Your bank wants you to confirm the last Pro payment.', button: 'Confirm' })
  // also when past due: the confirmation comes first
  const both = manageView(monthly({ proActionNeeded: true, proState: { ...monthly().proState, active: false, pastDue: true } }), { invoices: [] })
  assert.equal(both.pinned.key, 'confirm')
  // where payments leave the app, the bank's page is the open receipt's own page
  const hosted = manageView(monthly({ proActionNeeded: true, inApp: false }), { invoices: [{ number: 'SB-2', created: Date.parse(RENEWS), totalCents: 4462, status: 'open', url: 'https://invoice.example/2', pdf: null }] })
  assert.equal(hosted.pinned.href, 'https://invoice.example/2')
  assert.equal(hosted.pinned.button, 'Confirm')
})

test('notices: an expired switch to yearly, and a dispute hold', () => {
  const expired = manageView(monthly({ proSwitchExpired: true }), { preview: PREVIEW, invoices: [] })
  assert.deepEqual(expired.notices, ["Your switch to yearly didn't go through: the bank's confirmation wasn't finished. Nothing was charged, and Pro stays monthly."])
  assert.equal(row(expired, 'switch').job, 'to-year')
  const held = manageView(monthly({ proState: { ...monthly().proState, onHold: true } }), { invoices: [] })
  assert.deepEqual(held.notices, ['Your Pro credits are paused while a card dispute on a Pro payment is open.'])
})

test('no card on file, and no Pro at all', () => {
  assert.deepEqual(
    (({ title, sub, button }) => ({ title, sub, button }))(row(manageView(monthly({ proCard: null }), { invoices: [] }), 'card')),
    { title: 'Card', sub: 'Add the card your next Pro payment uses.', button: 'Add a card' },
  )
  const none = manageView({ proAvailable: true, emailVerified: true, proState: null }, {})
  assert.equal(none.status.title, 'You do not have Slatebox Pro.')
  assert.deepEqual(none.rows.map(r => r.key), ['get'])
  assert.equal(none.rows[0].button, 'Get Pro')
  assert.equal(none.portal.show, false)
  // Pro not on sale here: nothing to get
  assert.deepEqual(manageView({ proAvailable: false, proState: null }, {}).rows, [])
  // Pro that ended: get it again; its receipts stay
  const ended = manageView(monthly({ proState: { ...monthly().proState, active: false, status: 'canceled', renewsOn: null } }), { invoices: [] })
  assert.equal(ended.status.title, 'Your Pro has ended')
  assert.deepEqual(ended.rows.map(r => r.key), ['get', 'receipts'])
  assert.equal(ended.rows[0].button, 'Get Pro again')
})

test('receipts: the latest inline, all of them in place, Stripe\'s own pages for View and PDF', () => {
  const invoices = [
    { number: 'SB-0002', created: Date.parse('2026-11-22T12:00:00Z'), totalCents: 543, status: 'paid', url: 'https://invoice.example/2', pdf: 'https://invoice.example/2.pdf' },
    { number: 'SB-0001', created: Date.parse('2026-10-22T12:00:00Z'), totalCents: 543, status: 'void', url: 'https://invoice.example/1', pdf: null },
  ]
  const rec = row(manageView(monthly(), { invoices }), 'receipts')
  assert.equal(rec.title, 'Receipts')
  assert.equal(rec.sub, 'Latest: November 22, 2026, $5.43')
  assert.equal(rec.button, 'View all')
  assert.deepEqual(receiptRows(invoices), [
    { key: 'SB-0002', date: 'November 22, 2026', amount: '$5.43', status: 'Paid', url: 'https://invoice.example/2', pdf: 'https://invoice.example/2.pdf' },
    { key: 'SB-0001', date: 'October 22, 2026', amount: '$5.43', status: 'Void', url: 'https://invoice.example/1', pdf: null },
  ])
  assert.equal(row(manageView(monthly(), { invoices: undefined }), 'receipts').sub, 'Loading…')
  assert.equal(row(manageView(monthly(), { invoices: [] }), 'receipts').sub, 'No receipts yet.')
  assert.equal(row(manageView(monthly(), { invoices: [] }), 'receipts').button, null)
  assert.equal(row(manageView(monthly(), { invoices: null }), 'receipts').sub, 'Receipts are on the billing page.')
})

test('each server answer is one sheet event', () => {
  const after = yearly()
  assert.deepEqual(manageOutcome('to-year', { status: 'switched', interval: 'year' }, after), { type: 'manage-done', kind: 'switch', detail: { interval: 'year', nextDate: YEAR_END } })
  assert.deepEqual(manageOutcome('to-year', { status: 'needs-action', needsAction: true }, monthly()), { type: 'manage-bank' })
  assert.deepEqual(manageOutcome('to-year', { status: 'declined', message: 'Your card has insufficient funds.' }, monthly()), { type: 'manage-error', message: 'Your card has insufficient funds. Nothing was charged, and Pro stays monthly.' })
  assert.deepEqual(manageOutcome('to-month', { status: 'scheduled', interval: 'month', from: YEAR_END }, after), { type: 'manage-notice', text: 'Pro switches to monthly on November 22, 2027.' })
  assert.deepEqual(manageOutcome('keep-year', { status: 'kept', interval: 'year' }, after), { type: 'manage-notice', text: 'You stay on yearly.' })
  assert.deepEqual(manageOutcome('stop', { status: 'ending', until: RENEWS }, monthly()), { type: 'manage-notice', text: 'Pro stays on until December 22, 2026, then ends.' })
  assert.deepEqual(manageOutcome('keep', { status: 'renewing', until: null }, monthly()), { type: 'manage-notice', text: 'Pro renews again on December 22, 2026.' })
  // a refusal from the server is said in its own words
  assert.deepEqual(manageOutcome('stop', { error: 'too-many-requests', reason: 'Wait a moment.' }), { type: 'manage-error', message: 'Wait a moment.' })
  assert.deepEqual(manageOutcome('stop', { error: 'x' }), { type: 'manage-error', message: 'That did not work. Nothing was changed. Try again in a moment.' })
  // what the bank confirmed decides the Welcome
  assert.equal(bankKind(monthly({ proState: { ...monthly().proState, pastDue: true } })), 'card')
  assert.equal(bankKind(monthly()), 'switch')
})

test('the bank step: secret, the bank\'s own confirmation, then the server is asked until the payment is in', async () => {
  const waits = []
  const wait = ms => { waits.push(ms); return Promise.resolve() }
  // confirmed by the bank; the server sees the invoice paid on the second ask
  let asks = 0
  const done = await runBankStep({
    askSecret: async () => (++asks < 3 ? { clientSecret: 'pi_x_secret_y' } : { status: 'done' }),
    confirmWithBank: async secret => { assert.equal(secret, 'pi_x_secret_y'); return { paymentIntent: { status: 'succeeded' } } },
    wait,
  })
  assert.deepEqual(done, { outcome: 'done' })
  assert.equal(asks, 3)
  assert.deepEqual(waits, [1000])
  // nothing left to confirm
  assert.deepEqual(await runBankStep({ askSecret: async () => ({ status: 'done' }), confirmWithBank: async () => assert.fail('no bank step'), wait }), { outcome: 'already' })
  // the bank said no: its words, then ours
  assert.deepEqual(await runBankStep({
    askSecret: async () => ({ clientSecret: 's' }),
    confirmWithBank: async () => ({ error: { message: 'We are unable to authenticate your payment method.' } }),
    wait,
  }), { outcome: 'error', message: 'We are unable to authenticate your payment method. Nothing was charged. Try again, or use another card.' })
  // confirmed, but the server has not seen it after the tries: said plainly, never celebrated
  assert.deepEqual(await runBankStep({ askSecret: async () => ({ clientSecret: 's' }), confirmWithBank: async () => ({ paymentIntent: {} }), wait, tries: 2 }), { outcome: 'slow' })
  // the server refused the secret
  assert.deepEqual(await runBankStep({ askSecret: async () => { throw Object.assign(new Error('x'), { reason: 'There is nothing to confirm.' }) }, confirmWithBank: async () => ({}), wait }), { outcome: 'error', message: 'There is nothing to confirm.' })
})

// ---------- wiring ----------

const appDir = new URL('../web/app/', import.meta.url)
const read = path => readFileSync(new URL(path, appDir), 'utf8')
const PAY = 'imports/ui/components/billing/pay/'

test('the Manage pane is built on manage-view and the server\'s Manage methods', () => {
  const pane = read(PAY + 'ManagePane.jsx')
  assert.match(pane, /from '\.\/manage-view\.mjs'/)
  for (const m of ['preview', 'invoices', 'switchInterval', 'renewal', 'actionSecret', 'portal']) assert.match(pane, new RegExp(`CONSTANTS\\.methods\\.pro\\.${m}\\b`), m)
  // the bank's confirmation goes through the one file that holds the payment SDK
  assert.match(pane, /confirmWithBank/)
  assert.match(read(PAY + 'StripeCheckout.jsx'), /export (async )?function confirmWithBank[\s\S]*handleNextAction\(\{ clientSecret \}\)/)
  assert.doesNotMatch(pane, /@stripe\//)
  // receipts open the processor's own pages in a new tab
  assert.match(pane, /target="_blank"/)
  assert.match(pane, /rel="noopener noreferrer"/)
  // the stand-in is gone
  assert.doesNotMatch(pane, /stand-in/i)
})

test('the card pane goes back to Your Pro; a card that needs the bank or is declined stays in the sheet', () => {
  const card = read(PAY + 'CardPane.jsx')
  assert.match(card, /Back to Your Pro/)
  const host = read(PAY + 'PaySheetHost.jsx')
  assert.match(host, /type: 'needs-action'/)
  assert.match(host, /type: 'card-declined'/)
  // the card session is idempotent per attempt, like the others (design §7.3)
  assert.match(read(PAY + 'pay-env.js'), /cardSession, \{[^}]*attemptId/)
  // no stand-in words left in the sheet
  for (const f of readdirSync(new URL(PAY, appDir))) assert.doesNotMatch(read(PAY + f), /stand-in for lane D/i, f)
})
