// An MCP server that answers, in JSON-RPC, that it will not take this app (Slack's "App is not
// enabled for Slack MCP server access", HTTP 400, proven on prod 2026-11-27) is said as a refusal
// (app_refused), with a link to its settings only on its own domain, never its words; a reply that is
// really not MCP is still not_mcp; a failed discovery writes one audit line.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/mcp-refusal.test.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { discover, McpProblem, problemOf, rpcErrorOf, settingsLinkOf, siteOf } from '../enterprise/server/mcp-session.mjs'
import { ConnectorRefused, createConnectorService } from '../enterprise/server/service.mjs'
import { settingsLinkOf as clientLinkOf } from '../enterprise/common/gallery.mjs'

const SLACK_WORDS = 'App is not enabled for Slack MCP server access. Please enable it here: https://api.slack.com/apps/A0CNE1LPA00/app-assistant'
const rpcBody = (code, message) => JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message } })

// Each path answers one way, as the servers seen in the wild do.
const REPLIES = {
  '/slack/mcp': [400, 'application/json', rpcBody(-32600, SLACK_WORDS)],
  '/elsewhere/mcp': [400, 'application/json', rpcBody(-32600, 'Enable it here: https://evil.example/steal')],
  '/forbidden/mcp': [403, 'application/json', rpcBody(-32001, 'This app is not allowed in this workspace.')],
  '/bad-request/mcp': [400, 'text/plain', 'Bad Request'],
  '/page/mcp': [200, 'text/html', '<html><body>Welcome</body></html>'],
  '/missing/mcp': [404, 'text/plain', 'Not Found'],
  '/broken/mcp': [200, 'application/json', '{not json'],
}
let server
let origin
before(async () => {
  server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      const [status, type, body] = REPLIES[req.url] || [404, 'text/plain', 'Not Found']
      res.writeHead(status, { 'content-type': type })
      res.end(body)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

// The SDK's own error for a path, exactly as withSession sees it.
async function sdkError(path) {
  const client = new Client({ name: 'test', version: '1' }, { versionNegotiation: { mode: 'auto', probe: { timeoutMs: 3000 } }, capabilities: {} })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(origin + path)), { timeout: 3000 })
  } catch (error) {
    return error
  } finally {
    await client.close().catch(() => {})
  }
  throw new Error(`${path} connected`)
}

test("Slack's 400 refusal is app_refused, not \"didn't answer like an MCP server\", with its settings page as a link", async () => {
  const error = await sdkError('/slack/mcp')
  assert.equal(error.status, 400)
  assert.match(error.message, /jsonrpc/, 'the body the old /JSON/i test matched')
  const problem = problemOf(error, 'mcp.slack.com')
  assert.ok(problem instanceof McpProblem)
  assert.equal(problem.code, 'app_refused')
  assert.equal(problem.message, 'mcp.slack.com refused this connection. Its owner may need to allow this app.')
  assert.deepEqual(problem.details, { settingsUrl: 'https://api.slack.com/apps/A0CNE1LPA00/app-assistant' })
  assert.equal(problem.status, 400)
  assert.doesNotMatch(problem.message, /enabled|Please|api\.slack\.com/, "never the server's own words")
  assert.doesNotMatch(problem.message, /MCP server\. Is there a \/mcp path/)
})

test('a link on another domain, or none, is never offered; the refusal still says what happened', async () => {
  const elsewhere = problemOf(await sdkError('/elsewhere/mcp'), 'mcp.slack.com')
  assert.equal(elsewhere.code, 'app_refused')
  assert.equal(elsewhere.details, undefined)
  const plain = problemOf(await sdkError('/forbidden/mcp'), 'mcp.example.com')
  assert.equal(plain.code, 'app_refused', 'a 403 with a JSON-RPC error is the same refusal')
  assert.equal(plain.details, undefined)
  assert.equal(plain.status, 403)
  // Signed in, a 403 with a JSON-RPC error is still the app refused (signing in again would not help).
  assert.equal(problemOf(await sdkError('/forbidden/mcp'), 'mcp.example.com', { signedIn: true }).code, 'app_refused')
})

test('end to end through discover(): the refusal reaches the caller as app_refused (an IP host gets no link)', async () => {
  await assert.rejects(discover(origin + '/slack/mcp', globalThis.fetch, { requestMs: 3000 }), (error) => {
    assert.equal(error.code, 'app_refused')
    assert.equal(error.details, undefined, 'no registrable domain on an IP address')
    return true
  })
})

