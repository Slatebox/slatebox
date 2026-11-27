// Slack as a native integration on Slack's Web API (enterprise/server/slack/, owner 2026-11-27):
// connect in one click (OAuth v2: a user token and a bot token, exactly the scopes asked for, sealed),
// the Slack agent's fixed tools on a slate (searching first; a channel or thread once a minute while
// Slatebox is unlisted), changes that always wait on a card, and the in-Slack side (signed requests
// only: link previews by the slate's own visibility, Send to slate, /slatebox, uninstall and revoked
// tokens). Against a fake Slack (scripts/slack-test-server.mjs): no live Slack anywhere, and no
// answer, row or log ever holds a Slack token.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/slack.test.mjs
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { startSlackTestServer, USER_SCOPES } from './slack-test-server.mjs'
import { createMcpFetch } from '../enterprise/server/mcp-fetch.mjs'
import { createVault, credentialId } from '../enterprise/server/credentials.mjs'
import { createSignIn } from '../enterprise/server/signin.mjs'
import { actsWithoutAsking, alwaysAsks, createConnectorService, memoryStore } from '../enterprise/server/service.mjs'
import { createSlackService, parsePermalink, slackOnlyFetch, slackSettings, SLACK_ADDRESS, SLACK_MCP_ADDRESS, SLACK_TOOLS } from '../enterprise/server/slack/slack.mjs'
import { slackManifest, SLACK_BOT_SCOPES, SLACK_USER_SCOPES } from '../enterprise/server/slack/manifest.mjs'
import { slackRoutes } from '../enterprise/server/slack/routes.mjs'
import { openMetadata, signatureOf, signMetadata, verifySlackRequest } from '../enterprise/server/slack/verify.mjs'
import { slackActions } from '../enterprise/server/slack/actions.mjs'
import { retireSlackMcp } from '../enterprise/server/integrations-migrate.mjs'
import { INVITE_CARDS } from '../enterprise/common/gallery.mjs'
import { normalizeTools } from '../enterprise/server/tools.mjs'
import { itemsFromLayout } from '../enterprise/server/translate.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'
import { sanitizeClientName } from '../web/app/imports/api/common/agent-label.mjs'
import { isSlackPath } from '../web/app/server/raw-body-paths.mjs'
import { connectorSuggestions } from './connector-suggestions-world.mjs'

let slack
before(async () => {
  slack = await startSlackTestServer()
})
after(() => slack.close())

const ORIGIN = 'https://slate.example.com'
const SIGNING = 'slack-signing-secret-0123456789'

const refusedWith = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `${error.code}: ${error.message}`)
    return true
  })
}

function credentialMemory() {
  const rows = new Map()
  return {
    rows,
    get: async (id) => (rows.has(id) ? structuredClone(rows.get(id)) : null),
    put: async (doc) => void rows.set(doc._id, structuredClone(doc)),
    update: async (id, set) => void (rows.has(id) && Object.assign(rows.get(id), structuredClone(set))),
    claim: async () => true,
    release: async () => {},
    remove: async (id) => void rows.delete(id),
  }
}
function flowMemory() {
  const rows = new Map()
  return {
    rows,
    insert: async (doc) => void rows.set(doc._id, structuredClone(doc)),
    get: async (id) => (rows.has(id) ? structuredClone(rows.get(id)) : null),
    async claim(id, from, set) {
      const row = rows.get(id)
      if (!row || row.status !== from) return null
      Object.assign(row, set)
      return structuredClone(row)
    },
    async takeByState(stateHash) {
      const row = [...rows.values()].find((r) => r.stateHash === stateHash && r.status === 'opened')
      if (!row) return null
      row.status = 'used'
      return structuredClone(row)
    },
    update: async (id, set) => void (rows.has(id) && Object.assign(rows.get(id), set)),
  }
}
function rowsMemory() {
  const rows = new Map()
  const matches = (row, query) => Object.entries(query).every(([k, v]) => row[k] === v)
  return {
    rows,
    get: async (id) => rows.get(id) || null,
    put: async (doc) => void rows.set(doc._id, structuredClone(doc)),
    find: async (query) => [...rows.values()].filter((row) => matches(row, query)),
    remove: async (id) => void rows.delete(id),
  }
}
// The read gate as Mongo does it: the next time moves only once it has passed.
function gateMemory() {
  const rows = new Map()
  return {
    rows,
    claim: async (id, at, until) => {
      const row = rows.get(id)
      if (row && row.nextAt > at) return false
      rows.set(id, { nextAt: until })
      return true
    },
    get: async (id) => rows.get(id) || null,
    hold: async (id, until) => {
      const row = rows.get(id)
      rows.set(id, { nextAt: row && row.nextAt > until ? row.nextAt : until })
    },
  }
}

const slateFixture = () => ({ _id: 'slateA', shareId: 'shareA', userId: 'ada', revision: 1, options: { name: 'Launch review' }, nodes: [] })

// What the planner and translator answer (the model is faked): each test says which calls it plans.
function fakeModel(world) {
  return async ({ tool, user }) => {
    if (tool.name === 'plan_calls') {
      const offered = ['post_message', 'add_reaction', 'read_thread', 'read_channel', 'search_messages', 'list_channels'].filter((name) => user.includes(`"${name}"`))
      const calls = (world.plan ? world.plan(offered, user) : offered.slice(0, 1).map((name) => ({ tool: name, arguments: world.args[name] || {} })))
      return { calls, done: true }
    }
    return { groups: [{ label: 'From Slack', notes: [{ key: 'a', text: 'Two tiers for pricing', link: 'https://acme.slack.com/archives/C0LAUNCH01/p1764000001000100' }] }] }
  }
}

