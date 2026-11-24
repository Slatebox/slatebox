// Holds: before an AI request is sent, the most it may spend is set aside, on the person's
// day and month counters and the global month (free route) or on the wallet (balance route),
// each with one conditional update. Requests running at the same time therefore cannot pass a
// cap that each of them checked alone. Spending moves money from the hold to the real
// counters; whatever is left is released when the request ends.
//
// io: { get(store, key) → doc | null, incIf(store, key, inc, guards, now) → boolean,
//       add(store, key, fields, now) }. Stores: 'counters' (MeterTotals, created on first use)
// and 'wallets' (Wallets, never created here).
import { dayKey, monthKey } from './policy.mjs'
import { debit } from './ledger.mjs'

// A guard is { sum: { field: weight }, max } (the weighted sum, missing fields as 0, is at most
// max), { absent: field } or { notTrue: field }.
export function guardsPass(doc = {}, guards = []) {
  return guards.every(guard => {
    if (guard.absent) return doc[guard.absent] === undefined || doc[guard.absent] === null
    if (guard.notTrue) return doc[guard.notTrue] !== true
    return Object.entries(guard.sum).reduce((total, [field, weight]) => total + weight * (doc[field] || 0), 0) <= guard.max
  })
}

// The same guards as a Mongo filter, for updateOne.
export function guardFilter(guards = []) {
  const and = guards.map(guard => {
    if (guard.absent) return { [guard.absent]: null }
    if (guard.notTrue) return { [guard.notTrue]: { $ne: true } }
    const terms = Object.entries(guard.sum).map(([field, weight]) => ({ $multiply: [{ $ifNull: ['$' + field, 0] }, weight] }))
    return { $expr: { $lte: [{ $add: terms }, guard.max] } }
  })
  return and.length ? { $and: and } : {}
}

const refuse = code => ({ ok: false, code })
const negate = fields => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, -v]))

async function applyAll(io, steps, now) {
  const done = []
  for (const [store, key, inc, guards] of steps) {
    if (!await io.incIf(store, key, inc, guards, now)) {
      for (const [s, k, i] of done.reverse()) await io.add(s, k, negate(i), now)
      return false
    }
    done.push([store, key, inc])
  }
  return true
}

/**
 * The free route. Sets aside min(ceiling, what is left today, this month and in the global
 * month up to the AI pause) and, for a draft, one of today's drafts. With `address`
 * ({ id, perDay, code }: the guest route), the draft is also one of the network address's
 * drafts today, so many accounts on one machine share them. With `enforceGlobal: false` (Pro
 * credits: paying people are not paused by the shared budget), the global month neither caps the
 * hold nor counts it in the shared budget: it is set aside as heldProMicros, apart from the
 * heldMicros the budget's cap reads, and spent as proMicros (record.mjs).
 * → { ok: true, route: 'free', holdMicros, leftMicros, draft, keys, pro? } | { ok: false, code }
 */
export async function holdFree(io, { payerId, kind, countsAsDraft, draftsPerDay, draftsCode = 'ai-today', address = null, estimateMicros, ceilingMicros, settings, now, enforceGlobal = true, monthCounter = null }) {
  const { free, budget } = settings
  // monthCounter: a Business team's month counter (pool.mjs poolMonthKey), drawn on by all its members
  const keys = { day: `user:${payerId}:${dayKey(now)}`, month: monthCounter || `user:${payerId}:${monthKey(now)}`, global: `global:${monthKey(now)}` }
  const draft = kind === 'ai' && countsAsDraft !== false ? 1 : 0
  if (draft && address?.id) keys.address = `address:${address.id}:${dayKey(now)}`
  const globalCap = Math.floor(budget.monthlyMicros * budget.pauseAiAt / 100)
  for (let attempt = 0; attempt < 5; attempt++) {
    const [day, month, global, place] = (await Promise.all([io.get('counters', keys.day), io.get('counters', keys.month), io.get('counters', keys.global),
      keys.address ? io.get('counters', keys.address) : null])).map(d => d || {})
    if (draft && (day.aiActions || 0) >= draftsPerDay) return refuse(draftsCode)
    if (keys.address && (place.aiActions || 0) >= address.perDay) return refuse(draftsCode)
    const dayLeft = free.perPersonMicrosPerDay - (day.freeMicros || 0) - (day.heldMicros || 0)
    const monthLeft = free.aiMicrosPerMonth - (month.aiMicros || 0) - (month.heldAiMicros || 0)
    const globalLeft = enforceGlobal ? globalCap - (global.freeMicros || 0) - (global.heldMicros || 0) : Infinity
    const need = Math.max(1, estimateMicros)
    if (globalLeft < need) return refuse('ai-paused')
    if (monthLeft < need) return refuse('ai-month')
    if (dayLeft < need) return refuse('ai-today')
    const hold = Math.min(ceilingMicros, dayLeft, monthLeft, globalLeft)
    const ok = await applyAll(io, [
      ['counters', keys.day, { heldMicros: hold, ...(draft && { aiActions: 1 }) }, [
        { sum: { freeMicros: 1, heldMicros: 1 }, max: free.perPersonMicrosPerDay - hold },
        ...(draft ? [{ sum: { aiActions: 1 }, max: draftsPerDay - 1 }] : []),
      ]],
      ...(keys.address ? [['counters', keys.address, { aiActions: 1 }, [{ sum: { aiActions: 1 }, max: address.perDay - 1 }]]] : []),
      ['counters', keys.month, { heldAiMicros: hold }, [{ sum: { aiMicros: 1, heldAiMicros: 1 }, max: free.aiMicrosPerMonth - hold }]],
      enforceGlobal
        ? ['counters', keys.global, { heldMicros: hold }, [{ sum: { freeMicros: 1, heldMicros: 1 }, max: globalCap - hold }]]
        : ['counters', keys.global, { heldProMicros: hold }, []],
    ], now)
    if (ok) return { ok: true, route: 'free', holdMicros: hold, leftMicros: hold, draft, keys, ...(!enforceGlobal && { pro: true }) }
  }
  return refuse('ai-today')
}

