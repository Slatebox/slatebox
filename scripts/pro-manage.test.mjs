import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  actionSecret, applyDefaultCard, cardOf, cardSessionKey, cardSessionParams, invoiceRows, previewSwitch, setRenewal, switchInterval,
} from '../web/app/server/pro-manage.mjs'
import { METER_RATE_LIMITS } from '../web/app/server/metering/limits.mjs'

// Pro managed in the sheet (design §3.2): switch month↔year, stop or keep renewing, change the
// card, confirm a card that needs it, receipts. The subscription always comes from users.pro and
// is checked against the stored customer. No network: Stripe and Mongo are in memory.
const NOW = Date.UTC(2026, 10, 22, 12)
const DAY = 86_400_000
const sec = ms => Math.floor(ms / 1000)
const A1 = '0b6a3b9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const A2 = '1c7b4c0f-2d3e-4f60-9b0c-1d2e3f4a5b6c'
const A3 = '2d8c5d10-3e4f-4071-8c1d-2e3f4a5b6c7d'
const PRICES = { month: { id: 'price_m', unit_amount: 500 }, year: { id: 'price_y', unit_amount: 5000 } }

const item = (interval = 'month') => ({
  id: 'si_1', quantity: 1,
  price: { id: interval === 'year' ? 'price_y' : 'price_m', product: 'slatebox_pro', lookup_key: interval === 'year' ? 'pro_yearly_usd_5000' : 'pro_monthly_usd_500', recurring: { interval } },
  current_period_start: sec(NOW - 10 * DAY), current_period_end: sec(NOW + (interval === 'year' ? 355 : 20) * DAY),
})
const subOf = (over = {}) => ({
  id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { product: 'pro', userId: 'u1' }, created: sec(NOW - 10 * DAY),
  cancel_at_period_end: false, schedule: null, pending_update: null, default_payment_method: 'pm_old', latest_invoice: 'in_1',
  items: { data: [item()] }, ...over,
})

