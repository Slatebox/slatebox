// The extraction contract (spec 5.2, slice S5): moving the prompts of custom shapes, board chat and
// drafting, the canvas conversation, the Slatebox agent, presentation planning and library refine
// into server/ai-control/prompts changed no byte the model is sent. The golden was captured from
// 4ffde9cf, before the move, with `node scripts/ai-request-golden.mjs --prompts <that tree>/web/app`; its two library
// sites were captured again when the engine’s edit table gained set_appearance (the refine tool offers every edit),
// and its exec sites when the engine's slate keys gained style and its fonts the slate styles' faces (the exec client's
// typings are generated from the engine contract; no prompt text changed).
// Every prompt in the registry is asked for by one of those recordings, so every one is proven; and
// a published version really reaches the request, while no published version (or no snapshot)
// serves the built-in text. (The recordings no longer carry a provider, model or fallback per call:
// which model answers is chosen in Admin → AI control, not at the call site.)
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { CODE_PROMPTS, CODE_SLOTS, PROMPT_IDS, prompts, promptRef, promptText } from '../web/app/server/ai-control/prompts/index.mjs'
import { promptFor } from '../web/app/server/ai-control/resolve.mjs'
import { buildSnapshot, emptySnapshot } from '../web/app/server/ai-control/snapshot.mjs'
import { generateShapes } from '../web/app/server/shapes/shape-core.mjs'
import { refinePrompt } from '../web/app/server/library/refine-ai.mjs'
import { presentationPrompts } from '../web/app/server/methods/presentationRequest.mjs'
import { SURFACES } from '../web/app/server/ai-control/catalogue.mjs'
import { capsPlaceholders } from '../web/app/server/ai-control/lint.mjs'

