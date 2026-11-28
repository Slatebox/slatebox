// The Linear vendor for recipes: the webhook (Linear-Signature over the raw body, a timestamp within
// a minute, each delivery once, the answer at once and the work after), "OAuthApp revoked", the
// fixed GraphQL reads against a faked Linear (paging, a 401 renewed once, rate limits, partial
// answers, the run's budget) and the two writes with their hard limits.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-linear-vendor.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { freshDelivery, linearSignature, verifyLinearSignature } from '../enterprise/server/recipes/vendors/linear/verify.mjs'
import { checkLinearHardLimits, createVendor, triggerOf, LINEAR_EVENTS_PATH } from '../enterprise/server/recipes/vendors/linear/index.mjs'
import { createLinearRecipeSession, issuesQuery } from '../enterprise/server/recipes/vendors/linear/session.mjs'
import { linearVendorFactory } from '../enterprise/server/recipes/vendors/linear/factory.mjs'
import { ORG, P, TEAMS, STATE_IDS, NOW } from '../enterprise/recipes/_linear/fixtures/acme.mjs'
import { fakeLinear } from './fakes/linear-api.mjs'
import { isRawBodyPath } from '../web/app/server/raw-body-paths.mjs'

const SECRET = 'lin_wh_test_0123456789'
const ISSUE_ID = '00000000-0000-4000-8000-000000007000'

function budgetOf(limit = 100) {
  let used = 0
  return { take: (_kind, n) => (used + n <= limit ? ((used += n), true) : false), used: () => used }
}

function rig({ now = NOW, account = { status: 'active', organizationId: ORG }, fake = fakeLinear(), clientId = 'cid' } = {}) {
  const triggered = []
  const paused = []
  const revoked = []
  const claimed = new Set()
  const tokens = []
  const vendor = createVendor({
    accountOf: async () => account,
    tokenFor: async (_userId, { force }) => {
      tokens.push(force)
      return force ? 'tok-renewed' : 'tok-1'
    },
    fetch: fake.fetch,
    signingSecret: async () => SECRET,
    clientId: async () => clientId,
    deliveries: { claim: async (id) => (claimed.has(id) ? false : (claimed.add(id), true)) },
    revokedFor: async (org) => revoked.push(org),
    now: () => now,
    later: (fn) => fn(),
  })
  const hooks = { trigger: async (match, t) => triggered.push({ match, t, selector: vendor.matchInstances(match) }), pause: async (match, state) => paused.push({ match, state, selector: vendor.matchInstances(match) }) }
  return { vendor, fake, triggered, paused, revoked, tokens, hooks }
}

function request(body, { secret = SECRET, delivery = 'd-1', signature = null } = {}) {
  const raw = Buffer.from(JSON.stringify(body))
  const headers = { 'linear-signature': signature ?? linearSignature(secret, raw), 'linear-delivery': delivery, 'linear-event': body.type }
  const res = { code: null, status(c) { this.code = c; return this }, end() { return this } }
  return { req: { headers, rawBody: raw }, res, raw }
}
const deliver = async (r, body, opts) => {
  const { req, res, raw } = request(body, opts)
  await r.vendor.routes()[0].handler(req, res, { ...r.hooks, rawBody: raw })
  return res.code
}

const projectEvent = (over = {}) => ({ action: 'update', type: 'Project', organizationId: ORG, webhookTimestamp: NOW - 2000, data: { id: P.p1, teamIds: [TEAMS.WEB.id], targetDate: '2026-12-28' }, updatedFrom: { targetDate: '2026-12-19' }, ...over })

test('the signature is hex HMAC-SHA256 of the raw body under the app\'s signing secret', () => {
  const raw = Buffer.from('{"a":1}')
  assert.ok(verifyLinearSignature({ secret: SECRET, signature: linearSignature(SECRET, raw), raw }))
  assert.ok(!verifyLinearSignature({ secret: SECRET, signature: linearSignature('another-secret-1', raw), raw }))
  assert.ok(!verifyLinearSignature({ secret: SECRET, signature: linearSignature(SECRET, Buffer.from('{"a":2}')), raw }))
  assert.ok(!verifyLinearSignature({ secret: SECRET, signature: 'zz', raw }))
  assert.ok(!verifyLinearSignature({ secret: '', signature: linearSignature('', raw), raw }), 'no secret set: nothing is Linear\'s')
  assert.ok(freshDelivery({ webhookTimestamp: NOW - 59000 }, NOW))
  assert.ok(!freshDelivery({ webhookTimestamp: NOW - 61000 }, NOW))
  assert.ok(!freshDelivery({}, NOW))
})

