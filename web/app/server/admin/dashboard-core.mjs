// Admin › Overview: the numbers a server administrator reads at a glance. Pure: the Meteor glue
// (server/admin/meteor.js) hands in the Stripe client, the database reads and the admin check, and
// the tests hand in fakes.
//
// - Administrators only (the uberMensch claim alone, server-admin.mjs). Anyone else is refused.
// - Stripe is read only: list calls, nothing created, changed or refunded. Without payments on this
//   server (Slatebox Cloud's license and a Stripe key, cloud-lock.mjs) no Stripe call is made and
//   the page says "Payments are off on this server".
// - Each card stands alone: a Stripe or database failure shows on its own card, never blanks the page.
// - People are shown by masked email (t…@domain), never by full address.
// - The answer is kept DASHBOARD_TTL_MS (a minute); Refresh asks again at most every REFRESH_GAP_MS.

export const DASHBOARD_TTL_MS = 60_000
export const REFRESH_GAP_MS = 10_000
export const RECENT_DAYS = 30
export const LIST_CAP = 2000
export const PAYMENTS_OFF_WORDS = 'Payments are off on this server'

const DAY = 86_400_000
const SUB_STATUSES = ['active', 'trialing', 'past_due', 'canceled']
// what counts towards monthly recurring revenue: paying now (past due still owes it), not a trial
const MRR_STATUSES = new Set(['active', 'past_due'])
// what holds members (a Business subscription's quantity, one for Pro): a subscription that has not ended
const MEMBER_STATUSES = new Set(['active', 'trialing', 'past_due'])
export const PLAN_IDS = ['pro_monthly', 'pro_yearly', 'business_monthly', 'business_yearly', 'other']
export const PLAN_LABELS = Object.freeze({
  pro_monthly: 'Pro monthly', pro_yearly: 'Pro yearly', business_monthly: 'Business monthly', business_yearly: 'Business yearly', other: 'Other prices',
})

/** "tim@slatebox.com" → "t…@slatebox.com". Anything that is not an address → null. */
export function maskEmail(email) {
  if (typeof email !== 'string') return null
  const at = email.trim().lastIndexOf('@')
  if (at < 1 || at === email.trim().length - 1) return null
  const value = email.trim()
  return `${value[0]}…${value.slice(at)}`
}

/** A Stripe Dashboard address for a section, in the key's mode ('live' | 'test'). */
export function stripeDashboardUrl(mode, path = '') {
  const clean = String(path).replace(/^\/+/, '')
  return `https://dashboard.stripe.com/${mode === 'test' ? 'test/' : ''}${clean}`
}

// An error as one plain line, with anything key-shaped taken out (Stripe's auth errors name the
// key's last characters).
export function plainError(error) {
  const message = typeof error?.message === 'string' && error.message ? error.message : 'Could not read this.'
  return message.replace(/\b(?:sk|rk|pk|whsec)_[A-Za-z0-9_*]+/g, '[key]').slice(0, 300)
}

/** One card: { ok: true, ...data } or { ok: false, error }. */
export async function card(read) {
  try {
    return { ok: true, ...(await read()) }
  } catch (error) {
    return { ok: false, error: plainError(error) }
  }
}

/**
 * Every row of a Stripe list call, newest first, up to `cap`. list(params) → { data, has_more }.
 * → { items, capped }
 */
export async function listAll(list, params = {}, cap = LIST_CAP) {
  const items = []
  let startingAfter
  for (;;) {
    const page = await list({ limit: 100, ...params, ...(startingAfter && { starting_after: startingAfter }) })
    const data = Array.isArray(page?.data) ? page.data : []
    items.push(...data)
    if (items.length >= cap) return { items: items.slice(0, cap), capped: Boolean(page?.has_more) || items.length > cap }
    if (!page?.has_more || !data.length) return { items, capped: false }
    startingAfter = data[data.length - 1].id
  }
}

/**
 * Which plan a subscription item's price is. plans: { pro: { month, year } (lookup keys),
 * business: { month, year } (price ids) }.
 */
export function classifyPrice(price, plans = {}) {
  if (!price) return 'other'
  const interval = price.recurring?.interval
  const pro = plans.pro || {}
  const business = plans.business || {}
  if (price.lookup_key && price.lookup_key === pro.month) return 'pro_monthly'
  if (price.lookup_key && price.lookup_key === pro.year) return 'pro_yearly'
  const product = typeof price.product === 'string' ? price.product : price.product?.id
  if (product === 'slatebox_pro' && interval === 'month') return 'pro_monthly'
  if (product === 'slatebox_pro' && interval === 'year') return 'pro_yearly'
  if (price.id && price.id === business.month) return 'business_monthly'
  if (price.id && price.id === business.year) return 'business_yearly'
  return 'other'
}

