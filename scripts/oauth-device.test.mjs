// Device-code sign-in (RFC 8628) for the slatebox command: codes, polling (pending, slow_down,
// denied, expired, used once), wrong-code limits, the token it issues (sbo_, team-addresses only,
// bound to its resource, 15 minutes, no refresh token), the HTTP endpoints, and where signing in
// returns a person. Run: node --test scripts/oauth-device.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import express from 'express'
import {
  createDeviceFlow,
  DEVICE_GRANT,
  DeviceError,
  formatUserCode,
  memoryWindowCounter,
  normalizeUserCode,
  sanitizeLabel,
  teamClaimsConfigured,
  USER_CODE_ALPHABET,
} from '../web/app/server/oauth/device.mjs'
import { mountDeviceFlow } from '../web/app/server/oauth/routes.mjs'
import { API_TOKEN_SCOPES, createApiTokenService, hashApiToken } from '../web/app/server/api-token-core.mjs'
import { deviceCodeFromQuery, loginDestination, recalledLoginReturn, rememberLoginReturn } from '../web/app/imports/api/common/login-return.mjs'

const matches = (doc, selector) => Object.entries(selector).every(([key, want]) => (want === null ? doc[key] == null : doc[key] === want))
function collection() {
  const docs = []
  let n = 0
  return {
    docs,
    async insertAsync(doc) {
      const row = { _id: doc._id || `row-${(n += 1)}`, ...doc }
      docs.push(row)
      return row._id
    },
    findOneAsync: async (selector) => docs.find((doc) => matches(doc, selector)) || undefined,
    async updateAsync(selector, update) {
      const doc = docs.find((row) => matches(row, selector))
      if (!doc) return 0
      Object.assign(doc, update.$set)
      return 1
    },
    find: (selector) => ({ fetchAsync: async () => docs.filter((doc) => matches(doc, selector)) }),
  }
}

function world({ enabled = true } = {}) {
  let clock = Date.parse('2026-11-24T12:00:00Z')
  const now = () => clock
  const grants = collection()
  const apiTokens = collection()
  const users = collection()
  users.docs.push({ _id: 'ada' }, { _id: 'guest', isAnonymous: true }, { _id: 'gone', isDisabled: true })
  let on = enabled
  const device = createDeviceFlow({ grants, apiTokens, users, origin: 'https://app.slatebox.com', counter: memoryWindowCounter({ now }), enabled: () => on, now })
  return { device, grants, apiTokens, users, now, tick: (ms) => (clock += ms), setEnabled: (value) => (on = value) }
}

const code = (answer) => answer.user_code
const errorOf = async (promise) => {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof DeviceError, error?.message)
    return error.error
  }
  assert.fail('expected a refusal')
}

test('user codes are eight consonants, typed in any case or spacing', () => {
  assert.equal(USER_CODE_ALPHABET, 'BCDFGHJKLMNPQRSTVWXZ')
  assert.equal(normalizeUserCode('wdjb-mjht'), 'WDJBMJHT')
  assert.equal(normalizeUserCode(' WDJB MJHT '), 'WDJBMJHT')
  for (const bad of ['WDJB-MJHA', 'WDJB-MJH', 'WDJBMJHTX', '', null, 'AEIOUAEI']) assert.equal(normalizeUserCode(bad), null, String(bad))
  assert.equal(formatUserCode('WDJBMJHT'), 'WDJB-MJHT')
  assert.equal(sanitizeLabel('tims-mbp\u0000\n'), 'tims-mbp')
  assert.equal(sanitizeLabel('x'.repeat(100)).length, 64)
  assert.equal(teamClaimsConfigured({ cloudflare: { teamClaims: { token: 't', accountId: 'a', zoneId: 'z' } } }), true)
  assert.equal(teamClaimsConfigured({ cloudflare: { teamClaims: { token: 't' } } }), false)
  assert.equal(teamClaimsConfigured({}), false)
})

