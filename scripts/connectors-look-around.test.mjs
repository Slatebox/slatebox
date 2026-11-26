// About you › "Use <tool> to personalize" (S3, 2026-11-26), the integrations half: the look around
// one of a person's own integrations (enterprise/server/service.mjs lookAround) runs its gallery card's
// fixed steps with tools the person allowed that only look things up, at most a few calls, each answer
// quarantined and capped; it never calls a tool that changes anything, never plans, never saves.
// profileSource says which integrations can be read (names and card ids only).
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/connectors-look-around.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createConnectorService, memoryStore, profileSource } from '../enterprise/server/service.mjs'
import { GALLERY } from '../enterprise/common/gallery.mjs'
import { LOOK_LIMITS } from '../enterprise/server/recipes.mjs'
import { normalizeTools } from '../enterprise/server/tools.mjs'

// GitHub's tools as its server lists them (the look-around reads get_me, search_repositories, search_issues).
const LISTED = [
  { name: 'get_me', description: 'Get the signed-in user.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'search_repositories', description: 'Search repositories.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, sort: { type: 'string' }, perPage: { type: 'number' } }, required: ['query'] }, annotations: { readOnlyHint: true } },
  { name: 'search_issues', description: 'Search issues.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, perPage: { type: 'number' } }, required: ['query'] }, annotations: { readOnlyHint: true } },
  { name: 'issue_write', description: 'Create or update an issue.', inputSchema: { type: 'object', properties: { method: { type: 'string' } } } },
]
const github = GALLERY.find((c) => c.id === 'github')

function world({ policies = {}, answers = {}, listed = LISTED, status = 'active' } = {}) {
  const integrations = memoryStore()
  const tools = normalizeTools(listed, github.recipe.tools).map((tool) => ({ name: tool.name, group: tool.group, hash: tool.hash, policy: policies[tool.name] || 'allow', ...(tool.destructive && { destructive: true }) }))
  integrations.rows.push({ _id: 'i1', ownerId: 'ada', kind: 'mcp', address: github.url, host: 'api.githubcopilot.com', galleryId: 'github', name: 'GitHub', tools, status })
  const calls = []
  const session = {
    discover: async () => ({ tools: listed }),
    callTool: async (address, fetch, { name, args, check }) => {
      check(listed)
      calls.push({ name, args })
      const answer = answers[name]
      if (answer instanceof Error) throw answer
      return answer || { content: [{ type: 'text', text: JSON.stringify({ name }) }] }
    },
  }
  const audits = []
  const service = createConnectorService({
    connections: memoryStore(), suggestions: {}, fetch: async () => { throw new Error('no network in this test') }, session,
    model: async () => { throw new Error('a look around never asks a model') }, applyOperations: async () => { throw new Error('a look around never saves') },
    access: {}, firstName: async () => 'Ada', sanitizeName: (s) => s, presence: {}, integrations, audit: (entry) => audits.push(entry),
  })
  return { service, calls, integrations, audits }
}
const ada = { kind: 'person', userId: 'ada' }

test('a look around runs the card\'s fixed lookups, passes a login on, and returns quarantined, capped text', async () => {
  const w = world({ answers: {
    get_me: { content: [{ type: 'text', text: JSON.stringify({ login: 'ana-dev', name: 'Ana' }) }] },
    search_repositories: { content: [{ type: 'text', text: 'x'.repeat(5000) }] },
  } })
  const look = await w.service.lookAround(ada, { ref: 'github' })
  assert.deepEqual(w.calls.map((c) => c.name), ['get_me', 'search_repositories', 'search_issues'])
  assert.equal(w.calls[1].args.query, 'user:ana-dev', 'a value an earlier step extracted')
  assert.ok(w.calls.length <= LOOK_LIMITS.calls)
  assert.equal(look.ref, 'github')
  assert.equal(look.name, 'GitHub')
  assert.ok(look.sample.every((entry) => entry.text.length <= LOOK_LIMITS.charsPerCall))
  assert.ok(look.sample.reduce((n, entry) => n + entry.text.length, 0) <= LOOK_LIMITS.chars)
  assert.equal(w.audits.at(-1).kind, 'look_around')
  assert.equal(JSON.stringify(w.audits.at(-1)).includes('ana-dev'), false, 'the audit keeps counts, never what was read')
})

