// Payments and the AI meter run only on Slatebox Cloud (owner decision, 2026-11-24): settings
// public.edition 'cloud' and a signed Slatebox Cloud key (kind 'cloud', bound to Cloud's host),
// the same proof invited agents need (web/app/server/cloud-lock.mjs). A self-hosted install with
// its own Stripe keys and metering.enabled gets no payments and no meter. No network: the keys are
// a test pair, never Slatebox LLC's.
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { signLicense } from '../web/app/server/enterprise-license.mjs'
import { CLOUD_LOCK_LINES, CLOUD_ONLY, CLOUD_ONLY_WORDS, applyCloudLock, cloudLicensed, createCloudLock } from '../web/app/server/cloud-lock.mjs'
import { meteringEnabled } from '../web/app/server/metering/policy.mjs'
import { billingAvailable, businessCheckout, instanceCapabilities } from '../web/app/server/instance/describe.mjs'
import { applyPaySettings } from '../web/app/server/pay-settings.mjs'

const pair = generateKeyPairSync('ed25519')
const keys = { 'test-key': pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }
const sign = (payload) => signLicense({ id: 'lic_1', licensee: 'Slatebox Cloud', issuedAt: '2026-11-01', expiresAt: '2027-10-31', ...payload }, { kid: 'test-key', privateKey: pair.privateKey })
const at = (isoDay) => Date.parse(isoDay + 'T12:00:00Z')
const NOW = at('2026-11-24')
const app = (file) => readFileSync(new URL('../web/app/' + file, import.meta.url), 'utf8')

// What Slatebox Cloud (prod and test) carries: edition cloud, the Cloud key for its host, Stripe
// keys and the meter.
const cloudSettings = async (more = {}) => ({
  public: { env: 'prod', edition: 'cloud', baseUrl: 'https://app.slatebox.com', stripe: { publishableKey: 'pk_live_abc', inApp: true } },
  enterprise: { license: await sign({ kind: 'cloud', hosts: ['app.slatebox.com'] }) },
  stripePrivateKey: 'sk_live_abc',
  metering: { enabled: true, proRequiredFrom: 'now' },
  payments: { business: { monthly: 'price_biz_m', yearly: 'price_biz_y' } },
  ...more,
})
// A self-hoster who copied Cloud's switches: their own Stripe keys, metering on, Business prices.
const paidClone = (more = {}) => ({
  public: { env: 'selfhost', baseUrl: 'https://boards.example.org', stripe: { publishableKey: 'pk_live_mine', inApp: true } },
  stripePrivateKey: 'sk_live_mine',
  metering: { enabled: true, proRequiredFrom: 'now' },
  payments: { business: { monthly: 'price_mine_m', yearly: 'price_mine_y' } },
  ...more,
})

