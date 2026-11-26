// Slatebox Cloud's enterprise license keys for self-hosted servers (web/app/server/licenses) and
// the device sign-in a server uses for them (client 'slatebox-server'):
// - a trial is bound to the asking host, on-prem, trial: true, trialDays long, no grace days, and
//   checks offline;
// - the host must prove it is the asker (a one-time proof Cloud fetches back from https://<host>):
//   an unproven ask gets nothing and records nothing, so a stranger cannot use up a host's trial;
//   bare names and localhost get no trial at all; Cloud's fetch never reaches a private address;
// - the same account and host get the same key again; one trial per account, one per public host;
// - a license Slatebox recorded for the account comes first; ten asks an hour; every issue audited;
// - the route takes only a license:trial device token bound to /licenses (never a move token or a
//   personal token), answers 404 where Cloud has no signing key, and tells /device what came of it;
// - the 'slatebox-server' client: its license token works nowhere else; its move purpose is the same
//   one-hour, move-only sign-in the CLI has.
// Run: node --test scripts/license-issuer.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import express from 'express'
import { cleanHost, createLicenseIssuer, licenseIssuerConfigured, trialDaysFrom, TRIAL_DAYS } from '../web/app/server/licenses/issuer.mjs'
import { mountLicenseRoutes } from '../web/app/server/licenses/routes.mjs'
import { cleanProof, createHostProver, createProofStore, privateAddress, PROOF_PATH, publicGet } from '../web/app/server/licenses/host-proof.mjs'
import { LICENSE_GRACE_DAYS, signLicense, verifyLicense } from '../web/app/server/enterprise-license.mjs'
import { createDeviceFlow, DEVICE_CLIENTS, LICENSE_SCOPE, MOVE_RESOURCE_PATH, MOVE_SCOPES, memoryWindowCounter } from '../web/app/server/oauth/device.mjs'
import { API_TOKEN_SCOPES, createApiTokenService } from '../web/app/server/api-token-core.mjs'
import { memoryCollection } from './team-export-store.mjs'
import { meteorView, startFakeCloud, testSigner } from './fake-slatebox-cloud.mjs'

const signer = testSigner()
const day = (iso) => Date.parse(iso + 'T12:00:00Z')

// Hosts that answer a proof here: host -> the proof store of the install really at that host.
function issuerWorld({ now = () => day('2026-11-25'), trialDays } = {}) {
  const licenses = memoryCollection('licenses')
  const audit = []
  const installs = new Map()
  let n = 0
  // The real prover's check, with each host's answer coming from the install's own store.
  const prover = createHostProver({
    originFor: (host) => `test://${host}`,
    get: async (url) => {
      const { host, pathname } = new URL(url.replace('test://', 'http://'))
      const store = installs.get(host)
      if (!store) throw new Error('ENOTFOUND')
      const secret = store.answer(pathname.slice(PROOF_PATH.length))
      return secret ? { status: 200, text: secret } : { status: 404, text: '' }
    },
  })
  // An install at a host: makes the proofs it answers there.
  const at = (host) => {
    if (!installs.has(host)) installs.set(host, createProofStore())
    return installs.get(host)
  }
  const issuer = createLicenseIssuer({
    licenses,
    sign: (payload) => signLicense(payload, { kid: signer.kid, privateKey: signer.privateKey }),
    counter: memoryWindowCounter({ now }),
    prover,
    ...(trialDays && { trialDays }),
    audit: (entry) => audit.push(entry),
    now,
    newId: () => String(++n),
  })
  // An ask from the install really at `host` (a proof it answers there).
  const ask = (fields) => issuer.issue({ ...fields, proof: at(cleanHost(fields.host) || fields.host).make() })
  return { issuer, licenses, audit, ask, at }
}

test('settings: Cloud offers keys only with its signing key; trial days are owner-adjustable', () => {
  assert.equal(licenseIssuerConfigured({}), false)
  assert.equal(licenseIssuerConfigured({ licenses: { signer: { kid: 'k' } } }), false)
  assert.equal(licenseIssuerConfigured({ licenses: { signer: { kid: 'k', privateKey: '-----BEGIN PRIVATE KEY-----' } } }), true)
  assert.equal(TRIAL_DAYS, 30)
  assert.equal(trialDaysFrom({}), 30)
  assert.equal(trialDaysFrom({ licenses: { trialDays: 14 } }), 14)
  for (const bad of [0, -3, 400, 2.5, '30']) assert.equal(trialDaysFrom({ licenses: { trialDays: bad } }), 30)
  assert.equal(cleanHost(' Boards.Acme.Test. '), 'boards.acme.test')
  for (const bad of ['', 'http://x.com', 'a b', '-x.com', null, 'x'.repeat(300)]) assert.equal(cleanHost(bad), null, String(bad))
})

