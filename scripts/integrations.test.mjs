// Integrations (owner, 2026-11-24: "connect once, invite anywhere"): a person's agent servers are
// kept once, apart from any slate; inviting one onto another slate needs no new sign-in and no new
// consent; standing rules bring it onto every slate its owner opens (a removal is remembered);
// a slate's owner chooses who may bring outside agents; one review of changed tools resumes every
// slate; disconnecting revokes the sign-in and removes it everywhere; the sweep follows the integration.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/integrations.test.mjs
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { startMcpTestServers } from './mcp-test-servers.mjs'
import { createMcpFetch } from '../enterprise/server/mcp-fetch.mjs'
import { callTool, discover } from '../enterprise/server/mcp-session.mjs'
import { createConnectorService, memoryStore, publicIntegration } from '../enterprise/server/service.mjs'
import { connectorActions, integrationActions } from '../enterprise/server/actions.mjs'
import { migrateIntegrations } from '../enterprise/server/integrations-migrate.mjs'
import { credentialId } from '../enterprise/server/credentials.mjs'
import { sanitizeClientName } from '../web/app/imports/api/common/agent-label.mjs'
import { connectorSuggestions } from './connector-suggestions-world.mjs'
import { waitingActions } from '../web/app/server/agents/suggestions.mjs'

let servers
let fetch
before(async () => {
  servers = await startMcpTestServers()
  fetch = createMcpFetch({ devOrigins: [servers.origin] })
})
after(() => servers.close())

const refusedWith = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `${error.code}: ${error.message}`)
    return true
  })
}

// Ada owns slates A and B; Sam owns slate C, where Ada may edit.
function makeWorld({ pro = ['ada', 'sam'] } = {}) {
  const slates = {
    shareA: { _id: 'slateA', shareId: 'shareA', userId: 'ada', revision: 1, nodes: [{ options: { id: 'n0', text: 'Checkout', xPos: 0, yPos: 0, width: 200, height: 80 }, relationships: { associations: [] } }] },
    shareB: { _id: 'slateB', shareId: 'shareB', userId: 'ada', revision: 1, nodes: [] },
    shareC: { _id: 'slateC', shareId: 'shareC', userId: 'sam', revision: 1, nodes: [] },
    // Ada's public slate: anyone may view it.
    shareP: { _id: 'slateP', shareId: 'shareP', userId: 'ada', revision: 1, nodes: [], options: { isPublic: true } },
  }
  const roles = { shareA: { ada: 'edit', sam: 'edit', vic: 'read' }, shareB: { ada: 'edit', vic: 'read' }, shareC: { sam: 'edit', ada: 'edit' }, shareP: { ada: 'edit', vic: 'read', sam: 'read' } }
  const connections = memoryStore()
  const integrations = memoryStore()
  const slateSettings = memoryStore()
  const live = connectorSuggestions(slates.shareA)
  const audits = []
  const proList = [...pro]
  const presenceCalls = []
  const removedSignIns = []
  // A vault that knows nothing (open servers need no sign-in): remove is recorded.
  const vault = {
    available: () => true,
    describe: async () => null,
    tokenFor: async () => null,
    remove: async (userId, address) => {
      removedSignIns.push([userId, address])
      return { removed: true, revoked: false }
    },
  }
  const options = {
    connections,
    integrations,
    slateSettings,
    suggestions: live.suggestions,
    fetch,
    session: { discover, callTool },
    model: async ({ tool }) => (tool.name === 'plan_calls' ? { calls: [{ tool: 'search', arguments: { query: 'retries' } }], done: true } : { groups: [{ label: 'Found', notes: [{ key: 'a', text: 'Retry after a day' }] }] }),
    applyOperations: live.applyOperations,
    access: {
      forUser: async (shareId, userId) => (slates[shareId] && roles[shareId][userId] ? { slate: slates[shareId], canRead: true, canEdit: roles[shareId][userId] === 'edit' } : null),
      reload: async (shareId) => slates[shareId],
    },
    pro: async (userId) => proList.includes(userId),
    firstName: async (userId) => userId[0].toUpperCase() + userId.slice(1),
    sanitizeName: sanitizeClientName,
    presence: {
      plan: async () => {}, step: async () => {}, saved: async (...args) => presenceCalls.push(['saved', ...args]), end: async () => {},
    },
    vault,
    slateList: async (ids) => Object.values(slates).filter((s) => ids.includes(s._id)).map((s) => ({ slateId: s._id, shareId: s.shareId, name: s._id })),
    devOrigins: [servers.origin],
    sleep: async () => {},
    later: () => {},
    audit: (entry) => audits.push(entry),
  }
  const service = createConnectorService(options)
  const person = (userId) => ({ kind: 'person', userId, scopes: ['slates:read', 'slates:write'] })
  const world = { service, options, connections, integrations, slateSettings, live, audits, proList, presenceCalls, removedSignIns, slates, ada: person('ada'), sam: person('sam'), vic: person('vic') }
  // Connect from the Integrations page: discover (no slate), then consent to the hashes seen.
  world.connect = async (path = '/open/mcp', { name = 'Research', rule } = {}) => {
    const found = await service.discover(world.ada, { address: servers.url(path) })
    return service.integrationConnect(world.ada, { address: found.address, name, tools: found.tools.map(({ name: tool, hash, policy }) => ({ name: tool, hash, policy })), ...(rule && { rule }) })
  }
  return world
}