test('really not MCP is still not_mcp: a web page, no such path, broken JSON', async () => {
  for (const path of ['/page/mcp', '/missing/mcp', '/broken/mcp']) {
    const problem = problemOf(await sdkError(path), 'mcp.example.com')
    assert.equal(problem.code, 'not_mcp', path)
    assert.equal(problem.message, "That address didn't answer like an MCP server. Is there a /mcp path?")
  }
  // A 400 with no JSON-RPC error is not a refusal of this app.
  assert.notEqual(problemOf(await sdkError('/bad-request/mcp'), 'mcp.example.com').code, 'app_refused')
})

test('the other codes keep their meaning', () => {
  assert.equal(problemOf({ name: 'InsufficientScopeError', message: 'Insufficient scope: required "a b"' }, 'x.example').code, 'needs_more_access')
  assert.equal(problemOf({ message: 'insufficient_scope' }, 'x.example').code, 'needs_more_access')
  assert.equal(problemOf({ status: 403, message: 'denied' }, 'x.example', { signedIn: true }).code, 'needs_more_access')
  assert.equal(problemOf({ status: 403, message: 'denied' }, 'x.example').code, 'blocked')
  assert.equal(problemOf({ status: 401, message: 'Unauthorized' }, 'x.example').code, 'needs_sign_in')
  assert.equal(problemOf({ message: 'Request timed out' }, 'x.example').code, 'timeout')
  assert.equal(problemOf({ message: 'fetch failed' }, 'x.example').code, 'unreachable')
  // A JSON-RPC body on any other status is not read.
  assert.notEqual(problemOf({ status: 500, data: { text: rpcBody(-32603, SLACK_WORDS) }, message: 'x' }, 'mcp.slack.com').code, 'app_refused')
})

test('rpcErrorOf reads only a real JSON-RPC error', () => {
  assert.deepEqual(rpcErrorOf({ data: { text: rpcBody(-32600, 'no') } }), { code: -32600, message: 'no' })
  assert.deepEqual(rpcErrorOf({ message: `Error POSTing to endpoint: ${rpcBody(-32600, 'no')}` }), { code: -32600, message: 'no' })
  assert.equal(rpcErrorOf({ data: { text: '{"error":{"code":1,"message":"x"}}' } }), null, 'no jsonrpc 2.0')
  assert.equal(rpcErrorOf({ data: { text: '{"jsonrpc":"2.0","error":{"code":"x","message":"x"}}' } }), null, 'code not a number')
  assert.equal(rpcErrorOf({ data: { text: 'Bad Request' } }), null)
  assert.equal(rpcErrorOf(null), null)
})

test('siteOf and settingsLinkOf: https, the same registrable domain, nothing shared or odd', () => {
  assert.equal(siteOf('mcp.slack.com'), 'slack.com')
  assert.equal(siteOf('mcp.slack.com:443'), 'slack.com')
  assert.equal(siteOf('a.b.example.co.uk'), 'example.co.uk')
  assert.equal(siteOf('example.co.uk'), 'example.co.uk')
  assert.equal(siteOf('127.0.0.1:8080'), null)
  assert.equal(siteOf('[::1]:80'), null)
  assert.equal(siteOf('localhost'), null)
  assert.equal(siteOf('mine.github.io'), null, 'anyone can have a github.io site')
  assert.equal(siteOf('mine.vercel.app'), null)
  const link = (words, host = 'mcp.slack.com') => settingsLinkOf(words, host)
  assert.equal(link(SLACK_WORDS), 'https://api.slack.com/apps/A0CNE1LPA00/app-assistant')
  assert.equal(link('Enable it here: https://slack.com/apps.'), 'https://slack.com/apps', 'trailing punctuation dropped')
  assert.equal(link('Enable it here: http://api.slack.com/apps'), null, 'not https')
  assert.equal(link('Enable it here: https://api.slack.com.evil.example/apps'), null)
  assert.equal(link('Enable it here: https://evilslack.com/apps'), null)
  assert.equal(link('Enable it here: https://user:pw@api.slack.com/apps'), null)
  assert.equal(link('Enable it here: https://api.slack.com:8443/apps'), null)
  assert.equal(link('Enable it here: javascript:alert(1)'), null)
  assert.equal(link(`Enable it here: https://api.slack.com/${'a'.repeat(400)}`), null, 'too long')
  assert.equal(link('Enable it here: https://other.github.io/x', 'mine.github.io'), null)
  assert.equal(link('No link at all.'), null)
  assert.equal(link(SLACK_WORDS, '127.0.0.1:9999'), null)
})