test('self-host + metering.enabled + Stripe keys + no Cloud license: no payments, no meter, nothing shown', () => {
  const settings = paidClone()
  const lock = createCloudLock({ settings, env: {}, keys, now: () => NOW })
  assert.equal(lock.on(), false)
  assert.equal(lock.payments(), false, 'Stripe keys alone never switch payments on')
  assert.equal(meteringEnabled(settings, { cloud: lock.on() }), false, 'no meter, whatever metering.enabled says')
  assert.equal(billingAvailable(settings, { cloud: lock.on() }), false)
  assert.equal(businessCheckout(settings, { cloud: lock.on() }), false)
  const caps = instanceCapabilities(settings, { mailAvailable: () => true, cloud: lock.on() })
  assert.deepEqual([caps.billing, caps.businessCheckout], [false, false])
  // browsers are told there are no payments: no in-app sheet, no publishable key, no billing UI
  applyPaySettings(settings)
  applyCloudLock(settings, lock.on())
  assert.deepEqual(settings.public.payments, { cloud: false })
  assert.equal(settings.public.stripe.inApp, false)
  assert.equal('publishableKey' in settings.public.stripe, false)
  // the same with edition set to cloud by hand: the setting alone unlocks nothing
  const claimed = paidClone({ public: { env: 'test', edition: 'cloud', baseUrl: 'https://boards.example.org' } })
  assert.equal(cloudLicensed({ settings: claimed, keys, now: NOW }), false)
  // Restated (round-2 review finding 6): a server that asks for the meter outside 'selfhost' and
  // 'dev' (here env 'test', a Cloud test deploy) without an accepted Cloud key refuses to start,
  // where it used to run silently unmetered (unlimited AI on Slatebox's providers). Stricter, not looser.
  assert.throws(() => meteringEnabled(claimed, { cloud: false }), /Slatebox Cloud key/)
  // production settings without the Cloud key refuse to start rather than run unmetered
  assert.throws(() => meteringEnabled({ ...claimed, public: { ...claimed.public, env: 'prod' } }, { cloud: false }), /Slatebox Cloud key/)
  // a missing env with the meter on and no key: the same
  assert.throws(() => meteringEnabled({ metering: { enabled: true } }, { cloud: false }), /Slatebox Cloud key/)
  // self-host and dev that ask for the meter simply have none, and start
  assert.equal(meteringEnabled({ metering: { enabled: true }, public: { env: 'dev' } }, { cloud: false }), false)
})

test('an on-prem license unlocks enterprise features, never payments; nor does a Cloud key for another host', async () => {
  const onPrem = paidClone({ public: { env: 'selfhost', edition: 'self-host', baseUrl: 'https://boards.example.org' }, enterprise: { license: await sign({ kind: 'on-prem' }) } })
  assert.equal(cloudLicensed({ settings: onPrem, keys, now: NOW }), false)
  // a copied Cloud key on another host, with edition cloud: wrong_host
  const copied = paidClone({ public: { env: 'test', edition: 'cloud', baseUrl: 'https://boards.example.org' }, enterprise: { license: await sign({ kind: 'cloud', hosts: ['app.slatebox.com'] }) } })
  assert.equal(cloudLicensed({ settings: copied, keys, now: NOW }), false)
  // a Cloud key on Cloud's host, but self-host edition: wrong_kind
  const selfEdition = { ...(await cloudSettings()), public: { env: 'prod', edition: 'self-host', baseUrl: 'https://app.slatebox.com' } }
  assert.equal(cloudLicensed({ settings: selfEdition, keys, now: NOW }), false)
  // a key signed by anyone else
  const other = generateKeyPairSync('ed25519')
  const forged = await signLicense({ id: 'x', licensee: 'Me', kind: 'cloud', hosts: ['app.slatebox.com'], issuedAt: '2026-01-01', expiresAt: '2099-01-01' }, { kid: 'test-key', privateKey: other.privateKey })
  assert.equal(cloudLicensed({ settings: { ...(await cloudSettings()), enterprise: { license: forged } }, keys, now: NOW }), false)
  // Slatebox LLC's real keys (the default) never accept the test pair
  assert.equal(cloudLicensed({ settings: await cloudSettings(), now: NOW }), false)
  // an error anywhere is closed
  assert.equal(cloudLicensed({ settings: await cloudSettings(), access: () => { throw new Error('boom') } }), false)
})

