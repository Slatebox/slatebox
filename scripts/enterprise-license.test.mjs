// The key check that proves a server is Slatebox Cloud (web/app/server/enterprise-license.mjs):
// offline, Ed25519, Slatebox LLC's public keys only. A self-hosted install needs no key at all:
// integrations are free everywhere (owner, 2026-11-26).
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  enterpriseAccess, LICENSE_GRACE_DAYS, LICENSE_KEYS, LICENSE_WORDS, parseLicense, readLicenseText, signLicense, verifyLicense,
} from '../web/app/server/enterprise-license.mjs'

const pair = generateKeyPairSync('ed25519')
const keys = { 'test-key': pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }
const sign = (payload) => signLicense({ id: 'lic_1', licensee: 'Example Co', issuedAt: '2026-12-01', expiresAt: '2027-11-30', ...payload }, { kid: 'test-key', privateKey: pair.privateKey })
const at = (isoDay) => Date.parse(isoDay + 'T12:00:00Z')

test('a key Slatebox signed unlocks for its year, then a grace, then locks', async () => {
  const key = await sign({})
  assert.equal(verifyLicense(key, { keys, now: at('2026-11-30') }).reason, 'not_yet')
  const on = verifyLicense(key, { keys, now: at('2026-12-01') })
  assert.equal(on.valid, true)
  assert.equal(on.reason, 'license')
  assert.deepEqual(on.license, { id: 'lic_1', licensee: 'Example Co', kind: 'on-prem', issuedAt: '2026-12-01', expiresAt: '2027-11-30', hosts: [] })
  assert.equal(verifyLicense(key, { keys, now: at('2027-11-30') }).reason, 'license', 'its last day counts in full')
  assert.equal(verifyLicense(key, { keys, now: at('2027-12-01') }).reason, 'grace')
  assert.equal(verifyLicense(key, { keys, now: at('2027-12-01') + LICENSE_GRACE_DAYS * 86_400_000 }).reason, 'expired')
})

test('a changed, foreign or garbled key unlocks nothing', async () => {
  const key = await sign({})
  const parsed = parseLicense(key)
  // longer: the payload says another licensee, the signature is the old one
  const forged = Buffer.from(JSON.stringify({ ...parsed.payload, expiresAt: '2099-12-31' })).toString('base64url')
  const parts = key.split('.')
  assert.equal(verifyLicense([parts[0], parts[1], forged, parts[3]].join('.'), { keys, now: at('2027-01-01') }).reason, 'bad_signature')
  const other = generateKeyPairSync('ed25519')
  const foreign = await signLicense({ id: 'x', licensee: 'Me', issuedAt: '2026-01-01', expiresAt: '2099-01-01' }, { kid: 'test-key', privateKey: other.privateKey })
  assert.equal(verifyLicense(foreign, { keys, now: at('2027-01-01') }).reason, 'bad_signature')
  assert.equal(verifyLicense(key.replace('test-key', 'another-key'), { keys, now: at('2027-01-01') }).reason, 'unknown_key')
  for (const text of ['', 'sblic1', 'sblic1.a.b', 'sblic2.test-key.e30.AA', 'sblic1.test-key.!!.AA', null, 42]) assert.equal(verifyLicense(text, { keys }).reason, 'malformed')
  // another product's payload, properly signed
  const wrong = await signLicense({ id: 'x', licensee: 'Me', issuedAt: '2026-01-01', expiresAt: '2099-01-01', product: 'something-else' }, { kid: 'test-key', privateKey: pair.privateKey })
  assert.equal(verifyLicense(wrong, { keys, now: at('2027-01-01') }).reason, 'wrong_product')
})

test('a key bound to hosts unlocks only those installs', async () => {
  const key = await sign({ hosts: ['slatebox.example.com'] })
  assert.equal(verifyLicense(key, { keys, now: at('2027-01-01'), host: 'slatebox.example.com' }).valid, true)
  assert.equal(verifyLicense(key, { keys, now: at('2027-01-01'), host: 'SLATEBOX.EXAMPLE.COM' }).valid, true)
  assert.equal(verifyLicense(key, { keys, now: at('2027-01-01'), host: 'other.example.com' }).reason, 'wrong_host')
})