test('connect once from the Integrations page (no slate), then invite onto two slates with no sign-in and no consent again', async () => {
  const world = makeWorld()
  const integration = await world.connect()
  assert.equal(integration.status, 'active')
  assert.equal(integration.rule, 'ask')
  assert.equal(integration.slateCount, 0)
  const listedBefore = servers.calls.filter((c) => c.kind === 'open' && c.method === 'tools/list').length
  const a = await world.service.integrationInvite(world.ada, { shareId: 'shareA', integrationId: integration.integrationId })
  const b = await world.service.integrationInvite(world.ada, { shareId: 'shareB', integrationId: integration.integrationId, contextLevel: 'selection' })
  // no server round trip at all: the consent carried over
  assert.equal(servers.calls.filter((c) => c.kind === 'open' && c.method === 'tools/list').length, listedBefore)
  assert.equal(a.name, 'Research')
  assert.equal(a.joinedBy, 'invite')
  assert.equal(a.contextLevel, 'request', 'what it may see defaults to only the request, never the whole slate')
  assert.equal(b.contextLevel, 'selection')
  const rows = world.connections.rows
  assert.deepEqual(rows.map((r) => r.integrationId), [integration.integrationId, integration.integrationId])
  assert.deepEqual(rows[0].tools, rows[1].tools)
  assert.equal(rows[0].colorIndex, rows[1].colorIndex, 'one colour on every slate')
  // the second invite onto the same slate is refused (one copy per person per slate)
  await refusedWith(world.service.integrationInvite(world.ada, { shareId: 'shareA', integrationId: integration.integrationId }), 'already_here')
  // the page lists it with both slates
  const { integrations } = await world.service.integrationsList(world.ada)
  assert.equal(integrations[0].slateCount, 2)
  assert.deepEqual(integrations[0].slates.map((s) => s.shareId).sort(), ['shareA', 'shareB'])
  // it can be asked on either slate (its answer is the app's live suggestion)
  const asked = await world.service.call(world.ada, { connectionId: a.connectionId, request: 'search retries' })
  assert.equal(asked.items, 1)
  assert.ok(world.integrations.rows[0].lastUsedAt)
})

test('connecting from a slate makes the integration too: another slate invites it without the walkthrough', async () => {
  const world = makeWorld()
  const found = await world.service.discover(world.ada, { shareId: 'shareA', address: servers.url('/open/mcp') })
  assert.equal(found.integration, undefined)
  const conn = await world.service.connect(world.ada, { shareId: 'shareA', address: found.address, name: 'Diagrams', tools: found.tools.map(({ name, hash, policy }) => ({ name, hash, policy })) })
  assert.equal(world.integrations.rows.length, 1)
  assert.equal(world.connections.rows[0].integrationId, world.integrations.rows[0]._id)
  assert.equal(conn.integrationId, world.integrations.rows[0]._id)
  // discovering the same server again says it is already connected
  const again = await world.service.discover(world.ada, { shareId: 'shareB', address: servers.url('/open/mcp') })
  assert.equal(again.integration.integrationId, world.integrations.rows[0]._id)
  const onB = await world.service.integrationInvite(world.ada, { shareId: 'shareB', integrationId: again.integration.integrationId })
  assert.equal(onB.name, 'Diagrams')
})

