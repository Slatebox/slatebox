// The AI control resolver (web/app/server/ai-control/resolve.mjs) over a snapshot
// (snapshot.mjs), the aiControl facade (facade.mjs) and what a binding changes in a request
// (request-binding.mjs). The contract of this slice: with no DB documents, every surface resolves
// exactly as the AI settings do today, for someone not signed in, a person and a Pro person.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { SURFACES, surface as surfaceById } from '../web/app/server/ai-control/catalogue.mjs'
import { CODE_PARAMS, primaryOf, resolveBinding, toSurface } from '../web/app/server/ai-control/resolve.mjs'
import {
  EMPTY_SNAPSHOT, buildSnapshot, createSnapshotHolder, emptySnapshot, fileDbLayer, scopeKey,
} from '../web/app/server/ai-control/snapshot.mjs'
import { createAIControl } from '../web/app/server/ai-control/facade.mjs'
import { requestOptionsFromBinding } from '../web/app/server/ai-control/request-binding.mjs'
import { createAISettings } from '../web/app/server/methods/ai/ai-settings-core.mjs'
import { resolveSurfaceFeatureConfig } from '../web/app/server/methods/ai/feature-config.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'

// ---------- fixtures ----------
function memoryStore() {
  const keys = [], uses = new Map()
  const match = (owner) => (doc) => doc.ownerType === owner.type && doc.ownerId === owner.id
  return {
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
    async getUse(owner) { return uses.get(`${owner.type}:${owner.id}`) ?? null },
    async setUse(owner, value) { uses.set(`${owner.type}:${owner.id}`, value) },
  }
}

const PEOPLE = {
  ana: { _id: 'ana', orgId: 'team1' },
  pro: { _id: 'pro', orgId: null, pro: true },
  root: { _id: 'root' },
}

function service(settings = {}, { hosted = false } = {}) {
  const store = memoryStore()
  const master = loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
  const ai = createAISettings({
    store, master, settings, hosted,
    loadUser: async (id) => PEOPLE[id] || null,
    isAdmin: async (id) => id === 'root',
    isTeamAdmin: async (user) => user?._id === 'ana',
    check: async () => ({ ok: true, message: 'ok' }),
    assertHost: async () => {},
    env: { MUSE_KEY: 'k-file' },
  })
  return { ai, store }
}

const fixedHolder = (snapshot) => ({ ready: async () => snapshot, current: () => snapshot, refresh: async () => snapshot })
const BINDABLE = SURFACES.filter((s) => s.useKey && s.inBuild && s.id !== 'default').map((s) => s.id)

// What today's request path sends for a surface: the chosen connection (ai-settings resolveFor),
// else the built-in provider and model the call site takes (ai-defaults via builtinFrom).
async function today(ai, settings, surfaceId, userId) {
  const chosen = await ai.resolveFor({ userId, feature: surfaceId })
  if (chosen.connection) return { connection: chosen.ref, provider: chosen.connection.type, model: chosen.connection.model ?? null }
  if (surfaceById(surfaceId).builtinFrom === 'stability' || surfaceId === 'images') return { connection: 'builtin', provider: 'stabilityai', model: 'stable-diffusion-v1-6' }
  const config = resolveSurfaceFeatureConfig(surfaceId, settings)
  return { connection: 'builtin', provider: config.provider, model: config.engine }
}

async function compareAll(settings, setup = async () => {}, { hosted = false } = {}) {
  const { ai } = service(settings, { hosted })
  await setup(ai)
  const control = createAIControl({ holder: fixedHolder(EMPTY_SNAPSHOT), choiceHolders: (id) => ai.choiceHolders(id), settings })
  let compared = 0
  for (const userId of [null, 'ana', 'pro']) {
    for (const surfaceId of BINDABLE) {
      const binding = await control.bind({ surface: surfaceId, userId, plan: userId === 'pro' ? 'pro' : null })
      assert.deepEqual(primaryOf(binding), await today(ai, settings, surfaceId, userId), `${surfaceId} for ${userId}`)
      assert.equal(binding.enabled, true)
      compared += 1
    }
  }
  return compared
}

// ---------- the contract: empty DB layer = today ----------
test('with no DB documents every surface resolves as the AI settings do today (anon, person, Pro)', async () => {
  // built-in only
  assert.equal(await compareAll({}), BINDABLE.length * 3)
  // the settings file names a connection for chat and builtin for shape; its own feature model for generation
  const fileSettings = {
    public: { env: 'selfhost' },
    ai: {
      connections: { muse: { type: 'openai-compatible', baseUrl: 'https://muse.example.com/v1', model: 'muse-ember-1.0', apiKeyEnv: 'MUSE_KEY' } },
      use: { chat: 'muse', shape: 'builtin' },
      features: { generation: { provider: 'deepinfra', engine: 'some/other-model' } },
    },
  }
  await compareAll(fileSettings)
  // an administrator's choices in the app, plus a person's and a team's own choices (self-host)
  await compareAll(fileSettings, async (ai) => {
    await ai.update('root', { level: 'server', connections: [{ name: 'deck', type: 'openai-compatible', baseUrl: 'https://deck.example.com/v1', model: 'deck-1' }], use: { presentation: 'server:deck', 'agent.slatebox': 'server:deck', workshop: 'builtin' } })
    await ai.update('ana', { level: 'me', connections: [{ name: 'desk', type: 'openai-compatible', baseUrl: 'https://desk.example.com/v1', model: 'desk-7b' }], use: { canvas: 'me:desk' } })
    await ai.update('ana', { level: 'team', connections: [{ name: 'team-model', type: 'openai-compatible', baseUrl: 'https://team.example.com/v1', model: 't-1' }], use: { default: 'team:team-model' } })
  })
  // hosted (Cloud): own providers locked off, only the server's choices count
  await compareAll({ ai: { connections: { muse: { type: 'openai-compatible', baseUrl: 'https://muse.example.com/v1', model: 'muse-ember-1.0' } }, use: { default: 'muse' } } }, async () => {}, { hosted: true })
})

