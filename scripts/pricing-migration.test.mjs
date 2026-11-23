import test from 'node:test'
import assert from 'node:assert/strict'
import { M1_INDEXES, runM1, cleanup, PLAN_FIELDS } from '../web/app/server/metering/migrations.mjs'
import { DEFAULT_METERING } from '../web/app/server/metering/policy.mjs'

function m1io() {
  const indexes = [], settings = new Map(), markers = new Set()
  return {
    indexes, settings, markers,
    async hasMarker(id) { return markers.has(id) },
    async setMarker(id) { markers.add(id) },
    async ensureIndex(collection, spec, options) { indexes.push([collection, spec, options || {}]) },
    async hasSettings(id) { return settings.has(id) },
    async insertSettings(doc) { if (settings.has(doc._id)) throw new Error('duplicate'); settings.set(doc._id, doc) },
  }
}

test('M1 creates the indexes and the metering settings once', async () => {
  const io = m1io()
  assert.equal(await runM1(io), true)
  assert.equal(await runM1(io), false)
  assert.equal(io.indexes.length, M1_INDEXES.length)
  assert.deepEqual(io.settings.get('metering'), { _id: 'metering', ...DEFAULT_METERING })
  const find = (c, key) => io.indexes.find(([col, spec]) => col === c && Object.keys(spec).join() === key)
  assert.equal(find('meterEvents', 'ref')[2].unique, true)
  assert.equal(find('walletLedger', 'idempotencyKey')[2].unique, true)
  assert.equal(find('providerKeys', 'ownerType,ownerId,provider')[2].unique, true)
  assert.deepEqual(find('huddleCalls', 'starterId')[2], { unique: true, partialFilterExpression: { state: 'open', metered: true } })
  assert.ok(find('aiAudit', 'userId,created'))
  // an operator's own numbers are kept
  const kept = m1io(); kept.settings.set('metering', { _id: 'metering', marginPercent: 7 })
  await runM1(kept)
  assert.equal(kept.settings.get('metering').marginPercent, 7)
})

function m3io() {
  const calls = []
  return {
    calls,
    async countWithFields(collection) { return collection === 'users' ? 4 : 1 },
    async unsetFields(collection, fields) { calls.push(['unset', collection, fields]) },
    async dropCollection(name) { calls.push(['drop', name]) },
    async removeSettings(id) { calls.push(['remove', id]) },
  }
}

test('M3 dry-run reports and changes nothing', async () => {
  const io = m3io()
  const r = await cleanup({ io, apply: false })
  assert.deepEqual(r, { mode: 'dry-run', users: 4, organizations: 1, drops: ['pricingTiers'], settings: ['aiCreditUsage'] })
  assert.deepEqual(io.calls, [])
})

test('M3 apply unsets the plan fields, keeps customerId, drops pricingTiers and the old AI setting', async () => {
  const io = m3io()
  await cleanup({ io, apply: true })
  assert.deepEqual(io.calls, [
    ['unset', 'users', PLAN_FIELDS], ['unset', 'organizations', PLAN_FIELDS], ['drop', 'pricingTiers'], ['remove', 'aiCreditUsage'],
  ])
  assert.deepEqual(PLAN_FIELDS, ['planType', 'subscriptionId', 'paused', 'setToCancel', 'setToCancelOn', 'stripeSubscriptionRevision', 'trackedSubscription', 'guestAdmissionRevision'])
  assert.ok(!PLAN_FIELDS.includes('customerId'))
})

test('M3 runs whatever subscription ids are still on accounts: they are among the fields it removes', async () => {
  const io = m3io()
  await cleanup({ io, apply: true })
  assert.ok(PLAN_FIELDS.includes('subscriptionId'))
  assert.equal(io.calls.length, 4)
})