function makeWorld({ listed = false, configured = true } = {}) {
  const clock = { t: Date.parse('2026-11-27T12:00:00Z') }
  const now = () => clock.t
  const master = loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
  const cfg = slackSettings({ connectors: { slack: { apiBase: slack.origin, listed } } }, { development: true })
  const fetch = slackOnlyFetch(createMcpFetch({ devOrigins: cfg.devOrigins, methods: ['POST'], maxRedirects: 0 }), { devOrigins: cfg.devOrigins })
  const apps = configured ? { slack: { clientId: slack.state.clientId, clientSecret: slack.state.clientSecret, signingSecret: SIGNING } } : {}
  const credentials = credentialMemory()
  const vault = createVault({ store: credentials, master, fetch, secretFor: (reg) => apps[reg.provider]?.clientSecret || null, now, sleep: async () => {} })
  const flows = flowMemory()
  const natives = {}
  const signIn = createSignIn({ flows, clients: { get: async () => null, put: async () => {} }, vault, master, fetch, apps: () => apps, origin: () => ORIGIN, natives, now })
  const integrations = memoryStore()
  const connections = memoryStore()
  const outside = memoryStore()
  const workspaces = rowsMemory()
  const gates = gateMemory()
  const slate = slateFixture()
  const live = connectorSuggestions(slate)
  const roles = { ada: 'edit', sam: 'edit', vic: 'read' }
  const access = {
    forUser: async (shareId, userId) => (shareId === 'shareA' && roles[userId] ? { slate, canRead: true, canEdit: roles[userId] === 'edit' } : null),
    forToken: async (principal, shareId) => (shareId === 'shareA' && roles[principal.userId] ? { slate, canRead: true, canEdit: roles[principal.userId] === 'edit' } : null),
    reload: async () => slate,
  }
  const audits = []
  const logs = []
  const previews = { 'canvas/publicOne': { title: 'Roadmap <2027>', description: 'Where we go', imageUrl: 'https://files.example.com/slate/publicOne_1.png' }, 'present/deck01': { title: 'Launch deck', description: '', imageUrl: null } }
  const state = { enabled: true }
  const world = { args: {}, plan: null }
  let connectors = null
  const service = createSlackService({
    vault, integrations, connections, workspaces, gates, signIn, fetch, config: () => cfg, apps: async () => apps, origin: () => ORIGIN, enabled: async () => state.enabled, master,
    access, editableSlates: async (userId, { query = '' } = {}) => (roles[userId] === 'edit' ? [{ shareId: 'shareA', name: 'Launch review' }].filter((s) => !query || s.name.toLowerCase().includes(query.toLowerCase())) : []),
    publicPreview: async (kind, id) => previews[`${kind}/${id}`] || null,
    applyOperations: live.applyOperations, presence: { end: async () => {} }, itemsFromLayout,
    onConnected: (integration) => connectors.resumeIntegration(integration), moveNative: (old, set) => connectors.moveNative(old, set),
    audit: (entry) => audits.push(entry), now,
  })
  natives.slack = (flow, code) => service.finishInstall(flow, code)
  const session = {
    discover: (address, f, o) => service.slackSession.discover(address, f, o),
    callTool: (address, f, call, o) => service.slackSession.callTool(address, f, call, o),
  }
  connectors = createConnectorService({
    connections, integrations, outside, suggestions: live.suggestions, fetch, session, oauthApps: () => apps,
    nativeOn: (address) => (address === SLACK_ADDRESS ? service.usable() : true),
    model: fakeModel(world), applyOperations: live.applyOperations, access,
    firstName: async (userId) => userId[0].toUpperCase() + userId.slice(1), sanitizeName: sanitizeClientName,
    presence: { plan: async () => {}, step: async () => {}, saved: async () => {}, end: async () => {} },
    vault, sleep: async () => {}, later: () => {}, audit: (entry) => audits.push(entry), now,
  })
  const person = (userId) => ({ kind: 'person', userId, scopes: ['slates:read', 'slates:write'] })
  const later = []
  const routes = Object.fromEntries(slackRoutes({ slack: () => service, events: eventsMemory(), later: (fn) => later.push(fn), log: (entry) => logs.push(entry), now }).map((r) => [r.path.split('/').pop(), r.handler]))
  return Object.assign(world, {
    slack: service, connectors, vault, credentials, integrations, connections, outside, workspaces, gates, flows, signIn, live, audits, logs, state, slate, cfg, clock, master, routes, later, previews, roles,
    ada: person('ada'), sam: person('sam'), vic: person('vic'),
    runLater: async () => {
      while (later.length) await later.shift()()
    },
  })
}
function eventsMemory() {
  const seen = new Set()
  return { claim: async (id) => (seen.has(id) ? false : (seen.add(id), true)) }
}

/** Connect, as the popup does: slack.connect's flow claimed by this browser, Allow on Slack, the callback. */
async function connect(world, { userId = 'ada', grant = {}, binding: override = null } = {}) {
  const started = await world.slack.connect({ kind: 'person', userId })
  const { authorizeUrl, binding } = await world.signIn.begin({ flowId: started.flowId, userId })
  const url = new URL(authorizeUrl)
  const code = slack.state.grant(grant)
  const finished = await world.signIn.finish({ query: { state: url.searchParams.get('state'), code }, bindingFor: () => override ?? binding })
  return { started, url, finished, state: url.searchParams.get('state'), code, binding }
}

// Everything a person, page or log could see must hold no Slack token.
function assertNoToken(...blobs) {
  const text = JSON.stringify(blobs)
  assert.ok(!/xox[pb]-fake/.test(text), 'a Slack token leaked')
}

async function inviteSlack(world) {
  const row = await world.integrations.findOne({ ownerId: 'ada', address: SLACK_ADDRESS })
  return world.connectors.integrationInvite(world.ada, { shareId: 'shareA', integrationId: row._id })
}

// ---------- install ----------

test('connect is one click: Slack\'s own sign-in page with exactly the scopes it needs, then both tokens sealed and the integration made', async () => {
  const world = makeWorld()
  const { started, url, finished } = await connect(world)
  assert.equal(started.authHost, new URL(slack.origin).host)
  assert.equal(url.pathname, '/oauth/v2/authorize')
  assert.deepEqual(url.searchParams.get('user_scope').split(','), [...SLACK_USER_SCOPES])
  assert.deepEqual(url.searchParams.get('scope').split(','), [...SLACK_BOT_SCOPES])
  assert.equal(url.searchParams.get('redirect_uri'), `${ORIGIN}/connectors/oauth/callback`)
  assert.equal(url.searchParams.get('client_id'), slack.state.clientId)
  assert.equal(url.searchParams.has('code_challenge'), false, 'a confidential client with a secret: no PKCE')
  assert.deepEqual([finished.ok, finished.host], [true, 'Slack'])
  const row = await world.integrations.findOne({ ownerId: 'ada', address: SLACK_ADDRESS })
  assert.deepEqual([row.kind, row.galleryId, row.status, row.account.teamName, row.slackTeamId, row.slackUserId, row.account.url], ['slack', 'slack', 'active', 'Acme', 'T0ACME0001', 'U0ANA00001', 'https://acme.slack.com/'])
  assert.deepEqual(row.tools.map((t) => `${t.name}:${t.group}:${t.policy}`), ['search_messages:lookup:allow', 'list_channels:lookup:allow', 'read_channel:lookup:allow', 'read_thread:lookup:allow', 'post_message:change:allow', 'add_reaction:change:allow'])
  assert.equal(await world.vault.tokenFor('ada', SLACK_ADDRESS), [...slack.state.tokens.entries()].find(([, v]) => v.kind === 'user' && v.user === 'U0ANA00001')[0])
  // sealed: the vault row and the workspace row hold ciphers, never a token
  const sealed = world.credentials.rows.get(credentialId('ada', SLACK_ADDRESS))
  assert.equal(sealed.access.v, 1)
  assert.deepEqual([sealed.server.revocationEndpoint, sealed.server.revocation], [`${slack.origin}/api/auth.revoke`, 'slack'])
  const workspace = world.workspaces.rows.get('T0ACME0001')
  assert.deepEqual([workspace.botToken.v, workspace.botUserId, workspace.installedBy], [1, 'U0BOT00001', 'ada'])
  assertNoToken(finished, row, sealed, workspace, world.audits, await world.slack.status(world.ada), await world.connectors.integrationsList(world.ada))
  // a token's call over exec or the API can't start a Slack sign-in
  assert.deepEqual(slackActions(() => world.slack).find((a) => a.id === 'slack.connect').principals, ['person'])
})

