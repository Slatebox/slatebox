// M1 (startup, idempotent): indexes for the meter, wallets, keys and calls, and the
// metering settings document. M2 (startup, idempotent): providerKeys holds named AI connections
// beside the older unnamed keys, so its one-key-per-provider index becomes two. M3 (owner-run):
// removes the old plan and subscription fields. M4 (startup, idempotent): Slatebox Pro's indexes.
// M5 (startup, idempotent): the server's provider keys (kind 'key', ai-control/keys.mjs): one
// document per key, at most one active per provider, each key once.
import { DEFAULT_METERING } from './policy.mjs'

export const M1_MARKER = 'migration:pricing-1'
export const M2_MARKER = 'migration:any-ai-1'

// providerKeys: an owner keeps at most one older unnamed key per provider (keys.save), and any
// number of named AI connections, each name once (ai.update). Several connections of one type
// (two OpenAI-compatible endpoints, say) are the point of choosing AI freely.
export const PROVIDER_KEY_INDEXES = Object.freeze([
  ['providerKeys', { ownerType: 1, ownerId: 1, provider: 1 }, { unique: true, name: 'providerKeys_unnamed_provider', partialFilterExpression: { name: null, kind: null } }],
  ['providerKeys', { ownerType: 1, ownerId: 1, name: 1 }, { unique: true, name: 'providerKeys_named', partialFilterExpression: { name: { $type: 'string' } } }],
])
// The server's provider keys: each key once per provider (an import on two servers at once stores
// it once), and at most one active key per provider.
export const SERVER_KEY_INDEXES = Object.freeze([
  ['providerKeys', { ownerType: 1, ownerId: 1, provider: 1, keyFingerprint: 1 }, { unique: true, name: 'providerKeys_key_fingerprint', partialFilterExpression: { kind: 'key' } }],
  ['providerKeys', { ownerType: 1, ownerId: 1, provider: 1, kind: 1 }, { unique: true, name: 'providerKeys_key_active', partialFilterExpression: { kind: 'key', status: 'active' } }],
])
// the index M1 created before named connections existed: unique per owner and provider
const OLD_PROVIDER_KEY_INDEX = 'ownerType_1_ownerId_1_provider_1'

export const M1_INDEXES = Object.freeze([
  ['meterEvents', { ref: 1 }, { unique: true }],
  ['meterEvents', { payerType: 1, payerId: 1, month: 1 }],
  ['meterEvents', { month: 1, route: 1 }],
  ['walletLedger', { idempotencyKey: 1 }, { unique: true }],
  ['walletLedger', { walletId: 1, created: -1 }],
  ['walletLedger', { 'stripe.chargeId': 1 }],
  ...PROVIDER_KEY_INDEXES,
  ['huddleCalls', { shareId: 1, state: 1 }],
  // one open metered call (free or paid from a balance) per starter
  ['huddleCalls', { starterId: 1 }, { unique: true, partialFilterExpression: { state: 'open', metered: true } }],
  ['huddleCalls', { state: 1 }],
  ['aiAudit', { userId: 1, created: 1 }],
])

// io: { hasMarker, setMarker, ensureIndex(collection, spec, options), hasSettings, insertSettings }
export async function runM1(io) {
  if (await io.hasMarker(M1_MARKER)) return false
  for (const [collection, spec, options] of M1_INDEXES) await io.ensureIndex(collection, spec, options)
  // an operator's own numbers are never replaced
  if (!await io.hasSettings('metering')) await io.insertSettings({ _id: 'metering', ...structuredClone(DEFAULT_METERING) })
  await io.setMarker(M1_MARKER)
  return true
}

// io: { hasMarker, setMarker, indexes(collection) → [{ name }], dropIndex(collection, name),
//       ensureIndex(collection, spec, options) }
export async function runM2(io) {
  if (await io.hasMarker(M2_MARKER)) return false
  const existing = await io.indexes('providerKeys')
  if (existing.some((index) => index.name === OLD_PROVIDER_KEY_INDEX)) await io.dropIndex('providerKeys', OLD_PROVIDER_KEY_INDEX)
  for (const [collection, spec, options] of PROVIDER_KEY_INDEXES) await io.ensureIndex(collection, spec, options)
  await io.setMarker(M2_MARKER)
  return true
}

export const M5_MARKER = 'migration:ai-keys-1'

// io: { hasMarker, setMarker, indexes(collection) → [{ name, partialFilterExpression }],
//       dropIndex(collection, name), ensureIndex(collection, spec, options) }
// The unnamed-key index leaves the server's keys out (they share an owner and provider), then the
// key indexes are added.
export async function runM5(io) {
  if (await io.hasMarker(M5_MARKER)) return false
  const unnamed = (await io.indexes('providerKeys')).find((index) => index.name === 'providerKeys_unnamed_provider')
  if (unnamed && !('kind' in (unnamed.partialFilterExpression || {}))) await io.dropIndex('providerKeys', 'providerKeys_unnamed_provider')
  for (const [collection, spec, options] of [...PROVIDER_KEY_INDEXES, ...SERVER_KEY_INDEXES]) await io.ensureIndex(collection, spec, options)
  await io.setMarker(M5_MARKER)
  return true
}

// M4 (startup, idempotent): Slatebox Pro. Indexes only: nobody has Pro yet. Whether Pro is needed
// comes from settings (metering.proRequiredFrom: 'now' on Cloud, 'never' by default), not data.
// The old plans' customerId (kept by M3) is not reused: Pro writes its own users.pro subdocument.
export const M4_MARKER = 'migration:pro-1'
export const M4_INDEXES = Object.freeze([
  ['users', { 'pro.subscriptionId': 1 }, { unique: true, name: 'users_pro_subscription', partialFilterExpression: { 'pro.subscriptionId': { $type: 'string' } } }],
  ['users', { 'pro.customerId': 1 }, { name: 'users_pro_customer', partialFilterExpression: { 'pro.customerId': { $type: 'string' } } }],
])

// io: { hasMarker, setMarker, ensureIndex(collection, spec, options) }
export async function runM4(io) {
  if (await io.hasMarker(M4_MARKER)) return false
  for (const [collection, spec, options] of M4_INDEXES) await io.ensureIndex(collection, spec, options)
  await io.setMarker(M4_MARKER)
  return true
}

export const PLAN_FIELDS = Object.freeze([
  'planType', 'subscriptionId', 'paused', 'setToCancel', 'setToCancelOn', 'stripeSubscriptionRevision', 'trackedSubscription', 'guestAdmissionRevision',
])

// io: { countWithFields(collection, fields), unsetFields(collection, fields), dropCollection(name), removeSettings(id) }
export async function cleanup({ io, apply }) {
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    users: await io.countWithFields('users', PLAN_FIELDS),
    organizations: await io.countWithFields('organizations', PLAN_FIELDS),
    drops: ['pricingTiers'],
    settings: ['aiCreditUsage'],
  }
  if (!apply) return report
  await io.unsetFields('users', [...PLAN_FIELDS])
  await io.unsetFields('organizations', [...PLAN_FIELDS])
  await io.dropCollection('pricingTiers')
  await io.removeSettings('aiCreditUsage')
  return report
}
