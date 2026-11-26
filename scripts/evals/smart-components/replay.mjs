// The builder's real server path under plain node, the model replaced by recorded answers: native-conversation.js
// (nativeCanvas.preview, the free-form branch), workshops.js (workshops.draft) and req.js (the request, the answer's
// normalization, the feature's check and its one retry) run as they are; Meteor, the database, the meter and the
// slate lookup are stubbed (ai-request-golden-hooks.mjs). The answers come from a local stub of an OpenAI-compatible
// endpoint (tool choice auto, as Meta's Model API takes), one recorded answer per request, in order.
//
// A module of its own: module hooks register once per process (node --test runs each test file in its own).
import { register } from 'node:module'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const TARGETS = ['server/methods/native-conversation.js', 'server/methods/workshops.js', 'server/methods/ai/req.js']

/** A recorded answer as an OpenAI chat completion: { args } a tool call (an object, or text as sent), { text } words only. */
export function completion(answer, model = 'recorded-model') {
  const message = answer.args !== undefined
    ? { role: 'assistant', content: answer.text ?? null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: answer.name ?? 'draft_workshop', arguments: typeof answer.args === 'string' ? answer.args : JSON.stringify(answer.args) } }] }
    : { role: 'assistant', content: answer.text ?? '' }
  return { id: 'r', object: 'chat.completion', created: 1, model, choices: [{ index: 0, finish_reason: answer.args !== undefined ? 'tool_calls' : 'stop', message }], usage: { prompt_tokens: 1200, completion_tokens: 900, total_tokens: 2100 } }
}

export async function startReplay(appRoot = new URL('../../../web/app/', import.meta.url).pathname) {
  const root = appRoot.replace(/\/+$/, '') + '/'
  register(new URL('../../ai-request-golden-hooks.mjs', import.meta.url), { data: { appRoot: root, targets: TARGETS } })

  // The stub endpoint: each request takes the next recorded answer; what it was sent is kept.
  let queue = []
  const sent = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const json = JSON.parse(body || '{}')
      sent.push(json)
      const answer = queue.shift()
      if (!answer) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'no recorded answer left' } }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(completion(answer, json.model)))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/v1`

  const { endpointRules } = await import(pathToFileURL(root + 'server/methods/ai/endpoint-policy.mjs').href)
  const rules = endpointRules({ hosted: false, level: 'server' })
  const route = {
    ref: 'server:recorded', scope: 'server', own: false, feature: 'workshop', surface: 'workshop.draft', provider: 'recorded', modelId: 'recorded:recorded-model', rules, label: 'recorded-model',
    connection: { name: 'recorded', type: 'openai-compatible', baseUrl: base, model: 'recorded-model', apiKey: 'sk-recorded', capabilities: { tools: true }, toolChoice: 'auto' },
  }

  class MeteorError extends Error {
    constructor(error, reason, details) {
      super(reason || String(error))
      this.error = error
      this.reason = reason
      this.details = details
    }
  }
  const methods = {}
  const state = { user: null, slate: null, locked: false, audits: [], warnings: [] }
  const context = () => ({ userId: state.user?._id ?? null, connection: state.connection })
  const Meteor = {
    Error: MeteorError,
    isDevelopment: true,
    isServer: true,
    settings: { ai: { providerInfraRetries: 0 }, public: {} },
    methods: (map) => Object.assign(methods, map),
    callAsync: (name, ...params) => methods[name].apply(context(), params),
    userAsync: async () => state.user,
    userId: () => state.user?._id ?? null,
    startup: () => {},
    users: {
      findOneAsync: async () => state.user,
      // the one-draft-a-minute lock: acquired unless a case says it is held
      updateAsync: async () => (state.locked ? 0 : 1),
    },
  }
  const stubs = {
    'meteor/meteor': { Meteor },
    'meteor/random': { Random: { id: () => Array.from({ length: 17 }, () => 'ABCDEFGHJKLMNPQRSTWXYZabcdefghijkmnopqrstuvwxyz23456789'[Math.floor(Math.random() * 55)]).join('') } },
    'imports/api/common/models': { AIAudit: { insertAsync: async (row) => { state.audits.push(row) } }, Slates: {}, LibraryItems: {} },
    'imports/api/common/workshopRooms': { WorkshopRooms: {} },
    'imports/api/common/constants': { default: {} },
    'imports/api/common/utils': { default: { isJSON: (item) => { try { const parsed = JSON.parse(typeof item === 'string' ? item : JSON.stringify(item)); return Boolean(parsed) && typeof parsed === 'object' } catch { return false } } } },
    'server/methods/creative-slates': {
      resolvePresentationSlate: async () => ({ canEdit: true, slateBase: state.slate }),
      resolveCreativeSlate: async () => ({ canEdit: true, slateBase: state.slate }),
    },
    'server/metering/context': { runAIAction: (_, run) => (state.refuse ? Promise.reject(new MeteorError(state.refuse.error, state.refuse.reason, state.refuse.details)) : run()), aiRequestGate: () => null, chargeProviderCall: async () => ({ stop: false }), currentAIAction: () => null },
    'server/metering/meteor': { canStartAI: async (user) => Boolean(user && !user.isAnonymous && !state.noAI) },
    'server/methods/ai/ai-settings': { surfaceOffFor: async () => state.off ?? null, resolveRequestConnection: async () => route },
  }
  globalThis.__aiGoldenStub = (key) => stubs[key] || {}
  await import(pathToFileURL(root + TARGETS[1]).href)
  await import(pathToFileURL(root + TARGETS[0]).href)
  const quiet = console.warn
  console.warn = (...line) => { state.warnings.push(line.join(' ')) }

  return {
    methods,
    /**
     * One builder turn: `message` typed on an empty builder slate by a signed-in person (or `as: 'guest'`, or with no
     * agent: `noAI`; the draft lock held: `locked`; the part turned off: `off`; the meter refusing: `refuse`), the model answering with `answers` in order. → { preview | error, sent (the requests the
     * endpoint got), audits, warnings, left (answers never asked for) }
     */
    async turn(message, answers = [], { as = 'person', noAI = false, locked = false, off = null, refuse = null } = {}) {
      queue = [...answers]
      sent.length = 0
      state.audits = []
      state.warnings = []
      state.connection = {}
      state.locked = locked
      state.noAI = noAI
      state.off = off
      state.refuse = refuse
      state.user = { _id: 'ada', isAnonymous: as === 'guest', profile: {} }
      state.slate = { _id: 'slate1', shareId: 'build1', userId: 'ada', library: { mode: 'build' }, nodes: [], options: {} }
      try {
        const preview = await Meteor.callAsync('nativeCanvas.preview', 'build1', message, [], null)
        return { preview, sent: [...sent], audits: state.audits, warnings: state.warnings, left: queue.length }
      } catch (error) {
        return { error, sent: [...sent], audits: state.audits, warnings: state.warnings, left: queue.length }
      }
    },
    /** One workshops.draft call by a signed-in person (any format), the model answering with `answers` in order. */
    async draft(brief, format, answers = []) {
      queue = [...answers]
      sent.length = 0
      Object.assign(state, { audits: [], warnings: [], connection: {}, locked: false, noAI: false, off: null, refuse: null })
      state.user = { _id: 'ada', isAnonymous: false, profile: {} }
      try {
        return { result: await Meteor.callAsync('workshops.draft', brief, format), sent: [...sent], left: queue.length }
      } catch (error) {
        return { error, sent: [...sent], left: queue.length }
      }
    },
    close() {
      console.warn = quiet
      server.close()
    },
  }
}
