// Any AI, mixed freely: a person or an operator connects whatever model they choose (a cloud
// provider or any OpenAI-compatible endpoint), as a default and per feature. No model is named
// in the product, nothing is routed elsewhere behind the person's back, and the server refuses
// to call cloud metadata addresses (and, on hosted Slatebox, private networks).
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  addressKind, assertEndpointHost, checkEndpointUrl, connectionFetch, endpointRules, guardedLookup,
} from '../web/app/server/methods/ai/endpoint-policy.mjs'
import {
  AI_FEATURES, capabilityGap, choiceFeatureFor, normalizeConnection, operatorConfig, resolveAIChoice,
} from '../web/app/server/methods/ai/connections.mjs'
import { checkConnection } from '../web/app/server/methods/ai/connection-check.mjs'
import { generateImages } from '../web/app/server/methods/ai/image-connection.mjs'
import { createAISettings } from '../web/app/server/methods/ai/ai-settings-core.mjs'
import { connectionRequest } from '../web/app/server/methods/ai/connection-request.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'
import { createRegistry } from '../web/app/server/actions/registry.mjs'
import { actions as appActions, components as appComponents } from '../web/app/server/actions/index.mjs'
import { API_TOKEN_SCOPES } from '../web/app/server/api-token-core.mjs'

const app = new URL('../web/app/', import.meta.url).pathname
const source = (path) => readFileSync(join(app, path), 'utf8')
const resolver = (...addresses) => (host, options, callback) => callback(null, addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })))

// ---------- endpoint policy ----------

test('no product file names a bundled or default local model', () => {
  for (const path of ['server/methods/ai/connections.mjs', 'server/ai-control/resolve.mjs', 'server/methods/ai/req.js',
    'server/methods/ai/ai-settings-core.mjs', 'server/methods/ai/connection-check.mjs']) {
    assert.doesNotMatch(source(path), /inkling|llama3|qwen2\.5|mistral:|gemma/i, path)
  }
})

test('cloud metadata addresses are refused for every level, hosted or self-hosted', () => {
  for (const hosted of [true, false]) {
    for (const level of ['person', 'team', 'server', 'file']) {
      const rules = endpointRules({ hosted, level })
      for (const url of ['http://169.254.169.254/v1', 'https://169.254.169.254/v1', 'http://[fd00:ec2::254]/v1', 'http://100.100.100.200/v1',
        'http://metadata.google.internal/v1', 'http://169.254.170.2/v1', 'http://[::ffff:169.254.169.254]/v1']) {
        assert.throws(() => checkEndpointUrl(url, rules), { name: 'EndpointRefused' }, `${hosted} ${level} ${url}`)
      }
    }
  }
  assert.equal(addressKind('169.254.169.254'), 'metadata')
  assert.equal(addressKind('fd00:ec2::254'), 'metadata')
  assert.equal(addressKind('127.0.0.1'), 'loopback')
  assert.equal(addressKind('::1'), 'loopback')
  assert.equal(addressKind('169.254.10.10'), 'link-local')
  assert.equal(addressKind('192.168.1.20'), 'private')
  assert.equal(addressKind('93.184.216.34'), 'public')
})

test('on hosted Slatebox a person, team or admin endpoint is public https only', () => {
  for (const level of ['person', 'team', 'server']) {
    const rules = endpointRules({ hosted: true, level })
    for (const url of ['http://api.example.com/v1', 'https://10.0.0.1/v1', 'https://192.168.1.2/v1', 'https://localhost/v1',
      'https://host.docker.internal/v1', 'https://redis/v1', 'https://mongo.default.svc.cluster.local/v1', 'https://u:p@api.example.com/v1',
      'https://api.example.com/v1?x=1', 'ftp://api.example.com']) {
      assert.throws(() => checkEndpointUrl(url, rules), { name: 'EndpointRefused' }, `${level} ${url}`)
    }
    assert.equal(checkEndpointUrl('https://api.example.com/v1/', rules), 'https://api.example.com/v1')
  }
})

test('a self-hosted person may use a LAN or host endpoint over http, never the container itself', () => {
  const rules = endpointRules({ hosted: false, level: 'person' })
  assert.equal(checkEndpointUrl('http://host.docker.internal:11434/v1', rules), 'http://host.docker.internal:11434/v1')
  assert.equal(checkEndpointUrl('http://192.168.1.20:8080/v1/', rules), 'http://192.168.1.20:8080/v1')
  assert.equal(checkEndpointUrl('https://llm.example.com/v1', rules), 'https://llm.example.com/v1')
  for (const url of ['http://127.0.0.1:11434/v1', 'http://localhost:11434/v1', 'http://[::1]:11434/v1', 'http://169.254.1.1/v1']) {
    assert.throws(() => checkEndpointUrl(url, rules), { name: 'EndpointRefused' }, url)
  }
})

test('a self-hosted operator may use any address but a metadata one, loopback included', () => {
  for (const level of ['server', 'file']) {
    const rules = endpointRules({ hosted: false, level })
    assert.equal(checkEndpointUrl('http://127.0.0.1:11434/v1', rules), 'http://127.0.0.1:11434/v1')
    assert.equal(checkEndpointUrl('http://localhost:8080/v1', rules), 'http://localhost:8080/v1')
    assert.equal(checkEndpointUrl('http://ollama:11434/v1', rules), 'http://ollama:11434/v1')
  }
})

test('the connection lookup applies the same rules to every address a name resolves to', async () => {
  const lookupWith = (rules, ...addresses) => new Promise((ok, fail) =>
    guardedLookup(rules, resolver(...addresses))('model.example.com', { all: true }, (error, list) => (error ? fail(error) : ok(list))))
  const selfPerson = endpointRules({ hosted: false, level: 'person' })
  const hostedPerson = endpointRules({ hosted: true, level: 'person' })
  const selfServer = endpointRules({ hosted: false, level: 'server' })
  await assert.rejects(lookupWith(selfServer, '169.254.169.254'), { name: 'EndpointRefused' })
  await assert.rejects(lookupWith(selfPerson, '10.0.0.5', '127.0.0.1'), { name: 'EndpointRefused' })
  await assert.rejects(lookupWith(hostedPerson, '10.0.0.5'), { name: 'EndpointRefused' })
  assert.equal((await lookupWith(selfPerson, '10.0.0.5')).length, 1)
  assert.equal((await lookupWith(selfServer, '127.0.0.1')).length, 1)
  assert.equal((await lookupWith(hostedPerson, '93.184.216.34')).length, 1)
  await assert.rejects(assertEndpointHost('https://evil.example.com/v1', hostedPerson, resolver('192.168.0.1')), { name: 'EndpointRefused' })
  await assertEndpointHost('https://good.example.com/v1', hostedPerson, resolver('93.184.216.34'))
})

// ---------- connections ----------

