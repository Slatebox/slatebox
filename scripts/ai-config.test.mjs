// AI models and providers are configuration, not code (owner, 2026-11-22): an operator connects
// any provider in the settings file with its key in the environment (apiKeyEnv), says per
// connection how it takes a forced tool call (toolChoice), and prices a new model in settings
// (metering.prices). The built-in feature defaults live in a JSON file shipped with the app.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { normalizeConnection, operatorConfig, CONNECTION_TYPES, publicConnection } from '../web/app/server/methods/ai/connections.mjs'
import { createAISettings } from '../web/app/server/methods/ai/ai-settings-core.mjs'
import { connectionRequest } from '../web/app/server/methods/ai/connection-request.mjs'
import { localWorkshopRequest } from '../web/app/server/methods/ai/workshop-provider.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'
import { DEFAULT_AI_FEATURES, resolveAIFeatureConfig } from '../web/app/server/methods/ai/feature-config.mjs'
import { AI_PRICES, aiPrice, aiCostMicros, activePrices, configurePrices, mergePrices } from '../web/app/server/metering/prices.mjs'

const app = new URL('../web/app/', import.meta.url)
const META = { type: 'openai-compatible', baseUrl: 'https://api.meta.ai/v1', model: 'muse-ember-1.0', apiKeyEnv: 'META_API_KEY', toolChoice: 'auto' }
const GEMINI = { type: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash', apiKeyEnv: 'GEMINI_API_KEY', toolChoice: 'required' }
const SECRET = 'meta-secret-value-0123456789'

function memoryStore() {
  const keys = [], uses = new Map()
  const match = (owner) => (doc) => doc.ownerType === owner.type && doc.ownerId === owner.id
  return {
    keys, uses,
    async listConnections(owner) { return keys.filter(match(owner)).map((doc) => ({ ...doc })) },
    async saveConnection(owner, doc) { keys.push({ ...doc, ownerType: owner.type, ownerId: owner.id }) },
    async removeConnection() {},
    async getUse(owner) { return uses.get(`${owner.type}:${owner.id}`) || null },
    async setUse(owner, value) { uses.set(`${owner.type}:${owner.id}`, value) },
  }
}

function service({ settings, env = {}, checkWith } = {}) {
  const checked = []
  const people = { ana: { _id: 'ana', orgId: 'team1' }, root: { _id: 'root' } }
  const ai = createAISettings({
    store: memoryStore(), settings, hosted: false, env,
    master: loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') }),
    loadUser: async (id) => people[id] || null,
    isAdmin: async (id) => id === 'root',
    isTeamAdmin: async (user) => user._id === 'ana',
    check: checkWith || (async (connection, rules) => { checked.push({ connection, rules }); return { ok: true, reachable: true, models: [], modelListed: null, tools: 'yes', message: 'ok' } }),
  })
  return { ai, checked }
}

const selfhost = (ai) => ({ public: { env: 'selfhost' }, ai })

// ---------- 1. keys from the environment ----------

test('a settings-file connection may name the environment variable that holds its key', () => {
  const config = operatorConfig(selfhost({ connections: { 'meta-muse': META, gemini: GEMINI }, use: { presentation: 'meta-muse' } }))
  const meta = config.connections.find((c) => c.name === 'meta-muse')
  assert.equal(meta.apiKeyEnv, 'META_API_KEY')
  assert.equal(meta.apiKey, undefined, 'the key is read at request time, never at start')
  assert.equal(config.use.presentation, 'server:meta-muse')
  // a preset that needs a key takes it from the environment too
  const deepinfra = operatorConfig(selfhost({ connections: { di: { type: 'deepinfra', apiKeyEnv: 'API_KEY_DEEP_INFRA' } } })).connections[0]
  assert.equal(deepinfra.apiKeyEnv, 'API_KEY_DEEP_INFRA')
})

test('apiKeyEnv is the operator\'s alone, a plain variable name, and never beside a key', () => {
  for (const level of ['person', 'team', 'server']) {
    assert.throws(() => normalizeConnection({ name: 'x', ...META }, { hosted: false, level }), { name: 'ConnectionError', message: /settings file/ }, level)
  }
  for (const bad of ['meta_api_key', '1META', 'A', 'META-KEY', 'META KEY', 'X'.repeat(65), 42, '']) {
    assert.throws(() => normalizeConnection({ name: 'x', ...META, apiKeyEnv: bad }, { hosted: false, level: 'file' }), { name: 'ConnectionError' }, String(bad))
  }
  assert.throws(() => normalizeConnection({ name: 'x', ...META, apiKey: 'k' }, { hosted: false, level: 'file' }), { name: 'ConnectionError', message: /apiKey or apiKeyEnv/ })
  assert.throws(() => operatorConfig(selfhost({ connections: { m: { ...META, apiKeyEnv: 'lower' } } })), /settings ai\.connections\.m/)
})

test('the key is read from the environment for each request, and only for the operator\'s connection', async () => {
  const env = { META_API_KEY: SECRET }
  const { ai } = service({ settings: selfhost({ connections: { 'meta-muse': META }, use: { presentation: 'meta-muse' } }), env })
  const resolved = await ai.resolveFor({ userId: 'ana', feature: 'presentation' })
  assert.equal(resolved.ref, 'server:meta-muse')
  assert.equal(resolved.connection.apiKey, SECRET)
  assert.equal(resolved.error, undefined)
  const request = connectionRequest(resolved.connection)
  assert.equal(request.apiKey, SECRET)
  assert.equal(request.toolChoice, 'auto')
  // a rotated key is used by the next request without a restart
  env.META_API_KEY = 'rotated-key-0123456789'
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'presentation' })).connection.apiKey, 'rotated-key-0123456789')
  // a feature the operator did not route there never sees the key
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'generation' })).connection, null)
})

