// The AI meter that context.mjs runs: decide who pays, set the request's hold, record each
// provider call or fixed-price use, and release the hold when the request ends. Pure apart
// from the injected io and lookups; meteor.js supplies Mongo, tests an in-memory store.
import { aiActionsPerDay, creditsForShare, dayKey, messageFor, monthKey } from './policy.mjs'
import { ESTIMATES, actionCeilingMicros, actionEstimateMicros, aiCostMicros } from './prices.mjs'
import { recordUsage } from './record.mjs'
import { holdFree, holdWallet, releaseHold } from './holds.mjs'
import { addressBucket, isProxyAddress } from './client-address.mjs'
import { creditsForPool, poolMonthKey } from './pool.mjs'
import { holdAllowance } from './allowance.mjs'

const defaultError = (code, message) => Object.assign(new Error(message), { error: code, reason: message })

/**
 * deps: { enabled(), io (holds.mjs io + record.mjs io), settings() → metering settings,
 *         decide({ userId?, kind, feature, estimateMicros, countsAsDraft, allowanceTaken? }) → { decision, userId, address? }
 *           (address: the caller's network address, counted on the guest route; allowanceTaken: the
 *           allowance's hold was refused, so the meter decides without it: policy.mjs route),
 *         credentials(keyOwner, feature, userId), onSpend?({ costMicros, route, kind, now }),
 *         makeError?(code, message, { userId, wallet? }) → error, or a promise of one,
 *         now?(), newId() }
 */
export function createMeter({ enabled, io, settings: loadSettings, decide, credentials, onSpend = () => {}, makeError = defaultError, now = Date.now, newId }) {
  const meter = {
    enabled,
    async begin(opts) {
      const settings = await loadSettings()
      const kind = opts.kind || 'ai'
      const estimateMicros = opts.estimateMicros ?? actionEstimateMicros(opts.feature) ?? ESTIMATES.workshop
      const { decision, userId, address = null } = await decide({ ...opts, kind, estimateMicros })
      // makeError may be async: meteor.js adds the pay sheet's action for who was refused (refusal-pay.mjs)
      if (!decision.ok) throw await makeError(decision.code, decision.message, { userId })
      const action = {
        actionId: newId(), userId, feature: opts.feature, kind, route: decision.route, payer: decision.payer, keyOwner: decision.keyOwner,
        credentials: null, spentMicros: 0, estimateMicros, ceilingMicros: actionCeilingMicros(opts.feature),
        countsAsDraft: opts.countsAsDraft !== false, hold: null, finished: false,
      }
      const at = now()
      if (decision.route === 'byok') {
        action.credentials = await credentials(decision.keyOwner, opts.feature, userId)
      } else if (decision.route === 'allowance') {
        // The personalization allowance (allowance.mjs): one of today's uses, taken atomically, and the
        // request's most possible spend set aside on the shared budget. Lost to a request running at the
        // same moment (or the budget's ceiling): the meter decides again, without the allowance.
        // The caller's network address shares out the allowance too (allowance.mjs PEOPLE_PER_ADDRESS),
        // so throwaway accounts made from one place get no more; an address that stands for many
        // callers (a Cloudflare edge, the cluster's own) is not counted.
        const { budget } = settings
        const place = address && !isProxyAddress(address) ? addressBucket(address) : null
        const hold = await holdAllowance(io, {
          feature: decision.allowance.feature, perDay: decision.allowance.perDay,
          keys: { day: `user:${decision.payer.id}:${dayKey(at)}`, global: `global:${monthKey(at)}`, ...(place && { address: `address:${place}:${dayKey(at)}` }) },
          ceilingMicros: action.ceilingMicros, estimateMicros, globalCap: Math.floor(budget.monthlyMicros * budget.pauseAiAt / 100), now: at,
        })
        if (!hold.ok) return meter.begin({ ...opts, allowanceTaken: hold.code })
        action.hold = hold
        action.ceilingMicros = Math.min(action.ceilingMicros, hold.holdMicros)
      } else if (decision.route === 'free') {
        // The guest route (policy.mjs) has its own daily count, per person and per address.
        const hold = await holdFree(io, {
          payerId: decision.payer.id, kind, countsAsDraft: opts.countsAsDraft,
          draftsPerDay: decision.draftsPerDay ?? aiActionsPerDay(settings, decision.level ?? 0),
          ...(decision.guest && { draftsCode: 'presentations-today', address: addressBucket(address) && { id: addressBucket(address), perDay: decision.perAddressPerDay } }),
          // the month's AI is the person's share of it in the month Pro starts or ends (policy.mjs route)
          estimateMicros, ceilingMicros: action.ceilingMicros, now: at,
          // a Business member draws on the team's pool: its month counter and all its members' amounts (pool.mjs)
          settings: decision.pool ? creditsForPool(settings, decision.pool) : creditsForShare(settings, decision.creditShare),
          ...(decision.pool && { monthCounter: poolMonthKey(decision.pool.id, at) }),
          // Pro credits are bounded by the person's own caps, not the shared budget (policy.mjs)
          enforceGlobal: decision.pro !== true,
        })
        if (!hold.ok) throw await makeError(hold.code, messageFor(hold.code, decision, settings), { userId })
        action.hold = hold
        action.ceilingMicros = Math.min(action.ceilingMicros, hold.holdMicros)
      } else if (decision.route === 'balance') {
        const hold = await holdWallet(io, {
          walletId: `${decision.payer.type}:${decision.payer.id}`, estimateMicros, ceilingMicros: action.ceilingMicros, marginPercent: settings.marginPercent, now: at,
        })
        if (!hold.ok) throw await makeError(hold.code, messageFor(hold.code, null, settings), { userId, wallet: decision.payer.type === 'org' ? 'team' : 'me' })
        action.hold = hold
        action.ceilingMicros = Math.min(action.ceilingMicros, hold.ceilingMicros)
      }
      return action
    },
    async record(action, entry) {
      const settings = await loadSettings()
      const at = now()
      const kind = entry.kind || 'ai'
      const costMicros = entry.costMicros ?? aiCostMicros({ model: entry.model, usage: entry.usage, connection: entry.connection ?? null, provider: entry.provider ?? null }).costMicros
      const out = await recordUsage(io, {
        ref: entry.ref, payer: action.payer, actorId: action.userId, kind, route: action.route, feature: action.feature,
        model: entry.model, units: entry.usage?.totalTokens ?? 1, costMicros, now: at, settings, hold: action.hold,
      })
      if (out.duplicate) return { costMicros: 0 }
      await onSpend({ costMicros, route: action.route, kind, now: at })
      return { costMicros }
    },
    async finish(action, { ok }) {
      action.finished = true
      await releaseHold(io, action.hold, { ok }, now())
    },
  }
  return meter
}