test('Slatebox Cloud with its signed Cloud key: payments and the meter exactly as before', async () => {
  const settings = await cloudSettings()
  const lock = createCloudLock({ settings, env: {}, keys, now: () => NOW })
  assert.equal(lock.on(), true)
  assert.equal(lock.payments(), true)
  assert.equal(meteringEnabled(settings, { cloud: lock.on() }), true)
  assert.equal(billingAvailable(settings, { cloud: true }), true)
  assert.equal(businessCheckout(settings, { cloud: true }), true)
  assert.equal(businessCheckout({ ...settings, payments: {} }, { cloud: true }), false, 'Business is sold in the app only where both prices are named')
  assert.equal(instanceCapabilities(settings, { mailAvailable: () => true, cloud: true }).billing, true)
  assert.equal(instanceCapabilities(settings, { mailAvailable: () => true, cloud: true }).businessCheckout, true)
  // browsers see Cloud's pay settings unchanged
  applyPaySettings(settings)
  applyCloudLock(settings, true)
  assert.deepEqual(settings.public.payments, { cloud: true })
  assert.equal(settings.public.stripe.publishableKey, 'pk_live_abc')
  assert.equal(settings.public.stripe.inApp, true)
  // the key in the environment, or a file, works the same (settings.enterprise.licenseFile)
  const viaEnv = { ...settings, enterprise: undefined }
  assert.equal(cloudLicensed({ settings: viaEnv, env: { SLATEBOX_LICENSE: settings.enterprise.license }, keys, now: NOW }), true)
  // Cloud's test deployment carries its own host in the key
  const test = await cloudSettings({ public: { env: 'test', edition: 'cloud', baseUrl: 'https://test.slatebox.com' }, enterprise: { license: await sign({ kind: 'cloud', hosts: ['test.slatebox.com'] }) } })
  assert.equal(cloudLicensed({ settings: test, keys, now: NOW }), true)
  assert.equal(meteringEnabled(test, { cloud: true }), true)
})

test('the lock is checked live: a Cloud key that ends while the server runs closes payments after its grace', async () => {
  const settings = await cloudSettings()
  let now = at('2027-10-31')
  const lock = createCloudLock({ settings, env: {}, keys, now: () => now, ttlMs: 60_000 })
  assert.equal(lock.on(), true)
  now = at('2027-11-10')
  assert.equal(lock.on(), true, 'inside the 14-day grace')
  now = at('2027-12-01')
  assert.equal(lock.on(), false)
  // remembered for a minute: no signature check on every call
  let calls = 0
  const counted = createCloudLock({ settings, env: {}, now: () => NOW, access: () => { calls++; return { via: 'cloud' } } })
  for (let i = 0; i < 50; i++) counted.on()
  assert.equal(calls, 1)
  // payments also need a Stripe key
  assert.equal(createCloudLock({ settings: { ...settings, stripePrivateKey: '' }, keys, now: () => NOW }).payments(), false)
})

test('the error and the start line say it plainly', () => {
  assert.equal(CLOUD_ONLY, 'cloud_only')
  assert.match(CLOUD_ONLY_WORDS, /only on Slatebox Cloud/)
  assert.match(CLOUD_LOCK_LINES.off, /^\[payments\] No Slatebox Cloud license/)
  assert.match(CLOUD_LOCK_LINES.on, /^\[payments\] Slatebox Cloud license found/)
  for (const line of Object.values(CLOUD_LOCK_LINES)) assert.equal(line.includes('\n'), false, 'one line')
})