function world({ sub = subOf(), pro = { subscriptionId: 'sub_1', customerId: 'cus_1', status: 'active' } } = {}) {
  const calls = []
  const subs = new Map([[sub.id, structuredClone(sub)]])
  const schedules = new Map(), invoices = new Map(), setupIntents = new Map()
  const customers = new Map([['cus_1', { id: 'cus_1', invoice_settings: { default_payment_method: 'pm_old' } }]])
  const people = new Map([['u1', { _id: 'u1', pro: structuredClone(pro) }]])
  const log = (name, ...args) => calls.push([name, ...structuredClone(args)])
  let payOutcome = 'paid'
  let scheduleCount = 0
  // Like Stripe: a key's first answer (or error) is kept and replayed for the same parameters; the
  // same key with other parameters is an idempotency_error. Replays run nothing.
  const kept = new Map()
  const keyed = (name, fn) => async (...args) => {
    const opts = args.at(-1)
    const key = opts?.idempotencyKey
    if (!key) return fn(...args)
    const shape = JSON.stringify(args.slice(0, -1))
    const hit = kept.get(key)
    if (hit) {
      log('replay', name, key)
      if (hit.name !== name || hit.shape !== shape) throw Object.assign(new Error('Keys for idempotent requests can only be used with the same parameters they were first used with.'), { type: 'StripeIdempotencyError', rawType: 'idempotency_error', statusCode: 400 })
      if (hit.error) throw hit.error
      return structuredClone(hit.out)
    }
    try {
      const out = await fn(...args)
      kept.set(key, { name, shape, out: structuredClone(out) })
      return out
    } catch (error) {
      kept.set(key, { name, shape, error })
      throw error
    }
  }
  const stripe = {
    subscriptions: {
      async retrieve(id) { log('subscriptions.retrieve', id); return structuredClone(subs.get(id)) },
      update: keyed('subscriptions.update', async (id, params, opts) => {
        log('subscriptions.update', id, params, opts?.idempotencyKey)
        const s = subs.get(id)
        if (params.items) {
          if (params.payment_behavior === 'pending_if_incomplete' && payOutcome !== 'paid') {
            s.pending_update = { subscription_items: params.items, expires_at: sec(NOW + DAY) }
            s.latest_invoice = { id: 'in_switch', status: 'open', payments: { data: [{ status: 'open', payment: { payment_intent: { id: 'pi_s', status: payOutcome } } }] } }
            invoices.set('in_switch', { id: 'in_switch', customer: 'cus_1', status: 'open', confirmation_secret: { client_secret: 'pi_s_secret_x', type: 'payment_intent' } })
          } else {
            // a later update that goes through replaces any pending one (as Stripe does)
            s.items.data = [item('year')]
            s.pending_update = null
          }
        }
        if ('cancel_at_period_end' in params) s.cancel_at_period_end = params.cancel_at_period_end
        if (params.default_payment_method) s.default_payment_method = params.default_payment_method
        const out = structuredClone(s)
        if (typeof s.latest_invoice === 'object') s.latest_invoice = s.latest_invoice.id
        return out
      }),
    },
    subscriptionSchedules: {
      create: keyed('subscriptionSchedules.create', async (params, opts) => {
        log('subscriptionSchedules.create', params, opts?.idempotencyKey)
        const s = subs.get(params.from_subscription)
        const it = s.items.data[0]
        const sched = { id: `sub_sched_${++scheduleCount}`, status: 'active', subscription: s.id, end_behavior: 'release', default_settings: { default_payment_method: s.default_payment_method },
          phases: [{ start_date: it.current_period_start, end_date: it.current_period_end, items: [{ price: it.price.id, quantity: 1 }], automatic_tax: { enabled: true }, default_payment_method: null }] }
        schedules.set(sched.id, sched)
        s.schedule = sched.id
        return structuredClone(sched)
      }),
      update: keyed('subscriptionSchedules.update', async (id, params, opts) => {
        log('subscriptionSchedules.update', id, params, opts?.idempotencyKey)
        if (schedules.get(id).status !== 'active') throw Object.assign(new Error(`You cannot update a subscription schedule that is currently in the \`${schedules.get(id).status}\` status.`), { type: 'StripeInvalidRequestError', statusCode: 400 })
        Object.assign(schedules.get(id), structuredClone(params))
        return structuredClone(schedules.get(id))
      }),
      async retrieve(id) { log('subscriptionSchedules.retrieve', id); return structuredClone(schedules.get(id)) },
      release: keyed('subscriptionSchedules.release', async (id, params, opts) => {
        log('subscriptionSchedules.release', id, opts?.idempotencyKey)
        const sched = schedules.get(id)
        sched.status = 'released'
        subs.get(sched.subscription).schedule = null
        return structuredClone(sched)
      }),
    },
    invoices: {
      async createPreview(params) {
        log('invoices.createPreview', params)
        return { amount_due: 4562, total: 4562, total_taxes: [{ amount: 312 }], lines: { data: [{ period: { start: sec(NOW), end: sec(NOW + 365 * DAY) } }] } }
      },
      async retrieve(id, params) { log('invoices.retrieve', id, params); return structuredClone(invoices.get(id)) },
      pay: keyed('invoices.pay', async (id, params, opts) => {
        log('invoices.pay', id, params, opts?.idempotencyKey)
        if (payOutcome === 'requires_action') throw Object.assign(new Error('This payment requires additional user action before it can be completed successfully.'), { type: 'StripeCardError', code: 'invoice_payment_intent_requires_action' })
        if (payOutcome === 'declined') throw Object.assign(new Error('Your card has insufficient funds.'), { type: 'StripeCardError', code: 'card_declined' })
        invoices.get(id).status = 'paid'
        subs.get('sub_1').status = 'active'
        return structuredClone(invoices.get(id))
      }),
      async list(params) {
        log('invoices.list', params)
        return { data: [{ id: 'in_9', number: 'SB-0009', created: sec(NOW), total: 543, status: 'paid', customer: 'cus_1', customer_email: 'a@example.test', hosted_invoice_url: 'https://invoice.example/9', invoice_pdf: 'https://invoice.example/9.pdf', subscription: 'sub_1', payment_intent: 'pi_9' }] }
      },
    },
    customers: {
      async retrieve(id, params) { log('customers.retrieve', id, params); return structuredClone(customers.get(id)) },
      update: keyed('customers.update', async (id, params, opts) => { log('customers.update', id, params, opts?.idempotencyKey); Object.assign(customers.get(id), structuredClone(params)); return structuredClone(customers.get(id)) }),
    },
    setupIntents: { async retrieve(id) { log('setupIntents.retrieve', id); return structuredClone(setupIntents.get(id)) } },
  }
  const store = {
    async findProUser({ userId, subscriptionId }) {
      const all = [...people.values()]
      return structuredClone(all.find(u => subscriptionId && u.pro?.subscriptionId === subscriptionId) || people.get(userId) || null)
    },
    async writePro(userId, fields, fetchedAt) {
      const u = people.get(userId)
      if (u.pro?.fetchedAt != null && !(u.pro.fetchedAt < fetchedAt)) return false
      u.pro = { ...u.pro, ...structuredClone(fields) }
      return true
    },
    async setProCustomer() { return true },
    async setProHold() {},
    async findUserByProCustomer() { return null },
    async audit() {},
    async setProFields(userId, fields) { const u = people.get(userId); u.pro = { ...u.pro, ...structuredClone(fields) } },
    async clearProAction(userId, invoiceId) {
      const u = people.get(userId)
      if (u?.pro?.actionNeeded && (invoiceId == null || u.pro.actionNeeded.invoiceId === invoiceId)) u.pro = { ...u.pro, actionNeeded: null }
    },
  }
  let clock = NOW
  const deps = { stripe, store, alert: async () => {}, now: () => clock++ }
  return {
    deps, calls, subs, schedules, invoices, setupIntents, customers, people,
    pro: () => structuredClone(people.get('u1').pro),
    named: name => calls.filter(c => c[0] === name),
    outcome: value => { payOutcome = value },
  }
}

// ---------- switch ----------

