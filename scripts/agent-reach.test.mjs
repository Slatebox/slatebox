// Agent reach: counting agent clients (agent-reach/usage-core.mjs) on /mcp and /api/v1, the
// Overview's Agents card, the share-of-voice job (sov-core.mjs) and the plain chat request both
// it and the pick-rate eval send (plain-chat.mjs). Fakes only: no Meteor, no database, no network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  UNKNOWN_CLIENT, agentSummary, cleanClient, clientFromUserAgent, createAgentUsage, dayOf,
} from '../web/app/server/agent-reach/usage-core.mjs'
import {
  DEFAULT_QUESTIONS, LEASE_MS, SETTINGS_ID, WEEK_MS, analyzeAnswer, cleanQuestions, createShareOfVoice, summarizeResults,
} from '../web/app/server/agent-reach/sov-core.mjs'
import { plainChat, scrubKey } from '../web/app/server/agent-reach/plain-chat.mjs'
import { createMcpHandler, reportedClientInfo } from '../web/app/server/mcp/endpoint.mjs'
import { localSummary } from '../web/app/server/admin/dashboard-core.mjs'
import { promotionalWords } from '../web/app/server/actions/agent-surface.mjs'

const read = (path) => readFileSync(new URL(`../web/app/${path}`, import.meta.url), 'utf8')