test('the features are listed with what each needs, and every request feature maps to one', () => {
  // Restated (library): library review and refinement is a feature of its own, which follows chat unless chosen.
  // voice (2026-11-26): talking with the agent is a feature of its own, which takes only a model that talks
  assert.deepEqual(AI_FEATURES.map((f) => f.id), ['chat', 'generation', 'presentation', 'vision', 'images', 'shape', 'library', 'voice'])
  assert.deepEqual(AI_FEATURES.find((f) => f.id === 'voice').needs, ['voice'])
  assert.deepEqual(AI_FEATURES.find((f) => f.id === 'images').needs, ['images'])
  assert.deepEqual(AI_FEATURES.find((f) => f.id === 'vision').needs, ['vision'])
  for (const [request, choice] of Object.entries({ welcome: 'chat', workshop: 'chat', 'lane-chat': 'chat', 'map-chat': 'chat', generation: 'generation',
    layout: 'generation', presentation: 'presentation', vision: 'vision', 'image-generation': 'images', 'library-refine': 'library' })) {
    assert.equal(choiceFeatureFor(request), choice, request)
  }
  assert.equal(choiceFeatureFor('image-search'), null, 'image search is not a model')
})

test('a connection is checked and normalised; a cloud preset keeps its own address', () => {
  const self = { hosted: false, level: 'person' }
  const local = normalizeConnection({ name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.20:11434/v1/', model: 'any-model:latest' }, self)
  assert.deepEqual(local, { name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.20:11434/v1', model: 'any-model:latest', capabilities: {} })
  const openai = normalizeConnection({ name: 'oa', type: 'openai', model: 'some-model', apiKey: 'sk-test-0123456789', capabilities: { vision: true, images: true } }, self)
  assert.equal(openai.baseUrl, 'https://api.openai.com/v1')
  assert.equal(openai.apiKey, 'sk-test-0123456789')
  assert.deepEqual(openai.capabilities, { vision: true, images: true })
  assert.equal(normalizeConnection({ name: 'claude', type: 'anthropic', model: 'a-model', apiKey: 'k-0123456789' }, self).baseUrl, 'https://api.anthropic.com/v1')
  // every connection names its model: there is no per-feature default model to follow
  assert.throws(() => normalizeConnection({ name: 'di', type: 'deepinfra', apiKey: 'k-0123456789' }, self), /model name/)
  assert.equal(normalizeConnection({ name: 'muse', type: 'meta', model: 'muse-ember-1.0', apiKey: 'k-0123456789' }, self).baseUrl, 'https://api.meta.ai/v1', 'every named provider keeps its own address')
  const bad = [
    { name: 'Bad Name', type: 'openai', model: 'm', apiKey: 'k-0123456789' },
    { name: 'x', type: 'nonsense', model: 'm' },
    { name: 'x', type: 'openai-compatible', model: 'm' },
    { name: 'x', type: 'openai-compatible', baseUrl: 'http://192.168.1.2/v1' },
    { name: 'x', type: 'openai', model: 'm' },
    { name: 'x', type: 'openai', model: 'm', apiKey: 'a\nb' },
    { name: 'x', type: 'openai', model: 'm', apiKey: 'k-0123456789', baseUrl: 'https://evil.example.com/v1' },
    { name: 'x', type: 'openai-compatible', baseUrl: 'http://169.254.169.254/v1', model: 'm' },
    { name: 'x', type: 'openai-compatible', baseUrl: 'http://192.168.1.2/v1', model: 'm', capabilities: { vision: 'yes' } },
    { name: 'x', type: 'openai-compatible', baseUrl: 'http://192.168.1.2/v1', model: 'm', capabilities: { telepathy: true } },
  ]
  for (const input of bad) assert.throws(() => normalizeConnection(input, self), { name: 'ConnectionError' }, JSON.stringify(input))
})

const conn = (name, extra = {}) => ({ name, type: 'openai-compatible', baseUrl: `http://${name}.lan/v1`, model: `${name}-model`, capabilities: {}, ...extra })

test('the person chooses first, per feature then their default; then their team; then this server\'s model (Admin → AI control)', () => {
  const person = { connections: [conn('mine'), conn('cloud')], use: { default: 'me:mine', presentation: 'me:cloud', images: 'builtin' } }
  const team = { connections: [conn('teamy')], use: { default: 'team:teamy' } }
  const pick = (feature, p = person, t = team, ownProviders = true) => resolveAIChoice({ feature, person: p, team: t, ownProviders })
  assert.equal(pick('chat').ref, 'me:mine')
  assert.equal(pick('chat').own, true)
  assert.equal(pick('presentation').ref, 'me:cloud')
  assert.equal(pick('images').ref, 'builtin')
  assert.equal(pick('images').own, false)
  assert.equal(pick('chat', { connections: [], use: {} }).ref, 'team:teamy')
  assert.equal(pick('chat', { connections: [], use: {} }).own, true)
  assert.equal(pick('vision', null, null).ref, 'builtin', 'nothing of their own: this server\'s model')
  assert.equal(pick('vision', null, null).own, false)
  // the operator's one switch: people's own connections and choices are not used
  assert.equal(pick('chat', person, team, false).ref, 'builtin')
  // a choice naming a server connection is no choice any more, and one whose connection is gone is skipped
  assert.equal(pick('chat', { connections: [], use: { chat: 'server:vis' } }, null).ref, 'builtin')
  assert.equal(pick('chat', { connections: [], use: { chat: 'me:gone' } }, null).ref, 'builtin')
})

test('own keys saved before choices existed keep working as they did', () => {
  const legacyKey = { name: 'deepinfra', type: 'deepinfra', capabilities: {}, legacy: 'all' }
  const legacyModel = conn('own-model', { legacy: 'chat' })
  const person = { connections: [legacyKey], use: {} }
  assert.equal(resolveAIChoice({ feature: 'generation', person, team: null, ownProviders: true }).ref, 'me:deepinfra')
  const compat = { connections: [legacyModel], use: {} }
  assert.equal(resolveAIChoice({ feature: 'chat', person: compat, team: null, ownProviders: true }).ref, 'me:own-model')
  assert.equal(resolveAIChoice({ feature: 'generation', person: compat, team: null, ownProviders: true }).ref, 'builtin')
  assert.equal(resolveAIChoice({ feature: 'chat', person: null, team: compat, ownProviders: true }).ref, 'team:own-model')
})

test('the operator configuration reads only the switches from the settings file: no connection, choice or key', () => {
  const file = operatorConfig({ public: { env: 'selfhost' }, ai: { connections: { local: { type: 'openai-compatible', baseUrl: 'http://host.docker.internal:11434/v1', model: 'm' } }, use: { default: 'local' }, ownProviders: 'off' } })
  assert.equal(file.ownProviders, false)
  assert.equal(file.connections, undefined, 'settings-file connections are not read (ai-control-002 moves their keys into the backend)')
  assert.equal(file.use, undefined)
  const none = operatorConfig({ public: { env: 'selfhost' }, selfHosted: { workshopAI: true } })
  assert.deepEqual([none.ownProviders, none.privateEndpoints], [true, true])
  assert.throws(() => operatorConfig({ public: { env: 'selfhost' }, ai: { ownProviders: 'maybe' } }), /ownProviders/)
})

test('a feature says what the chosen model cannot do and offers another, it never reroutes', () => {
  const plain = conn('plain', { capabilities: { tools: false, vision: false } })
  const images = capabilityGap({ feature: 'images', connection: plain })
  assert.match(images.message, /plain-model/)
  assert.match(images.message, /cannot (make|generate) images/i)
  assert.match(images.message, /choose another model for generating images/i)
  assert.equal(images.need, 'images')
  assert.equal(capabilityGap({ feature: 'images', connection: conn('art', { capabilities: { images: true } }) }), null)
  assert.equal(capabilityGap({ feature: 'vision', connection: plain, request: { images: true } }).need, 'vision')
  assert.equal(capabilityGap({ feature: 'vision', connection: conn('unknown'), request: { images: true } }), null, 'unknown means try it')
  assert.equal(capabilityGap({ feature: 'chat', connection: plain, request: { tools: true } }).need, 'tools')
  assert.equal(capabilityGap({ feature: 'chat', connection: null, request: { tools: true } }), null, 'the built-in AI is not checked here')
})

// ---------- a stub OpenAI-compatible server ----------

async function stubServer(t, handler) {
  const seen = []
  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const parsed = body ? JSON.parse(body) : null
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: parsed })
    const answer = (status, json, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(json)) }
    handler(req, parsed, answer)
  })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  t.after(() => server.close())
  return { base: `http://127.0.0.1:${server.address().port}/v1`, seen }
}

