import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import {
  STRIPE_API_VERSION, applyPaySettings, checkPaySettings, keyMode, secretsUnderPublic, stripeApiVersion, stripeClientOptions,
} from '../web/app/server/pay-settings.mjs'

// The in-app pay sheet's settings (design §7.5, §9): the publishable key, the inApp kill switch and
// the pinned API version. A bad setting turns the sheet off (the hosted redirect still works); it
// never stops the app.
const app = new URL('../web/app/', import.meta.url).pathname
const read = file => readFileSync(join(app, file), 'utf8')

// (pk: undefined and sk: undefined mean "not set", so no destructuring defaults for them)
const settings = (opts = {}) => {
  const { env = 'dev', inApp, apiVersion, extraPublic = {} } = opts
  const pk = 'pk' in opts ? opts.pk : 'pk_test_abc'
  const sk = 'sk' in opts ? opts.sk : 'sk_test_abc'
  return settingsOf({ pk, sk, env, inApp, apiVersion, extraPublic })
}
const settingsOf = ({ pk, sk, env, inApp, apiVersion, extraPublic }) => ({
  stripePrivateKey: sk,
  ...(apiVersion !== undefined && { stripe: { apiVersion } }),
  public: { env, ...(pk !== undefined || inApp !== undefined ? { stripe: { ...(pk !== undefined && { publishableKey: pk }), ...(inApp !== undefined && { inApp }) } } : {}), ...extraPublic },
})

test('the key mode is read from the prefix: test or live, for publishable, secret and restricted keys', () => {
  assert.equal(keyMode('pk_test_1'), 'test')
  assert.equal(keyMode('pk_live_1'), 'live')
  assert.equal(keyMode('sk_test_1'), 'test')
  assert.equal(keyMode('rk_live_1'), 'live')
  assert.equal(keyMode('whatever'), null)
  assert.equal(keyMode(undefined), null)
})

test('a test publishable key with a test secret key turns the sheet on; inApp defaults to on', () => {
  assert.deepEqual(checkPaySettings(settings()), { publishableKey: 'pk_test_abc', inApp: true, problems: [] })
  assert.equal(checkPaySettings(settings({ sk: 'rk_test_abc' })).inApp, true)
  assert.equal(checkPaySettings(settings({ inApp: true })).inApp, true)
})

test('inApp:false is the kill switch: the key stays, the sheet uses the redirect, and it is not a problem', () => {
  assert.deepEqual(checkPaySettings(settings({ inApp: false })), { publishableKey: 'pk_test_abc', inApp: false, problems: [] })
})

test('no publishable key: the redirect, quietly (self-host, the dev mock)', () => {
  assert.deepEqual(checkPaySettings(settings({ pk: undefined })), { publishableKey: null, inApp: false, problems: [] })
  assert.deepEqual(checkPaySettings({ public: {} }), { publishableKey: null, inApp: false, problems: [] })
  assert.deepEqual(checkPaySettings({}), { publishableKey: null, inApp: false, problems: [] })
})

test('pk_live outside production turns the sheet off', () => {
  for (const env of ['dev', 'test', undefined]) {
    const out = checkPaySettings(settings({ pk: 'pk_live_abc', sk: 'sk_live_abc', env }))
    assert.equal(out.inApp, false, String(env))
    assert.ok(out.problems.includes('live-key-outside-prod'))
  }
  assert.deepEqual(checkPaySettings(settings({ pk: 'pk_live_abc', sk: 'rk_live_abc', env: 'prod' })), { publishableKey: 'pk_live_abc', inApp: true, problems: [] })
})

test('a publishable key whose mode differs from the secret key\'s turns the sheet off', () => {
  const a = checkPaySettings(settings({ pk: 'pk_test_abc', sk: 'sk_live_abc', env: 'prod' }))
  assert.equal(a.inApp, false)
  assert.ok(a.problems.includes('mode-mismatch'))
  const b = checkPaySettings(settings({ pk: 'pk_live_abc', sk: 'sk_test_abc', env: 'prod' }))
  assert.equal(b.inApp, false)
  assert.ok(b.problems.includes('mode-mismatch'))
})