test('the app trusts only Slatebox LLC\'s keys, and never a key a settings file or environment names', async () => {
  const key = await sign({})
  assert.equal(verifyLicense(key, { now: at('2027-01-01') }).reason, 'unknown_key')
  assert.ok(Object.keys(LICENSE_KEYS).length >= 1)
  for (const spki of Object.values(LICENSE_KEYS)) assert.match(spki, /^MCowBQYDK2VwAyEA[\w+/]{43}=$/, 'an Ed25519 public key, nothing more')
  const cloudKey = await sign({ kind: 'cloud', hosts: ['app.slatebox.com'] })
  const settings = { public: { edition: 'cloud', baseUrl: 'https://app.slatebox.com' }, enterprise: { license: cloudKey, publicKey: keys['test-key'], keys } }
  assert.equal(enterpriseAccess({ settings, env: { SLATEBOX_LICENSE_KEYS: JSON.stringify(keys) }, now: at('2027-01-01') }).unlocked, false)
})

test('where the key is read from: settings, then the environment, then a file', async () => {
  const key = await sign({})
  assert.deepEqual(readLicenseText({ settings: { enterprise: { license: ` ${key} ` } } }), { text: key })
  assert.deepEqual(readLicenseText({ settings: {}, env: { SLATEBOX_LICENSE: key } }), { text: key })
  assert.deepEqual(readLicenseText({ settings: { enterprise: { licenseFile: '/etc/slatebox/license' } }, readFile: (path) => (path === '/etc/slatebox/license' ? key + '\n' : '') }), { text: key })
  assert.deepEqual(readLicenseText({ settings: {}, env: { SLATEBOX_LICENSE_FILE: '/nope' }, readFile: () => { throw new Error('ENOENT') } }), { text: null, problem: 'unreadable_file' })
  assert.deepEqual(readLicenseText({ settings: {}, env: {} }), { text: null })
})

test('enterpriseAccess: Cloud by its Cloud key, every self-hosted install with no key, and each state has plain words', async () => {
  const key = await sign({})
  const cloudKey = await sign({ id: 'cloud_1', licensee: 'Slatebox Cloud', kind: 'cloud', hosts: ['app.slatebox.com'] })
  const pick = ({ unlocked, via, reason }) => ({ unlocked, via, reason })
  const cloudAt = (baseUrl, license) => ({ public: { edition: 'cloud', baseUrl }, enterprise: license ? { license } : undefined })
  assert.deepEqual(pick(enterpriseAccess({ settings: cloudAt('https://app.slatebox.com', cloudKey), keys, now: at('2027-01-01') })), { unlocked: true, via: 'cloud', reason: 'cloud' })
  assert.deepEqual(pick(enterpriseAccess({ settings: cloudAt('https://app.slatebox.com', cloudKey), keys, now: at('2027-12-05') })), { unlocked: true, via: 'cloud', reason: 'grace' })
  // The setting alone, an on-prem key, a Cloud key on another host or an unbound Cloud key: locked.
  assert.deepEqual(pick(enterpriseAccess({ settings: { public: { edition: 'cloud' } }, env: {} })), { unlocked: false, via: null, reason: 'cloud_no_key' })
  assert.equal(enterpriseAccess({ settings: cloudAt('https://app.slatebox.com', key), keys, now: at('2027-01-01') }).reason, 'wrong_kind')
  assert.equal(enterpriseAccess({ settings: cloudAt('https://slatebox.example.com', cloudKey), keys, now: at('2027-01-01') }).reason, 'wrong_host')
  assert.equal(enterpriseAccess({ settings: cloudAt('https://app.slatebox.com', await sign({ kind: 'cloud' })), keys, now: at('2027-01-01') }).reason, 'wrong_kind')
  // A Cloud key on a self-hosted install does not make it Cloud (payments stay off: cloud-lock.mjs).
  assert.deepEqual(pick(enterpriseAccess({ settings: { public: { edition: 'self-host', baseUrl: 'https://app.slatebox.com' }, enterprise: { license: cloudKey } }, keys, now: at('2027-01-01') })), { unlocked: true, via: 'self-host', reason: 'self_host' })
  assert.equal(enterpriseAccess({ settings: cloudAt('https://app.slatebox.com', await sign({ kind: 'trial', hosts: ['app.slatebox.com'] })), keys, now: at('2027-01-01') }).reason, 'wrong_kind')
  // Free (owner, 2026-11-26): every self-hosted install runs it with no key, and no key, file or
  // date can lock it: none is even read.
  const selfHosted = [
    { settings: { public: { edition: 'self-host' } }, env: {} },
    { settings: {}, env: {} },
    { settings: { public: { edition: 'self-host', baseUrl: 'https://slatebox.example.com' }, enterprise: { license: key } }, keys, now: at('2099-01-01') },
    { settings: { public: { edition: 'self-host' }, enterprise: { license: 'garbled' } }, env: { SLATEBOX_LICENSE_FILE: '/nope' }, readFile: () => { throw new Error('read') } },
  ]
  for (const options of selfHosted) {
    const on = enterpriseAccess(options)
    assert.deepEqual(pick(on), { unlocked: true, via: 'self-host', reason: 'self_host' })
    assert.equal(on.license, null)
    assert.match(on.words, /free on every self-hosted install/)
  }
  assert.equal(LICENSE_WORDS.no_license, undefined, 'no self-hosted state asks for a license')
  // Exactly the states enterpriseAccess produces (a valid Cloud key reads 'cloud', never verifyLicense's 'license').
  const states = ['self_host', 'cloud', 'cloud_no_key', 'wrong_kind', 'grace', 'malformed', 'unknown_key', 'bad_signature', 'wrong_product', 'not_yet', 'expired', 'wrong_host', 'unreadable_file']
  assert.deepEqual(Object.keys(LICENSE_WORDS).sort(), [...states].sort())
  for (const reason of states) assert.ok(LICENSE_WORDS[reason], reason)
  // The words never name a price.
  for (const words of Object.values(LICENSE_WORDS)) assert.doesNotMatch(words, /\$|USD|per year|\d+\s*(dollars|a year)/i)
})