test('provenance says where each part came from; followed names the surface whose choice applied', async () => {
  const settings = { public: { env: 'selfhost' }, ai: { connections: { muse: { type: 'openai-compatible', baseUrl: 'https://muse.example.com/v1', model: 'm' } }, use: { chat: 'muse' }, requestTimeoutMs: 30000 } }
  const { ai } = service(settings)
  await ai.update('root', { level: 'server', use: { shape: 'builtin' } })
  const control = createAIControl({ holder: fixedHolder(EMPTY_SNAPSHOT), choiceHolders: (id) => ai.choiceHolders(id), settings })
  const agent = await control.bind({ surface: 'agent.slatebox' })
  assert.equal(agent.provenance.chain, 'file')
  assert.equal(agent.followed, 'chat')
  assert.equal(agent.params.timeoutMs, 30000)
  assert.equal(agent.provenance['params.timeoutMs'], 'file')
  assert.equal(agent.params.infraRetries, CODE_PARAMS.infraRetries)
  assert.equal(agent.provenance['params.infraRetries'], 'code')
  const shape = await control.bind({ surface: 'shape' })
  assert.equal(shape.provenance.chain, 'db:server:choice')
  const generation = await control.bind({ surface: 'generation' })
  assert.equal(generation.provenance.chain, 'code')
  // a built-in fallback keeps fallback after a malformed answer only for drafting and vision
  assert.deepEqual(generation.chain.map((c) => c.on), [['any'], ['infra', 'shape']])
  assert.deepEqual((await control.bind({ surface: 'shape' })).chain.map((c) => c.on), [['any'], ['infra']])
  // request features name their surface; built-in-only paths have no binding to choose
  assert.equal((await control.bind({ surface: 'lane-chat' })).surface, 'workshop')
  assert.equal(toSurface('images.search'), null)
  assert.equal((await control.bind({ surface: 'image-search' })).builtinOnly, true)
  // limits come from the catalogue
  assert.deepEqual((await control.bind({ surface: 'generation' })).limits, { estimate: 30000, ceiling: 200000 })
})

// ---------- DB bindings ----------
const MODELS = [
  { _id: 'muse:muse-ember-1.0', connection: 'server:muse', model: 'muse-ember-1.0', capabilities: { tools: true, vision: false }, status: 'enabled' },
  { _id: 'builtin:deepinfra:Qwen/Qwen3-235B-A22B-Instruct-2507', connection: 'builtin:deepinfra', model: 'Qwen/Qwen3-235B-A22B-Instruct-2507', capabilities: { tools: true }, status: 'enabled' },
  { _id: 'muse:muse-mini', connection: 'server:muse', model: 'muse-mini', capabilities: { tools: true }, status: 'disabled' },
]
const FILE = { public: { env: 'selfhost' }, ai: { connections: { muse: { type: 'openai-compatible', baseUrl: 'https://muse.example.com/v1', model: 'muse-ember-1.0' } } } }
const binding = (surface, scope, extra = {}) => ({ _id: `${surface}|${scopeKey(scope)}`, surface, scope, status: 'published', version: 3, ...extra })
const snap = (raw) => buildSnapshot({ state: { generation: 7 }, models: MODELS, ...raw }, { fileConnections: ['muse'] })

async function controlFor(snapshot, settings = FILE, setup = async () => {}, innerBindings) {
  const { ai } = service(settings)
  await setup(ai)
  return createAIControl({ holder: fixedHolder(snapshot), choiceHolders: (id) => ai.choiceHolders(id), settings, innerBindings })
}