test('a secret key that is not a Stripe key (a mock, a placeholder) or none: no sheet', () => {
  for (const sk of ['ROJ2x7cO', '', undefined]) {
    const out = checkPaySettings(settings({ sk }))
    assert.equal(out.inApp, false, String(sk))
    assert.ok(out.problems.includes('no-secret-key'))
  }
})

test('a value that is not a publishable key is refused and never handed to the browser', () => {
  for (const pk of ['sk_test_abc', 'rk_test_abc', 'whsec_abc', 'abc', 42, '']) {
    const out = checkPaySettings(settings({ pk }))
    assert.equal(out.inApp, false, String(pk))
    assert.equal(out.publishableKey, null, String(pk))
    if (pk !== '') assert.ok(out.problems.includes('not-a-publishable-key'), String(pk))
  }
})

test('secret-shaped values anywhere under public are found', () => {
  assert.deepEqual(secretsUnderPublic({ a: 'pk_test_ok', b: { c: 'sk_test_x', d: ['x', 'rk_live_y'] }, e: 'whsec_z', f: 'sk_' }), ['b.c', 'b.d.1', 'e'])
  assert.deepEqual(secretsUnderPublic(undefined), [])
})

test('applying the settings at startup: the browser sees the computed inApp, secrets are blanked, nothing throws', () => {
  const logs = []
  const s = settings({ pk: 'pk_live_abc', sk: 'sk_live_abc', env: 'test', extraPublic: { leaked: { key: 'sk_live_oops' } } })
  const out = applyPaySettings(s, text => logs.push(text))
  assert.equal(out.inApp, false)
  assert.equal(s.public.stripe.inApp, false)
  assert.equal(s.public.stripe.publishableKey, 'pk_live_abc', 'a publishable key is not a secret; inApp is what turns the sheet off')
  assert.equal(s.public.leaked.key, '', 'a secret under public never reaches a browser')
  assert.ok(logs.some(l => /live-key-outside-prod/.test(l)))
  assert.ok(logs.some(l => /leaked\.key/.test(l)))
  assert.ok(!logs.join('\n').includes('sk_live_oops'), 'the log names the path, never the value')
  // a value that is not a publishable key is removed
  const bad = settings({ pk: 'sk_test_abc' })
  applyPaySettings(bad, () => {})
  assert.equal(bad.public.stripe.publishableKey, undefined)
  assert.equal(bad.public.stripe.inApp, false)
  // a good one: on, and quiet
  const good = settings()
  const quiet = []
  applyPaySettings(good, text => quiet.push(text))
  assert.deepEqual([good.public.stripe.inApp, quiet], [true, []])
  // no public.stripe at all: it is made, off
  const none = { public: {} }
  applyPaySettings(none, () => {})
  assert.deepEqual(none.public.stripe, { inApp: false })
  // settings with no public: nothing to do, no throw
  assert.doesNotThrow(() => applyPaySettings({}, () => {}))
})

test('the API version is pinned to the one the installed SDK was built for, unless settings name another', () => {
  const require = createRequire(join(app, 'package.json'))
  const sdk = require('stripe')
  assert.equal(STRIPE_API_VERSION, '2026-10-28.endive')
  assert.equal(sdk.API_VERSION, STRIPE_API_VERSION, 'bump STRIPE_API_VERSION with the SDK (and the webhook endpoint\'s version)')
  assert.equal(stripeApiVersion({}), STRIPE_API_VERSION)
  assert.equal(stripeApiVersion({ stripe: { apiVersion: '2026-11-18.endive' } }), '2026-11-18.endive')
  for (const junk of ['', 'latest', 42, '2026-10-28.endive; drop']) assert.equal(stripeApiVersion({ stripe: { apiVersion: junk } }), STRIPE_API_VERSION, String(junk))
})