export const withMargin = (micros, marginPercent) => Math.ceil(micros * (100 + marginPercent) / 100)

/**
 * The balance route: sets aside min(ceiling + margin, what the wallet has free). A frozen
 * wallet or one being refunded holds nothing.
 * → { ok: true, route: 'balance', walletId, holdChargeMicros, leftChargeMicros, ceilingMicros } | { ok: false, code }
 */
export async function holdWallet(io, { walletId, estimateMicros, ceilingMicros, marginPercent, now }) {
  const need = withMargin(Math.max(1, estimateMicros), marginPercent)
  for (let attempt = 0; attempt < 5; attempt++) {
    const wallet = await io.get('wallets', walletId)
    if (!wallet) return refuse('balance')
    if (wallet.frozen) return refuse('frozen')
    if (wallet.refunding) return refuse('balance')
    const available = (wallet.balanceMicros || 0) - (wallet.heldMicros || 0)
    if (available < need) return refuse('balance')
    const hold = Math.min(withMargin(ceilingMicros, marginPercent), available)
    const ok = await io.incIf('wallets', walletId, { heldMicros: hold }, [
      { absent: 'refunding' }, { notTrue: 'frozen' }, { sum: { heldMicros: 1, balanceMicros: -1 }, max: -hold },
    ], now)
    if (ok) {
      return { ok: true, route: 'balance', walletId, holdChargeMicros: hold, leftChargeMicros: hold, ceilingMicros: Math.floor(hold * 100 / (100 + marginPercent)) }
    }
  }
  return refuse('balance')
}

// How much of a spend comes out of the hold. Mutates the hold's remaining amount.
export function takeFromHold(hold, { costMicros, chargeMicros }) {
  if (!hold) return 0
  if (hold.route === 'free') {
    const take = Math.min(costMicros, hold.leftMicros)
    hold.leftMicros -= take
    return take
  }
  const take = Math.min(chargeMicros, hold.leftChargeMicros)
  hold.leftChargeMicros -= take
  return take
}

// Gives back what a finished request did not spend, and its draft when it failed.
export async function releaseHold(io, hold, { ok }, now) {
  if (!hold || hold.released) return
  hold.released = true
  if (hold.route === 'free') {
    const left = hold.leftMicros
    hold.leftMicros = 0
    const dayFields = { ...(left && { heldMicros: -left }), ...(!ok && hold.draft && { aiActions: -1 }) }
    if (Object.keys(dayFields).length) await io.add('counters', hold.keys.day, dayFields, now)
    if (!ok && hold.draft && hold.keys.address) await io.add('counters', hold.keys.address, { aiActions: -1 }, now)
    if (left) {
      await io.add('counters', hold.keys.month, { heldAiMicros: -left }, now)
      await io.add('counters', hold.keys.global, { [hold.pro ? 'heldProMicros' : 'heldMicros']: -left }, now)
    }
    return
  }
  const left = hold.leftChargeMicros
  hold.leftChargeMicros = 0
  if (left) await io.add('wallets', hold.walletId, { heldMicros: -left }, now)
}

// A wallet debit that also releases part of a hold. Never below zero.
export function debitWithRelease(wallet, chargeMicros, releaseMicros = 0) {
  const out = debit(wallet, chargeMicros)
  return { ...out, wallet: { ...out.wallet, heldMicros: Math.max(0, (wallet.heldMicros || 0) - releaseMicros) } }
}