const toolAnswer = (name, args) => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } })

test('Test connection lists the models and says whether the model calls tools', async (t) => {
  const stub = await stubServer(t, (req, body, answer) => {
    if (req.url === '/v1/models') return answer(200, { data: [{ id: 'a-model' }, { id: 'b-model' }] })
    if (req.url === '/v1/chat/completions') return answer(200, toolAnswer('ping', { ok: true }))
    answer(404, {})
  })
  const result = await checkConnection({ name: 'x', type: 'openai-compatible', baseUrl: stub.base, model: 'b-model', apiKey: 'secret-key-123456' }, { fetch })
  assert.equal(result.ok, true)
  assert.deepEqual(result.models, ['a-model', 'b-model'])
  assert.equal(result.modelListed, true)
  assert.equal(result.tools, 'yes')
  assert.equal(stub.seen[0].headers.authorization, 'Bearer secret-key-123456')
  assert.equal(stub.seen[1].body.model, 'b-model')
  assert.doesNotMatch(JSON.stringify(result), /secret-key/)
})

test('Test connection says when the model answers but refuses tools, or is not served', async (t) => {
  const stub = await stubServer(t, (req, body, answer) => {
    if (req.url === '/v1/models') return answer(200, { data: [{ id: 'small' }] })
    if (body?.tools) return answer(400, { error: { message: 'small does not support tools' } })
    answer(200, { choices: [{ message: { role: 'assistant', content: 'ok' } }] })
  })
  const result = await checkConnection({ name: 'x', type: 'openai-compatible', baseUrl: stub.base, model: 'small' }, { fetch })
  assert.equal(result.ok, true)
  assert.equal(result.tools, 'no')
  assert.match(result.message, /tool/i)
  const missing = await checkConnection({ name: 'x', type: 'openai-compatible', baseUrl: stub.base, model: 'not-there' }, { fetch })
  assert.equal(missing.modelListed, false)
  assert.match(missing.message, /not-there/)
})

