// Runs the real req() (web/app/server/methods/ai/req.js) under plain node, Meteor stubbed, with the
// routes an administrator's published binding gives (ai-settings-core.mjs resolveFor: a model chain,
// parameters, tools, or a surface turned off), against local stub providers. It prints what each
// provider received and the aiAudit rows. scripts/ai-bindings.test.mjs runs it in its own process
// (module hooks are registered once per process) and checks:
//   - a fallback is tried only for the failure classes it names (infra, shape, context, any);
//   - an unreachable primary is answered by its fallback on attempt 2, and the audit shows both;
//   - a surface turned off sends nothing and answers with the administrator's message;
//   - parameters (answer size, temperature, shape retries) and allowed tools reach the wire;
//   - a primary that keeps failing trips this pod's breaker for the surface.
import { register } from 'node:module'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const TARGETS = ['server/methods/ai/req.js']

// one stub provider; how it answers is chosen per path: /ok, /fail500, /fail401, /context, /text
function stubServer() {
  const seen = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const url = new URL(request.url, 'http://stub')
      const parsed = JSON.parse(body || '{}')
      const kind = url.pathname.split('/')[1]
      seen.push({ kind, model: parsed.model ?? null, maxTokens: parsed.max_tokens ?? parsed.max_completion_tokens ?? null, temperature: parsed.temperature ?? null, tools: (parsed.tools || []).map((t) => t.function?.name ?? t.name) })
      const json = (status, value) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(value))
      }
      if (kind === 'fail500') return json(500, { error: { message: 'upstream broke' } })
      if (kind === 'fail401') return json(401, { error: { message: 'bad key' } })
      if (kind === 'context') return json(400, { error: { message: 'too long', code: 'context_length_exceeded' } })
      const content = kind === 'text' ? 'not json at all' : '{"text":"ok"}'
      return json(200, { id: 'x', object: 'chat.completion', created: 1, model: parsed.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
    })
  })
  return { server, seen }
}

