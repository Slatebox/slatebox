// Adding an already-connected agent to a slate in one click (owner, 2026-11-25: "it should be quicker to
// invite an already connected mcp to the slate - they can just connect here without 'asking' first").
// Connecting an integration gave its sign-in and its consent, so the canvas's Invite agent panel adds it
// at once (addDecision 'add': no dialog, no new sign-in, no consent again). It is not instant only when
// its tools changed since it was connected, it needs a new sign-in, Pro ended, or the slate owner does
// not let this person bring outside agents here, and then it says why. Adding never turns off Ask first
// for its changes outside Slatebox. The decision agrees with what the server does.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/invite-connected.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { startMcpTestServers } from './mcp-test-servers.mjs'
import { createMcpFetch } from '../enterprise/server/mcp-fetch.mjs'
import { callTool, discover } from '../enterprise/server/mcp-session.mjs'
import { createConnectorService, memoryStore } from '../enterprise/server/service.mjs'
import { addDecision } from '../enterprise/common/integration-words.mjs'
import { sanitizeClientName } from '../web/app/imports/api/common/agent-label.mjs'
import { connectorSuggestions } from './connector-suggestions-world.mjs'

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const active = { integrationId: 'i1', name: 'GitHub', host: 'api.githubcopilot.com', status: 'active', rule: 'ask' }

// ---------- the decision ----------

test('an active connected integration is added instantly on a slate that allows it', () => {
  assert.deepEqual(addDecision(active), { act: 'add', why: '' })
  assert.deepEqual(addDecision(active, { setting: { outsideAgents: 'editors' } }), { act: 'add', why: '' })
  assert.deepEqual(addDecision(active, { setting: { outsideAgents: 'owner' }, isOwner: true }), { act: 'add', why: '' })
  assert.deepEqual(addDecision(active, { setting: { outsideAgents: 'off' }, isOwner: false }).act, 'blocked')
  // still asking the slate's rule: add, and the server checks the rule again
  assert.equal(addDecision(active, { setting: null }).act, 'add')
})

test('already on this slate: no second copy; a removed copy or someone else\'s copy does not count', () => {
  assert.equal(addDecision(active, { invited: [{ integrationId: 'i1', mine: true, status: 'active' }] }).act, 'here')
  assert.equal(addDecision(active, { invited: [{ integrationId: 'i1', mine: true, status: 'paused' }] }).act, 'here')
  assert.equal(addDecision(active, { invited: [{ integrationId: 'i1', mine: true, status: 'removed' }] }).act, 'add')
  assert.equal(addDecision(active, { invited: [{ integrationId: 'i1', mine: false, status: 'active' }] }).act, 'add')
  assert.equal(addDecision(active, { invited: [{ integrationId: 'other', mine: true, status: 'active' }] }).act, 'add')
})

