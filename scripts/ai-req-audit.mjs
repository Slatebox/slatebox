// Runs the real req() (web/app/server/methods/ai/req.js) under plain node, Meteor stubbed, against
// a local stub provider (settings.ai.stubEndpoint, development only), and prints the AIAudit rows
// and requests each scenario produced. scripts/ai-resolve.test.mjs runs it in its own process
// (the module hooks are registered once per process) and checks that every audit row names the
// surface, the connection and the place in the model chain, and what a binding changes.
import { register } from 'node:module'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const TARGETS = ['server/methods/ai/req.js']

export async function run(appRoot) {
  const root = appRoot.replace(/\/+$/, '') + '/'
  register(new URL('./ai-request-golden-hooks.mjs', import.meta.url), { data: { appRoot: root, targets: TARGETS } })

  const sent = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const parsed = JSON.parse(body || '{}')
      sent.push({ model: parsed.model, max_tokens: parsed.max_tokens ?? null })
      if (parsed.model === 'broken-model') {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'upstream exploded' } }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"text":"ok"}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${server.address().port}/v1/chat/completions`

  const audits = []
  let chosen = null
  const Meteor = {
    isDevelopment: true,
    settings: { ai: { stubEndpoint: endpoint, providerInfraRetries: 0 }, deepinfra: { apiKey: 'stub-key' } },
    users: { findOneAsync: async (id) => ({ _id: id, orgId: 'team1' }) },
    userId: () => 'ana',
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

  const pick = (row) => ({ feature: row.feature, surface: row.surface, connection: row.connection, attempt: row.attempt, model: row.model, status: row.status, ...(row.bindingVersion && { bindingVersion: row.bindingVersion }) })
  const out = {}
  const scenario = async (name, options, setChosen = null) => {
    audits.length = 0
    sent.length = 0
    chosen = setChosen
    const result = await req({ prompts: [{ role: 'user', content: 'hi' }], ...options })
    out[name] = { audits: audits.map(pick), sent: [...sent], result: { abort: Boolean(result.abort), abortMessage: result.abortMessage ?? null, model: result.model ?? null, disabled: Boolean(result.disabled), fallbackFrom: result.fallbackFrom?.model ?? null } }
  }

  await scenario('builtin', { feature: 'shape', provider: 'deepinfra', engine: 'good-model' })
  await scenario('requestFeature', { feature: 'lane-chat', provider: 'deepinfra', engine: 'good-model' })
  await scenario('fallback', { feature: 'generation', provider: 'deepinfra', engine: 'broken-model', fallback: { provider: 'deepinfra', engine: 'good-model' } })
  await scenario('gap', { feature: 'vision', provider: 'deepinfra', engine: 'good-model' }, { ref: 'server:muse', scope: 'server', connection: { type: 'openai-compatible', model: 'muse' }, label: 'muse', gap: { need: 'vision', message: 'muse cannot read images.' } })
  const builtinBinding = {
    surface: 'agent.slatebox', enabled: true, bindingVersion: 'agent.slatebox|server@v4',
    chain: [{ connection: 'builtin', provider: 'deepinfra', model: 'broken-model' }, { connection: 'builtin', provider: 'deepinfra', model: 'good-model' }],
    params: { maxTokens: 900, timeoutMs: 90000, infraRetries: 0 },
    provenance: { 'params.maxTokens': 'db:server@v4', 'params.timeoutMs': 'code', 'params.infraRetries': 'db:server@v4' },
  }
  await scenario('binding', { binding: builtinBinding })
  await scenario('bindingOff', { feature: 'shape', binding: { ...builtinBinding, surface: 'shape', enabled: false, disabledMessage: 'Shapes are paused by your administrator.' } })
  server.close()
  return out
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const appRoot = process.argv[2] || new URL('../web/app/', import.meta.url).pathname
  process.stdout.write(JSON.stringify(await run(appRoot), null, 2) + '\n')
}