test('install: the state is used once, an expired one is refused, a callback in another browser is refused', async () => {
  const world = makeWorld()
  const first = await connect(world)
  assert.equal(first.finished.ok, true)
  const again = await world.signIn.finish({ query: { state: first.state, code: slack.state.grant() }, bindingFor: () => first.binding })
  assert.deepEqual([again.ok, again.code], [false, 'unverified'], 'a used state finds nothing')
  const other = await connect(world, { binding: 'someone-elses-cookie' })
  assert.deepEqual([other.finished.ok, other.finished.code], [false, 'unverified'])
  // expired: ten minutes and it is over
  const started = await world.slack.connect(world.ada)
  const { authorizeUrl, binding } = await world.signIn.begin({ flowId: started.flowId, userId: 'ada' })
  world.clock.t += 11 * 60000
  const late = await world.signIn.finish({ query: { state: new URL(authorizeUrl).searchParams.get('state'), code: slack.state.grant() }, bindingFor: () => binding })
  assert.deepEqual([late.ok, late.code], [false, 'expired'])
  // Deny on Slack's page: cancelled, in plain words
  const denied = await world.slack.connect(world.ada)
  const opened = await world.signIn.begin({ flowId: denied.flowId, userId: 'ada' })
  const cancel = await world.signIn.finish({ query: { state: new URL(opened.authorizeUrl).searchParams.get('state'), error: 'access_denied' }, bindingFor: () => opened.binding })
  assert.deepEqual([cancel.ok, cancel.code, cancel.message], [false, 'cancelled', 'Sign-in was cancelled.'])
})

test('install: a missing scope, or more than asked for, is refused and both tokens are revoked at once', async () => {
  const world = makeWorld()
  const revokedBefore = slack.state.revoked.length
  const missing = await connect(world, { grant: { userScope: USER_SCOPES.replace(',search:read', '').replace('search:read,', '') } })
  assert.deepEqual([missing.finished.ok, missing.finished.code], [false, 'scope_missing'])
  assert.equal(slack.state.revoked.length, revokedBefore + 2, 'the user token and the bot token')
  const extra = await connect(world, { grant: { userScope: USER_SCOPES + ',files:read' } })
  assert.deepEqual([extra.finished.ok, extra.finished.code], [false, 'scope_wrong'])
  const extraBot = await connect(world, { grant: { botScope: 'links:read,links:write,commands,chat:write' } })
  assert.equal(extraBot.finished.code, 'scope_wrong')
  assert.equal(slack.state.revoked.length, revokedBefore + 6)
  assert.equal(await world.integrations.findOne({ ownerId: 'ada', address: SLACK_ADDRESS }), null, 'nothing kept')
  assert.equal(world.credentials.rows.size, 0)
})

test('install: Slack\'s ok:false with HTTP 200 is a failure, never a sign-in', async () => {
  const world = makeWorld()
  const started = await world.slack.connect(world.ada)
  const { authorizeUrl, binding } = await world.signIn.begin({ flowId: started.flowId, userId: 'ada' })
  const done = await world.signIn.finish({ query: { state: new URL(authorizeUrl).searchParams.get('state'), code: 'never-issued' }, bindingFor: () => binding })
  assert.deepEqual([done.ok, done.code], [false, 'token_failed'])
  assert.equal((await world.signIn.status({ userId: 'ada', flowId: started.flowId })).status, 'failed')
  assert.equal(world.credentials.rows.size, 0)
  // not set up on this server: connect says so before any window opens
  await refusedWith(makeWorld({ configured: false }).slack.connect(world.ada), 'not_configured')
  await refusedWith(world.slack.connect({ kind: 'guest', userId: 'g1' }), 'sign_in')
})

test('install: connecting again updates the workspace row (the newest bot token wins) and keeps one integration', async () => {
  const world = makeWorld()
  await connect(world)
  const firstBot = world.workspaces.rows.get('T0ACME0001').botToken
  await connect(world)
  assert.notDeepEqual(world.workspaces.rows.get('T0ACME0001').botToken, firstBot)
  assert.equal((await world.integrations.find({ ownerId: 'ada' })).length, 1)
})

