// Agents read and write (owner, 2026-11-24: "linear should be read and write, right? every mcp that
// we connect to should be this way, as much as possible"): tools are classified (annotations, then
// names, then an administrator's recipe word); changes start allowed and destructive ones off; a
// change the person asks for is planned but never made during the ask: it lands in the answer as an
// action card its inviter approves by keeping it (or declines by discarding it); act without asking
// makes it at once (never a destructive one); undo leaves what was done outside and says so; the
// gallery's write recipes; and the registry actions for cards on every surface.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/agents-read-write.test.mjs
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { startMcpTestServers, TRACKER_TOOLS } from './mcp-test-servers.mjs'
import { createMcpFetch } from '../enterprise/server/mcp-fetch.mjs'
import { callTool, discover } from '../enterprise/server/mcp-session.mjs'
import { createConnectorService, memoryStore } from '../enterprise/server/service.mjs'
import { connectorActions, integrationActions } from '../enterprise/server/actions.mjs'
import { asksForChange, capabilitySummary, classifyTool, defaultPolicy, normalizeTools, reconcile } from '../enterprise/server/tools.mjs'
import { checkWrites, writePlanPrompt } from '../enterprise/server/translate.mjs'
import { checkRecipe, matchWrite } from '../enterprise/server/recipes.mjs'
import { cardFor, GALLERY } from '../enterprise/common/gallery.mjs'
import { actsWithoutAsking, cardLabel, cardText, linkOf, previewOf } from '../enterprise/server/outside.mjs'
import { packContext } from '../enterprise/server/context.mjs'
import { promptText } from '../web/app/server/ai-control/prompts/index.mjs'
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

