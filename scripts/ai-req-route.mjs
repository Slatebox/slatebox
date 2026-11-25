// Runs the real req() (web/app/server/methods/ai/req.js) under plain node, Meteor stubbed, with
// routes as AI control gives them (a provider's model with the key opened from the backend), against
// local stub providers. It prints what each provider received and the AIAudit rows.
// scripts/ai-providers.test.mjs runs it in its own process (module hooks register once per process)
// and checks:
//   - the stored key goes on the wire as the provider wants it (Bearer), with the provider's tool choice;
//   - every audit row names the part, the route (server:<provider>) and the model id;
//   - the one built-in fallback: a server model that fails as a service is retried once on the
//     default model; a person's own connection never is;
//   - a provider that redirects is never followed, so the key never reaches the other host.
import { register } from 'node:module'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const TARGETS = ['server/methods/ai/req.js']
const KEY = 'sk-test-route-0000-stored'
const DEFAULT_KEY = 'sk-test-route-1111-default'

function stubServer(handler) {
  const seen = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const json = JSON.parse(body || '{}')
      const entry = { path: new URL(request.url, 'http://stub').pathname, model: json.model ?? null, authorization: request.headers.authorization ?? null, toolChoice: json.tool_choice ?? null }
      seen.push(entry)
      handler(entry, response)
    })
  })
  return { server, seen }
}

const ok = (response, model, toolChoice = null) => {
  response.writeHead(200, { 'content-type': 'application/json' })
  const message = toolChoice?.function?.name
    ? { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: toolChoice.function.name, arguments: '{"text":"ok"}' } }] }
    : { role: 'assistant', content: '{"text":"ok"}' }
  response.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 1, model, choices: [{ index: 0, finish_reason: toolChoice ? 'tool_calls' : 'stop', message }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }))
}