test('install: an MCP Slack integration moves in place with its slates, name and color; its old sign-in is revoked', async () => {
  const world = makeWorld()
  const at = new Date(world.clock.t)
  await world.integrations.insert({ _id: 'iOldSlack', ownerType: 'user', ownerId: 'ada', kind: 'mcp', address: SLACK_MCP_ADDRESS, host: 'mcp.slack.com', galleryId: 'slack', name: 'Team chat', colorIndex: 7, rule: 'my_slates', tools: [{ name: 'slack_send_message', hash: 'h', policy: 'allow' }], status: 'needs_sign_in', createdAt: at, updatedAt: at })
  await world.connections.insert({ _id: 'cOld', ownerId: 'ada', integrationId: 'iOldSlack', slateId: 'slateA', shareId: 'shareA', address: SLACK_MCP_ADDRESS, host: 'mcp.slack.com', name: 'Team chat', status: 'needs_sign_in', tools: [{ name: 'slack_send_message', hash: 'h', policy: 'allow' }], createdAt: at })
  const oldToken = 'xoxp-fake-old-mcp'
  slack.state.tokens.set(oldToken, { kind: 'user', user: 'U0ANA00001', team: 'T0ACME0001' })
  await world.vault.save({ userId: 'ada', address: SLACK_MCP_ADDRESS, resource: 'https://mcp.slack.com', issuer: 'https://mcp.slack.com', kind: 'oauth', registration: { kind: 'preregistered', provider: 'slack', clientId: 'x' }, server: { issuer: 'https://mcp.slack.com', tokenEndpoint: `${slack.origin}/api/oauth.v2.user.access`, revocationEndpoint: `${slack.origin}/api/auth.revoke`, revocation: 'slack' }, tokens: { accessToken: oldToken } })
  // the start-up migration asks its owner to connect again
  assert.deepEqual(await retireSlackMcp({ connections: world.connections, integrations: world.integrations }), { marked: 1 })
  assert.equal((await world.integrations.findOne({ _id: 'iOldSlack' })).statusNote, 'Slack moved. Connect it again on Integrations.')
  await connect(world)
  const moved = await world.integrations.findOne({ _id: 'iOldSlack' })
  assert.deepEqual([moved.address, moved.kind, moved.name, moved.colorIndex, moved.rule, moved.status, moved.statusNote, moved.movedFrom], [SLACK_ADDRESS, 'slack', 'Team chat', 7, 'my_slates', 'active', null, SLACK_MCP_ADDRESS])
  assert.equal((await world.integrations.find({ ownerId: 'ada' })).length, 1, 'moved, not added')
  const agent = await world.connections.findOne({ _id: 'cOld' })
  assert.deepEqual([agent.address, agent.status, agent.integrationId], [SLACK_ADDRESS, 'active', 'iOldSlack'])
  assert.ok(agent.tools.some((t) => t.name === 'search_messages'))
  assert.ok(slack.state.revoked.includes(oldToken), 'the MCP sign-in is revoked at Slack')
  assert.equal(world.credentials.rows.has(credentialId('ada', SLACK_MCP_ADDRESS)), false)
  assert.deepEqual(await retireSlackMcp({ connections: world.connections, integrations: world.integrations }), { marked: 0 }, 'idempotent')
})

// ---------- the agent's tools ----------