test('a published binding for the agent changes the agent only; what follows it inherits', async () => {
  const s = snap({ bindings: [binding('agent.slatebox', { level: 'server' }, { chain: [{ model: 'muse:muse-ember-1.0' }, { model: 'builtin:deepinfra:Qwen/Qwen3-235B-A22B-Instruct-2507', on: ['infra', 'shape'] }] })] })
  assert.deepEqual(s.health, [])
  const control = await controlFor(s)
  const agent = await control.bind({ surface: 'agent.slatebox', userId: 'ana' })
  assert.deepEqual(primaryOf(agent), { connection: 'server:muse', provider: 'openai-compatible', model: 'muse-ember-1.0' })
  assert.equal(agent.chain[1].connection, 'builtin')
  assert.deepEqual(agent.chain[1].on, ['infra', 'shape'])
  assert.equal(agent.provenance.chain, 'db:server@v3')
  assert.equal(agent.bindingVersion, 'agent.slatebox|server@v3')
  assert.equal(agent.followed, null)
  // chat and canvas are untouched
  assert.equal(primaryOf(await control.bind({ surface: 'chat' })).connection, 'builtin')
  assert.equal(primaryOf(await control.bind({ surface: 'canvas' })).connection, 'builtin')
  // a binding on canvas reaches the agent through follows
  const viaCanvas = await controlFor(snap({ bindings: [binding('canvas', { level: 'server' }, { chain: [{ model: 'muse:muse-ember-1.0' }] })] }))
  const followed = await viaCanvas.bind({ surface: 'agent.slatebox' })
  assert.equal(followed.followed, 'canvas')
  assert.equal(primaryOf(followed).model, 'muse-ember-1.0')
  // a binding wins over an AI settings choice for the same surface
  const over = await controlFor(snap({ bindings: [binding('chat', { level: 'server' }, { chain: [{ model: 'builtin:deepinfra:Qwen/Qwen3-235B-A22B-Instruct-2507' }] })] }), { ...FILE, ai: { ...FILE.ai, use: { chat: 'muse' } } })
  assert.equal(primaryOf(await over.bind({ surface: 'chat' })).connection, 'builtin')
})

test('scopes: the innermost chain wins, enabled is AND, team and person apply only with own providers', async () => {
  const s = snap({
    bindings: [
      binding('chat', { level: 'server' }, { chain: [{ model: 'muse:muse-ember-1.0' }], enabled: true, params: { maxTokens: 4000 } }),
      binding('chat', { level: 'plan', id: 'pro' }, { params: { maxTokens: 2000 } }),
      binding('chat', { level: 'team', id: 'team1' }, { enabled: false, disabledMessage: 'Your team turned chat off.' }),
      binding('chat', { level: 'me', id: 'pro' }, { chain: [{ model: 'builtin:deepinfra:Qwen/Qwen3-235B-A22B-Instruct-2507' }], enabled: true }),
    ],
  })
  assert.deepEqual(s.health, [])
  const control = await controlFor(s)
  const ana = await control.bind({ surface: 'chat', userId: 'ana' })
  assert.equal(ana.enabled, false)
  assert.equal(ana.disabledMessage, 'Your team turned chat off.')
  assert.equal(ana.provenance.enabled, 'db:team@v3')
  const pro = await control.bind({ surface: 'chat', userId: 'pro', plan: 'pro' })
  assert.equal(pro.enabled, true)
  assert.equal(primaryOf(pro).connection, 'builtin')
  assert.equal(pro.provenance.chain, 'db:me@v3')
  assert.equal(pro.params.maxTokens, 2000)
  assert.equal(pro.provenance['params.maxTokens'], 'db:plan@v3')
  const anon = await control.bind({ surface: 'chat' })
  assert.equal(primaryOf(anon).connection, 'server:muse')
  assert.equal(anon.params.maxTokens, 4000)
  // own providers off (Cloud): team and person bindings are not read
  const hostedControl = await controlFor(s, { ai: FILE.ai })
  const { ai } = service({ ai: FILE.ai }, { hosted: true })
  const cloud = createAIControl({ holder: fixedHolder(s), choiceHolders: (id) => ai.choiceHolders(id), settings: { ai: FILE.ai } })
  assert.equal((await cloud.bind({ surface: 'chat', userId: 'ana' })).enabled, true)
  assert.equal(primaryOf(await cloud.bind({ surface: 'chat', userId: 'pro' })).connection, 'server:muse')
  assert.ok(hostedControl)
  // per-request team and person bindings (not in the snapshot) are read through innerBindings
  const perRequest = await controlFor(snap({}), FILE, async () => {}, async (userId) => (userId === 'ana' ? { me: { shape: binding('shape', { level: 'me', id: 'ana' }, { enabled: false }) } } : null))
  assert.equal((await perRequest.bind({ surface: 'shape', userId: 'ana' })).enabled, false)
  assert.equal((await perRequest.bind({ surface: 'shape', userId: 'pro' })).enabled, true)
})

test('the global switch turns every surface off with its message', async () => {
  const control = await controlFor(snap({ state: { generation: 9, aiEnabled: false, aiDisabledMessage: 'AI is paused for maintenance.' } }))
  const b = await control.bind({ surface: 'shape' })
  assert.equal(b.enabled, false)
  assert.equal(b.disabledMessage, 'AI is paused for maintenance.')
  assert.equal(b.provenance.enabled, 'db:global')
})