test('Test connection explains a refused key and an unreachable endpoint, without the key', async (t) => {
  const stub = await stubServer(t, (req, body, answer) => answer(401, { error: { message: 'bad key secret-key-123456' } }))
  const refused = await checkConnection({ name: 'x', type: 'openai-compatible', baseUrl: stub.base, model: 'm', apiKey: 'secret-key-123456' }, { fetch })
  assert.equal(refused.ok, false)
  assert.match(refused.message, /did not accept the key/i)
  assert.doesNotMatch(JSON.stringify(refused), /secret-key/)
  const gone = await checkConnection({ name: 'x', type: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', model: 'm' }, { fetch, timeoutMs: 2000 })
  assert.equal(gone.ok, false)
  assert.equal(gone.reachable, false)
  assert.match(gone.message, /could not reach|host\.docker\.internal/i)
})

test('an image is made through the chosen endpoint when it can make images', async (t) => {
  // only real image bytes are stored, so the stub sends a PNG signature
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png')])
  const png = bytes.toString('base64')
  const stub = await stubServer(t, (req, body, answer) => answer(200, { data: [{ b64_json: png }] }))
  const images = await generateImages({ name: 'art', type: 'openai-compatible', baseUrl: stub.base, model: 'img-model', apiKey: 'k', capabilities: { images: true } },
    { prompt: 'a lighthouse', width: 512, height: 512 }, { fetch })
  assert.ok(images[0].equals(bytes))
  assert.equal(stub.seen[0].url, '/v1/images/generations')
  assert.equal(stub.seen[0].body.model, 'img-model')
  assert.equal(stub.seen[0].body.response_format, 'b64_json')
})

test('an image endpoint\'s answer is stored only when it is a real picture of a picture\'s size', async (t) => {
  const { imageKind, MAX_IMAGE_BYTES } = await import('../web/app/server/methods/ai/image-connection.mjs')
  const conn = (base) => ({ name: 'art', type: 'openai-compatible', baseUrl: base, model: 'img', capabilities: { images: true } })
  const notImage = await stubServer(t, (req, body, answer) => answer(200, { data: [{ b64_json: Buffer.from('<html>any file at all</html>').toString('base64') }] }))
  await assert.rejects(generateImages(conn(notImage.base), { prompt: 'p' }, { fetch }), /not a PNG, JPEG or WebP image/)
  const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(MAX_IMAGE_BYTES)])
  const tooLarge = await stubServer(t, (req, body, answer) => answer(200, { data: [{ b64_json: big.toString('base64') }] }))
  await assert.rejects(generateImages(conn(tooLarge.base), { prompt: 'p' }, { fetch }), /too large/)
  assert.equal(imageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'jpeg')
  assert.equal(imageKind(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')), 'webp')
  assert.equal(imageKind(Buffer.from('GIF89a-not-allowed')), null)
  // the store is told what the bytes are, never a fixed image/png
  const glue = source('server/methods/stabilityai.js')
  assert.match(glue, /contentType: IMAGE_TYPES\[kind\]/)
})

// ---------- the request a chosen connection sends ----------

test('a chosen connection is sent through the generic request with its model, key and caps, and an image inline', async (t) => {
  const stub = await stubServer(t, (req, body, answer) => answer(200, toolAnswer('draw', { notes: [] })))
  const { sdkChatRequest } = await import('../web/app/server/methods/ai/sdk-chat.cjs')
  const request = connectionRequest({ name: 'desk', type: 'openai-compatible', baseUrl: stub.base, model: 'desk-model', apiKey: 'k-0123456789', capabilities: {}, maxTokens: 2048 })
  assert.equal(request.endpoint, stub.base + '/chat/completions')
  assert.equal(request.toolChoice, 'auto', 'an OpenAI-compatible endpoint may ignore a named tool choice')
  assert.equal(request.maxTokens, 2048)
  const body = { model: request.model, max_tokens: request.maxTokens, messages: [{ role: 'user', content: [{ type: 'text', text: 'read this' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }] }] }
  await sdkChatRequest({ provider: 'connection', endpoint: request.endpoint, apiKey: request.apiKey, body, functions: [{ name: 'draw', description: 'd', parameters: { type: 'object', properties: {} } }], local: true })
  const sent = stub.seen[0].body
  assert.equal(sent.model, 'desk-model')
  assert.equal(sent.max_tokens, 2048)
  assert.match(JSON.stringify(sent.messages), /data:image\/png;base64,aGVsbG8=/)
  assert.equal(stub.seen[0].headers.authorization, 'Bearer k-0123456789')
  assert.equal(connectionRequest({ name: 'oa', type: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'm', apiKey: 'k', capabilities: {} }).toolChoice, 'named')
  assert.equal(connectionRequest({ name: 'c', type: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'm', apiKey: 'k', capabilities: {} }).provider, 'anthropic')
})

test('the guarded connection fetch answers the AI SDK with a standard Response (node-fetch alone fails it)', async (t) => {
  const stub = await stubServer(t, (req, body, answer) => answer(200, toolAnswer('draw', { notes: [] })))
  const { sdkChatRequest } = await import('../web/app/server/methods/ai/sdk-chat.cjs')
  const rules = endpointRules({ hosted: false, level: 'server' })
  const fetcher = connectionFetch(stub.base, rules)
  const answer = await sdkChatRequest({ provider: 'connection', endpoint: stub.base + '/chat/completions', body: { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
    functions: [{ name: 'draw', description: 'd', parameters: { type: 'object', properties: {} } }], local: true, fetcher })
  assert.equal(answer.choices[0].message.tool_calls[0].function.name, 'draw')
  // the same fetch applies the rules to the address it connects to
  const personRules = endpointRules({ hosted: false, level: 'person' })
  await assert.rejects(connectionFetch('http://loopback.example.test/v1', personRules, resolver('127.0.0.1'))('http://loopback.example.test/v1/models'), /this server itself|EndpointRefused|refused/i)
  // no redirect is followed
  const redirect = await stubServer(t, (req, body, answer) => answer(302, {}, { location: 'http://169.254.169.254/latest' }))
  await assert.rejects(connectionFetch(redirect.base, rules)(redirect.base + '/models'))
})

// ---------- the settings service ----------

function memoryStore() {
  const keys = [], uses = new Map()
  const match = (owner) => (doc) => doc.ownerType === owner.type && doc.ownerId === owner.id
  return {
    keys, uses,
    async listConnections(owner) { return keys.filter(match(owner)).map((doc) => ({ ...doc })) },
    async saveConnection(owner, doc) {
      const i = keys.findIndex((k) => match(owner)(k) && k.name === doc.name)
      if (i >= 0) keys[i] = { ...doc, ownerType: owner.type, ownerId: owner.id }
      else keys.push({ ...doc, ownerType: owner.type, ownerId: owner.id })
    },
    async removeConnection(owner, name) {
      const i = keys.findIndex((k) => match(owner)(k) && k.name === name)
      if (i >= 0) keys.splice(i, 1)
    },
    async getUse(owner) { return uses.get(`${owner.type}:${owner.id}`) || { use: {} } },
    async setUse(owner, value) { uses.set(`${owner.type}:${owner.id}`, value) },
  }
}

function service({ hosted = false, settings = { public: { env: 'selfhost' } }, withMaster = true, checkWith } = {}) {
  const store = memoryStore()
  const master = withMaster ? loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') }) : null
  const people = { ana: { _id: 'ana', orgId: 'team1' }, bo: { _id: 'bo', orgId: 'team1' }, root: { _id: 'root' }, guest: { _id: 'guest', isAnonymous: true } }
  const ai = createAISettings({
    store, master, settings, hosted,
    loadUser: async (id) => people[id] || null,
    isAdmin: async (id) => id === 'root',
    isTeamAdmin: async (user) => user._id === 'ana',
    check: checkWith || (async (connection) => ({ ok: true, reachable: true, models: [connection.model], modelListed: true, tools: 'yes', message: 'ok' })),
  })
  return { ai, store, master }
}

test('a person saves their own endpoint and chooses it per feature; the key is encrypted and never shown', async () => {
  const { ai, store } = service()
  await ai.update('ana', { level: 'me', connections: [{ name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.20:11434/v1', model: 'desk-model', apiKey: 'desk-key-0123456789' }], use: { chat: 'me:desk' } })
  assert.equal(store.keys.length, 1)
  assert.doesNotMatch(JSON.stringify(store.keys), /desk-key-0123456789/)
  const view = await ai.view('ana')
  assert.doesNotMatch(JSON.stringify(view), /desk-key-0123456789/)
  assert.deepEqual(view.mine.connections.map((c) => [c.name, c.model, c.hasKey, c.host]), [['desk', 'desk-model', true, '192.168.1.20:11434']])
  assert.equal(view.effective.chat.ref, 'me:desk')
  assert.equal(view.effective.chat.own, true)
  assert.equal(view.effective.generation.ref, 'builtin')
  const resolved = await ai.resolveFor({ userId: 'ana', feature: 'workshop' })
  assert.equal(resolved.connection.apiKey, 'desk-key-0123456789', 'the request gets the key, in memory only')
  assert.equal(resolved.connection.model, 'desk-model')
  // changing the model keeps the key unless it is sent again or cleared
  await ai.update('ana', { level: 'me', connections: [{ name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.20:11434/v1', model: 'other-model' }] })
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'workshop' })).connection.apiKey, 'desk-key-0123456789')
  // removing the connection removes the choices that named it
  await ai.update('ana', { level: 'me', remove: ['desk'] })
  assert.equal((await ai.view('ana')).effective.chat.ref, 'builtin')
  assert.deepEqual((await store.getUse({ type: 'user', id: 'ana' })).use, {})
})

test('a keyless endpoint needs no encryption key; a key does', async () => {
  const { ai } = service({ withMaster: false })
  await ai.update('ana', { level: 'me', connections: [{ name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.20:11434/v1', model: 'm' }], use: { default: 'me:desk' } })
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'generation' })).ref, 'me:desk')
  await assert.rejects(ai.update('ana', { level: 'me', connections: [{ name: 'oa', type: 'openai', model: 'm', apiKey: 'sk-0123456789' }] }), { code: 'unavailable' })
})

test('choices must name a connection that exists at that level or above; the server\'s models are not choices here', async () => {
  const { ai } = service()
  await assert.rejects(ai.update('ana', { level: 'me', use: { chat: 'me:nothing' } }), { code: 'invalid_request' })
  await assert.rejects(ai.update('ana', { level: 'me', use: { nonsense: 'builtin' } }), { code: 'invalid_request' })
  await assert.rejects(ai.update('ana', { level: 'me', use: { chat: 'server:ops' } }), { code: 'invalid_request' })
  await ai.update('ana', { level: 'me', use: { images: 'builtin' } })
  assert.equal((await ai.view('ana')).effective.chat.ref, 'builtin')
  await assert.rejects(ai.update('root', { level: 'server', use: { chat: 'me:x' } }), (error) => error.code === 'invalid_request' && /Admin → AI control/.test(error.message))
})

test('only a team admin changes the team, only an administrator changes the server, never a guest', async () => {
  const { ai } = service()
  await assert.rejects(ai.update('bo', { level: 'team', use: { chat: 'builtin' } }), { code: 'forbidden' })
  await ai.update('ana', { level: 'team', connections: [{ name: 'shared', type: 'openai-compatible', baseUrl: 'http://10.1.1.1/v1', model: 'm' }], use: { default: 'team:shared' } })
  assert.equal((await ai.resolveFor({ userId: 'bo', feature: 'generation' })).ref, 'team:shared')
  await assert.rejects(ai.update('ana', { level: 'server', use: { chat: 'builtin' } }), { code: 'forbidden' })
  await assert.rejects(ai.update('guest', { level: 'me', use: { chat: 'builtin' } }), { code: 'registration_required' })
  await ai.update('root', { level: 'server', ownProviders: 'on' })
  assert.equal((await ai.view('root')).server.editable, true)
  assert.equal((await ai.view('root')).server.adminPage, '/admin/ai')
  assert.equal((await ai.view('ana')).server.editable, false)
})

test('the operator switch turns off people\'s own providers; the settings file wins over the database', async () => {
  const { ai } = service()
  await ai.update('ana', { level: 'me', connections: [{ name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.20/v1', model: 'm' }], use: { default: 'me:desk' } })
  await ai.update('root', { level: 'server', ownProviders: 'off' })
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'generation' })).ref, 'builtin')
  const view = await ai.view('ana')
  assert.equal(view.ownProviders, false)
  await assert.rejects(ai.update('ana', { level: 'me', use: { chat: 'builtin' } }), { code: 'forbidden' })
  await ai.update('root', { level: 'server', ownProviders: 'on' })
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'generation' })).ref, 'me:desk')
  const locked = service({ settings: { public: { env: 'selfhost' }, ai: { ownProviders: 'off' } } })
  await locked.ai.update('root', { level: 'server', ownProviders: 'on' })
  assert.equal((await locked.ai.view('ana')).ownProviders, false, 'the settings file has the last word')
})

// Restated 2026-11-26 (owner: own keys on Cloud too): hosted Slatebox used to refuse a person's own
// AI whatever its address, and the administrator's ownProviders switch. It now takes a public https
// connection, still refuses a private one, and lets an administrator turn own AI on or off.
test('hosted Slatebox takes people\'s own AI at a public https address only, and an administrator may turn it off', async () => {
  const { ai, store } = service({ hosted: true, settings: { public: { env: 'prod' } } })
  await assert.rejects(ai.update('ana', { level: 'me', connections: [{ name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.20/v1', model: 'm' }] }), { code: 'invalid_request' })
  await ai.update('ana', { level: 'me', connections: [{ name: 'cloud', type: 'openai-compatible', baseUrl: 'https://llm.example.com/v1', model: 'm' }], use: { chat: 'me:cloud' } })
  assert.equal(store.keys.length, 1)
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'chat' })).ref, 'me:cloud')
  // the server's providers are added in Admin → AI control, where an Other address passes the endpoint rules
  await assert.rejects(ai.update('root', { level: 'server', connections: [{ name: 'cloud', type: 'openai-compatible', baseUrl: 'https://llm.example.com/v1', model: 'm' }] }), (error) => error.code === 'invalid_request' && /Admin → AI control/.test(error.message))
  await ai.update('root', { level: 'server', ownProviders: 'off' })
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'chat' })).own, false, 'the administrator\'s switch wins on Cloud')
  await ai.update('root', { level: 'server', ownProviders: 'on' })
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'chat' })).ref, 'me:cloud')
})