// Ada owns slate A, where Sam may edit and Vic may read.
function makeWorld({ writes = [{ tool: 'create_issue', arguments: { title: 'Retry fails on 502', description: 'Retries stop after one 502.', team: 'ENG' } }], cards = GALLERY } = {}) {
  const slate = { _id: 'slateA', shareId: 'shareA', userId: 'ada', revision: 1, nodes: [{ options: { id: 'n0', text: 'Retry bug: stops after one 502', xPos: 0, yPos: 0, width: 200, height: 80 }, relationships: { associations: [] } }] }
  const roles = { ada: 'edit', sam: 'edit', vic: 'read' }
  const connections = memoryStore()
  const integrations = memoryStore()
  const outside = memoryStore()
  const live = connectorSuggestions(slate)
  const audits = []
  const prompts = []
  const plan = { writes }
  const options = {
    connections,
    integrations,
    outside,
    suggestions: {
      ...live.suggestions,
      retext: (s, change) => live.store.retext(s, change),
      actionOf: async (s, actionId) => (await live.store.list(s._id)).find((a) => a._id === actionId) || null,
      keep: async (person, s, actionId, itemIds) => decideKeep(person, actionId, itemIds),
      discardItems: (person, s, actionId, itemIds) => live.store.discard(person, s, { actionId, itemIds }),
    },
    fetch,
    session: { discover, callTool },
    model: async ({ tool, system, user }) => {
      prompts.push({ tool: tool.name, system, user })
      if (system.includes('You propose the changes')) return { calls: plan.writes }
      if (tool.name === 'plan_calls') return { calls: [{ tool: 'list_issues', arguments: { query: 'retry' } }], done: true }
      return { groups: [{ label: 'Found', notes: [{ key: 'a', text: 'ENG-12 Retry declined cards' }] }] }
    },
    applyOperations: live.applyOperations,
    access: {
      forUser: async (shareId, userId) => (shareId === 'shareA' && roles[userId] ? { slate, canRead: true, canEdit: roles[userId] === 'edit' } : null),
      forToken: async (principal, shareId) => (shareId === 'shareA' && roles[principal.userId] ? { slate, canRead: true, canEdit: roles[principal.userId] === 'edit' } : null),
      reload: async () => slate,
    },
    pro: async () => true,
    firstName: async (userId) => userId[0].toUpperCase() + userId.slice(1),
    sanitizeName: sanitizeClientName,
    presence: { plan: async () => {}, step: async () => {}, saved: async () => {}, end: async () => {} },
    vault: { available: () => true, describe: async () => null, tokenFor: async () => null, remove: async () => ({ removed: true }) },
    devOrigins: [servers.origin],
    gallery: async () => cards,
    sleep: async () => {},
    later: () => {},
    audit: (entry) => audits.push(entry),
  }
  const service = createConnectorService(options)
  // As the app's suggestions.decide does it (server/actions/agent-suggestions.mjs): the gate first, then the store.
  async function decideKeep(principal, actionId, itemIds) {
    const gate = await service.gate(principal, slate, { decision: 'keep', actionId, itemIds })
    const choice = { actionId, itemIds }
    if (Array.isArray(gate?.itemIds)) {
      if (!gate.itemIds.length) return { kept: [], refused: [], held: gate.held }
      choice.itemIds = gate.itemIds
    }
    const out = await live.store.keep(principal, slate, choice, live.saver)
    return { ...out, held: gate?.held || [] }
  }
  async function decide(principal, decision, actionId, itemIds) {
    if (decision === 'keep') return decideKeep(principal, actionId, itemIds)
    const gate = await service.gate(principal, slate, { decision, actionId, itemIds })
    if (decision === 'discard') return live.store.discard(principal, slate, { actionId, itemIds })
    const out = await live.store.undo(principal, slate, { actionId, skip: gate?.skip || [] }, live.saver)
    return { ...out, left: [...(out.left || []), ...(gate?.left || [])] }
  }
  const person = (userId) => ({ kind: 'person', userId, scopes: ['slates:read', 'slates:write'] })
  const token = (userId) => ({ kind: 'agent', userId, tokenId: 't-' + userId, scopes: ['slates:read', 'slates:write'] })
  const world = { service, options, slate, connections, integrations, outside, live, audits, prompts, plan, decide, ada: person('ada'), sam: person('sam'), vic: person('vic'), adaToken: token('ada') }
  world.invite = async (path = '/tracker/mcp', { name = 'Tracker', policy = {} } = {}) => {
    const found = await service.discover(world.ada, { shareId: 'shareA', address: servers.url(path) })
    return service.connect(world.ada, { shareId: 'shareA', address: found.address, name, tools: found.tools.map(({ name: tool, hash, policy: p }) => ({ name: tool, hash, policy: policy[tool] || p })) })
  }
  world.action = async () => (await live.store.list('slateA')).at(-1)
  world.cardItem = async (card) => (await world.action()).items.find((i) => i.nodeId === card.nodeId)
  const since = servers.calls.length
  world.writeCalls = () => servers.calls.slice(since).filter((c) => c.kind === 'tracker' && c.method === 'tools/call' && c.name !== 'list_issues')
  return world
}

// ---------- classification ----------