test('month → year: the lookup-key price, always_invoice, pending_if_incomplete, no string billing_cycle_anchor; keyed per attempt', async () => {
  const w = world()
  const out = await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'year', attemptId: A1 })
  assert.equal(out.status, 'switched')
  const [[, id, params, key]] = w.named('subscriptions.update')
  assert.equal(id, 'sub_1')
  assert.deepEqual(params.items, [{ id: 'si_1', price: 'price_y' }])
  assert.equal(params.proration_behavior, 'always_invoice')
  assert.equal(params.payment_behavior, 'pending_if_incomplete')
  assert.notEqual(typeof params.billing_cycle_anchor, 'string')
  assert.equal(key, `switch:sub_1:price_y:${A1}`)
  // a malformed attempt is refused before Stripe is asked
  await assert.rejects(switchInterval(world().deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'year', attemptId: 'x' }), { error: 'attempt' })
  assert.equal(w.pro().interval, 'year', 'the state is written from a fresh read')
})

test('month → year that needs 3DS gives needsAction and records actionNeeded; a decline does not', async () => {
  const w = world()
  w.outcome('requires_action')
  const out = await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'year' })
  assert.deepEqual(out, { status: 'needs-action', needsAction: true })
  assert.equal(w.pro().actionNeeded.invoiceId, 'in_switch')
  assert.equal(w.pro().actionNeeded.kind, 'switch')
  // the sheet then asks for the invoice's confirmation secret
  const secret = await actionSecret(w.deps, { userId: 'u1', pro: w.pro() })
  assert.deepEqual(secret, { clientSecret: 'pi_s_secret_x' })
  assert.deepEqual(w.named('invoices.retrieve').at(-1)[2], { expand: ['confirmation_secret'] })

  const d = world()
  d.outcome('requires_payment_method')
  const declined = await switchInterval(d.deps, { userId: 'u1', pro: d.pro(), prices: PRICES, interval: 'year' })
  assert.equal(declined.status, 'declined')
  assert.equal(d.pro().actionNeeded, undefined)
})

test('year → month builds a two-phase schedule with end_behavior release at renewal, tax kept, and stores scheduleId', async () => {
  const w = world({ sub: subOf({ items: { data: [item('year')] } }) })
  const out = await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'month', attemptId: A1 })
  assert.equal(out.status, 'scheduled')
  assert.equal(out.from, new Date(sec(NOW + 355 * DAY) * 1000).toISOString())
  const [[, created, createKey]] = w.named('subscriptionSchedules.create')
  assert.deepEqual(created, { from_subscription: 'sub_1' })
  assert.equal(createKey, `schedule:sub_1:${A1}`)
  const [[, id, params, updateKey]] = w.named('subscriptionSchedules.update')
  assert.equal(updateKey, `schedule-update:sub_sched_1:${A1}`)
  assert.equal(id, 'sub_sched_1')
  assert.equal(params.end_behavior, 'release')
  assert.equal(params.phases.length, 2)
  const [now, next] = params.phases
  assert.deepEqual(now.items, [{ price: 'price_y', quantity: 1 }])
  assert.equal(now.start_date, sec(NOW - 10 * DAY))
  assert.equal(now.end_date, sec(NOW + 355 * DAY), 'the year runs out; nobody is refunded part of it')
  assert.deepEqual(next.items, [{ price: 'price_m', quantity: 1 }])
  assert.equal(next.proration_behavior, 'none')
  assert.deepEqual(next.automatic_tax, { enabled: true })
  assert.deepEqual(next.duration, { interval: 'month', interval_count: 1 })
  assert.equal(next.default_payment_method, undefined, 'the next phase follows the schedule default, which a card change updates')
  assert.deepEqual(next.metadata, { product: 'pro', userId: 'u1' })
  assert.equal(w.pro().scheduleId, 'sub_sched_1')
  // asking again changes nothing
  await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'month' })
  assert.equal(w.named('subscriptionSchedules.create').length, 1)
})

test('"Keep yearly" releases the schedule; the same interval with no schedule is refused', async () => {
  const w = world({ sub: subOf({ items: { data: [item('year')] } }) })
  await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'month' })
  const kept = await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'year' })
  assert.equal(kept.status, 'kept')
  assert.equal(w.named('subscriptionSchedules.release').length, 1)
  assert.equal(w.pro().scheduleId, null)
  await assert.rejects(switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'year' }), { error: 'same' })
})

test('month → year declined, then a new card: tapping Switch again charges the new card, not a replay of the decline', async () => {
  const w = world()
  w.outcome('requires_payment_method')
  const declined = await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'year', attemptId: A1 })
  assert.equal(declined.status, 'declined')
  // the person changes card, and the new card pays
  w.outcome('paid')
  const again = await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'year', attemptId: A2 })
  assert.equal(again.status, 'switched')
  assert.equal(w.pro().interval, 'year')
  assert.equal(w.named('replay').length, 0)
  // the same tap retried (same attempt) collapses into its first answer
  const n = w.named('subscriptions.update').length
  w.outcome('requires_payment_method')
  const retried = await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'year', attemptId: A2 }).catch(error => error)
  assert.equal(w.named('subscriptions.update').length, n, 'nothing new is sent to Stripe for the same attempt')
  assert.ok(retried.error === 'same' || retried.status === 'switched')
})