test('the webhook route reads its raw body, signed by Linear', () => {
  assert.equal(LINEAR_EVENTS_PATH, '/integrations/linear/events')
  assert.ok(isRawBodyPath(LINEAR_EVENTS_PATH))
  assert.deepEqual(linearVendorFactory.routes(), [{ method: 'POST', path: LINEAR_EVENTS_PATH, raw: true, vendor: 'linear' }])
})

test('a bad Linear-Signature, or a timestamp older than 60 s, gives a 401 and no run', async () => {
  const r = rig()
  assert.equal(await deliver(r, projectEvent(), { secret: 'not-the-secret-123' }), 401)
  assert.equal(await deliver(r, projectEvent({ webhookTimestamp: NOW - 61000 }), { delivery: 'd-2' }), 401)
  assert.equal(r.triggered.length, 0)
})

test('a signed Project event triggers the workspace\'s recipes for that team, once per delivery', async () => {
  const r = rig()
  assert.equal(await deliver(r, projectEvent()), 200)
  assert.equal(await deliver(r, projectEvent()), 200, 'a redelivery is answered')
  assert.equal(r.triggered.length, 1, 'and handled once')
  const { t, selector } = r.triggered[0]
  assert.equal(t.event, 'linear.project')
  assert.equal(t.projectId, P.p1)
  assert.deepEqual(t.changed, ['targetDate'])
  assert.ok(!JSON.stringify(t).includes('2026-12-28'), 'values stay at Linear: ids and field names only')
  assert.equal(selector['match.linear.organizationId'], ORG)
  assert.deepEqual(selector.$or[0], { 'match.linear.teams': { $in: [TEAMS.WEB.id] } })
})

test('Issue and Cycle events map to their recipe events; others are ignored', () => {
  assert.equal(triggerOf({ type: 'Issue', action: 'update', organizationId: ORG, data: { id: ISSUE_ID, teamId: TEAMS.ENG.id, identifier: 'ENG-200', cycleId: '00000000-0000-4000-8000-000000000040' } }).trigger.event, 'linear.issue')
  assert.equal(triggerOf({ type: 'Cycle', action: 'create', organizationId: ORG, data: { id: ISSUE_ID, teamId: TEAMS.ENG.id } }).trigger.event, 'linear.cycle')
  assert.equal(triggerOf({ type: 'ProjectUpdate', action: 'create', organizationId: ORG, data: { id: ISSUE_ID, projectId: P.p2 } }).trigger.projectId, P.p2)
  assert.equal(triggerOf({ type: 'Reaction', action: 'create', organizationId: ORG, data: {} }), null)
  assert.equal(triggerOf({ type: 'Issue', action: 'create', organizationId: 'not-a-uuid!', data: {} }), null)
})

test('"OAuthApp revoked" signs the workspace out and pauses its recipes; another app\'s is ignored', async () => {
  const r = rig()
  await deliver(r, { type: 'OAuthApp', action: 'revoked', organizationId: ORG, oauthClientId: 'someone-else', webhookTimestamp: NOW }, { delivery: 'r-1' })
  assert.equal(r.paused.length, 0)
  await deliver(r, { type: 'OAuthApp', action: 'revoked', organizationId: ORG, oauthClientId: 'cid', webhookTimestamp: NOW }, { delivery: 'r-2' })
  assert.deepEqual(r.revoked, [ORG])
  assert.equal(r.paused[0].state, 'needs_sign_in')
  assert.deepEqual(r.paused[0].selector, { 'match.linear.organizationId': ORG })
})