test('a trial: host-bound, on-prem, trialDays long, checks offline; asked again, the same key', async () => {
  const w = issuerWorld({ trialDays: 14 })
  const first = await w.ask({ userId: 'ada', email: 'ada@acme.test', host: 'boards.acme.test', installId: 'i1' })
  assert.deepEqual([first.trial, first.hosts, first.again], [true, ['boards.acme.test'], false])
  const checked = verifyLicense(first.key, { keys: signer.keys, host: 'boards.acme.test', now: day('2026-11-25') })
  assert.deepEqual([checked.valid, checked.license.kind, checked.license.trial, checked.license.licensee], [true, 'on-prem', true, 'ada@acme.test'])
  assert.deepEqual([checked.license.issuedAt, checked.license.expiresAt], ['2026-11-25', '2026-12-08'])
  assert.equal(verifyLicense(first.key, { keys: signer.keys, host: 'other.acme.test', now: day('2026-11-25') }).reason, 'wrong_host')
  const again = await w.issuer.issue({ userId: 'ada', host: 'BOARDS.acme.test' })
  assert.deepEqual([again.key, again.again], [first.key, true])
  assert.equal(w.licenses.docs().length, 1)
  assert.deepEqual(w.audit.map((row) => row.type), ['license-trial-issued', 'license-trial-again'])
})

test('one trial per account and per public host; a purchased license comes first; ten asks an hour', async () => {
  let clock = day('2026-11-25')
  const w = issuerWorld({ now: () => clock })
  await w.ask({ userId: 'ada', host: 'boards.acme.test' })
  await assert.rejects(w.ask({ userId: 'ada', host: 'second.acme.test' }), { code: 'trial_used', status: 409 })
  await assert.rejects(w.ask({ userId: 'bea', host: 'boards.acme.test' }), { code: 'trial_used_host', status: 409 })
  // "localhost" and bare intranet names may be anyone's: no trial there at all (a license works offline).
  for (const host of ['localhost', 'slatebox', 'roscoe.localhost'])
    await assert.rejects(w.ask({ userId: 'cat', host }), (error) => error.code === 'trial_needs_public_host' && /license key works on any install/.test(error.message), host)
  assert.equal(w.licenses.docs().length, 1)
  // After the trial ends, it is not issued again for that host.
  clock = day('2027-02-01')
  await assert.rejects(w.ask({ userId: 'ada', host: 'boards.acme.test' }), (error) => error.code === 'trial_used' && /ended/.test(error.message))
  // A license Slatebox recorded for the account (a purchase on slatebox.com) answers first.
  const bought = await signLicense({ id: 'lic_ada', licensee: 'Acme', issuedAt: '2027-01-01', expiresAt: '2027-12-31', hosts: ['boards.acme.test'] }, { kid: signer.kid, privateKey: signer.privateKey })
  await w.licenses.insertOne({ _id: 'lic_ada', userId: 'ada', source: 'purchase', key: bought, hosts: ['boards.acme.test'], expiresAt: '2027-12-31', revokedAt: null })
  const fetched = await w.issuer.issue({ userId: 'ada', host: 'boards.acme.test' })
  assert.deepEqual([fetched.key, fetched.trial, fetched.licenseId], [bought, false, 'lic_ada'])
  // Ten asks an hour per account.
  const r = issuerWorld()
  for (let i = 0; i < 10; i += 1) await r.ask({ userId: 'dan', host: 'dan.example.com' })
  await assert.rejects(r.ask({ userId: 'dan', host: 'dan.example.com' }), (error) => error.code === 'rate_limited' && error.status === 429 && error.retryAfter > 0)
  await assert.rejects(r.issuer.issue({ userId: 'eve', host: 'not a host' }), { code: 'invalid_request' })
})

test("a trial's host must prove it is the asker: a stranger's ask gets nothing and uses up nothing", async () => {
  const w = issuerWorld()
  // Mallory's own install is not at roscoe.slatebox.team: the proof it makes is not answered there.
  const mallory = createProofStore()
  w.at('roscoe.slatebox.team')
  await assert.rejects(w.issuer.issue({ userId: 'mallory', host: 'roscoe.slatebox.team', proof: mallory.make() }), (error) => error.code === 'host_unproven' && error.status === 403 && /did not confirm/.test(error.message))
  // No proof at all, a malformed one, or a host nobody answers at: refused the same way.
  await assert.rejects(w.issuer.issue({ userId: 'mallory', host: 'roscoe.slatebox.team' }), { code: 'host_unproven' })
  await assert.rejects(w.issuer.issue({ userId: 'mallory', host: 'roscoe.slatebox.team', proof: { id: 'x', secret: 'y' } }), { code: 'host_unproven' })
  await assert.rejects(w.issuer.issue({ userId: 'mallory', host: 'acme.com', proof: mallory.make() }), (error) => error.code === 'host_unproven' && /could not reach https:\/\/acme\.com/.test(error.message))
  assert.equal(w.licenses.docs().length, 0, 'nothing kept for an unproven host')
  // So the real owner's Unlock still gets the host's one trial, and Mallory's account keeps its own.
  const owner = await w.ask({ userId: 'tim', email: 'tim@slatebox.test', host: 'roscoe.slatebox.team' })
  assert.deepEqual([owner.trial, owner.hosts], [true, ['roscoe.slatebox.team']])
  assert.equal(verifyLicense(owner.key, { keys: signer.keys, host: 'roscoe.slatebox.team', now: day('2026-11-25') }).license.licensee, 'tim@slatebox.test')
  assert.equal((await w.ask({ userId: 'mallory', host: 'mallory.example.net' })).trial, true)
  assert.ok(w.audit.some((row) => row.reason === 'host_mismatch') && w.audit.some((row) => row.reason === 'host_unreachable'))
})