test('tools are classified by annotations first, then names, then an administrator\'s word; destructive names always warn', () => {
  const kind = (name, annotations, override) => classifyTool({ name, annotations }, override)
  assert.equal(kind('list_issues', { readOnlyHint: true }), 'lookup')
  assert.equal(kind('create_view', { readOnlyHint: true }), 'lookup', 'a read-only claim is the server\'s word')
  assert.equal(kind('delete_issue', { readOnlyHint: true, destructiveHint: true }), 'destructive')
  assert.equal(kind('create_issue', {}), 'change')
  assert.equal(kind('issue_write', { readOnlyHint: false, destructiveHint: false }), 'change')
  assert.equal(kind('merge_pull_request', { readOnlyHint: false, destructiveHint: false }), 'destructive', 'a name that merges is destructive whatever it claims')
  assert.equal(kind('closeIssue', undefined), 'destructive', 'camelCase names are read too')
  assert.equal(kind('search', undefined), 'lookup')
  assert.equal(kind('resolve-library-id', undefined), 'lookup')
  assert.equal(kind('web_search_exa', undefined), 'lookup')
  assert.equal(kind('frobnicate', undefined), 'change', 'a name that says nothing is asked for, never assumed safe')
  assert.equal(kind('frobnicate', undefined, 'lookup'), 'lookup')
  assert.equal(kind('create_issue', {}, 'destructive'), 'destructive')
  assert.equal(kind('create_issue', {}, 'nonsense'), 'change')
  const tools = normalizeTools(TRACKER_TOOLS, { update_issue: 'destructive' })
  assert.deepEqual(tools.map((t) => [t.name, t.group, Boolean(t.destructive), defaultPolicy(t)]), [
    ['list_issues', 'lookup', false, 'allow'],
    ['create_issue', 'change', false, 'allow'],
    ['create_comment', 'change', false, 'allow'],
    ['update_issue', 'change', true, 'off'],
    ['delete_issue', 'change', true, 'off'],
  ])
  // the override is not part of the hash consent is given to: the server's definition is
  assert.equal(tools[3].hash, normalizeTools(TRACKER_TOOLS)[3].hash)
  const summary = capabilitySummary(tools)
  assert.deepEqual(summary.changes.map((c) => [c.name, c.destructive]), [['create_issue', false], ['create_comment', false], ['update_issue', true], ['delete_issue', true]])
  assert.match(summary.changes.find((c) => c.name === 'create_issue').lands, /card you approve/)
  assert.match(summary.changes.find((c) => c.name === 'delete_issue').lands, /off unless you turn it on/)
  // reconcile: lookups run, changes are writable (only ever proposed)
  const approved = tools.map((t) => ({ name: t.name, hash: t.hash, policy: defaultPolicy(t) }))
  const now = reconcile(approved, tools)
  assert.deepEqual(now.allowed.map((t) => t.name), ['list_issues'])
  assert.deepEqual(now.writable.map((t) => t.name), ['create_issue', 'create_comment'])
})

test('a change is planned only when the person\'s own words ask for one these tools make', () => {
  const writable = [{ name: 'create_issue' }, { name: 'create_comment' }, { name: 'update_issue' }]
  assert.equal(asksForChange('file the retry bug', writable), true)
  assert.equal(asksForChange('open an issue for this', [{ name: 'issue_write' }]), true)
  assert.equal(asksForChange('comment on ENG-12 that it is fixed', writable), true)
  assert.equal(asksForChange('mark ENG-12 done', writable), true)
  assert.equal(asksForChange('what is in the current cycle?', writable), false)
  assert.equal(asksForChange('make a couple notes about retries', writable), false, 'notes on the slate are not a change elsewhere')
  assert.equal(asksForChange('file the retry bug', [{ name: 'post_message' }]), false, 'no tool here makes that')
})

test('the change planner: its own prompt, the request and slate as data, only change tools, recipe values fixed', () => {
  const tools = normalizeTools(TRACKER_TOOLS).filter((t) => t.group === 'change')
  const packed = packContext({ slate: { nodes: [{ options: { id: 'n0', text: 'Retry bug', xPos: 0, yPos: 0 } }] }, level: 'selection', selection: ['n0'], request: 'file the retry bug' })
  const { system, user } = writePlanPrompt({ serverName: 'Tracker', tools, packed, text: promptText, calls: 2 })
  assert.match(system, /Nothing you propose happens until a person approves it/)
  assert.match(system, /Propose at most 2 calls/)
  assert.ok(user.includes('<request>file the retry bug</request>') && user.includes('<tools from="Tracker">') && user.includes('Retry bug'))
  const issue = tools.find((t) => t.name === 'create_issue')
  const checked = checkWrites({ calls: [
    { tool: 'create_issue', arguments: { title: 'Retry fails', team: 'ENG' } },
    { tool: 'list_issues', arguments: {} },
    { tool: 'create_issue', arguments: { title: 42, team: 'ENG' } },
    { tool: 'create_issue', arguments: { title: 'B', team: 'ENG' } },
    { tool: 'create_issue', arguments: { title: 'C', team: 'ENG' } },
    { tool: 'create_issue', arguments: { title: 'D', team: 'ENG' } },
  ] }, [issue], { limit: 2 })
  assert.deepEqual(checked.calls.map((c) => c.args.title), ['Retry fails', 'B'], 'only allowed change tools, valid arguments, capped')
  // a recipe's fixed values win over the planner's (and only keys the tool declares travel)
  const write = { name: 'issue_write', inputSchema: { type: 'object', properties: { method: { type: 'string' }, title: { type: 'string' } }, required: ['method', 'title'] } }
  assert.deepEqual(checkWrites({ calls: [{ tool: 'issue_write', arguments: { method: 'update', title: 'X' } }] }, [write], { fixed: { method: 'create', other: 1 } }).calls[0].args, { method: 'create', title: 'X' })
})