test('the session pages projects, counts every call against the budget, and keeps nothing but plain data', async () => {
  const fake = fakeLinear({ pageSize: 4 })
  const budget = budgetOf()
  const session = createLinearRecipeSession({ userId: 'u1', tokenFor: async () => 'tok', fetch: fake.fetch, budget })
  const { projects, complete } = await session.projects(Object.values(TEAMS).map((t) => t.id))
  assert.equal(projects.length, 9)
  assert.ok(complete)
  assert.equal(budget.used(), 3, '9 projects in pages of 4: three calls')
  const ledger = projects.find((p) => p.name === 'Ledger v3')
  assert.equal(ledger.milestones.length, 14)
  assert.equal(ledger.health, 'offTrack')
  assert.equal(ledger.progress, 40)
  assert.equal(ledger.lastUpdate.excerpt, 'Reconciliation bugs.')
  assert.deepEqual(ledger.teams.map((t) => t.key), ['PAY'])
  assert.ok(!('write' in session) && !('updateIssueState' in session), 'a recipe\'s session has no writes')
})

test('initiatives are read only when asked, and fall back without them when Linear refuses (user actor)', async () => {
  const fake = fakeLinear({ noInitiatives: true })
  const session = createLinearRecipeSession({ userId: 'u1', tokenFor: async () => 'tok', fetch: fake.fetch })
  const got = await session.projects([TEAMS.WEB.id], { initiatives: true })
  assert.equal(got.initiatives, false)
  assert.ok(got.projects.length > 0)
  const ok = await createLinearRecipeSession({ userId: 'u1', tokenFor: async () => 'tok', fetch: fakeLinear().fetch }).projects([TEAMS.WEB.id], { initiatives: true })
  assert.equal(ok.initiatives, true)
  assert.equal(ok.projects.find((p) => p.name === 'Checkout v2').initiatives[0].name, 'Checkout 2027')
})

test('a 401 is renewed once with a forced refresh; a second refusal asks for sign-in', async () => {
  const r = rig({ fake: fakeLinear({ unauthorizedOnce: true }) })
  const session = await r.vendor.session({ ownerId: 'u1', match: { linear: { organizationId: ORG } } })
  assert.equal((await session.teams()).length, 3)
  assert.deepEqual(r.tokens, [false, true])
  const always = { fetch: async () => ({ status: 401, ok: false, text: async () => '{}' }) }
  const s2 = createLinearRecipeSession({ userId: 'u1', tokenFor: async () => 'tok', fetch: always.fetch })
  await assert.rejects(s2.teams(), { name: 'SignInNeeded' })
})

test('Linear\'s rate limit is a retryable 429; a person not connected asks for sign-in before any call', async () => {
  const s = createLinearRecipeSession({ userId: 'u1', tokenFor: async () => 'tok', fetch: fakeLinear({ rateLimited: true }).fetch })
  await assert.rejects(s.teams(), { code: 'rate_limited', status: 429 })
  const r = rig({ account: { status: 'needs_sign_in', organizationId: ORG } })
  await assert.rejects(r.vendor.session({ ownerId: 'u1', match: {} }), { name: 'SignInNeeded' })
  const other = rig({ account: { status: 'active', organizationId: 'another-org-0000' } })
  await assert.rejects(other.vendor.session({ ownerId: 'u1', match: { linear: { organizationId: ORG } } }), { name: 'SignInNeeded' }, 'connected to another workspace: sign in again')
})

test('an over-budget run stops before the call', async () => {
  const s = createLinearRecipeSession({ userId: 'u1', tokenFor: async () => 'tok', fetch: fakeLinear().fetch, budget: budgetOf(0) })
  await assert.rejects(s.teams(), { code: 'budget' })
})

