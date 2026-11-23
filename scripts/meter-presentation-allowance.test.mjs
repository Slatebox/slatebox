// The presentation plan is the core of Present, so a guest on their own slate and a signed-in
// person whose email is not confirmed yet get it too: from the free budget, a few plans a day
// per person and per network address. Every other AI use stays as it was for them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { meterWorld, NOW } from './fixtures/meter-world.mjs'
import { runAIAction, installMeter } from '../web/app/server/metering/context.mjs'
import { DEFAULT_METERING, route, dayKey } from '../web/app/server/metering/policy.mjs'

const guest = { id: 'g1', anonymous: true, emailVerified: false }
const unverified = { id: 'u2', anonymous: false, emailVerified: false }
const quiet = { monthFreeMicros: 0, todayFreeMicros: 0 }
const ask = (overrides = {}) => route({
  kind: 'ai', person: guest, teamId: null, keys: {}, usage: {}, wallets: {}, global: quiet,
  estimateMicros: 10000, settings: DEFAULT_METERING, now: NOW, feature: 'presentation', ...overrides,
})

test('a guest and an unconfirmed account get a presentation plan from the free budget', () => {
  for (const person of [guest, unverified]) {
    const decision = ask({ person })
    assert.equal(decision.ok, true, JSON.stringify(decision))
    assert.equal(decision.route, 'free')
    assert.deepEqual(decision.payer, { type: 'user', id: person.id })
    assert.equal(decision.draftsPerDay, DEFAULT_METERING.free.guestPresentationsPerDay)
    assert.equal(decision.perAddressPerDay, DEFAULT_METERING.free.guestPresentationsPerAddressPerDay)
  }
  assert.ok(DEFAULT_METERING.free.guestPresentationsPerDay > 0)
  assert.ok(DEFAULT_METERING.free.guestPresentationsPerAddressPerDay >= DEFAULT_METERING.free.guestPresentationsPerDay)
})

test('only the presentation plan: other AI, image search and calls stay refused to a guest', () => {
  for (const feature of ['workshop', 'generation', 'welcome', undefined]) {
    assert.equal(ask({ feature }).code, 'guest', String(feature))
    assert.equal(ask({ person: unverified, feature }).code, 'unverified', String(feature))
  }
  assert.equal(ask({ kind: 'imageSearch' }).code, 'guest')
  assert.equal(ask({ kind: 'voice' }).ok, false)
  assert.equal(ask({ person: null }).code, 'guest')
})

test('the guest allowance has its own daily count and the free budget\'s limits', () => {
  const used = DEFAULT_METERING.free.guestPresentationsPerDay
  const refused = ask({ usage: { aiActionsToday: used } })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'presentations-today')
  assert.match(refused.message, /presentation/i)
  assert.equal(ask({ global: { monthFreeMicros: DEFAULT_METERING.budget.monthlyMicros * 1.2, todayFreeMicros: 0 } }).code, 'ai-paused')
  assert.equal(ask({ usage: { freeMicrosToday: DEFAULT_METERING.free.perPersonMicrosPerDay } }).code, 'ai-today')
  assert.equal(ask({ person: { ...guest, freeStopped: true } }).code, 'free-stopped')
  // A confirmed account keeps the ordinary route and allowance.
  const signedIn = ask({ person: { id: 'p', anonymous: false, emailVerified: true } })
  assert.equal(signedIn.route, 'free')
  assert.equal(signedIn.draftsPerDay, undefined)
})

test('a guest\'s plans are counted per person and per address, and a failed plan is given back', async () => {
  const w = await meterWorld({ person: { anonymous: true, emailVerified: false }, address: '203.0.113.7' })
  const plan = (ok = true) => runAIAction({ feature: 'presentation' }, async () => {
    if (!ok) throw new Error('provider failed')
    return 'planned'
  })
  await assert.rejects(plan(false), /provider failed/)
  assert.equal(w.spent().drafts, 0)
  assert.equal(w.stores.counters.get(`address:203.0.113.7:${dayKey(NOW)}`)?.aiActions || 0, 0)
  for (let i = 0; i < DEFAULT_METERING.free.guestPresentationsPerDay; i++) assert.equal(await plan(), 'planned')
  assert.equal(w.spent().drafts, DEFAULT_METERING.free.guestPresentationsPerDay)
  assert.equal(w.stores.counters.get(`address:203.0.113.7:${dayKey(NOW)}`).aiActions, DEFAULT_METERING.free.guestPresentationsPerDay)
  await assert.rejects(plan(), error => error.error === 'presentations-today')
  installMeter(null)
})

test('many guest accounts from one address share the address\'s daily plans', async () => {
  const settings = structuredClone(DEFAULT_METERING)
  settings.free.guestPresentationsPerDay = 3
  settings.free.guestPresentationsPerAddressPerDay = 4
  const key = `address:198.51.100.2:${dayKey(NOW)}`
  const counters = new Map()
  let refusedAt = null
  for (let account = 0; account < 3 && refusedAt === null; account++) {
    const w = await meterWorld({ person: { anonymous: true, emailVerified: false }, address: '198.51.100.2', settings })
    for (const [k, v] of counters) w.stores.counters.set(k, v)
    for (let i = 0; i < 3; i++) {
      try {
        await runAIAction({ feature: 'presentation' }, async () => 'planned')
      } catch (error) {
        assert.equal(error.error, 'presentations-today')
        refusedAt = account * 3 + i
        break
      }
    }
    // the next account is a new guest on the same address
    counters.set(key, w.stores.counters.get(key))
  }
  assert.equal(refusedAt, 4)
  installMeter(null)
})