/** What one subscription item brings in a month, in the price's smallest unit (cents). */
export function monthlyAmount(price, quantity = 1) {
  const unit = Number.isFinite(price?.unit_amount) ? price.unit_amount : Number(price?.unit_amount_decimal)
  if (!Number.isFinite(unit)) return 0
  const count = price?.recurring?.interval_count || 1
  const perInterval = unit * (Number.isFinite(quantity) ? quantity : 1)
  const months = { day: 12 / 365, week: 12 / 52, month: 1, year: 12 }[price?.recurring?.interval]
  if (!months) return 0
  return perInterval / (months * count)
}

const addTo = (totals, currency, amount) => {
  const key = (currency || 'usd').toLowerCase()
  totals[key] = (totals[key] || 0) + amount
  return totals
}
const roundAll = (totals) => Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v)]))

/** Subscriptions split by plan and status, with members and MRR/ARR. */
export function summarizeSubscriptions(subscriptions, plans) {
  const byPlan = Object.fromEntries(PLAN_IDS.map((id) => [id, { active: 0, trialing: 0, past_due: 0, canceled: 0, other: 0, members: 0 }]))
  const totals = { active: 0, trialing: 0, past_due: 0, canceled: 0, other: 0 }
  const mrr = {}
  for (const sub of subscriptions) {
    const status = SUB_STATUSES.includes(sub?.status) ? sub.status : 'other'
    totals[status] += 1
    const items = sub?.items?.data || []
    const plan = items.length ? classifyPrice(items[0].price, plans) : 'other'
    byPlan[plan][status] += 1
    for (const item of items) {
      const quantity = Number.isInteger(item.quantity) ? item.quantity : 1
      const itemPlan = classifyPrice(item.price, plans)
      if (MEMBER_STATUSES.has(sub.status)) byPlan[itemPlan].members += itemPlan.startsWith('business') ? quantity : 1
      if (MRR_STATUSES.has(sub.status)) addTo(mrr, item.price?.currency || sub.currency, monthlyAmount(item.price, quantity))
    }
  }
  const monthly = roundAll(mrr)
  return { byPlan, totals, mrr: monthly, arr: Object.fromEntries(Object.entries(monthly).map(([k, v]) => [k, v * 12])) }
}

const sumBy = (rows, amountOf) => rows.reduce((totals, row) => addTo(totals, row.currency, amountOf(row) || 0), {})

/**
 * Stripe's cards. stripe: a Stripe client (only its list calls are used). mode: 'live' | 'test'.
 */
export async function stripeSummary({ stripe, plans, mode, now = Date.now(), cap = LIST_CAP }) {
  const since = Math.floor((now - RECENT_DAYS * DAY) / 1000)
  const link = (path) => stripeDashboardUrl(mode, path)
  const subscriptionsRead = listAll((p) => stripe.subscriptions.list(p), { status: 'all' }, cap)
  // read once, used by two cards; a failure shows on both
  subscriptionsRead.catch(() => {})
  const [customers, subscriptions, revenue, invoices, refunds, failed, topUps] = await Promise.all([
    card(async () => {
      const { items, capped } = await listAll((p) => stripe.customers.list(p), {}, cap)
      const recent = items.filter((c) => (c.created || 0) >= since).length
      const newest = [...items].sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 10)
        .map((c) => ({ email: maskEmail(c.email), created: c.created ? new Date(c.created * 1000).toISOString() : null }))
      return { count: items.length, capped, recent, newest, url: link('customers') }
    }),
    card(async () => {
      const { items, capped } = await subscriptionsRead
      const { byPlan, totals } = summarizeSubscriptions(items, plans)
      return { byPlan, totals, capped, url: link('subscriptions') }
    }),
    card(async () => {
      const { items, capped } = await subscriptionsRead
      const { mrr, arr } = summarizeSubscriptions(items, plans)
      return { mrr, arr, capped, url: link('subscriptions') }
    }),
    card(async () => {
      const { items, capped } = await listAll((p) => stripe.invoices.list(p), { status: 'paid', created: { gte: since } }, cap)
      return { count: items.length, total: sumBy(items, (i) => i.amount_paid), capped, url: link('invoices?status=paid') }
    }),
    card(async () => {
      const { items, capped } = await listAll((p) => stripe.refunds.list(p), { created: { gte: since } }, cap)
      const done = items.filter((r) => !['failed', 'canceled'].includes(r.status))
      return { count: done.length, total: sumBy(done, (r) => r.amount), capped, url: link('payments?status[0]=refunded') }
    }),
    card(async () => {
      const { items, capped } = await listAll((p) => stripe.charges.list(p), { created: { gte: since } }, cap)
      const bad = items.filter((c) => c.status === 'failed')
      return { count: bad.length, total: sumBy(bad, (c) => c.amount), capped, url: link('payments?status[0]=failed') }
    }),
    // top-ups (credit purchases): one-time Checkout payments (methods/wallet.js startTopUp)
    card(async () => {
      const { items, capped } = await listAll((p) => stripe.checkout.sessions.list(p), { created: { gte: since }, status: 'complete' }, cap)
      const paid = items.filter((s) => s.mode === 'payment' && (!s.payment_status || s.payment_status === 'paid'))
      return { count: paid.length, total: sumBy(paid, (s) => s.amount_total), capped, url: link('payments') }
    }),
  ])
  return { on: true, mode, days: RECENT_DAYS, customers, subscriptions, revenue, invoices, refunds, failed, topUps }
}