test('a trial has no grace days; a bought license keeps its fourteen', async () => {
  const w = issuerWorld({ trialDays: 30 })
  const trial = await w.ask({ userId: 'ada', host: 'boards.acme.test' })
  const check = (key, iso) => verifyLicense(key, { keys: signer.keys, host: 'boards.acme.test', now: day(iso) })
  assert.equal(check(trial.key, '2026-12-24').reason, 'license', 'its 30th day')
  assert.equal(check(trial.key, '2026-12-25').reason, 'expired', 'off the day after: 30 days, not 44')
  const bought = await signLicense({ id: 'lic', licensee: 'Acme', issuedAt: '2026-01-01', expiresAt: '2026-12-24', hosts: ['boards.acme.test'] }, { kid: signer.kid, privateKey: signer.privateKey })
  assert.equal(LICENSE_GRACE_DAYS, 14)
  assert.equal(check(bought, '2026-12-25').reason, 'grace')
  assert.equal(check(bought, '2027-01-08').reason, 'expired')
})

test("Cloud's host check: the proof store, and never a private address", async () => {
  let clock = 0
  const store = createProofStore({ now: () => clock })
  const proof = store.make()
  assert.deepEqual(cleanProof(proof), proof)
  assert.equal(store.answer(proof.id), proof.secret)
  assert.equal(store.answer('nope'), null)
  clock += 11 * 60_000
  assert.equal(store.answer(proof.id), null, 'ten minutes, then gone')
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', 'not-an-ip'])
    assert.equal(privateAddress(ip), true, ip)
  for (const ip of ['104.16.1.1', '8.8.8.8', '2606:4700::1111']) assert.equal(privateAddress(ip), false, ip)
  // The real fetch refuses a name that resolves to this computer, before sending anything.
  await assert.rejects(publicGet(`https://localhost${PROOF_PATH}abc`), (error) => error.code === 'EPRIVATE')
  const prover = createHostProver()
  assert.deepEqual(await prover.prove('localhost', store.make()), { ok: false, why: 'unreachable' })
})

test('the slatebox-server client: a license token works only on /licenses, its move sign-in is the CLI\'s', async () => {
  const docs = (name) => meteorView(memoryCollection(name))
  const grants = docs('grants')
  const apiTokens = docs('tokens')
  const users = docs('users')
  await users.insertAsync({ _id: 'ada' })
  const device = createDeviceFlow({ grants, apiTokens, users, origin: 'https://app.slatebox.com', counter: memoryWindowCounter(), enabled: () => true })
  assert.equal(DEVICE_CLIENTS['slatebox-server'].name, 'Your Slatebox server')
  assert.ok(!API_TOKEN_SCOPES.includes(LICENSE_SCOPE), 'no personal token, MCP tool or exec call carries it')
  assert.equal(device.resourceFor('slatebox-server'), 'https://app.slatebox.com/licenses')
  assert.equal(device.resourceFor('slatebox-server', 'move'), 'https://app.slatebox.com' + MOVE_RESOURCE_PATH)
  await assert.rejects(device.authorize({ clientId: 'slatebox-server', scope: `${LICENSE_SCOPE} team:move` }), { error: 'invalid_scope' })
  const asked = await device.authorize({ clientId: 'slatebox-server', scope: LICENSE_SCOPE, label: 'boards.acme.test' })
  const shown = await device.describe({ userCode: asked.user_code, user: { _id: 'ada' } })
  assert.equal(shown.client, 'Your Slatebox server')
  assert.equal(shown.title, 'Unlock enterprise features')
  assert.match(shown.grants[0], /license key/)
  const decided = await device.decide({ userCode: asked.user_code, user: { _id: 'ada' }, allow: true })
  assert.ok(decided.grant, 'the page follows what came of it')
  const token = await device.poll({ clientId: 'slatebox-server', deviceCode: asked.device_code })
  assert.deepEqual([token.scope, token.expires_in], [LICENSE_SCOPE, 900])
  const tokens = createApiTokenService({ apiTokens, users, slates: docs('slates'), slateAccess: docs('access') })
  const req = { headers: { authorization: `Bearer ${token.access_token}` } }
  assert.equal((await tokens.authenticateApiRequest(req, { audience: 'https://app.slatebox.com/licenses' })).account._id, 'ada')
  assert.equal(await tokens.authenticateApiRequest(req, { audience: 'https://app.slatebox.com' + MOVE_RESOURCE_PATH }), null, 'not a move')
  assert.equal(await tokens.authenticateApiRequest(req, { audience: 'https://app.slatebox.com/mcp' }), null, 'not /mcp')
  assert.equal(await tokens.authenticateApiRequest(req), null, 'not /api/v1')
  // Its move purpose: the same scopes, one hour, bound to the move resource.
  const move = await device.authorize({ clientId: 'slatebox-server', scope: MOVE_SCOPES.join(' ') })
  await device.decide({ userCode: move.user_code, user: { _id: 'ada' }, allow: true })
  const moveToken = await device.poll({ clientId: 'slatebox-server', deviceCode: move.device_code })
  assert.equal(moveToken.expires_in, 3600)
})