test('issues by identifier: 50 a call, the ones Linear does not show are left out', async () => {
  const fake = fakeLinear()
  const s = createLinearRecipeSession({ userId: 'u1', tokenFor: async () => 'tok', fetch: fake.fetch })
  const got = await s.issuesByIdentifier(['ENG-201', 'WEB-31', 'NOPE-1', 'not an id', 'ENG-201'])
  assert.deepEqual(got.map((i) => i.identifier).sort(), ['ENG-201', 'WEB-31'])
  assert.equal(got.find((i) => i.identifier === 'WEB-31').project.name, 'Checkout v2')
  assert.equal(fake.calls.length, 1)
  assert.equal(issuesQuery(Array.from({ length: 80 }, (_, n) => `ENG-${n + 1}`)).list.length, 50)
  assert.ok(!issuesQuery(['ENG-1"){x}']).query.includes('x}'), 'an identifier is never spliced into the query unchecked')
})

test('blockers collapse to the issues that block another project\'s open issue', async () => {
  const s = createLinearRecipeSession({ userId: 'u1', tokenFor: async () => 'tok', fetch: fakeLinear().fetch })
  const { relations } = await s.blockers(Object.values(P))
  assert.equal(relations.length, 8)
  assert.equal(relations.filter((r) => r.fromProject === P.p2 && r.toProject === P.p1).length, 3)
})

test('hard limits: one issue\'s state or one comment, inside the granted teams; never create, delete or other fields', () => {
  const write = (kind, body, teamId = TEAMS.ENG.id) => ({ kind, target: { issueId: ISSUE_ID, teamId, identifier: 'ENG-200' }, body })
  assert.equal(checkLinearHardLimits(write('linear.update_item', { stateId: STATE_IDS.Done })), null)
  assert.equal(checkLinearHardLimits(write('linear.update_item', { stateId: STATE_IDS.Done, assigneeId: ISSUE_ID })), 'refused')
  assert.equal(checkLinearHardLimits(write('linear.update_item', { title: 'x' })), 'refused')
  assert.equal(checkLinearHardLimits(write('linear.update_item', { stateId: STATE_IDS.Done, delete: true })), 'refused')
  assert.equal(checkLinearHardLimits(write('linear.comment', { text: 'Discussed in standup' })), null)
  assert.equal(checkLinearHardLimits(write('linear.comment', { text: '' })), 'refused')
  assert.equal(checkLinearHardLimits(write('linear.delete', {})), 'refused')
  assert.equal(checkLinearHardLimits(write('linear.update_item', { stateId: STATE_IDS.Done }, TEAMS.PAY.id), { scope: { teams: [TEAMS.ENG.id] } }), 'refused')
})

test('perform sends only issueUpdate(stateId) for a picked team, and nothing for another team', async () => {
  const r = rig()
  const instance = { ownerId: 'u1', match: { linear: { organizationId: ORG, teams: [TEAMS.ENG.id] } } }
  const done = await r.vendor.perform({ kind: 'linear.update_item', target: { issueId: ISSUE_ID, teamId: TEAMS.ENG.id }, body: { stateId: STATE_IDS['In Progress'] } }, { instance, grant: { scope: { teams: [TEAMS.ENG.id], fields: ['state'] } } })
  assert.equal(done.ref, 'ENG-200')
  assert.deepEqual(r.fake.mutations.map((m) => m.op), ['UpdateIssueState'])
  assert.deepEqual(r.fake.mutations[0].variables, { id: ISSUE_ID, stateId: STATE_IDS['In Progress'] })
  const refused = await r.vendor.perform({ kind: 'linear.update_item', target: { issueId: ISSUE_ID, teamId: TEAMS.PAY.id }, body: { stateId: STATE_IDS.Done } }, { instance })
  assert.equal(refused.refused, 'team_not_picked')
  assert.equal(r.fake.mutations.length, 1)
})

test('a new instance takes the owner\'s workspace; the teams picker lists what they see', async () => {
  const r = rig()
  assert.deepEqual(await r.vendor.resolveMatch({ linear: { organizationId: null, teams: [] } }, 'u1'), { linear: { organizationId: ORG, teams: [] } })
  const none = rig({ account: null })
  await assert.rejects(none.vendor.resolveMatch({ linear: {} }, 'u1'), { code: 'linear_not_connected' })
  assert.deepEqual((await r.vendor.teamsFor('u1')).map((t) => t.label), ['Engineering (ENG)', 'Payments (PAY)', 'Web (WEB)'])
})