test('a missing or empty variable is a clear configuration error that names the variable, never a value', async () => {
  for (const env of [{}, { META_API_KEY: '' }, { META_API_KEY: '   ' }]) {
    const { ai } = service({ settings: selfhost({ connections: { 'meta-muse': META }, use: { presentation: 'meta-muse' } }), env: { ...env, OTHER: SECRET } })
    const resolved = await ai.resolveFor({ userId: 'ana', feature: 'presentation' })
    assert.match(resolved.error, /META_API_KEY/)
    assert.match(resolved.error, /not set/)
    assert.equal(resolved.connection.apiKey, undefined)
    assert.doesNotMatch(JSON.stringify(resolved), new RegExp(SECRET))
  }
  // req.js turns a resolved error into a configuration_error abort and never sends the request
  const req = readFileSync(new URL('server/methods/ai/req.js', app), 'utf8')
  assert.match(req, /if \(chosen\?\.gap \|\| chosen\?\.error[\s\S]{0,800}'configuration_error'[\s\S]{0,200}abort: true/)
})

test('the key and its variable never reach a person, an administrator, a publication or telemetry', async () => {
  const env = { META_API_KEY: SECRET }
  const { ai } = service({ settings: selfhost({ connections: { 'meta-muse': META }, use: { default: 'meta-muse' } }), env })
  for (const who of ['ana', 'root']) {
    const view = JSON.stringify(await ai.view(who))
    assert.doesNotMatch(view, new RegExp(SECRET), who)
    assert.doesNotMatch(view, /META_API_KEY|apiKeyEnv/, who)
  }
  const shown = publicConnection({ ...operatorConfig(selfhost({ connections: { m: META } })).connections[0], apiKey: SECRET })
  assert.doesNotMatch(JSON.stringify(shown), new RegExp(`${SECRET}|apiKeyEnv|META_API_KEY`))
  // an administrator cannot save one from the app, and the action schema does not take it
  await assert.rejects(ai.update('root', { level: 'server', connections: [{ name: 'sneak', ...META }] }), { code: 'invalid_request' })
  const { connectionInput } = await import('../web/app/server/actions/ai-schemas.mjs')
  assert.equal(connectionInput.properties.apiKeyEnv, undefined)
  assert.equal(connectionInput.additionalProperties, false)
  // telemetry records the type and model of a chosen connection, never its key or variable
  const req = readFileSync(new URL('server/methods/ai/req.js', app), 'utf8')
  assert.doesNotMatch(req, /apiKeyEnv/)
})

test('Test connection on the operator\'s connection uses the key from the environment, at its own address only', async () => {
  const env = { META_API_KEY: SECRET }
  const { ai, checked } = service({ settings: selfhost({ connections: { 'meta-muse': META } }), env })
  await ai.check('root', { level: 'server', name: 'meta-muse' })
  assert.equal(checked.at(-1).connection.apiKey, SECRET)
  await ai.check('root', { level: 'server', connection: { name: 'meta-muse', type: 'openai-compatible', baseUrl: 'https://attacker.example/v1', model: 'm' } })
  assert.equal(checked.at(-1).connection.apiKey, undefined)
  // with the variable unset the check is refused with the variable named
  const unset = service({ settings: selfhost({ connections: { 'meta-muse': META } }), env: {} })
  await assert.rejects(unset.ai.check('root', { level: 'server', name: 'meta-muse' }), (error) => error.code === 'invalid_request' && /META_API_KEY/.test(error.message))
})

// ---------- 2. how a connection takes a forced tool call ----------

const tool = { name: 'plan_presentation', description: 'Plan it', parameters: { type: 'object', properties: {} } }
const forced = { system: 'Plan.', prompts: [{ role: 'user', content: 'go' }], functions: [tool], functionCall: { name: tool.name } }
const free = { ...forced, functionCall: undefined }

test('toolChoice is auto, named or required; the default stays as it was', () => {
  for (const toolChoice of ['auto', 'named', 'required']) {
    assert.equal(normalizeConnection({ name: 'x', ...META, apiKeyEnv: undefined, toolChoice }, { hosted: false, level: 'server' }).toolChoice, toolChoice)
  }
  assert.throws(() => normalizeConnection({ name: 'x', ...META, apiKeyEnv: undefined, toolChoice: 'any' }, { hosted: false, level: 'server' }), /auto, named or required/)
  const base = { name: 'x', type: 'openai-compatible', baseUrl: 'https://h.example/v1', model: 'm', capabilities: {} }
  assert.equal(connectionRequest(base).toolChoice, 'auto')
  assert.equal(connectionRequest({ ...base, toolChoice: 'required' }).toolChoice, 'required')
  assert.equal(connectionRequest({ ...base, toolChoice: 'named' }).toolChoice, 'named')
  assert.equal(connectionRequest({ ...base, type: 'openai', baseUrl: CONNECTION_TYPES.openai.baseUrl }).toolChoice, 'named')
  // no provider is named in code: the translation is keyed on the setting alone
  assert.deepEqual(Object.keys(CONNECTION_TYPES).sort(), ['anthropic', 'deepinfra', 'openai', 'openai-compatible'])
  for (const path of ['server/methods/ai/connection-request.mjs', 'server/methods/ai/workshop-provider.mjs', 'server/methods/ai/sdk-chat.cjs', 'server/methods/ai/connections.mjs']) {
    assert.doesNotMatch(readFileSync(new URL(path, app), 'utf8'), /gemini|meta\.ai|muse-/i, path)
  }
})

test('the request body carries the tool choice in the form the connection takes', () => {
  const body = (toolChoice, request) => JSON.parse(localWorkshopRequest({ endpoint: 'https://h.example/v1/chat/completions', model: 'm', toolChoice }, request).body)
  assert.deepEqual(body('named', forced).tool_choice, { type: 'function', function: { name: tool.name } })
  assert.equal(body('required', forced).tool_choice, 'required')
  assert.equal(body('auto', forced).tool_choice, 'auto')
  // required forces a call only where the feature forces one; otherwise the model decides
  assert.equal(body('required', free).tool_choice, 'auto')
})

async function stubServer(t, handler) {
  const seen = []
  const server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : null
    seen.push({ url: req.url, headers: req.headers, body })
    const answer = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)) }
    handler(body, answer)
  })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  t.after(() => server.close())
  return { base: `http://127.0.0.1:${server.address().port}/v1`, seen }
}
const toolAnswer = (name, args) => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } })

