import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { billingDate, dayOfMonth, proStatusText } from '../web/app/imports/ui/components/billing/billing-date.mjs'
import { longDate, manageView, receiptRows } from '../web/app/imports/ui/components/billing/pay/manage-view.mjs'
import { welcomeCopy } from '../web/app/imports/ui/components/billing/pay/pay-copy.mjs'
import { dayText } from '../web/app/imports/ui/components/billing/money.js'

// Every Pro and billing date is the person's own calendar date of the Stripe timestamp, from one
// helper (billing-date.mjs): the profile and the pay sheet's Your Pro never disagree by a day.
const read = path => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')

// Run fn with the process in another time zone (Node reads TZ again when it changes).
function inZone(zone, fn) {
  const before = process.env.TZ
  process.env.TZ = zone
  try { return fn() } finally {
    if (before === undefined) delete process.env.TZ
    else process.env.TZ = before
  }
}

const summaryFor = renewsOn => ({
  proAvailable: true, emailVerified: true, inApp: true, proRenews: true, proActionNeeded: false, proPending: null, proSwitchExpired: false,
  proState: { active: true, status: 'active', interval: 'month', renewsOn, endsOn: null, cancelAtPeriodEnd: false, pastDue: false, onHold: false },
  proCard: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2034 },
})

// Both renders of one renewal: Profile → Credits (proStatusText) and Your Pro (manageView).
const renders = renewsOn => {
  const pro = summaryFor(renewsOn).proState
  return { profile: proStatusText(pro), manage: manageView(summaryFor(renewsOn)).status.when }
}

test('near midnight UTC, the profile and Your Pro show the same renewal date: the person\'s own', () => {
  // 03:30 UTC on the 23rd is the evening of the 22nd in Chicago (the bug: profile 22, Your Pro 23)
  const lateEvening = '2026-12-23T03:30:00.000Z'
  inZone('America/Chicago', () => {
    const r = renders(lateEvening)
    assert.equal(r.profile, 'You have Slatebox Pro (monthly). It renews on December 22, 2026.')
    assert.equal(r.manage, 'Renews on December 22, 2026')
  })
  // 20:00 UTC on the 22nd is already the 23rd in Tokyo
  const tokyoMorning = '2026-12-22T20:00:00.000Z'
  inZone('Asia/Tokyo', () => {
    const r = renders(tokyoMorning)
    assert.equal(r.profile, 'You have Slatebox Pro (monthly). It renews on December 23, 2026.')
    assert.equal(r.manage, 'Renews on December 23, 2026')
  })
  // in UTC itself, the UTC date
  inZone('UTC', () => assert.equal(renders(lateEvening).manage, 'Renews on December 23, 2026'))
  // and every other date on those surfaces reads the same day: ending Pro, receipts, the switch's Welcome, the balance's rows
  inZone('America/Chicago', () => {
    assert.equal(proStatusText({ active: true, endsOn: lateEvening }), 'You have Slatebox Pro until December 22, 2026. It will not renew.')
    assert.equal(longDate(lateEvening), 'December 22, 2026')
    assert.equal(receiptRows([{ number: 'SB-1', created: lateEvening, totalCents: 543, status: 'paid' }])[0].date, 'December 22, 2026')
    assert.equal(welcomeCopy({ kind: 'switch', interval: 'year', confirmed: true, nextDate: lateEvening }).lead, 'Pro next renews on December 22, 2026.')
    assert.equal(dayText(lateEvening), 'Dec 22')
    assert.equal(dayOfMonth(lateEvening), '22nd')
  })
})

test('the helper: formats, epoch ms and Dates, ordinals, and nothing for no date', () => {
  inZone('UTC', () => {
    const at = '2026-12-01T12:00:00.000Z'
    assert.equal(billingDate(at), 'December 1, 2026')
    assert.equal(billingDate(Date.parse(at)), 'December 1, 2026')
    assert.equal(billingDate(new Date(at), 'dayMonth'), 'December 1')
    assert.equal(billingDate(at, 'short'), 'Dec 1')
    assert.deepEqual(['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-11', '2026-12-12', '2026-12-13', '2026-12-21', '2026-12-22', '2026-12-23'].map(d => dayOfMonth(d + 'T12:00:00Z')), ['1st', '2nd', '3rd', '11th', '12th', '13th', '21st', '22nd', '23rd'])
  })
  for (const none of [null, undefined, '', 'not a date']) {
    assert.equal(billingDate(none), '')
    assert.equal(dayOfMonth(none), '')
  }
  assert.equal(proStatusText(null), null)
})

test('no Pro or billing component formats a date itself', () => {
  const dir = 'imports/ui/components/billing'
  const files = [...readdirSync(new URL('../web/app/' + dir, import.meta.url)).map(f => `${dir}/${f}`), ...readdirSync(new URL(`../web/app/${dir}/pay`, import.meta.url)).map(f => `${dir}/pay/${f}`)]
    .filter(f => /\.(m?js|jsx)$/.test(f) && !f.endsWith('billing-date.mjs'))
  for (const file of files) {
    const text = read(file)
    assert.doesNotMatch(text, /toLocaleDateString|toLocaleString\(|Intl\.DateTimeFormat|timeZone:/, file)
  }
  assert.match(read(`${dir}/ProPanel.jsx`), /const status = proStatusText\(pro\)/)
})