test('month → year after a bank step that failed: a new tap gets a new answer, not the old needs-action', async () => {
  const w = world()
  w.outcome('requires_action')
  assert.equal((await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'year', attemptId: A1 })).status, 'needs-action')
  w.outcome('paid')
  assert.equal((await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'year', attemptId: A2 })).status, 'switched')
})

test('"Pay monthly", "Keep yearly", "Pay monthly" again: a new live schedule, never the released one', async () => {
  const w = world({ sub: subOf({ items: { data: [item('year')] } }) })
  assert.equal((await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'month', attemptId: A1 })).status, 'scheduled')
  assert.equal((await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'year', attemptId: A2 })).status, 'kept')
  const out = await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'month', attemptId: A3 })
  assert.equal(out.status, 'scheduled')
  assert.equal(w.named('replay').length, 0)
  assert.equal(w.subs.get('sub_1').schedule, 'sub_sched_2')
  assert.equal(w.schedules.get('sub_sched_2').status, 'active')
  assert.equal(w.schedules.get('sub_sched_2').phases.length, 2)
  assert.equal(w.pro().scheduleId, 'sub_sched_2')
})

test('year → month answers "scheduled" only when the subscription carries the live schedule', async () => {
  // the same attempt replayed after "Keep yearly": the create answers the released schedule
  const w = world({ sub: subOf({ items: { data: [item('year')] } }) })
  await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'month', attemptId: A1 })
  await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'year', attemptId: A2 })
  await assert.rejects(
    switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'month', attemptId: A1 }),
    { error: 'switch-failed', reason: /Nothing changed/ },
  )
  assert.equal(w.subs.get('sub_1').schedule, null)
  assert.equal(w.pro().scheduleId ?? null, null, 'the account still says yearly')
})

test('the preview: month → year is invoiced today with tax; year → month is at renewal with nothing today', async () => {
  const w = world()
  const p = await previewSwitch(w.deps, { pro: w.pro(), prices: PRICES, interval: 'year' })
  assert.deepEqual(p, { interval: 'year', atRenewal: false, todayCents: 4562, taxCents: 312, nextAmountCents: 5000, nextDate: new Date(sec(NOW + 365 * DAY) * 1000).toISOString() })
  const [[, params]] = w.named('invoices.createPreview')
  assert.deepEqual(params, { customer: 'cus_1', subscription: 'sub_1', subscription_details: { items: [{ id: 'si_1', price: 'price_y' }], proration_behavior: 'always_invoice' } })
  const y = world({ sub: subOf({ items: { data: [item('year')] } }) })
  const back = await previewSwitch(y.deps, { pro: y.pro(), prices: PRICES, interval: 'month' })
  assert.deepEqual(back, { interval: 'month', atRenewal: true, todayCents: 0, taxCents: 0, nextAmountCents: 500, nextDate: new Date(sec(NOW + 355 * DAY) * 1000).toISOString() })
  assert.equal(y.named('invoices.createPreview').length, 0)
})

// ---------- renewal ----------

test('renewal toggles cancel_at_period_end, keyed per minute; running it twice changes nothing more', async () => {
  const w = world()
  const stop = await setRenewal(w.deps, { userId: 'u1', pro: w.pro(), renew: false })
  assert.equal(stop.status, 'ending')
  const [[, id, params, key]] = w.named('subscriptions.update')
  assert.deepEqual([id, params], ['sub_1', { cancel_at_period_end: true }])
  assert.match(key, /^renewal:sub_1:false:\d+$/)
  assert.equal(w.pro().cancelAtPeriodEnd, true)
  await setRenewal(w.deps, { userId: 'u1', pro: w.pro(), renew: false })
  assert.equal(w.named('subscriptions.update').length, 1, 'already ending: no second update')
  const keep = await setRenewal(w.deps, { userId: 'u1', pro: w.pro(), renew: true })
  assert.equal(keep.status, 'renewing')
  assert.deepEqual(w.named('subscriptions.update').at(-1)[2], { cancel_at_period_end: false })
  assert.equal(w.pro().cancelAtPeriodEnd, false)
})