test('through the AI SDK, each setting reaches the wire; an auto-only endpoint (HTTP 400 otherwise) is served with auto', async (t) => {
  const { sdkChatRequest } = await import('../web/app/server/methods/ai/sdk-chat.cjs')
  // an endpoint that, like Meta's Model API, refuses any tool_choice but auto
  const autoOnly = await stubServer(t, (body, answer) => (body.tool_choice === undefined || body.tool_choice === 'auto'
    ? answer(200, toolAnswer(tool.name, { slides: [] }))
    : answer(400, { error: { message: 'only "auto" is supported for tool_choice' } })))
  const send = async (stub, toolChoice, request = forced) => {
    const config = { ...connectionRequest({ name: 'x', type: 'openai-compatible', baseUrl: stub.base, model: 'm', apiKey: SECRET, capabilities: {}, toolChoice }) }
    const ai = localWorkshopRequest(config, request)
    return sdkChatRequest({ provider: 'connection', endpoint: config.endpoint, apiKey: config.apiKey, body: JSON.parse(ai.body), functions: request.functions, local: true })
  }
  const answer = await send(autoOnly, 'auto')
  assert.equal(answer.choices[0].message.tool_calls[0].function.name, tool.name)
  assert.equal(autoOnly.seen.at(-1).body.tool_choice, 'auto')
  await assert.rejects(send(autoOnly, 'named'), (error) => error.statusCode === 400)
  // required and named as sent
  const open = await stubServer(t, (body, answer) => answer(200, toolAnswer(tool.name, {})))
  await send(open, 'required')
  assert.equal(open.seen.at(-1).body.tool_choice, 'required')
  await send(open, 'named')
  assert.deepEqual(open.seen.at(-1).body.tool_choice, { type: 'function', function: { name: tool.name } })
  await send(open, 'required', free)
  assert.equal(open.seen.at(-1).body.tool_choice, 'auto')
})