// ---------- action cards ----------

test('an ask for a change: nothing is changed during the ask; one card lands in the answer\'s frame, saying what, where and who approves', async () => {
  const world = makeWorld()
  const conn = await world.invite()
  const stored = world.connections.rows[0].tools
  assert.equal(stored.find((t) => t.name === 'create_issue').policy, 'allow', 'changes start allowed')
  assert.equal(stored.find((t) => t.name === 'delete_issue').policy, 'off', 'destructive ones start off')
  const asked = await world.service.call(world.ada, { connectionId: conn.connectionId, request: 'file the retry bug', selection: ['n0'] })
  assert.equal(world.writeCalls().length, 0, 'nothing reached the outside server\'s change tools')
  assert.equal(asked.cards.length, 1)
  const [card] = asked.cards
  assert.equal(card.state, 'waiting')
  assert.equal(card.label, 'Create Tracker issue')
  assert.deepEqual(card.preview, { title: 'Retry fails on 502', body: 'Retries stop after one 502.', target: 'Team: ENG' })
  assert.match(asked.say, /One change waits for your approval/)
  // the change planner ran alone (no lookups for an ask for a change), with the change tools only
  const planners = world.prompts.filter((p) => p.tool === 'plan_calls')
  assert.equal(planners.length, 1)
  assert.match(planners[0].system, /You propose the changes/)
  assert.ok(planners[0].user.includes('create_issue') && !planners[0].user.includes('"delete_issue"') && !planners[0].user.includes('"list_issues"'))
  // the card is one more note in the same answer (one frame, one action)
  const action = await world.action()
  assert.deepEqual(asked.actions, [action._id])
  const item = await world.cardItem(world.outside.rows[0])
  assert.equal(item.state, 'pending')
  assert.match(item.node.options.text, /^Create Tracker issue: Retry fails on 502\nTeam: ENG\nRetries stop after one 502\.\nWaiting for Ada to approve/)
  assert.equal(world.slate.revision, 1, 'nothing saved')
})

