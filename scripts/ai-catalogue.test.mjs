// The surface catalogue (web/app/server/ai-control/catalogue.mjs) is the one list of AI surfaces.
// Everything that names AI features is derived from it, and deriving it changes nothing: every
// request feature reaches the same choice as before, the meter keeps its estimates and ceilings,
// and a stored choice keeps working. Parts of a feature (chat.route, workshop, agent.slatebox, ...)
// can now be chosen on their own; unset, they follow.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  BUILTIN_ONLY_FEATURES, METER_CEILINGS, METER_ESTIMATES, REQUEST_FEATURES, SURFACES, USE_SURFACES,
  builtinFeatureFor, followChain, rootSurface, surface, surfaceForRequest,
} from '../web/app/server/ai-control/catalogue.mjs'
import {
  AI_FEATURES, USE_FALLBACK, USE_KEYS, capabilityGap, checkUse, choiceFeatureFor, featureTitle, operatorConfig, resolveAIChoice, surfaceFor,
} from '../web/app/server/methods/ai/connections.mjs'
import { useInput } from '../web/app/server/actions/ai-schemas.mjs'
import { validate } from '../web/app/server/actions/schema.mjs'
import { ESTIMATES, actionCeilingMicros } from '../web/app/server/metering/prices.mjs'
import { DEFAULT_AI_FEATURES } from '../web/app/server/methods/ai/feature-config.mjs'
import { createAISettings } from '../web/app/server/methods/ai/ai-settings-core.mjs'
import { createConnectionStore, decodeUseKeys, encodeUseKeys } from '../web/app/server/methods/ai/connection-store.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'

// What each request feature reached before the catalogue (connections.mjs REQUEST_FEATURES and its
// rules at d8105c12), plus what the library landing (release/library2) added: library-refine reaches
// library, a row of its own that follows chat. connectors had a settings-file key of its own that
// followed chat (FEATURE_FALLBACKS) and no row: the first-row feature it reports is chat, and its
// key is still read first (connectors -> chat -> default, scripts/connectors.test.mjs).
const BEFORE = {
  welcome: 'chat', workshop: 'chat', 'lane-chat': 'chat', 'map-chat': 'chat',
  generation: 'generation', layout: 'generation', presentation: 'presentation', vision: 'vision',
  'image-generation': 'images', images: 'images', chat: 'chat', shape: 'shape',
  'welcome-route': 'chat', 'generation-route': 'generation', 'presentation-route': 'presentation', 'shape-route': 'shape',
  'library-refine': 'library', connectors: 'chat', 'some-new-feature': 'chat',
  'image-search': null, call: null,
}
const ESTIMATES_BEFORE = {
  workshop: 5000, 'lane-chat': 3000, 'map-chat': 3000, welcome: 2000, generation: 30000,
  presentation: 10000, 'image-search': 5000, 'image-generation': 30000, shape: 8000,
}
// Library refinement and connectors were estimated at the workshop estimate before (no row of their
// own: meter-core falls back to ESTIMATES.workshop); the catalogue names that same figure for them.
const LANDED_ESTIMATES = { 'library-refine': ESTIMATES_BEFORE.workshop, connectors: ESTIMATES_BEFORE.workshop }
const CEILINGS_BEFORE = { generation: 200_000, vision: 200_000, presentation: 200_000, shape: 60_000 }

test('every request feature reaches the same choice as before the catalogue', () => {
  for (const [feature, choice] of Object.entries(BEFORE)) assert.equal(choiceFeatureFor(feature), choice, feature)
  assert.deepEqual([...BUILTIN_ONLY_FEATURES].sort(), ['call', 'image-search'])
})

test('request features name their own surface; a router step belongs to its feature; an unknown name follows chat', () => {
  const expected = {
    welcome: 'chat', chat: 'chat', 'welcome-route': 'chat.route', generation: 'generation', layout: 'generation',
    presentation: 'presentation', vision: 'vision', 'image-generation': 'images', images: 'images', shape: 'shape',
    'lane-chat': 'workshop', 'map-chat': 'workshop', workshop: 'workshop.draft', canvas: 'canvas', agent: 'agent.slatebox',
    'library-refine': 'library', connectors: 'connectors', 'generation-route': 'generation', 'canvas-route': 'canvas',
    'image-search': null, call: null, 'not-a-feature-yet': 'chat',
  }
  for (const [feature, at] of Object.entries(expected)) assert.equal(surfaceForRequest(feature), at, feature)
  assert.equal(surfaceFor('lane-chat'), 'workshop')
  // a surface id is its own request feature, except the root
  assert.equal(surfaceForRequest('agent.slatebox'), 'agent.slatebox')
  assert.equal(surfaceForRequest('default'), 'chat')
  // every request feature belongs to exactly one surface
  const owners = SURFACES.flatMap((s) => s.requestFeatures)
  assert.equal(new Set(owners).size, owners.length)
  assert.equal(Object.keys(REQUEST_FEATURES).length + BUILTIN_ONLY_FEATURES.length - 1, owners.length)
})

