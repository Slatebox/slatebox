// Integrations polish (owner, 2026-11-24: "i connected linear, but it doesn't show connected ... it has
// the green background, but so do github and hugging face?"): a connected integration's gallery card
// says ✓ Connected and offers its next step, no card is tinted because it is featured, the card words
// say agents make changes you approve, the Integrations page sums up what an integration may use in
// one line (Google access only for Google), and an integration connected before agents read and write
// can be let make changes in one click: its changes turned on, or (Linear's read-only address) moved
// to the card's own address after one more sign-in there. Stored consent never changes by itself.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/integrations-polish.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { startMcpTestServers } from './mcp-test-servers.mjs'
import { createMcpFetch } from '../enterprise/server/mcp-fetch.mjs'
import { callTool, discover } from '../enterprise/server/mcp-session.mjs'
import { createConnectorService, memoryStore, publicIntegration } from '../enterprise/server/service.mjs'
import { integrationActions } from '../enterprise/server/actions.mjs'
import { liveGallery } from '../enterprise/server/gallery-admin.mjs'
import { cardFor, GALLERY, RETIRED_WORDS, writesAddress } from '../enterprise/common/gallery.mjs'
import { cardState, changesOffer, connectedAction, toolSummary } from '../enterprise/common/integration-words.mjs'
import { sanitizeClientName } from '../web/app/imports/api/common/agent-label.mjs'
import { connectorSuggestions } from './connector-suggestions-world.mjs'

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
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// ---------- the gallery's words ----------

test('no gallery card for a server with write recipes says it only reads; Linear and GitHub say changes wait for you', () => {
  for (const card of GALLERY) {
    if (!card.recipe?.writes?.length) continue
    assert.doesNotMatch(card.lands, /reads? only|read-only|only reads/i, `${card.id}: ${card.lands}`)
    assert.match(card.lands, /approve/, `${card.id} says its changes wait for approval`)
  }
  assert.ok(GALLERY.find((c) => c.id === 'linear').recipe.writes.length)
  assert.ok(GALLERY.find((c) => c.id === 'github').recipe.writes.length)
})

test('a saved card word that is still a retired built-in default gives way to the current words; a real edit stays', () => {
  const old = RETIRED_WORDS.linear.lands[0]
  const linear = (docs) => liveGallery(docs).find((c) => c.id === 'linear')
  assert.equal(linear([{ kind: 'outbound-connector', galleryId: 'linear', lands: old }]).lands, GALLERY.find((c) => c.id === 'linear').lands)
  assert.equal(linear([{ kind: 'outbound-connector', galleryId: 'linear', lands: `  ${old} ` }]).lands, GALLERY.find((c) => c.id === 'linear').lands)
  assert.equal(linear([{ kind: 'outbound-connector', galleryId: 'linear', lands: 'Our team issues, as notes.' }]).lands, 'Our team issues, as notes.')
})

// ---------- the gallery's cards ----------

const LINEAR = { integrationId: 'i1', kind: 'mcp', name: 'Linear', galleryId: 'linear', status: 'active' }

test('only the connected integration\'s card says Connected; Manage on the Integrations page, Invite on a slate', () => {
  const states = GALLERY.map((item) => [item.id, connectedAction(cardState(item, [], [LINEAR]), true)])
  assert.deepEqual(states.filter(([, next]) => next).map(([id]) => id), ['linear'], 'Hugging Face and GitHub are featured, not connected')
  assert.deepEqual(connectedAction(cardState({ id: 'linear' }, [], [LINEAR]), true), { words: '✓ Connected · Manage', act: 'manage-integration' })
  assert.deepEqual(connectedAction(cardState({ id: 'linear' }, [], [LINEAR]), false), { words: '✓ Connected · Invite to this slate', act: 'invite' })
  // on this slate already: the existing ✓ On this slate treatment wins
  const here = { galleryId: 'linear', mine: true, status: 'active', agentId: 'a1' }
  assert.deepEqual(connectedAction(cardState({ id: 'linear' }, [here], [LINEAR]), false), { words: '✓ On this slate · Manage', act: 'manage-agent' })
  // waiting on a sign-in: says so, and the card goes through discovery (which signs in again)
  assert.equal(connectedAction(cardState({ id: 'linear' }, [], [{ ...LINEAR, status: 'needs_sign_in' }]), false).act, 'discover')
  // Google is never a gallery card
  assert.equal(connectedAction(cardState({ id: 'googledrive' }, [], [{ integrationId: 'g', kind: 'google', galleryId: 'googledrive', status: 'active' }]), true), null)
})