test('tools: fixed, so their hashes never move; each calls the right Web API method with the person\'s token, limits clamped to 15, authors named', async () => {
  const world = makeWorld()
  await connect(world)
  const token = await world.vault.tokenFor('ada', SLACK_ADDRESS)
  assert.deepEqual(normalizeTools(SLACK_TOOLS).map((t) => t.hash), normalizeTools(structuredClone(SLACK_TOOLS)).map((t) => t.hash))
  const call = (name, args) => world.slack.slackSession.callTool(SLACK_ADDRESS, null, { name, args }, { token, ownerId: 'ada' })
  slack.state.calls.length = 0
  const found = await call('search_messages', { query: 'pricing', channel: '#launch', after: '2026-11-20', limit: 50 })
  const search = slack.calls('search.messages')[0]
  assert.deepEqual([search.auth, search.params.query, search.params.count], [token, 'pricing in:#launch after:2026-11-20', '15'])
  assert.match(found.content[0].text, /#launch · Ana: We decided on two tiers for pricing/)
  assert.equal(found.content[1].type, 'resource_link')
  assert.equal(found.structuredContent.messages[0].permalink, 'https://acme.slack.com/archives/C0LAUNCH01/p1764000001000100')
  const channels = await call('list_channels', {})
  assert.deepEqual(channels.structuredContent.channels, ['launch', 'random'], 'the channels the person is in')
  const read = await call('read_channel', { channel: 'launch', limit: 99 })
  const history = slack.calls('conversations.history')[0]
  assert.deepEqual([history.params.channel, history.params.limit, history.auth], ['C0LAUNCH01', '15', token])
  assert.match(read.content[0].text, /Ben: Pricing page ships Friday @Ana/, 'ids become names, in the text too')
  assert.ok(!/U0ANA|U0BEN/.test(read.content[0].text))
  world.clock.t += 61000
  const thread = await call('read_thread', { permalink: 'https://acme.slack.com/archives/C0LAUNCH01/p1764000003000300?thread_ts=1764000001.000100&cid=C0LAUNCH01' })
  assert.deepEqual([slack.calls('conversations.replies')[0].params.ts, slack.calls('conversations.replies')[0].params.channel], ['1764000001.000100', 'C0LAUNCH01'])
  assert.match(thread.content[0].text, /Agreed, see the plan \(https:\/\/example.org\/pricing\)/)
  // every call went with the user token, never the bot's, and only to Slack
  assert.ok(slack.state.calls.every((c) => c.auth === token))
  assert.equal(parsePermalink('https://evil.example.com/archives/C0LAUNCH01/p1764000001000100'), null)
  assert.equal(parsePermalink('http://acme.slack.com/archives/C0LAUNCH01/p1764000001000100'), null)
  assert.throws(() => slackOnlyFetch(async () => null)('https://evil.example.com/api/x'), /not a Slack address/)
})

test('tools: Slack\'s refusals in plain words; a revoked token asks to connect again, a missing scope asks for more access', async () => {
  const world = makeWorld()
  await connect(world)
  const token = await world.vault.tokenFor('ada', SLACK_ADDRESS)
  const call = (name, args) => world.slack.slackSession.callTool(SLACK_ADDRESS, null, { name, args }, { token, ownerId: 'ada' })
  const unknown = await call('read_channel', { channel: 'nowhere' })
  assert.deepEqual([unknown.isError, unknown.content[0].text], [true, 'Slack has no channel by that name that you can see.'])
  slack.state.fail.set('search.messages', 'missing_scope')
  await refusedWith(call('search_messages', { query: 'x' }), 'needs_more_access')
  slack.state.fail.set('search.messages', 'token_revoked')
  await refusedWith(call('search_messages', { query: 'x' }), 'needs_sign_in')
  slack.state.fail.set('chat.postMessage', 'not_in_channel')
  const notIn = await call('post_message', { channel: 'launch', text: 'hi' })
  assert.equal(notIn.content[0].text, 'Slack couldn\'t find that channel, or you are not in it.')
  await refusedWith(world.slack.slackSession.callTool(SLACK_ADDRESS, null, { name: 'search_messages', args: { query: 'x' } }, { token: null, ownerId: 'ada' }), 'needs_sign_in')
  // turned off in /admin/ai: the stored sign-in is not used
  world.state.enabled = false
  assert.equal((await call('search_messages', { query: 'x' })).content[0].text, 'Slack integration is turned off on this server.')
})

// ---------- the once-a-minute read gate ----------

test('throttle: a second channel read inside a minute says when, and Slack is not called; then it reads again', async () => {
  const world = makeWorld()
  await connect(world)
  const agent = await inviteSlack(world)
  world.args.read_channel = { channel: 'launch' }
  const first = await world.connectors.call(world.ada, { connectionId: agent.connectionId, request: 'Read #launch' })
  assert.equal(first.items, 1)
  const before = slack.calls('conversations.history').length
  world.clock.t += 18000
  const second = await world.connectors.call(world.ada, { connectionId: agent.connectionId, request: 'Read the latest in #launch' })
  assert.equal(slack.calls('conversations.history').length, before, 'Slack is not called')
  assert.equal(second.items, 0)
  assert.equal(second.say, 'Slack lets Slatebox read a channel or thread only once a minute until Slatebox is listed in the Slack Marketplace. Try again in 42 seconds, or ask a question and Slatebox will search Slack instead.')
  world.clock.t += 43000
  await world.connectors.call(world.ada, { connectionId: agent.connectionId, request: 'Read #launch again' })
  assert.equal(slack.calls('conversations.history').length, before + 1)
})

test('throttle: Slack\'s 429 Retry-After is honored by the shared gate', async () => {
  const world = makeWorld()
  await connect(world)
  const token = await world.vault.tokenFor('ada', SLACK_ADDRESS)
  slack.state.status429 = { method: 'conversations.history', retryAfter: 120 }
  await refusedWith(world.slack.slackSession.callTool(SLACK_ADDRESS, null, { name: 'read_channel', args: { channel: 'launch' } }, { token, ownerId: 'ada' }), 'rate_limited')
  world.clock.t += 90000
  await assert.rejects(world.slack.slackSession.callTool(SLACK_ADDRESS, null, { name: 'read_channel', args: { channel: 'launch' } }, { token, ownerId: 'ada' }), /Try again in 30 seconds/)
})

test('throttle: a search with a throttled read still lands the search\'s ghosts, with the limit said', async () => {
  const world = makeWorld()
  await connect(world)
  const agent = await inviteSlack(world)
  world.args.read_channel = { channel: 'launch' }
  await world.connectors.call(world.ada, { connectionId: agent.connectionId, request: 'Read #launch' })
  world.plan = (offered) => (offered.includes('search_messages') ? [{ tool: 'search_messages', arguments: { query: 'pricing' } }, { tool: 'read_channel', arguments: { channel: 'launch' } }] : [])
  const answer = await world.connectors.call(world.ada, { connectionId: agent.connectionId, request: 'Pricing decisions in #launch' })
  assert.equal(answer.items, 1, 'the search\'s suggestion landed')
  assert.match(answer.say, /^Slack lets Slatebox read a channel or thread only once a minute/)
  assert.ok(JSON.stringify(world.live.applied.at(-1)).includes('Two tiers for pricing'), 'the search\'s notes are what was saved')
})

test('throttle: listed (or a self-hosted internal app) lifts the gate; reads stay at 15 messages unless set', async () => {
  const world = makeWorld({ listed: true })
  await connect(world)
  const token = await world.vault.tokenFor('ada', SLACK_ADDRESS)
  for (let i = 0; i < 3; i++) await world.slack.slackSession.callTool(SLACK_ADDRESS, null, { name: 'read_channel', args: { channel: 'launch' } }, { token, ownerId: 'ada' })
  assert.equal(world.gates.rows.size, 0)
  assert.deepEqual([slackSettings({}).historyLimit, slackSettings({ connectors: { slack: { historyLimit: 50 } } }).historyLimit, slackSettings({ connectors: { slack: { listed: true, historyLimit: 50 } } }).historyLimit], [15, 15, 50])
  assert.equal(slackSettings({ connectors: { slack: { apiBase: 'http://127.0.0.1:9' } } }, { development: false }).apiBase, 'https://slack.com', 'a fake Slack only on a development server')
})

// ---------- changes always wait on a card ----------

test('approval: post and react become cards, never called during an ask; acting without asking is refused for Slack; Approve calls Slack once', async () => {
  const world = makeWorld()
  await connect(world)
  const agent = await inviteSlack(world)
  const postedBefore = slack.state.posted.length
  world.args.post_message = { channel: 'launch', text: 'Pricing ships Friday' }
  const asked = await world.connectors.call(world.ada, { connectionId: agent.connectionId, request: 'Post in #launch that pricing ships Friday' })
  assert.equal(asked.cards.length, 1)
  assert.deepEqual([asked.cards[0].tool, asked.cards[0].state], ['post_message', 'waiting'])
  assert.equal(slack.state.posted.length, postedBefore, 'nothing posted during the ask')
  world.args.add_reaction = { channel: 'launch', timestamp: '1764000002.000200', name: ':thumbsup:' }
  const react = await world.connectors.call(world.ada, { connectionId: agent.connectionId, request: 'React with a thumbsup to the last message in #launch' })
  assert.equal(react.cards[0].tool, 'add_reaction')
  assert.equal(slack.state.reactions.length, 0)
  // acting without asking: refused for Slack, on the slate and for the integration
  const integration = await world.integrations.findOne({ ownerId: 'ada', address: SLACK_ADDRESS })
  await refusedWith(world.connectors.setActing(world.ada, { connectionId: agent.connectionId, actWithoutAsking: 'on' }), 'always_asks')
  await refusedWith(world.connectors.integrationSetActing(world.ada, { integrationId: integration._id, actWithoutAsking: true }), 'always_asks')
  // even a row that says so (set before, or by hand) never acts: Slack always asks
  const doc = await world.connections.findOne({ _id: agent.connectionId })
  assert.equal(alwaysAsks(doc), true)
  assert.equal(actsWithoutAsking({ ...doc, acting: 'on' }, { ...integration, actWithoutAsking: true }, world.slate), false)
  // Approve: posted once, as the person, with its link on the card
  const done = await world.connectors.approve(world.ada, { cardId: asked.cards[0].cardId })
  assert.equal(done.card.state, 'done')
  assert.equal(slack.state.posted.length, postedBefore + 1)
  assert.deepEqual([slack.state.posted.at(-1).channel, slack.state.posted.at(-1).text, slack.state.posted.at(-1).as], ['C0LAUNCH01', 'Pricing ships Friday', 'U0ANA00001'])
  assert.match(done.card.link, /^https:\/\/acme\.slack\.com\/archives\/C0LAUNCH01\/p/)
  assert.equal((await world.connectors.approve(world.ada, { cardId: asked.cards[0].cardId })).card.state, 'done', 'approving again is the same answer')
  assert.equal(slack.state.posted.length, postedBefore + 1, 'posted once')
  await world.connectors.approve(world.ada, { cardId: react.cards[0].cardId })
  assert.deepEqual([slack.state.reactions.at(-1).name, slack.state.reactions.at(-1).timestamp], ['thumbsup', '1764000002.000200'])
  assertNoToken(asked, react, done, world.audits)
})

// ---------- signed requests ----------

const signed = (body, { secret = SIGNING, at = Date.parse('2026-11-27T12:00:00Z'), type = 'json', retry = null } = {}) => {
  const raw = type === 'json' ? JSON.stringify(body) : new URLSearchParams(body).toString()
  const timestamp = String(Math.floor(at / 1000))
  return { raw, headers: { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signatureOf(secret, timestamp, raw), ...(retry && { 'x-slack-retry-num': retry }) } }
}
// An Express-like request (its raw body unread) and response, for a route handler.
async function hit(handler, { raw, headers }) {
  const req = { headers, rawBody: Buffer.from(raw), get: (name) => headers[name.toLowerCase()] }
  const res = {
    statusCode: 200, body: null, headers: {},
    status(code) { this.statusCode = code; return this },
    json(value) { this.body = value; return this },
    end() { return this },
    setHeader(k, v) { this.headers[k] = v },
  }
  await handler(req, res)
  return res
}

test('signature check: a valid request passes; a wrong signature, a stale timestamp or a changed body gets 401 and nothing else', async () => {
  const world = makeWorld()
  const now = Date.parse('2026-11-27T12:00:00Z')
  const ok = signed({ type: 'url_verification', challenge: 'abc123' })
  assert.equal(verifySlackRequest({ signingSecret: SIGNING, ...{ timestamp: ok.headers['x-slack-request-timestamp'], signature: ok.headers['x-slack-signature'] }, raw: ok.raw, now }), true)
  const res = await hit(world.routes.events, ok)
  assert.deepEqual([res.statusCode, res.body], [200, { challenge: 'abc123' }])
  for (const bad of [
    signed({ type: 'url_verification', challenge: 'abc123' }, { secret: 'wrong-secret' }),
    signed({ type: 'url_verification', challenge: 'abc123' }, { at: now - 301000 }),
    { ...ok, raw: ok.raw.replace('abc123', 'abc124') },
    { ...ok, headers: { ...ok.headers, 'x-slack-signature': undefined } },
  ]) {
    const refused = await hit(world.routes.events, bad)
    assert.deepEqual([refused.statusCode, refused.body], [401, null])
  }
  assert.ok(world.logs.some((l) => l.kind === 'slack_unsigned'))
  // the exact bytes are signed, never a decoded copy: a byte that is not UTF-8 still verifies, and a
  // body that decodes to the same text but has other bytes does not
  const bytes = Buffer.from([0x70, 0x3d, 0xff, 0x61])
  const ts = String(Math.floor(now / 1000))
  const byteSig = 'v0=' + (await import('node:crypto')).createHmac('sha256', SIGNING).update(Buffer.concat([Buffer.from(`v0:${ts}:`), bytes])).digest('hex')
  assert.equal(signatureOf(SIGNING, ts, bytes), byteSig)
  assert.equal(verifySlackRequest({ signingSecret: SIGNING, timestamp: ts, signature: byteSig, raw: bytes, now }), true)
  assert.equal(verifySlackRequest({ signingSecret: SIGNING, timestamp: ts, signature: byteSig, raw: Buffer.from([0x70, 0x3d, 0xfe, 0x61]), now }), false)
  // the modal's metadata is signed the same way: a changed one is refused
  const meta = signMetadata(SIGNING, { c: 'C0LAUNCH01', t: '1764000001.000100', k: 'k' })
  assert.deepEqual(openMetadata(SIGNING, meta), { c: 'C0LAUNCH01', t: '1764000001.000100', k: 'k' })
  assert.equal(openMetadata(SIGNING, meta.replace(/^./, (c) => (c === 'e' ? 'f' : 'e'))), null)
  assert.equal(openMetadata('another-secret', meta), null)
})

test('the raw body: Slack\'s paths skip express.json, so the signature is checked over the exact bytes Slack sent', () => {
  assert.equal(isSlackPath('/integrations/slack/events'), true)
  assert.equal(isSlackPath('/integrations/slack/interactive'), true)
  assert.equal(isSlackPath('/connectors/oauth/start'), false)
  const app = readFileSync(new URL('../web/app/server/expressApp.js', import.meta.url), 'utf8')
  assert.match(app, /isApiPath\(req\.path\) \|\| isMcpPath\(req\.path\) \|\| isSlackPath\(req\.path\) \? next\(\) : json\(req, res, next\)/)
})

test('events: a retried event_id is handled once; the answer comes before the work', async () => {
  const world = makeWorld()
  await connect(world)
  const event = { type: 'event_callback', event_id: 'Ev0001', team_id: 'T0ACME0001', event: { type: 'link_shared', channel: 'C0LAUNCH01', message_ts: '1764000009.000100', links: [{ domain: 'slate.example.com', url: `${ORIGIN}/canvas/publicOne` }] } }
  const res = await hit(world.routes.events, signed(event))
  assert.equal(res.statusCode, 200)
  assert.equal(slack.state.unfurls.length, 0, 'answered first, the work after')
  await world.runLater()
  const unfurled = slack.state.unfurls.length
  assert.equal(unfurled > 0, true)
  await hit(world.routes.events, signed(event, { retry: '1' }))
  await world.runLater()
  assert.equal(slack.state.unfurls.length, unfurled, 'the retry is answered and dropped')
})

// ---------- link previews ----------

test('unfurl: a public slate shows its name and picture; private, team and unlisted ones, or an unknown one, only "Private slate"; other links are ignored', async () => {
  const world = makeWorld()
  await connect(world)
  slack.state.unfurls.length = 0
  const links = [`${ORIGIN}/canvas/publicOne`, `${ORIGIN}/canvas/privateOne`, `${ORIGIN}/canvas/unknown00`, `${ORIGIN}/present/deck01`, 'https://other.example.com/canvas/publicOne', `${ORIGIN}/admin/ai`]
  await world.slack.linkShared({ team_id: 'T0ACME0001', event: { channel: 'C0LAUNCH01', message_ts: '1764000009.000100', links: links.map((url) => ({ url })) } })
  const sent = slack.state.unfurls[0]
  assert.deepEqual(Object.keys(sent.unfurls).sort(), [`${ORIGIN}/canvas/privateOne`, `${ORIGIN}/canvas/publicOne`, `${ORIGIN}/canvas/unknown00`, `${ORIGIN}/present/deck01`].sort())
  assert.equal(sent.channel, 'C0LAUNCH01')
  const bot = slack.calls('chat.unfurl').at(-1).auth
  assert.equal(slack.state.tokens.get(bot).kind, 'bot', 'with the workspace\'s bot token')
  const pub = sent.unfurls[`${ORIGIN}/canvas/publicOne`].blocks[0]
  assert.equal(pub.text.text, `*<${ORIGIN}/canvas/publicOne|Roadmap &lt;2027&gt;>*\nWhere we go`)
  assert.equal(pub.accessory.image_url, 'https://files.example.com/slate/publicOne_1.png')
  const minimal = { blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*Private slate* · <${ORIGIN}/canvas/privateOne|Open in Slatebox>` } }] }
  assert.deepEqual(sent.unfurls[`${ORIGIN}/canvas/privateOne`], minimal)
  assert.deepEqual(sent.unfurls[`${ORIGIN}/canvas/unknown00`].blocks[0].text.text, `*Private slate* · <${ORIGIN}/canvas/unknown00|Open in Slatebox>`)
  assert.match(sent.unfurls[`${ORIGIN}/present/deck01`].blocks[0].text.text, /Launch deck/)
  // a workspace that never installed: nothing is sent
  assert.deepEqual(await world.slack.linkShared({ team_id: 'T0OTHER001', event: { links: [{ url: `${ORIGIN}/canvas/publicOne` }] } }), { unfurled: 0 })
})

// ---------- Send to slate ----------

const shortcut = (user = 'U0ANA00001') => ({
  type: 'message_action', callback_id: 'send_to_slate', trigger_id: 'trig1', team: { id: 'T0ACME0001' }, user: { id: user }, channel: { id: 'C0LAUNCH01', name: 'launch' },
  message: { ts: '1764000001.000100', user: 'U0ANA00001', text: 'We decided on two tiers' }, response_url: `${slack.origin}/hooks/response`,
})

test('Send to slate: an unlinked Slack person gets the connect modal; a linked one picks from slates they can edit', async () => {
  const world = makeWorld()
  await connect(world)
  slack.state.views.length = 0
  await world.slack.messageAction(shortcut('U0STRANGER'))
  assert.match(JSON.stringify(slack.state.views[0].view), /Connect Slack in Slatebox first/)
  assert.match(JSON.stringify(slack.state.views[0].view), new RegExp(`${ORIGIN}/integrations`))
  const opened = await world.slack.messageAction(shortcut())
  assert.deepEqual(opened, { opened: 'slates', slates: 1 })
  const view = slack.state.views[1].view
  assert.equal(view.callback_id, 'send_to_slate')
  assert.deepEqual(view.blocks[0].element.options, [{ text: { type: 'plain_text', text: 'Launch review' }, value: 'shareA' }])
  assert.ok(!view.private_metadata.includes('two tiers') && !Buffer.from(view.private_metadata.split('.')[0], 'base64url').toString().includes('two tiers'), 'only which message, never its text')
  assert.equal(slack.state.tokens.get(slack.calls('views.open').at(-1).auth).kind, 'bot')
})

test('Send to slate: one suggestion lands with its link; a slate they can no longer edit, or changed metadata, is refused', async () => {
  const world = makeWorld()
  await connect(world)
  slack.state.views.length = 0
  slack.state.responses.length = 0
  await world.slack.messageAction(shortcut())
  const view = slack.state.views[0].view
  const submit = (meta = view.private_metadata, shareId = 'shareA') => ({ type: 'view_submission', team: { id: 'T0ACME0001' }, user: { id: 'U0ANA00001' }, view: { callback_id: 'send_to_slate', private_metadata: meta, state: { values: { slate: { pick: { selected_option: { value: shareId } } } } } } })
  const tampered = await world.slack.viewSubmission(submit(signMetadata('not-the-secret', { c: 'C0LAUNCH01', t: '1764000001.000100', k: 'x' })))
  assert.equal(tampered.response.response_action, 'errors')
  world.roles.ada = 'read'
  const lost = await world.slack.viewSubmission(submit())
  assert.deepEqual(lost.response, { response_action: 'errors', errors: { slate: 'You can\'t edit that slate any more. Pick another.' } })
  world.roles.ada = 'edit'
  const ok = await world.slack.viewSubmission(submit())
  assert.deepEqual(ok.response, { response_action: 'clear' })
  assert.deepEqual(await ok.land(), { landed: 1 })
  const waiting = await world.live.suggestions.waiting(world.slate)
  assert.equal(waiting.length, 1)
  const text = JSON.stringify(world.live.applied.at(-1)[1].plan)
  assert.match(text, /Ana: We decided on two tiers/)
  assert.match(text, /https:\/\/acme\.slack\.com\/archives\/C0LAUNCH01\/p1764000001000100/)
  assert.deepEqual(slack.state.responses.at(-1), { response_type: 'ephemeral', replace_original: false, text: 'Sent to *Launch review*. Keep it on the slate to make it a note.' })
  assert.equal(world.slack._pending.size, 0, 'nothing of the message is held once it landed')
  assertNoToken(waiting, world.audits)
  assert.ok(!JSON.stringify(world.audits).includes('two tiers'), 'audits keep counts, never text')
})

test('Send to slate through the route: signed form payload, answered at once, the modal right after', async () => {
  const world = makeWorld()
  await connect(world)
  slack.state.views.length = 0
  const res = await hit(world.routes.interactive, signed({ payload: JSON.stringify(shortcut()) }, { type: 'form' }))
  assert.equal(res.statusCode, 200)
  await world.runLater()
  assert.equal(slack.state.views.length, 1)
})

test('/slatebox: up to five of the person\'s slates whose names match, only they see it; an unlinked person is told to connect', async () => {
  const world = makeWorld()
  await connect(world)
  const res = await hit(world.routes.commands, signed({ team_id: 'T0ACME0001', user_id: 'U0ANA00001', command: '/slatebox', text: 'launch' }, { type: 'form' }))
  assert.deepEqual(res.body, { response_type: 'ephemeral', text: `<${ORIGIN}/canvas/shareA|Launch review>` })
  const stranger = await hit(world.routes.commands, signed({ team_id: 'T0ACME0001', user_id: 'U0STRANGER', text: '' }, { type: 'form' }))
  assert.equal(stranger.body.text, `Connect Slack in Slatebox first: <${ORIGIN}/integrations|Integrations>.`)
})

// ---------- uninstall, revocation, disconnect, deletion ----------

test('app_uninstalled removes the bot token and every member\'s sign-in, and says why; tokens_revoked removes only the listed ones', async () => {
  const world = makeWorld()
  await connect(world, { userId: 'ada' })
  world.roles.sam = 'edit'
  await connect(world, { userId: 'sam', grant: { user: 'U0SAM00001' } })
  const adaAgent = await inviteSlack(world)
  assert.deepEqual(await world.slack.tokensRevoked('T0ACME0001', { oauth: ['U0SAM00001'] }), { people: 1, bots: 0 })
  assert.equal((await world.integrations.findOne({ ownerId: 'sam', address: SLACK_ADDRESS })).status, 'needs_sign_in')
  assert.equal((await world.integrations.findOne({ ownerId: 'ada', address: SLACK_ADDRESS })).status, 'active', 'only the listed person')
  assert.ok(world.workspaces.rows.has('T0ACME0001'))
  const revokedBefore = slack.state.revoked.length
  assert.deepEqual(await world.slack.uninstalled('T0ACME0001'), { people: 2 })
  assert.equal(world.workspaces.rows.size, 0)
  assert.equal(world.credentials.rows.size, 0)
  const ada = await world.integrations.findOne({ ownerId: 'ada', address: SLACK_ADDRESS })
  assert.deepEqual([ada.status, ada.statusNote], ['needs_sign_in', 'Slatebox was removed from your Slack workspace. Connect Slack again once it is back.'])
  assert.equal((await world.connections.findOne({ _id: adaAgent.connectionId })).status, 'needs_sign_in')
  assert.equal(slack.state.revoked.length, revokedBefore, 'dead tokens are not revoked again')
  const listed = await world.connectors.integrationsList(world.ada)
  assert.equal(listed.integrations[0].statusNote, ada.statusNote)
  // the bot token alone, when Slack lists the bot
  await connect(world, { userId: 'ada' })
  assert.deepEqual(await world.slack.tokensRevoked('T0ACME0001', { bot: ['U0BOT00001'] }), { people: 0, bots: 1 })
  assert.equal(world.workspaces.rows.size, 0)
})

test('disconnect revokes the token at Slack (its ok is read) and the next call fails; the integration is gone', async () => {
  const world = makeWorld()
  await connect(world)
  const token = await world.vault.tokenFor('ada', SLACK_ADDRESS)
  const row = await world.integrations.findOne({ ownerId: 'ada', address: SLACK_ADDRESS })
  const out = await world.connectors.integrationDisconnect(world.ada, { integrationId: row._id })
  assert.deepEqual([out.ok, out.signedOut, out.note], [true, true, undefined], 'Slack confirmed: no "did not confirm" note')
  assert.ok(slack.state.revoked.includes(token))
  assert.equal(await world.integrations.findOne({ _id: row._id }), null)
  const after = await world.slack.slackSession.callTool(SLACK_ADDRESS, null, { name: 'list_channels', args: {} }, { token, ownerId: 'ada' }).catch((e) => e)
  assert.equal(after.code, 'needs_sign_in', 'the next call with the old token fails')
  // a revocation Slack refuses (HTTP 200, ok:false) is not reported as done
  await connect(world)
  const second = await world.integrations.findOne({ ownerId: 'ada', address: SLACK_ADDRESS })
  slack.state.fail.set('auth.revoke', 'invalid_auth')
  const refused = await world.connectors.integrationDisconnect(world.ada, { integrationId: second._id })
  assert.match(refused.note, /did not confirm that Slatebox's access ended/)
})

test('account deletion: Slack is disconnected (its sign-in revoked), its agents and cards go, and the workspace it installed no longer names the person', async () => {
  const world = makeWorld()
  await connect(world)
  const agent = await inviteSlack(world)
  world.args.post_message = { channel: 'launch', text: 'bye' }
  await world.connectors.call(world.ada, { connectionId: agent.connectionId, request: 'Post in #launch that we are done' })
  assert.ok((await world.outside.find({ ownerId: 'ada' })).length > 0)
  const token = await world.vault.tokenFor('ada', SLACK_ADDRESS)
  const out = await world.connectors.forgetPerson('ada', {
    credentialRows: async (id) => [...world.credentials.rows.values()].filter((r) => r.ownerId === id),
    natives: (id) => world.slack.forgetPerson(id),
  })
  assert.deepEqual([out.disconnected, out.failed], [1, []])
  assert.deepEqual([(await world.integrations.find({ ownerId: 'ada' })).length, (await world.connections.find({ ownerId: 'ada' })).length, (await world.outside.find({ ownerId: 'ada' })).length, world.credentials.rows.size], [0, 0, 0, 0])
  assert.ok(slack.state.revoked.includes(token), 'revoked at Slack')
  assert.equal(world.workspaces.rows.get('T0ACME0001').installedBy, null, 'the workspace\'s bot stays for its other members, without the person\'s id')
})

test('the Slack card: native, in the invite gallery, its changes always ask, its asks search first', () => {
  const card = INVITE_CARDS.find((c) => c.id === 'slack')
  assert.deepEqual([card.kind, card.url, card.signIn, card.alwaysAsk, card.needsApp], ['native', SLACK_ADDRESS, 'slack', true, 'slack'])
  assert.equal(INVITE_CARDS.filter((c) => c.id === 'slack').length, 1)
  assert.ok(!JSON.stringify(card).includes('canvas'), 'Slack canvases are not read or made (the Web API has no way to read their text)')
})

test('docs/slack-app-manifest.json is Slatebox Cloud\'s app (app.slatebox.com, and test.slatebox.com\'s sign-in), the same manifest Admin shows, its scopes the ones asked for', () => {
  const docs = JSON.parse(readFileSync(new URL('../docs/slack-app-manifest.json', import.meta.url), 'utf8'))
  assert.deepEqual(docs, slackManifest({ origin: 'https://app.slatebox.com', redirects: ['https://test.slatebox.com/connectors/oauth/callback'] }))
  assert.deepEqual(docs.oauth_config.scopes.user, [...SLACK_USER_SCOPES])
  assert.deepEqual(docs.oauth_config.scopes.bot, [...SLACK_BOT_SCOPES])
  const row = readFileSync(new URL('../docs/integrations.md', import.meta.url), 'utf8').split('\n').find((line) => line.startsWith('| `slack` |'))
  assert.ok(row.includes(SLACK_USER_SCOPES.join(' ')) && row.includes(SLACK_BOT_SCOPES.join(' ')), 'docs/integrations.md lists the same scopes')
})