test('the follows tree: one table, every chain ends at default', () => {
  assert.deepEqual(followChain('agent.slatebox'), ['agent.slatebox', 'canvas', 'chat', 'default'])
  assert.deepEqual(followChain('workshop.draft'), ['workshop.draft', 'workshop', 'chat', 'default'])
  assert.deepEqual(followChain('chat.route'), ['chat.route', 'chat', 'default'])
  assert.deepEqual(followChain('generation.notes'), ['generation.notes', 'generation', 'default'])
  for (const s of USE_SURFACES) assert.equal(followChain(s.id).at(-1), 'default', s.id)
  assert.equal(surface('images.search').useKey, false, 'image search is a built-in service, not a choice')
  assert.equal(surface('admin.test').useKey, false, 'admin test runs name their model per call')
  assert.equal(surface('admin.test').follows, null)
  const roots = { chat: 'chat', 'chat.route': 'chat', workshop: 'chat', 'workshop.draft': 'chat', canvas: 'chat', 'agent.slatebox': 'chat',
    library: 'library', connectors: 'chat', 'generation.notes': 'generation', generation: 'generation', images: 'images', default: 'default' }
  for (const [id, root] of Object.entries(roots)) assert.equal(rootSurface(id), root, id)
})

test('built-in models: the board, canvas and agent surfaces take the drafting model; connectors too (no keyless fall-through)', () => {
  for (const id of ['workshop', 'workshop.draft', 'canvas', 'agent.slatebox', 'connectors', 'generation.notes']) {
    assert.equal(builtinFeatureFor(id), 'generation', id)
  }
  assert.equal(builtinFeatureFor('chat.route'), 'welcome')
  assert.equal(builtinFeatureFor('shape'), 'shape')
  for (const s of SURFACES) if (s.builtinFrom && s.builtinFrom !== 'stability') assert.ok(DEFAULT_AI_FEATURES[s.builtinFrom], `${s.id} takes its model from ai-defaults ${s.builtinFrom}`)
})

test('library and connectors have landed: both are in this build; connectors is Slatebox Cloud only', () => {
  assert.equal(surface('library').inBuild, true)
  assert.equal(surface('connectors').inBuild, true)
  assert.equal(surface('connectors').edition, 'cloud')
  assert.equal(builtinFeatureFor('library'), 'library', 'library has its own built-in block (a copy of generation\'s)')
  const inBuild = SURFACES.filter((s) => s.inBuild && s.useKey).map((s) => s.id)
  assert.deepEqual(inBuild, ['default', 'chat', 'chat.route', 'generation', 'generation.notes', 'presentation', 'vision', 'images', 'shape',
    'workshop', 'workshop.draft', 'canvas', 'agent.slatebox', 'library', 'connectors'])
})

test('the features people choose first are the catalogue rows that follow default, unchanged, then library (a row of its own that follows chat)', () => {
  assert.deepEqual(AI_FEATURES.map((f) => [f.id, f.title, f.verb, [...f.needs]]), [
    ['chat', 'Conversation and edits', 'call tools', ['tools']],
    ['generation', 'Drafts and layouts', 'call tools', ['tools']],
    ['presentation', 'Presentation planning', 'call tools', ['tools']],
    ['vision', 'Reading images and diagrams', 'read images', ['vision']],
    ['images', 'Generating images', 'make images', ['images']],
    ['shape', 'Drawing custom shapes', 'call tools', ['tools']],
    ['library', 'Library review and refinement', 'call tools', ['tools']],
  ])
  assert.deepEqual({ ...USE_FALLBACK }, { library: 'chat' })
  assert.deepEqual(USE_KEYS, USE_SURFACES.map((s) => s.id))
  for (const key of ['default', 'chat', 'generation', 'presentation', 'vision', 'images', 'shape', 'library', 'connectors', 'agent.slatebox']) assert.ok(USE_KEYS.includes(key), key)
})