test('its tools changed since it was connected: it needs one look first, and says so plainly', () => {
  const d = addDecision({ ...active, status: 'paused' })
  assert.equal(d.act, 'review')
  assert.match(d.why, /GitHub's tools changed since you connected it/)
  assert.match(d.why, /Integrations page/)
})

test('a new sign-in, or an unknown state: not instant, each with its reason; never a plan (integrations are free)', () => {
  const signIn = addDecision({ ...active, status: 'needs_sign_in' })
  assert.equal(signIn.act, 'sign-in')
  assert.match(signIn.why, /sign in again/)
  for (const status of ['active', 'paused', 'needs_sign_in', 'something_new']) {
    const { act, why } = addDecision({ ...active, status })
    assert.notEqual(act, 'pro', status)
    assert.doesNotMatch(why, /Pro\b|Business|plan/, status)
  }
  const odd = addDecision({ ...active, status: 'something_new' })
  assert.equal(odd.act, 'review')
  assert.ok(odd.why)
})

test('the slate owner\'s rule: off blocks everyone (the owner is told how to turn it on); owner-only blocks others', () => {
  const offForOwner = addDecision(active, { setting: { outsideAgents: 'off' }, isOwner: true })
  assert.equal(offForOwner.act, 'blocked')
  assert.match(offForOwner.why, /You turned outside agents off/)
  const offForEditor = addDecision(active, { setting: { outsideAgents: 'off' }, isOwner: false })
  assert.equal(offForEditor.act, 'blocked')
  assert.match(offForEditor.why, /owner turned outside agents off/)
  const ownerOnly = addDecision(active, { setting: { outsideAgents: 'owner' }, isOwner: false })
  assert.equal(ownerOnly.act, 'blocked')
  assert.match(ownerOnly.why, /Only this slate's owner/)
  // the slate's rule is said before the integration's own state
  assert.equal(addDecision({ ...active, status: 'paused' }, { setting: { outsideAgents: 'off' } }).act, 'blocked')
})

test('every reason is plain words: no codes, no all-caps placeholders', () => {
  const cases = [
    addDecision({ ...active, status: 'paused' }), addDecision({ ...active, status: 'needs_sign_in' }),
    addDecision(active, { setting: { outsideAgents: 'off' }, isOwner: true }), addDecision(active, { setting: { outsideAgents: 'owner' } }),
  ]
  for (const { why } of cases) {
    assert.ok(why.length > 20, why)
    assert.doesNotMatch(why, /_|[A-Z]{4,}/, why)
  }
})

// ---------- the decision agrees with the server ----------

let servers
let fetch
before(async () => {
  servers = await startMcpTestServers()
  fetch = createMcpFetch({ devOrigins: [servers.origin] })
})
after(() => servers.close())

// Ada owns slate A; Sam may edit it. Both have Pro.
function makeWorld() {
  const slates = { shareA: { _id: 'slateA', shareId: 'shareA', userId: 'ada', revision: 1, nodes: [] } }
  const roles = { shareA: { ada: 'edit', sam: 'edit' } }
  const connections = memoryStore()
  const integrations = memoryStore()
  const slateSettings = memoryStore()
  const live = connectorSuggestions(slates.shareA)
  const presenceCalls = []
  const service = createConnectorService({
    connections,
    integrations,
    slateSettings,
    suggestions: live.suggestions,
    fetch,
    session: { discover, callTool },
    model: async () => ({ groups: [] }),
    applyOperations: live.applyOperations,
    access: {
      forUser: async (shareId, userId) => (slates[shareId] && roles[shareId][userId] ? { slate: slates[shareId], canRead: true, canEdit: roles[shareId][userId] === 'edit' } : null),
      reload: async (shareId) => slates[shareId],
    },
    firstName: async (userId) => userId[0].toUpperCase() + userId.slice(1),
    sanitizeName: sanitizeClientName,
    presence: { plan: async () => {}, step: async () => {}, saved: async (...args) => presenceCalls.push(args), end: async () => {} },
    vault: { available: () => true, describe: async () => null, tokenFor: async () => null, remove: async () => ({ removed: true }) },
    slateList: async () => [],
    devOrigins: [servers.origin],
    sleep: async () => {},
    later: () => {},
    audit: () => {},
  })
  const person = (userId) => ({ kind: 'person', userId, scopes: ['slates:read', 'slates:write'] })
  const world = { service, connections, integrations, presenceCalls, ada: person('ada'), sam: person('sam') }
  world.connect = async (who, name = 'GitHub') => {
    const found = await service.discover(who, { address: servers.url('/open/mcp') })
    return service.integrationConnect(who, { address: found.address, name, tools: found.tools.map(({ name: tool, hash, policy }) => ({ name: tool, hash, policy })) })
  }
  return world
}

// What the panel would decide for this person, from the same answers the page gets.
async function decide(world, who, integrationId) {
  const { integrations } = await world.service.integrationsList(who)
  const integration = integrations.find((i) => i.integrationId === integrationId)
  const setting = await world.service.slateSetting(who, { shareId: 'shareA' })
  const invited = (await world.connections.find({ slateId: 'slateA' })).map((c) => ({ integrationId: c.integrationId, mine: c.ownerId === who.userId, status: c.status }))
  return addDecision(integration, { invited, setting, isOwner: who.userId === 'ada' })
}

test('Add: one call puts it on the slate, its cursor greets where the person is looking, and Ask first stays on', async () => {
  const world = makeWorld()
  const integration = await world.connect(world.ada)
  assert.equal((await decide(world, world.ada, integration.integrationId)).act, 'add')
  const view = { x: 1000, y: 400, width: 800, height: 600 }
  const connection = await world.service.integrationInvite(world.ada, { shareId: 'shareA', integrationId: integration.integrationId, view })
  assert.equal(connection.status, 'active')
  assert.ok(connection.agentId, 'a named cursor joins')
  const greeting = world.presenceCalls.at(-1)
  assert.equal(greeting[2].point.x, 1400)
  assert.equal(greeting[2].point.y, 700)
  // its changes outside Slatebox still wait on a card: adding it never turns acting without asking on
  const acting = await world.service.outsideList(world.ada, { shareId: 'shareA', connectionId: connection.connectionId })
  const agent = acting.agents.find((a) => a.connectionId === connection.connectionId)
  assert.equal(agent.actWithoutAsking, false)
  assert.equal(agent.approvers, 'inviter')
  assert.equal((await decide(world, world.ada, integration.integrationId)).act, 'here')
})

test('when the decision says blocked or review, the server refuses the same way', async () => {
  const world = makeWorld()
  const sams = await world.connect(world.sam, 'Sam desk')
  await world.service.slateSetting(world.ada, { shareId: 'shareA', outsideAgents: 'owner' })
  assert.equal((await decide(world, world.sam, sams.integrationId)).act, 'blocked')
  await assert.rejects(world.service.integrationInvite(world.sam, { shareId: 'shareA', integrationId: sams.integrationId }), (e) => e.code === 'owner_only')
  await world.service.slateSetting(world.ada, { shareId: 'shareA', outsideAgents: 'editors' })
  assert.equal((await decide(world, world.sam, sams.integrationId)).act, 'add')
  // its tools changed since it was connected (the sweep marks it paused)
  await world.integrations.update(sams.integrationId, { status: 'paused' })
  assert.equal((await decide(world, world.sam, sams.integrationId)).act, 'review')
  await assert.rejects(world.service.integrationInvite(world.sam, { shareId: 'shareA', integrationId: sams.integrationId }), (e) => e.code === 'tools_changed')
})

// ---------- the panel ----------

test('the canvas panel: connected agents first with Add, every slate I own, More agents; no dialog on the way', () => {
  const panel = source('enterprise/client/AgentsOnSlate.jsx')
  assert.match(panel, /export function InvitePanel/)
  assert.match(panel, /addDecision\(integration, \{ invited: mine, setting, isOwner \}\)/)
  assert.match(panel, /data-invite-quick-add=""/)
  assert.match(panel, /Add to every slate I own/)
  assert.match(panel, /integrations\.setRule', \{ integrationId: integration\.integrationId, rule: 'my_slates' \}/)
  assert.match(panel, /More agents/)
  // a Popper, not a Dialog: nothing to confirm before the agent arrives
  const body = panel.slice(panel.indexOf('export function InvitePanel'), panel.indexOf('InvitePanel.propTypes'))
  assert.doesNotMatch(body, /<Dialog|role="dialog"|alertdialog/)
  assert.match(body, /integrations\.invite', \{ shareId, integrationId: integration\.integrationId, \.\.\.\(view && \{ view \}\) \}/)
  // the gallery walkthrough is still one click away, and opens directly for someone with no integrations
  assert.match(panel, /if \(integrations\?\.length\) \{[\s\S]*?\} else setInviting\(true\)/)
  // Ask first stays the default on the chip
  assert.match(panel, /<MenuItem value="off">Ask first: each waits on a card<\/MenuItem>/)
})