test('a plan the provider fails to make is given back: six failed presses never use up the day', async () => {
  const { planWithAI } = await import('../web/app/server/methods/presentationRequest.mjs')
  const w = await meterWorld({ person: { anonymous: true, emailVerified: false }, address: '203.0.113.9' })
  const layout = { nodes: ['a', 'b', 'c', 'd'].map((id, i) => ({ nodeId: id, description: id, metrics: { rotation: 0, bbox: { x: i * 1000, y: 0, width: 100, height: 50 } }, childrenNodes: [] })) }
  const run = fn => runAIAction({ feature: 'presentation' }, fn)
  for (let press = 0; press < DEFAULT_METERING.free.guestPresentationsPerDay + 1; press++) {
    const out = await planWithAI({ run, layout, request: async () => { throw new Error('HTTP 500') } })
    assert.equal(out.automatic, true)
    assert.equal(out.reason, 'HTTP 500', `press ${press + 1}`)
  }
  assert.equal(w.spent().drafts, 0)
  assert.equal(w.stores.counters.get(`address:203.0.113.9:${dayKey(NOW)}`)?.aiActions || 0, 0)
  installMeter(null)
})

test('IPv6 addresses are counted by their /64: one network cannot pose as many machines', async () => {
  const { addressBucket } = await import('../web/app/server/metering/client-address.mjs')
  assert.equal(addressBucket('2001:db8:1:2::5'), addressBucket('2001:db8:1:2:ffff:1:2:3'))
  assert.notEqual(addressBucket('2001:db8:1:2::5'), addressBucket('2001:db8:1:3::5'))
  assert.equal(addressBucket('203.0.113.7'), '203.0.113.7')
  assert.equal(addressBucket('::ffff:203.0.113.7'), '203.0.113.7')
  assert.equal(addressBucket(null), null)
  const settings = structuredClone(DEFAULT_METERING)
  settings.free.guestPresentationsPerDay = 10
  settings.free.guestPresentationsPerAddressPerDay = 2
  const counters = new Map()
  let refused = 0
  for (const address of ['2001:db8:1:2::1', '2001:db8:1:2::2', '2001:db8:1:2::3']) {
    const w = await meterWorld({ person: { anonymous: true, emailVerified: false }, address, settings })
    for (const [k, v] of counters) w.stores.counters.set(k, v)
    try { await runAIAction({ feature: 'presentation' }, async () => 'planned') } catch (error) {
      assert.equal(error.error, 'presentations-today')
      refused += 1
    }
    for (const [k, v] of w.stores.counters) if (k.startsWith('address:')) counters.set(k, v)
  }
  assert.equal(refused, 1)
  installMeter(null)
})

test('guest accounts are limited per network address, not only per connection', async () => {
  const { METER_RATE_LIMITS } = await import('../web/app/server/metering/limits.mjs')
  const rule = METER_RATE_LIMITS.find(item => item.method === 'users.createAnonymous' && item.per === 'address')
  assert.ok(rule, 'a per-address rule for users.createAnonymous')
  assert.ok(rule.count <= 30 && rule.intervalMs >= 10 * 60_000, JSON.stringify(rule))
  // Counted for a real address; a Cloudflare edge (many people) and this machine (tests) are not.
  const { ddpRule } = await import('../web/app/server/metering/limits.mjs')
  const matches = ddpRule(rule).clientAddress
  assert.equal(matches('203.0.113.5'), true)
  assert.equal(matches('104.16.0.1'), false)
  assert.equal(matches('127.0.0.1'), false)
})

test('the cluster\'s own address (the ingress, a node, a pod) is never one caller: every guest behind it is not put in one count', async () => {
  const { isPrivateAddress, isProxyAddress } = await import('../web/app/server/metering/client-address.mjs')
  const { METER_RATE_LIMITS, ddpRule } = await import('../web/app/server/metering/limits.mjs')
  for (const address of ['10.42.0.5', '::ffff:10.42.1.9', '172.16.3.4', '172.31.255.1', '192.168.1.20', '127.0.0.1', '169.254.1.1', '100.64.0.7', '::1', 'fd00::1', 'fe80::1']) {
    assert.equal(isPrivateAddress(address), true, address)
    assert.equal(isProxyAddress(address), true, address)
  }
  for (const address of ['203.0.113.7', '172.32.0.1', '8.8.8.8', '2001:db8::1']) assert.equal(isPrivateAddress(address), false, address)
  assert.equal(isProxyAddress('162.158.1.2'), true, 'a Cloudflare edge too')
  // Every per-address rule (createAnonymous's included) skips it; a real address is still counted.
  for (const rule of METER_RATE_LIMITS.filter(item => item.per === 'address')) {
    assert.equal(ddpRule(rule).clientAddress('10.42.0.5'), false, rule.method)
    assert.equal(ddpRule(rule).clientAddress('203.0.113.7'), true, rule.method)
  }
  // The guest route's per-address count reads the same test (callerAddress in meteor.js).
  const meteor = readFileSync(new URL('../web/app/server/metering/meteor.js', import.meta.url), 'utf8')
  assert.match(meteor, /return address && !isProxyAddress\(address\) \? address : null/)
})