test('POST /licenses/key and GET /licenses/offer: device token only, host proven, 404 off Cloud, refusals in words, the consent page told', async (t) => {
  const cloud = await startFakeCloud({ signer, trialDays: 21 })
  t.after(() => cloud.close())
  // The install at boards.acme.test answers its proofs there (a local port standing in for it).
  const proofs = createProofStore()
  const proofApp = express()
  proofApp.get(`${PROOF_PATH}:id`, proofs.handler())
  const proofServer = await new Promise((resolve) => {
    const s = proofApp.listen(0, '127.0.0.1', () => resolve(s))
  })
  t.after(() => proofServer.close())
  cloud.hostOrigins['boards.acme.test'] = `http://127.0.0.1:${proofServer.address().port}`
  // Whether Cloud issues trials, and how long: no sign-in needed.
  const offer = await fetch(cloud.origin + '/licenses/offer')
  assert.deepEqual([offer.status, await offer.json()], [200, { trial: true, trialDays: 21 }])
  const ask = async (token, body = { host: 'boards.acme.test', proof: proofs.make() }) => fetch(cloud.origin + '/licenses/key', { method: 'POST', headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) })
  assert.equal((await ask(null)).status, 401)
  const signIn = async (scope) => {
    const form = (body) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
    const grant = await (await fetch(cloud.origin + '/oauth/device_authorization', form({ client_id: 'slatebox-server', scope }))).json()
    await cloud.approve(grant.user_code)
    return (await (await fetch(cloud.origin + '/oauth/token', form({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: 'slatebox-server', device_code: grant.device_code }))).json()).access_token
  }
  const moveToken = await signIn(MOVE_SCOPES.join(' '))
  assert.equal((await ask(moveToken)).status, 401, 'a move sign-in gets no license')
  const token = await signIn(LICENSE_SCOPE)
  // The right host, but a proof that host never made: refused, and nothing kept for it.
  const unproven = await ask(token, { host: 'boards.acme.test', proof: createProofStore().make() })
  assert.equal(unproven.status, 403)
  assert.equal((await unproven.json()).error.code, 'host_unproven')
  assert.equal(cloud.licenses.docs().length, 0)
  const answer = await ask(token)
  assert.equal(answer.status, 200)
  assert.equal(answer.headers.get('cache-control'), 'no-store')
  const body = await answer.json()
  assert.deepEqual([body.trial, body.hosts], [true, ['boards.acme.test']])
  assert.equal(verifyLicense(body.key, { keys: signer.keys, host: 'boards.acme.test' }).valid, true)
  assert.match(cloud.outcomes.at(-1).message, /free trial key for boards\.acme\.test/)
  const refused = await ask(token, { host: 'second.acme.test', proof: proofs.make() })
  assert.equal(refused.status, 409)
  assert.equal((await refused.json()).error.code, 'trial_used')
  assert.equal(cloud.outcomes.at(-1).ok, false)
  assert.equal((await ask(token, { host: '' })).status, 400)

  // Off Cloud (no Cloud key) or without the signing key: the same 404 as any unknown route.
  const app = express()
  mountLicenseRoutes(app, { gate: () => false, issuer: () => assert.fail('never asked'), authenticate: async () => ({ _id: 'ada' }) })
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  t.after(() => server.close())
  const off = await fetch(`http://127.0.0.1:${server.address().port}/licenses/key`, { method: 'POST', body: '{}' })
  assert.equal(off.status, 404)
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/licenses/offer`)).status, 404, 'no trials offered without the signing key')
})