test('renewal from the sheet is keyed per attempt, like the switch: a later tap is never answered from an earlier one', async () => {
  const w = world()
  const A1 = '11111111-2222-4333-8444-555555555555'
  const A2 = '66666666-7777-4888-9999-aaaaaaaaaaaa'
  const A3 = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  await setRenewal(w.deps, { userId: 'u1', pro: w.pro(), renew: false, attemptId: A1 })
  await setRenewal(w.deps, { userId: 'u1', pro: w.pro(), renew: true, attemptId: A2 })
  // stop again within the same minute: a new key, so Stripe makes the change instead of replaying A1
  const again = await setRenewal(w.deps, { userId: 'u1', pro: w.pro(), renew: false, attemptId: A3 })
  assert.equal(again.status, 'ending')
  assert.deepEqual(w.named('subscriptions.update').map(c => c[3]), [`renewal:sub_1:false:${A1}`, `renewal:sub_1:true:${A2}`, `renewal:sub_1:false:${A3}`])
  assert.equal(w.pro().cancelAtPeriodEnd, true)
  // a malformed attempt is refused before Stripe is called
  const bad = world()
  await assert.rejects(setRenewal(bad.deps, { userId: 'u1', pro: bad.pro(), renew: false, attemptId: 'not-a-uuid' }), { error: 'attempt' })
  assert.equal(bad.named('subscriptions.update').length, 0)
})

test('with a scheduleId, "Stop renewing" releases the schedule first, then sets cancel_at_period_end', async () => {
  const w = world({ sub: subOf({ items: { data: [item('year')] } }) })
  await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'month' })
  w.calls.length = 0
  await setRenewal(w.deps, { userId: 'u1', pro: w.pro(), renew: false })
  const order = w.calls.map(c => c[0]).filter(n => n === 'subscriptionSchedules.release' || n === 'subscriptions.update')
  assert.deepEqual(order, ['subscriptionSchedules.release', 'subscriptions.update'])
  assert.equal(w.pro().scheduleId, null)
  assert.equal(w.pro().cancelAtPeriodEnd, true)
})

// ---------- ownership ----------

test('the subscription comes from users.pro and must be on the stored customer', async () => {
  const w = world({ sub: subOf({ customer: 'cus_other' }) })
  await assert.rejects(setRenewal(w.deps, { userId: 'u1', pro: w.pro(), renew: false }), { error: 'not-yours' })
  await assert.rejects(switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'year' }), { error: 'not-yours' })
  assert.equal(w.named('subscriptions.update').length, 0)
  const none = world({ pro: { customerId: 'cus_1' } })
  await assert.rejects(setRenewal(none.deps, { userId: 'u1', pro: none.pro(), renew: false }), { error: 'pro-none' })
  // an argument naming another subscription is never read
  const other = world()
  other.subs.set('sub_9', subOf({ id: 'sub_9' }))
  await setRenewal(other.deps, { userId: 'u1', pro: other.pro(), renew: false, subscriptionId: 'sub_9' })
  assert.deepEqual(other.named('subscriptions.update').map(c => c[1]), ['sub_1'])
})

// ---------- card ----------

test('card session: setup mode in the sheet, our metadata, the person\'s customer, keyed per minute', () => {
  const p = cardSessionParams({ userId: 'u1', customerId: 'cus_1', baseUrl: 'https://app', ui: 'elements' })
  assert.deepEqual([p.ui_mode, p.mode, p.currency, p.customer], ['elements', 'setup', 'usd', 'cus_1'])
  assert.deepEqual(p.metadata, { userId: 'u1', purpose: 'pro-card' })
  assert.deepEqual(p.setup_intent_data, { metadata: { userId: 'u1', purpose: 'pro-card' } })
  assert.equal(p.return_url, 'https://app/profile?tab=credits&card={CHECKOUT_SESSION_ID}')
  assert.equal(p.success_url, undefined)
  assert.equal(p.payment_method_types, undefined)
  const hosted = cardSessionParams({ userId: 'u1', customerId: 'cus_1', baseUrl: 'https://app', ui: 'hosted' })
  assert.equal(hosted.ui_mode, undefined)
  assert.equal(hosted.success_url, 'https://app/profile?tab=credits&card={CHECKOUT_SESSION_ID}')
  assert.equal(cardSessionKey('u1', NOW), cardSessionKey('u1', NOW + 30_000))
  assert.match(cardSessionKey('u1', NOW), /^card:u1:\d+$/)
})

const setupSession = (over = {}) => ({ id: 'cs_card', mode: 'setup', status: 'complete', customer: 'cus_1', setup_intent: 'seti_1', metadata: { userId: 'u1', purpose: 'pro-card' }, ...over })

test('applyDefaultCard sets the customer\'s and the subscription\'s default card, and the schedule\'s when one is attached', async () => {
  const w = world({ sub: subOf({ items: { data: [item('year')] } }) })
  await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'month' })
  w.setupIntents.set('seti_1', { id: 'seti_1', status: 'succeeded', payment_method: 'pm_new' })
  const out = await applyDefaultCard(w.deps, { userId: 'u1', pro: w.pro(), session: setupSession() })
  assert.equal(out.status, 'updated')
  assert.equal(w.customers.get('cus_1').invoice_settings.default_payment_method, 'pm_new')
  assert.equal(w.subs.get('sub_1').default_payment_method, 'pm_new')
  assert.equal(w.schedules.get('sub_sched_1').default_settings.default_payment_method, 'pm_new')
  // running it twice has no effect
  const writes = () => w.calls.filter(c => /\.update$|\.pay$/.test(c[0])).length
  const before = writes()
  await applyDefaultCard(w.deps, { userId: 'u1', pro: w.pro(), session: setupSession() })
  assert.equal(writes(), before)
})