test('Off follows the follows chain: a part with no binding of its own takes its parent\'s Off and message; its own binding wins', async () => {
  const chatOff = binding('chat', { level: 'server' }, { enabled: false, disabledMessage: 'Ask Slatebox is paused for an upgrade.' })
  const control = await controlFor(snap({ bindings: [chatOff] }))
  // canvas follows chat, the agent follows canvas, a board's conversation follows chat
  for (const surface of ['canvas', 'agent.slatebox', 'workshop', 'workshop.draft', 'chat.route', 'library']) {
    const b = await control.bind({ surface, userId: 'ana' })
    assert.deepEqual([b.enabled, b.disabledMessage, b.disabledBy, b.provenance.enabled], [false, 'Ask Slatebox is paused for an upgrade.', 'chat', 'db:server@v3'], surface)
  }
  const chat = await control.bind({ surface: 'chat' })
  assert.deepEqual([chat.enabled, chat.disabledBy], [false, null])
  // parts that do not follow chat stay on
  for (const surface of ['generation', 'shape', 'vision', 'presentation']) assert.equal((await control.bind({ surface })).enabled, true, surface)
  // the request path refuses a following part with the parent's message
  assert.equal(requestOptionsFromBinding({ binding: await control.bind({ surface: 'canvas' }) }).refusal.abortMessage, 'Ask Slatebox is paused for an upgrade.')
  // a parent turned off with no message of its own: its title names it
  const quiet = await controlFor(snap({ bindings: [binding('chat', { level: 'server' }, { enabled: false })] }))
  assert.equal((await quiet.bind({ surface: 'canvas' })).disabledMessage, 'Conversation and edits is turned off by your administrator.')
  // a part's own binding wins: canvas bound (on) answers while chat is off; the agent follows canvas, so it is on too
  const own = await controlFor(snap({ bindings: [chatOff, binding('canvas', { level: 'server' }, { enabled: true, chain: [{ model: 'muse:muse-ember-1.0' }] })] }))
  assert.deepEqual([(await own.bind({ surface: 'canvas' })).enabled, (await own.bind({ surface: 'agent.slatebox' })).enabled, (await own.bind({ surface: 'workshop' })).enabled], [true, true, false])
  // and its own Off is its own (not "follows")
  const both = await controlFor(snap({ bindings: [chatOff, binding('canvas', { level: 'server' }, { enabled: false, disabledMessage: 'Drawing chat is paused.' })] }))
  const canvas = await both.bind({ surface: 'canvas' })
  assert.deepEqual([canvas.enabled, canvas.disabledMessage, canvas.disabledBy], [false, 'Drawing chat is paused.', null])
  // the global switch still comes first
  const global = await controlFor(snap({ state: { generation: 9, aiEnabled: false, aiDisabledMessage: 'All AI is paused.' }, bindings: [chatOff] }))
  const g = await global.bind({ surface: 'canvas' })
  assert.deepEqual([g.enabled, g.disabledMessage, g.disabledBy, g.provenance.enabled], [false, 'All AI is paused.', null, 'db:global'])
})

test('limits and allowed tools only tighten', async () => {
  const s = snap({
    bindings: [
      binding('chat', { level: 'server' }, { limits: { ceiling: 40000 }, tools: { mode: 'forced', allow: ['setIntention', 'previewTemplate', 'expandTemplates'] } }),
      binding('chat', { level: 'plan', id: 'free' }, { limits: { ceiling: 30000, estimate: 9000 }, tools: { allow: ['setIntention', 'expandTemplates', 'exec'] } }),
      binding('shape', { level: 'server' }, { limits: { ceiling: 90000 } }),
    ],
  })
  const control = await controlFor(s)
  const free = await control.bind({ surface: 'chat', plan: 'free' })
  assert.deepEqual(free.limits, { estimate: 2000, ceiling: 30000 })
  assert.equal(free.provenance['limits.ceiling'], 'db:plan@v3')
  assert.equal(free.provenance['limits.estimate'], 'code')
  assert.deepEqual(free.tools, { mode: 'forced', allow: ['setIntention', 'expandTemplates'] })
  // a higher limit than the catalogue's never widens it
  assert.deepEqual((await control.bind({ surface: 'shape' })).limits, { estimate: 8000, ceiling: 60000 })
  // nothing set: code decides the tools
  assert.deepEqual((await control.bind({ surface: 'generation' })).tools, { mode: null, allow: null })
})

test('a document that fails its checks is skipped, named in health, and the surface falls through', async () => {
  const s = snap({
    models: [...MODELS, { _id: 'ghost:x', connection: 'server:ghost', model: 'x' }, { _id: 'muse:blind', connection: 'server:muse', model: 'blind', capabilities: { vision: false } }],
    bindings: [
      binding('chat', { level: 'server' }, { chain: [{ model: 'ghost:x' }] }),
      binding('shape', { level: 'server' }, { chain: [{ model: 'muse:muse-mini' }] }),
      binding('vision', { level: 'server' }, { chain: [{ model: 'muse:blind' }] }),
      { ...binding('generation', { level: 'server' }), _id: 'generation|wrong' },
      binding('nope', { level: 'server' }),
      binding('presentation', { level: 'team', id: 't' }, { params: { maxTokens: 10 } }),
      binding('workshop', { level: 'server' }, { prompts: { system: 'no.such.prompt' } }),
    ],
    providers: [{ _id: 'gemini', protocol: 'grpc' }],
    prompts: [{ _id: 'shape.system', labels: { published: 2 } }],
  })
  const problems = Object.fromEntries(s.health.map((h) => [`${h.kind}:${h.id}`, h.problem]))
  assert.match(problems['model:ghost:x'], /connection server:ghost does not exist/)
  assert.match(problems['binding:chat|server'], /model ghost:x does not exist/)
  assert.match(problems['binding:shape|server'], /disabled/)
  assert.match(problems['binding:vision|server'], /cannot do vision/)
  assert.match(problems['binding:generation|wrong'], /should be generation\|server/)
  assert.match(problems['binding:nope|server'], /not a surface/)
  assert.match(problems['binding:presentation|team:t'], /only its models and on\/off/)
  assert.match(problems['binding:workshop|server'], /prompt no.such.prompt does not exist/)
  assert.match(problems['provider:gemini'], /grpc/)
  assert.match(problems['prompt:shape.system'], /published version 2 is missing/)
  assert.equal(Object.keys(s.bindings).length, 0)
  const control = await controlFor(s)
  // chat falls through to today's resolution
  assert.equal(primaryOf(await control.bind({ surface: 'chat' })).connection, 'builtin')
  assert.equal(control.health().length, s.health.length)
})