test('the whole flow: pending, approve, one token for team addresses only, used once', async () => {
  const w = world()
  const answer = await w.device.authorize({ clientId: 'slatebox-cli', scope: 'team-addresses', label: 'tims-mbp', ip: '198.51.100.4', region: 'US' })
  assert.match(answer.user_code, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/)
  assert.equal(answer.verification_uri, 'https://app.slatebox.com/device')
  assert.equal(answer.verification_uri_complete, `https://app.slatebox.com/device?code=${answer.user_code}`)
  assert.equal(answer.expires_in, 600)
  assert.equal(answer.interval, 5)
  // Only hashes are kept.
  const [grant] = w.grants.docs
  assert.ok(!JSON.stringify(grant).includes(answer.device_code))
  assert.ok(!JSON.stringify(grant).includes(answer.user_code.replace('-', '')))
  assert.ok(!JSON.stringify(grant).includes('198.51.100.4'))
  assert.equal(await errorOf(w.device.poll({ clientId: 'slatebox-cli', deviceCode: answer.device_code })), 'authorization_pending')
  const shown = await w.device.describe({ userCode: code(answer).toLowerCase(), user: { _id: 'ada' } })
  assert.deepEqual(shown.grants, ['claim and manage team addresses on your account'])
  assert.equal(shown.label, 'tims-mbp')
  assert.equal(shown.region, 'US')
  assert.match(shown.cannot, /will not be able to read or change your slates/)
  assert.deepEqual(await w.device.decide({ userCode: code(answer), user: { _id: 'ada' }, allow: true }), { status: 'approved' })
  w.tick(5000)
  const token = await w.device.poll({ clientId: 'slatebox-cli', deviceCode: answer.device_code })
  assert.match(token.access_token, /^sbo_[0-9a-f]{8}_/)
  assert.equal(token.expires_in, 900)
  assert.equal(token.scope, 'team-addresses')
  assert.equal(token.refresh_token, undefined, 'no refresh token for the install flow')
  const [row] = w.apiTokens.docs
  assert.equal(row.tokenHash, hashApiToken(token.access_token))
  assert.equal(row.resource, 'https://app.slatebox.com/api/v1/team-addresses')
  assert.deepEqual(row.scopes, ['team-addresses'])
  assert.equal(row.expiresAt, w.now() + 900_000)
  w.tick(5000)
  assert.equal(await errorOf(w.device.poll({ clientId: 'slatebox-cli', deviceCode: answer.device_code })), 'invalid_grant', 'used once')
  // The scope is never one a personal token, an MCP tool or exec can carry.
  assert.ok(!API_TOKEN_SCOPES.includes('team-addresses'))
})

test('the token works only on its own resource: never on /mcp or /api/v1 actions', async () => {
  const w = world()
  const answer = await w.device.authorize({ clientId: 'slatebox-cli' })
  await w.device.decide({ userCode: code(answer), user: { _id: 'ada' }, allow: true })
  const { access_token: accessToken } = await w.device.poll({ clientId: 'slatebox-cli', deviceCode: answer.device_code })
  const service = createApiTokenService({ apiTokens: w.apiTokens, users: w.users, slates: collection(), slateAccess: collection(), now: w.now })
  const req = { headers: { authorization: `Bearer ${accessToken}` } }
  assert.equal(await service.authenticateApiRequest(req), null, '/api/v1 actions refuse it')
  assert.equal(await service.authenticateApiRequest(req, { audience: 'https://app.slatebox.com/mcp' }), null, '/mcp refuses it')
  const found = await service.authenticateApiRequest(req, { audience: w.device.resourceFor('slatebox-cli') })
  assert.equal(found.account._id, 'ada')
  w.tick(901_000)
  assert.equal(await service.authenticateApiRequest(req, { audience: w.device.resourceFor('slatebox-cli') }), null, 'it lapses after 15 minutes')
})

test('slow_down, denied, expired, unknown clients and scopes', async () => {
  const w = world()
  const answer = await w.device.authorize({ clientId: 'slatebox-cli' })
  assert.equal(await errorOf(w.device.poll({ clientId: 'slatebox-cli', deviceCode: answer.device_code })), 'authorization_pending')
  w.tick(1000)
  assert.equal(await errorOf(w.device.poll({ clientId: 'slatebox-cli', deviceCode: answer.device_code })), 'slow_down')
  assert.equal(w.grants.docs[0].interval, 10, 'each slow_down adds five seconds')
  await w.device.decide({ userCode: code(answer), user: { _id: 'ada' }, allow: false })
  w.tick(11_000)
  assert.equal(await errorOf(w.device.poll({ clientId: 'slatebox-cli', deviceCode: answer.device_code })), 'access_denied')
  const late = await w.device.authorize({ clientId: 'slatebox-cli' })
  w.tick(601_000)
  assert.equal(await errorOf(w.device.poll({ clientId: 'slatebox-cli', deviceCode: late.device_code })), 'expired_token')
  assert.equal(await w.device.describe({ userCode: code(late), user: { _id: 'ada' } }), null)
  assert.equal(await errorOf(w.device.authorize({ clientId: 'someone-else' })), 'invalid_client')
  assert.equal(await errorOf(w.device.authorize({ clientId: 'slatebox-cli', scope: 'slates:write' })), 'invalid_scope')
  assert.equal(await errorOf(w.device.poll({ clientId: 'slatebox-cli', deviceCode: 'made-up' })), 'invalid_grant')
  // A guest or a signed-out page cannot approve; a disabled account's approval never issues.
  const another = await w.device.authorize({ clientId: 'slatebox-cli' })
  assert.equal(await errorOf(w.device.decide({ userCode: code(another), user: null, allow: true })), 'sign_in_required')
  assert.equal(await errorOf(w.device.decide({ userCode: code(another), user: { _id: 'guest', isAnonymous: true }, allow: true })), 'guest_account')
  await w.device.decide({ userCode: code(another), user: { _id: 'gone' }, allow: true })
  assert.equal(await errorOf(w.device.poll({ clientId: 'slatebox-cli', deviceCode: another.device_code })), 'invalid_grant')
})