export async function run(appRoot) {
  const root = appRoot.replace(/\/+$/, '') + '/'
  register(new URL('./ai-request-golden-hooks.mjs', import.meta.url), { data: { appRoot: root, targets: TARGETS } })
  const main = stubServer((entry, response) => {
    if (entry.path.startsWith('/busy/')) {
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'busy' } }))
      return
    }
    if (entry.path.startsWith('/redirect/')) {
      response.writeHead(302, { location: `http://127.0.0.1:${other.server.address().port}/v1/chat/completions` })
      response.end()
      return
    }
    ok(response, entry.model, entry.toolChoice)
  })
  const other = stubServer((entry, response) => ok(response, entry.model))
  await new Promise((resolve) => main.server.listen(0, '127.0.0.1', resolve))
  await new Promise((resolve) => other.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${main.server.address().port}`

  const { setProviderSource } = await import(pathToFileURL(root + 'server/methods/ai/connections.mjs').href)
  const { endpointRules } = await import(pathToFileURL(root + 'server/methods/ai/endpoint-policy.mjs').href)
  // stored providers: "Other (OpenAI-compatible)" rows at the stub, one that takes a named tool
  setProviderSource(() => ({
    stub: { _id: 'stub', preset: 'other', label: 'Stub', baseUrl: `${base}/v1`, protocol: 'openai-chat', auth: { style: 'bearer' }, toolChoice: 'named', extraHeaders: {}, status: 'active' },
    busy: { _id: 'busy', preset: 'other', label: 'Busy', baseUrl: `${base}/busy`, protocol: 'openai-chat', auth: { style: 'bearer' }, toolChoice: 'auto', extraHeaders: {}, status: 'active' },
    hop: { _id: 'hop', preset: 'other', label: 'Hop', baseUrl: `${base}/redirect`, protocol: 'openai-chat', auth: { style: 'bearer' }, toolChoice: 'auto', extraHeaders: {}, status: 'active' },
  }))

  const audits = []
  let chosen = null
  let fallback = null
  const asked = []
  const Meteor = { isDevelopment: true, settings: { ai: { providerInfraRetries: 0 } }, users: { findOneAsync: async (id) => ({ _id: id }) }, userId: () => 'ana' }
  const stubs = {
    'meteor/meteor': { Meteor },
    'meteor/random': { Random: { id: () => `r${audits.length}${Math.random().toString(36).slice(2, 8)}` } },
    'imports/api/common/models': { AIAudit: { insertAsync: async (row) => { audits.push(row) } } },
    'server/metering/context': { aiRequestGate: () => null, chargeProviderCall: async () => ({ stop: false }), currentAIAction: () => null },
    'server/methods/ai/ai-settings': { resolveRequestConnection: async ({ useDefault }) => { asked.push(useDefault ? 'default' : 'part'); return useDefault ? fallback : chosen } },
    'imports/api/common/utils': { default: { isJSON: (item) => { try { const parsed = JSON.parse(typeof item === 'string' ? item : JSON.stringify(item)); return Boolean(parsed) && typeof parsed === 'object' } catch { return false } } } },
  }
  globalThis.__aiGoldenStub = (key) => stubs[key] || {}
  const { default: req } = await import(pathToFileURL(root + TARGETS[0]).href)

  const rules = endpointRules({ hosted: false, level: 'server' })
  const route = (provider, model, apiKey, extra = {}) => ({
    ref: `server:${provider}`, scope: 'server', own: false, feature: 'shape', surface: 'shape', provider, modelId: `${provider}:${model}`, rules, label: `${model} from ${provider}`,
    connection: { name: provider, type: provider, baseUrl: { stub: `${base}/v1`, busy: `${base}/busy`, hop: `${base}/redirect` }[provider], model, apiKey, capabilities: { tools: true } }, ...extra,
  })
  const pick = (row) => ({ surface: row.surface, connection: row.connection, attempt: row.attempt, modelId: row.modelId ?? null, model: row.model, status: row.status })
  const out = {}
  const scenario = async (name, part, byDefault, request = {}) => {
    audits.length = 0
    main.seen.length = 0
    other.seen.length = 0
    asked.length = 0
    chosen = part
    fallback = byDefault
    const result = await req({ feature: 'shape', prompts: [{ role: 'user', content: 'draw a cat' }], ...request })
    out[name] = { audits: audits.map(pick), seen: [...main.seen], other: [...other.seen], asked: [...asked], result: { abort: Boolean(result.abort), model: result.model ?? null, chosen: result.chosen ?? null, fallbackFrom: result.fallbackFrom ?? null, abortMessage: result.abortMessage ?? null } }
  }
  const tool = { name: 'propose_shapes', description: 'Shapes.', parameters: { type: 'object', properties: { text: { type: 'string' } } } }
  await scenario('stored', route('stub', 'gemini-3.5-flash', KEY), null, { functions: [tool], function_call: { name: 'propose_shapes' }, allowPlainText: true })
  await scenario('fallback', route('busy', 'busy-model', KEY), route('stub', 'muse-ember-1.0', DEFAULT_KEY))
  await scenario('ownNoFallback', { ...route('busy', 'busy-model', KEY), ref: 'me:desk', scope: 'me', own: true }, route('stub', 'muse-ember-1.0', DEFAULT_KEY))
  await scenario('sameModelNoFallback', route('busy', 'busy-model', KEY), route('busy', 'busy-model', KEY))
  await scenario('noKey', { ref: 'server:stub', scope: 'server', own: false, feature: 'shape', surface: 'shape', connection: null, rules: null, error: 'Meta (Muse) has no active key. An administrator adds one in Admin → AI control.' }, null)
  await scenario('redirect', route('hop', 'q-model', KEY), null)
  main.server.close()
  other.server.close()
  return { ...out, keys: { KEY, DEFAULT_KEY } }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const appRoot = process.argv[2] || new URL('../web/app/', import.meta.url).pathname
  process.stdout.write(JSON.stringify(await run(appRoot), null, 2) + '\n')
}