test('standing rule my_slates: joins slates its owner opens, idempotently; never someone else\'s slate; a removal is remembered', async () => {
  const world = makeWorld()
  const integration = await world.connect('/open/mcp', { rule: 'my_slates' })
  assert.equal(integration.rule, 'my_slates')
  const first = await world.service.applyRules(world.ada, { shareId: 'shareA' })
  assert.equal(first.joined.length, 1)
  assert.equal(world.connections.rows[0].joinedBy, 'rule')
  // the greeting is for a person's invite only: a rule joins quietly
  assert.equal(world.presenceCalls.length, 0)
  // idempotent: applying again, or from a second tab, adds nothing
  assert.deepEqual((await world.service.applyRules(world.ada, { shareId: 'shareA' })).joined, [])
  await Promise.all([world.service.applyRules(world.ada, { shareId: 'shareB' }), world.service.applyRules(world.ada, { shareId: 'shareB' })])
  assert.equal(world.connections.rows.filter((r) => r.slateId === 'slateB' && r.status !== 'removed').length, 1)
  // Sam's slate: Ada may edit there, but rules never put her agent on it; Sam's own page applies only Sam's rules
  assert.deepEqual(await world.service.applyRules(world.ada, { shareId: 'shareC' }), { joined: [], skipped: [] })
  assert.deepEqual(await world.service.applyRules(world.sam, { shareId: 'shareC' }), { joined: [], skipped: [] })
  assert.equal(world.connections.rows.filter((r) => r.slateId === 'slateC').length, 0)
  // a viewer's page applies nothing
  assert.deepEqual(await world.service.applyRules(world.vic, { shareId: 'shareA' }), { joined: [], skipped: [] })
  // Ada removes it from B: reloading B never brings it back
  const onB = world.connections.rows.find((r) => r.slateId === 'slateB')
  await world.service.disconnect(world.ada, { connectionId: onB._id })
  assert.equal(onB.removedBy, 'person')
  assert.deepEqual((await world.service.applyRules(world.ada, { shareId: 'shareB' })).joined, [])
  assert.equal(world.connections.rows.filter((r) => r.slateId === 'slateB' && r.status !== 'removed').length, 0)
  // ...but she may still invite it there herself
  await world.service.integrationInvite(world.ada, { shareId: 'shareB', integrationId: integration.integrationId })
  assert.equal(world.connections.rows.filter((r) => r.slateId === 'slateB' && r.status !== 'removed').length, 1)
  // only the two rules exist
  const bad = await world.service.integrationSetRule(world.ada, { integrationId: integration.integrationId, rule: 'sometimes' }).catch((e) => e)
  assert.equal(bad.code, 'invalid_request')
})

test('rules skip a full slate and say why; limits still apply to invites', async () => {
  const world = makeWorld()
  // Ada already has three agents on A (her per-slate limit)
  for (const [i, path] of ['/open/mcp', '/hostile/inject/mcp', '/hostile/schema/mcp'].entries()) {
    const found = await world.service.discover(world.ada, { shareId: 'shareA', address: servers.url(path) })
    await world.service.connect(world.ada, { shareId: 'shareA', address: found.address, name: `Agent ${i}`, tools: found.tools.map(({ name, hash, policy }) => ({ name, hash, policy })) })
  }
  const fourth = await world.connect('/hostile/huge/mcp', { name: 'Fourth', rule: 'my_slates' })
  const result = await world.service.applyRules(world.ada, { shareId: 'shareA' })
  assert.deepEqual(result.joined, [])
  assert.equal(result.skipped.length, 1)
  assert.equal(result.skipped[0].code, 'agent_limit')
  assert.match(result.skipped[0].why, /3 agents onto one slate/)
  await refusedWith(world.service.integrationInvite(world.ada, { shareId: 'shareA', integrationId: fourth.integrationId }), 'agent_limit')
  // someone else's integration is not theirs to invite
  await refusedWith(world.service.integrationInvite(world.sam, { shareId: 'shareA', integrationId: fourth.integrationId }), 'not_found')
})