test('five wrong codes and entering codes stops, even a right one; the address limit holds', async () => {
  const w = world()
  const answer = await w.device.authorize({ clientId: 'slatebox-cli' })
  for (let i = 0; i < 5; i += 1) assert.equal(await w.device.describe({ userCode: 'BBBB-BBBB', user: { _id: 'ada' } }), null)
  assert.equal(await errorOf(w.device.describe({ userCode: code(answer), user: { _id: 'ada' } })), 'too_many_attempts')
  assert.equal(await errorOf(w.device.decide({ userCode: code(answer), user: { _id: 'ada' }, allow: true })), 'too_many_attempts')
  const v = world()
  for (let i = 0; i < 10; i += 1) await v.device.authorize({ clientId: 'slatebox-cli', ip: '203.0.113.5' })
  assert.equal(await errorOf(v.device.authorize({ clientId: 'slatebox-cli', ip: '203.0.113.5' })), 'slow_down')
  await v.device.authorize({ clientId: 'slatebox-cli', ip: '203.0.113.6' })
})

test('switched off (no team addresses here): every device address answers 404', async () => {
  const w = world({ enabled: false })
  assert.equal(await errorOf(w.device.authorize({ clientId: 'slatebox-cli' })), 'not_found')
  const app = express()
  mountDeviceFlow(app, { express, device: w.device })
  app.use('/oauth/token', (_req, res) => res.status(400).json({ error: 'unsupported_grant_type' }))
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const form = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
  try {
    const off = await fetch(`${origin}/oauth/device_authorization`, form({ client_id: 'slatebox-cli' }))
    assert.equal(off.status, 404)
    w.setEnabled(true)
    const res = await fetch(`${origin}/oauth/device_authorization`, form({ client_id: 'slatebox-cli', scope: 'team-addresses', device_label: 'box' }))
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    const answer = await res.json()
    const pending = await fetch(`${origin}/oauth/token`, form({ grant_type: DEVICE_GRANT, client_id: 'slatebox-cli', device_code: answer.device_code }))
    assert.equal(pending.status, 400)
    assert.deepEqual(Object.keys(await pending.json()), ['error', 'error_description'])
    await w.device.decide({ userCode: answer.user_code, user: { _id: 'ada' }, allow: true })
    w.tick(6000)
    const issued = await fetch(`${origin}/oauth/token`, form({ grant_type: DEVICE_GRANT, client_id: 'slatebox-cli', device_code: answer.device_code }))
    assert.equal(issued.status, 200)
    assert.equal((await issued.json()).token_type, 'Bearer')
    // Other grants go on to the SDK's token handler.
    const other = await fetch(`${origin}/oauth/token`, form({ grant_type: 'authorization_code', code: 'x' }))
    assert.deepEqual(await other.json(), { error: 'unsupported_grant_type' })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('signing in from /device returns to /device with its code, and only that shape', () => {
  assert.equal(loginDestination(new URLSearchParams('device=wdjb-mjht')), '/device?code=WDJB-MJHT')
  assert.equal(loginDestination(new URLSearchParams('device=1')), '/device')
  assert.equal(loginDestination(new URLSearchParams('device=https://evil.example')), '/device')
  assert.equal(deviceCodeFromQuery(new URLSearchParams('code=wdjbmjht')), 'WDJB-MJHT')
  assert.equal(deviceCodeFromQuery(new URLSearchParams('code=AAAA-AAAA')), null)
  const store = new Map()
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }
  rememberLoginReturn(storage, '/device?code=WDJB-MJHT', 1000)
  assert.equal(recalledLoginReturn(storage, 2000), '/device?code=WDJB-MJHT')
  rememberLoginReturn(storage, '/device?code=WDJB-MJHT&next=//evil', 1000)
  assert.equal(recalledLoginReturn(storage, 2000), '/')
})
