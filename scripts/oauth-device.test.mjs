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
  MOVE_ACTIONS,
  MOVE_SCOPES,
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

function world({ enabled = true, offered = null } = {}) {
  let clock = Date.parse('2026-11-24T12:00:00Z')
  const now = () => clock
  const grants = collection()
  const apiTokens = collection()
  const users = collection()
  users.docs.push({ _id: 'ada' }, { _id: 'guest', isAnonymous: true }, { _id: 'gone', isDisabled: true })
  let on = enabled
  const device = createDeviceFlow({ grants, apiTokens, users, origin: 'https://app.slatebox.com', counter: memoryWindowCounter({ now }), enabled: (purpose) => on && (!offered || offered.includes(purpose)), now })
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
  // A team-address sign-in names its grant, so /device can follow what the command did with it.
  assert.deepEqual(await w.device.decide({ userCode: code(answer), user: { _id: 'ada' }, allow: true }), { status: 'approved', grant: grant._id })
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

test('a move signs in for team:export and team:move: consent says "move your team", the token lasts an hour and is bound to the move resource', async () => {
  const w = world()
  assert.deepEqual([...MOVE_SCOPES], ['team:export', 'team:move'])
  const answer = await w.device.authorize({ clientId: 'slatebox-cli', scope: 'team:export team:move', label: 'tims-mbp' })
  const shown = await w.device.describe({ userCode: code(answer), user: { _id: 'ada' } })
  assert.equal(shown.title, 'Move your team')
  assert.equal(shown.grants.length, 2)
  for (const grant of shown.grants) assert.match(grant, /^move your team: /)
  assert.match(shown.cannot, /nothing else/)
  await w.device.decide({ userCode: code(answer), user: { _id: 'ada' }, allow: true })
  const token = await w.device.poll({ clientId: 'slatebox-cli', deviceCode: answer.device_code })
  assert.deepEqual([token.expires_in, token.scope, token.refresh_token], [3600, 'team:export team:move', undefined])
  const row = w.apiTokens.docs.at(-1)
  assert.equal(row.resource, 'https://app.slatebox.com/api/v1/team/moves')
  assert.equal(row.resource, w.device.resourceFor('slatebox-cli', 'move'))
  assert.equal(row.name, 'Slatebox installer: move your team on tims-mbp')
  // It never works where a team-address token does, nor on /mcp; /api/v1 takes it only as the move's audience.
  const service = createApiTokenService({ apiTokens: w.apiTokens, users: w.users, slates: collection(), slateAccess: collection(), now: w.now })
  const req = { headers: { authorization: `Bearer ${token.access_token}` } }
  assert.equal(await service.authenticateApiRequest(req, { audience: w.device.resourceFor('slatebox-cli') }), null, 'not on team addresses')
  assert.equal(await service.authenticateApiRequest(req, { audience: 'https://app.slatebox.com/mcp' }), null)
  assert.equal((await service.authenticateApiRequest(req, { audience: w.device.resourceFor('slatebox-cli', 'move') })).account._id, 'ada')
  assert.ok(MOVE_ACTIONS.includes('team.export') && MOVE_ACTIONS.every((id) => id === 'team.export' || id.startsWith('teamMove.')))
  w.tick(3_601_000)
  assert.equal(await service.authenticateApiRequest(req, { audience: w.device.resourceFor('slatebox-cli', 'move') }), null, 'it lapses after an hour')
})

test('one purpose at a time, and only the purposes this server offers', async () => {
  const w = world()
  assert.equal(await errorOf(w.device.authorize({ clientId: 'slatebox-cli', scope: 'team-addresses team:move' })), 'invalid_scope', 'never mixed')
  assert.equal(await errorOf(w.device.authorize({ clientId: 'slatebox-cli', scope: 'team:import' })), 'invalid_scope')
  // A team:move alone is a move too (a subset of its scopes).
  await w.device.authorize({ clientId: 'slatebox-cli', scope: 'team:move' })
  // Cloud without the claim service: moves yes, team addresses no.
  const movesOnly = world({ offered: ['move'] })
  assert.equal(await errorOf(movesOnly.device.authorize({ clientId: 'slatebox-cli', scope: 'team-addresses' })), 'invalid_scope')
  assert.equal(await errorOf(movesOnly.device.authorize({ clientId: 'slatebox-cli' })), 'invalid_scope', 'the default purpose (team addresses) is not offered')
  await movesOnly.device.authorize({ clientId: 'slatebox-cli', scope: 'team:export team:move' })
  // A self-hosted server: nothing at all.
  const none = world({ enabled: false })
  assert.equal(await errorOf(none.device.authorize({ clientId: 'slatebox-cli', scope: 'team:export team:move' })), 'not_found')
})

test('signing in from an invitation to join a moved team returns to it, and only with a well-formed token', () => {
  const token = 'A'.repeat(20) + '_-' + 'b'.repeat(21)
  assert.equal(loginDestination(new URLSearchParams(`join=${token}`)), `/team-move/join?token=${token}`)
  assert.equal(loginDestination(new URLSearchParams('join=//evil.example')), '/')
  assert.equal(loginDestination(new URLSearchParams('join=short')), '/')
  const store = new Map()
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }
  rememberLoginReturn(storage, `/team-move/join?token=${token}`, 1000)
  assert.equal(recalledLoginReturn(storage, 2000), `/team-move/join?token=${token}`)
  rememberLoginReturn(storage, `/team-move/join?token=${token}&next=//evil`, 1000)
  assert.equal(recalledLoginReturn(storage, 2000), '/')
})