test("discovery: a refusal reaches the page as app_refused with only the checked link, and writes one discover_failed line", async () => {
  const lines = []
  const service = createConnectorService({
    connections: { insert: async () => {}, findOne: async () => null, find: async () => [], update: async () => {} },
    fetch: globalThis.fetch,
    session: { discover: async (address) => { throw problemOf(await sdkError('/slack/mcp'), new URL(address).host) }, callTool: async () => { throw new Error('unused') } },
    audit: (entry) => lines.push(entry),
  })
  const ada = { kind: 'person', userId: 'ada', scopes: ['slates:read', 'slates:write'] }
  await assert.rejects(service.discover(ada, { address: 'https://mcp.refuser.example.com/mcp' }), (error) => {
    assert.ok(error instanceof ConnectorRefused)
    assert.equal(error.status, 422)
    assert.equal(error.code, 'app_refused')
    assert.equal(error.message, 'mcp.refuser.example.com refused this connection. Its owner may need to allow this app.')
    assert.equal(error.details, undefined, 'api.slack.com is not on refuser.example.com')
    assert.ok(!Object.keys(error).includes('upstreamStatus'), 'the server status is for the audit, not the page')
    return true
  })
  assert.deepEqual(lines, [{ kind: 'discover_failed', userId: 'ada', host: 'mcp.refuser.example.com', code: 'app_refused', status: 400 }])
  // A refusal of Slatebox's own (no tools) is audited too, with its own status.
  const empty = createConnectorService({
    connections: { insert: async () => {}, findOne: async () => null, find: async () => [], update: async () => {} },
    fetch: globalThis.fetch,
    session: { discover: async () => ({ serverInfo: null, instructions: '', era: null, tools: [] }), callTool: async () => ({}) },
    audit: (entry) => lines.push(entry),
  })
  await assert.rejects(empty.discover(ada, { address: 'https://mcp.empty.example.com/mcp' }), (error) => error.code === 'no_tools')
  assert.deepEqual(lines.at(-1), { kind: 'discover_failed', userId: 'ada', host: 'mcp.empty.example.com', code: 'no_tools', status: 422 })
})

test('discovery through the real session against mcp.slack.com-shaped words keeps the Slack link', async () => {
  const lines = []
  const service = createConnectorService({
    connections: { insert: async () => {}, findOne: async () => null, find: async () => [], update: async () => {} },
    fetch: globalThis.fetch,
    session: { discover: async () => { throw problemOf(await sdkError('/slack/mcp'), 'mcp.slack.com') }, callTool: async () => ({}) },
    audit: (entry) => lines.push(entry),
  })
  await assert.rejects(service.discover({ kind: 'person', userId: 'ada' }, { address: 'https://mcp.refuser.example.com/mcp' }), (error) => {
    assert.deepEqual(error.details, { settingsUrl: 'https://api.slack.com/apps/A0CNE1LPA00/app-assistant' })
    return true
  })
})

test('the page: the link is checked again and shown as "Open settings" beside our own words', () => {
  const refusal = { error: 'app_refused', reason: 'mcp.slack.com refused this connection. Its owner may need to allow this app.', details: { settingsUrl: 'https://api.slack.com/apps/A0CNE1LPA00/app-assistant' } }
  assert.equal(clientLinkOf(refusal), 'https://api.slack.com/apps/A0CNE1LPA00/app-assistant')
  assert.equal(clientLinkOf({ ...refusal, error: 'not_mcp' }), null, 'only on app_refused')
  assert.equal(clientLinkOf({ ...refusal, details: { settingsUrl: 'javascript:alert(1)' } }), null)
  assert.equal(clientLinkOf({ ...refusal, details: { settingsUrl: 'http://api.slack.com/apps' } }), null)
  assert.equal(clientLinkOf({ ...refusal, details: {} }), null)
  const walk = readFileSync(new URL('../enterprise/client/InviteWalkthrough.jsx', import.meta.url), 'utf8')
  assert.match(walk, /href=\{link\} target="_blank" rel="noopener noreferrer" data-invite-problem-settings=""[^>]*>Open settings</)
  assert.equal((walk.match(/<Problem text=\{error\} link=\{problem\.link\} \/>/g) || []).length, 4, 'every place the problem shows')
  assert.match(walk, /setError\(errorText\(e\), link\)/)
  assert.doesNotMatch(walk, /dangerouslySetInnerHTML/)
  const page = readFileSync(new URL('../enterprise/client/IntegrationsPage.jsx', import.meta.url), 'utf8')
  assert.match(page, /setErrorLink\(settingsLinkOf\(e\)\)/)
  assert.match(page, /href=\{errorLink\} target="_blank" rel="noopener noreferrer"/)
})