test('the meter keeps every estimate and ceiling', () => {
  assert.deepEqual({ ...ESTIMATES }, { ...ESTIMATES_BEFORE, ...LANDED_ESTIMATES })
  assert.equal(ESTIMATES, METER_ESTIMATES)
  for (const feature of [...Object.keys(ESTIMATES_BEFORE), 'vision', 'canvas', 'agent', 'library-refine', 'connectors', 'unknown']) {
    assert.equal(actionCeilingMicros(feature), CEILINGS_BEFORE[feature] ?? 50_000, feature)
  }
  // a ceiling the catalogue names for a feature always beats the default
  for (const [feature, ceiling] of Object.entries(METER_CEILINGS)) assert.equal(actionCeilingMicros(feature), ceiling, feature)
})

test('useInput accepts every surface a choice may name, and nothing else', () => {
  assert.deepEqual(Object.keys(useInput.properties), USE_KEYS)
  for (const key of USE_KEYS) assert.equal(validate(useInput, { [key]: 'builtin' }), null, key)
  assert.equal(validate(useInput, { library: 'server:muse' }), null)
  assert.notEqual(validate(useInput, { 'images.search': 'builtin' }), null)
  assert.notEqual(validate(useInput, { 'admin.test': 'builtin' }), null)
  assert.notEqual(validate(useInput, { welcome: 'builtin' }), null, 'a request feature is not a choice')
})

test('a choice for a part applies to that part only; unset, it follows; messages name what was chosen', () => {
  const connections = [{ name: 'muse', type: 'openai-compatible', baseUrl: 'https://muse.example.com/v1', model: 'muse-ember-1.0', capabilities: {} },
    { name: 'agentm', type: 'openai-compatible', baseUrl: 'https://agent.example.com/v1', model: 'agent-model', capabilities: { tools: false } }]
  const pick = (use, feature) => resolveAIChoice({ feature, server: { connections, use }, ownProviders: false })
  // nothing of their own: every part follows chat, and is reported as chat (as before)
  for (const id of ['chat', 'chat.route', 'workshop', 'workshop.draft', 'canvas', 'agent.slatebox']) {
    const choice = pick({ chat: 'server:muse' }, id)
    assert.equal(choice.ref, 'server:muse', id)
    assert.equal(choice.feature, 'chat', id)
  }
  assert.equal(pick({ default: 'server:muse' }, 'agent.slatebox').feature, 'chat')
  assert.equal(pick({}, 'agent.slatebox').ref, 'builtin')
  assert.equal(pick({}, 'agent.slatebox').feature, 'chat')
  // the agent on its own model; the canvas conversation and chat keep theirs
  const use = { chat: 'server:muse', 'agent.slatebox': 'server:agentm' }
  assert.equal(pick(use, 'agent.slatebox').ref, 'server:agentm')
  assert.equal(pick(use, 'agent.slatebox').feature, 'agent.slatebox')
  assert.equal(pick(use, 'canvas').ref, 'server:muse')
  assert.equal(pick(use, 'chat').ref, 'server:muse')
  // the canvas set: the agent follows it, not chat
  assert.equal(pick({ chat: 'server:muse', canvas: 'server:agentm' }, 'agent.slatebox').ref, 'server:agentm')
  // a capability message names the part that was chosen
  const gap = capabilityGap({ feature: 'agent.slatebox', connection: connections[1], request: { tools: true } })
  assert.match(gap.message, /Choose another model for the slatebox agent \(tasks, ask_agent, @mentions\)/)
  assert.equal(featureTitle('chat'), 'Conversation and edits')
  // a key saved before choices (legacy chat) still serves every conversation part
  const legacy = { connections: [{ ...connections[0], legacy: 'chat' }], use: {} }
  for (const id of ['chat', 'workshop', 'canvas', 'agent.slatebox', 'chat.route']) {
    assert.equal(resolveAIChoice({ feature: id, person: legacy, server: { connections: [], use: {} } }).ref, 'me:muse', id)
  }
  assert.equal(resolveAIChoice({ feature: 'generation.notes', person: legacy, server: { connections: [], use: {} } }).ref, 'builtin')
})

test('checkUse and the settings file take every surface; a request feature or a built-in service is refused', () => {
  const visible = { server: [{ name: 'muse' }], me: [], team: [] }
  assert.deepEqual(checkUse({ 'agent.slatebox': 'server:muse', library: 'builtin' }, 'server', visible), { 'agent.slatebox': 'server:muse', library: 'builtin' })
  assert.throws(() => checkUse({ 'lane-chat': 'builtin' }, 'server', visible), /not a feature/)
  assert.throws(() => checkUse({ 'images.search': 'builtin' }, 'server', visible), /not a feature/)
  const file = operatorConfig({ ai: { connections: { muse: { type: 'openai-compatible', baseUrl: 'https://muse.example.com/v1', model: 'm' } }, use: { chat: 'muse', 'agent.slatebox': 'builtin' } } })
  assert.deepEqual(file.use, { chat: 'server:muse', 'agent.slatebox': 'builtin' })
})

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