test('every payment and meter path goes through the lock (the paths the docs pass found)', () => {
  // the meter: decided at start with the lock (policy.mjs meteringEnabled)
  assert.match(app('server/metering/meteor.js'), /const METERED = meteringEnabled\(Meteor\.settings, \{ cloud: cloudOn\(\) \}\)/)
  // topUpsAvailable / proAvailable: payments only where the lock is open
  const meter = app('server/metering/meteor.js')
  assert.match(meter, /const sold = paymentsOn\(\)/)
  assert.match(meter, /topUpsAvailable: paymentsOn\(\),/)
  assert.match(meter, /proAvailable: paymentsOn\(\) && proOnSale\(settings\),/)
  assert.doesNotMatch(meter, /Boolean\(Meteor\.settings\.stripePrivateKey\)/)
  // every Stripe call: the one client refuses off Cloud
  const wallet = app('server/methods/wallet.js')
  assert.match(wallet, /export function stripeClient\(\) \{\n {2}requireCloudLicense\(\)/)
  assert.match(wallet, /function requireMeter\(\) \{\n {2}requireCloudLicense\(\)/)
  // Pro's methods
  assert.match(app('server/methods/pro.js'), /function requireCloud\(\) \{\n {2}requireCloudLicense\(\)/)
  // Business's methods: all five refuse with cloud_only first
  const business = app('server/methods/business.js')
  assert.equal(business.match(/requireCloudLicense\(\)\n/g).length, 5)
  assert.match(business, /const cloudReady = \(\) => paymentsOn\(\) && meterOn\(\)/)
  // the webhook answers 404 before it reads anything
  const hooks = app('server/stripeHooks.js')
  assert.ok(hooks.indexOf("if (!cloudOn()) return res.status(404)") < hooks.indexOf('stripeClient()'))
  // /api/v1/instance: billing and businessCheckout follow the lock
  assert.match(app('server/instance/describe.mjs'), /billing: billingAvailable\(settings, \{ cloud \}\)/)
  assert.match(app('server/instance/meteor.js'), /cloud: cloudOn,/)
  // browsers: told at start, and the sheet and the Business panel stay closed without payments
  assert.match(app('server/pay-settings-startup.js'), /applyCloudLock\(Meteor\.settings, cloud\)/)
  assert.match(app('server/main.js'), /import '\.\/pay-settings-startup'/)
  assert.match(app('imports/ui/components/billing/pay/pay-env.js'), /payments\?\.cloud === true/)
  assert.match(app('imports/ui/components/billing/pay/PaySheetHost.jsx'), /if \(!paymentsHere\(\)\) return/)
  assert.match(app('imports/ui/components/teams/BusinessPanel.jsx'), /if \(!paymentsHere\(\)\) return/)
  // the Meteor side reuses the enterprise license check, not a copy of it
  assert.match(app('server/cloud-lock.mjs'), /import \{ enterpriseAccess \} from '\.\/enterprise-license\.mjs'/)
  assert.match(app('server/cloud-lock-meteor.js'), /console\.log\(lock\.on\(\) \? CLOUD_LOCK_LINES\.on : CLOUD_LOCK_LINES\.off\)/)
})

test('the account and instance reports follow the meter, not the raw setting (round-2 review findings 8 and 11)', async () => {
  const { createAccounts } = await import('../web/app/server/instance/account-summary.mjs')
  // a self-hosted server whose settings say metering.enabled: no meter runs, so no pay or top-up links
  const accounts = createAccounts({
    settings: paidClone(), origin: 'https://boards.example.org', meterOn: () => false,
    findUser: async () => ({ _id: 'u', emails: [{ address: 'a@example.org', verified: true }] }), findOrganization: async () => null,
    listClaims: async () => [], canGenerate: async () => false, proSummary: () => ({ active: true }), includedThisMonth: async () => ({ included: true }),
  })
  const me = await accounts.summary({ userId: 'u', kind: 'person' })
  assert.equal(me.links.pay, undefined)
  assert.equal(me.links.topUp, undefined)
  assert.equal(me.links.credits, undefined)
  assert.deepEqual([me.ai.included, me.ai.pro], [null, null])
  assert.match(app('server/instance/meteor.js'), /meterOn,\n\}\)/, 'the Meteor glue passes the meter\'s own answer')
  // transcription is offered where no meter runs, even when settings ask for one
  const withDeepgram = paidClone({ deepgram: { secret: 'dg' } })
  assert.equal(instanceCapabilities(withDeepgram, { mailAvailable: () => true, cloud: false }).transcription, true)
  const cloud = await cloudSettings({ deepgram: { secret: 'dg' } })
  assert.equal(instanceCapabilities(cloud, { mailAvailable: () => true, cloud: true }).transcription, false)
  // Business checkout is reported only where the methods would take it: Cloud, prices and the meter on
  const meterOff = await cloudSettings({ metering: { enabled: false } })
  assert.equal(businessCheckout(meterOff, { cloud: true }), false)
  assert.equal(instanceCapabilities(meterOff, { mailAvailable: () => true, cloud: true }).businessCheckout, false)
  assert.equal(businessCheckout(await cloudSettings(), { cloud: true }), true)
})
