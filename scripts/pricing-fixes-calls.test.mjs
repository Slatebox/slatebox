// Fixes for the hostile review of feat/pricing (pricing-attack-app): calls and own endpoints.
// H3 short calls, M2 calls on a balance, H4 own-endpoint addresses, L2 the camera warning.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { startCall } from '../web/app/server/metering/calls.mjs'
import { M1_INDEXES } from '../web/app/server/metering/migrations.mjs'

const app = new URL('../web/app/', import.meta.url).pathname
const source = path => readFileSync(join(app, path), 'utf8')
const T0 = Date.UTC(2026, 10, 19, 15)
const decision = (over = {}) => ({ ok: true, route: 'free', kind: 'voice', payer: { type: 'user', id: 'starter' }, ...over })

test('H3: a call that ends before a tick is charged for every participant-minute since the last tick', async () => {
  const { endCharge } = await import('../web/app/server/metering/calls.mjs')
  const call = { ...startCall({ callId: 'abcdefgh12345678', shareId: 's', starterId: 'starter', decision: decision(), now: T0 }), participants: Array.from({ length: 20 }, (_, i) => 'p' + i) }
  // everyone disconnected before leave: presence says 1, but 20 people were in the call
  const charge = endCharge({ call, presenceCount: 1, now: T0 + 50_000 })
  assert.deepEqual(charge, { payer: { type: 'user', id: 'starter' }, kind: 'voice', participantMinutes: 17, ref: 'abcdefgh12345678:end' })
  // nobody ever joined: still one person-minute at the least
  const empty = startCall({ callId: 'zzzzzzzz12345678', shareId: 's', starterId: 'starter', decision: decision(), now: T0 })
  assert.equal(endCharge({ call: empty, presenceCount: null, now: T0 + 5_000 }).participantMinutes, 1)
  // a room past its expiry is charged only up to the expiry
  assert.equal(endCharge({ call: { ...empty, roomExpAt: T0 + 60_000 }, presenceCount: 3, now: T0 + 3_600_000 }).participantMinutes, 3)
  // own-key and operator calls carry no Slatebox charge
  const own = startCall({ callId: 'yyyyyyyy12345678', shareId: 's', starterId: 'starter', decision: decision({ route: 'byok', keyOwner: { type: 'user', id: 'starter' } }), now: T0 })
  assert.equal(endCharge({ call: own, presenceCount: 4, now: T0 + 50_000 }), null)
})

test('H3: leave and the expired-room path charge the end of the call', () => {
  const daily = source('server/methods/daily.js')
  assert.match(daily, /const charge = endCharge\(\{ call, presenceCount, now \}\)/)
  assert.match(daily, /recordCallMinutes\(call, charge, now\)/)
  assert.match(daily, /endOpenCall\(call, \{ reason: 'expired'/)
  assert.match(daily, /endOpenCall\(call, \{ reason: 'left', presenceCount: present/)
  assert.doesNotMatch(daily, /\$set: \{ state: 'ended', endedReason: '(left|expired)'/)
  // the end is written once: a later tick or leave cannot charge the same minutes again
  assert.match(daily, /lastTickAt: call\.lastTickAt/)
})

test('M2: one open metered call per starter, whether it is free or paid from a balance', () => {
  const index = M1_INDEXES.find(([collection, spec, options]) => collection === 'huddleCalls' && spec.starterId === 1 && options?.unique)
  assert.deepEqual(index[2].partialFilterExpression, { state: 'open', metered: true })
  for (const route of ['free', 'balance']) {
    assert.equal(startCall({ callId: 'abcdefgh12345678', shareId: 's', starterId: 'starter', decision: decision({ route }), now: T0 }).metered, true, route)
  }
  for (const route of ['byok', 'operator']) {
    assert.equal(startCall({ callId: 'abcdefgh12345678', shareId: 's', starterId: 'starter', decision: decision({ route, keyOwner: { type: 'user', id: 'starter' } }), now: T0 }).metered, undefined, route)
  }
})

test('H4: an own model endpoint must be a public https address', async () => {
  const { checkOwnEndpoint } = await import('../web/app/server/metering/own-endpoint.mjs')
  for (const url of ['http://169.254.169.254/latest', 'http://mongo:27017', 'https://10.0.0.1/v1', 'https://localhost/v1', 'https://[::1]/v1', 'https://metadata.google.internal/v1',
    'https://mongo.default.svc.cluster.local/v1', 'https://redis/v1', 'https://u:p@api.example.com/v1', 'https://api.example.com/v1?x=1', 'ftp://api.example.com']) {
    assert.throws(() => checkOwnEndpoint(url), { error: 'invalid-key' }, url)
  }
  assert.equal(checkOwnEndpoint('https://api.example.com/v1/'), 'https://api.example.com/v1')
})

test('H4: a public name that resolves to a private address is refused when saved and when used', async () => {
  const { assertPublicHost, ownEndpointAgent } = await import('../web/app/server/metering/own-endpoint.mjs')
  const resolver = address => (host, options, callback) => callback(null, [{ address, family: 4 }])
  await assert.rejects(assertPublicHost('https://evil.example.com/v1', resolver('169.254.169.254')), { error: 'invalid-key' })
  await assertPublicHost('https://api.example.com/v1', resolver('93.184.216.34'))
  assert.ok(ownEndpointAgent().options.lookup, 'the connection itself uses a lookup that refuses private addresses')
  const meteor = source('server/metering/meteor.js')
  assert.match(meteor, /checkOwnEndpoint\(/)
  assert.match(meteor, /assertPublicHost\(/)
  assert.doesNotMatch(meteor, /function checkCompatibleUrl/)
  // every request to a chosen connection goes through endpoint-policy.mjs connectionFetch, whose
  // agent is the public-only own-endpoint agent for a hosted person's https endpoint
  const req = source('server/methods/ai/req.js')
  assert.match(req, /fetcher: connectionFetch\(chosenConnection\.baseUrl, chosen\.rules\)/)
  assert.match(source('server/methods/ai/endpoint-policy.mjs'), /rules\?\.publicOnly && !resolve && baseUrl\.startsWith\('https:'\) \? ownEndpointAgent\(\)/)
  assert.match(source('server/methods/ai/workshop-provider.mjs'), /agent: config\.agent/)
})

test('L2: the camera warning speaks of free calls only on a metered server', () => {
  const warning = source('imports/ui/components/billing/CameraWarning.jsx')
  assert.match(warning, /metered \?/)
  assert.match(source('imports/ui/components/CollaborationUsers.jsx'), /metered=\{Boolean\(Meteor\.settings\.public\.metered\)\}/)
})