test('only the integration\'s owner can invite, change or disconnect it; others never learn it exists', async () => {
  const world = makeWorld()
  const integration = await world.connect()
  await refusedWith(world.service.integrationInvite(world.sam, { shareId: 'shareA', integrationId: integration.integrationId }), 'not_found')
  await refusedWith(world.service.integrationSetRule(world.sam, { integrationId: integration.integrationId, rule: 'my_slates' }), 'not_found')
  await refusedWith(world.service.integrationDisconnect(world.sam, { integrationId: integration.integrationId }), 'not_found')
  assert.deepEqual((await world.service.integrationsList(world.sam)).integrations, [])
  // a viewer cannot invite onto a slate they only read
  await refusedWith(world.service.integrationInvite(world.vic, { shareId: 'shareA', integrationId: integration.integrationId }), 'forbidden')
  // only Ada can ask it; Sam sees its chip but not its tools or address
  const conn = await world.service.integrationInvite(world.ada, { shareId: 'shareA', integrationId: integration.integrationId })
  await refusedWith(world.service.call(world.sam, { connectionId: conn.connectionId, request: 'x' }), 'inviter_only')
  const seen = (await world.service.list(world.sam, { shareId: 'shareA' })).connections[0]
  assert.equal(seen.name, 'Research')
  assert.equal(seen.tools, undefined)
  assert.equal(seen.address, undefined)
  // guests and signed-out callers cannot connect integrations
  await refusedWith(world.service.discover({ kind: 'guest', userId: 'g1' }, { address: servers.url('/open/mcp') }), 'sign_in')
  await refusedWith(world.service.integrationsList({ kind: 'person' }), 'sign_in')
})

test('the slate owner chooses who brings outside agents: editors, only the owner, or no one (invites and rules)', async () => {
  const world = makeWorld()
  const ada = await world.connect('/open/mcp', { rule: 'my_slates' })
  const samIntegration = await (async () => {
    const found = await world.service.discover(world.sam, { address: servers.url('/hostile/inject/mcp') })
    return world.service.integrationConnect(world.sam, { address: found.address, name: 'Sams', tools: found.tools.map(({ name, hash, policy }) => ({ name, hash, policy })) })
  })()
  assert.deepEqual(await world.service.slateSetting(world.sam, { shareId: 'shareA' }), { outsideAgents: 'editors', canChange: false })
  await refusedWith(world.service.slateSetting(world.sam, { shareId: 'shareA', outsideAgents: 'off' }), 'owner_only')
  assert.deepEqual(await world.service.slateSetting(world.ada, { shareId: 'shareA', outsideAgents: 'owner' }), { outsideAgents: 'owner', canChange: true })
  // an editor who is not the owner: refused for an invite and for the walkthrough's connect
  await refusedWith(world.service.integrationInvite(world.sam, { shareId: 'shareA', integrationId: samIntegration.integrationId }), 'owner_only')
  const found = await world.service.discover(world.sam, { shareId: 'shareA', address: servers.url('/hostile/inject/mcp') })
  await refusedWith(world.service.connect(world.sam, { shareId: 'shareA', address: found.address, name: 'Sams', tools: found.tools.map(({ name, hash, policy }) => ({ name, hash, policy })) }), 'owner_only')
  // the owner still may
  assert.equal((await world.service.applyRules(world.ada, { shareId: 'shareA' })).joined.length, 1)
  // off: no one, and rules say why
  await world.service.slateSetting(world.ada, { shareId: 'shareB', outsideAgents: 'off' })
  await refusedWith(world.service.integrationInvite(world.ada, { shareId: 'shareB', integrationId: ada.integrationId }), 'agents_off')
  const ruled = await world.service.applyRules(world.ada, { shareId: 'shareB' })
  assert.deepEqual(ruled.joined, [])
  assert.equal(ruled.skipped[0].code, 'agents_off')
  await refusedWith(world.service.slateSetting(world.ada, { shareId: 'shareB', outsideAgents: 'sometimes' }), 'invalid_request')
})

test('Pro: connecting, inviting and rules need Pro or Business; a lapse shows Pro ended and rules pause, renewal brings them back', async () => {
  const world = makeWorld({ pro: [] })
  await refusedWith(world.service.discover(world.ada, { address: servers.url('/open/mcp') }), 'pro_required')
  const listed = await world.service.integrationsList(world.ada)
  assert.equal(listed.canConnect, false)
  world.proList.push('ada')
  const integration = await world.connect('/open/mcp', { rule: 'my_slates' })
  world.proList.length = 0
  await refusedWith(world.service.integrationInvite(world.ada, { shareId: 'shareA', integrationId: integration.integrationId }), 'pro_required')
  assert.deepEqual(await world.service.applyRules(world.ada, { shareId: 'shareA' }), { joined: [], skipped: [], pro: false })
  assert.equal((await world.service.integrationsList(world.ada)).integrations[0].status, 'pro_ended')
  assert.ok(world.integrations.rows[0].proEndedAt)
  world.proList.push('ada')
  assert.equal((await world.service.applyRules(world.ada, { shareId: 'shareA' })).joined.length, 1)
  assert.equal(world.integrations.rows[0].status, 'active')
})