test('prompts: a slot reads the published version, a pinned version, or the built-in text', async () => {
  const s = snap({
    prompts: [{ _id: 'shape.system', surface: 'shape', kind: 'system', labels: { published: 2 } }],
    promptVersions: [
      { _id: 'shape.system@1', promptId: 'shape.system', version: 1, body: 'v1 {{count}}', variables: { count: { type: 'integer' } } },
      { _id: 'shape.system@2', promptId: 'shape.system', version: 2, body: 'v2 {{count}}', variables: { count: { type: 'integer' } } },
    ],
    bindings: [binding('shape', { level: 'plan', id: 'pro' }, { prompts: { system: 'shape.system@1' } })],
  })
  assert.deepEqual(s.health, [])
  assert.ok(s.promptVersions['shape.system@1'], 'a pinned version is kept in the snapshot')
  const { ai } = service(FILE)
  const codePrompts = { 'shape.system': { body: 'v0 {{count}}', variables: { count: { type: 'integer' } } }, 'shape.retry': { body: 'retry' } }
  const codeSlots = { shape: { system: 'shape.system', retry: 'shape.retry' } }
  const control = createAIControl({ holder: fixedHolder(s), choiceHolders: (id) => ai.choiceHolders(id), settings: FILE, codePrompts, codeSlots })
  const free = await control.bind({ surface: 'shape' })
  assert.equal(control.render(free.prompts.system, { count: 4 }), 'v2 4')
  assert.equal(free.prompts.system.version, 2)
  assert.equal(free.prompts.retry.version, 0)
  assert.equal(free.provenance['prompts.retry'], 'code')
  const pro = await control.bind({ surface: 'shape', plan: 'pro' })
  assert.equal(control.render(pro.prompts.system, { count: 4 }), 'v1 4')
  assert.equal(pro.provenance['prompts.system'], 'db:plan@v3')
  // with the DB layer off the built-in text is used
  const off = createAIControl({ holder: fixedHolder(emptySnapshot({ dbLayer: 'off' })), choiceHolders: (id) => ai.choiceHolders(id), settings: FILE, codePrompts, codeSlots })
  assert.equal(off.render((await off.bind({ surface: 'shape' })).prompts.system, { count: 4 }), 'v0 4')
})

// ---------- the DB layer switch, last known good, cold start ----------
test('settings ai.control.dbLayer off never reads the DB layer; a runtime off ignores its documents', async () => {
  assert.equal(fileDbLayer({}), 'on')
  assert.equal(fileDbLayer({ ai: { control: { dbLayer: 'off' } } }), 'off')
  assert.throws(() => fileDbLayer({ ai: { control: { dbLayer: 'maybe' } } }), /on or off/)
  let reads = 0
  const holder = createSnapshotHolder({ read: { generation: async () => { reads += 1; return 1 }, all: async () => { reads += 1; return {} } }, settings: { ai: { control: { dbLayer: 'off' } } } })
  holder.start()
  const s = await holder.ready()
  assert.equal(s.dbLayer, 'off')
  assert.equal(s.source, 'file-switch')
  assert.equal(reads, 0)
  holder.stop()
  // runtime switch: documents ignored, the resolution is today's
  const runtime = buildSnapshot({ state: { generation: 4, dbLayer: 'off' }, models: MODELS, bindings: [binding('chat', { level: 'server' }, { chain: [{ model: 'muse:muse-ember-1.0' }] })] }, { fileConnections: ['muse'] })
  assert.equal(runtime.dbLayer, 'off')
  assert.deepEqual(runtime.bindings, {})
  // and resolveBinding ignores the documents of any snapshot marked off
  const forced = { ...snap({ bindings: [binding('chat', { level: 'server' }, { chain: [{ model: 'muse:muse-ember-1.0' }] })] }), dbLayer: 'off' }
  const { ai } = service(FILE)
  assert.equal(primaryOf(resolveBinding(forced, { surface: 'chat', holders: await ai.choiceHolders(null), settings: FILE })).connection, 'builtin')
})