test('Keep all never approves a card; only the inviter approves it by keeping it alone; the card then says done, with its link', async () => {
  const world = makeWorld()
  const conn = await world.invite()
  world.plan.writes = [{ tool: 'create_issue', arguments: { title: 'Retry fails on 502', team: 'ENG' } }]
  await world.service.call(world.ada, { connectionId: conn.connectionId, request: 'file the retry bug' })
  const card = world.outside.rows[0]
  const item = await world.cardItem(card)
  // Keep all (no itemIds): the card waits, said why
  const all = await world.decide(world.ada, 'keep', card.actionId)
  assert.equal(all.held.length, 1)
  assert.match(all.held[0].reason, /on its own card/)
  assert.equal(world.writeCalls().length, 0)
  // another editor may not approve it (the same rule as asking)
  const sam = await world.decide(world.sam, 'keep', card.actionId, [item.id])
  assert.deepEqual(sam.kept, [])
  assert.match(sam.held[0].reason, /Only Ada can approve Tracker's changes/)
  assert.equal(world.writeCalls().length, 0)
  // the inviter keeps it: the change is made once, then the note is kept as its record
  const ada = await world.decide(world.ada, 'keep', card.actionId, [item.id])
  assert.deepEqual(ada.kept.map((k) => k.itemId), [item.id])
  assert.equal(world.writeCalls().length, 1)
  assert.deepEqual(world.writeCalls()[0].args, { title: 'Retry fails on 502', team: 'ENG' })
  assert.equal(card.state, 'done')
  assert.equal(card.result.link, 'https://tracker.example/issue/ENG-99')
  assert.equal(card.decidedBy, 'Ada')
  const saved = world.slate.nodes.find((n) => n.options.id === card.nodeId)
  assert.match(saved.options.text, /^Done · Create Tracker issue: Retry fails on 502\nTeam: ENG\nhttps:\/\/tracker\.example\/issue\/ENG-99\nApproved by Ada\./)
  assert.equal(saved.options.link?.data, 'https://tracker.example/issue/ENG-99')
  assert.ok(world.audits.some((a) => a.kind === 'outside_write' && a.ok && a.by === 'Ada'))
  // approving again changes nothing outside
  await world.service.approve(world.ada, { cardId: card._id })
  assert.equal(world.writeCalls().length, 1)
})

test('the inviter may let editors approve; the slate owner may narrow it back but never widen it', async () => {
  const world = makeWorld()
  world.slate.userId = 'sam' // Sam owns the slate; Ada invited the agent
  const conn = await world.invite()
  await refusedWith(world.service.setActing(world.sam, { connectionId: conn.connectionId, approvers: 'editors' }), 'inviter_only')
  await refusedWith(world.service.setActing(world.sam, { connectionId: conn.connectionId, actWithoutAsking: 'on' }), 'inviter_only')
  await refusedWith(world.service.setActing(world.vic, { connectionId: conn.connectionId, approvers: 'inviter' }), 'inviter_only')
  await refusedWith(world.service.setActing(world.adaToken, { connectionId: conn.connectionId, approvers: 'editors' }), 'person_required')
  const set = await world.service.setActing(world.ada, { connectionId: conn.connectionId, approvers: 'editors' })
  assert.equal(set.approvers, 'editors')
  await world.service.call(world.ada, { connectionId: conn.connectionId, request: 'file the retry bug' })
  const card = world.outside.rows.find((r) => r.kind === 'card')
  const item = await world.cardItem(card)
  assert.match(item.node.options.text, /Keep approves, Discard declines\.$/)
  // Sam (an editor) approves now
  const kept = await world.decide(world.sam, 'keep', card.actionId, [item.id])
  assert.equal(kept.kept.length, 1)
  assert.equal(card.decidedBy, 'Sam')
  // the owner narrows it back; the history says so
  await world.service.setActing(world.sam, { connectionId: conn.connectionId, approvers: 'inviter' })
  const listed = await world.service.outsideList(world.vic, { shareId: 'shareA' })
  assert.deepEqual(listed.activity.map((a) => a.by), ['Sam', 'Ada'])
  assert.match(listed.activity[0].text, /Only Ada approves Tracker's changes here/)
  assert.equal(listed.cards[0].state, 'done')
  assert.equal(listed.cards[0].mine, false)
  assert.ok(world.audits.some((a) => a.kind === 'act_without_asking' && a.byOwner))
})

test('Discard declines a card: nothing changes outside; a token may decline but never approve unless the agent acts without asking', async () => {
  const world = makeWorld()
  const conn = await world.invite()
  await world.service.call(world.ada, { connectionId: conn.connectionId, request: 'file the retry bug' })
  const card = world.outside.rows[0]
  await refusedWith(world.service.approve(world.adaToken, { cardId: card._id }), 'approver_only')
  await refusedWith(world.service.approve(world.vic, { cardId: card._id }), 'forbidden')
  const item = await world.cardItem(card)
  await world.decide(world.sam, 'discard', card.actionId, [item.id])
  assert.equal(card.state, 'declined')
  assert.equal(card.decidedBy, 'Sam')
  assert.equal(world.writeCalls().length, 0)
  await refusedWith(world.service.approve(world.ada, { cardId: card._id }), 'declined')
  // decline through the action takes the note off the slate too
  await world.service.call(world.ada, { connectionId: conn.connectionId, request: 'file another bug about retries' })
  const second = world.outside.rows.filter((r) => r.kind === 'card').at(-1)
  const out = await world.service.decline(world.adaToken, { cardId: second._id })
  assert.equal(out.card.state, 'declined')
  assert.equal((await world.cardItem(second)).state, 'discarded')
})

test('act without asking: the change is made during the ask and its card says so; destructive ones still wait; a token may then approve', async () => {
  const world = makeWorld()
  const conn = await world.invite('/tracker/mcp', { policy: { delete_issue: 'allow' } })
  await world.service.setActing(world.ada, { connectionId: conn.connectionId, actWithoutAsking: 'on' })
  world.plan.writes = [
    { tool: 'create_issue', arguments: { title: 'Retry fails on 502', team: 'ENG' } },
    { tool: 'delete_issue', arguments: { id: 'ENG-1' } },
  ]
  const asked = await world.service.call(world.ada, { connectionId: conn.connectionId, request: 'file the retry bug and delete issue ENG-1' })
  assert.deepEqual(asked.cards.map((c) => [c.tool, c.state, c.actedWithoutAsking]), [['create_issue', 'done', true], ['delete_issue', 'waiting', false]])
  assert.deepEqual(world.writeCalls().map((c) => c.name), ['create_issue'])
  const done = world.outside.rows.find((r) => r.tool === 'create_issue')
  assert.match((await world.cardItem(done)).node.options.text, /Tracker did this without asking\./)
  const destructive = world.outside.rows.find((r) => r.tool === 'delete_issue')
  assert.match((await world.cardItem(destructive)).node.options.text, /deletes, closes or merges something/)
  // a token may approve for an agent that acts without asking, never a destructive change
  await refusedWith(world.service.approve(world.adaToken, { cardId: destructive._id }), 'approver_only')
  await world.service.approve(world.ada, { cardId: destructive._id })
  assert.equal(destructive.state, 'done')
  // the integration's choice: on by default for its slates unless the slate says otherwise
  await world.service.setActing(world.ada, { connectionId: conn.connectionId, actWithoutAsking: 'inherit' })
  assert.equal(actsWithoutAsking(world.connections.rows[0], world.integrations.rows[0]), false)
  const integration = await world.service.integrationSetActing(world.ada, { integrationId: world.integrations.rows[0]._id, actWithoutAsking: true })
  assert.equal(integration.actWithoutAsking, true)
  assert.equal(actsWithoutAsking(world.connections.rows[0], world.integrations.rows[0]), true)
  await refusedWith(world.service.integrationSetActing(world.sam, { integrationId: world.integrations.rows[0]._id, actWithoutAsking: true }), 'not_found')
  // the slate owner (Ada here) turns it off for this slate
  await world.service.setActing(world.ada, { connectionId: conn.connectionId, actWithoutAsking: 'off' })
  assert.equal(actsWithoutAsking(world.connections.rows[0], world.integrations.rows[0]), false)
  assert.ok(world.audits.some((a) => a.kind === 'integration_act_without_asking'))
})

test('a refused change says why plainly and can be tried again; undo leaves what was done outside and says so', async () => {
  const world = makeWorld({ writes: [{ tool: 'create_issue', arguments: { title: 'FAIL', team: 'ENG' } }] })
  const conn = await world.invite()
  await world.service.call(world.ada, { connectionId: conn.connectionId, request: 'file the retry bug' })
  const card = world.outside.rows[0]
  const item = await world.cardItem(card)
  const tried = await world.decide(world.ada, 'keep', card.actionId, [item.id])
  assert.deepEqual(tried.kept, [])
  assert.equal(card.state, 'failed')
  assert.equal(card.error, 'The server said: Team <b>ENG</b> is archived.')
  const ghost = await world.cardItem(card)
  assert.equal(ghost.state, 'pending', 'it stays waiting, to try again or discard')
  assert.match(ghost.node.options.text, /^Couldn't do · Create Tracker issue: FAIL\nThe server said: Team <b>ENG<\/b> is archived\.\nKeep to try again, Discard to drop it\.$/, 'plain text (a note never renders markup)')
  // it worked the second time (the server stopped refusing)
  card.args = { title: 'Retry fails', team: 'ENG' }
  await world.decide(world.ada, 'keep', card.actionId, [item.id])
  assert.equal(card.state, 'done')
  // keep the rest of the answer, then undo it: the notes go, the card stays, and the undo says why
  await world.decide(world.ada, 'keep', card.actionId)
  const undone = await world.decide(world.ada, 'undo', card.actionId)
  assert.ok(world.slate.nodes.some((n) => n.options.id === card.nodeId))
  assert.match(undone.left.at(-1).reason, /stays done in Tracker: Slatebox can't undo a change made outside it\. Open it there to change it\./)
})

test('consent still holds: a change tool the person turned off is never proposed, and a moved definition is refused at approval', async () => {
  const world = makeWorld()
  const conn = await world.invite('/tracker/mcp', { policy: { create_issue: 'off', create_comment: 'off', update_issue: 'off' } })
  await refusedWith(world.service.call(world.ada, { connectionId: conn.connectionId, request: 'file the retry bug' }).then((r) => {
    if (!r.cards) throw Object.assign(new Error('no card'), { code: 'no_card' })
    return r
  }), 'no_card')
  // allowed again, then its stored hash no longer matches what the server lists: the approval is refused
  const again = makeWorld()
  const c2 = await again.invite()
  await again.service.call(again.ada, { connectionId: c2.connectionId, request: 'file the retry bug' })
  const card = again.outside.rows[0]
  card.hash = 'f'.repeat(64)
  const item = await again.cardItem(card)
  const tried = await again.decide(again.ada, 'keep', card.actionId, [item.id])
  assert.deepEqual(tried.kept, [])
  assert.equal(card.state, 'failed')
  assert.match(card.error, /may no longer make that change/)
  assert.equal(again.writeCalls().length, 0)
})

test('removing the agent declines its waiting cards; an approval after that is refused', async () => {
  const world = makeWorld()
  const conn = await world.invite()
  await world.service.call(world.ada, { connectionId: conn.connectionId, request: 'file the retry bug' })
  const card = world.outside.rows[0]
  await world.service.disconnect(world.ada, { connectionId: conn.connectionId })
  assert.equal(card.state, 'declined')
  await refusedWith(world.service.approve(world.ada, { cardId: card._id }), 'not_found')
})

test('an ask with no change in it never runs the change planner (lookups as before)', async () => {
  const world = makeWorld()
  const conn = await world.invite()
  const asked = await world.service.call(world.ada, { connectionId: conn.connectionId, request: 'what issues mention retries?' })
  assert.equal(asked.cards, undefined)
  assert.ok(!world.prompts.some((p) => p.system.includes('You propose the changes')))
  assert.equal(world.outside.rows.length, 0)
})

// ---------- cards, words and links ----------

test('card words: labels from the recipe or the tool, previews from typed arguments, links only https', () => {
  assert.equal(cardLabel({ tool: 'create_issue', system: 'Linear' }), 'Create Linear issue')
  assert.equal(cardLabel({ tool: 'add_issue_comment', system: 'GitHub' }), 'Add GitHub issue comment')
  assert.equal(cardLabel({ tool: 'issue_write', system: 'GitHub', label: 'Open GitHub issue' }), 'Open GitHub issue')
  assert.equal(cardLabel({ tool: 'issue_write', system: 'GitHub' }), 'GitHub: issue write')
  assert.deepEqual(previewOf({ owner: 'ana', repo: 'shop', title: 'Retry', body: 'Details', issue_number: 42 }), { title: 'Retry', body: 'Details', item: '#42', target: 'ana/shop' })
  assert.deepEqual(previewOf({ issueId: 'ENG-12', body: 'Fixed in 1.2' }, { body: ['body'], item: ['issueId'] }), { body: 'Fixed in 1.2', item: 'ENG-12' })
  const words = cardText({ label: 'Create Linear issue', system: 'Linear', state: 'waiting', preview: { title: 'x'.repeat(500) } }, { inviter: 'Ada' })
  assert.ok(words.length <= 400)
  assert.equal(linkOf({ content: [{ type: 'text', text: 'see javascript:alert(1) or http://plain.example/x or https://ok.example/i/1.' }] }), 'https://ok.example/i/1')
  assert.equal(linkOf({ structuredContent: { issue: { html_url: 'https://github.com/a/b/issues/3' } }, content: [] }), 'https://github.com/a/b/issues/3')
  assert.equal(linkOf({ content: [{ type: 'resource_link', uri: 'https://xn--pple-43d.com/x' }] }), null)
})

test('gallery: Linear is read and write at its full address (its read-only one is the same card); write recipes match their asks', () => {
  const linear = cardFor('https://mcp.linear.app/mcp')
  assert.equal(linear.id, 'linear')
  assert.equal(cardFor('https://mcp.linear.app/mcp/readonly').id, 'linear', 'agents invited at the read-only address keep their card')
  const linearRecipe = checkRecipe(linear.recipe)
  const names = (list) => new Set(list)
  assert.deepEqual(matchWrite(linearRecipe, 'file the retry bug', names(['create_issue', 'update_issue'])).tool, 'create_issue')
  assert.deepEqual(matchWrite(linearRecipe, 'file the retry bug', names(['save_issue'])).tool, 'save_issue', 'newer releases name it save_issue')
  assert.equal(matchWrite(linearRecipe, 'comment on ENG-12 that it is fixed', names(['create_comment'])).write.key, 'comment')
  assert.equal(matchWrite(linearRecipe, 'mark ENG-12 done', names(['update_issue'])).write.key, 'update-status')
  assert.equal(matchWrite(linearRecipe, 'what is in the current cycle?', names(['create_issue'])), null)
  const github = checkRecipe(GALLERY.find((c) => c.id === 'github').recipe)
  const issue = matchWrite(github, 'open an issue for this in ana/shop', names(['issue_write', 'create_pull_request']))
  assert.equal(issue.tool, 'issue_write')
  assert.deepEqual(issue.write.args, { method: 'create' })
  assert.equal(matchWrite(github, 'open a PR from fix-retries', names(['issue_write'])), null, 'a pull request only where the server offers it')
  assert.equal(matchWrite(github, 'open a PR from fix-retries', names(['create_pull_request'])).write.key, 'create-pr')
  assert.equal(github.tools.merge_pull_request, 'destructive')
  // an administrator's recipe is checked: bad words and patterns are dropped
  const checked = checkRecipe({ tools: { ok_tool: 'lookup', 'bad name': 'lookup', other: 'admin' }, writes: [{ key: 'x', tool: 'create_issue', keywords: ['(a+)+$'] }, { key: 'y', tool: 'create_issue', keywords: ['\\bfile\\b'], args: { method: 'create', nested: { a: 1 } } }] })
  assert.deepEqual(checked.tools, { ok_tool: 'lookup' })
  assert.deepEqual(checked.writes.map((w) => [w.key, w.args]), [['y', { method: 'create' }]])
})

test('the card actions join the one registry: approve and decline on every surface; acting choices are a person\'s, in the app', async () => {
  const { createAppRegistry } = await import('../web/app/server/actions/index.mjs')
  const registry = createAppRegistry({ extraActions: [...connectorActions(() => ({})), ...integrationActions(() => ({}))] })
  for (const id of ['connectors.approve', 'connectors.decline', 'connectors.outsideActions']) {
    const action = registry.get(id)
    assert.ok(action.mounts.ddp && action.mounts.http && action.tool, id)
    assert.ok(action.principals.includes('agent'), id)
  }
  assert.equal(registry.get('connectors.approve').tool.name, 'approve_agent_change')
  assert.equal(registry.get('connectors.approve').openWorld, true)
  assert.equal(registry.get('connectors.outsideActions').mounts.http.path, '/slates/{shareId}/agent-changes')
  for (const id of ['connectors.setActing', 'integrations.setActing']) {
    const action = registry.get(id)
    assert.deepEqual(action.principals, ['person'], id)
    assert.ok(!action.mounts.http && !action.tool, id)
  }
  assert.match(registry.get('suggestions.decide').description, /action card/)
})