test('Test connection runs on a saved connection with its key, or on one not yet saved', async () => {
  const checked = []
  const { ai } = service({ checkWith: async (connection, rules) => { checked.push({ connection, rules }); return { ok: true, reachable: true, models: [], modelListed: null, tools: 'unknown', message: 'ok' } } })
  await ai.update('ana', { level: 'me', connections: [{ name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.20/v1', model: 'm', apiKey: 'desk-key-0123456789' }] })
  const saved = await ai.check('ana', { level: 'me', name: 'desk' })
  assert.equal(saved.ok, true)
  assert.equal(checked[0].connection.apiKey, 'desk-key-0123456789')
  assert.equal(checked[0].rules.level, 'person')
  await ai.check('ana', { connection: { name: 'try', type: 'openai-compatible', baseUrl: 'http://192.168.1.21/v1', model: 'n' } })
  assert.equal(checked[1].connection.baseUrl, 'http://192.168.1.21/v1')
  await assert.rejects(ai.check('ana', { connection: { name: 'try', type: 'openai-compatible', baseUrl: 'http://169.254.169.254/v1', model: 'n' } }), { code: 'invalid_request' })
  await assert.rejects(ai.check('ana', { level: 'me', name: 'missing' }), { code: 'not_found' })
})

test('a request feature resolves with its capability gap, so the caller can say so', async () => {
  const { ai } = service()
  await ai.update('ana', { level: 'me', connections: [{ name: 'txt', type: 'openai-compatible', baseUrl: 'http://192.168.1.20/v1', model: 'text-only', capabilities: { vision: false, images: false } }], use: { default: 'me:txt' } })
  const vision = await ai.resolveFor({ userId: 'ana', feature: 'vision', request: { images: true } })
  assert.equal(vision.gap.need, 'vision')
  const images = await ai.resolveFor({ userId: 'ana', feature: 'image-generation' })
  assert.equal(images.gap.need, 'images')
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'image-search' })), null, 'image search is not a model choice')
})

// ---------- the agent surfaces ----------

test('exec, MCP and the CLI read, change and test the AI setup through registry actions', async () => {
  const ids = appActions.map((a) => a.id)
  for (const id of ['ai.get', 'ai.update', 'ai.check']) assert.ok(ids.includes(id), id)
  const byId = Object.fromEntries(appActions.map((a) => [a.id, a]))
  assert.deepEqual(byId['ai.get'].mounts.http, { method: 'GET', path: '/ai', operationId: 'getAISettings' })
  assert.equal(byId['ai.update'].mounts.http.method, 'PUT')
  assert.equal(byId['ai.check'].mounts.http.method, 'POST')
  assert.equal(byId['ai.update'].confirm, true, 'exec holds a change of where AI requests go for confirmation')
  for (const id of ['ai.get', 'ai.update', 'ai.check']) {
    assert.equal(byId[id].scope, 'ai:settings')
    assert.equal('cli' in byId[id], false, id + ' has no CLI name: the CLI reaches it through slatebox exec')
    assert.ok(byId[id].mounts.ddp, id + ' is what the settings page calls')
  }
  assert.ok(API_TOKEN_SCOPES.includes('ai:settings'))
  const calls = []
  const deps = { ai: {
    view: async (userId) => (calls.push(['view', userId]), { ownProviders: true }),
    update: async (userId, input) => (calls.push(['update', userId, input]), { ownProviders: true }),
    check: async (userId, input) => (calls.push(['check', userId, input]), { ok: true, reachable: true, tools: 'yes', message: 'ok' }),
  } }
  const registry = createRegistry({ actions: appActions, components: appComponents, scopes: API_TOKEN_SCOPES, deps })
  const agent = { kind: 'agent', userId: 'ana', tokenId: 't', scopes: ['ai:settings'] }
  await registry.run(agent, 'ai.get', {})
  await registry.run(agent, 'ai.update', { level: 'me', use: { chat: 'builtin' } })
  await registry.run(agent, 'ai.check', { level: 'me', name: 'desk' })
  assert.deepEqual(calls.map((c) => c[0]), ['view', 'update', 'check'])
  await assert.rejects(registry.run({ ...agent, scopes: ['slates:read'] }, 'ai.get', {}), { status: 403 })
  await assert.rejects(registry.run(agent, 'ai.update', { level: 'me', apiKey: 'loose' }), { status: 400 })
})