test('tools changed: the integration and every slate it is on pause at once; one review and consent resumes them all', async () => {
  const world = makeWorld()
  // rug: its definition changes from the third listing (discover, connect, then the ask)
  const integration = await world.connect('/hostile/rug/mcp')
  const a = await world.service.integrationInvite(world.ada, { shareId: 'shareA', integrationId: integration.integrationId })
  await world.service.integrationInvite(world.ada, { shareId: 'shareB', integrationId: integration.integrationId })
  await refusedWith(world.service.call(world.ada, { connectionId: a.connectionId, request: 'search retries' }), 'tools_changed')
  assert.deepEqual(world.connections.rows.map((r) => r.status), ['paused', 'paused'])
  assert.equal(world.integrations.rows[0].status, 'paused')
  // a paused integration is not invited anywhere new
  const page = await world.service.integrationsList(world.ada)
  assert.deepEqual(page.integrations[0].changed, ['search'])
  // review: the server's tools now, the changed one marked and switched off until allowed again
  const review = await world.service.integrationReview(world.ada, { integrationId: integration.integrationId })
  const search = review.tools.find((t) => t.name === 'search')
  assert.equal(search.changed, true)
  assert.deepEqual(review.changed, ['search'])
  // consenting again (to the hashes just seen) resumes both slates with the new consent
  await world.service.integrationConnect(world.ada, { address: review.address, name: 'Research', tools: review.tools.map(({ name, hash }) => ({ name, hash, policy: 'allow' })) })
  assert.deepEqual(world.connections.rows.map((r) => r.status), ['active', 'active'])
  assert.equal(world.integrations.rows[0].status, 'active')
  assert.equal(world.connections.rows[1].tools.find((t) => t.name === 'search').hash, search.hash)
})

test('disconnect: removed from every slate (waiting suggestions withdrawn), sign-in revoked, the row gone; removing from one slate signs nobody out', async () => {
  const world = makeWorld()
  const integration = await world.connect()
  const a = await world.service.integrationInvite(world.ada, { shareId: 'shareA', integrationId: integration.integrationId })
  const b = await world.service.integrationInvite(world.ada, { shareId: 'shareB', integrationId: integration.integrationId })
  await world.service.call(world.ada, { connectionId: a.connectionId, request: 'search retries' })
  assert.equal(waitingActions(await world.live.store.list('slateA')).length, 1)
  // removing it from B alone keeps the sign-in
  await world.service.disconnect(world.ada, { connectionId: b.connectionId })
  assert.deepEqual(world.removedSignIns, [])
  const gone = await world.service.integrationDisconnect(world.ada, { integrationId: integration.integrationId })
  assert.equal(gone.removedFrom, 1)
  assert.equal(gone.signedOut, true)
  assert.deepEqual(world.removedSignIns, [['ada', integration.address]])
  assert.equal(world.integrations.rows.length, 0)
  assert.ok(world.connections.rows.every((r) => r.status === 'removed'))
  assert.equal(world.connections.rows.find((r) => r.slateId === 'slateA').removedBy, 'disconnect')
  assert.equal(world.connections.rows.find((r) => r.slateId === 'slateB').removedBy, 'person')
  // its answer still waiting on A went with it
  assert.equal(waitingActions(await world.live.store.list('slateA')).length, 0)
  await refusedWith(world.service.integrationInvite(world.ada, { shareId: 'shareA', integrationId: integration.integrationId }), 'not_found')
})

test('sweep: a sign-in lives as long as its integration; orphans after a day; 30 days after Pro ended it is forgotten and the integration needs sign-in', async () => {
  const world = makeWorld()
  const integration = await world.connect()
  const day = 86400000
  const rows = [{ ownerId: 'ada', address: integration.address, createdAt: new Date(Date.now() - 400 * day) }, { ownerId: 'ada', address: 'https://orphan.example/mcp', createdAt: new Date(Date.now() - 2 * day) }]
  // an integration on no slate keeps its sign-in, however old (no more "no slate after 24h")
  assert.deepEqual(await world.service.sweep(async () => rows), { removed: 1 })
  assert.deepEqual(world.removedSignIns, [['ada', 'https://orphan.example/mcp']])
  world.removedSignIns.length = 0
  // Still Pro: the sweep keeps the sign-in (and a stale "Pro ended" mark comes back to active).
  world.integrations.rows[0].status = 'pro_ended'
  world.integrations.rows[0].proEndedAt = new Date(Date.now() - 31 * day)
  assert.deepEqual(await world.service.sweep(async () => rows.slice(0, 1)), { removed: 0 })
  assert.equal(world.integrations.rows[0].status, 'active')
  // Pro lapses and Ada never opens a page: the sweep itself notices and starts the 30 days.
  world.proList.length = 0
  assert.deepEqual(await world.service.sweep(async () => rows.slice(0, 1)), { removed: 0 })
  assert.equal(world.integrations.rows[0].status, 'pro_ended')
  assert.ok(world.integrations.rows[0].proEndedAt instanceof Date)
  world.integrations.rows[0].proEndedAt = new Date(Date.now() - 10 * day)
  assert.deepEqual(await world.service.sweep(async () => rows.slice(0, 1)), { removed: 0 })
  world.integrations.rows[0].proEndedAt = new Date(Date.now() - 31 * day)
  assert.deepEqual(await world.service.sweep(async () => rows.slice(0, 1)), { removed: 1 })
  assert.deepEqual(world.removedSignIns, [['ada', integration.address]])
  assert.equal(world.integrations.rows[0].status, 'needs_sign_in')
})

