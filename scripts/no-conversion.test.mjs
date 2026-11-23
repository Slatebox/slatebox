import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { refundConfirmText } from '../web/app/imports/ui/components/billing/money.js'
import { cleanup, PLAN_FIELDS } from '../web/app/server/metering/migrations.mjs'
import { mongoCleanupIo } from '../web/app/scripts/pricing-cleanup.mjs'
import { DEFAULT_METERING, videoAllowance } from '../web/app/server/metering/policy.mjs'
import { emptyWallet, debit } from '../web/app/server/metering/ledger.mjs'
import { createAccounts } from '../web/app/server/instance/account-summary.mjs'
import accountGet from '../web/app/server/actions/account-get.mjs'
import instanceDescribe from '../web/app/server/actions/instance-describe.mjs'

// Every subscription was cancelled on 2026-11-20 with no conversion: nobody holds a balance that
// came from a subscription, and Slatebox has no plans. This keeps both facts true in the code.
const app = new URL('../web/app/', import.meta.url).pathname
const repo = new URL('../', import.meta.url).pathname
const read = file => readFileSync(join(app, file), 'utf8')
const files = []
for (const root of ['server', 'imports', 'client', 'scripts']) {
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (name === 'node_modules') continue
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(m?js|jsx|cjs|json|html|md)$/.test(name)) files.push(full.slice(app.length))
    }
  }
  walk(join(app, root))
}

test('the subscriber conversion is gone: no module, no script, no test', () => {
  for (const gone of ['server/metering/conversion.mjs', 'scripts/convert-subscribers.mjs']) assert.equal(existsSync(join(app, gone)), false, gone)
  assert.equal(existsSync(join(repo, 'scripts/subscriber-conversion.test.mjs')), false)
})

test('no code, copy or comment talks about a balance converted from a subscription', () => {
  const words = /convert(ed|ing)? (a |the |each |every )?(subscri|balance)|conversion (entry|ledger|report|row)|from (a|your) subscription|came from a subscription|former[- ]?subscriber|formerSubscriber|refundableOnChargeCents|stripe\.chargeIds|'conversion'|"conversion"|unconvertedSubscribers|CONVERSION_STRIPE_KEY/i
  const hits = files.filter(file => words.test(read(file))).map(file => `${file}: ${read(file).match(words)[0]}`)
  assert.deepEqual(hits, [])
})

test('the refund wording never mentions a subscription, and still says when part of a balance cannot go back', () => {
  const both = refundConfirmText({ balanceCents: 10335, refundableCents: 6890 })
  assert.equal(both, '$68.90 goes back to the card it came from. The other $34.45 cannot go back to a card, so it is closed. Your balance is then $0.00.')
  assert.equal(refundConfirmText({ balanceCents: 1000, refundableCents: 1000 }), '$10.00 goes back to the card it came from, and your balance is closed at $0.00.')
  assert.equal(refundConfirmText({ balanceCents: 500, refundableCents: 0, team: true }), 'None of the team’s balance of $5.00 can go back to a card, so refunding closes all of it.')
  for (const text of [both, refundConfirmText({ balanceCents: 500, refundableCents: 0 })]) assert.doesNotMatch(text, /subscri|convert/i)
  assert.doesNotMatch(read('imports/ui/pages/Profile.jsx'), /subscri|convert/i)
  assert.match(read('imports/ui/pages/Profile.jsx'), /cannot go back to a card, so it closes with your account/)
})

test('the charges list has no subscription source; a row of a type it does not know reads as a balance change', () => {
  const wallet = read('server/methods/wallet.js')
  const labels = wallet.match(/const LABELS = \{[^}]*\}/)[0]
  assert.doesNotMatch(labels, /conversion|subscri/i)
  assert.match(wallet, /LABELS\[e\.type\] \|\| 'Balance change'/)
  // only top-ups are charges a refund goes back to
  assert.match(wallet, /type: 'topup' \}, \{ fields: \{ walletId: 1 \} \}/)
  assert.match(wallet, /entries\.filter\(e => e\.type === 'topup' && e\.stripe\?\.chargeId/)
})