test('the client options carry the pinned version, and the local mock\'s host when set', () => {
  assert.deepEqual(stripeClientOptions({}), { apiVersion: STRIPE_API_VERSION })
  assert.deepEqual(stripeClientOptions({ stripe: { apiBase: '' } }), { apiVersion: STRIPE_API_VERSION })
  assert.deepEqual(stripeClientOptions({ stripe: { apiBase: 'http://localhost:12111' } }), { apiVersion: STRIPE_API_VERSION, host: 'localhost', port: '12111', protocol: 'http' })
  assert.deepEqual(stripeClientOptions({ stripe: { apiBase: 'https://mock.example.test' } }), { apiVersion: STRIPE_API_VERSION, host: 'mock.example.test', port: 443, protocol: 'https' })
  // a constructed client really uses it
  const require = createRequire(join(app, 'package.json'))
  const Stripe = require('stripe')
  const client = new Stripe('sk_test_x', stripeClientOptions({}))
  assert.equal(client.getApiField('version'), STRIPE_API_VERSION)
})

test('the SDKs are pinned to exact versions, and those are what is installed', () => {
  const pkg = JSON.parse(read('package.json'))
  const want = { stripe: '23.1.0', '@stripe/stripe-js': '10.2.1', '@stripe/react-stripe-js': '7.0.1' }
  for (const [name, version] of Object.entries(want)) {
    assert.equal(pkg.dependencies[name], version, name)
    assert.equal(JSON.parse(read(`node_modules/${name}/package.json`)).version, version, name + ' installed')
  }
  const lock = JSON.parse(read('package-lock.json'))
  for (const [name, version] of Object.entries(want)) assert.equal(lock.packages['node_modules/' + name]?.version, version, name + ' locked')
})

test('the server builds its one client from the pinned options, and applies the pay settings at startup', () => {
  const wallet = read('server/methods/wallet.js')
  assert.match(wallet, /new Stripe\(key, stripeClientOptions\(Meteor\.settings\)\)/)
  assert.doesNotMatch(wallet, /\bstripe\(key/, 'the SDK is a class from v18 on: construct it with new')
  assert.match(read('server/main.js'), /import '\.\/pay-settings-startup'/)
  assert.match(read('server/pay-settings-startup.js'), /applyPaySettings\(Meteor\.settings/)
})

// every file under web/app's server, imports and client, and the settings files
function files() {
  const out = []
  const walk = dir => {
    for (const name of readdirSync(join(app, dir))) {
      const rel = join(dir, name)
      if (statSync(join(app, rel)).isDirectory()) walk(rel)
      else if (/\.(m?js|jsx|ts|tsx)$/.test(name)) out.push(rel)
    }
  }
  for (const root of ['server', 'imports', 'client']) walk(root)
  return out
}

test('nothing on the server sends payment_method_types (dynamic payment methods), and the legacy tiers are gone', () => {
  const hits = files().filter(f => /payment_method_types/.test(read(f)))
  assert.deepEqual(hits, [])
  for (const gone of ['server/methods/stripe.js', 'server/stripe-subscription.mjs']) {
    assert.throws(() => statSync(join(app, gone)), /ENOENT/, gone)
  }
})

test('no secret-shaped value sits under public in any settings file', () => {
  // the tracked settings.example.json, plus any local settings files (git-ignored) that are present
  const settingsFiles = readdirSync(app).filter(n => /^settings.*\.json$/.test(n))
  assert.ok(settingsFiles.includes('settings.example.json'), settingsFiles.join(', '))
  for (const name of settingsFiles) {
    const s = JSON.parse(read(name))
    assert.deepEqual(secretsUnderPublic(s.public), [], name)
    // and a publishable key, where one is set, is a publishable key (the example leaves it empty)
    const pk = s.public?.stripe?.publishableKey
    if (pk !== undefined && pk !== '') assert.match(pk, /^pk_(test|live)_/, name)
  }
})