test('migration: live agents become integrations once (idempotent), keeping vault ids, agent ids and suggestions', async () => {
  const connections = memoryStore()
  const integrations = memoryStore()
  const base = { status: 'active', tools: [{ name: 'search', hash: 'a'.repeat(64), policy: 'allow' }], host: 'mcp.example', colorIndex: 3 }
  await connections.insert({ _id: 'c1', ownerId: 'ada', slateId: 's1', address: 'https://mcp.example/mcp', name: 'Old', agentId: 'agent-1', createdAt: new Date(1000), updatedAt: new Date(1000), ...base })
  await connections.insert({ _id: 'c2', ownerId: 'ada', slateId: 's2', address: 'https://MCP.example/mcp', name: 'Newer', agentId: 'agent-2', createdAt: new Date(2000), updatedAt: new Date(3000), ...base })
  await connections.insert({ _id: 'c3', ownerId: 'sam', slateId: 's1', address: 'https://mcp.example/mcp', name: 'Sams', agentId: 'agent-3', createdAt: new Date(2000), ...base, status: 'paused', changed: [{ name: 'search' }] })
  await connections.insert({ _id: 'c4', ownerId: 'ada', slateId: 's3', address: 'https://gone.example/mcp', name: 'Gone', status: 'removed' })
  const first = await migrateIntegrations({ connections, integrations })
  assert.deepEqual(first, { created: 2, linked: 3 })
  const ada = integrations.rows.find((r) => r.ownerId === 'ada')
  assert.equal(ada.name, 'Newer')
  assert.equal(ada.rule, 'ask')
  assert.equal(ada.address, 'https://mcp.example/mcp')
  assert.equal(integrations.rows.find((r) => r.ownerId === 'sam').status, 'paused')
  assert.deepEqual(connections.rows.map((r) => [r._id, r.agentId, r.integrationId ? 'linked' : null]), [['c1', 'agent-1', 'linked'], ['c2', 'agent-2', 'linked'], ['c3', 'agent-3', 'linked'], ['c4', undefined, null]])
  // the vault row id is the person and address only: unchanged, nobody signs in again
  assert.equal(credentialId('ada', ada.address), credentialId('ada', 'https://mcp.example/mcp'))
  assert.deepEqual(await migrateIntegrations({ connections, integrations }), { created: 0, linked: 0 })
})

