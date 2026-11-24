// The AI meter that context.mjs runs: decide who pays, set the request's hold, record each
// provider call or fixed-price use, and release the hold when the request ends. Pure apart
// from the injected io and lookups; meteor.js supplies Mongo, tests an in-memory store.
import { aiActionsPerDay, creditsForShare, messageFor } from './policy.mjs'
import { ESTIMATES, actionCeilingMicros, actionEstimateMicros, aiCostMicros } from './prices.mjs'
import { recordUsage } from './record.mjs'
import { holdFree, holdWallet, releaseHold } from './holds.mjs'
import { addressBucket } from './client-address.mjs'

const defaultError = (code, message) => Object.assign(new Error(message), { error: code, reason: message })

/**
 * deps: { enabled(), io (holds.mjs io + record.mjs io), settings() → metering settings,
 *         decide({ userId?, kind, feature, estimateMicros, countsAsDraft }) → { decision, userId, address? }
 *           (address: the caller's network address, counted on the guest route),
 *         credentials(keyOwner, feature, userId), onSpend?({ costMicros, route, kind, now }),
 *         makeError?(code, message, { userId, wallet? }) → error, or a promise of one,
 *         now?(), newId() }
 */
export function createMeter({ enabled, io, settings: loadSettings, decide, credentials, onSpend = () => {}, makeError = defaultError, now = Date.now, newId }) {
  return {
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
      } else if (decision.route === 'free') {
        // The guest route (policy.mjs) has its own daily count, per person and per address.
        const hold = await holdFree(io, {
          payerId: decision.payer.id, kind, countsAsDraft: opts.countsAsDraft,
          draftsPerDay: decision.draftsPerDay ?? aiActionsPerDay(settings, decision.level ?? 0),
          ...(decision.guest && { draftsCode: 'presentations-today', address: addressBucket(address) && { id: addressBucket(address), perDay: decision.perAddressPerDay } }),
          // the month's AI is the person's share of it in the month Pro starts or ends (policy.mjs route)
          estimateMicros, ceilingMicros: action.ceilingMicros, settings: creditsForShare(settings, decision.creditShare), now: at,
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
      const costMicros = entry.costMicros ?? aiCostMicros({ model: entry.model, usage: entry.usage }).costMicros
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
}