test('the holder polls the generation, reloads when it moved, keeps the last good snapshot when a reload fails', async () => {
  let generation = 1
  let fail = false
  let loads = 0
  const timers = []
  const warnings = []
  const holder = createSnapshotHolder({
    read: {
      generation: async () => {
        if (fail) throw new Error('mongo down')
        return generation
      },
      all: async () => {
        loads += 1
        if (fail) throw new Error('mongo down')
        return { state: { generation }, models: MODELS, bindings: generation >= 2 ? [binding('chat', { level: 'server' }, { chain: [{ model: 'muse:muse-ember-1.0' }] })] : [] }
      },
    },
    fileConnections: () => ['muse'],
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimer: () => {},
    log: { warn: (text) => warnings.push(text) },
  })
  assert.equal(holder.current(), EMPTY_SNAPSHOT)
  holder.start()
  await holder.ready()
  await new Promise((r) => setImmediate(r))
  assert.equal(holder.current().generation, 1)
  assert.equal(loads, 1)
  assert.equal(timers.at(-1).ms, 5000)
  // nothing changed: one generation read, no reload
  await timers.at(-1).fn()
  assert.equal(loads, 1)
  // a publish elsewhere: the next poll reloads and swaps
  generation = 2
  await timers.at(-1).fn()
  assert.equal(loads, 2)
  assert.equal(holder.current().generation, 2)
  assert.ok(holder.current().bindings['chat|server'])
  // the database goes away: the last good snapshot stays, polling backs off
  fail = true
  generation = 3
  await timers.at(-1).fn()
  assert.equal(holder.current().generation, 2)
  assert.ok(timers.at(-1).ms > 5000, 'backs off')
  await holder.refresh({ force: true })
  assert.equal(holder.current().generation, 2)
  assert.ok(warnings.some((w) => /keeping generation 2/.test(w)))
  // back again: a writer's forced refresh swaps at once
  fail = false
  await holder.refresh({ force: true })
  assert.equal(holder.current().generation, 3)
  holder.stop()
})

test('a cold start with the database down runs on the settings file and code, and says so once', async () => {
  const warnings = []
  const holder = createSnapshotHolder({
    read: { generation: async () => { throw new Error('ECONNREFUSED') }, all: async () => { throw new Error('ECONNREFUSED') } },
    setTimer: () => 0, clearTimer: () => {}, log: { warn: (text) => warnings.push(text) },
  })
  const s = await holder.ready()
  assert.equal(s.source, 'file+code')
  assert.deepEqual(Object.keys(s.bindings), [])
  assert.equal(s.health[0].kind, 'snapshot')
  await holder.refresh({ force: true })
  assert.equal(warnings.filter((w) => /running without DB layer/.test(w)).length, 1)
  const { ai } = service({})
  const control = createAIControl({ holder, choiceHolders: (id) => ai.choiceHolders(id), settings: {} })
  assert.equal(primaryOf(await control.bind({ surface: 'chat' })).connection, 'builtin')
})

test('the snapshot never holds a key, and the admin views never show one', async () => {
  const s = buildSnapshot({ connections: [{ name: 'deck', provider: 'openai-compatible', baseUrl: 'https://deck.example.com/v1', cipher: 'sealed-bytes', apiKey: 'sk-live-should-not-appear', previousCipher: { cipher: 'old' }, keyFingerprint: 'sha256:abcd1234…a91f' }] })
  const text = JSON.stringify(s)
  assert.ok(!text.includes('sealed-bytes') && !text.includes('sk-live') && !text.includes('"old"'), text)
  assert.equal(s.connections.deck.hasKey, true)
  const { ai } = service(FILE)
  const control = createAIControl({ holder: fixedHolder(s), choiceHolders: (id) => ai.choiceHolders(id), settings: FILE })
  const view = control.get()
  assert.deepEqual(view.connections[0], { name: 'deck', provider: 'openai-compatible', baseUrl: 'https://deck.example.com/v1', model: null, capabilities: {}, status: 'active', hasKey: true, keyFingerprint: 'sha256:abcd1234…a91f', keyRef: null, lastCheck: null })
  assert.equal(view.surfaces.length, SURFACES.length)
  assert.deepEqual(view.global, { aiEnabled: true, aiDisabledMessage: null })
  // a file connection whose key is in the settings file: its key never reaches the effective view
  const inline = { public: { env: 'selfhost' }, ai: { connections: { muse: { type: 'openai-compatible', baseUrl: 'https://muse.example.com/v1', model: 'm', apiKey: 'sk-inline-file-key-1234' } }, use: { default: 'muse' } } }
  const svc = service(inline)
  const viewControl = createAIControl({ holder: fixedHolder(EMPTY_SNAPSHOT), choiceHolders: (id) => svc.ai.choiceHolders(id), settings: inline })
  const effective = await viewControl.effective({})
  assert.ok(!JSON.stringify(effective).includes('sk-inline'))
  assert.equal(effective.surfaces.find((row) => row.id === 'chat').binding.chain[0].keyRef.kind, 'file')
})