// ---------- a small in-memory collection: the Mongo calls these modules make ----------
const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc)
const set = (doc, path, value) => {
  const keys = path.split('.')
  let node = doc
  for (const k of keys.slice(0, -1)) node = node[k] ??= {}
  node[keys.at(-1)] = value
}
function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some((f) => matches(doc, f))
    if (key === '$and') return cond.every((f) => matches(doc, f))
    const value = get(doc, key)
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      return Object.entries(cond).every(([op, arg]) => {
        const v = value instanceof Date ? value.getTime() : value
        const a = arg instanceof Date ? arg.getTime() : arg
        if (op === '$exists') return (value !== undefined) === arg
        if (op === '$gte') return v !== undefined && v !== null && v >= a
        if (op === '$lte') return v !== undefined && v !== null && v <= a
        if (op === '$lt') return v !== undefined && v !== null && v < a
        if (op === '$in') return arg.includes(value)
        if (op === '$ne') return value !== arg
        throw new Error(`fake: ${op}`)
      })
    }
    return cond === null ? value === null || value === undefined : value === cond
  })
}
function fakeCollection(seed = []) {
  const docs = new Map(seed.map((d) => [d._id, structuredClone(d)]))
  const cursor = (list) => {
    let rows = list
    const c = {
      sort(spec) { const [[k, dir]] = Object.entries(spec); rows = [...rows].sort((a, b) => (get(a, k) > get(b, k) ? dir : get(a, k) < get(b, k) ? -dir : 0)); return c },
      skip(n) { rows = rows.slice(n); return c },
      limit(n) { rows = rows.slice(0, n); return c },
      toArray: async () => rows.map((d) => structuredClone(d)),
    }
    return c
  }
  return {
    docs,
    async findOne(filter) { return [...docs.values()].find((d) => matches(d, filter)) ?? null },
    find(filter = {}) { return cursor([...docs.values()].filter((d) => matches(d, filter))) },
    async insertOne(doc) { docs.set(doc._id, structuredClone(doc)) },
    async deleteMany(filter) { for (const d of [...docs.values()]) if (matches(d, filter)) docs.delete(d._id) },
    async updateOne(filter, update, { upsert = false } = {}) {
      let doc = [...docs.values()].find((d) => matches(d, filter))
      let inserted = false
      if (!doc) {
        if (!upsert) return { modifiedCount: 0, upsertedCount: 0 }
        if (filter._id !== undefined && docs.has(filter._id)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
        doc = { _id: filter._id }
        inserted = true
        for (const [k, v] of Object.entries(update.$setOnInsert || {})) set(doc, k, v)
      }
      for (const [k, v] of Object.entries(update.$set || {})) set(doc, k, v)
      for (const [k, v] of Object.entries(update.$inc || {})) set(doc, k, (get(doc, k) || 0) + v)
      for (const k of Object.keys(update.$unset || {})) delete doc[k]
      docs.set(doc._id, doc)
      return { modifiedCount: inserted ? 0 : 1, upsertedCount: inserted ? 1 : 0 }
    },
  }
}

// ---------- client names ----------
test('client names: what the client says, cleaned; never an address or a key', () => {
  assert.equal(cleanClient('claude-ai', '0.1.0'), 'claude-ai 0.1.0')
  assert.equal(cleanClient('  Cursor\u0000 '), 'Cursor')
  assert.equal(cleanClient('me@example.com'), UNKNOWN_CLIENT)
  assert.equal(cleanClient('see https://x.test'), UNKNOWN_CLIENT)
  assert.equal(cleanClient('sk-abcdefghijk123'), UNKNOWN_CLIENT)
  assert.equal(cleanClient(42), UNKNOWN_CLIENT)
  assert.ok(cleanClient('x'.repeat(200), '1.2.3').length <= 60)
  assert.equal(clientFromUserAgent('slatebox-mcp/0.3.5 node/22'), 'slatebox-mcp 0.3.5')
  assert.equal(clientFromUserAgent('curl/8.4.0'), 'curl 8.4.0')
  assert.equal(clientFromUserAgent('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36'), 'browser')
  assert.equal(clientFromUserAgent(''), UNKNOWN_CLIENT)
  assert.equal(clientFromUserAgent(undefined), UNKNOWN_CLIENT)
})

// ---------- counting ----------
const T0 = Date.parse('2026-11-24T15:00:00Z')

test('counting: connections and calls per day, surface and client; calls per tool; counts only', async () => {
  const days = fakeCollection()
  const firsts = fakeCollection()
  let now = T0
  const usage = createAgentUsage({ days, firsts, now: () => now })
  await usage.connection({ surface: 'mcp', client: 'claude-ai 0.1.0' })
  await usage.call({ surface: 'mcp', client: 'claude-ai 0.1.0', tool: 'import_mermaid' })
  await usage.call({ surface: 'mcp', client: 'claude-ai 0.1.0', tool: 'import_mermaid' })
  await usage.call({ surface: 'mcp', client: 'claude-ai 0.1.0', tool: 'Not A Tool!' })
  await usage.call({ surface: 'api', client: 'slatebox-mcp 0.3.5', tool: 'get_slate' })
  await usage.call({ surface: 'nowhere', client: 'x', tool: 'get_slate' })
  const row = days.docs.get('2026-11-24|mcp|claude-ai 0.1.0')
  assert.deepEqual({ connections: row.connections, calls: row.calls, tools: row.tools, day: row.day }, { connections: 1, calls: 3, tools: { import_mermaid: 2 }, day: '2026-11-24' })
  assert.equal(days.docs.size, 2)
  // only names and numbers are stored
  assert.deepEqual(Object.keys(row).sort(), ['_id', 'at', 'calls', 'client', 'connections', 'day', 'surface', 'tools'])
  now += 86_400_000
  await usage.call({ surface: 'mcp', client: 'claude-ai 0.1.0', tool: 'edit_slate' })
  assert.ok(days.docs.has('2026-11-25|mcp|claude-ai 0.1.0'))
})

test('first actions: written once per account, app or agent, and a failure never fails the call', async () => {
  const firsts = fakeCollection()
  const usage = createAgentUsage({ days: fakeCollection(), firsts, now: () => T0 })
  await usage.first({ userId: 'ann', via: 'mcp', client: 'Claude' })
  await usage.first({ userId: 'ann', via: 'app' })
  await usage.first({ userId: 'bob', via: 'app' })
  await usage.first({ userId: '', via: 'app' })
  assert.deepEqual(firsts.docs.get('ann'), { _id: 'ann', via: 'agent', surface: 'mcp', client: 'Claude', at: new Date(T0) })
  assert.equal(firsts.docs.get('bob').via, 'app')
  assert.equal(firsts.docs.size, 2)
  // a second process (nothing remembered) does not overwrite the first row
  await createAgentUsage({ days: fakeCollection(), firsts, now: () => T0 + 1 }).first({ userId: 'ann', via: 'app' })
  assert.equal(firsts.docs.get('ann').via, 'agent')
  const broken = { updateOne: async () => { throw new Error('db down') } }
  const warned = []
  const quiet = createAgentUsage({ days: broken, firsts: broken, log: { warn: (m) => warned.push(m) } })
  await quiet.call({ surface: 'mcp', client: 'x', tool: 'get_slate' })
  await quiet.first({ userId: 'z', via: 'api' })
  assert.equal(warned.length, 2)
})

test('the Agents card: this week against last, clients, top tools and new accounts that came by an agent', async () => {
  const day = (offset) => dayOf(T0 - offset * 86_400_000)
  const rows = [
    { day: day(0), surface: 'mcp', client: 'claude-ai', connections: 3, calls: 40, tools: { import_mermaid: 25, get_slate: 15 } },
    { day: day(2), surface: 'api', client: 'claude-ai', connections: 0, calls: 10, tools: { edit_slate: 10 } },
    { day: day(1), surface: 'mcp', client: 'cursor', connections: 1, calls: 5, tools: { create_slate: 5 } },
    { day: day(9), surface: 'mcp', client: 'cursor', connections: 2, calls: 20, tools: { create_slate: 20 } },
  ]
  const io = {
    days: async (since) => rows.filter((r) => Date.parse(`${r.day}T00:00:00Z`) >= since.getTime()),
    newAccounts: async () => [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }],
    firsts: async (ids) => [{ _id: 'a', via: 'agent', client: 'claude-ai' }, { _id: 'b', via: 'app' }].filter((f) => ids.includes(f._id)),
  }
  const out = await agentSummary({ io, now: T0 })
  assert.deepEqual(out.totals, { connections: 4, calls: 55, prevConnections: 2, prevCalls: 20 })
  assert.deepEqual(out.clients.map((c) => [c.client, c.surfaces, c.connections, c.calls, c.prevCalls]), [
    ['claude-ai', ['api', 'mcp'], 3, 50, 0], ['cursor', ['mcp'], 1, 5, 20],
  ])
  assert.deepEqual(out.tools.slice(0, 2), [{ tool: 'import_mermaid', calls: 25 }, { tool: 'get_slate', calls: 15 }])
  assert.deepEqual(out.newAccounts, { total: 3, viaAgent: 1, byClient: [{ client: 'claude-ai', accounts: 1 }] })
  assert.equal(out.since, day(6))
  // the Overview keeps it as a card of its own; a failure stays on that card
  const base = { people: async () => ({}), plans: async () => ({}), usage: async () => ({}), grants: async () => ({}), library: async () => ({ waiting: 0 }), emailsOf: async () => ({}) }
  const ok = await localSummary({ io: { ...base, agents: () => agentSummary({ io, now: T0 }) }, now: T0, month: '2026-11' })
  assert.equal(ok.agents.ok, true)
  assert.equal(ok.agents.totals.calls, 55)
  const bad = await localSummary({ io: { ...base, agents: async () => { throw new Error('nope') } }, now: T0, month: '2026-11' })
  assert.deepEqual(bad.agents, { ok: false, error: 'nope' })
  assert.equal((await localSummary({ io: base, now: T0, month: '2026-11' })).agents, undefined)
})

