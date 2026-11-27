// Integration sign-in hygiene (review, 2026-11-27): deleting an account removes the person's
// integration sign-ins and rows (only theirs); Disconnect revokes at each vendor, its own way, and
// counts it done only when the vendor says so (Slack answers 200 with {"ok":false}); sign-ins saved
// before Slatebox kept a revocation endpoint fall back to the known vendor's; Slack is asked for
// exactly the scopes the Slack card uses, the same list as the Slack app manifest.
// Every vendor here is a fake behind fetch: nothing touches the network.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/integration-signin-hygiene.test.mjs
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  appFor, chooseScopes, discoverSignIn, KNOWN_PROVIDERS, OAUTH_LIMITS, revocationOf, revokeToken, SLACK_SCOPES,
} from '../enterprise/server/oauth.mjs'
import { createVault, credentialId } from '../enterprise/server/credentials.mjs'
import { createConnectorService, memoryStore } from '../enterprise/server/service.mjs'
import { FORGET_LIMITS, INTEGRATION_ROWS, removeIntegrationsOf, setAccountIntegrations } from '../web/app/server/integrations/account-removal.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'
import { sanitizeClientName } from '../web/app/imports/api/common/agent-label.mjs'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const newMaster = () => loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') })

// Slack's MCP metadata, as served 2026-11-27 (30 scopes, no revocation_endpoint).
const SLACK_METADATA_SCOPES = ['canvases:read', 'canvases:write', 'channels:history', 'channels:read', 'channels:write', 'chat:write', 'emoji:read', 'files:read', 'files:write',
  'groups:history', 'groups:read', 'groups:write', 'im:history', 'im:read', 'im:write', 'lists:read', 'lists:write', 'mpim:history', 'mpim:read', 'mpim:write', 'reactions:read',
  'reactions:write', 'search:read.files', 'search:read.im', 'search:read.mpim', 'search:read.private', 'search:read.public', 'search:read.users', 'users:read', 'users:read.email']