test('effective lists every surface: bindable ones resolved, library and connectors included now they have landed', async () => {
  const { ai } = service({})
  const control = createAIControl({ holder: fixedHolder(EMPTY_SNAPSHOT), choiceHolders: (id) => ai.choiceHolders(id), settings: {} })
  const all = await control.effective({ userId: 'ana' })
  assert.equal(all.surfaces.length, SURFACES.length)
  const by = Object.fromEntries(all.surfaces.map((row) => [row.id, row]))
  assert.equal(by.library.binding.surface, 'library')
  assert.equal(by.library.followsTitle, 'Conversation and edits')
  assert.equal(by.connectors.binding.surface, 'connectors')
  assert.ok(all.surfaces.every((row) => row.note !== 'Not in this build'), 'every catalogued surface is in this build')
  assert.equal(by['images.search'].note, 'Served by a built-in service')
  assert.equal(by['admin.test'].binding, null)
  assert.equal(by['agent.slatebox'].followsTitle, 'Canvas conversation (drawing chat)')
  assert.equal(by['agent.slatebox'].binding.surface, 'agent.slatebox')
  const one = await control.effective({ surface: 'map-chat' })
  assert.deepEqual(one.surfaces.map((row) => row.id), ['workshop'])
})

// ---------- what a binding changes in a request ----------
test('req options: no binding leaves them as they are; a binding fills in what the call site left out', async () => {
  const plain = { feature: 'shape', prompts: [] }
  assert.equal(requestOptionsFromBinding(plain).options, plain)
  const { ai } = service({})
  const control = createAIControl({ holder: fixedHolder(EMPTY_SNAPSHOT), choiceHolders: (id) => ai.choiceHolders(id), settings: {} })
  const b = await control.bind({ surface: 'generation' })
  const { options } = requestOptionsFromBinding({ prompts: [], binding: b })
  assert.equal(options.feature, 'generation')
  assert.equal(options.provider, 'deepinfra')
  assert.equal(options.engine, 'Qwen/Qwen3-235B-A22B-Instruct-2507')
  assert.deepEqual(options.fallback, { provider: 'deepinfra', engine: 'deepseek-ai/DeepSeek-V3.1-Terminus' })
  assert.equal(options.binding, undefined)
  // code and file params are what req already reads: not repeated
  assert.equal(options.timeoutMs, undefined)
  assert.equal(options.infraRetries, undefined)
  // a call site's own choices win; fallback: undefined keeps none
  const own = requestOptionsFromBinding({ feature: 'presentation', provider: 'deepinfra', engine: 'x', fallback: undefined, binding: b }).options
  assert.equal(own.engine, 'x')
  assert.equal(own.fallback, undefined)
  assert.equal(own.feature, 'presentation')
  // a published binding's params apply
  const s = snap({ bindings: [binding('shape', { level: 'server' }, { params: { timeoutMs: 17000, maxTokens: 6000, infraRetries: 0 } })] })
  const control2 = await controlFor(s)
  const shaped = requestOptionsFromBinding({ binding: await control2.bind({ surface: 'shape' }) }).options
  assert.deepEqual([shaped.timeoutMs, shaped.maxTokens, shaped.infraRetries, shaped.bindingVersion], [17000, 6000, 0, null])
  // a surface turned off sends nothing
  const off = snap({ bindings: [binding('shape', { level: 'server' }, { enabled: false, disabledMessage: 'Shapes are paused.' })] })
  const refused = requestOptionsFromBinding({ binding: await (await controlFor(off)).bind({ surface: 'shape' }) })
  assert.deepEqual(refused.refusal, { abort: true, abortMessage: 'Shapes are paused.', fallbackBlocked: true, disabled: true, surface: 'shape' })
})

// ---------- the real req(): audit rows and bindings ----------
test('req() records the surface, connection and chain place of every call; a binding fills in its model and can turn a surface off', async () => {
  const { execFileSync } = await import('node:child_process')
  // its own process: the module hooks that stub Meteor are registered once per process
  const out = JSON.parse(execFileSync(process.execPath, ['--no-deprecation', new URL('./ai-req-audit.mjs', import.meta.url).pathname],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024 }))
  const row = (name, i = 0) => out[name].audits[i]
  assert.deepEqual(row('builtin'), { feature: 'shape', surface: 'shape', connection: 'builtin', attempt: 0, model: 'good-model', status: 'success' })
  assert.equal(row('requestFeature').surface, 'workshop')
  // a built-in fallback is attempt 1, after the primary's failure at attempt 0
  assert.deepEqual(out.fallback.audits.map((a) => [a.attempt, a.model, a.status]), [[0, 'broken-model', 'provider_error'], [1, 'good-model', 'success']])
  assert.equal(out.fallback.result.fallbackFrom, 'broken-model')
  // a chosen connection is named even when the request stops before it is sent
  assert.deepEqual([row('gap').connection, row('gap').status, out.gap.sent.length], ['server:muse', 'capability', 0])
  // a binding: its chain gives the primary and the fallback, its published maxTokens applies, its version is recorded
  assert.deepEqual(out.binding.sent, [{ model: 'broken-model', max_tokens: 900 }, { model: 'good-model', max_tokens: 900 }])
  assert.deepEqual(out.binding.audits.map((a) => [a.surface, a.attempt, a.bindingVersion]), [['agent.slatebox', 0, 'agent.slatebox|server@v4'], ['agent.slatebox', 1, 'agent.slatebox|server@v4']])
  // a surface turned off sends nothing and says the administrator's message
  assert.deepEqual(out.bindingOff, { audits: [], sent: [], result: { abort: true, abortMessage: 'Shapes are paused by your administrator.', model: null, disabled: true, fallbackFrom: null } })
})