// ---------- 3. built-in defaults as data ----------

test('the built-in feature defaults are a JSON file shipped with the app', () => {
  const file = JSON.parse(readFileSync(new URL('server/config/ai-defaults.json', app), 'utf8'))
  const strip = (value) => (value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, strip(v)])) : value)
  assert.deepEqual(JSON.parse(JSON.stringify(DEFAULT_AI_FEATURES)), strip(file))
  assert.ok(Object.isFrozen(DEFAULT_AI_FEATURES) && Object.isFrozen(DEFAULT_AI_FEATURES.presentation.fallback))
  assert.match(file.presentation._comment, /59 s/)
  assert.match(file.presentation._comment, /429/)
  assert.match(file.presentation._comment, /3\.8.{1,4}5\.8 s/)
  assert.match(file.presentation._comment, /2026-11-22/)
  // the code keeps no model names of its own
  assert.doesNotMatch(readFileSync(new URL('server/methods/ai/feature-config.mjs', app), 'utf8'), /Qwen|DeepSeek|gemini|engine: '/)
})

test('presentation plans on DeepInfra gemini-3.5-flash with gemini-3.7-flash behind it; every other feature is unchanged', () => {
  assert.deepEqual(resolveAIFeatureConfig('presentation'), {
    provider: 'deepinfra', engine: 'google/gemini-3.5-flash', fallback: { provider: 'deepinfra', engine: 'google/gemini-3.7-flash' }, feature: 'presentation',
  })
  for (const feature of ['layout', 'vision', 'welcome', 'generation']) {
    assert.deepEqual(resolveAIFeatureConfig(feature), {
      provider: 'deepinfra', engine: 'Qwen/Qwen3-235B-A22B-Instruct-2507', fallback: { provider: 'deepinfra', engine: 'deepseek-ai/DeepSeek-V3.1-Terminus' }, feature,
    }, feature)
  }
  assert.equal(resolveAIFeatureConfig('presentation', { ai: { features: { presentation: { engine: 'x/y' } } } }).engine, 'x/y')
})