test('the gallery card tints nothing for being featured; connected is an edge and a ✓ line; focus is an outline, never green', () => {
  const walk = source('enterprise/client/InviteWalkthrough.jsx')
  assert.doesNotMatch(walk, /item\.featured && \{ bgcolor/, 'the featured tint was why Hugging Face, GitHub and Linear all looked connected')
  assert.match(walk, /data-gallery-connected=/)
  const focus = walk.match(/'&:focus-visible': \{ outline: '3px solid (#[0-9a-f]{6})'/)
  assert.ok(focus)
  assert.notEqual(focus[1], '#2e7d32', 'the focus ring is not the connected green')
  // the Integrations page passes its integrations, and Manage brings the row into view
  const page = source('enterprise/client/IntegrationsPage.jsx')
  assert.match(page, /integrations=\{mcp\} onManageIntegration=\{manage\}/)
})

// ---------- the Integrations page row ----------

const tools = (n, group, policy, extra = {}) => Array.from({ length: n }, (_, i) => ({ name: `${group}_${policy}_${i}`, group, policy, ...extra }))

test('what it may use is one line of counts, not forty tool names', () => {
  const row = { kind: 'mcp', tools: [...tools(34, 'lookup', 'allow'), ...tools(6, 'change', 'allow'), ...tools(1, 'change', 'off', { destructive: true }), ...tools(1, 'lookup', 'off')] }
  assert.equal(toolSummary(row), 'Looks things up with 34 tools · Makes changes with 6 (you approve each one) · 2 off')
  assert.equal(toolSummary({ ...row, actWithoutAsking: true }), 'Looks things up with 34 tools · Makes changes with 6 (made without asking, except deleting, closing or merging) · 2 off')
  assert.equal(toolSummary({ kind: 'mcp', tools: tools(1, 'lookup', 'allow') }), 'Looks things up with 1 tool')
  assert.equal(toolSummary({ kind: 'mcp', tools: [] }), 'Nothing allowed yet')
  const page = source('enterprise/client/IntegrationsPage.jsx')
  assert.doesNotMatch(page, /May use:/)
  assert.match(page, /integration\.kind === 'google' && integration\.scopes\?\.length \? ` · Google access/, 'Google access only for Google')
})

test('the offer to make changes too: its changes that are off (never destructive ones), or the card\'s own address', () => {
  assert.deepEqual(changesOffer({ kind: 'mcp', tools: [...tools(3, 'lookup', 'allow'), ...tools(2, 'change', 'off'), ...tools(1, 'change', 'off', { destructive: true })] }), { kind: 'allow', count: 2 })
  assert.equal(changesOffer({ kind: 'mcp', tools: [...tools(3, 'lookup', 'allow'), ...tools(2, 'change', 'allow'), ...tools(1, 'change', 'off', { destructive: true })] }), null)
  assert.deepEqual(changesOffer({ kind: 'mcp', tools: tools(38, 'lookup', 'allow'), writesAt: 'https://mcp.linear.app/mcp' }), { kind: 'address', address: 'https://mcp.linear.app/mcp' })
  assert.equal(changesOffer({ kind: 'google', tools: [] }), null)
})

test('Linear at its read-only address is offered its full address; at the full one, nothing; MCP rows carry no Google words', () => {
  assert.equal(writesAddress('https://mcp.linear.app/mcp/readonly'), 'https://mcp.linear.app/mcp')
  assert.equal(writesAddress('https://mcp.linear.app/mcp'), null)
  assert.equal(writesAddress('https://huggingface.co/mcp'), null)
  const doc = { _id: 'i1', kind: 'mcp', name: 'Linear', host: 'mcp.linear.app', address: 'https://mcp.linear.app/mcp/readonly', scopes: ['read'], tools: [], status: 'active' }
  assert.equal(publicIntegration(doc).writesAt, 'https://mcp.linear.app/mcp')
  assert.equal(publicIntegration(doc).galleryId, 'linear')
  assert.equal(publicIntegration({ ...doc, address: 'https://mcp.linear.app/mcp' }).writesAt, null)
  assert.equal(publicIntegration({ ...doc, kind: 'google', address: 'google://drive' }).writesAt, null)
})

// ---------- the service ----------

// Ada owns slates A and B. The test card: the tracker at its full address, the open server as its
// "read-only" alias (it offers lookups and one unannotated post, like an older read-only address).
function makeWorld() {
  const slates = {
    shareA: { _id: 'slateA', shareId: 'shareA', userId: 'ada', revision: 1, nodes: [] },
    shareB: { _id: 'slateB', shareId: 'shareB', userId: 'ada', revision: 1, nodes: [] },
  }
  const connections = memoryStore()
  const integrations = memoryStore()
  const live = connectorSuggestions(slates.shareA)
  const audits = []
  const removedSignIns = []
  const card = { id: 'tracker', name: 'Tracker', url: servers.url('/tracker/mcp'), aliases: [servers.url('/open/mcp')], job: 'Issues', lands: 'Issues, and changes you approve.', try: 'x', cost: 'Free',
    recipe: { rounds: 1, calls: 1, intents: [], writes: [{ key: 'create-issue', label: 'Create issue', tool: ['create_issue'], keywords: ['issue'], fields: { title: ['title'] } }] } }
  const service = createConnectorService({
    connections,
    integrations,
    suggestions: live.suggestions,
    fetch,
    session: { discover, callTool },
    model: async () => ({ calls: [], done: true }),
    applyOperations: live.applyOperations,
    access: { forUser: async (shareId, userId) => (slates[shareId] && userId === 'ada' ? { slate: slates[shareId], canRead: true, canEdit: true } : null), reload: async (shareId) => slates[shareId] },
    firstName: async (userId) => userId[0].toUpperCase() + userId.slice(1),
    sanitizeName: sanitizeClientName,
    presence: { plan: async () => {}, step: async () => {}, saved: async () => {}, end: async () => {} },
    vault: { available: () => true, describe: async () => null, tokenFor: async () => null, remove: async (userId, address) => (removedSignIns.push([userId, address]), { removed: true }) },
    slateList: async (ids) => Object.values(slates).filter((s) => ids.includes(s._id)).map((s) => ({ slateId: s._id, shareId: s.shareId, name: s._id })),
    devOrigins: [servers.origin],
    gallery: async () => [card, ...GALLERY],
    sleep: async () => {},
    later: () => {},
    audit: (entry) => audits.push(entry),
  })
  const person = (userId) => ({ kind: 'person', userId, scopes: ['slates:read', 'slates:write'] })
  const world = { service, connections, integrations, audits, removedSignIns, card, ada: person('ada'), sam: person('sam') }
  // Connected the way it was before agents read and write: lookups allowed, every change off.
  world.connectReadOnly = async (path, name = 'Tracker') => {
    const found = await service.discover(world.ada, { address: servers.url(path) })
    return service.integrationConnect(world.ada, { address: found.address, name, tools: found.tools.map(({ name: tool, hash, group }) => ({ name: tool, hash, policy: group === 'lookup' ? 'allow' : 'off' })) })
  }
  return world
}

test('let it make changes too: its non-destructive changes turn on, destructive stay off, every slate follows, audited', async () => {
  const world = makeWorld()
  const before = await world.connectReadOnly('/tracker/mcp')
  assert.equal(before.writesAt, null, 'at the card\'s own address already')
  assert.deepEqual(changesOffer(before), { kind: 'allow', count: 3 })
  await world.service.integrationInvite(world.ada, { shareId: 'shareA', integrationId: before.integrationId })
  await world.service.integrationInvite(world.ada, { shareId: 'shareB', integrationId: before.integrationId })
  const stored = () => Object.fromEntries(world.integrations.rows[0].tools.map((t) => [t.name, t.policy]))
  assert.deepEqual(stored(), { list_issues: 'allow', create_issue: 'off', create_comment: 'off', update_issue: 'off', delete_issue: 'off' }, 'stored consent is left alone until the person asks')
  const after = await world.service.integrationAllowChanges(world.ada, { integrationId: before.integrationId })
  assert.deepEqual(after.turnedOn.sort(), ['create_comment', 'create_issue', 'update_issue'])
  assert.deepEqual(stored(), { list_issues: 'allow', create_issue: 'allow', create_comment: 'allow', update_issue: 'allow', delete_issue: 'off' })
  for (const row of world.connections.rows) assert.deepEqual(Object.fromEntries(row.tools.map((t) => [t.name, t.policy])), stored(), 'each slate follows')
  assert.equal(toolSummary(after), 'Looks things up with 1 tool · Makes changes with 3 (you approve each one) · 1 off')
  assert.equal(changesOffer(after), null, 'nothing left to offer')
  assert.ok(world.audits.some((a) => a.kind === 'integration_allow_changes' && a.integrationId === before.integrationId))
  await refusedWith(world.service.integrationAllowChanges(world.ada, { integrationId: before.integrationId }), 'nothing_to_turn_on')
  // someone else's integration is not found
  await refusedWith(world.service.integrationAllowChanges(world.sam, { integrationId: before.integrationId }), 'not_found')
})

test('let it make changes too keeps a tool someone turned off on one slate, if the integration allowed it', async () => {
  const world = makeWorld()
  const row = await world.connectReadOnly('/tracker/mcp')
  await world.service.integrationInvite(world.ada, { shareId: 'shareA', integrationId: row.integrationId })
  const copy = world.connections.rows[0]
  await world.connections.update(copy._id, { tools: copy.tools.map((t) => (t.name === 'list_issues' ? { ...t, policy: 'off' } : t)) })
  await world.service.integrationAllowChanges(world.ada, { integrationId: row.integrationId })
  const here = Object.fromEntries(world.connections.rows[0].tools.map((t) => [t.name, t.policy]))
  assert.equal(here.list_issues, 'off', 'a choice made on that slate stays')
  assert.equal(here.create_issue, 'allow')
})

test('at the read-only address the server cannot make changes: allowChanges says sign in at the full address', async () => {
  const world = makeWorld()
  const row = await world.connectReadOnly('/open/mcp')
  assert.equal(row.writesAt, world.card.url)
  assert.deepEqual(changesOffer(row), { kind: 'address', address: world.card.url })
  await refusedWith(world.service.integrationAllowChanges(world.ada, { integrationId: row.integrationId }), 'sign_in_at_full_address')
})

test('moving to the card\'s own address: the same integration (name, colour, rule, slates), its slates follow, the read-only sign-in is removed', async () => {
  const world = makeWorld()
  const old = await world.connectReadOnly('/open/mcp', 'Linear')
  await world.service.integrationSetRule(world.ada, { integrationId: old.integrationId, rule: 'my_slates' })
  await world.service.integrationInvite(world.ada, { shareId: 'shareA', integrationId: old.integrationId })
  const colour = world.integrations.rows[0].colorIndex
  const found = await world.service.discover(world.ada, { address: world.card.url })
  const moved = await world.service.integrationConnect(world.ada, { address: found.address, name: 'Linear', tools: found.tools.map(({ name, hash, policy }) => ({ name, hash, policy })), replaces: old.integrationId })
  assert.equal(moved.integrationId, old.integrationId)
  assert.equal(world.integrations.rows.length, 1, 'never a second Linear')
  const doc = world.integrations.rows[0]
  assert.equal(doc.address, found.address)
  assert.equal(doc.movedFrom, old.address)
  assert.equal(doc.rule, 'my_slates')
  assert.equal(doc.colorIndex, colour)
  assert.equal(moved.writesAt, null)
  assert.deepEqual(Object.fromEntries(doc.tools.map((t) => [t.name, t.policy])), { list_issues: 'allow', create_issue: 'allow', create_comment: 'allow', update_issue: 'allow', delete_issue: 'off' })
  const copy = world.connections.rows[0]
  assert.equal(copy.address, found.address, 'the slate\'s copy calls the full address now')
  assert.equal(copy.integrationId, old.integrationId)
  assert.equal(copy.tools.find((t) => t.name === 'create_issue').policy, 'allow')
  assert.deepEqual(world.removedSignIns, [['ada', old.address]])
  assert.ok(world.audits.some((a) => a.kind === 'integration_moved'))
  // the moved integration is still invitable and listed once
  const { integrations } = await world.service.integrationsList(world.ada)
  assert.equal(integrations.length, 1)
  assert.equal(integrations[0].slateCount, 1)
})

test('replaces is refused for an address that is not where that integration makes changes, or one already connected', async () => {
  const world = makeWorld()
  const old = await world.connectReadOnly('/open/mcp', 'Linear')
  const tracker = await world.service.discover(world.ada, { address: world.card.url })
  const choose = tracker.tools.map(({ name, hash, policy }) => ({ name, hash, policy }))
  // an integration at the full address already: refused, never merged by itself
  const second = await world.connectReadOnly('/tracker/mcp', 'Tracker')
  await refusedWith(world.service.integrationConnect(world.ada, { address: tracker.address, name: 'Linear', tools: choose, replaces: old.integrationId }), 'already_connected')
  // an integration at its card's own address cannot be "moved" there
  await world.service.integrationDisconnect(world.ada, { integrationId: old.integrationId })
  await refusedWith(world.service.integrationConnect(world.ada, { address: tracker.address, name: 'Tracker', tools: choose, replaces: second.integrationId }), 'invalid_request')
})

test('integrations.allowChanges is a person-only registry action; integrations.connect takes replaces', () => {
  const actions = integrationActions(() => ({}))
  const allow = actions.find((a) => a.id === 'integrations.allowChanges')
  assert.ok(allow)
  assert.deepEqual(allow.principals, ['person'], 'an agent never widens an agent\'s rights')
  assert.ok(actions.find((a) => a.id === 'integrations.connect').input.properties.replaces)
  assert.equal(cardFor('https://mcp.linear.app/mcp/readonly').id, 'linear')
})