test('spending lowers what can go back to a card by what was spent', () => {
  const out = debit({ ...emptyWallet(), balanceMicros: 15_000_000, refundableMicros: 10_000_000 }, 3_000_000)
  assert.equal(out.wallet.balanceMicros, 12_000_000)
  assert.equal(out.wallet.refundableMicros, 7_000_000)
  assert.equal(out.refundableDeltaMicros, -3_000_000)
  const plain = debit({ ...emptyWallet(), balanceMicros: 10_000_000, refundableMicros: 10_000_000 }, 1_000_000)
  assert.equal(plain.wallet.refundableMicros, 9_000_000)
  const capped = debit({ ...emptyWallet(), balanceMicros: 10_000_000, refundableMicros: 1_000_000 }, 3_000_000)
  assert.equal(capped.wallet.refundableMicros, 0)
})

test('everyone gets the same video minutes: there is no former-subscriber amount', () => {
  assert.equal(Object.keys(DEFAULT_METERING.free).some(key => /subscri/i.test(key)), false)
  assert.equal(videoAllowance(DEFAULT_METERING), DEFAULT_METERING.free.videoMinutesPerMonth)
  assert.doesNotMatch(read('server/metering/meteor.js'), /formerSubscriber/)
})

test('the pricing cleanup only removes plan and subscription fields; it needs no conversion', async () => {
  const calls = []
  const io = {
    async countWithFields(collection) { return collection === 'users' ? 3 : 1 },
    async unsetFields(collection, fields) { calls.push(['unset', collection, fields]) },
    async dropCollection(name) { calls.push(['drop', name]) },
    async removeSettings(id) { calls.push(['remove', id]) },
  }
  assert.deepEqual(await cleanup({ io, apply: false }), { mode: 'dry-run', users: 3, organizations: 1, drops: ['pricingTiers'], settings: ['aiCreditUsage'] })
  assert.deepEqual(calls, [])
  await cleanup({ io, apply: true })
  assert.deepEqual(calls, [['unset', 'users', PLAN_FIELDS], ['unset', 'organizations', PLAN_FIELDS], ['drop', 'pricingTiers'], ['remove', 'aiCreditUsage']])
  // a subscription id left on an account no longer blocks the cleanup: it is one of the fields removed
  assert.ok(PLAN_FIELDS.includes('subscriptionId'))
  assert.ok(!PLAN_FIELDS.includes('customerId'))
  const mongo = mongoCleanupIo({ collection: () => ({}) })
  assert.equal('unconvertedSubscribers' in mongo, false)
  assert.doesNotMatch(read('scripts/pricing-cleanup.mjs') + read('server/metering/migrations.mjs'), /conver/i)
})

test('there is no plans page and no route kept for old links to one', () => {
  assert.doesNotMatch(read('client/main.jsx'), /path="\/plans"|plans page/)
  assert.doesNotMatch(readFileSync(join(repo, 'scripts/native-conversation-viewport.mjs'), 'utf8'), /'\/plans'/)
})

test('account.get and instance.describe have no plan field', async () => {
  assert.equal('plan' in accountGet.output.properties, false)
  assert.ok(!accountGet.output.required.includes('plan'))
  assert.doesNotMatch(accountGet.description, /\bplans?\b/)
  assert.equal('plans' in instanceDescribe.output.properties, false)
  assert.doesNotMatch(instanceDescribe.description, /\bplans?\b/)
  const accounts = createAccounts({
    settings: { public: { env: 'prod' } }, origin: 'https://example.org',
    findUser: async () => ({ _id: 'u1', emails: [{ address: 'a@example.org', verified: true }] }),
    findOrganization: async () => null, listClaims: async () => [], canGenerate: async () => true,
  })
  const me = await accounts.summary({ userId: 'u1', kind: 'person' })
  assert.equal('plan' in me, false)
  assert.doesNotMatch(read('server/instance/describe.mjs'), /plans: null/)
  // the generated documents agree (slates.applyOperations' edit "plan" is a different thing)
  const contract = JSON.parse(read('server/actions/generated/contract.json'))
  const openapi = JSON.parse(read('server/actions/generated/openapi.json'))
  const action = id => contract.actions.find(a => a.id === id)
  assert.equal('plan' in action('account.get').output.properties, false)
  assert.equal('plans' in action('instance.describe').output.properties, false)
  const response = path => openapi.paths[path].get.responses['200'].content['application/json'].schema
  assert.equal('plan' in response('/me').properties, false)
  assert.equal('plans' in response('/instance').properties, false)
  for (const generated of ['server/actions/generated/slatebox.d.ts', 'server/actions/generated/client.json', 'server/actions/generated/contract.json', 'server/actions/generated/openapi.json']) {
    assert.doesNotMatch(read(generated), /\bplan: Record<string, unknown> \| null|\bplans\?: Array|plans? is always null|permissions, plan,/, generated)
  }
})
