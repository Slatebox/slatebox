// Runs the real req() (web/app/server/methods/ai/req.js) under plain node, Meteor stubbed, with a
// chosen connection of a provider an administrator added (ai-control/providers.mjs, set through
// connections.mjs setProviderSource), against local stub providers. It prints what each provider
// received (path, query, key headers) and the AIAudit rows. scripts/ai-providers.test.mjs runs it
// in its own process (module hooks are registered once per process) and checks:
//   - a provider's key style and extra headers go on the wire (header, query), the bearer form not;
//   - a rotated key that the provider refuses is retried once with the previous key (spec 6.3);
//   - a provider that redirects is never followed, so the key never reaches the other host (6.2).
import { register } from 'node:module'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const TARGETS = ['server/methods/ai/req.js']
const NEW_KEY = 'k-new-0000-rotated'
const OLD_KEY = 'k-old-1111-previous'

function stubServer(handler) {
  const seen = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const url = new URL(request.url, 'http://stub')
      const entry = {
        path: url.pathname, query: Object.fromEntries(url.searchParams), model: JSON.parse(body || '{}').model ?? null,
        authorization: request.headers.authorization ?? null, googKey: request.headers['x-goog-api-key'] ?? null, client: request.headers['x-goog-api-client'] ?? null,
      }
      seen.push(entry)
      handler(entry, response)
    })
  })
  return { server, seen }
}

const ok = (response) => {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 1, model: 'gemini-3.5-flash', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"text":"ok"}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }))
}

export async function run(appRoot) {
  const root = appRoot.replace(/\/+$/, '') + '/'
  register(new URL('./ai-request-golden-hooks.mjs', import.meta.url), { data: { appRoot: root, targets: TARGETS } })

  // the provider: answers a request carrying the new key in its header or query; the rotation
  // scenario refuses the new key until the old one is tried
  let refuseNew = false
  const main = stubServer((entry, response) => {
    const key = entry.googKey || entry.query.key || entry.authorization
    if (refuseNew && key === NEW_KEY) {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'key not active yet' } }))
      return
    }
    if (entry.path.endsWith('/redirect/chat/completions')) {
      response.writeHead(302, { location: `http://127.0.0.1:${other.server.address().port}/v1/chat/completions` })
      response.end()
      return
    }
    ok(response)
  })
  const other = stubServer((_entry, response) => ok(response))
  await new Promise((resolve) => main.server.listen(0, '127.0.0.1', resolve))
  await new Promise((resolve) => other.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${main.server.address().port}`

  const { setProviderSource, connectionType } = await import(pathToFileURL(root + 'server/methods/ai/connections.mjs').href)
  const { endpointRules } = await import(pathToFileURL(root + 'server/methods/ai/endpoint-policy.mjs').href)
  setProviderSource(() => ({
    gemini: { _id: 'gemini', label: 'Google Gemini', protocol: 'openai-chat', baseUrl: `${base}/v1beta/openai`, baseUrlLocked: true, auth: { style: 'header', name: 'x-goog-api-key' }, extraHeaders: { 'x-goog-api-client': 'slatebox' }, defaultCapabilities: { tools: true } },
    querykey: { _id: 'querykey', label: 'Query key host', protocol: 'openai-chat', baseUrl: null, auth: { style: 'query', name: 'key' } },
  }))

  const audits = []
  let chosen = null
  const Meteor = {
    isDevelopment: true,
    settings: { ai: { providerInfraRetries: 0 } },
    users: { findOneAsync: async (id) => ({ _id: id, orgId: 'team1' }) },
    userId: () => 'root',
  }
  const stubs = {
    'meteor/meteor': { Meteor },
    'meteor/random': { Random: { id: () => `r${audits.length}${Math.random().toString(36).slice(2, 8)}` } },
    'imports/api/common/models': { AIAudit: { insertAsync: async (row) => { audits.push(row) } } },
    'server/metering/context': { aiRequestGate: () => null, chargeProviderCall: async () => ({ stop: false }), currentAIAction: () => null },
    'server/methods/ai/ai-settings': { resolveRequestConnection: async () => chosen },
    'imports/api/common/utils': { default: { isJSON: (text) => { try { JSON.parse(text); return true } catch { return false } } } },
  }
  globalThis.__aiGoldenStub = (key) => stubs[key] || {}
  const { default: req } = await import(pathToFileURL(root + TARGETS[0]).href)

  // self-hosted settings-file rules: a loopback stub is allowed (the guarded fetch still follows no redirect)
  const rules = endpointRules({ hosted: false, level: 'file' })
  const connection = (fields) => ({ ref: 'server:gem', scope: 'server', own: false, feature: 'shape', rules, label: 'gemini-3.5-flash', connection: { name: 'gem', capabilities: { tools: true }, source: 'app', ...fields } })
  const pick = (row) => ({ feature: row.feature, surface: row.surface, connection: row.connection, attempt: row.attempt, model: row.model, status: row.status })
  const out = { typeKnown: Boolean(connectionType('gemini')), typeProtocol: connectionType('gemini')?.protocol ?? null }
  const scenario = async (name, setChosen) => {
    audits.length = 0
    main.seen.length = 0
    other.seen.length = 0
    chosen = setChosen
    const result = await req({ feature: 'shape', prompts: [{ role: 'user', content: 'draw a cat' }] })
    out[name] = { audits: audits.map(pick), seen: [...main.seen], other: [...other.seen], result: { abort: Boolean(result.abort), model: result.model ?? null, chosen: result.chosen ?? null } }
  }

  await scenario('headerKey', connection({ type: 'gemini', baseUrl: `${base}/v1beta/openai`, model: 'gemini-3.5-flash', apiKey: NEW_KEY }))
  await scenario('queryKey', connection({ type: 'querykey', baseUrl: `${base}/v1`, model: 'q-model', apiKey: NEW_KEY }))
  refuseNew = true
  await scenario('rotation', connection({ type: 'gemini', baseUrl: `${base}/v1beta/openai`, model: 'gemini-3.5-flash', apiKey: NEW_KEY, previousApiKey: OLD_KEY }))
  await scenario('rotationNoGrace', connection({ type: 'gemini', baseUrl: `${base}/v1beta/openai`, model: 'gemini-3.5-flash', apiKey: NEW_KEY }))
  refuseNew = false
  await scenario('redirect', connection({ type: 'querykey', baseUrl: `${base}/redirect`, model: 'q-model', apiKey: NEW_KEY }))
  main.server.close()
  other.server.close()
  return { ...out, keys: { NEW_KEY, OLD_KEY } }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const appRoot = process.argv[2] || new URL('../web/app/', import.meta.url).pathname
  process.stdout.write(JSON.stringify(await run(appRoot), null, 2) + '\n')
}