const here = (path) => new URL(path, import.meta.url)
const recorder = here('./ai-request-golden.mjs').pathname
const run = (...args) => execFileSync(process.execPath, ['--no-deprecation', recorder, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

test('every prompt site sends the same bytes as before the prompts moved', () => {
  const golden = readFileSync(here('./fixtures/ai-request/prompt-sites.golden.json'), 'utf8')
  const now = run('--prompts')
  assert.deepEqual(Object.keys(JSON.parse(now)), Object.keys(JSON.parse(golden)))
  for (const [site, request] of Object.entries(JSON.parse(golden))) assert.deepEqual(JSON.parse(now)[site], request, site)
  // the same text, in the same order: what reaches the provider
  assert.equal(now, golden)
})

test('every prompt in the registry is one those sites ask for, so the golden proves each one', () => {
  const used = JSON.parse(run('--used'))
  assert.deepEqual(PROMPT_IDS.filter((id) => !used.includes(id)), [])
  assert.deepEqual(used.filter((id) => !PROMPT_IDS.includes(id)), [])
})

test('the registry: S5 surfaces, unique slots, declared variables, no all-caps placeholder tokens', () => {
  const surfaces = new Set(SURFACES.map((s) => s.id))
  for (const id of ['shape', 'workshop', 'workshop.draft', 'canvas', 'agent.slatebox', 'presentation', 'library']) assert.ok(CODE_SLOTS[id], `${id} has prompts`)
  for (const prompt of prompts.list) {
    assert.ok(surfaces.has(prompt.surface), prompt.id)
    assert.equal(CODE_SLOTS[prompt.surface][prompt.slot], prompt.id)
    assert.deepEqual(CODE_PROMPTS[prompt.id], { body: prompt.body, variables: prompt.variables })
    // no all-caps placeholder tokens in the text itself (AGENTS.md); code-made values are variables
    assert.deepEqual(capsPlaceholders(prompt.body), [], prompt.id)
  }
})

// a snapshot as AI control loads it: published heads and versions
const snapshotWith = ({ heads = [], versions = [] } = {}) => buildSnapshot({
  state: { generation: 3 },
  prompts: heads, promptVersions: versions,
})
const use = (snapshot) => prompts.setSource((id) => promptFor(snapshot, prompts.byId[id], CODE_PROMPTS))

test('a published version reaches the request; with none (or no snapshot) the built-in text is sent', async (t) => {
  t.after(() => prompts.setSource(null))
  const added = ' Prefer rounded corners.'
  const v2 = { _id: 'shape.system@2', promptId: 'shape.system', version: 2, body: CODE_PROMPTS['shape.system'].body + added, variables: CODE_PROMPTS['shape.system'].variables }
  const v3 = { ...v2, _id: 'shape.system@3', version: 3, body: 'Draw {{count}} outlines, simply.' }
  const sent = []
  const draw = () => generateShapes({ principal: { userId: 'ana' }, describe: 'a cloud', count: 2 }, {
    request: async (opts) => { sent.push(opts); return { abort: true } }, run: (fn) => fn(), newId: () => 'id',
  }).catch(() => {})

  use(snapshotWith({ heads: [{ _id: 'shape.system', surface: 'shape', kind: 'system', labels: { published: 2 } }], versions: [v2, v3] }))
  assert.equal(promptRef('shape.system'), 'shape.system@v2')
  await draw()
  assert.ok(sent.at(-1).system.endsWith(added), 'the published sentence is in the system text sent')
  assert.ok(sent.at(-1).system.includes('exactly 2 clearly different takes'))

  // publishing version 3 moves what is sent
  use(snapshotWith({ heads: [{ _id: 'shape.system', surface: 'shape', kind: 'system', labels: { published: 3 } }], versions: [v2, v3] }))
  await draw()
  assert.equal(sent.at(-1).system, 'Draw 2 outlines, simply.')

  // an empty snapshot (the database could not be read) is the code
  use(emptySnapshot())
  await draw()
  assert.equal(sent.at(-1).system, prompts.code('shape.system', { count: 2 }))

  // no published label: version 0
  use(snapshotWith({ heads: [{ _id: 'shape.system', surface: 'shape', kind: 'system', labels: { published: null } }] }))
  assert.equal(promptRef('shape.system'), 'shape.system@v0')
})

test('a published version that does not render falls back to the built-in text, reported once per call', (t) => {
  const reported = []
  t.after(() => prompts.setSource(null))
  const broken = { _id: 'library.refine.retry@4', promptId: 'library.refine.retry', version: 4, body: 'Use the tool {{tool}}.', variables: { tool: { type: 'string', required: true } } }
  const snapshot = snapshotWith({ heads: [{ _id: 'library.refine.retry', surface: 'library', kind: 'retry', labels: { published: 4 } }], versions: [broken] })
  prompts.setSource((id) => promptFor(snapshot, prompts.byId[id], CODE_PROMPTS), { onFallback: (entry) => reported.push(entry) })
  assert.equal(promptText('library.refine.retry'), prompts.code('library.refine.retry'))
  assert.equal(reported.length, 1)
  assert.equal(reported[0].id, 'library.refine.retry')
  assert.equal(reported[0].version, 4)
  // a hot path does not flood health: the same version is reported once, and named as the problem
  for (let i = 0; i < 60; i += 1) assert.equal(promptText('library.refine.retry'), prompts.code('library.refine.retry'))
  assert.equal(reported.length, 1)
  assert.deepEqual({ version: prompts.problem('library.refine.retry').version, message: prompts.problem('library.refine.retry').message }, { version: 4, message: reported[0].error.message })
  assert.equal(prompts.problem('library.refine.system'), null)
  // another broken version is reported again; a version that renders clears the problem
  const broken5 = { ...broken, _id: 'library.refine.retry@5', version: 5 }
  const next = snapshotWith({ heads: [{ _id: 'library.refine.retry', surface: 'library', kind: 'retry', labels: { published: 5 } }], versions: [broken5] })
  prompts.setSource((id) => promptFor(next, prompts.byId[id], CODE_PROMPTS), { onFallback: (entry) => reported.push(entry) })
  promptText('library.refine.retry')
  promptText('library.refine.retry')
  assert.deepEqual(reported.map((r) => r.version), [4, 5])
  const fixed = snapshotWith({ heads: [{ _id: 'library.refine.retry', surface: 'library', kind: 'retry', labels: { published: null } }] })
  prompts.setSource((id) => promptFor(fixed, prompts.byId[id], CODE_PROMPTS))
  assert.equal(prompts.problem('library.refine.retry'), null)
})

test('the call sites render through the registry with the values they used to splice in', () => {
  const component = { kind: 'component', title: 'T', summary: 'S', category: 'decide', categoryLocked: true }
  const text = refinePrompt(component, null)
  assert.match(text, /^You help an administrator of Slatebox review a /)
  assert.match(text, /The category is locked to /)
  assert.doesNotMatch(text, /\{\{|\}\}/)
  const planned = presentationPrompts({ layout: { nodes: [{ nodeId: 'a', description: 'A', metrics: { bbox: { x: 0, y: 0, width: 1, height: 1 } }, childrenNodes: [] }] }, scenes: [{ nodeIds: ['a'] }], isTemplate: true })
  assert.match(planned.user, /This slate is based on a template/)
  assert.match(planned.user, /presents in this order, each lane with the notes on it: a\. Present one segment per lane/)
  assert.deepEqual(planned.systemRefFor({ intentionId: 'dynamic' }), { system: 'presentation.system.dynamic@v0', segments: 'presentation.segments@v0', art: 'presentation.art@v0' })
})
