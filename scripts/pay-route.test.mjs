import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PAY_ACTIONS, PAY_CODES, payRoute } from '../web/app/imports/api/billing/pay-route.mjs'
import { CREDIT_REFUSALS } from '../web/app/imports/api/common/native-canvas-conversation.mjs'

// Which pane of the in-app pay sheet a meter refusal opens (design §4). Pure: the server puts the
// answer on its refusals' details, and the client uses the same function for anything older.
const read = path => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')

// Every refusal code the meter can give, read from its source so a new code cannot slip past.
function meterCodes() {
  const codes = new Set()
  for (const file of ['server/metering/policy.mjs', 'server/metering/holds.mjs']) {
    const text = read(file)
    for (const m of text.matchAll(/refuse\('([a-z-]+)'/g)) codes.add(m[1])
    // freeCheck and proCode return bare codes
    for (const m of text.matchAll(/return '([a-z][a-z-]+)'/g)) codes.add(m[1])
  }
  // the message table names the rest (e.g. 'balance', 'pro-*')
  const table = read('server/metering/policy.mjs').match(/const MESSAGES = \{([\s\S]*?)\n\}/)[1]
  for (const m of table.matchAll(/'?([a-z][a-z-]*)'?:\s*COPY\./g)) codes.add(m[1])
  return [...codes].sort()
}

const cloud = { proAvailable: true, topUpsAvailable: true, proState: null, emailVerified: true }

test('every refusal code the meter gives is known, and maps to exactly one action', () => {
  const codes = meterCodes()
  assert.ok(codes.length >= 15, 'the scan found the meter\'s codes: ' + codes.join(', '))
  for (const code of codes) {
    assert.ok(PAY_CODES.includes(code), `pay-route does not know the meter's code "${code}"`)
    for (const summary of [cloud, null, { ...cloud, proAvailable: false }, { ...cloud, topUpsAvailable: false, proAvailable: false }]) {
      const out = payRoute({ code, details: {}, summary })
      assert.ok(PAY_ACTIONS.includes(out.action), `${code} → ${out.action}`)
      assert.deepEqual(Object.keys(out).sort(), ['action', 'wallet'])
      assert.equal(out.wallet === null, out.action !== 'topup', `${code}: a wallet only with a top-up`)
    }
  }
})

test('the table in the design: Pro codes get Pro, credits used get a top-up, the rest no payment', () => {
  const at = code => payRoute({ code, details: {}, summary: cloud }).action
  for (const code of ['pro', 'pro-images', 'pro-calls']) assert.equal(at(code), 'pro')
  assert.equal(at('pro-past-due'), 'card')
  for (const code of ['ai-today', 'ai-month', 'ai-paused', 'calls-today', 'calls-month', 'calls-paused', 'video-stage', 'balance']) {
    assert.deepEqual(payRoute({ code, details: {}, summary: cloud }), { action: 'topup', wallet: 'me' }, code)
  }
  assert.equal(at('unverified'), 'verify')
  assert.equal(at('frozen'), 'help')
  assert.equal(at('free-stopped'), 'help')
  assert.equal(at('guest'), 'sign-in')
  // a code that is not about money opens nothing
  assert.equal(at('full'), 'none')
  assert.equal(at('something-new'), 'none')
  assert.equal(payRoute({}).action, 'none')
})

test('Pro codes with Pro already on open Manage, never a second purchase; past due opens the card', () => {
  const on = { ...cloud, proState: { active: true, status: 'active', pastDue: false } }
  for (const code of ['pro', 'pro-images', 'pro-calls']) assert.deepEqual(payRoute({ code, summary: on }), { action: 'manage', wallet: null })
  const late = { ...cloud, proState: { active: false, status: 'past_due', pastDue: true } }
  for (const code of ['pro', 'pro-images', 'pro-calls', 'pro-past-due']) assert.equal(payRoute({ code, summary: late }).action, 'card', code)
})

test('where Pro is not on sale (self-host), Pro codes top up, or point at an own key without payments', () => {
  const selfHost = { ...cloud, ownKeysAvailable: true }
  assert.deepEqual(payRoute({ code: 'pro', summary: { ...selfHost, proAvailable: false } }), { action: 'topup', wallet: 'me' })
  assert.deepEqual(payRoute({ code: 'pro-calls', summary: { ...selfHost, proAvailable: false, topUpsAvailable: false } }), { action: 'own-key', wallet: null })
  assert.deepEqual(payRoute({ code: 'ai-today', summary: { ...selfHost, topUpsAvailable: false } }), { action: 'own-key', wallet: null })
  // no card to update where payments are not configured
  assert.equal(payRoute({ code: 'pro-past-due', summary: { ...cloud, proAvailable: false, topUpsAvailable: false } }).action, 'help')
})

test('a team wallet: an admin tops up the team, anyone else is asked to ask an admin', () => {
  assert.deepEqual(payRoute({ code: 'balance', details: { wallet: 'team' }, summary: { ...cloud, teamAdmin: true } }), { action: 'topup', wallet: 'team' })
  assert.deepEqual(payRoute({ code: 'balance', details: { wallet: 'team' }, summary: { ...cloud, teamAdmin: false } }), { action: 'help', wallet: null })
  assert.deepEqual(payRoute({ code: 'calls-month', details: { wallet: 'team' }, summary: cloud }), { action: 'help', wallet: null })
  // anything else in details is not a wallet
  assert.deepEqual(payRoute({ code: 'balance', details: { wallet: 'org:abc' }, summary: { ...cloud, teamAdmin: true } }), { action: 'topup', wallet: 'me' })
})

test('an unconfirmed email confirms first, whatever the code', () => {
  const unverified = { ...cloud, emailVerified: false }
  for (const code of ['pro', 'ai-today', 'balance', 'presentations-today', 'unverified']) assert.equal(payRoute({ code, summary: unverified }).action, 'verify', code)
  // a guest's daily plans: sign in
  assert.equal(payRoute({ code: 'presentations-today', summary: null }).action, 'sign-in')
})

test('the answer is plain data that survives a Meteor.Error details round trip', () => {
  const out = payRoute({ code: 'ai-today', details: { wallet: 'me' }, summary: cloud })
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out)
  assert.ok(Object.isFrozen(out))
})

test('the chat surfaces answer the call and balance refusals too', () => {
  for (const code of ['calls-today', 'calls-month', 'calls-paused', 'video-stage', 'balance']) assert.ok(CREDIT_REFUSALS.includes(code), code)
})