/**
 * The database's cards. io: { people(now), plans(), usage(month), grants(month, now), library(),
 * emailsOf(ids) }; each async. proAllowanceMicros: what one person's Pro includes a month.
 */
export async function localSummary({ io, now = Date.now(), month, meterOn = false, proAllowanceMicros = 0 }) {
  const [people, plans, usage, library] = await Promise.all([
    card(() => io.people(now)),
    card(() => io.plans()),
    card(async () => {
      if (!meterOn) return { meterOn: false }
      const [spend, grants] = await Promise.all([io.usage(month), io.grants(month, now)])
      const proPeople = grants.proPeople || 0
      const ids = (spend.topSpenders || []).filter((s) => s.payerType === 'user').map((s) => s.payerId)
      const emails = ids.length ? await io.emailsOf(ids) : {}
      return {
        meterOn: true,
        month,
        granted: { proAllowanceMicros: proPeople * proAllowanceMicros, proPeople, topUpMicros: grants.topUpMicros || 0 },
        spent: spend.spent || { includedMicros: 0, balanceMicros: 0, costMicros: 0 },
        byModel: spend.byModel || [],
        byFeature: spend.byFeature || [],
        calls: spend.calls || { voiceMinutes: 0, videoMinutes: 0 },
        topSpenders: (spend.topSpenders || []).map((s) => ({
          who: s.payerType === 'user' ? (maskEmail(emails[s.payerId]) || 'An account') : 'A team',
          costMicros: s.costMicros, chargeMicros: s.chargeMicros ?? 0,
        })),
      }
    }),
    card(() => io.library()),
  ])
  return { people, plans, usage, library }
}

/**
 * The admin.status and admin.dashboard methods' logic.
 * isAdmin(userId) → boolean (the uberMensch row). payments() → { on, mode } (mode 'live' | 'test' | null).
 * stripe() → the Stripe client (called only when payments are on). plans() → see classifyPrice.
 */
export function createAdminDashboard({ isAdmin, payments, stripe, plans, io, meterOn = () => false, proAllowanceMicros = 0, now = Date.now, ttlMs = DASHBOARD_TTL_MS, refreshGapMs = REFRESH_GAP_MS }) {
  let cached = null
  let pending = null

  async function status(userId) {
    return { admin: Boolean(userId) && (await isAdmin(userId)) === true }
  }

  async function build() {
    const at = now()
    const month = new Date(at).toISOString().slice(0, 7)
    const pay = payments() || {}
    const stripeCards = pay.on
      ? card(async () => stripeSummary({ stripe: stripe(), plans: plans(), mode: pay.mode === 'test' ? 'test' : 'live', now: at }))
      : Promise.resolve({ ok: true, on: false, words: PAYMENTS_OFF_WORDS })
    const [payment, local] = await Promise.all([
      stripeCards,
      localSummary({ io, now: at, month, meterOn: meterOn(), proAllowanceMicros }),
    ])
    return { generatedAt: new Date(at).toISOString(), payments: payment, ...local }
  }

  async function dashboard(userId, { refresh = false } = {}) {
    if (!userId || (await isAdmin(userId)) !== true) {
      const error = new Error('Only an administrator of this server can see the overview.')
      error.code = 'denied'
      throw error
    }
    const at = now()
    const fresh = cached && at - cached.at < (refresh ? refreshGapMs : ttlMs)
    if (fresh) return cached.value
    if (!pending) {
      pending = build().then((value) => {
        cached = { at: now(), value }
        return value
      }).finally(() => { pending = null })
    }
    return pending
  }

  return { status, dashboard }
}