// ---------- wiring ----------

test('req resolves the chosen connection after the meter gate, and a chosen connection never falls back', () => {
  const req = source('server/methods/ai/req.js')
  const body = req.slice(req.indexOf('async function requestFromProvider'))
  assert.ok(body.indexOf('resolveRequestConnection(') > body.indexOf('aiRequestGate()'), 'resolved after the gate')
  assert.match(body, /gap/)
  // the one fallback (the default model after a failing service) is for the server's own routes only
  assert.match(req, /route\?\.scope !== 'server'/)
  // nothing is sent without a route that has its key
  assert.match(body, /!chosenConnection \|\| chosen\?\.gap \|\| chosen\?\.error/)
})

test('the meter pays only for Slatebox AI: own choices route to the own-key path', () => {
  const meteor = source('server/metering/meteor.js')
  assert.match(meteor, /resolveFor\(/)
  assert.doesNotMatch(meteor, /COMPATIBLE_FEATURES\.has\(feature\) && has\('openai-compatible'\)/)
})

test('workshops and conversations let req choose the model, image generation uses the chosen endpoint', () => {
  for (const path of ['server/methods/workshops.js', 'server/methods/canvas-conversation.js']) {
    assert.doesNotMatch(source(path), /localWorkshopProvider\(/, path)
  }
  const images = source('server/methods/stabilityai.js')
  assert.match(images, /resolveRequestConnection\(/)
  assert.match(images, /generateImages\(/)
  assert.match(images, /gap/)
})

// ---------- hostile review fixes (2026-11-21) ----------

import { seal, last4 } from '../web/app/server/metering/vault.mjs'
import { BUILTIN_ONLY_FEATURES, carriesImages } from '../web/app/server/methods/ai/connections.mjs'

const recordingService = (options = {}) => {
  const checked = []
  const made = service({ ...options, checkWith: async (connection, rules) => { checked.push({ connection, rules }); return { ok: true, reachable: true, models: [], modelListed: null, tools: 'unknown', message: 'ok' } } })
  return { ...made, checked }
}

test('H1: Test connection never sends a saved key to an address other than the saved one', async () => {
  const { ai, checked } = recordingService()
  await ai.update('ana', { level: 'team', connections: [{ name: 'team-model', type: 'openai-compatible', baseUrl: 'http://10.1.1.1/v1', model: 'm', apiKey: 'sk-TEAM-SECRET' }] })
  // a member who is not a team admin cannot test an unsaved team connection at all
  await assert.rejects(ai.check('bo', { level: 'team', connection: { name: 'team-model', type: 'openai-compatible', baseUrl: 'https://attacker.example/v1', model: 'm' } }), { code: 'forbidden' })
  // a member may test the saved one, which goes to its own address
  await ai.check('bo', { level: 'team', name: 'team-model' })
  assert.equal(checked.at(-1).connection.baseUrl, 'http://10.1.1.1/v1')
  // the team admin: a changed address does not carry the saved key, the same address does
  await ai.check('ana', { level: 'team', connection: { name: 'team-model', type: 'openai-compatible', baseUrl: 'https://elsewhere.example/v1', model: 'm' } })
  assert.equal(checked.at(-1).connection.apiKey, undefined)
  await ai.check('ana', { level: 'team', connection: { name: 'team-model', type: 'openai-compatible', baseUrl: 'http://10.1.1.1/v1/', model: 'other' } })
  assert.equal(checked.at(-1).connection.apiKey, 'sk-TEAM-SECRET')
  // the server's keys are tested in Admin → AI control (ai.keys.test, at the provider's own address)
  await assert.rejects(ai.check('root', { level: 'server', connection: { name: 'ops', type: 'openai-compatible', baseUrl: 'https://attacker.example/v1', model: 'm' } }), /ai\.keys\.test/)
  // the person's own level follows the same rule
  await ai.update('bo', { level: 'me', connections: [{ name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.20/v1', model: 'm', apiKey: 'desk-key-0123456789' }] })
  await ai.check('bo', { level: 'me', connection: { name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.99/v1', model: 'm' } })
  assert.equal(checked.at(-1).connection.apiKey, undefined)
  assert.doesNotMatch(JSON.stringify(checked.filter((c) => !/10\.1\.1\.1|10\.0\.0\.9|192\.168\.1\.20/.test(c.connection.baseUrl))), /SECRET|FILE-KEY|desk-key/)
})

test('L1: saving a connection at a new address needs its key again', async () => {
  const { ai } = service()
  await ai.update('ana', { level: 'me', connections: [{ name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.20/v1', model: 'm', apiKey: 'desk-key-0123456789' }] })
  await assert.rejects(ai.update('ana', { level: 'me', connections: [{ name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.77/v1', model: 'm' }] }), (error) => error.code === 'invalid_request' && /key again/i.test(error.message))
  // an empty key clears it, and the address may then change
  await ai.update('ana', { level: 'me', connections: [{ name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.77/v1', model: 'm', apiKey: '' }] })
  assert.equal((await ai.view('ana')).mine.connections[0].hasKey, false)
})

test('L5: a change that fails validation writes nothing', async () => {
  const { ai, store } = service()
  await ai.update('ana', { level: 'me', connections: [{ name: 'keep', type: 'openai-compatible', baseUrl: 'http://192.168.1.20/v1', model: 'm' }], use: { default: 'me:keep' } })
  const before = JSON.stringify([store.keys, [...store.uses]])
  await assert.rejects(ai.update('ana', { level: 'me', remove: ['keep'], connections: [
    { name: 'good', type: 'openai-compatible', baseUrl: 'http://192.168.1.21/v1', model: 'm' },
    { name: 'bad', type: 'openai-compatible', baseUrl: 'http://169.254.169.254/v1', model: 'm' },
  ] }), { code: 'invalid_request' })
  await assert.rejects(ai.update('ana', { level: 'me', connections: [{ name: 'good', type: 'openai-compatible', baseUrl: 'http://192.168.1.21/v1', model: 'm' }], use: { chat: 'me:missing' } }), { code: 'invalid_request' })
  assert.equal(JSON.stringify([store.keys, [...store.uses]]), before)
  // a choice may name a connection saved in the same change
  await ai.update('ana', { level: 'me', connections: [{ name: 'good', type: 'openai-compatible', baseUrl: 'http://192.168.1.21/v1', model: 'm' }], use: { chat: 'me:good' } })
  assert.equal((await ai.view('ana')).effective.chat.ref, 'me:good')
})

test('H3: every feature that reaches req maps to a model choice, or is named as built-in only', () => {
  assert.equal(choiceFeatureFor('welcome-route'), 'chat', 'the chat edit router is part of conversation and edits')
  // every request feature the call sites send (the old built-in table's names included)
  for (const feature of ['presentation', 'layout', 'vision', 'welcome', 'generation', 'shape', 'library-refine']) {
    assert.ok(choiceFeatureFor(feature), feature)
    assert.equal(choiceFeatureFor(`${feature}-route`), choiceFeatureFor(feature), `${feature}-route`)
  }
  const server = new URL('../web/app/server/', import.meta.url).pathname
  const files = ['methods/openai.js', 'methods/workshops.js', 'methods/canvas-conversation.js', 'methods/presentations.js', 'methods/stabilityai.js',
    'methods/images.js', 'methods/daily.js', 'methods/ai/processConversation.js', 'methods/ai/processScratch.js', 'methods/ai/processTemplateAugment.js']
  const named = new Set()
  for (const file of files) {
    for (const match of readFileSync(join(server, file), 'utf8').matchAll(/feature:\s*(?:map \? )?['"`]([a-z-]+)['"`](?:\s*:\s*['"]([a-z-]+)['"])?/g)) {
      named.add(match[1]); if (match[2]) named.add(match[2])
    }
  }
  for (const feature of ['welcome', 'workshop', 'map-chat', 'lane-chat', 'generation', 'presentation', 'image-generation']) assert.ok(named.has(feature), `scan sees ${feature}`)
  for (const feature of named) {
    assert.ok(choiceFeatureFor(feature) || BUILTIN_ONLY_FEATURES.includes(feature), `${feature} is neither a model choice nor built-in only`)
  }
  // a feature no one listed yet follows the person's conversation choice, never the built-in AI behind their back
  assert.equal(choiceFeatureFor('some-new-feature'), 'chat')
  assert.deepEqual([...BUILTIN_ONLY_FEATURES].sort(), ['call', 'image-search'])
})

test('H3: the router resolves through the person\'s chat choice', async () => {
  const { ai } = service()
  await ai.update('ana', { level: 'me', connections: [{ name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.20/v1', model: 'm' }], use: { chat: 'me:desk' } })
  const routed = await ai.resolveFor({ userId: 'ana', feature: 'welcome-route' })
  assert.equal(routed.ref, 'me:desk')
  assert.equal(routed.own, true)
})

test('M1: a connection answer is read up to a cap, so a huge body cannot exhaust memory', async (t) => {
  const big = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    const chunk = Buffer.alloc(64 * 1024, 32)
    let sent = 0
    const pump = () => { while (sent < 64) { sent++; if (!res.write(chunk)) return res.once('drain', pump) } res.end() }
    pump()
  })
  await new Promise((ok) => big.listen(0, '127.0.0.1', ok))
  t.after(() => big.close())
  const base = `http://127.0.0.1:${big.address().port}/v1`
  const rules = endpointRules({ hosted: false, level: 'server' })
  await assert.rejects(connectionFetch(base, rules, undefined, { maxBytes: 1024 * 1024 })(base + '/models'), /too large/i)
  const small = await connectionFetch(base, rules, undefined, { maxBytes: 8 * 1024 * 1024 })(base + '/models')
  assert.equal((await small.arrayBuffer()).byteLength, 64 * 64 * 1024)
  const { MAX_CONNECTION_RESPONSE_BYTES, MAX_CHECK_RESPONSE_BYTES } = await import('../web/app/server/methods/ai/endpoint-policy.mjs')
  assert.ok(MAX_CONNECTION_RESPONSE_BYTES <= 16 * 1024 * 1024)
  assert.ok(MAX_CHECK_RESPONSE_BYTES <= 2 * 1024 * 1024)
  const glue = source('server/methods/ai/ai-settings.js')
  assert.match(glue, /MAX_CHECK_RESPONSE_BYTES/, 'Test connection reads with the smaller cap')
})

test('M1: an image endpoint gives at most one image, and Test connection is rate limited per person', async (t) => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png')]).toString('base64')
  const stub = await stubServer(t, (req, body, answer) => answer(200, { data: Array.from({ length: 6 }, () => ({ b64_json: png })) }))
  const images = await generateImages({ name: 'art', type: 'openai-compatible', baseUrl: stub.base, model: 'img', capabilities: { images: true } }, { prompt: 'p' }, { fetch })
  assert.equal(images.length, 1)
  const { ai } = service()
  const input = { connection: { name: 'try', type: 'openai-compatible', baseUrl: 'http://192.168.1.21/v1', model: 'n' } }
  let limited = null
  for (let i = 0; i < 40 && !limited; i++) {
    try { await ai.check('ana', input) } catch (error) { limited = error }
  }
  assert.equal(limited?.status, 429)
  assert.equal(limited?.code, 'rate_limited')
  await ai.check('bo', input) // another person is not affected
})

test('M2: an own key saved with a validation error is not used, as before', async () => {
  const { ai, store, master } = service()
  const owner = { ownerType: 'user', ownerId: 'ana' }
  const doc = (provider, extra) => ({ ...owner, provider, cipher: seal({ master, owner: { ...owner, provider }, plaintext: 'bad-key-0123456789' }), last4: last4('bad-key-0123456789'), ...extra })
  store.keys.push(doc('deepinfra', { lastError: 'The provider did not accept this key.' }))
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'generation' })).ref, 'builtin')
  store.keys[0].lastError = null
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'generation' })).ref, 'me:deepinfra')
})

test('M3: an own DeepInfra key saved before choices existed does not take over image generation', async () => {
  const legacyKey = { name: 'deepinfra', type: 'deepinfra', capabilities: {}, legacy: 'all' }
  const picked = resolveAIChoice({ feature: 'images', person: { connections: [legacyKey], use: {} }, team: null, ownProviders: true })
  assert.equal(picked.ref, 'builtin')
  assert.equal(resolveAIChoice({ feature: 'vision', person: { connections: [legacyKey], use: {} }, team: null, ownProviders: true }).ref, 'me:deepinfra')
})

test('M4: a self-host operator may keep people off private networks, separately from the switch', async () => {
  const settings = { public: { env: 'selfhost' }, ai: { privateEndpoints: 'off' } }
  assert.equal(operatorConfig(settings).privateEndpoints, false)
  assert.equal(operatorConfig({ public: { env: 'selfhost' } }).privateEndpoints, true)
  assert.throws(() => operatorConfig({ public: { env: 'selfhost' }, ai: { privateEndpoints: 'maybe' } }), /privateEndpoints/)
  const { ai } = service({ settings })
  await assert.rejects(ai.update('ana', { level: 'me', connections: [{ name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.20/v1', model: 'm' }] }), { code: 'invalid_request' })
  await assert.rejects(ai.check('ana', { connection: { name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.20/v1', model: 'm' } }), { code: 'invalid_request' })
  await ai.update('ana', { level: 'me', connections: [{ name: 'cloud', type: 'openai-compatible', baseUrl: 'https://llm.example.com/v1', model: 'm' }] })
  // the server's own providers (Admin → AI control) keep the server rules
  assert.equal(endpointRules({ hosted: false, level: 'person', privateEndpoints: false }).allow.has('private'), false)
  assert.equal(endpointRules({ hosted: false, level: 'server', privateEndpoints: false }).allow.has('private'), true)
})

test('M5: an agent token changes or tests team and server AI only with the admin permission', async () => {
  assert.ok(API_TOKEN_SCOPES.includes('ai:admin'))
  const calls = []
  const deps = { ai: {
    view: async () => ({ ownProviders: true }),
    update: async (userId, input) => (calls.push(['update', input.level]), { ownProviders: true }),
    check: async (userId, input) => (calls.push(['check', input.level]), { ok: true, reachable: true, tools: 'yes', message: 'ok' }),
  } }
  const registry = createRegistry({ actions: appActions, components: appComponents, scopes: API_TOKEN_SCOPES, deps })
  const agent = { kind: 'agent', userId: 'root', tokenId: 't', scopes: ['ai:settings'] }
  await registry.run(agent, 'ai.update', { level: 'me', use: { chat: 'builtin' } })
  await registry.run(agent, 'ai.check', { name: 'desk' })
  await assert.rejects(registry.run(agent, 'ai.update', { level: 'team', use: { chat: 'builtin' } }), { status: 403 })
  await assert.rejects(registry.run(agent, 'ai.check', { level: 'team', name: 'desk' }), { status: 403 })
  await assert.rejects(registry.run(agent, 'ai.check', { level: 'server', name: 'desk' }), { status: 400 }, 'the server\'s keys are tested with ai.keys.test')
  await assert.rejects(registry.run(agent, 'ai.update', { level: 'server', ownProviders: 'off' }), { status: 403 })
  const admin = { ...agent, scopes: ['ai:settings', 'ai:admin'] }
  await registry.run(admin, 'ai.update', { level: 'server', ownProviders: 'off' })
  await registry.run(admin, 'ai.check', { level: 'team', name: 'desk' })
  assert.deepEqual(calls, [['update', 'me'], ['check', undefined], ['update', 'server'], ['check', 'team']])
  // The token form's permission words now live in one module the consent page shares.
  assert.match(source('imports/ui/components/profile/DeveloperAccess.jsx'), /import \{[^}]*tokenPermissions[^}]*\} from '\.\.\/\.\.\/\.\.\/api\/common\/token-permissions\.mjs'/)
  const labels = source('imports/api/common/token-permissions.mjs')
  assert.match(labels, /ai:admin/)
})

test('L2: a person is not told where the server\'s model lives; an administrator sees which provider it is', async () => {
  const { aiControlWorld } = await import('./ai-control-kit.mjs')
  const w = await aiControlWorld()
  await w.catalog.addProvider({ actor: w.actor, input: { preset: 'other', id: 'box', label: 'Our box', baseUrl: 'https://box.internal.example/v1' } })
  await w.catalog.saveModels({ actor: w.actor, models: [{ provider: 'box', model: 'ops-model', capabilities: { tools: true, vision: false } }] })
  await w.keyStore.add({ actor: w.actor, provider: 'box', apiKey: 'sk-test-box-0000000000000001' })
  await w.bindings.set({ actor: w.actor, changes: [{ surface: 'default', use: 'model', model: 'box:ops-model' }] })
  const resolved = await w.aiSettings.resolveFor({ userId: 'ana', feature: 'vision', request: { images: true } })
  assert.match(resolved.label, /ops-model/)
  assert.doesNotMatch(resolved.label, /box\.internal/)
  assert.doesNotMatch(resolved.gap.message, /box\.internal/)
  assert.match(resolved.gap.message, /Admin → AI control/)
  assert.match((await w.aiSettings.resolveFor({ userId: 'admin1', feature: 'chat' })).label, /Our box/, 'an administrator sees which provider')
  assert.match(source('server/methods/ai/req.js'), /chosen\.label|chosen\?\.label/)
})

test('L3: metadata addresses wrapped in NAT64 or 6to4, and other clouds\' metadata, are refused', () => {
  for (const address of ['192.0.0.192', 'fd20:ce::254', '168.63.129.16', '64:ff9b::a9fe:a9fe', '64:ff9b::169.254.169.254', '2002:a9fe:a9fe::1', '64:ff9b:1::a9fe:a9fe']) {
    assert.equal(addressKind(address), 'metadata', address)
  }
  assert.equal(addressKind('64:ff9b::a00:1'), 'private')
  assert.equal(addressKind('64:ff9b::7f00:1'), 'loopback')
  assert.equal(addressKind('2002:c0a8:0101::1'), 'private')
})

test('L4: an Anthropic request without a key is refused before anything is sent', async () => {
  const { sdkChatRequest } = await import('../web/app/server/methods/ai/sdk-chat.cjs')
  const sent = []
  await assert.rejects(sdkChatRequest({ provider: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages', apiKey: undefined, body: { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
    functions: [], local: true, fetcher: async (...args) => { sent.push(args); throw new Error('sent') } }), /key/i)
  assert.equal(sent.length, 0)
})

test('L6: with own providers off a person can still remove what they saved; account deletion removes it', async () => {
  const { ai, store } = service()
  await ai.update('ana', { level: 'me', connections: [{ name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.20/v1', model: 'm' }], use: { default: 'me:desk' } })
  await ai.update('root', { level: 'server', ownProviders: 'off' })
  await assert.rejects(ai.update('ana', { level: 'me', use: { chat: 'builtin' } }), { code: 'forbidden' })
  await ai.update('ana', { level: 'me', remove: ['desk'] })
  assert.equal(store.keys.filter((k) => k.ownerId === 'ana').length, 0)
  const users = source('server/methods/users.js')
  assert.match(users, /ProviderKeys\.removeAsync\(\{ ownerType: 'user', ownerId: user\._id \}\)/)
  assert.match(users, /AIChoices\.removeAsync/)
})

test('L7: only a real image part makes a request carry images', () => {
  assert.equal(carriesImages([{ role: 'user', content: 'explain what "base64" means' }]), false)
  assert.equal(carriesImages([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGk=' } }] }]), true)
  assert.equal(carriesImages([{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGk=' } }] }]), true)
  assert.match(source('server/methods/ai/req.js'), /carriesImages\(prompts/)
})

test('L8: the settings page can clear a saved key', () => {
  const page = source('imports/ui/components/profile/AISettings.jsx')
  assert.match(page, /clearKey/)
  assert.match(page, /apiKey: ''/)
})