test('settings.ai.features still overrides; another provider does not inherit a default fallback of a different provider', () => {
  const same = resolveAIFeatureConfig('layout', { ai: { features: { layout: { provider: 'deepinfra', engine: 'candidate' } } } })
  assert.deepEqual(same.fallback, { provider: 'deepinfra', engine: 'deepseek-ai/DeepSeek-V3.1-Terminus' })
  const other = resolveAIFeatureConfig('presentation', { ai: { features: { presentation: { provider: 'openai', engine: 'gpt-4o-mini' } } } })
  assert.equal(other.fallback, undefined)
  assert.equal(other.provider, 'openai')
  const named = resolveAIFeatureConfig('presentation', { ai: { features: { presentation: { provider: 'openai', engine: 'a', fallback: { provider: 'openai', engine: 'b' } } } } })
  assert.deepEqual(named.fallback, { provider: 'openai', engine: 'b' })
  // a resolved config never carries a comment from the file
  assert.equal('_comment' in resolveAIFeatureConfig('presentation'), false)
})

test('a presentation plan is estimated at the model of the connection ai.use picks, the built-in defaults only without one', async () => {
  const { planEstimateMicros, planModels } = await import('../web/app/server/methods/presentationRequest.mjs')
  const feature = resolveAIFeatureConfig('presentation')
  const chars = 10_000
  // production: presentations go to the operator's Meta connection
  const { ai } = service({ settings: selfhost({ connections: { 'meta-muse': META }, use: { presentation: 'meta-muse' } }), env: { META_API_KEY: SECRET } })
  const chosen = await ai.resolveFor({ userId: 'ana', feature: 'presentation', request: { tools: true } })
  assert.equal(chosen.ref, 'server:meta-muse')
  assert.deepEqual(planModels({ feature, chosen }), ['muse-ember-1.0'])
  const viaMeta = planEstimateMicros(chars, planModels({ feature, chosen }).map(aiPrice))
  assert.equal(viaMeta, planEstimateMicros(chars, [aiPrice('muse-ember-1.0')]))
  assert.equal(viaMeta, 7001, 'a 10k-character plan on muse-ember-1.0 ($0.30 / $1.50): 3,334 tokens in, a full plan out')
  // the built-in AI (no ai.use for presentations) is priced at the defaults and their fallback
  const builtIn = await service({ settings: selfhost({ connections: { 'meta-muse': META }, use: { generation: 'meta-muse' } }), env: { META_API_KEY: SECRET } }).ai.resolveFor({ userId: 'ana', feature: 'presentation', request: { tools: true } })
  assert.equal(builtIn.connection, null)
  assert.deepEqual(planModels({ feature, chosen: builtIn }), ['google/gemini-3.5-flash', 'google/gemini-3.7-flash'])
  assert.deepEqual(planModels({ feature, chosen: null }), ['google/gemini-3.5-flash', 'google/gemini-3.7-flash'])
  assert.equal(planEstimateMicros(chars, planModels({ feature, chosen: null }).map(aiPrice)), 41001, 'the built-in default, gemini-3.5-flash ($1.50 / $9.00)')
  // a DeepInfra key without a model of its own follows the feature's model, as req.js sends it
  assert.deepEqual(planModels({ feature, chosen: { connection: { type: 'deepinfra', apiKey: 'k' } } }), ['google/gemini-3.5-flash', 'google/gemini-3.7-flash'])
  // presentations.analyze prices its plan this way: the resolved connection, then the defaults
  const method = readFileSync(new URL('server/methods/presentations.js', app), 'utf8')
  assert.match(method, /resolveRequestConnection\(\{ feature: 'presentation'[\s\S]{0,300}planEstimateMicros\([\s\S]{0,200}planModels\(\{ feature, chosen \}\)\.map\(aiPrice\)/)
  assert.doesNotMatch(method, /\[feature\.engine, feature\.fallback\?\.engine\]/)
})

test('the built-in providers\' addresses and default models are data too; no model name is left in their code', async () => {
  const file = JSON.parse(readFileSync(new URL('server/config/ai-providers.json', app), 'utf8'))
  const { DEEPINFRA_CHAT_ENDPOINT, DEFAULT_DEEPINFRA_MODEL } = await import('../web/app/server/methods/ai/deepinfra.mjs')
  const { getProviderEndpoint, resolveAIModel } = await import('../web/app/server/methods/ai/provider.mjs')
  assert.equal(DEEPINFRA_CHAT_ENDPOINT, file.deepinfra.endpoint)
  assert.equal(DEFAULT_DEEPINFRA_MODEL, file.deepinfra.model)
  for (const provider of ['anthropic', 'deepinfra', 'openai']) assert.equal(getProviderEndpoint(provider), file[provider].endpoint, provider)
  assert.equal(resolveAIModel({ provider: 'deepinfra' }), file.deepinfra.model)
  assert.equal(resolveAIModel({ provider: 'deepinfra', settings: { deepinfra: { model: 'm/settings' } } }), 'm/settings')
  assert.equal(resolveAIModel({ provider: 'openai' }), file.openai.model)
  assert.equal(resolveAIModel({ provider: 'openai', settings: { openai: { model: 'o-settings' } } }), 'o-settings')
  assert.equal(resolveAIModel({ provider: 'openai', engine: 'named', settings: { openai: { model: 'o-settings' } } }), 'named')
  const code = (path) => readFileSync(new URL(path, app), 'utf8')
  assert.doesNotMatch(code('server/methods/ai/deepinfra.mjs'), /DeepSeek|Qwen|api\.deepinfra\.com/)
  assert.doesNotMatch(code('server/methods/ai/provider.mjs'), /gpt-4o|https:\/\//)
  assert.doesNotMatch(code('server/methods/stabilityai.js'), /'https:\/\/api\.stability\.ai\/v1\/generation|stable-diffusion-v1-6/)
  assert.match(code('server/methods/stabilityai.js'), /Meteor\.settings\.stabilityai\?\.endpoint \|\| aiProviders\.stabilityai\.endpoint/)
  // the seed sweep repins a dead model to the generation default, not to a name in the code
  assert.doesNotMatch(code('server/bootstrap/all.js'), /Qwen|DeepSeek/)
  assert.match(code('server/bootstrap/all.js'), /DEFAULT_AI_FEATURES\.generation\.engine/)
})

// ---------- 4. prices as data, with the operator's additions ----------

test('the price table has the presentation models, Meta\'s and Gemini\'s, none dearer than the dearest row before them', () => {
  const row = (model) => AI_PRICES.find((r) => r.model === model)
  assert.deepEqual([row('google/gemini-3.5-flash').inPerMillion, row('google/gemini-3.5-flash').outPerMillion], [1.5, 9])
  assert.deepEqual([row('google/gemini-3.7-flash').inPerMillion, row('google/gemini-3.7-flash').outPerMillion], [0.75, 3.75])
  assert.match(row('google/gemini-3.5-flash').source, /deepinfra\.com\/pricing/)
  assert.equal(row('google/gemini-3.5-flash').read, '2026-11-22')
  for (const model of ['muse-ember-1.0', 'muse-spark-1.3', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']) assert.ok(row(model), model)
  assert.equal(aiPrice('a model no one has priced').model, 'anthropic/claude-sonnet-4-6', 'the dearest row is unchanged')
})

test('settings.metering.prices adds and overrides rows, validated at start; an unknown model is still the dearest', (t) => {
  t.after(() => configurePrices({}))
  configurePrices({ metering: { prices: [
    { model: 'acme/new-model', inPerMillion: 0.5, outPerMillion: 2 },
    { model: 'google/gemini-3.5-flash', inPerMillion: 1.25, outPerMillion: 8 },
  ] } })
  assert.equal(aiPrice('acme/new-model').inPerMillion, 0.5)
  assert.equal(aiPrice('acme/new-model').source, 'settings')
  assert.equal(aiPrice('google/gemini-3.5-flash').outPerMillion, 8)
  assert.equal(aiCostMicros({ model: 'acme/new-model', usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } }).costMicros, 2_500_000)
  assert.equal(aiPrice('still unknown').model, 'anthropic/claude-sonnet-4-6')
  // an operator row dearer than every built-in one becomes the price of an unknown model
  configurePrices({ metering: { prices: [{ model: 'acme/huge', inPerMillion: 20, outPerMillion: 80 }] } })
  assert.equal(aiPrice('still unknown').model, 'acme/huge')
  // the built-in table itself is never changed
  assert.equal(AI_PRICES.find((r) => r.model === 'google/gemini-3.5-flash').outPerMillion, 9)
  configurePrices({})
  assert.equal(activePrices(), AI_PRICES)
})

test('a wrong metering.prices entry stops the start with a plain message', () => {
  for (const prices of [
    'x', [null], [{ model: '', inPerMillion: 1, outPerMillion: 1 }], [{ model: 'm', inPerMillion: -1, outPerMillion: 1 }],
    [{ model: 'm', inPerMillion: 1, outPerMillion: '2' }], [{ model: 'm', inPerMillion: 1, outPerMillion: Infinity }],
    [{ model: 'm', inPerMillion: 1, outPerMillion: 1001 }], [{ model: 'm', inPerMillion: 1, outPerMillion: 1, extra: true }],
    [{ model: 'm', inPerMillion: 1, outPerMillion: 1 }, { model: 'm', inPerMillion: 2, outPerMillion: 2 }],
  ]) {
    assert.throws(() => mergePrices(AI_PRICES, prices), /settings metering\.prices/, JSON.stringify(prices))
  }
  assert.equal(mergePrices(AI_PRICES, undefined), AI_PRICES)
  assert.equal(mergePrices(AI_PRICES, [{ model: 'free/local', inPerMillion: 0, outPerMillion: 0 }]).at(-1).inPerMillion, 0)
  // the meter applies them once at start
  const meter = readFileSync(new URL('server/metering/meteor.js', app), 'utf8')
  assert.match(meter, /configurePrices\(Meteor\.settings\)/)
})

// ---------- 5. self-host ----------

test('self-host passes GEMINI_API_KEY and META_API_KEY as optional blanks and documents both connections', () => {
  const root = new URL('../', import.meta.url)
  const compose = readFileSync(new URL('self-host/compose.yaml', root), 'utf8')
  assert.match(compose, /GEMINI_API_KEY: \$\{GEMINI_API_KEY:-\}/)
  assert.match(compose, /META_API_KEY: \$\{META_API_KEY:-\}/)
  const readme = readFileSync(new URL('self-host/README.md', root), 'utf8')
  assert.match(readme, /"apiKeyEnv": "META_API_KEY"/)
  assert.match(readme, /"apiKeyEnv": "GEMINI_API_KEY"/)
  assert.match(readme, /"toolChoice": "required"/)
  assert.match(readme, /"presentation": "meta-muse"/)
})

test('a new installation\'s instance.env lists GEMINI_API_KEY and META_API_KEY as blank optional entries', async (t) => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { execFileSync } = await import('node:child_process')
  const dir = await mkdtemp(join(tmpdir(), 'slatebox-init-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const init = new URL('../self-host/init.mjs', import.meta.url).pathname
  execFileSync(process.execPath, [init, join(dir, 'state')], { env: { PATH: process.env.PATH, SLATEBOX_STATE: join(dir, 'state'), APP_IMAGE: 'app:test', COLLAB_IMAGE: 'collab:test' } })
  const env = await readFile(join(dir, 'state', 'instance.env'), 'utf8')
  assert.match(env, /^GEMINI_API_KEY=''$/m)
  assert.match(env, /^META_API_KEY=''$/m)
  assert.match(env, /^# .*apiKeyEnv/m)
})
