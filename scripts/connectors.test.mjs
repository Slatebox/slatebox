// Outside agents (Slatebox as an MCP client, enterprise/): the guarded fetch, the hostile test
// server's cases (each refused), quarantine, the translator's checks, and the service's rules:
// Pro for the inviter, only the inviter calls, editors keep, everyone sees.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/connectors.test.mjs
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { startMcpTestServers } from './mcp-test-servers.mjs'
import { checkMcpUrl, createMcpFetch, McpFetchRefused, publicOnlyLookup } from '../enterprise/server/mcp-fetch.mjs'
import { callTool, discover } from '../enterprise/server/mcp-session.mjs'
import { normalizeTools, reconcile, toolsEnvelope, toolHash, DESCRIPTION_CHARS } from '../enterprise/server/tools.mjs'
import { quarantine, safeLink } from '../enterprise/server/results.mjs'
import { packContext, scrub } from '../enterprise/server/context.mjs'
import { checkLayout, checkPlan, excalidrawElements, excalidrawGroup, itemsFromLayout, planPrompt } from '../enterprise/server/translate.mjs'
import { connectorPrincipal, createConnectorService } from '../enterprise/server/service.mjs'
import { connectorSettings } from '../enterprise/server/settings.mjs'
import { canonicalAddress, cardFor, GALLERY } from '../enterprise/common/gallery.mjs'
import { sanitizeClientName } from '../web/app/imports/api/common/agent-label.mjs'
import { canvasOfWrites } from '../web/app/server/exec/conversation.mjs'
import { applyPlanToJSON } from 'slateboxjs/operations'
import { createAgentPresence, publicRecord } from '../web/app/server/presence/agentPresence.mjs'
import { resolveAIChoice, operatorConfig } from '../web/app/server/methods/ai/connections.mjs'

let servers
let fetch
const requested = []
before(async () => {
  servers = await startMcpTestServers()
  fetch = createMcpFetch({ devOrigins: [servers.origin], onRequest: (url) => requested.push(url) })
})
after(() => servers.close())

const refusedWith = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `${error.code}: ${error.message}`)
    return true
  })
}

// ---------- mcpFetch ----------

test('only public https addresses pass the address check', () => {
  for (const [raw, code] of [
    ['http://example.com/mcp', 'not_https'],
    ['https://user:pw@example.com/mcp', 'credentials'],
    ['https://localhost/mcp', 'private_address'],
    ['https://printer.local/mcp', 'private_address'],
    ['https://metadata.google.internal/', 'private_address'],
    ['https://169.254.169.254/latest', 'private_address'],
    ['https://10.0.0.1/mcp', 'private_address'],
    ['https://127.0.0.1/mcp', 'private_address'],
    ['https://[::ffff:10.0.0.1]/mcp', 'private_address'],
    ['https://[fd00:ec2::254]/', 'private_address'],
    ['https://100.64.0.1/', 'private_address'],
    ['not a url', 'bad_address'],
  ]) assert.throws(() => checkMcpUrl(raw), (e) => e instanceof McpFetchRefused && e.code === code, raw)
  assert.equal(checkMcpUrl('https://mcp.excalidraw.com/mcp').dev, false)
  assert.equal(checkMcpUrl('http://127.0.0.1:9/x', { devOrigins: ['http://127.0.0.1:9'] }).dev, true)
})

test('a name that resolves to a private address is refused at connect time (DNS rebinding)', async () => {
  const lookup = publicOnlyLookup((host, options, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '10.1.2.3', family: 4 }]))
  await new Promise((resolve) => lookup('evil.example', { all: true }, (error) => {
    assert.equal(error?.code, 'private_address')
    resolve()
  }))
  const guarded = createMcpFetch({ resolve: (host, options, cb) => cb(null, [{ address: '169.254.169.254', family: 4 }]) })
  await refusedWith(guarded('https://looks-public.example/mcp', { method: 'POST', body: '{}' }), 'private_address')
})