test('applyDefaultCard: past due pays the open invoice; 3DS on that charge gives needsAction and records actionNeeded', async () => {
  const w = world({ sub: subOf({ status: 'past_due', latest_invoice: 'in_due' }), pro: { subscriptionId: 'sub_1', customerId: 'cus_1', status: 'past_due' } })
  w.setupIntents.set('seti_1', { id: 'seti_1', status: 'succeeded', payment_method: 'pm_new' })
  w.invoices.set('in_due', { id: 'in_due', customer: 'cus_1', status: 'open', confirmation_secret: { client_secret: 'pi_due_secret' } })
  const paid = await applyDefaultCard(w.deps, { userId: 'u1', pro: w.pro(), session: setupSession() })
  assert.equal(paid.status, 'updated')
  assert.equal(paid.paidInvoice, true)
  const [[, id, params, key]] = w.named('invoices.pay')
  assert.deepEqual([id, params, key], ['in_due', { payment_method: 'pm_new', off_session: false }, 'card-pay:in_due:pm_new'])
  assert.equal(w.pro().status, 'active')

  const a = world({ sub: subOf({ status: 'past_due', latest_invoice: 'in_due' }), pro: { subscriptionId: 'sub_1', customerId: 'cus_1', status: 'past_due' } })
  a.setupIntents.set('seti_1', { id: 'seti_1', status: 'succeeded', payment_method: 'pm_new' })
  a.invoices.set('in_due', { id: 'in_due', customer: 'cus_1', status: 'open', confirmation_secret: { client_secret: 'pi_due_secret' } })
  a.outcome('requires_action')
  const out = await applyDefaultCard(a.deps, { userId: 'u1', pro: a.pro(), session: setupSession() })
  assert.equal(out.status, 'needs-action')
  assert.equal(out.needsAction, true)
  assert.equal(a.pro().actionNeeded.invoiceId, 'in_due')
  assert.equal(a.pro().actionNeeded.kind, 'card')
  assert.deepEqual(await actionSecret(a.deps, { userId: 'u1', pro: a.pro() }), { clientSecret: 'pi_due_secret' })

  const d = world({ sub: subOf({ status: 'past_due', latest_invoice: 'in_due' }), pro: { subscriptionId: 'sub_1', customerId: 'cus_1', status: 'past_due' } })
  d.setupIntents.set('seti_1', { id: 'seti_1', status: 'succeeded', payment_method: 'pm_new' })
  d.invoices.set('in_due', { id: 'in_due', customer: 'cus_1', status: 'open' })
  d.outcome('declined')
  const declined = await applyDefaultCard(d.deps, { userId: 'u1', pro: d.pro(), session: setupSession() })
  assert.equal(declined.status, 'declined')
  assert.equal(declined.message, 'Your card has insufficient funds.')
})

test('applyDefaultCard refuses another customer\'s session and waits for an unfinished one', async () => {
  const w = world()
  w.setupIntents.set('seti_1', { id: 'seti_1', status: 'succeeded', payment_method: 'pm_new' })
  await assert.rejects(applyDefaultCard(w.deps, { userId: 'u1', pro: w.pro(), session: setupSession({ customer: 'cus_other' }) }), { error: 'not-yours' })
  await assert.rejects(applyDefaultCard(w.deps, { userId: 'u1', pro: w.pro(), session: setupSession({ metadata: { userId: 'u2', purpose: 'pro-card' } }) }), { error: 'not-yours' })
  assert.deepEqual(await applyDefaultCard(w.deps, { userId: 'u1', pro: w.pro(), session: setupSession({ status: 'open' }) }), { status: 'pending' })
  assert.equal(w.customers.get('cus_1').invoice_settings.default_payment_method, 'pm_old')
})

test('actionSecret: nothing recorded is refused; an invoice already paid clears the record', async () => {
  const w = world()
  await assert.rejects(actionSecret(w.deps, { userId: 'u1', pro: w.pro() }), { error: 'no-action' })
  w.people.get('u1').pro.actionNeeded = { invoiceId: 'in_x', at: NOW }
  w.invoices.set('in_x', { id: 'in_x', customer: 'cus_1', status: 'paid' })
  assert.deepEqual(await actionSecret(w.deps, { userId: 'u1', pro: w.pro() }), { status: 'done' })
  assert.equal(w.pro().actionNeeded, null)
  w.people.get('u1').pro.actionNeeded = { invoiceId: 'in_y', at: NOW }
  w.invoices.set('in_y', { id: 'in_y', customer: 'cus_other', status: 'open', confirmation_secret: { client_secret: 's' } })
  await assert.rejects(actionSecret(w.deps, { userId: 'u1', pro: w.pro() }), { error: 'not-yours' })
})

test('the card shown in Manage: brand, last four and expiry only', () => {
  assert.deepEqual(cardOf({ id: 'pm_1', type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030, fingerprint: 'fp' }, customer: 'cus_1' }), { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 })
  assert.equal(cardOf(null), null)
  assert.equal(cardOf('pm_1'), null)
})