test('Admin tools › Integrations: on with no key on a self-hosted install, off only without the code or by the switch; nothing to buy', async () => {
  const { enterpriseStatusFor, STATUS_WORDS } = await import('../web/app/server/enterprise-status.mjs')
  const selfHost = { public: { edition: 'self-host' } }
  const on = enterpriseStatusFor({ settings: selfHost, running: { loaded: true, features: ['agents.invite'], access: { via: 'self-host' } } })
  assert.deepEqual(on, { edition: 'self-host', on: true, reason: 'on', words: STATUS_WORDS.on })
  const bare = enterpriseStatusFor({ settings: selfHost, running: { loaded: false, reason: 'missing' } })
  assert.deepEqual([bare.on, bare.reason], [false, 'not_in_build'])
  assert.equal(enterpriseStatusFor({ settings: selfHost, running: { loaded: false, reason: 'stub' } }).reason, 'not_in_build')
  const off = enterpriseStatusFor({ settings: selfHost, running: { loaded: true, features: [] } })
  assert.deepEqual([off.on, off.reason], [false, 'switched_off'])
  assert.equal(enterpriseStatusFor({ settings: { public: { edition: 'cloud' } }, running: { loaded: true, features: ['agents.invite'] } }).edition, 'cloud')
  // No license, trial, upgrade, price or payment words anywhere in what an administrator reads.
  for (const words of Object.values(STATUS_WORDS)) assert.doesNotMatch(words, /licen[cs]e|trial|upgrade|unlock|\$|price|pay|Pro\b/i)
  const page = readFileSync(new URL('../web/app/imports/ui/pages/admin/IntegrationsStatus.jsx', import.meta.url), 'utf8')
  assert.match(page, /enterprise\.status/)
  assert.doesNotMatch(page, /licen[cs]e|trial|Upgrade|unlock|\$|price|Pro\b/i)
})

test('license-sign: every key names the installs it covers; a Cloud key is signed the same way', async () => {
  const { spawnSync } = await import('node:child_process')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'sblic-'))
  try {
    const pem = join(dir, 'test.private.pem')
    writeFileSync(pem, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    const run = (...args) => spawnSync(process.execPath, ['scripts/license-sign.mjs', '--key', pem, '--kid', 'test-key', '--licensee', 'Example Co', '--id', 'lic_9', '--from', '2026-12-01', ...args], { encoding: 'utf8' })
    const unbound = run()
    assert.notEqual(unbound.status, 0)
    assert.match(unbound.stderr, /--host is needed/)
    assert.notEqual(run('--host', 'a.example.com', '--kind', 'trial').status, 0)
    const onPrem = run('--host', 'Slatebox.Example.com')
    assert.equal(onPrem.status, 0, onPrem.stderr)
    const checked = verifyLicense(onPrem.stdout.trim(), { keys, now: at('2027-01-01'), host: 'slatebox.example.com' })
    assert.equal(checked.valid, true)
    assert.deepEqual([checked.license.kind, checked.license.hosts], ['on-prem', ['slatebox.example.com']])
    const cloudKey = run('--host', 'app.slatebox.com', '--kind', 'cloud')
    assert.equal(cloudKey.status, 0, cloudKey.stderr)
    const settings = { public: { edition: 'cloud', baseUrl: 'https://app.slatebox.com' }, enterprise: { license: cloudKey.stdout.trim() } }
    assert.equal(enterpriseAccess({ settings, keys, now: at('2027-01-01') }).via, 'cloud')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