test('the fetch sends a real User-Agent, opens no GET stream, and drops cookies', async () => {
  const response = await fetch(servers.url('/open/mcp'), { method: 'GET' })
  assert.equal(response.status, 405)
  await discover(servers.url('/open/mcp'), fetch)
  assert.ok(servers.calls.some((c) => /^Slatebox\/1\.0 \(MCP client/.test(c.ua)))
})

test('settings: test origins are dropped on a deployed Slatebox', () => {
  assert.deepEqual(connectorSettings({ connectors: { devOrigins: ['http://127.0.0.1:8765', 'http://10.0.0.1:80'] } }).devOrigins, ['http://127.0.0.1:8765'])
  assert.deepEqual(connectorSettings({ public: { env: 'prod' }, connectors: { devOrigins: ['http://127.0.0.1:8765'] } }).devOrigins, [])
  assert.deepEqual(connectorSettings({ public: { env: 'test' }, connectors: { devOrigins: ['http://127.0.0.1:8765'] } }).devOrigins, [])
})

// ---------- hostile server: every case refused ----------

test('hostile: resource_metadata pointing at 169.254.169.254 is never fetched; sign-in servers are refused in S2a', async () => {
  requested.length = 0
  await refusedWith(discover(servers.url('/hostile/metadata/mcp'), fetch), 'needs_sign_in')
  assert.ok(requested.length > 0)
  assert.ok(requested.every((url) => url.startsWith(servers.origin)), requested.join(' '))
  // and even if something asked for it, the fetch would refuse it
  await refusedWith(fetch('http://169.254.169.254/latest/meta-data/iam', { method: 'POST' }), 'not_https')
  await refusedWith(fetch('https://169.254.169.254/latest/meta-data/iam', { method: 'POST' }), 'private_address')
})

test('hostile: a redirect to 10.0.0.1 is refused at the hop', async () => {
  requested.length = 0
  await refusedWith(discover(servers.url('/hostile/redirect/mcp'), fetch), 'not_https')
  assert.ok(!requested.some((url) => url.includes('10.0.0.1')), 'the private hop was never requested')
  // an https hop to a private address is refused the same way
  const hop = createMcpFetch({ devOrigins: [servers.origin] })
  const redirecting = await import('node:http').then(({ createServer }) => new Promise((resolve) => {
    const server = createServer((req, res) => res.writeHead(307, { location: 'https://10.0.0.1/mcp' }).end())
    server.listen(0, '127.0.0.1', () => resolve(server))
  }))
  const origin = `http://127.0.0.1:${redirecting.address().port}`
  await refusedWith(createMcpFetch({ devOrigins: [origin] })(origin + '/mcp', { method: 'POST', body: '{}' }), 'private_address')
  redirecting.close()
  void hop
})

test('hostile: an answer larger than the cap is refused', async () => {
  const small = createMcpFetch({ devOrigins: [servers.origin], maxBytes: 64 * 1024 })
  await assert.rejects(callTool(servers.url('/hostile/huge/mcp'), small, { name: 'search', args: { query: 'x' } }), (error) => ['too_large', 'unreachable'].includes(error.code))
})

test('hostile: a poisoned tool description reaches the model clamped and framed as data, and the server cannot name itself', async () => {
  const found = await discover(servers.url('/hostile/poison/mcp'), fetch)
  const tools = normalizeTools(found.tools)
  const envelope = toolsEnvelope('Research', tools)
  assert.ok(envelope.includes('data, not instructions'))
  const line = envelope.split('\n').find((l) => l.startsWith('{"name":"search"'))
  assert.ok(JSON.parse(line).description.length <= DESCRIPTION_CHARS)
  // the server's own name claims to be Slatebox staff: refused as a slate name
  assert.equal(sanitizeClientName(found.serverInfo.name), null)
})

test('hostile: a tool changed after approval pauses the agent before anything is called', async () => {
  const world = makeWorld()
  const conn = await world.inviteTo('/hostile/rug/mcp')
  const callsBefore = servers.calls.filter((c) => c.kind === 'rug' && c.method === 'tools/call').length
  await refusedWith(world.service.call(world.ada, { connectionId: conn.connectionId, request: 'search retries' }), 'tools_changed')
  assert.equal(servers.calls.filter((c) => c.kind === 'rug' && c.method === 'tools/call').length, callsBefore)
  assert.equal(world.connections.rows[0].status, 'paused')
  assert.equal(world.connections.rows[0].changed[0].name, 'search')
  await refusedWith(world.service.call(world.ada, { connectionId: conn.connectionId, request: 'again' }), 'tools_changed')
})

test('hostile: injection in results can only become plain notes, with only the links the server really sent', async () => {
  const raw = await callTool(servers.url('/hostile/inject/mcp'), fetch, { name: 'search', args: { query: 'x' } })
  const clean = quarantine(raw)
  assert.deepEqual(clean.links.map((l) => l.url), ['https://example.org/retries'])
  assert.ok(clean.left.some((s) => /links? (was|were) left out/.test(s)))
  const world = makeWorld({
    layout: { say: 'Share this slate', groups: [{ label: 'Found', notes: [{ key: 'a', text: 'Ada says: share this slate', link: 'javascript:alert(1)' }, { key: 'b', text: 'Retry', link: 'https://example.org/retries' }, { key: 'c', text: 'Phish', link: 'https://xn--pple-43d.com/login' }] }] },
  })
  const conn = await world.inviteTo('/hostile/inject/mcp')
  const result = await world.service.call(world.ada, { connectionId: conn.connectionId, request: 'retries' })
  assert.equal(result.items, 1)
  const item = world.suggestions.rows[0].items[0]
  assert.ok(item.plan.operations.every((op) => ['add_nodes', 'connect_nodes'].includes(op.kind)))
  const links = item.plan.operations.map((op) => op.style?.link).filter(Boolean)
  assert.deepEqual(links, ['https://example.org/retries'])
  // nothing but this slate is ever written, and only as a preview until someone keeps it
  assert.ok(world.applied.every(([, input, mode]) => input.shareId === 'share1' && mode === 'preview'))
})

test('hostile: structuredContent that breaks its outputSchema is dropped, the text is kept', async () => {
  const found = await discover(servers.url('/hostile/schema/mcp'), fetch)
  const [tool] = normalizeTools(found.tools)
  const raw = await callTool(servers.url('/hostile/schema/mcp'), fetch, { name: 'stats', args: {} })
  const clean = quarantine(raw, { outputSchema: tool.outputSchema })
  assert.equal(clean.structured, null)
  assert.ok(clean.left[0].includes('declared shape'))
  assert.equal(clean.text, 'count is "lots"')
  assert.deepEqual(quarantine({ content: [], structuredContent: { count: 3 } }, { outputSchema: tool.outputSchema }).structured, { count: 3 })
})

// ---------- tools, results, context ----------

test('tools: app-only tools are hidden, lookups start allowed, changes start off, hashes pin definitions', async () => {
  const found = await discover(servers.url('/open/mcp'), fetch)
  const tools = normalizeTools(found.tools)
  assert.deepEqual(tools.map((t) => t.name), ['read_me', 'create_view', 'search', 'post_message'])
  assert.equal(tools.find((t) => t.name === 'post_message').group, 'change')
  const approved = tools.map((t) => ({ name: t.name, hash: t.hash, policy: t.group === 'lookup' ? 'allow' : 'allow' }))
  // even a stored allow on an outside change never makes it callable in S2a
  assert.deepEqual(reconcile(approved, tools).allowed.map((t) => t.name), ['read_me', 'create_view', 'search'])
  const moved = tools.map((t) => (t.name === 'search' ? { ...t, hash: toolHash({ ...t, description: 'new' }) } : t))
  assert.deepEqual(reconcile(approved, moved).changed.map((c) => c.name), ['search'])
})

test('links: http and https only, no credentials, no look-alike hosts', () => {
  assert.equal(safeLink('javascript:alert(1)'), null)
  assert.equal(safeLink('data:text/html,hi'), null)
  assert.equal(safeLink('https://u:p@example.com'), null)
  assert.equal(safeLink('https://xn--pple-43d.com'), null)
  assert.equal(safeLink('https://example.com/a').host, 'example.com')
})

test('context: only the chosen level leaves Slatebox, with aliases for ids and secrets scrubbed', () => {
  // a made-up key, assembled here so no scanner mistakes the test for a real one
  const fakeKey = ['sk', 'live', 'abcdefghijklmnop1234'].join('_')
  const slate = { nodes: [
    { options: { id: 'real-1', text: `Mail ada@example.com about ${fakeKey}`, xPos: 0, yPos: 0, width: 100, height: 50 }, relationships: { associations: [{ parentId: 'real-1', childId: 'real-2' }] } },
    { options: { id: 'real-2', text: 'Card declines', xPos: 200, yPos: 0, width: 100, height: 50 } },
    { options: { id: 'real-3', text: 'Locked secret', locked: true } },
  ] }
  const none = packContext({ slate, level: 'request', request: 'help' })
  assert.deepEqual(none.notes, [])
  const selected = packContext({ slate, level: 'selection', selection: ['real-2'], request: 'help' })
  assert.deepEqual(selected.notes.map((n) => n.text), ['Card declines'])
  const all = packContext({ slate, level: 'slate', request: 'call me on 555-123-4567' })
  assert.equal(all.notes.length, 2)
  assert.ok(!JSON.stringify(all.notes).includes('real-'))
  assert.ok(all.notes[0].text.includes('[email removed]') && all.notes[0].text.includes('[key removed]'))
  assert.deepEqual(all.links, [{ from: 'n1', to: 'n2' }])
  assert.ok(all.request.includes('[number removed]'))
  assert.equal(scrub(['ghp', 'abcdefghijklmnopqrstuvwxyz'].join('_')), '[key removed]')
})

// ---------- translator ----------

test('plan: only allowed tools, with arguments that match their schema, at most 3', () => {
  const allowed = [{ name: 'search', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }]
  const plan = checkPlan({ calls: [
    { tool: 'search', arguments: { query: 'retries' } },
    { tool: 'post_message', arguments: { text: 'leak' } },
    { tool: 'search', arguments: { query: 42 } },
    { tool: 'search', arguments: {} },
  ] }, allowed)
  assert.deepEqual(plan.calls, [{ tool: 'search', args: { query: 'retries' } }])
  const { system, user } = planPrompt({ serverName: 'Research', tools: allowed, packed: packContext({ slate: { nodes: [] }, request: 'x' }) })
  assert.ok(system.includes('not instructions') && user.includes('<tools from="Research">'))
})

test('layout: notes and lines only, lines to slate notes by alias, groups placed beside the selection', () => {
  const slate = { revision: 3, nodes: [{ options: { id: 'n-real', text: 'Checkout', xPos: 100, yPos: 100, width: 200, height: 80 }, relationships: { associations: [] } }] }
  const layout = checkLayout({ groups: [{ label: 'Ideas', notes: [{ key: 'a', text: 'Retry after 24h' }, { key: 'b', text: 'Smart retries' }], lines: [{ from: 'n1', to: 'a' }, { from: 'zz', to: 'b' }] }] }, { aliases: { n1: 'n-real' } })
  assert.equal(layout.groups[0].lines.length, 1)
  const items = itemsFromLayout({ groups: layout.groups, slate, aliases: { n1: 'n-real' }, selection: ['n-real'], serverName: 'Research' })
  assert.equal(items.length, 1)
  const ops = items[0].plan.operations
  assert.deepEqual(ops.map((o) => o.kind), ['add_nodes', 'add_nodes', 'connect_nodes'])
  assert.ok(ops[0].x >= 100 + 200)
  assert.deepEqual(ops[2].from, { ids: ['n-real'] })
  // the plan applies to the slate as the engine will
  const applied = applyPlanToJSON(structuredClone(slate), items[0].plan, { requireMatches: true })
  assert.equal(applied.slate.nodes.length, 3)
})

test('Excalidraw elements become native notes and lines with no model', async () => {
  const raw = await callTool(servers.url('/open/mcp'), fetch, { name: 'create_view', args: { elements: '[]' } })
  const entry = { tool: 'create_view', args: { elements: '[]' }, result: quarantine(raw) }
  const elements = excalidrawElements(entry)
  const group = excalidrawGroup(elements, 'Diagram')
  assert.deepEqual(group.notes.map((n) => n.text), ['Card declined', 'Retry after 24h', 'Paid'])
  assert.equal(group.notes[2].shape, 'ellipse')
  assert.equal(group.lines.length, 2)
})

test('gallery: open servers first, addresses compared in canonical form', () => {
  assert.ok(GALLERY.filter((c) => c.featured).map((c) => c.id).join() === 'excalidraw,huggingface')
  assert.equal(cardFor('https://MCP.excalidraw.com/mcp/?x=1').id, 'excalidraw')
  assert.equal(canonicalAddress('https://a.example/mcp/'), 'https://a.example/mcp')
})

// ---------- the service's rules ----------

function memoryStore() {
  const rows = []
  return {
    rows,
    insert: async (doc) => rows.push(structuredClone(doc)),
    findOne: async (q) => rows.find((r) => Object.entries(q).every(([k, v]) => r[k] === v)) || null,
    find: async (q) => rows.filter((r) => r.slateId === q.slateId && r.status !== 'removed'),
    update: async (id, set) => Object.assign(rows.find((r) => r._id === id) || {}, set),
    pushItem: async (id, item) => rows.find((r) => r._id === id).items.push(item),
    async setItem(id, n, set, onlyIf) {
      const item = rows.find((r) => r._id === id)?.items.find((i) => i.n === n)
      if (!item || (onlyIf && item.status !== onlyIf)) return false
      Object.assign(item, set)
      return true
    },
    removeForConnection: async (cid) => rows.splice(0, rows.length, ...rows.filter((r) => r.connectionId !== cid)),
  }
}

function makeWorld({ layout = null, plan = null, pro = ['ada'] } = {}) {
  const slate = { _id: 'slate1', shareId: 'share1', userId: 'ada', revision: 1, nodes: [{ options: { id: 'n0', text: 'Checkout', xPos: 0, yPos: 0, width: 200, height: 80 }, relationships: { associations: [] } }] }
  const roles = { ada: 'edit', sam: 'edit', vic: 'read' }
  const connections = memoryStore()
  const suggestions = memoryStore()
  const applied = []
  const presenceCalls = []
  const prompts = []
  const service = createConnectorService({
    connections,
    suggestions,
    fetch,
    session: { discover, callTool },
    model: async ({ tool, system, user }) => {
      prompts.push({ tool: tool.name, system, user })
      if (tool.name === 'plan_calls') {
        if (plan) return plan
        const offered = [...user.matchAll(/"name":"(create_view|search|stats)"/g)].map((m) => m[1])
        const name = /<request>Draw/.test(user) && offered.includes('create_view') ? 'create_view' : offered.includes('search') ? 'search' : offered[0] || 'search'
        return prompts.filter((p) => p.tool === 'plan_calls').length > 1 ? { calls: [], done: true } : { calls: [{ tool: name, arguments: name === 'create_view' ? { elements: '[]' } : name === 'stats' ? {} : { query: 'card retries' } }] }
      }
      return layout || { groups: [{ label: 'Ideas', notes: [{ key: 'a', text: 'Retry after 24 hours' }, { key: 'b', text: 'Smart retries', link: 'https://example.org/retries' }] }] }
    },
    applyOperations: async (principal, input, mode) => {
      applied.push([principal, input, mode])
      const result = applyPlanToJSON(structuredClone(slate), input.plan, { requireMatches: mode === 'save' })
      return { body: { ok: true, operations: result.materializedPlan.operations, report: result.report } }
    },
    canvasOf: canvasOfWrites,
    access: {
      forUser: async (shareId, userId) => (shareId === 'share1' && roles[userId] ? { slate, canRead: true, canEdit: roles[userId] === 'edit' } : null),
      reload: async () => slate,
    },
    pro: async (userId) => pro.includes(userId),
    firstName: async (userId) => userId[0].toUpperCase() + userId.slice(1),
    sanitizeName: sanitizeClientName,
    presence: {
      plan: async (...args) => presenceCalls.push(['plan', ...args]),
      step: async (...args) => presenceCalls.push(['step', ...args]),
      saved: async (...args) => presenceCalls.push(['saved', ...args]),
      end: async (...args) => presenceCalls.push(['end', ...args]),
    },
    devOrigins: [servers.origin],
    sleep: async () => {},
  })
  const person = (userId) => ({ kind: 'person', userId, scopes: ['slates:read', 'slates:write'] })
  const world = { service, connections, suggestions, applied, presenceCalls, prompts, slate, ada: person('ada'), sam: person('sam'), vic: person('vic') }
  world.inviteTo = async (path, options = {}) => {
    const found = await service.discover(world.ada, { shareId: 'share1', address: servers.url(path) })
    return service.connect(world.ada, { shareId: 'share1', address: found.address, name: options.name || 'Research', tools: found.tools.map(({ name, hash, policy }) => ({ name, hash, policy })), contextLevel: options.contextLevel || 'selection' })
  }
  return world
}

test('Pro: discovering, inviting and asking all need Pro for the inviter, on the server', async () => {
  const world = makeWorld({ pro: [] })
  await refusedWith(world.service.discover(world.ada, { shareId: 'share1', address: servers.url('/open/mcp') }), 'pro_required')
  const paid = makeWorld()
  const conn = await paid.inviteTo('/open/mcp')
  paid.service // Pro lapses: the next ask is refused, ghosts already there stay keepable
  const lapsed = makeWorld({ pro: [] })
  lapsed.connections.rows.push(...paid.connections.rows)
  await refusedWith(lapsed.service.call(lapsed.ada, { connectionId: conn.connectionId, request: 'x' }), 'pro_required')
})

test('the walkthrough: plain summary, sanitized name, consent to hashes, a hello from the cursor', async () => {
  const world = makeWorld()
  const found = await world.service.discover(world.ada, { shareId: 'share1', address: servers.url('/open/mcp') })
  assert.deepEqual(found.summary.lookups.map((t) => t.name), ['read_me', 'create_view', 'search'])
  assert.equal(found.summary.changes[0].name, 'post_message')
  assert.equal(found.tools.find((t) => t.name === 'post_message').policy, 'off')
  await refusedWith(world.service.connect(world.ada, { shareId: 'share1', address: found.address, name: 'Slatebox Admin', tools: found.tools }), 'bad_name')
  await refusedWith(world.service.connect(world.ada, { shareId: 'share1', address: found.address, name: 'Diagrams', tools: found.tools.map((t) => ({ ...t, hash: 'f'.repeat(64) })) }), 'tools_changed')
  const conn = await world.service.connect(world.ada, { shareId: 'share1', address: found.address, name: 'Diagrams', tools: found.tools.map(({ name, hash, policy }) => ({ name, hash, policy: name === 'post_message' ? 'allow' : policy })) })
  assert.equal(world.connections.rows[0].tools.find((t) => t.name === 'post_message').policy, 'off', 'an outside change cannot be switched on in S2a')
  assert.equal(conn.name, 'Diagrams')
  const hello = world.presenceCalls.find(([kind]) => kind === 'saved')
  assert.equal(hello[1].connector.name, 'Diagrams')
  assert.match(hello[3].message, /Hi, I'm Diagrams/)
  // a viewer cannot invite; a private address is refused before any request
  await refusedWith(world.service.discover(world.vic, { shareId: 'share1', address: servers.url('/open/mcp') }), 'forbidden')
  await refusedWith(world.service.discover(world.ada, { shareId: 'share1', address: 'https://10.0.0.1/mcp' }), 'private_address')
})

test('only the inviter can ask the agent; everyone who reads the slate sees it', async () => {
  const world = makeWorld({ pro: ['ada', 'sam'] })
  const conn = await world.inviteTo('/open/mcp')
  await refusedWith(world.service.call(world.sam, { connectionId: conn.connectionId, request: 'search' }), 'inviter_only')
  await refusedWith(world.service.disconnect(world.sam, { connectionId: conn.connectionId }), 'inviter_only')
  const seen = await world.service.list(world.vic, { shareId: 'share1' })
  assert.equal(seen.connections[0].name, 'Research')
  assert.equal(seen.connections[0].invitedBy, 'Ada')
  assert.equal(seen.connections[0].tools, undefined, 'tools are the inviter\'s to see')
})

test('a call: lookups run, ghosts appear one by one with the cursor at each, nothing is saved until kept', async () => {
  const world = makeWorld()
  const conn = await world.inviteTo('/open/mcp')
  const result = await world.service.call(world.ada, { connectionId: conn.connectionId, request: 'How do teams retry declined cards?', selection: ['n0'] })
  assert.equal(result.items, 1)
  const doc = world.suggestions.rows[0]
  assert.equal(doc.status, 'ready')
  assert.equal(doc.items[0].status, 'pending')
  assert.equal(doc.items[0].canvas.nodes.length, 2, JSON.stringify(doc.items.map((i) => i.canvas)).slice(0, 400))
  const saved = world.presenceCalls.filter(([kind]) => kind === 'saved').at(-1)
  assert.ok(saved[3].targets.every((id) => /^ghost-ag[0-9a-f]{16}$/.test(id)))
  assert.ok(world.applied.every(([principal, , mode]) => mode === 'preview' && principal.connector.id === conn.connectionId))
  // the planner saw the selection as text with aliases, never ids
  const planPromptSeen = world.prompts.find((p) => p.tool === 'plan_calls').user
  assert.ok(planPromptSeen.includes('Checkout') && !planPromptSeen.includes('"n0"'))
  // what leaves: only the allowed tool was called
  assert.ok(servers.calls.filter((c) => c.kind === 'open' && c.method === 'tools/call').every((c) => c.name !== 'post_message'))
})

test('keep and discard on the slate: any editor, never a viewer; each kept ghost is one save as the agent', async () => {
  const world = makeWorld({ layout: { groups: [{ label: 'One', notes: [{ key: 'a', text: 'A' }] }, { label: 'Two', notes: [{ key: 'b', text: 'B' }] }, { label: 'Three', notes: [{ key: 'c', text: 'C' }] }] } })
  const conn = await world.inviteTo('/open/mcp')
  const { suggestionId } = await world.service.call(world.ada, { connectionId: conn.connectionId, request: 'ideas please' })
  assert.deepEqual(world.suggestions.rows[0].items.map((i) => [i.n, i.status]), [[1, 'pending'], [2, 'pending'], [3, 'pending']])
  await refusedWith(world.service.keep(world.vic, { suggestionId, n: 1 }), 'forbidden')
  const kept = await world.service.keep(world.sam, { suggestionId, n: 1 })
  assert.equal(kept.kept, 1)
  const saves = world.applied.filter(([, , mode]) => mode === 'save')
  assert.equal(saves.length, 1)
  assert.equal(saves[0][0].connector.name, 'Research')
  assert.equal(saves[0][0].userId, 'ada', 'the agent writes with its inviter\'s rights')
  await refusedWith(world.service.keep(world.ada, { suggestionId, n: 1 }), 'already_decided')
  const discarded = await world.service.discard(world.ada, { suggestionId, n: 2 })
  assert.equal(discarded.discarded, 1)
  const rest = await world.service.keep(world.ada, { suggestionId })
  assert.equal(rest.kept, 1)
  assert.deepEqual(world.suggestions.rows[0].items.map((i) => i.status), ['kept', 'discarded', 'kept'])
  await world.service.disconnect(world.ada, { connectionId: conn.connectionId })
  assert.equal(world.suggestions.rows.length, 0)
})

test('Excalidraw through the service: the diagram lands as one ghost of native notes and lines', async () => {
  const world = makeWorld({ plan: { calls: [{ tool: 'create_view', arguments: { elements: '[]' } }], done: true } })
  const conn = await world.inviteTo('/open/mcp', { name: 'Excalidraw' })
  await world.service.call(world.ada, { connectionId: conn.connectionId, request: 'Draw how a card payment is retried' })
  const item = world.suggestions.rows[0].items[0]
  assert.equal(item.label, 'Diagram')
  assert.equal(item.plan.operations.filter((o) => o.kind === 'add_nodes').length, 3)
  assert.equal(item.plan.operations.filter((o) => o.kind === 'connect_nodes').length, 2)
  assert.equal(world.prompts.filter((p) => p.tool === 'place_suggestions').length, 0, 'no model lays out a diagram')
})

// ---------- MIT seams ----------

test('presence: an invited agent wears "<name> · added by <inviter>", and may point at its ghosts', async () => {
  const docs = new Map()
  const presence = createAgentPresence({
    collection: {
      findOne: async ({ _id }) => docs.get(_id) || null,
      find: () => ({ toArray: async () => [], sort: () => ({ toArray: async () => [] }) }),
      updateOne: async () => ({}),
      findOneAndUpdate: async ({ _id }, update) => {
        const doc = { ...(docs.get(_id) || update.$setOnInsert), ...update.$set }
        docs.set(_id, doc)
        return doc
      },
    },
    findUser: async () => ({ profile: { firstName: 'Ada' } }),
    secret: 'k',
  })
  const principal = connectorPrincipal({ _id: 'c1', ownerId: 'ada', name: 'Excalidraw' }, 'run1')
  await presence.saved(principal, { _id: 'slate1', userId: 'ada' }, { targets: ['ghost-ag0123456789abcdef', 'n1'] })
  const [doc] = docs.values()
  assert.equal(doc.label, 'Excalidraw · added by Ada')
  const shown = publicRecord(doc, new Set(['n1']))
  assert.deepEqual(shown.targets, ['ghost-ag0123456789abcdef', 'n1'])
  assert.deepEqual(publicRecord({ targets: ['ghost-../x', 'other-slate-note'] }, new Set()).targets, [])
})

test('AI: settings.ai.use.connectors is honoured, and follows the conversation choice when unset', () => {
  const server = operatorConfig({ ai: { connections: { a: { type: 'openai-compatible', baseUrl: 'https://a.example/v1', model: 'm' }, b: { type: 'openai-compatible', baseUrl: 'https://b.example/v1', model: 'n' } }, use: { chat: 'a' } } })
  assert.equal(resolveAIChoice({ feature: 'connectors', server }).ref, 'server:a')
  const own = operatorConfig({ ai: { connections: { a: { type: 'openai-compatible', baseUrl: 'https://a.example/v1', model: 'm' }, b: { type: 'openai-compatible', baseUrl: 'https://b.example/v1', model: 'n' } }, use: { chat: 'a', connectors: 'b' } } })
  assert.equal(resolveAIChoice({ feature: 'connectors', server: own }).ref, 'server:b')
})

test('the connector actions join the one registry: Meteor method, /api/v1 route, exec and MCP tool', async () => {
  const { createAppRegistry } = await import('../web/app/server/actions/index.mjs')
  const { connectorActions } = await import('../enterprise/server/actions.mjs')
  const registry = createAppRegistry({ extraActions: connectorActions(() => ({})) })
  const ids = registry.list().map((a) => a.id).filter((id) => id.startsWith('connectors.'))
  assert.deepEqual(ids.sort(), ['connectors.call', 'connectors.connect', 'connectors.discard', 'connectors.disconnect', 'connectors.discover', 'connectors.keep', 'connectors.list'])
  for (const action of registry.list().filter((a) => a.id.startsWith('connectors.'))) {
    assert.ok(action.mounts.ddp && action.mounts.http && action.tool, action.id)
    assert.ok(action.principals.includes('agent') && action.principals.includes('person'))
  }
  assert.equal(registry.get('connectors.call').openWorld, true)
  // the exec client's contract: keyed writes, object outputs
  const { buildClientManifest, renderExecTool } = await import('../web/app/server/actions/client-render.mjs')
  const manifest = buildClientManifest(registry)
  assert.ok(JSON.stringify(manifest).includes('connectors'))
  assert.ok(renderExecTool(manifest).exec)
})