// A fake vendor: records every request, answers with respond(url, init).
function vendor(respond) {
  const sent = []
  return {
    sent,
    fetch: async (url, init = {}) => {
      sent.push({ url: String(url), init })
      return respond(String(url), init)
    },
  }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const form = (init) => new URLSearchParams(init.body)

// ---------- (3) Slack scopes ----------

test('Slack: Slatebox asks for exactly the 14 scopes the Slack card uses, never the metadata\'s 30 cut at 24', () => {
  assert.deepEqual([...SLACK_SCOPES], ['canvases:read', 'canvases:write', 'channels:history', 'channels:read', 'chat:write', 'groups:history', 'groups:read', 'im:history',
    'mpim:history', 'search:read.public', 'search:read.private', 'search:read.im', 'search:read.mpim', 'users:read'])
  assert.equal(KNOWN_PROVIDERS.slack.scopes, SLACK_SCOPES)
  assert.ok(Object.isFrozen(SLACK_SCOPES))
  // Every one is a scope Slack's server has, and the list fits the cap whole.
  for (const scope of SLACK_SCOPES) assert.ok(SLACK_METADATA_SCOPES.includes(scope), scope)
  assert.ok(SLACK_SCOPES.length <= OAUTH_LIMITS.scopes)
  // The app from settings carries no scopes: the sign-in asks for the 14, search and users:read included.
  const app = appFor('https://mcp.slack.com', { slack: { clientId: 'slack-client', clientSecret: 's' } }, 'https://mcp.slack.com')
  assert.deepEqual(app.scopes, [...SLACK_SCOPES])
  const asked = chooseScopes({ app, scopes: { challenge: [], resource: SLACK_METADATA_SCOPES }, server: { offlineAccess: false }, resource: 'https://mcp.slack.com' })
  assert.deepEqual(asked, [...SLACK_SCOPES])
  for (const needed of ['search:read.public', 'search:read.private', 'search:read.im', 'search:read.mpim', 'users:read']) assert.ok(asked.includes(needed), needed)
  for (const dropped of ['channels:write', 'files:read', 'files:write', 'groups:write', 'im:write', 'mpim:write', 'reactions:write', 'users:read.email', 'lists:write', 'emoji:read'])
    assert.ok(!asked.includes(dropped), dropped)
  // An operator's own `scopes` still replaces it on purpose.
  assert.deepEqual(appFor('https://mcp.slack.com', { slack: { clientId: 'x', scopes: ['search:read.public'] } }, 'https://mcp.slack.com').scopes, ['search:read.public'])
})

test('Slack: each scope names the feature that needs it, and the Slack app manifest and the docs list the same set', () => {
  const source = read('enterprise/server/oauth.mjs')
  const block = source.slice(source.indexOf('export const SLACK_SCOPES'), source.indexOf('])', source.indexOf('export const SLACK_SCOPES')))
  for (const scope of SLACK_SCOPES) assert.match(block, new RegExp(`'${scope.replace('.', '\\.')}', // \\S.{10,}`), `${scope} has a reason`)
  const manifest = JSON.parse(read('docs/slack-app-manifest.json'))
  assert.deepEqual([...manifest.oauth_config.scopes.user].sort(), [...SLACK_SCOPES].sort())
  assert.equal(manifest.oauth_config.scopes.bot, undefined, 'no bot scopes: Slatebox acts as the signed-in person only')
  assert.ok(manifest.oauth_config.redirect_urls.every((url) => url.startsWith('https://') && url.endsWith('/connectors/oauth/callback')))
  const row = read('docs/integrations.md').split('\n').find((line) => line.startsWith('| `slack` |'))
  assert.ok(row.includes('`' + SLACK_SCOPES.join(' ') + '`'), 'docs/integrations.md lists the same scopes')
  // The Slack card calls only tools these scopes cover (the recipe's tools).
  const card = read('enterprise/common/gallery.mjs')
  const slack = card.slice(card.indexOf("id: 'slack'"), card.indexOf("id: 'granola'"))
  const tools = [...new Set(slack.match(/slack_[a-z_]+/g))].sort()
  assert.deepEqual(tools, ['slack_create_canvas', 'slack_read_canvas', 'slack_read_channel', 'slack_read_user_profile', 'slack_search_public', 'slack_search_public_and_private', 'slack_send_message'])
})

// ---------- (2) revocation, each vendor its own way ----------

test('discovery: the metadata\'s revocation_endpoint wins; Slack, Zoom and GitHub (none advertised) get their documented ones; Microsoft has none', async () => {
  const slack = vendor((url) => {
    if (url === 'https://mcp.slack.com/.well-known/oauth-protected-resource/mcp') return json({ resource: 'https://mcp.slack.com', authorization_servers: ['https://mcp.slack.com'], scopes_supported: SLACK_METADATA_SCOPES })
    if (url === 'https://mcp.slack.com/.well-known/oauth-authorization-server')
      return json({ issuer: 'https://mcp.slack.com', authorization_endpoint: 'https://slack.com/oauth/v2_user/authorize', token_endpoint: 'https://slack.com/api/oauth.v2.user.access', code_challenge_methods_supported: ['S256'], scopes_supported: SLACK_METADATA_SCOPES })
    return new Response('no', { status: 404 })
  })
  const found = await discoverSignIn({ address: 'https://mcp.slack.com/mcp', fetch: slack.fetch })
  assert.equal(found.server.revocationEndpoint, 'https://slack.com/api/auth.revoke')
  assert.equal(found.server.revocation, 'slack')
  const asana = vendor((url) => {
    if (url.startsWith('https://mcp.asana.com/.well-known/oauth-protected-resource')) return json({ resource: 'https://mcp.asana.com/v2', authorization_servers: ['https://app.asana.com'] })
    if (url === 'https://app.asana.com/.well-known/oauth-authorization-server')
      return json({ issuer: 'https://app.asana.com', authorization_endpoint: 'https://app.asana.com/-/oauth_authorize', token_endpoint: 'https://app.asana.com/-/oauth_token', revocation_endpoint: 'https://app.asana.com/-/oauth_revoke_advertised', code_challenge_methods_supported: ['S256'] })
    return new Response('no', { status: 404 })
  })
  const advertised = await discoverSignIn({ address: 'https://mcp.asana.com/v2/mcp', fetch: asana.fetch })
  assert.equal(advertised.server.revocationEndpoint, 'https://app.asana.com/-/oauth_revoke_advertised')
  assert.equal(advertised.server.revocation, undefined, 'an advertised endpoint is RFC 7009')
  // Every known vendor says how its sign-ins end; only Microsoft says it can't.
  for (const [provider, known] of Object.entries(KNOWN_PROVIDERS)) {
    assert.ok('revoke' in known, `${provider} says how a sign-in ends`)
    if (provider === 'microsoft') assert.equal(known.revoke, null)
    else assert.match(known.revoke.url, /^https:\/\/[a-z0-9.-]+\//, provider)
  }
  assert.equal(revocationOf({ issuer: KNOWN_PROVIDERS.microsoft.issuer, tokenEndpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token' }), null)
})

test('Slack: auth.revoke gets the token alone; HTTP 200 with {"ok":false} is a failure, only {"ok":true} is success', async () => {
  const server = { issuer: 'https://mcp.slack.com', tokenEndpoint: 'https://slack.com/api/oauth.v2.user.access', revocationEndpoint: 'https://slack.com/api/auth.revoke', revocation: 'slack' }
  const client = { clientId: 'slack-client', clientSecret: 'slack-secret' }
  const good = vendor(() => json({ ok: true, revoked: true }))
  assert.equal(await revokeToken({ server, client, token: 'xoxp-1', hint: 'access_token', fetch: good.fetch }), true)
  assert.equal(good.sent[0].url, 'https://slack.com/api/auth.revoke')
  assert.equal(good.sent[0].init.method, 'POST')
  assert.deepEqual([...form(good.sent[0].init).keys()], ['token'], 'no client secret, no hint')
  assert.equal(form(good.sent[0].init).get('token'), 'xoxp-1')
  for (const answer of [json({ ok: false, error: 'invalid_auth' }), json({ ok: false, error: 'token_revoked' }), new Response('<html>busy</html>', { status: 200 }), json({ ok: true }, 500), json({})]) {
    const bad = vendor(() => answer)
    assert.equal(await revokeToken({ server, client, token: 'xoxp-1', hint: 'access_token', fetch: bad.fetch }), false)
  }
})

test('GitHub: DELETE /applications/{client_id}/token with the app as Basic auth; only 204 is success; a refresh token is never sent', async () => {
  const server = { issuer: 'https://github.com/login/oauth', tokenEndpoint: 'https://github.com/login/oauth/access_token' }
  const client = { clientId: 'Iv1.abc', clientSecret: 'gh-secret' }
  const ok = vendor(() => new Response(null, { status: 204 }))
  assert.equal(await revokeToken({ server, client, token: 'gho_1', hint: 'access_token', fetch: ok.fetch }), true)
  const sent = ok.sent[0]
  assert.equal(sent.url, 'https://api.github.com/applications/Iv1.abc/token')
  assert.equal(sent.init.method, 'DELETE')
  assert.equal(sent.init.headers.authorization, 'Basic ' + Buffer.from('Iv1.abc:gh-secret').toString('base64'))
  assert.deepEqual(JSON.parse(sent.init.body), { access_token: 'gho_1' })
  for (const status of [200, 404, 422]) assert.equal(await revokeToken({ server, client, token: 'gho_1', hint: 'access_token', fetch: vendor(() => new Response('{}', { status })).fetch }), false)
  const none = vendor(() => new Response(null, { status: 204 }))
  assert.equal(await revokeToken({ server, client, token: 'ghr_1', hint: 'refresh_token', fetch: none.fetch }), false)
  assert.equal(await revokeToken({ server, client: { clientId: 'Iv1.abc' }, token: 'gho_1', hint: 'access_token', fetch: none.fetch }), false)
  assert.equal(none.sent.length, 0)
})

test('Zoom: Basic auth, and only {"status":"success"} is success', async () => {
  const server = { issuer: 'https://zoom.us', tokenEndpoint: 'https://zoom.us/oauth/token', tokenAuth: 'basic' }
  const client = { clientId: 'zc', clientSecret: 'zs' }
  const ok = vendor(() => json({ status: 'success' }))
  assert.equal(await revokeToken({ server, client, token: 'z1', hint: 'access_token', fetch: ok.fetch }), true)
  assert.equal(ok.sent[0].url, 'https://zoom.us/oauth/revoke')
  assert.equal(ok.sent[0].init.headers.authorization, 'Basic ' + Buffer.from('zc:zs').toString('base64'))
  assert.equal(form(ok.sent[0].init).get('client_secret'), null)
  assert.equal(await revokeToken({ server, client, token: 'z1', fetch: vendor(() => json({ status: 'failed' })).fetch }), false)
  assert.equal(await revokeToken({ server, client, token: 'z1', fetch: vendor(() => json({ reason: 'Invalid Token', error: 'invalid_request' }, 400)).fetch }), false)
})

test('RFC 7009 vendors (Asana, HubSpot, Box, Pitch, Salesforce, Google): form POST with the client and the hint; a 2xx is success, anything else or a throw is not', async () => {
  const expected = {
    asana: 'https://app.asana.com/-/oauth_revoke',
    hubspot: 'https://mcp.hubspot.com/oauth/v3/token/revoke',
    box: 'https://api.box.com/oauth2/revoke',
    pitch: 'https://auth.pitch.com/oauth/revoke',
    salesforce: 'https://login.salesforce.com/services/oauth2/revoke',
    google: 'https://oauth2.googleapis.com/revoke',
  }
  for (const [provider, url] of Object.entries(expected)) {
    const server = { issuer: KNOWN_PROVIDERS[provider].issuer, tokenEndpoint: 'https://example.com/token' }
    assert.deepEqual(revocationOf(server), { url, style: 'rfc7009' }, provider)
    const ok = vendor(() => new Response('', { status: 200 }))
    assert.equal(await revokeToken({ server, client: { clientId: 'c', clientSecret: 's' }, token: 'r1', hint: 'refresh_token', fetch: ok.fetch }), true, provider)
    assert.equal(ok.sent[0].url, url)
    const body = form(ok.sent[0].init)
    assert.deepEqual(Object.fromEntries(body), { token: 'r1', token_type_hint: 'refresh_token', client_id: 'c', client_secret: 's' })
    assert.equal(await revokeToken({ server, client: { clientId: 'c' }, token: 'r1', fetch: vendor(() => new Response('', { status: 400 })).fetch }), false, provider)
    assert.equal(await revokeToken({ server, client: { clientId: 'c' }, token: 'r1', fetch: async () => { throw new TypeError('fetch failed') } }), false, provider)
  }
})

// ---------- the vault: fallback for old sign-ins, honest results, logs without tokens ----------

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

const SLACK_ADDRESS = 'https://mcp.slack.com/mcp'
// A Slack sign-in saved before the fix: its server has no revocation endpoint.
const oldSlackSignIn = (vault, userId = 'ada') => vault.save({
  userId,
  address: SLACK_ADDRESS,
  resource: 'https://mcp.slack.com',
  issuer: 'https://mcp.slack.com',
  kind: 'oauth',
  registration: { kind: 'preregistered', clientId: 'slack-client', provider: 'slack' },
  server: { issuer: 'https://mcp.slack.com', tokenEndpoint: 'https://slack.com/api/oauth.v2.user.access' },
  tokens: { accessToken: 'xoxp-secret-access', refreshToken: 'xoxe-secret-refresh', expiresAt: Date.now() + 3600000, scopes: [...SLACK_SCOPES] },
})

test('a Slack sign-in saved before Slatebox kept a revocation endpoint is still revoked at auth.revoke, and forgotten', async () => {
  const store = credentialMemory()
  const slack = vendor((url, init) => json(form(init).get('token') === 'xoxp-secret-access' ? { ok: true, revoked: true } : { ok: false, error: 'invalid_auth' }))
  const logs = []
  const vault = createVault({ store, master: newMaster(), fetch: slack.fetch, secretFor: () => 'slack-secret', log: (entry) => logs.push(entry) })
  await oldSlackSignIn(vault)
  assert.equal(store.rows.get(credentialId('ada', SLACK_ADDRESS)).server.revocationEndpoint, undefined)
  assert.deepEqual(await vault.remove('ada', SLACK_ADDRESS), { removed: true, revoked: true })
  assert.deepEqual(slack.sent.map((s) => s.url), ['https://slack.com/api/auth.revoke', 'https://slack.com/api/auth.revoke'])
  assert.equal(store.rows.size, 0)
  assert.deepEqual(logs, [])
})

test('Slack answering {"ok":false}: forgotten anyway, revokeFailed, and the log names hosts and a reason only (no token)', async () => {
  const store = credentialMemory()
  const logs = []
  const vault = createVault({ store, master: newMaster(), fetch: vendor(() => json({ ok: false, error: 'invalid_auth' })).fetch, log: (entry) => logs.push(entry) })
  await oldSlackSignIn(vault)
  assert.deepEqual(await vault.remove('ada', SLACK_ADDRESS), { removed: true, revoked: false, revokeFailed: true })
  assert.equal(store.rows.size, 0)
  assert.deepEqual(logs, [{ kind: 'revoke_failed', reason: 'not_confirmed', server: 'slack.com', address: 'mcp.slack.com' }])
  assert.doesNotMatch(JSON.stringify(logs), /xox|secret/)
})

test('a vendor with no way to end a sign-in (Microsoft): nothing sent, forgotten, revokeFailed so the person is told', async () => {
  const store = credentialMemory()
  const logs = []
  const sent = vendor(() => new Response('', { status: 200 }))
  const vault = createVault({ store, master: newMaster(), fetch: sent.fetch, log: (entry) => logs.push(entry) })
  await vault.save({
    userId: 'ada', address: 'https://workiq.svc.cloud.microsoft/mcp', resource: 'https://workiq.svc.cloud.microsoft', issuer: KNOWN_PROVIDERS.microsoft.issuer, kind: 'oauth',
    registration: { kind: 'preregistered', clientId: 'm', provider: 'microsoft' }, server: { issuer: KNOWN_PROVIDERS.microsoft.issuer, tokenEndpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token', noResource: true },
    tokens: { accessToken: 'eyJ-secret', refreshToken: 'm-refresh', expiresAt: Date.now() + 3600000 },
  })
  assert.deepEqual(await vault.remove('ada', 'https://workiq.svc.cloud.microsoft/mcp'), { removed: true, revoked: false, revokeFailed: true })
  assert.equal(sent.sent.length, 0)
  assert.equal(logs[0].reason, 'not_offered')
  // A pasted key is not a sign-in a server issued: nothing to revoke, nothing to report.
  await vault.save({ userId: 'ada', address: 'https://keys.example/mcp', resource: 'https://keys.example/mcp', issuer: 'key', kind: 'key', tokens: { accessToken: 'key-secret' } })
  assert.deepEqual(await vault.remove('ada', 'https://keys.example/mcp'), { removed: true, revoked: false })
})

// ---------- a service world: Ada and Sam, teammates on the same slates ----------

function world({ slackAnswer = { ok: true, revoked: true }, slackDown = false } = {}) {
  const slates = {
    shareA: { _id: 'slateA', shareId: 'shareA', userId: 'ada' },
    shareC: { _id: 'slateC', shareId: 'shareC', userId: 'sam' },
  }
  const connections = memoryStore()
  const integrations = memoryStore()
  const outside = memoryStore()
  const credentials = credentialMemory()
  const withdrawn = []
  const audits = []
  const slack = vendor(() => {
    if (slackDown) throw new TypeError('fetch failed')
    return json(slackAnswer)
  })
  const vault = createVault({ store: credentials, master: newMaster(), fetch: slack.fetch, secretFor: () => 'slack-secret' })
  const service = createConnectorService({
    connections,
    integrations,
    outside,
    suggestions: { agentIdOf: async () => 'agent-x', withdraw: async (person, slate, agentId) => withdrawn.push([person.userId, slate._id, agentId]), paused: async () => false },
    fetch: async () => { throw new Error('no MCP calls here') },
    session: { discover: async () => ({ tools: [] }), callTool: async () => ({}) },
    model: async () => ({}),
    applyOperations: async () => ({ status: 202, body: {} }),
    access: { forUser: async (shareId) => (slates[shareId] ? { slate: slates[shareId], canRead: true, canEdit: true } : null), reload: async (shareId) => slates[shareId] },
    firstName: async (id) => id,
    sanitizeName: sanitizeClientName,
    presence: { plan: async () => {}, step: async () => {}, saved: async () => {}, end: async () => {} },
    vault,
    audit: (entry) => audits.push(entry),
  })
  const at = new Date()
  const seed = async () => {
    // Ada's Slack (a sign-in), on her slate and on Sam's; Sam's own Slack, on Ada's slate.
    await oldSlackSignIn(vault, 'ada')
    await oldSlackSignIn(vault, 'sam')
    // Ada also signed in to a server she never connected.
    await vault.save({ userId: 'ada', address: 'https://orphan.example/mcp', resource: 'https://orphan.example/mcp', issuer: 'key', kind: 'key', tokens: { accessToken: 'orphan-key' } })
    for (const [id, ownerId] of [['iAda', 'ada'], ['iSam', 'sam']])
      await integrations.insert({ _id: id, ownerId, address: SLACK_ADDRESS, host: 'mcp.slack.com', name: 'Slack', auth: true, status: 'active', tools: [], createdAt: at })
    for (const [id, ownerId, integrationId, share] of [['cAdaA', 'ada', 'iAda', 'shareA'], ['cAdaC', 'ada', 'iAda', 'shareC'], ['cSamA', 'sam', 'iSam', 'shareA']])
      await connections.insert({ _id: id, ownerId, integrationId, slateId: slates[share]._id, shareId: share, address: SLACK_ADDRESS, host: 'mcp.slack.com', name: 'Slack', agentId: 'agent-' + id, status: 'active', createdAt: at })
    // An agent of Ada's from before integrations (no integrationId), still on Sam's slate.
    await connections.insert({ _id: 'cAdaOld', ownerId: 'ada', slateId: 'slateC', shareId: 'shareC', address: 'https://old.example/mcp', host: 'old.example', name: 'Old', agentId: 'agent-old', status: 'active', createdAt: at })
    // Cards: Ada's agent's, and one Sam's agent made at Ada's request (Sam's, so it stays).
    await outside.insert({ _id: 'oAda', kind: 'card', connectionId: 'cAdaA', slateId: 'slateA', ownerId: 'ada', state: 'done', createdAt: at })
    await outside.insert({ _id: 'oSamForAda', kind: 'card', connectionId: 'cSamA', slateId: 'slateA', ownerId: 'sam', requestedById: 'ada', state: 'done', createdAt: at })
  }
  const credentialRows = async (userId) => [...credentials.rows.values()].filter((row) => row.ownerId === userId).map(({ ownerId, address }) => ({ ownerId, address }))
  return { service, connections, integrations, outside, credentials, withdrawn, audits, slack, seed, credentialRows }
}

test('Disconnect revokes Slack at auth.revoke; Slack\'s {"ok":false} is told to the person as not confirmed', async () => {
  const ok = world()
  await ok.seed()
  const done = await ok.service.integrationDisconnect({ kind: 'person', userId: 'ada' }, { integrationId: 'iAda' })
  assert.equal(done.signedOut, true)
  assert.equal(done.note, undefined)
  assert.ok(ok.slack.sent.length >= 1 && ok.slack.sent.every((s) => s.url === 'https://slack.com/api/auth.revoke'))
  assert.equal(ok.credentials.rows.has(credentialId('ada', SLACK_ADDRESS)), false)
  assert.equal(ok.credentials.rows.has(credentialId('sam', SLACK_ADDRESS)), true, 'Sam\'s own Slack sign-in stays')

  const refused = world({ slackAnswer: { ok: false, error: 'invalid_auth' } })
  await refused.seed()
  const told = await refused.service.integrationDisconnect({ kind: 'person', userId: 'ada' }, { integrationId: 'iAda' })
  assert.equal(told.signedOut, true)
  assert.match(told.note, /mcp\.slack\.com did not confirm that Slatebox's access ended/)
  assert.equal(refused.credentials.rows.has(credentialId('ada', SLACK_ADDRESS)), false, 'forgotten here anyway')
  assert.equal(refused.integrations.rows.some((row) => row._id === 'iAda'), false)
})

test('account removal: every integration Ada connected is disconnected and revoked, every sign-in and row of hers goes; Sam\'s stay', async () => {
  const w = world()
  await w.seed()
  const out = await w.service.forgetPerson('ada', { credentialRows: w.credentialRows })
  assert.deepEqual({ ...out, failed: out.failed }, { disconnected: 1, signIns: 1, agents: 3, cards: 1, failed: [] })
  // her sign-ins: the Slack one revoked at Slack, the orphan forgotten; Sam's untouched
  assert.deepEqual([...w.credentials.rows.values()].map((row) => row.ownerId), ['sam'])
  assert.ok(w.slack.sent.length >= 1)
  assert.deepEqual(w.integrations.rows.map((row) => row._id), ['iSam'])
  assert.deepEqual(w.connections.rows.map((row) => row._id), ['cSamA'])
  assert.equal(w.connections.rows[0].status, 'active', 'Sam\'s agent stays on Ada\'s slate')
  assert.deepEqual(w.outside.rows.map((row) => row._id), ['oSamForAda'])
  // her agents' waiting suggestions were withdrawn on both slates, her old agent's too
  assert.deepEqual(w.withdrawn.map(([, slate]) => slate).sort(), ['slateA', 'slateC', 'slateC'])
  assert.ok(w.withdrawn.every(([person]) => person === 'ada'))
  const audit = w.audits.find((entry) => entry.kind === 'account_integrations_removed')
  assert.deepEqual(audit, { kind: 'account_integrations_removed', userId: 'ada', disconnected: 1, signIns: 1, agents: 3, cards: 1 })
  assert.doesNotMatch(JSON.stringify(w.audits), /xox|orphan-key|secret/)
  // Twice is harmless; no one or a stranger is a no-op.
  assert.deepEqual((await w.service.forgetPerson('ada', { credentialRows: w.credentialRows })).disconnected, 0)
  assert.deepEqual(await w.service.forgetPerson('', { credentialRows: w.credentialRows }), { disconnected: 0, signIns: 0, agents: 0, cards: 0, failed: [] })
  assert.equal(w.integrations.rows.length, 1)
})

test('account removal never stops for a vendor: Slack unreachable, every row of Ada\'s still goes', async () => {
  const down = world({ slackDown: true })
  await down.seed()
  const out = await down.service.forgetPerson('ada', { credentialRows: down.credentialRows })
  assert.equal(out.disconnected, 1)
  assert.deepEqual(out.failed, [])
  assert.ok(down.slack.sent.length >= 1, 'it tried')
  assert.deepEqual([...down.credentials.rows.values()].map((row) => row.ownerId), ['sam'])
  assert.deepEqual(down.integrations.rows.map((row) => row._id), ['iSam'])
  assert.deepEqual(down.connections.rows.map((row) => row._id), ['cSamA'])
})

// ---------- the app's side: the hook, then every row the person owns ----------

function fakeDb({ fail = null } = {}) {
  const calls = []
  return {
    calls,
    collection: (name) => ({
      deleteMany: async (filter) => {
        if (fail === name) throw new Error('database down')
        calls.push([name, filter])
        return { deletedCount: 1 }
      },
    }),
  }
}

test('removeIntegrationsOf: the enterprise hook first, then every integration collection by its owner field; a failing or slow hook never stops it', async () => {
  assert.deepEqual(INTEGRATION_ROWS.map(([name]) => name), ['integrations', 'mcpCredentials', 'mcpConnections', 'mcpOutsideActions', 'mcpSignins', 'googleDocLinks', 'googleSlateFiles'])
  assert.ok(FORGET_LIMITS.ms >= 5000 && FORGET_LIMITS.ms <= 60000)
  const order = []
  const db = fakeDb()
  setAccountIntegrations({ forgetPerson: async (userId) => order.push(['hook', userId, db.calls.length]) })
  assert.deepEqual(await removeIntegrationsOf('ada', { collection: db.collection, log: () => {} }), { removed: 7 })
  assert.deepEqual(order, [['hook', 'ada', 0]], 'the hook runs before any row is removed')
  assert.deepEqual(db.calls, INTEGRATION_ROWS.map(([name, field]) => [name, { [field]: 'ada' }]))
  // a hook that throws: logged (no token in it), rows removed anyway
  const logs = []
  setAccountIntegrations({ forgetPerson: async () => { throw new Error('vendor down') } })
  const second = fakeDb()
  await removeIntegrationsOf('ada', { collection: second.collection, log: (...args) => logs.push(args.join(' ')) })
  assert.equal(second.calls.length, INTEGRATION_ROWS.length)
  assert.match(logs[0], /revoking sign-ins failed; removing them anyway: vendor down/)
  // a hook that hangs: bounded, rows removed anyway
  setAccountIntegrations({ forgetPerson: () => new Promise(() => {}) })
  const third = fakeDb()
  const slowLogs = []
  await removeIntegrationsOf('ada', { collection: third.collection, log: (text) => slowLogs.push(text), ms: 10 })
  assert.equal(third.calls.length, INTEGRATION_ROWS.length)
  assert.match(slowLogs[0], /took too long/)
  // no enterprise code here: the rows still go
  setAccountIntegrations({})
  const fourth = fakeDb()
  await removeIntegrationsOf('ada', { collection: fourth.collection })
  assert.equal(fourth.calls.length, INTEGRATION_ROWS.length)
  // a database error reaches the caller: the account is not removed with its sign-ins kept
  await assert.rejects(removeIntegrationsOf('ada', { collection: fakeDb({ fail: 'mcpCredentials' }).collection }), /database down/)
  // nobody: nothing removed
  const none = fakeDb()
  assert.deepEqual(await removeIntegrationsOf('', { collection: none.collection }), { removed: 0 })
  assert.equal(none.calls.length, 0)
})

test('every path that removes a saved account removes its integrations first, before its slates and the account; MIT core imports no enterprise code', () => {
  const paths = {
    'web/app/server/methods/users.js': 'user._id',
    'web/app/server/methods/organizations.js': 'user._id',
    'web/app/server/methods/team-member-slates.js': 'memberId',
  }
  for (const [file, id] of Object.entries(paths)) {
    const text = read(file)
    assert.match(text, /import \{ removeIntegrationsOfAccount \} from '\.\.\/integrations\/meteor'/, file)
    const removal = text.indexOf(`await removeIntegrationsOfAccount(${id})`)
    assert.ok(removal > 0, `${file} removes the integrations`)
    assert.ok(removal < text.indexOf('Meteor.users.removeAsync('), `${file}: before the account`)
    assert.ok(removal < text.indexOf('Slates.removeAsync('), `${file}: before the slates (suggestions are withdrawn from them)`)
  }
  for (const file of ['web/app/server/integrations/account-removal.mjs', 'web/app/server/integrations/meteor.js'])
    assert.doesNotMatch(read(file), /from ['"][^'"]*enterprise|require\(['"][^'"]*enterprise/, file)
  const glue = read('enterprise/server/meteor.js')
  assert.match(glue, /setAccountIntegrations\(\{\s*forgetPerson: \(userId\) => service\.forgetPerson\(userId, \{/)
  assert.match(glue, /credentialRows: \(id\) => McpCredentials\.find\(\{ ownerId: id \}/)
  // GitHub's revocation is a DELETE: the sign-in fetch allows it.
  assert.match(glue, /const signInFetch = createMcpFetch\(\{[^\n]*methods: \['GET', 'POST', 'DELETE'\]/)
})
