// One metered use: an append-only event, the counters, and the wallet debit.
// The event's ref is unique (an AIAudit id, callId:tick or a search id), so a replay
// records nothing twice. The io object is the Mongo glue in meteor.js, or a test double.
import { meterAmounts } from './prices.mjs'
import { dayKey, monthKey } from './policy.mjs'
import { takeFromHold } from './holds.mjs'

const MONTH_FIELD = { ai: 'aiMicros', imageSearch: 'aiMicros', imageGeneration: 'aiMicros', voice: 'voiceMinutes', video: 'videoMinutes' }

// hold: the running request's hold (holds.mjs), if any. What this use spends moves out of it.
// pro: spent from Pro credits (a Pro hold, or a call started on Pro). It counts on the person's
// day and month like any included use, but on the global keys as proMicros, never as the
// freeMicros the shared budget's stages, its daily rule and its alerts read: paying people's use
// never pauses anyone else's free use. Admin totals show both.
// pool: a Business team's pool (pool.mjs) a call started on: its minutes count on the team's month.
export async function recordUsage(io, { ref, payer, actorId, kind, route, feature, model, units, costMicros, now, settings, hold = null, pro = false, pool = null }) {
  const amounts = meterAmounts({ costMicros, route, marginPercent: settings.marginPercent })
  const month = monthKey(now), day = dayKey(now)
  const event = {
    ref, payerType: payer.type, payerId: payer.id, actorId, kind, route, feature, model: model ?? null, units,
    costMicros: amounts.costMicros, chargeMicros: amounts.chargeMicros,
    ...(amounts.providerMicros !== undefined && { providerMicros: amounts.providerMicros }),
    month, day, created: now,
  }
  if (!await io.insertEvent(event)) return { duplicate: true }
  const released = takeFromHold(hold, amounts)

  if (route === 'free') {
    const onPro = pro === true || hold?.pro === true
    const ai = MONTH_FIELD[kind] === 'aiMicros'
    const own = ai ? amounts.costMicros : units
    // a hold is taken on the same keys it was set on, even across midnight
    const keys = hold?.keys || { day: `user:${payer.id}:${day}`, month: pool?.id ? `org:${pool.id}:${month}` : `user:${payer.id}:${month}`, global: `global:${month}` }
    await io.inc(keys.month, { [MONTH_FIELD[kind]]: own, ...(released && { heldAiMicros: -released }) })
    await io.inc(keys.day, { freeMicros: amounts.costMicros, ...(released && { heldMicros: -released }) })
    if (onPro) {
      await io.inc(keys.global, { proMicros: amounts.costMicros, [`proByKind.${kind}`]: amounts.costMicros, ...(released && { heldProMicros: -released }) })
      await io.inc(`global:${day}`, { proMicros: amounts.costMicros })
    } else {
      await io.inc(keys.global, { freeMicros: amounts.costMicros, [`freeByKind.${kind}`]: amounts.costMicros, ...(released && { heldMicros: -released }) })
      await io.inc(`global:${day}`, { freeMicros: amounts.costMicros })
    }
  }
  let debit = null
  if (route === 'balance' && amounts.chargeMicros > 0) {
    debit = await io.debitWallet(`${payer.type}:${payer.id}`, amounts.chargeMicros, event, released)
  }
  return { ...amounts, debit }
}