// ---------- receipts ----------

test('receipts expose no customer or ids beyond the number', () => {
  const rows = invoiceRows({ data: [{ id: 'in_9', number: 'SB-0009', created: sec(NOW), total: 543, status: 'paid', customer: 'cus_1', customer_email: 'a@example.test', hosted_invoice_url: 'https://invoice.example/9', invoice_pdf: 'https://invoice.example/9.pdf', subscription: 'sub_1', payment_intent: 'pi_9' }] })
  assert.deepEqual(rows, [{ number: 'SB-0009', created: sec(NOW) * 1000, totalCents: 543, status: 'paid', url: 'https://invoice.example/9', pdf: 'https://invoice.example/9.pdf' }])
  assert.doesNotMatch(JSON.stringify(rows), /cus_|sub_|pi_|in_9|@/)
  // drafts are not receipts
  assert.deepEqual(invoiceRows({ data: [{ number: null, status: 'draft', total: 1, created: 1 }] }), [])
})

// ---------- wiring ----------

const source = path => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')
const NEW_METHODS = ['pro.preview', 'pro.switchInterval', 'pro.renewal', 'pro.cardSession', 'pro.cardConfirm', 'pro.actionSecret', 'pro.invoices']

test('every new method is a named constant, defined in pro.js, and rate limited per person and per address', () => {
  const constants = source('imports/api/common/constants.js')
  const pro = source('server/methods/pro.js')
  for (const name of NEW_METHODS) {
    const short = name.split('.')[1]
    assert.match(constants, new RegExp(`${short}: '${name.replace('.', '\\.')}'`), name + ' in constants')
    assert.match(pro, new RegExp(`CONSTANTS\\.methods\\.pro\\.${short}\\]`), name + ' in pro.js')
    for (const per of ['user', 'address']) assert.ok(METER_RATE_LIMITS.some(r => r.method === name && r.per === per), `${name} per ${per}`)
  }
  // the sheet polls the confirm methods (every 1-2 s for 15 s): they allow that, and nothing more
  for (const name of ['pro.confirm', 'wallet.confirmTopUp', 'pro.cardConfirm']) {
    const rule = METER_RATE_LIMITS.find(r => r.method === name && r.per === 'user')
    assert.ok(rule && rule.count >= 15 && rule.count <= 30, name)
  }
  // changes to Pro itself: three a minute
  for (const name of ['pro.switchInterval', 'pro.renewal', 'wallet.refund']) {
    assert.equal(METER_RATE_LIMITS.find(r => r.method === name && r.per === 'user').count, 3, name)
  }
  // the sheet makes a session per amount or interval chosen (idempotent per attempt, nothing is
  // charged until the person pays): enough for a person trying the four amounts, not a flood
  for (const name of ['pro.checkout', 'wallet.createTopUp', 'pro.cardSession']) {
    const user = METER_RATE_LIMITS.find(r => r.method === name && r.per === 'user').count
    const address = METER_RATE_LIMITS.find(r => r.method === name && r.per === 'address').count
    assert.ok(user >= 8 && user <= 12, `${name} per person ${user}`)
    assert.ok(address >= user && address <= 30, `${name} per address ${address}`)
  }
})