test('only tools the person allowed that look things up: a tool turned off is skipped, a change is never called', async () => {
  const w = world({ policies: { search_repositories: 'off' } })
  await w.service.lookAround(ada, { ref: 'github' })
  assert.deepEqual(w.calls.map((c) => c.name), ['get_me', 'search_issues'])
  assert.ok(!w.calls.some((c) => c.name === 'issue_write'))
  // a server that says its search writes: never called by a look around, whatever was allowed
  const writes = LISTED.map((tool) => (tool.name === 'search_issues' ? { ...tool, annotations: { readOnlyHint: false, destructiveHint: true } } : tool))
  const v = world({ listed: writes })
  await v.service.lookAround(ada, { ref: 'github' })
  assert.ok(!v.calls.some((c) => c.name === 'search_issues'))
})

test('one failing lookup leaves the others; tools that changed, a needed sign-in, or someone else\'s integration are refused', async () => {
  const w = world({ answers: { get_me: new Error('boom') } })
  const look = await w.service.lookAround(ada, { ref: 'github' })
  assert.deepEqual(look.sample.map((s) => s.tool), ['search_issues'], 'without a login, the repository search waits; the issue search still runs')
  // the server's tools moved since consent
  const moved = world()
  moved.integrations.rows[0].tools[0].hash = 'old'
  await assert.rejects(moved.service.lookAround(ada, { ref: 'github' }), (error) => error.code === 'tools_changed')
  assert.deepEqual(moved.calls, [])
  // not Ada's: not found, and nothing is called
  const other = world()
  await assert.rejects(other.service.lookAround({ kind: 'person', userId: 'sam' }, { ref: 'github' }), (error) => error.code === 'not_found')
  await assert.rejects(other.service.lookAround({ kind: 'guest', userId: 'g1' }, { ref: 'github' }), (error) => error.code === 'sign_in')
  // waiting on a sign-in: said so
  const signIn = world({ status: 'needs_sign_in' })
  await assert.rejects(signIn.service.lookAround(ada, { ref: 'github' }), (error) => error.code === 'needs_sign_in')
  assert.deepEqual(other.calls, [])
})

test('profileSource: names and card ids only, for working MCP integrations whose card has a look-around', () => {
  const doc = { _id: 'i1', ownerId: 'ada', kind: 'mcp', address: github.url, galleryId: 'github', name: 'GitHub', status: 'active', tools: [{ name: 'get_me', hash: 'h' }], auth: { kind: 'oauth' } }
  assert.deepEqual(profileSource(doc), { ref: 'github', name: 'GitHub', kind: 'mcp' })
  assert.doesNotMatch(JSON.stringify(profileSource(doc)), /githubcopilot|oauth|get_me|ada/)
  assert.equal(profileSource({ ...doc, status: 'needs_sign_in' }), null)
  assert.equal(profileSource({ ...doc, galleryId: null, address: 'https://wiki.example.com/mcp' }), null, 'a custom server has no look-around')
  const zapier = GALLERY.find((c) => c.id === 'zapier')
  assert.equal(profileSource({ ...doc, galleryId: 'zapier', address: zapier.url }), null, 'a card with no look-around')
  assert.equal(profileSource({ ...doc, kind: 'google', galleryId: 'googledrive' }), null)
  // the cards Slatebox can read to personalize, the design's six among them
  const lookable = GALLERY.filter((c) => c.recipe.lookAround).map((c) => c.id)
  for (const id of ['github', 'linear', 'notion', 'slack', 'atlassian', 'sentry']) assert.ok(lookable.includes(id), id)
})