test('the integration actions join the one registry, with typed MCP tools for the everyday ones and no sign-in by token', async () => {
  const { createAppRegistry } = await import('../web/app/server/actions/index.mjs')
  const registry = createAppRegistry({ extraActions: [...connectorActions(() => ({})), ...integrationActions(() => ({}))] })
  const ids = registry.list().map((a) => a.id).filter((id) => id.startsWith('integrations.')).sort()
  assert.deepEqual(ids, ['integrations.allowChanges', 'integrations.applyRules', 'integrations.connect', 'integrations.disconnect', 'integrations.discover', 'integrations.invite', 'integrations.list', 'integrations.review', 'integrations.setActing', 'integrations.setRule', 'integrations.setSlateSetting', 'integrations.slateSetting', 'integrations.useKey'])
  const tools = registry.list().filter((a) => a.id.startsWith('integrations.') && a.tool).map((a) => a.tool.name).sort()
  assert.deepEqual(tools, ['invite_integration_to_slate', 'list_integrations'])
  // What reaches every slate a person owns, or ends a sign-in, is a person's own choice in the app:
  // connecting, pasting a key, a standing rule, disconnecting. No token (API, exec, MCP) may do it.
  const personOnly = ['integrations.allowChanges', 'integrations.connect', 'integrations.disconnect', 'integrations.setActing', 'integrations.setRule', 'integrations.useKey']
  for (const id of personOnly) {
    const action = registry.get(id)
    assert.deepEqual(action.principals, ['person'], id)
    assert.ok(action.mounts.ddp && !action.mounts.http && !action.tool, id)
    const token = { kind: 'agent', userId: 'ada', tokenId: 't1', scopes: ['slates:read', 'slates:write'] }
    await assert.rejects(registry.run(token, id, { integrationId: 'i1', rule: 'my_slates' }), (error) => error.status === 403 && error.code === 'session_required', id)
  }
  for (const action of registry.list().filter((a) => a.id.startsWith('integrations.') && !personOnly.includes(a.id))) assert.ok(action.mounts.ddp && action.mounts.http, action.id)
  assert.equal(registry.get('integrations.disconnect').destructive, true)
  assert.equal(registry.get('integrations.useKey').input.properties.key.writeOnly, true)
  // signing in from the Integrations page is still the app's own (no slate, no route, no tool)
  const signIn = registry.get('connectors.signIn')
  assert.deepEqual(signIn.input.required, ['address'])
  assert.ok(!signIn.mounts.http && !signIn.tool)
  assert.deepEqual(signIn.principals, ['person'])
})

test('nothing an integration answer carries holds a token or another person\'s address', () => {
  const shown = publicIntegration({ _id: 'i1', ownerId: 'ada', kind: 'mcp', address: 'https://mcp.example/mcp', host: 'mcp.example', name: 'X', tools: [{ name: 's', hash: 'h', policy: 'allow', description: 'secret words' }], auth: { kind: 'oauth', issuer: 'https://as' }, status: 'active', rule: 'my_slates' }, { pro: false })
  assert.equal(shown.status, 'pro_ended')
  assert.deepEqual(Object.keys(shown.tools[0]).sort(), ['group', 'name', 'policy', 'title'])
  assert.ok(!JSON.stringify(shown).includes('issuer'))
})

// ---------- review fixes (2026-11-24) ----------

test('the owner\'s "who may bring outside agents" holds for agents already on the slate, not only new invitations', async () => {
  const world = makeWorld()
  const mine = await world.connect()
  const adaAgent = await world.service.integrationInvite(world.ada, { shareId: 'shareA', integrationId: mine.integrationId })
  // Sam (an editor on Ada's slate) brings his own
  const found = await world.service.discover(world.sam, { address: servers.url('/open/mcp') })
  const his = await world.service.integrationConnect(world.sam, { address: found.address, name: 'Finder', tools: found.tools.map(({ name, hash, policy }) => ({ name, hash, policy })) })
  const samAgent = await world.service.integrationInvite(world.sam, { shareId: 'shareA', integrationId: his.integrationId })
  assert.ok((await world.service.call(world.sam, { connectionId: samAgent.connectionId, request: 'retries' })).items >= 1)
  await world.service.slateSetting(world.ada, { shareId: 'shareA', outsideAgents: 'owner' })
  const calls = servers.calls.length
  await refusedWith(world.service.call(world.sam, { connectionId: samAgent.connectionId, request: 'retries' }), 'owner_only')
  assert.equal(servers.calls.length, calls, 'refused before reaching its server')
  assert.ok((await world.service.call(world.ada, { connectionId: adaAgent.connectionId, request: 'retries again' })).items >= 1)
  await world.service.slateSetting(world.ada, { shareId: 'shareA', outsideAgents: 'off' })
  await refusedWith(world.service.call(world.ada, { connectionId: adaAgent.connectionId, request: 'more' }), 'agents_off')
  await refusedWith(world.service.call(world.sam, { connectionId: samAgent.connectionId, request: 'more' }), 'agents_off')
  // back to editors: both answer again
  await world.service.slateSetting(world.ada, { shareId: 'shareA', outsideAgents: 'editors' })
  assert.ok((await world.service.call(world.sam, { connectionId: samAgent.connectionId, request: 'one more' })).items >= 1)
})