// ---------- the hosted /mcp endpoint reports what it sees ----------
test('/mcp: initialize counts a connection with clientInfo name and version; tool calls count by name, falling back to the token\'s last client', async () => {
  assert.deepEqual(reportedClientInfo({ method: 'initialize', params: { clientInfo: { name: 'claude-ai', version: '0.1.0' } } }), { name: 'claude-ai', version: '0.1.0' })
  assert.deepEqual(reportedClientInfo([{ method: 'tools/call', params: { _meta: { 'io.modelcontextprotocol/clientInfo': { name: 'Cursor' } } } }]), { name: 'Cursor', version: null })
  assert.equal(reportedClientInfo({ method: 'tools/list' }), null)

  const events = []
  const usage = {
    connection: async (e) => events.push(['connection', e]),
    call: async (e) => events.push(['call', e]),
    first: async (e) => events.push(['first', e]),
  }
  let callHandler
  class Server {
    setRequestHandler(schema, fn) { if (schema === 'call') callHandler = fn }
    async connect() {}
    async close() {}
  }
  class StreamableHTTPServerTransport {
    async handleRequest(_req, res, body) {
      const message = Array.isArray(body) ? body[0] : body
      if (message.method === 'tools/call') await callHandler({ params: message.params })
      res.status(200).json({ jsonrpc: '2.0', id: message.id, result: {} })
    }
    async close() {}
  }
  const sdk = { Server, StreamableHTTPServerTransport, ListToolsRequestSchema: 'list', CallToolRequestSchema: 'call' }
  const tools = { server: {}, instructions: 'x', instructionsExecOnly: 'x', exec: { name: 'exec' }, describe: { name: 'describe' }, typed: [], prompts: [], resources: [], resourceTemplates: [] }
  const registry = { get: () => null, run: async () => ({ body: { status: 'completed', calls: [], logs: [], result: null } }) }
  const handle = createMcpHandler({
    sdk, registry, manifest: { methods: [] }, tools, version: '1', appOrigin: null,
    authenticate: async () => ({ kind: 'agent', userId: 'ann', tokenId: 'tok', scopes: [] }),
    usage, lastClientOf: async () => 'Claude Desktop',
  })
  const res = () => {
    const r = { headers: {}, statusCode: 0, setHeader: (k, v) => { r.headers[k] = v }, status: (c) => { r.statusCode = c; return r }, json: (b) => { r.body = b; return r }, on: () => {}, writeHead: () => {} }
    return r
  }
  await handle({ method: 'POST', headers: {}, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-ai', version: '0.1.0' } } } }, res())
  await handle({ method: 'POST', headers: {}, body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'import_mermaid', arguments: { mermaid: 'secret text' } } } }, res())
  assert.deepEqual(events, [
    ['connection', { surface: 'mcp', client: 'claude-ai 0.1.0' }],
    ['call', { surface: 'mcp', client: 'Claude Desktop', tool: 'import_mermaid' }],
    ['first', { userId: 'ann', via: 'mcp', client: 'Claude Desktop' }],
  ])
  assert.ok(!JSON.stringify(events).includes('secret text'), 'never the arguments')
})