// ---------- the read actions ----------
// Restated (S2): the read actions gained the admin toolset, the ai:admin:read scope and their
// HTTP, exec, MCP and CLI reach; an agent that is an administrator may now read. The exec
// description and the typed MCP tools are still unchanged (scripts/ai-control-auth.test.mjs).
test('ai.control.get and ai.control.effective: administrators only, on every surface; the exec description is unchanged', async () => {
  const { createAppRegistry } = await import('../web/app/server/actions/index.mjs')
  const { buildClientManifest, renderExecTool } = await import('../web/app/server/actions/client-render.mjs')
  const { readFileSync } = await import('node:fs')
  const { ai } = service({})
  const aiControl = createAIControl({ holder: fixedHolder(EMPTY_SNAPSHOT), choiceHolders: (id) => ai.choiceHolders(id), settings: {} })
  const registry = createAppRegistry({ deps: { aiControl, aiControlAdmin: async (id) => id === 'root' } })
  const person = (userId) => ({ kind: 'person', userId, tokenId: null, tokenName: null, scopes: ['ai:admin', 'ai:settings'] })
  const body = (result) => result.body ?? result
  const view = body(await registry.run(person('root'), 'ai.control.get', {}))
  assert.equal(view.surfaces.length, SURFACES.length)
  assert.equal(view.dbLayer, 'on')
  const effective = body(await registry.run(person('root'), 'ai.control.effective', { surface: 'agent.slatebox', userId: 'ana' }))
  assert.equal(effective.surfaces[0].binding.followed, 'chat')
  await assert.rejects(registry.run(person('ana'), 'ai.control.get', {}), { status: 403 })
  await assert.rejects(registry.run(person('ana'), 'ai.control.effective', {}), { status: 403 })
  // a token: an administrator's with ai:admin (which holds ai:admin:read) reads; anyone else's is refused
  const token = (userId, scopes) => ({ kind: 'agent', userId, tokenId: 't', tokenName: 'x', scopes })
  assert.equal(body(await registry.run(token('root', ['ai:admin']), 'ai.control.get', {})).dbLayer, 'on')
  await assert.rejects(registry.run(token('ana', ['ai:admin', 'ai:admin:read']), 'ai.control.get', {}), { status: 403 })
  await assert.rejects(registry.run(token('root', ['ai:settings']), 'ai.control.get', {}), { status: 403, code: 'insufficient_scope' })
  await assert.rejects(registry.run(person('root'), 'ai.control.effective', { surface: 'Bad Surface' }), { status: 400 })
  // exec client methods, but the exec description and the typed MCP tools are what they were
  const manifest = buildClientManifest(registry)
  assert.ok(manifest.methods.some((m) => m.name === 'ai.control.get'))
  const generated = JSON.parse(readFileSync(new URL('../web/app/server/actions/generated/exec-tool.json', import.meta.url), 'utf8'))
  assert.equal(renderExecTool(manifest).exec.description, generated.exec.description)
  assert.ok(!renderExecTool(manifest).typed.some((t) => t.method.startsWith('ai.control')))
})

test('a published prompt that does not render falls back to the built-in text once, and health says so', async () => {
  const s = snap({
    prompts: [{ _id: 'shape.system', surface: 'shape', kind: 'system', labels: { published: 3 } }],
    promptVersions: [{ _id: 'shape.system@3', promptId: 'shape.system', version: 3, body: 'v3 {{count}} {{style}}', variables: { count: { type: 'integer' }, style: { type: 'string', required: true } } }],
  })
  const { ai } = service(FILE)
  const codePrompts = { 'shape.system': { body: 'v0 {{count}}', variables: { count: { type: 'integer' } } } }
  const control = createAIControl({ holder: fixedHolder(s), choiceHolders: (id) => ai.choiceHolders(id), settings: FILE, codePrompts, codeSlots: { shape: { system: 'shape.system' } } })
  const b = await control.bind({ surface: 'shape' })
  assert.deepEqual(control.renderSlot(b, 'system', { count: 2, style: 'flat' }), { text: 'v3 2 flat', ref: 'shape.system@v3', fallback: null })
  assert.deepEqual(control.renderSlot(b, 'system', { count: 2 }), { text: 'v0 2', ref: 'shape.system@v0', fallback: 'shape.system@v3 -> v0' })
  assert.equal(control.health().at(-1).id, 'shape.system')
  assert.equal(control.get().health.length, 1)
  // the built-in text itself failing is not hidden
  const off = createAIControl({ holder: fixedHolder(EMPTY_SNAPSHOT), choiceHolders: (id) => ai.choiceHolders(id), settings: FILE, codePrompts, codeSlots: { shape: { system: 'shape.system' } } })
  assert.throws(() => off.renderSlot({ surface: 'shape', prompts: { system: { id: 'shape.system', version: 0, body: '{{n}}', variables: { n: { type: 'integer', required: true } } } } }, 'system', {}), /n is required/)
  assert.throws(() => off.renderSlot(b, 'retry', {}), /no retry prompt/)
})