// ---- the outcome after "Approve" (the published-installer end-to-end run: /device said
// "Approved" while the claim was refused for an unconfirmed email, and a reserved name said nothing)

test('/device follows a team-address sign-in to its outcome: waiting, then done or refused with the reason', async () => {
  const w = world()
  const answer = await w.device.authorize({ clientId: 'slatebox-cli', label: 'tims-mbp' })
  const decided = await w.device.decide({ userCode: code(answer), user: { _id: 'ada' }, allow: true })
  assert.match(decided.grant, /^[a-f0-9]{32}$/)
  assert.deepEqual(await w.device.outcome({ grant: decided.grant, user: { _id: 'ada' } }), { state: 'waiting' })
  // Only the person who approved it sees it; anyone else gets what an unknown grant gets.
  assert.equal(await w.device.outcome({ grant: decided.grant, user: { _id: 'sam' } }), null)
  assert.equal(await w.device.outcome({ grant: 'not-a-grant', user: { _id: 'ada' } }), null)
  assert.equal(await errorOf(w.device.outcome({ grant: decided.grant, user: null })), 'sign_in_required')
  w.tick(5000)
  await w.device.poll({ clientId: 'slatebox-cli', deviceCode: answer.device_code })
  // The claim service reports a refusal: the page shows it, with its reason, instead of "Approved".
  assert.equal(await w.device.report({ grantId: decided.grant, userId: 'sam', ok: false, code: 'unverified', message: 'x' }), false, 'never against another person\'s grant')
  assert.equal(await w.device.report({ grantId: decided.grant, userId: 'ada', ok: false, code: 'unverified', message: 'Confirm your email address before you claim a team address.' }), true)
  assert.deepEqual(await w.device.outcome({ grant: decided.grant, user: { _id: 'ada' } }), { state: 'refused', message: 'Confirm your email address before you claim a team address.', code: 'unverified' })
  await w.device.report({ grantId: decided.grant, userId: 'ada', ok: false, code: 'unavailable', reason: 'reserved', message: 'e2e-1.slatebox.team is reserved.\u0000<b>' })
  assert.deepEqual(await w.device.outcome({ grant: decided.grant, user: { _id: 'ada' } }), { state: 'refused', message: 'e2e-1.slatebox.team is reserved. <b>', code: 'unavailable', reason: 'reserved' })
  await w.device.report({ grantId: decided.grant, userId: 'ada', ok: true, message: 'Claimed acme.slatebox.team.' })
  assert.deepEqual(await w.device.outcome({ grant: decided.grant, user: { _id: 'ada' } }), { state: 'done', message: 'Claimed acme.slatebox.team.', code: null })
})

test('a denied or still-pending sign-in takes no outcome, a move names no grant, and a silent one stops waiting', async () => {
  const w = world()
  const denied = await w.device.authorize({ clientId: 'slatebox-cli' })
  assert.deepEqual(await w.device.decide({ userCode: code(denied), user: { _id: 'ada' }, allow: false }), { status: 'denied' })
  const deniedGrant = w.grants.docs[0]._id
  assert.equal(await w.device.report({ grantId: deniedGrant, userId: 'ada', ok: true, message: 'x' }), false)
  const move = await w.device.authorize({ clientId: 'slatebox-cli', scope: 'team:export team:move' })
  assert.deepEqual(await w.device.decide({ userCode: code(move), user: { _id: 'ada' }, allow: true }), { status: 'approved' })
  const quiet = await w.device.authorize({ clientId: 'slatebox-cli' })
  const decided = await w.device.decide({ userCode: code(quiet), user: { _id: 'ada' }, allow: true })
  w.tick(11 * 60 * 1000)
  assert.deepEqual(await w.device.outcome({ grant: decided.grant, user: { _id: 'ada' } }), { state: 'unknown' })
})

test('/device shows the refusal and its reason instead of "Approved", and asks for the outcome only after approving', async () => {
  const { readFile } = await import('node:fs/promises')
  const page = await readFile(new URL('../web/app/imports/ui/pages/DeviceSignIn.jsx', import.meta.url), 'utf8')
  const constants = await readFile(new URL('../web/app/imports/api/common/constants.js', import.meta.url), 'utf8')
  const wiring = await readFile(new URL('../web/app/server/oauth/meteor.js', import.meta.url), 'utf8')
  assert.match(constants, /deviceOutcome: 'oauth\.deviceOutcome'/)
  assert.match(wiring, /\[CONSTANTS\.methods\.oauth\.deviceOutcome\]\(\{ grant \}\)/)
  assert.match(page, /CONSTANTS\.methods\.oauth\.deviceOutcome, \{ grant: outcome\.grant \}/)
  assert.match(page, /if \(allow && decided\?\.grant\) setOutcome/)
  // Refused: its own title, the service's message, never the "Approved" section.
  const refused = page.slice(page.indexOf("outcome?.state === 'refused'"), page.indexOf("outcome?.state === 'done'"))
  assert.match(refused, /title="Not done"/)
  assert.match(refused, /\{outcome\.message \|\|/)
  assert.doesNotMatch(refused, /Approved/)
  assert.ok(page.indexOf("outcome?.state === 'refused'") < page.indexOf("title={done === 'approved' ? 'Approved'"), 'the refusal is checked before the plain Approved')
})
