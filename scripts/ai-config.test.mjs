// AI models, providers and keys are configuration in the backend, not code and not the settings
// file (owner, 2026-11-24): an administrator adds providers, models with their prices and keys in
// Admin → AI control. What stays in code is the wire: how each provider takes a forced tool call
// (toolChoice), and the price table an administrator's price overrides. The settings file keeps
// only operator switches and prices (metering.prices).
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { normalizeConnection, CONNECTION_TYPES } from '../web/app/server/methods/ai/connections.mjs'
import { connectionRequest } from '../web/app/server/methods/ai/connection-request.mjs'
import { localWorkshopRequest } from '../web/app/server/methods/ai/workshop-provider.mjs'
import { AI_PRICES, aiPrice, aiCostMicros, activePrices, configurePrices, mergePrices } from '../web/app/server/metering/prices.mjs'
import { aiControlWorld } from './ai-control-kit.mjs'

const app = new URL('../web/app/', import.meta.url)
const META = { type: 'openai-compatible', baseUrl: 'https://api.meta.ai/v1', model: 'muse-ember-1.0', toolChoice: 'auto' }
const SECRET = 'meta-secret-value-0123456789'

// ---------- 1. tool choice per provider ----------

const tool = { name: 'plan_presentation', description: 'Plan it', parameters: { type: 'object', properties: {} } }
const forced = { system: 'Plan.', prompts: [{ role: 'user', content: 'go' }], functions: [tool], functionCall: { name: tool.name } }
const free = { ...forced, functionCall: undefined }

test('toolChoice is auto, named or required; the default stays as it was', () => {
  for (const toolChoice of ['auto', 'named', 'required']) {
    assert.equal(normalizeConnection({ name: 'x', ...META, apiKey: 'k', toolChoice }, { hosted: false, level: 'person' }).toolChoice, toolChoice)
  }
  assert.throws(() => normalizeConnection({ name: 'x', ...META, apiKey: 'k', toolChoice: 'any' }, { hosted: false, level: 'person' }), /auto, named or required/)
  const base = { name: 'x', type: 'openai-compatible', baseUrl: 'https://h.example/v1', model: 'm', capabilities: {} }
  assert.equal(connectionRequest(base).toolChoice, 'auto')
  assert.equal(connectionRequest({ ...base, toolChoice: 'required' }).toolChoice, 'required')
  assert.equal(connectionRequest({ ...base, toolChoice: 'named' }).toolChoice, 'named')
  assert.equal(connectionRequest({ ...base, type: 'openai', baseUrl: CONNECTION_TYPES.openai.baseUrl }).toolChoice, 'named')
  // the named presets carry their own tool choice; the translation is keyed on the setting alone
  assert.equal(connectionRequest({ ...base, type: 'meta', baseUrl: CONNECTION_TYPES.meta.baseUrl }).toolChoice, 'auto')
  assert.equal(connectionRequest({ ...base, type: 'deepinfra', baseUrl: CONNECTION_TYPES.deepinfra.baseUrl }).toolChoice, 'named')
  for (const path of ['server/methods/ai/connection-request.mjs', 'server/methods/ai/workshop-provider.mjs', 'server/methods/ai/sdk-chat.cjs', 'server/methods/ai/connections.mjs', 'server/methods/ai/req.js', 'server/methods/ai/provider.mjs']) {
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

// ---------- 2. which model a plan is priced at ----------

test('a presentation plan is estimated at the model its route names: the part\'s model in Admin → AI control', async () => {
  const { planEstimateMicros, planModels } = await import('../web/app/server/methods/presentationRequest.mjs')
  const chars = 10_000
  const w = await aiControlWorld()
  await w.catalog.addProvider({ actor: w.actor, input: { preset: 'meta' }, models: ['muse-ember-1.0'] })
  await w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: SECRET })
  const chosen = await w.aiSettings.resolveFor({ userId: 'ana', feature: 'presentation', request: { tools: true } })
  assert.equal(chosen.ref, 'server:meta')
  assert.deepEqual(planModels({ chosen }), ['muse-ember-1.0'])
  const viaMeta = planEstimateMicros(chars, planModels({ chosen }).map((m) => aiPrice(m)))
  assert.equal(viaMeta, 7001, 'a 10k-character plan on muse-ember-1.0 ($0.30 / $1.50): 3,334 tokens in, a full plan out')
  // a route that cannot be used (no key) names no model: priced at the dearest rate, never as cheap
  assert.deepEqual(planModels({ chosen: { connection: null, error: 'no key' } }), [null])
  assert.equal(aiPrice(null).model, 'anthropic/claude-sonnet-4-6')
  const method = readFileSync(new URL('server/methods/presentations.js', app), 'utf8')
  assert.match(method, /resolveRequestConnection\(\{ feature: 'presentation'[\s\S]{0,300}planEstimateMicros\([\s\S]{0,200}planModels\(\{ chosen \}\)/)
})

test('no provider address, model name or key is left in the request code; the image service\'s address is data', () => {
  const file = JSON.parse(readFileSync(new URL('server/config/ai-providers.json', app), 'utf8'))
  assert.deepEqual(Object.keys(file).filter((k) => !k.startsWith('_')), ['stabilityai'])
  const code = (path) => readFileSync(new URL(path, app), 'utf8')
  assert.doesNotMatch(code('server/methods/ai/deepinfra.mjs'), /DeepSeek|Qwen|api\.deepinfra\.com/)
  assert.doesNotMatch(code('server/methods/ai/provider.mjs'), /gpt-4o|https:\/\/|getProviderApiKey|resolveAIModel/)
  assert.doesNotMatch(code('server/methods/stabilityai.js'), /'https:\/\/api\.stability\.ai\/v1\/generation|stable-diffusion-v1-6|settings\.stabilityai\?\.apiKey/)
  assert.match(code('server/methods/stabilityai.js'), /Meteor\.settings\.stabilityai\?\.endpoint \|\| aiProviders\.stabilityai\.endpoint/)
  // the kinds of slate the welcome flow makes name no model: the server picks it
  assert.doesNotMatch(code('server/bootstrap/all.js'), /Qwen|DeepSeek/)
  assert.doesNotMatch(code('server/methods/ai/generation-kinds-data.mjs'), /Qwen|DeepSeek|claude-|gpt-|"engine"/)
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
  const readme = readFileSync(new URL('self-host/COMPOSE-KIT.md', root), 'utf8')
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