export async function run(appRoot) {
  const root = appRoot.replace(/\/+$/, '') + '/'
  register(new URL('./ai-request-golden-hooks.mjs', import.meta.url), { data: { appRoot: root, targets: TARGETS } })
  const stub = stubServer()
  await new Promise((resolve) => stub.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${stub.server.address().port}`
  const { endpointRules } = await import(pathToFileURL(root + 'server/methods/ai/endpoint-policy.mjs').href)
  const { requestBreaker } = await import(pathToFileURL(root + 'server/ai-control/breaker.mjs').href)

  const audits = []
  let route = null
  const Meteor = {
    isDevelopment: true,
    settings: { ai: { providerInfraRetries: 0 } },
    users: { findOneAsync: async (id) => ({ _id: id }) },
    userId: () => 'root',
  }
  const stubs = {
    'meteor/meteor': { Meteor },
    'meteor/random': { Random: { id: () => `r${audits.length}${Math.random().toString(36).slice(2, 8)}` } },
    'imports/api/common/models': { AIAudit: { insertAsync: async (row) => { audits.push(row) } } },
    'server/metering/context': { aiRequestGate: () => null, chargeProviderCall: async () => ({ stop: false }), currentAIAction: () => null },
    'server/methods/ai/ai-settings': { resolveRequestConnection: async () => route },
    'imports/api/common/utils': { default: { isJSON: (text) => { try { JSON.parse(text); return true } catch { return false } } } },
  }
  globalThis.__aiGoldenStub = (key) => stubs[key] || {}
  const { default: req, failureClass } = await import(pathToFileURL(root + TARGETS[0]).href)
  // req.js logs to stdout; this script's stdout is its JSON answer
  const log = console.log
  console.log = () => {}

  // self-hosted settings-file rules: a loopback stub is allowed (no redirects are followed)
  const rules = endpointRules({ hosted: false, level: 'file' })
  const entry = (name, path, on, model = `${name}-model`) => ({
    ref: `server:${name}`, scope: 'server', own: false, feature: 'shape', rules, label: `${model} at stub`, on,
    connection: { name, type: 'openai-compatible', baseUrl: path.startsWith('http') ? path : `${base}/${path}/v1`, model, apiKey: 'k-test-0000', capabilities: { tools: true }, source: 'app' },
  })
  const control = (extra = {}) => ({ surface: 'shape', bindingVersion: 'shape|server@v3', params: {}, tools: { mode: null, allow: null }, ...extra })
  const chainRoute = (chain, extra) => ({ ...chain[0], chain, control: control(extra) })
  const pick = (row) => ({ surface: row.surface, connection: row.connection, attempt: row.attempt, model: row.engine ?? row.model, status: row.status, bindingVersion: row.bindingVersion ?? null })
  const out = {}
  const scenario = async (name, setRoute, request = {}) => {
    audits.length = 0
    stub.seen.length = 0
    route = setRoute
    const result = await req({ feature: 'shape', prompts: [{ role: 'user', content: 'draw a cat' }], ...request })
    out[name] = {
      audits: audits.map(pick), seen: stub.seen.map((s) => ({ ...s })),
      result: { abort: Boolean(result?.abort), message: result?.abortMessage ?? null, model: result?.model ?? null, failure: failureClass(result), fallbackFrom: result?.fallbackFrom?.model ?? null, disabled: Boolean(result?.disabled) },
    }
  }

  await scenario('fallbackInfra', chainRoute([entry('bad', 'fail500'), entry('good', 'ok', ['infra'])]))
  // nothing listens on port 9 of the loopback: the primary cannot be reached at all
  await scenario('unreachable', chainRoute([entry('gone', 'http://127.0.0.1:9/v1'), entry('good', 'ok', ['infra'])]))
  await scenario('notForInfra', chainRoute([entry('bad', 'fail500'), entry('good', 'ok', ['shape'])]))
  await scenario('context', chainRoute([entry('small', 'context'), entry('big', 'ok', ['context'])]))
  await scenario('otherSkipsInfra', chainRoute([entry('keyless', 'fail401'), entry('good', 'ok', ['infra'])]))
  await scenario('otherAny', chainRoute([entry('keyless', 'fail401'), entry('good', 'ok', ['any'])]))
  await scenario('skipsToMatching', chainRoute([entry('bad', 'fail500'), entry('shapeonly', 'ok', ['shape']), entry('good', 'ok', ['infra'])]))
  // answers that are never JSON: shape, after shapeRetries tries (one here)
  await scenario('shape', chainRoute([entry('chatty', 'text'), entry('good', 'ok', ['shape'])], { params: { shapeRetries: 1 } }))
  await scenario('disabled', { ref: 'disabled', scope: 'disabled', connection: null, disabled: true, message: 'Drawing shapes is paused by your administrator.', control: control() })
  await scenario('params', chainRoute([entry('good', 'ok')], { params: { maxTokens: 123, temperature: 0.3 } }), { maxTokens: 6000 })
  const functions = [
    { name: 'propose_shapes', description: 'shapes', parameters: { type: 'object', properties: {} } },
    { name: 'other_tool', description: 'other', parameters: { type: 'object', properties: {} } },
  ]
  await scenario('toolsAllow', chainRoute([entry('good', 'ok')], { tools: { mode: null, allow: ['propose_shapes'] } }), { functions, allowPlainText: true })
  await scenario('toolsNone', chainRoute([entry('good', 'ok')], { tools: { mode: null, allow: ['nothing_here'] } }), { functions, allowPlainText: true })

  // a primary that always fails: after enough calls the breaker opens for the surface on this pod
  requestBreaker.reset()
  for (let i = 0; i < 10; i += 1) {
    route = chainRoute([entry('bad', 'fail500'), entry('good', 'ok', ['infra'])])
    await req({ feature: 'shape', prompts: [{ role: 'user', content: 'draw' }] })
  }
  out.breaker = { open: Boolean(requestBreaker.isOpen('shape')), health: requestBreaker.health().map((h) => ({ kind: h.kind, id: h.id, bindingVersion: h.bindingVersion })) }
  stub.server.close()
  console.log = log
  return out
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const appRoot = process.argv[2] || new URL('../web/app/', import.meta.url).pathname
  process.stdout.write(JSON.stringify(await run(appRoot), null, 2) + '\n')
}