test('pro.cardConfirm and pro.confirm answer an unknown session as invalid, not a server error', () => {
  const pro = source('server/methods/pro.js')
  assert.match(pro, /const readSession = /)
  assert.equal((pro.match(/await readSession\(/g) || []).length, 2, 'used by both confirms')
  assert.match(pro, /statusCode === 404[^\n]*Meteor\.Error\('invalid'/)
})

test('pro.js reads the subscription from users.pro, never from method arguments', () => {
  const pro = source('server/methods/pro.js')
  for (const short of ['preview', 'switchInterval', 'renewal', 'cardConfirm', 'actionSecret', 'invoices']) {
    const at = pro.indexOf(`CONSTANTS.methods.pro.${short}]`)
    const head = pro.slice(at, pro.indexOf('\n', at))
    assert.doesNotMatch(head, /subscriptionId|customerId|scheduleId|invoiceId/, short)
  }
})

test('meter.summary carries the sheet\'s fields and users.pro stays unpublished', () => {
  const meteor = source('server/metering/meteor.js')
  for (const field of ['proCard', 'proActionNeeded', 'proRenews', 'proPending', 'inApp', 'topUpCardFee', 'topUpAmounts']) {
    assert.match(meteor, new RegExp(`\\b${field}:`), field)
  }
  assert.match(meteor, /inApp: Meteor\.settings\.public\.stripe\?\.inApp === true/)
})

// ---------- lane D: the Manage pane's needs ----------

test('card session: keyed per attempt when the sheet sends one (a declined card can try again at once)', () => {
  const A = '0b6a3b9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
  const B = '1c7b4c0f-2d3e-4f60-9b0c-1d2e3f4a5b6c'
  assert.equal(cardSessionKey('u1', NOW, A), `card:u1:${A}`)
  assert.notEqual(cardSessionKey('u1', NOW, A), cardSessionKey('u1', NOW, B))
  assert.equal(cardSessionKey('u1', NOW, A), cardSessionKey('u1', NOW + 90_000, A))
  assert.throws(() => cardSessionKey('u1', NOW, 'nope'), { error: 'attempt' })
  // without one, the minute, as before
  assert.equal(cardSessionKey('u1', NOW, undefined), cardSessionKey('u1', NOW))
  const pro = source('server/methods/pro.js')
  assert.match(pro, /CONSTANTS\.methods\.pro\.cardSession\]\(\{ attemptId \} = \{\}\)/)
  assert.match(pro, /cardSessionKey\(user\._id, now, attemptId\)/)
})

test('actionSecret: once the bank has confirmed, the subscription is read again so Your Pro shows the switch', async () => {
  const w = world()
  w.outcome('requires_action')
  await switchInterval(w.deps, { userId: 'u1', pro: w.pro(), prices: PRICES, interval: 'year' })
  assert.notEqual(w.pro().interval, 'year')
  // the bank confirmed: the invoice is paid and Stripe applied the pending update
  w.invoices.get('in_switch').status = 'paid'
  w.subs.get('sub_1').pending_update = null
  w.subs.get('sub_1').items.data = [item('year')]
  assert.deepEqual(await actionSecret(w.deps, { userId: 'u1', pro: w.pro() }), { status: 'done' })
  assert.equal(w.pro().actionNeeded, null)
  assert.equal(w.pro().interval, 'year')
})

test('Your Pro\'s reads (preview, receipts, the bank secret) allow a sheet opened a few times a minute; changes stay at three', () => {
  for (const name of ['pro.preview', 'pro.invoices', 'pro.actionSecret']) {
    const user = METER_RATE_LIMITS.find(r => r.method === name && r.per === 'user').count
    const address = METER_RATE_LIMITS.find(r => r.method === name && r.per === 'address').count
    assert.ok(user >= 10 && user <= 30, `${name} per person ${user}`)
    assert.ok(address >= user && address <= 60, `${name} per address ${address}`)
  }
  for (const name of ['pro.switchInterval', 'pro.renewal']) {
    assert.equal(METER_RATE_LIMITS.find(r => r.method === name && r.per === 'user').count, 3, name)
  }
})

test('Stripe\'s idempotency error is a refusal the sheet shows, never a server error', async () => {
  const { idempotencyRefusal } = await import('../web/app/server/pay-attempt.mjs')
  for (const error of [
    Object.assign(new Error('Keys for idempotent requests can only be used with the same parameters they were first used with.'), { type: 'StripeIdempotencyError', rawType: 'idempotency_error', statusCode: 400 }),
    { rawType: 'idempotency_error' },
    { raw: { type: 'idempotency_error' } },
  ]) {
    const refusal = idempotencyRefusal(error)
    assert.equal(refusal.error, 'attempt')
    assert.match(refusal.reason, /Nothing was charged/)
  }
  assert.equal(idempotencyRefusal({ type: 'StripeCardError' }), null)
  assert.equal(idempotencyRefusal(null), null)
  // every pay method's error mapping goes through it (pro.js managed() and wallet.createTopUp use asMethodError)
  const wallet = readFileSync(new URL('../web/app/server/methods/wallet.js', import.meta.url), 'utf8')
  assert.match(wallet, /export function asMethodError\(error\) \{\n\s+const keyed = idempotencyRefusal\(error\)/)
  const pro = readFileSync(new URL('../web/app/server/methods/pro.js', import.meta.url), 'utf8')
  assert.match(pro, /managed\(\(\) => stripeClient\(\)\.checkout\.sessions\.create\(params/, 'the card session too')
})

test('the sheet sends a new attempt on every Manage switch, and a confirm that expired gets a new attempt', () => {
  const pro = readFileSync(new URL('../web/app/server/methods/pro.js', import.meta.url), 'utf8')
  assert.match(pro, /switchInterval\]\(\{ interval, attemptId \} = \{\}\)/)
  assert.match(pro, /switchInterval\(deps, \{[^}]*interval, attemptId \}\)/)
  const pane = readFileSync(new URL('../web/app/imports/ui/components/billing/pay/ManagePane.jsx', import.meta.url), 'utf8')
  assert.match(pane, /pro\.switchInterval, \{ interval: [^}]*attemptId: newAttempt\(\) \}/)
  const sheet = readFileSync(new URL('../web/app/imports/ui/components/billing/pay/PaySheet.jsx', import.meta.url), 'utf8')
  assert.match(sheet, /dispatch\(\{ type: 'confirmed', result, [^}]*nextAttemptId: newAttempt\(\) \}\)/)
  // renewal too: a new attempt per tap, passed through to setRenewal
  assert.match(pane, /pro\.renewal, \{ renew: [^}]*attemptId: newAttempt\(\) \}/)
  assert.match(pro, /renewal\]\(\{ renew, attemptId \} = \{\}\)/)
  assert.match(pro, /setRenewal\(billingDeps\(\), \{[^}]*renew, attemptId \}\)/)
})
