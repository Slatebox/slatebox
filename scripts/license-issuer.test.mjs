// Slatebox Cloud's enterprise license keys for self-hosted servers (web/app/server/licenses) and
// the device sign-in a server uses for them (client 'slatebox-server'):
// - a trial is bound to the asking host, on-prem, trial: true, trialDays long, and checks offline;
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
import { signLicense, verifyLicense } from '../web/app/server/enterprise-license.mjs'
import { createDeviceFlow, DEVICE_CLIENTS, LICENSE_SCOPE, MOVE_RESOURCE_PATH, MOVE_SCOPES, memoryWindowCounter } from '../web/app/server/oauth/device.mjs'
import { API_TOKEN_SCOPES, createApiTokenService } from '../web/app/server/api-token-core.mjs'
import { memoryCollection } from './team-export-store.mjs'
import { meteorView, startFakeCloud, testSigner } from './fake-slatebox-cloud.mjs'

const signer = testSigner()
const day = (iso) => Date.parse(iso + 'T12:00:00Z')

function issuerWorld({ now = () => day('2026-11-25'), trialDays } = {}) {
  const licenses = memoryCollection('licenses')
  const audit = []
  let n = 0
  const issuer = createLicenseIssuer({
    licenses,
    sign: (payload) => signLicense(payload, { kid: signer.kid, privateKey: signer.privateKey }),
    counter: memoryWindowCounter({ now }),
    ...(trialDays && { trialDays }),
    audit: (entry) => audit.push(entry),
    now,
    newId: () => String(++n),
  })
  return { issuer, licenses, audit }
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
  const first = await w.issuer.issue({ userId: 'ada', email: 'ada@acme.test', host: 'boards.acme.test', installId: 'i1' })
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
  await w.issuer.issue({ userId: 'ada', host: 'boards.acme.test' })
  await assert.rejects(w.issuer.issue({ userId: 'ada', host: 'second.acme.test' }), { code: 'trial_used', status: 409 })
  await assert.rejects(w.issuer.issue({ userId: 'bea', host: 'boards.acme.test' }), { code: 'trial_used_host', status: 409 })
  // "localhost" and bare names are anyone's: each account may trial on its own.
  assert.equal((await w.issuer.issue({ userId: 'bea', host: 'localhost' })).trial, true)
  assert.equal((await w.issuer.issue({ userId: 'cat', host: 'localhost' })).trial, true)
  // After the trial ends, it is not issued again for that host.
  clock = day('2027-02-01')
  await assert.rejects(w.issuer.issue({ userId: 'ada', host: 'boards.acme.test' }), (error) => error.code === 'trial_used' && /ended/.test(error.message))
  // A license Slatebox recorded for the account (a purchase on slatebox.com) answers first.
  const bought = await signLicense({ id: 'lic_ada', licensee: 'Acme', issuedAt: '2027-01-01', expiresAt: '2027-12-31', hosts: ['boards.acme.test'] }, { kid: signer.kid, privateKey: signer.privateKey })
  await w.licenses.insertOne({ _id: 'lic_ada', userId: 'ada', source: 'purchase', key: bought, hosts: ['boards.acme.test'], expiresAt: '2027-12-31', revokedAt: null })
  const fetched = await w.issuer.issue({ userId: 'ada', host: 'boards.acme.test' })
  assert.deepEqual([fetched.key, fetched.trial, fetched.licenseId], [bought, false, 'lic_ada'])
  // Ten asks an hour per account.
  const r = issuerWorld()
  for (let i = 0; i < 10; i += 1) await r.issuer.issue({ userId: 'dan', host: 'localhost' })
  await assert.rejects(r.issuer.issue({ userId: 'dan', host: 'localhost' }), (error) => error.code === 'rate_limited' && error.status === 429 && error.retryAfter > 0)
  await assert.rejects(r.issuer.issue({ userId: 'eve', host: 'not a host' }), { code: 'invalid_request' })
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

test('POST /licenses/key: device token only, 404 off Cloud, refusals in words, the consent page told', async (t) => {
  const cloud = await startFakeCloud({ signer })
  t.after(() => cloud.close())
  const ask = async (token, body = { host: 'boards.acme.test' }) => fetch(cloud.origin + '/licenses/key', { method: 'POST', headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) })
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
  const answer = await ask(token)
  assert.equal(answer.status, 200)
  assert.equal(answer.headers.get('cache-control'), 'no-store')
  const body = await answer.json()
  assert.deepEqual([body.trial, body.hosts], [true, ['boards.acme.test']])
  assert.equal(verifyLicense(body.key, { keys: signer.keys, host: 'boards.acme.test' }).valid, true)
  assert.match(cloud.outcomes.at(-1).message, /free trial key for boards\.acme\.test/)
  const refused = await ask(token, { host: 'second.acme.test' })
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
})