test('standing rules skip slates anyone with the link may view, and an agent\'s host is shown to its inviter only', async () => {
  const world = makeWorld()
  const integration = await world.connect('/open/mcp', { rule: 'my_slates' })
  const ruled = await world.service.applyRules(world.ada, { shareId: 'shareP' })
  assert.deepEqual(ruled.joined, [])
  assert.deepEqual(ruled.skipped.map((s) => s.code), ['public_slate'])
  assert.equal(world.connections.rows.length, 0)
  // invited by hand it may go there; a viewer sees its name, not its server
  await world.service.integrationInvite(world.ada, { shareId: 'shareP', integrationId: integration.integrationId })
  const asVic = (await world.service.list(world.vic, { shareId: 'shareP' })).connections[0]
  assert.equal(asVic.name, 'Research')
  assert.equal(asVic.host, undefined)
  assert.equal(asVic.address, undefined)
  assert.ok(!JSON.stringify(asVic).includes(new URL(integration.address).host))
  assert.equal((await world.service.list(world.ada, { shareId: 'shareP' })).connections[0].host, new URL(integration.address).host)
  // a private slate still gets it by rule
  assert.equal((await world.service.applyRules(world.ada, { shareId: 'shareA' })).joined.length, 1)
})

test('consenting again never switches back on a tool someone turned off on one slate', async () => {
  const world = makeWorld()
  const integration = await world.connect()
  await world.service.integrationInvite(world.ada, { shareId: 'shareA', integrationId: integration.integrationId })
  await world.service.integrationInvite(world.ada, { shareId: 'shareB', integrationId: integration.integrationId })
  const onA = world.connections.rows.find((r) => r.slateId === 'slateA')
  const onB = world.connections.rows.find((r) => r.slateId === 'slateB')
  const allowed = onA.tools.filter((t) => t.policy === 'allow').map((t) => t.name)
  assert.ok(allowed.includes('search'))
  // slate A's own choice (as kept from before integrations): search off here
  onA.tools = onA.tools.map((t) => (t.name === 'search' ? { ...t, policy: 'off' } : t))
  const found = await world.service.discover(world.ada, { address: integration.address })
  await world.service.integrationConnect(world.ada, { address: integration.address, name: 'Research', tools: found.tools.map(({ name, hash }) => ({ name, hash, policy: 'allow' })) })
  assert.equal(onA.tools.find((t) => t.name === 'search').policy, 'off', 'slate A keeps its own choice')
  assert.equal(onB.tools.find((t) => t.name === 'search').policy, 'allow')
})

test('a rule remembers removals from before integrations existed, and from before a reconnect; a whole Disconnect is not a removal', async () => {
  const world = makeWorld()
  const address = (await world.service.discover(world.ada, { address: servers.url('/open/mcp') })).address
  // removed from slate A before integrations existed (no integrationId, no removedBy)
  world.connections.rows.push({ _id: 'cOld', ownerId: 'ada', slateId: 'slateA', shareId: 'shareA', name: 'Research', address, host: new URL(address).host, status: 'removed', tools: [], createdAt: new Date() })
  const first = await world.connect('/open/mcp', { rule: 'my_slates' })
  assert.deepEqual((await world.service.applyRules(world.ada, { shareId: 'shareA' })).joined, [])
  // on B by rule, then removed from B by hand
  const onB = (await world.service.applyRules(world.ada, { shareId: 'shareB' })).joined[0]
  await world.service.disconnect(world.ada, { connectionId: onB.connectionId })
  // on C (Sam's slate, where Ada edits) by invitation: still there at Disconnect
  await world.service.integrationInvite(world.ada, { shareId: 'shareC', integrationId: first.integrationId })
  await world.service.integrationDisconnect(world.ada, { integrationId: first.integrationId })
  // connected again (a new integration id), rule on: A and B stay away; nothing comes to Sam's C (not Ada's)
  await world.connect('/open/mcp', { rule: 'my_slates' })
  assert.deepEqual((await world.service.applyRules(world.ada, { shareId: 'shareA' })).joined, [])
  assert.deepEqual((await world.service.applyRules(world.ada, { shareId: 'shareB' })).joined, [])
  assert.deepEqual((await world.service.applyRules(world.ada, { shareId: 'shareC' })).joined, [])
})

test('a slate removed from by Disconnect gets the agent back by rule after connecting again', async () => {
  const world = makeWorld()
  const first = await world.connect('/open/mcp', { rule: 'my_slates' })
  assert.equal((await world.service.applyRules(world.ada, { shareId: 'shareA' })).joined.length, 1)
  await world.service.integrationDisconnect(world.ada, { integrationId: first.integrationId })
  await world.connect('/open/mcp', { rule: 'my_slates' })
  assert.equal((await world.service.applyRules(world.ada, { shareId: 'shareA' })).joined.length, 1)
})