function service(settings = { public: { env: 'selfhost' } }) {
  const store = memoryStore()
  const master = loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
  const people = { ana: { _id: 'ana', orgId: 'team1' }, root: { _id: 'root' } }
  const ai = createAISettings({
    store, master, settings, hosted: false,
    loadUser: async (id) => people[id] || null,
    isAdmin: async (id) => id === 'root',
    isTeamAdmin: async () => false,
    check: async () => ({ ok: true, message: 'ok' }),
  })
  return { ai, store }
}

test('ai.get lists every surface with what it follows; an administrator binds library and the agent', async () => {
  const { ai } = service()
  await ai.update('root', { level: 'server', connections: [{ name: 'muse', type: 'openai-compatible', baseUrl: 'https://muse.example.com/v1', model: 'muse-ember-1.0' }], use: { chat: 'server:muse' } })
  const view = await ai.view('root')
  assert.deepEqual(view.features.map((f) => f.id), ['chat', 'generation', 'presentation', 'vision', 'images', 'shape', 'library'])
  const byId = Object.fromEntries(view.surfaces.map((s) => [s.id, s]))
  assert.equal(byId['agent.slatebox'].follows, 'canvas')
  assert.equal(byId['agent.slatebox'].followsTitle, 'Canvas conversation (drawing chat)')
  assert.equal(byId.workshop.followsTitle, 'Conversation and edits')
  assert.equal(byId.chat.followsTitle, null)
  assert.equal(byId.library.inBuild, true)
  assert.equal(byId.library.followsTitle, 'Conversation and edits')
  assert.equal(view.effective['agent.slatebox'].ref, 'server:muse', 'the agent follows chat until set')
  assert.equal(view.effective.library.ref, 'server:muse', 'library follows chat until set')
  await ai.update('root', { level: 'server', use: { library: 'builtin', 'agent.slatebox': 'builtin' } })
  const after = await ai.view('root')
  assert.equal(after.server.use.library, 'builtin')
  assert.equal(after.effective['agent.slatebox'].ref, 'builtin')
  assert.equal(after.effective.canvas.ref, 'server:muse')
  // the request path: the agent's request feature reaches its own choice, the canvas conversation chat's
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'agent' })).ref, 'builtin')
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'canvas' })).ref, 'server:muse')
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'lane-chat' })).ref, 'server:muse')
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'canvas' })).feature, 'chat')
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'library-refine' })).ref, 'builtin', 'library refinement reaches its own choice')
  assert.equal(after.effective.library.ref, 'builtin')
  assert.equal(await ai.resolveFor({ userId: 'ana', feature: 'image-search' }), null)
})

test('a part\'s choice is stored without dots in field names (MongoDB) and read back as it was given', async () => {
  const docs = new Map()
  const choices = {
    async findOne({ _id }) { return docs.get(_id) ?? null },
    async replaceOne({ _id }, doc) { docs.set(_id, { _id, ...doc }) },
  }
  const store = createConnectionStore({ keys: {}, choices })
  const owner = { type: 'server', id: 'server' }
  await store.setUse(owner, { use: { chat: 'server:muse', 'agent.slatebox': 'builtin', 'workshop.draft': 'server:muse' }, ownProviders: true })
  const raw = docs.get('server:server')
  assert.ok(Object.keys(raw.use).every((key) => !key.includes('.')), JSON.stringify(raw.use))
  assert.deepEqual(raw.use, { chat: 'server:muse', agent__slatebox: 'builtin', workshop__draft: 'server:muse' })
  assert.deepEqual((await store.getUse(owner)).use, { chat: 'server:muse', 'agent.slatebox': 'builtin', 'workshop.draft': 'server:muse' })
  assert.equal((await store.getUse(owner)).ownProviders, true)
  assert.equal(await store.getUse({ type: 'user', id: 'nobody' }), null)
  // documents written before the catalogue read unchanged
  docs.set('user:old', { _id: 'user:old', use: { default: 'me:desk', shape: 'builtin' } })
  assert.deepEqual((await store.getUse({ type: 'user', id: 'old' })).use, { default: 'me:desk', shape: 'builtin' })
  for (const id of USE_KEYS) assert.equal(decodeUseKeys(encodeUseKeys({ [id]: 'x' }))[id], 'x', id)
})
