// Vendors that need an operator's app (2026-11-26): their issuers, servers and documented
// exceptions are fixed in oauth.mjs KNOWN_PROVIDERS, so settings carry a client id and secret only.
// Each exception holds for its own vendor and nobody else: Microsoft's {tenantid} issuer, its
// unadvertised PKCE and its refusal of `resource`; Google's and Box's issuer spelling and Google's
// offline access; Zoom's secret in a Basic header. Every other check stays as strict as before.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/connectors-providers.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  appFor, authorizationUrl, checkCallback, chooseRegistration, chooseScopes, discoverSignIn, exchangeCode, KNOWN_PROVIDERS, LEAST_SCOPES, refreshTokens, resourcesOf,
} from '../enterprise/server/oauth.mjs'
import { checkRecipe } from '../enterprise/server/recipes.mjs'
import { GALLERY } from '../enterprise/common/gallery.mjs'
import { connectorSettings } from '../enterprise/server/connector-settings.mjs'

// A fetch that answers metadata from a table, and records token requests.
function fakeFetch(table) {
  const sent = []
  const fetch = async (url, init = {}) => {
    sent.push({ url, init })
    const body = table[url]
    if (body === undefined) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { fetch, sent }
}

const ENTRA = 'https://login.microsoftonline.com/organizations/v2.0'
const entraMeta = {
  issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
  authorization_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
  token_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
  response_types_supported: ['code', 'id_token', 'code id_token', 'id_token token'],
  token_endpoint_auth_methods_supported: ['client_secret_post', 'private_key_jwt', 'client_secret_basic'],
}
const workiq = {
  'https://workiq.svc.cloud.microsoft/.well-known/oauth-protected-resource/mcp': { resource: 'https://workiq.svc.cloud.microsoft/mcp', authorization_servers: [ENTRA], scopes_supported: ['fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask'] },
  'https://login.microsoftonline.com/organizations/v2.0/.well-known/openid-configuration': entraMeta,
}

test('Microsoft: its {tenantid} issuer and unadvertised PKCE are accepted for Entra only; `resource` is never sent to it', async () => {
  const { fetch } = fakeFetch(workiq)
  const found = await discoverSignIn({ address: 'https://workiq.svc.cloud.microsoft/mcp', challenge: { resource_metadata: 'https://workiq.svc.cloud.microsoft/.well-known/oauth-protected-resource/mcp' }, fetch })
  assert.equal(found.issuer, ENTRA)
  assert.equal(found.server.noResource, true)
  assert.equal(found.server.metadataIssuer, 'https://login.microsoftonline.com/{tenantid}/v2.0')
  // the operator's app, with the least scope for the server it signs in to
  const registration = chooseRegistration({ server: found.server, apps: { microsoft: { clientId: 'entra-app', clientSecret: 's' } }, origin: 'https://app.slatebox.com', resource: found.resource })
  assert.equal(registration.kind, 'preregistered')
  // Work IQ's only permission, as its own metadata names it (it reads and writes: the card's write tools start off)
  assert.deepEqual(registration.app.scopes, ['fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask', 'offline_access'])
  for (const scope of registration.app.scopes.filter((s) => s !== 'offline_access')) assert.ok(workiq['https://workiq.svc.cloud.microsoft/.well-known/oauth-protected-resource/mcp'].scopes_supported.includes(scope), scope)
  const url = new URL(authorizationUrl({ server: found.server, clientId: 'entra-app', redirectUri: 'https://app.slatebox.com/connectors/oauth/callback', challenge: 'c', state: 's', resource: found.resource, scopes: registration.app.scopes }))
  assert.equal(url.searchParams.get('resource'), null)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256', 'PKCE is still sent')
  // the token and refresh requests leave `resource` out too
  const tokens = fakeFetch({})
  await exchangeCode({ server: found.server, client: { clientId: 'entra-app', clientSecret: 's' }, code: 'x', verifier: 'v', redirectUri: 'r', resource: found.resource, fetch: tokens.fetch })
  await refreshTokens({ server: found.server, client: { clientId: 'entra-app', clientSecret: 's' }, refreshToken: 'rt', resource: found.resource, fetch: tokens.fetch })
  for (const { init } of tokens.sent) assert.ok(!new URLSearchParams(init.body).has('resource'), init.body)
  // the directory server and Azure DevOps sign in with the same app, each with its own scope
  assert.deepEqual(appFor(ENTRA, { microsoft: { clientId: 'entra-app' } }, 'https://mcp.svc.cloud.microsoft/enterprise').scopes, ['api://e8c77dc2-69b3-43f4-bc51-3213c9d915b4/.default', 'offline_access'])
  assert.deepEqual(appFor(ENTRA, { microsoft: { clientId: 'entra-app' } }, 'https://mcp.dev.azure.com/contoso').scopes, ['https://mcp.dev.azure.com/.default', 'offline_access'])
  // a server that merely names Entra as its sign-in server never gets the operator's Microsoft sign-in
  assert.deepEqual(appFor(ENTRA, { microsoft: { clientId: 'entra-app' } }, 'https://evil.example.com/mcp'), { refused: 'Microsoft' })
})

test('the exceptions hold for their vendor alone: any other issuer that hides PKCE or spells its issuer differently is refused', async () => {
  const other = 'https://auth.example.com/tenant'
  const { fetch } = fakeFetch({
    'https://mcp.example.com/.well-known/oauth-protected-resource/mcp': { resource: 'https://mcp.example.com/mcp', authorization_servers: [other] },
    'https://auth.example.com/.well-known/oauth-authorization-server/tenant': { ...entraMeta, issuer: other, authorization_endpoint: 'https://auth.example.com/a', token_endpoint: 'https://auth.example.com/t' },
  })
  await assert.rejects(discoverSignIn({ address: 'https://mcp.example.com/mcp', fetch }), (error) => error.code === 'no_pkce')
  const spelled = fakeFetch({
    'https://mcp.example.com/.well-known/oauth-protected-resource/mcp': { resource: 'https://mcp.example.com/mcp', authorization_servers: ['https://auth.example.com/'] },
    'https://auth.example.com/.well-known/oauth-authorization-server': { issuer: 'https://auth.example.com', authorization_endpoint: 'https://auth.example.com/a', token_endpoint: 'https://auth.example.com/t', code_challenge_methods_supported: ['S256'] },
  })
  await assert.rejects(discoverSignIn({ address: 'https://mcp.example.com/mcp', fetch: spelled.fetch }), (error) => error.code === 'sign_in_unsafe')
  // Entra's own metadata with an issuer other than its template is still refused
  const wrong = fakeFetch({ ...workiq, 'https://login.microsoftonline.com/organizations/v2.0/.well-known/openid-configuration': { ...entraMeta, issuer: 'https://login.microsoftonline.com/someone-else/v2.0' } })
  await assert.rejects(discoverSignIn({ address: 'https://workiq.svc.cloud.microsoft/mcp', fetch: wrong.fetch }), (error) => error.code === 'sign_in_unsafe')
})

test('Google: its issuer with a trailing slash is its own, the sign-in asks for offline access, read-only scopes by server; the callback\'s iss may be either spelling', async () => {
  const { fetch } = fakeFetch({
    'https://gmailmcp.googleapis.com/.well-known/oauth-protected-resource/mcp/v1': { resource: 'https://gmailmcp.googleapis.com/mcp/v1', authorization_servers: ['https://accounts.google.com/'], scopes_supported: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify'] },
    'https://accounts.google.com/.well-known/oauth-authorization-server': { issuer: 'https://accounts.google.com', authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth', token_endpoint: 'https://oauth2.googleapis.com/token', code_challenge_methods_supported: ['plain', 'S256'], response_types_supported: ['code'] },
  })
  const found = await discoverSignIn({ address: 'https://gmailmcp.googleapis.com/mcp/v1', fetch })
  assert.equal(found.issuer, 'https://accounts.google.com/')
  const app = appFor(found.issuer, { google: { clientId: 'g', clientSecret: 's' } }, found.resource)
  assert.deepEqual(app.scopes, ['https://www.googleapis.com/auth/gmail.readonly'])
  const url = new URL(authorizationUrl({ server: found.server, clientId: 'g', redirectUri: 'r', challenge: 'c', state: 's', resource: found.resource, scopes: app.scopes }))
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.equal(url.searchParams.get('prompt'), 'consent')
  assert.equal(url.searchParams.get('resource'), 'https://gmailmcp.googleapis.com/mcp/v1')
  const flow = { issuer: found.issuer, metadataIssuer: found.server.metadataIssuer, issParameter: false }
  assert.deepEqual(checkCallback({ code: 'x', iss: 'https://accounts.google.com' }, flow), { code: 'x' })
  assert.deepEqual(checkCallback({ code: 'x', iss: 'https://accounts.google.com/' }, flow), { code: 'x' })
  assert.throws(() => checkCallback({ code: 'x', iss: 'https://evil.example.com' }, flow), (error) => error.code === 'unverified')
  // the operator's scopes widen it on purpose (drafts)
  assert.deepEqual(appFor(found.issuer, { google: { clientId: 'g', scopes: ['https://www.googleapis.com/auth/gmail.compose'] } }, found.resource).scopes, ['https://www.googleapis.com/auth/gmail.compose'])
})

test('Zoom: its client secret goes in a Basic header, never the body; everyone else\'s stays in the body', async () => {
  const zoom = { issuer: 'https://zoom.us', tokenEndpoint: 'https://zoom.us/oauth/token', tokenAuth: KNOWN_PROVIDERS.zoom.tokenAuth }
  const sent = fakeFetch({})
  await exchangeCode({ server: zoom, client: { clientId: 'id:1', clientSecret: 'se cret' }, code: 'x', verifier: 'v', redirectUri: 'r', resource: 'https://mcp.zoom.us/mcp/zoom/streamable', fetch: sent.fetch })
  const { init } = sent.sent[0]
  assert.equal(init.headers.authorization, 'Basic ' + Buffer.from('id%3A1:se%20cret').toString('base64'))
  assert.ok(!new URLSearchParams(init.body).has('client_secret'))
  const slack = fakeFetch({})
  await exchangeCode({ server: { issuer: 'https://mcp.slack.com', tokenEndpoint: 'https://slack.com/api/oauth.v2.user.access' }, client: { clientId: 'a', clientSecret: 'b' }, code: 'x', verifier: 'v', redirectUri: 'r', resource: 'https://mcp.slack.com', fetch: slack.fetch })
  assert.equal(new URLSearchParams(slack.sent[0].init.body).get('client_secret'), 'b')
  assert.equal(slack.sent[0].init.headers.authorization, undefined)
})

test('Microsoft 365: every Work IQ tool that changes or sends starts off; its known ask is one of Work IQ\'s own tools', () => {
  const recipe = checkRecipe(GALLERY.find((c) => c.id === 'microsoft365').recipe)
  for (const tool of ['create_entity', 'update_entity', 'delete_entity', 'do_action', 'call_function']) assert.equal(recipe.tools[tool], 'destructive', tool)
  assert.ok(!Object.values(recipe.tools).includes('change'), 'no override weakens a tool to a plain change')
  const workIqTools = ['fetch', 'create_entity', 'update_entity', 'delete_entity', 'do_action', 'call_function', 'ask', 'list_agents', 'get_schema', 'search_paths']
  for (const intent of recipe.intents) for (const step of intent.steps) for (const tool of [].concat(step.tool)) assert.ok(workIqTools.includes(tool), tool)
})

test('Zoom asks for its read scopes only, never the write and delete scopes its metadata lists', () => {
  const listed = ['hub:read:content', 'my_notes:read:content', 'agentic_search:read:ask', 'docs:write:collaborator', 'cloud_recording:read:content', 'meeting:update:in_meeting_controls',
    'docs:delete:collaborator', 'agentic_search:read:search', 'meeting:read:search', 'meeting:write:meeting', 'docs:read:list_file_collaborators', 'docs:read:export', 'meeting:read:assets',
    'docs:update:collaborator', 'cloud_recording:read:list_user_recordings', 'docs:write:import', 'meeting:delete:meeting', 'meeting:update:meeting', 'hub:write:content',
    'workflow:read:definition', 'workflow:write:definition', 'workflow:read:list_definitions'] // its protected resource metadata, 2026-11-26
  const app = appFor('https://zoom.us', { zoom: { clientId: 'z', clientSecret: 's' } }, 'https://mcp.zoom.us/mcp/zoom/streamable')
  const scopes = chooseScopes({ app, scopes: { challenge: [], resource: listed }, server: {}, resource: 'https://mcp.zoom.us/mcp/zoom/streamable' })
  assert.ok(scopes.length > 0)
  for (const scope of scopes) {
    assert.ok(listed.includes(scope), `${scope} is one Zoom lists`)
    assert.doesNotMatch(scope, /:(write|delete|update):/, scope)
  }
})

test('a server with automatic registration whose metadata lists every scope asks for the least its card needs (PagerDuty: read)', () => {
  const listed = ['incidents.read', 'write', 'incidents.write', 'read', 'openid', 'users.write', 'schedules.read'] // a few of PagerDuty's about 90
  const resource = 'https://mcp.pagerduty.com/mcp'
  assert.deepEqual(chooseScopes({ app: null, scopes: { challenge: [], resource: listed }, server: {}, resource }), ['read'])
  // the challenge still wins, and a server that does not list the least scope gets its own list as before
  assert.deepEqual(chooseScopes({ app: null, scopes: { challenge: ['incidents.read'], resource: listed }, server: {}, resource }), ['incidents.read'])
  assert.deepEqual(chooseScopes({ app: null, scopes: { challenge: [], resource: ['a', 'b'] }, server: {}, resource }), ['a', 'b'])
  // and no other server is touched
  assert.deepEqual(chooseScopes({ app: null, scopes: { challenge: [], resource: listed }, server: {}, resource: 'https://mcp.example.com/mcp' }), listed)
  for (const origin of Object.keys(LEAST_SCOPES)) assert.ok(GALLERY.some((c) => new URL(c.url).origin === origin && !c.needsApp), origin)
})

test('every known provider sends its sign-in only to its own servers; settings carry a client only for a known provider', () => {
  for (const [name, provider] of Object.entries(KNOWN_PROVIDERS)) {
    assert.ok(provider.resources.length, name)
    for (const origin of provider.resources) assert.match(origin, /^https:\/\/[a-z0-9.-]+$/, `${name}: ${origin}`)
    assert.deepEqual(resourcesOf(name, {}), [...provider.resources], name)
    for (const origin of Object.keys(provider.scopesFor || {})) assert.ok(provider.resources.includes(origin), `${name}: scopes for a server it serves`)
  }
  const parsed = connectorSettings({ public: { env: 'prod' }, connectors: { oauthApps: { microsoft: { clientId: 'm', clientSecret: 's' }, google: { clientId: 'g' }, zoom: { clientId: 'z' }, box: { clientId: 'b' }, pitch: { clientId: 'p' }, salesforce: { clientId: 'sf' } } } })
  assert.deepEqual(Object.keys(parsed.oauthApps).sort(), ['box', 'google', 'microsoft', 'pitch', 'salesforce', 'zoom'])
  // the ones that were set up by issuer and resources before keep working: a known provider's own issuer wins
  const before = connectorSettings({ public: { env: 'prod' }, connectors: { oauthApps: { slack: { clientId: 'x', issuer: 'https://mcp.slack.com', resources: ['https://mcp.slack.com'] } } } })
  assert.equal(appFor('https://mcp.slack.com', before.oauthApps, 'https://mcp.slack.com').clientId, 'x')
})