test('the glue: /api/v1 counts token calls by action and User-Agent, the app\'s methods note first actions, the Overview reads the card', () => {
  const http = read('server/actions/http.mjs')
  assert.match(http, /if \(onAgentCall && principal\.kind === 'agent'\) await Promise\.resolve\(onAgentCall\(principal, action, req\)\)\.catch\(\(\) => \{\}\)/)
  const mount = read('server/actions/mount.js')
  assert.match(mount, /onAgentCall: countApiCall/)
  assert.match(mount, /mountDdp\(noticingFirstAction\(registry\), \{/)
  const glue = read('server/agent-reach/usage-meteor.js')
  assert.match(glue, /clientFromUserAgent\(req\.get\('user-agent'\)\)/)
  assert.match(glue, /principal\?\.kind === 'person'/)
  assert.match(read('server/mcp/meteor.js'), /usage: agentUsage,\n\s+lastClientOf,/)
  assert.match(read('server/admin/meteor.js'), /agents: \(now\) => agentSummary\(\{ io: agentUsageIo, now \}\)/)
  const page = read('imports/ui/pages/admin/AdminOverview.jsx')
  assert.match(page, /<Agents data=\{data\.agents\} \/>/)
  assert.match(page, /<ShareOfVoiceCard \/>/)
  assert.doesNotMatch(page, />[^<]*\bAI usage\b/)
})

// ---------- share of voice ----------
test('answers: Slatebox named or not, its place among the products named, and the others in order', () => {
  assert.deepEqual(analyzeAnswer('1. Miro\n2. Slatebox, free and open source\n3. Excalidraw'), { mentioned: true, position: 2, competitors: ['Miro', 'Excalidraw'] })
  assert.deepEqual(analyzeAnswer('Try SlateBox first, or FigJam.'), { mentioned: true, position: 1, competitors: ['FigJam'] })
  assert.deepEqual(analyzeAnswer('Use draw.io or diagrams.net, or Lucidchart'), { mentioned: false, position: null, competitors: ['draw.io', 'Lucidchart'] })
  assert.deepEqual(analyzeAnswer(''), { mentioned: false, position: null, competitors: [] })
  // "murals" on a wall is not Mural, and FigJam is not Figma
  assert.deepEqual(analyzeAnswer('paint murals; FigJam'), { mentioned: false, position: null, competitors: ['FigJam'] })
})

test('the questions: about 50 by default, asked as people ask; an edited list is cleaned and bounded', () => {
  assert.ok(DEFAULT_QUESTIONS.length >= 45 && DEFAULT_QUESTIONS.length <= 55, String(DEFAULT_QUESTIONS.length))
  for (const q of DEFAULT_QUESTIONS) assert.doesNotMatch(q, /slatebox/i, q)
  assert.equal(new Set(DEFAULT_QUESTIONS.map((q) => q.toLowerCase())).size, DEFAULT_QUESTIONS.length)
  assert.deepEqual(cleanQuestions(['  What is   good? ', 'what is good?', '', 7, 'Second']), ['What is good?', 'Second'])
  assert.throws(() => cleanQuestions(['', '  ']), /at least one/)
  assert.throws(() => cleanQuestions('x'), /list/)
  assert.throws(() => cleanQuestions(Array.from({ length: 81 }, (_, i) => `q${i}`)), /At most 80/)
  assert.equal(cleanQuestions(['y'.repeat(500)])[0].length, 300)
})

function sovWorld({ providers = [{ provider: 'meta', label: 'Meta (Muse)', model: 'muse-ember-1.0' }, { provider: 'anthropic', label: 'Anthropic', model: 'claude' }], enabled = true, answer } = {}) {
  const runs = fakeCollection()
  const settings = fakeCollection()
  let now = T0
  let n = 0
  const asked = []
  const sov = createShareOfVoice({
    runs, settings, providers: async () => providers, enabled: () => enabled, now: () => now, newId: () => `run${++n}`, log: { warn: () => {} },
    ask: async (q) => {
      asked.push(q)
      return { text: answer ? answer(q) : q.provider === 'meta' ? 'Slatebox, then Miro' : 'Miro and FigJam' }
    },
  })
  return { sov, runs, settings, asked, advance: (ms) => { now += ms }, at: () => now }
}

test('a weekly run asks every question of every provider with a key, once a week, in one process', async () => {
  const w = sovWorld()
  await w.sov.setQuestions(['Q one?', 'Q two?'], 'admin')
  const first = await w.sov.tick()
  assert.equal(first.ran, true)
  assert.equal(w.asked.length, 4)
  assert.ok(w.asked.every((q) => /Name the specific tools/.test(q.system)))
  const run = w.runs.docs.get('run1')
  assert.equal(run.status, 'done')
  assert.equal(run.trigger, 'schedule')
  assert.equal(run.summary.rate, 0.5)
  assert.deepEqual(run.summary.providers.map((p) => [p.provider, p.mentioned, p.answered, p.meanPosition]), [['meta', 2, 2, 1], ['anthropic', 0, 2, null]])
  assert.deepEqual(run.summary.competitors, [{ name: 'Miro', count: 4 }, { name: 'FigJam', count: 2 }])
  // not again within the week
  w.advance(60 * 60 * 1000)
  assert.deepEqual(await w.sov.tick(), { ran: false, why: 'not due' })
  w.advance(WEEK_MS)
  assert.equal((await w.sov.tick()).ran, true)
  assert.equal(w.runs.docs.size, 2)
  // a held lease (another process running) stops a second run
  w.advance(WEEK_MS)
  await w.settings.updateOne({ _id: SETTINGS_ID }, { $set: { leaseUntil: new Date(w.at() + LEASE_MS) } })
  assert.deepEqual(await w.sov.tick(), { ran: false, why: 'not due' })
})

test('off where it is not Slatebox Cloud; Run now refused without providers or while running; a failed question is kept as failed', async () => {
  const off = sovWorld({ enabled: false })
  assert.deepEqual(await off.sov.tick(), { ran: false, why: 'off' })
  await assert.rejects(off.sov.runNow('admin'), /Slatebox Cloud only/)
  await assert.rejects(sovWorld({ providers: [] }).sov.runNow('admin'), /No model provider/)

  const w = sovWorld({ answer: (q) => { if (q.provider === 'anthropic') throw new Error('HTTP 401'); return 'Slatebox' } })
  const { started, done } = await w.sov.runNow('admin')
  assert.equal(started, true)
  await assert.rejects(w.sov.runNow('admin'), /already going/)
  await done
  const run = w.runs.docs.get('run1')
  assert.equal(run.trigger, 'manual')
  assert.equal(run.by, 'admin')
  assert.equal(run.results.filter((r) => r.error === 'HTTP 401').length, DEFAULT_QUESTIONS.length)
  assert.equal(run.summary.answered, DEFAULT_QUESTIONS.length)
  assert.equal(run.summary.rate, 1)
  // Run now does not move the weekly schedule, and frees the lease
  const state = await w.settings.findOne({ _id: SETTINGS_ID })
  assert.equal(state.leaseUntil, null)
  assert.equal(state.nextRunAt, undefined)
})

test('the panel: questions, trend oldest first, the latest run in full; answers trimmed; old runs dropped', async () => {
  const w = sovWorld({ answer: () => 'Slatebox '.repeat(400) })
  for (let i = 0; i < 3; i++) {
    await w.sov.tick()
    w.advance(WEEK_MS)
  }
  const view = await w.sov.view()
  assert.equal(view.enabled, true)
  assert.equal(view.customQuestions, false)
  assert.equal(view.questions.length, DEFAULT_QUESTIONS.length)
  assert.deepEqual(view.trend.map((r) => r.id), ['run1', 'run2', 'run3'])
  assert.equal(view.trend[0].results, undefined)
  assert.equal(view.latest._id, 'run3')
  assert.ok(view.latest.results.every((r) => r.answer.length <= 1500))
  assert.equal(view.running, false)
  assert.deepEqual(view.providers.map((p) => p.provider), ['meta', 'anthropic'])
  assert.deepEqual(await w.sov.resetQuestions('admin'), [...DEFAULT_QUESTIONS])
  assert.deepEqual(summarizeResults([]), { asked: 0, answered: 0, mentioned: 0, rate: 0, providers: [], competitors: [] })
})

test('share of voice in the app: administrators only, Cloud or the operator\'s switch, no new keys, one tick an hour', () => {
  const glue = read('server/agent-reach/sov-meteor.js')
  assert.match(glue, /cloudOn\(\) \|\| \/\^on\$\/i\.test\(String\(process\.env\.SLATEBOX_SHARE_OF_VOICE/)
  assert.equal(glue.match(/await requireAdmin\(this\.userId\)/g).length, 3)
  assert.match(glue, /aiKeys\.keyFor\(provider\)/, 'the keys AI control holds')
  assert.match(glue, /guardedFetch\(rules\(\)\)/, 'through the endpoint rules')
  assert.doesNotMatch(glue, /process\.env\.[A-Z_]*KEY/)
  assert.match(read('server/main.js'), /import '\.\/agent-reach\/sov-meteor'/)
  const card = read('imports/ui/pages/admin/ShareOfVoiceCard.jsx')
  assert.match(card, /Run now/)
  assert.match(card, /Edit questions/)
  assert.match(card, /Share of voice runs on Slatebox Cloud only\./)
})

// ---------- the plain chat request ----------
test('plain chat: the provider\'s wire shape, the key only in its header, retries on 5xx, a key never in an error', async () => {
  const KEY = 'sk-live-ABCDEFGHIJKLMNOP'
  const sent = []
  let status = 500
  const fetchImpl = async (url, init) => {
    sent.push({ url, init })
    if (status === 500) { status = 200; return { ok: false, status: 500, json: async () => ({}) } }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Slatebox' } }], usage: { total_tokens: 9 } }) }
  }
  const out = await plainChat({ connection: { type: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1/', apiKey: KEY, model: 'm' }, system: 's', user: 'u', fetchImpl })
  assert.deepEqual(out, { text: 'Slatebox', usage: { total_tokens: 9 } })
  assert.equal(sent.length, 2)
  assert.equal(sent[1].url, 'https://openrouter.ai/api/v1/chat/completions')
  assert.equal(sent[1].init.headers.Authorization, `Bearer ${KEY}`)
  assert.ok(!sent[1].init.body.includes(KEY))
  const anthropic = await plainChat({
    connection: { type: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: KEY, model: 'c' }, system: 's', user: 'u',
    fetchImpl: async (url, init) => { sent.push({ url, init }); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'hi' }] }) } },
  })
  assert.equal(anthropic.text, 'hi')
  assert.equal(sent.at(-1).url, 'https://api.anthropic.com/v1/messages')
  assert.equal(JSON.parse(sent.at(-1).init.body).system, 's')
  const refuse = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: `Incorrect API key provided: sk-liv***MNOP or ${KEY}` } }) })
  await assert.rejects(plainChat({ connection: { type: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: KEY, model: 'm' }, system: 's', user: 'u', fetchImpl: refuse }),
    (error) => /HTTP 401/.test(error.message) && !error.message.includes(KEY) && !error.message.includes('sk-liv'))
  assert.equal(scrubKey('a sk-123456 b', null), 'a [key] b')
})

// ---------- the words agents read ----------
test('the copy: server words carry the positioning, tool text stays free of promotional words', () => {
  const tools = JSON.parse(read('server/actions/generated/exec-tool.json'))
  for (const word of ['diagram', 'flowchart', 'mind map', 'whiteboard', 'brainstorm', 'retro', 'Gantt', 'presentation', 'Mermaid', 'team']) {
    assert.ok(tools.instructions.toLowerCase().includes(word.toLowerCase()), `instructions: ${word}`)
  }
  assert.match(tools.instructions, /open-source visual intelligence platform/)
  assert.deepEqual(promotionalWords(tools.server.description), [])
  assert.doesNotMatch(JSON.stringify(tools), /invite any AI/)
  const pkg = JSON.parse(readFileSync(new URL('../packages/slatebox-mcp/package.json', import.meta.url), 'utf8'))
  assert.match(pkg.description, /free, open-source visual intelligence platform for your team and agents/)
  assert.equal(pkg.description.match(/\bfree\b/gi).length, 1, 'free, once')
})
