// An in-memory stand-in for the meter's Mongo glue: counters, events and wallets, with one
// awaited tick before every read and write so parallel requests interleave the way they do
// against a real database. The conditional update (incIf) checks and writes in one step,
// as Mongo's updateOne does. The meter itself is the real one (meter-core.mjs).
import { installMeter } from '../../web/app/server/metering/context.mjs'
import { DEFAULT_METERING, route, dayKey, monthKey } from '../../web/app/server/metering/policy.mjs'
import { emptyWallet } from '../../web/app/server/metering/ledger.mjs'
import { allowanceUsage } from '../../web/app/server/metering/allowance.mjs'

export const NOW = Date.UTC(2026, 10, 19, 12)
const tick = () => new Promise(resolve => setImmediate(resolve))

// clock: the moment the meter reads (the personalization allowance's UTC day); NOW unless a test moves it.
export async function meterWorld({ keys = {}, wallet = null, globalMonth = 0, person = {}, address = null, settings = structuredClone(DEFAULT_METERING), clock = () => NOW } = {}) {
  const { createMeter } = await import('../../web/app/server/metering/meter-core.mjs')
  const { guardsPass, debitWithRelease } = await import('../../web/app/server/metering/holds.mjs')
  const stores = { counters: new Map(), wallets: new Map() }
  const events = new Map()
  if (wallet) stores.wallets.set('user:u1', { ...emptyWallet(), ...wallet })
  stores.counters.set(`global:${monthKey(NOW)}`, { freeMicros: globalMonth })
  const add = (store, key, fields) => {
    const row = { ...(stores[store].get(key) || {}) }
    for (const [k, v] of Object.entries(fields)) row[k] = (row[k] || 0) + v
    stores[store].set(key, row)
  }
  let slateboxPaid = 0
  const io = {
    async get(store, key) { await tick(); const row = stores[store].get(key); return row ? { ...row } : null },
    async incIf(store, key, inc, guards) {
      await tick()
      const row = stores[store].get(key)
      if (!row && store === 'wallets') return false
      if (!guardsPass(row || {}, guards)) return false
      add(store, key, inc)
      return true
    },
    async add(store, key, fields) { await tick(); add(store, key, fields) },
    // record.mjs
    async insertEvent(event) { await tick(); if (events.has(event.ref)) return false; events.set(event.ref, event); return true },
    async inc(key, fields) { await tick(); add('counters', key, fields) },
    async debitWallet(walletId, chargeMicros, event, releaseChargeMicros = 0) {
      await tick()
      const w = stores.wallets.get(walletId) || { ...emptyWallet() }
      const out = debitWithRelease(w, chargeMicros, releaseChargeMicros)
      stores.wallets.set(walletId, out.wallet)
      return out
    },
  }
  const counter = key => stores.counters.get(key) || {}
  const usage = () => {
    const m = counter(`user:u1:${monthKey(clock())}`), d = counter(`user:u1:${dayKey(clock())}`)
    return {
      aiActionsToday: d.aiActions || 0, freeMicrosToday: (d.freeMicros || 0) + (d.heldMicros || 0),
      aiMicrosMonth: (m.aiMicros || 0) + (m.heldAiMicros || 0), voiceMinutesMonth: m.voiceMinutes || 0, videoMinutesMonth: m.videoMinutes || 0,
      // as meteor.js usageFor reads it
      allowanceToday: allowanceUsage(d),
    }
  }
  const spent = () => {
    const m = counter(`user:u1:${monthKey(NOW)}`), d = counter(`user:u1:${dayKey(NOW)}`)
    return { drafts: d.aiActions || 0, todayMicros: d.freeMicros || 0, monthMicros: m.aiMicros || 0, heldDay: d.heldMicros || 0, heldMonth: m.heldAiMicros || 0 }
  }
  // monthFreeMicros and todayFreeMicros are what meteor.js globalTotals gives the shared budget; the
  // rest is for tests (Pro credits and held amounts on the global keys)
  const global = () => {
    const m = counter(`global:${monthKey(NOW)}`), d = counter(`global:${dayKey(NOW)}`)
    return {
      monthFreeMicros: m.freeMicros || 0, todayFreeMicros: d.freeMicros || 0,
      monthProMicros: m.proMicros || 0, todayProMicros: d.proMicros || 0, heldMicros: m.heldMicros || 0, heldProMicros: m.heldProMicros || 0,
    }
  }
  let ids = 0
  const meter = createMeter({
    enabled: () => true,
    io,
    settings: async () => settings,
    now: () => clock(),
    newId: () => 'a' + ids++,
    async decide(opts) {
      await tick()
      const w = stores.wallets.get('user:u1')
      const decision = route({
        kind: opts.kind, person: { id: 'u1', anonymous: false, emailVerified: true, ...person }, keys: { personal: keys },
        usage: usage(), wallets: { personal: w ? { ...w, recentTopUpMicros: 0 } : null }, global: (({ monthFreeMicros, todayFreeMicros }) => ({ monthFreeMicros, todayFreeMicros }))(global()),
        estimateMicros: opts.estimateMicros, countsAsDraft: opts.countsAsDraft, feature: opts.feature, settings, now: clock(),
        allowanceTaken: opts.allowanceTaken ?? null,
      })
      return { decision, userId: 'u1', address }
    },
    async credentials() { return { provider: 'deepinfra', apiKey: 'person-key' } },
    onSpend({ costMicros, route: r, kind }) {
      // what the provider bills Slatebox, whatever the meter says
      if (r !== 'byok' || kind === 'imageSearch' || kind === 'imageGeneration') slateboxPaid += costMicros
    },
  })
  installMeter(meter)
  return { meter, stores, events, usage, spent, global, settings, wallet: () => stores.wallets.get('user:u1'), paid: () => slateboxPaid }
}
