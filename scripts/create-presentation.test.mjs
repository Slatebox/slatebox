// presentations.create (owner, 2026-11-23: "yes to create_presentation making that a first class mcp tool"): one
// action, so the typed MCP tool create_presentation, exec's slatebox.presentations.create, the HTTP route and the
// CLI (through exec) all come from it. It plans with the Present button's planner (methods/presentations.js
// createPresentationFor: the AI feature presentation, counted like Present for the person behind the token), for
// someone who may edit the slate, and answers with the deck's steps and a link that plays it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createApiTokenService } from '../web/app/server/api-token-core.mjs'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'
import { buildClientManifest, renderExecTool } from '../web/app/server/actions/client-render.mjs'
import { buildOpenApi } from '../web/app/server/actions/openapi.mjs'
import { presentLink } from '../web/app/server/actions/presentations.mjs'
import { storedSlateLayout } from '../web/app/server/methods/presentationLayout.mjs'
import { deckRecord } from '../web/app/server/methods/presentationDeck.mjs'
import { STYLE_IDS } from '../web/app/imports/ui/components/presentations/presentationStyles.mjs'
import { whatIsSlatebox } from './presentation-fixtures.mjs'

const note = (id, text, x, y, links = []) => ({ options: { id, text, xPos: x, yPos: y, width: 100, height: 60 }, relationships: { associations: links } })

function world({ createPresentation } = {}) {
  const slates = [
    { _id: 's1', shareId: 'mine', userId: 'ana', options: { id: 's1', name: 'Launch', isPrivate: true }, nodes: [note('a', 'Goal', 0, 0)] },
    { _id: 's2', shareId: 'theirs', userId: 'ben', options: { id: 's2', name: 'Ben\'s', isPrivate: true }, nodes: [note('b', 'Idea', 0, 0)] },
  ]
  const service = createApiTokenService({
    apiTokens: { findOneAsync: async () => null, find: () => ({ fetchAsync: async () => [] }), insertAsync: async () => {}, updateAsync: async () => {}, countAsync: async () => 0 },
    users: { findOneAsync: async () => null },
    slates: { findOneAsync: async ({ shareId }) => slates.find((s) => s.shareId === shareId) ?? null },
    slateAccess: { find: () => ({ fetchAsync: async () => [] }) },
    now: () => 5000,
  })
  const asked = []
  const row = { _id: 'deck9', version: 3, name: 'Launch', presentationData: whatIsSlatebox(), ...deckRecord({ layout: whatIsSlatebox(), name: 'Launch' }) }
  const deps = {
    authorizeTokenForSlate: service.authorizeTokenForSlate,
    appOrigin: () => 'https://app.example',
    createPresentation: createPresentation ?? (async (request) => {
      asked.push(request)
      return { row: { ...row, _id: request.preview ? null : row._id, version: request.preview ? null : row.version }, automatic: false, reason: '' }
    }),
  }
  const store = new Map()
  const idempotency = {
    reserve: async ({ subject, key, action, fingerprint }) => {
      const id = `${subject}:${key}`
      if (store.has(id)) return { state: 'exists', record: store.get(id) }
      store.set(id, { state: 'pending', action, fingerprint })
      return { state: 'reserved' }
    },
    get: async (subject, key) => store.get(`${subject}:${key}`) ?? null,
    complete: async (subject, key, response) => { Object.assign(store.get(`${subject}:${key}`), { state: 'done', response }) },
    release: async (subject, key) => { store.delete(`${subject}:${key}`) },
  }
  const registry = createAppRegistry({ deps, idempotency, now: () => 7000 })
  const agent = (userId, scopes = ['slates:read', 'slates:write']) => ({ kind: 'agent', userId, tokenId: `t-${userId}`, tokenName: 'Agent', scopes })
  return { registry, agent, asked }
}

test('the action is on every surface: create_presentation, slatebox.presentations.create, POST /slates/{shareId}/presentation', () => {
  const registry = createAppRegistry()
  const action = registry.get('presentations.create')
  assert.equal(action.tool.name, 'create_presentation')
  assert.equal(action.tool.title, 'Create a presentation')
  assert.deepEqual([action.mounts.http.method, action.mounts.http.path, action.scope], ['POST', '/slates/{shareId}/presentation', 'slates:write'])
  assert.deepEqual([action.readOnly, action.destructive, action.idempotent, action.openWorld, action.idempotency], [false, false, false, true, 'optional'])
  assert.deepEqual(action.modes, ['save', 'preview'])
  assert.deepEqual(action.input.properties.style.enum, STYLE_IDS)
  assert.deepEqual(STYLE_IDS.slice().sort(), ['blueprint', 'calm', 'editorial', 'journey', 'neon', 'sketch', 'stage', 'voyage'])
  const manifest = buildClientManifest(registry)
  const tools = renderExecTool(manifest)
  assert.ok(manifest.methods.some((method) => method.name === 'presentations.create'))
  const typed = tools.typed.find((tool) => tool.method === 'presentations.create')
  assert.equal(typed.name, 'create_presentation')
  assert.deepEqual(typed.annotations, { title: 'Create a presentation', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true })
  assert.ok(tools.exec.description.includes('presentations.create({shareId,style?,palette?,brief?})'))
  assert.equal(buildOpenApi(registry).paths['/slates/{shareId}/presentation'].post['x-slatebox'].action, 'presentations.create')
  // Factual: what it does and returns, no instructions to the assistant.
  for (const text of [action.description, action.tool.description]) assert.doesNotMatch(text, /\b(you (must|should)|always|never|use when|tell the|show the)\b/i)
})

test('it plans for someone who may edit the slate and answers with the steps and the link that plays it', async () => {
  const { registry, agent, asked } = world()
  const made = await registry.run(agent('ana'), 'presentations.create', { shareId: 'mine', style: 'calm', palette: ['#112233', '#445566', '#778899'], brief: 'the risks' })
  assert.equal(made.status, 201)
  const body = made.body
  assert.deepEqual([body.presentationId, body.version, body.link, body.automatic, body.mode], ['deck9', 3, 'https://app.example/canvas/mine?present=1', false, 'save'])
  assert.ok(body.steps.length > 2)
  for (const step of body.steps) assert.ok(typeof step.layout === 'string' && typeof step.caption === 'string' && typeof step.kicker === 'string')
  assert.deepEqual(asked, [{ userId: 'ana', shareId: 'mine', brief: 'the risks', style: 'calm', palette: ['#112233', '#445566', '#778899'], preview: false }])
  assert.equal(presentLink('https://app.example', 'mine'), 'https://app.example/canvas/mine?present=1')
})

test('a preview plans and saves nothing: no id, no link', async () => {
  const { registry, agent, asked } = world()
  const tried = await registry.run(agent('ana'), 'presentations.create', { shareId: 'mine', mode: 'preview' })
  assert.deepEqual([tried.body.presentationId, tried.body.link, tried.body.mode], [null, null, 'preview'])
  assert.equal(asked[0].preview, true)
})

test('the Present button\'s rule: someone who may not edit cannot, a token without slates:write cannot, and nothing is planned', async () => {
  const { registry, agent, asked } = world()
  await assert.rejects(registry.run(agent('ana'), 'presentations.create', { shareId: 'theirs' }), (error) => error.status === 403)
  await assert.rejects(registry.run(agent('ana', ['slates:read']), 'presentations.create', { shareId: 'mine' }), { code: 'insufficient_scope' })
  await assert.rejects(registry.run(agent('ana'), 'presentations.create', { shareId: 'nope' }), (error) => error.status === 404)
  // The server's own check (canEditSlate, as Present) refusing is a 403 too.
  const denied = world({ createPresentation: async () => { throw Object.assign(new Error('denied'), { error: 'slate-denied' }) } })
  await assert.rejects(denied.registry.run(denied.agent('ana'), 'presentations.create', { shareId: 'mine' }), (error) => error.status === 403 && error.code === 'forbidden')
  assert.deepEqual(asked, [])
})

test('input is checked: a known style, a palette only with a style, a brief within the limit; an empty slate is refused', async () => {
  const { registry, agent, asked } = world()
  await assert.rejects(registry.run(agent('ana'), 'presentations.create', { shareId: 'mine', style: 'disco' }), { code: 'invalid_request' })
  await assert.rejects(registry.run(agent('ana'), 'presentations.create', { shareId: 'mine', palette: ['#112233', '#445566', '#778899'] }), { code: 'invalid_request' })
  await assert.rejects(registry.run(agent('ana'), 'presentations.create', { shareId: 'mine', brief: 'x'.repeat(4001) }), { code: 'invalid_request' })
  assert.deepEqual(asked, [])
  const empty = world({ createPresentation: async () => ({ empty: true, reason: 'There are no notes on this slate to present yet.' }) })
  await assert.rejects(empty.registry.run(empty.agent('ana'), 'presentations.create', { shareId: 'mine' }),
    (error) => error.status === 409 && error.details?.reason === 'empty')
})

test('a retried call with the same Idempotency-Key is answered with the first result and plans nothing more', async () => {
  const { registry, agent, asked } = world()
  const first = await registry.run(agent('ana'), 'presentations.create', { shareId: 'mine' }, { idempotencyKey: 'k1' })
  const again = await registry.run(agent('ana'), 'presentations.create', { shareId: 'mine' }, { idempotencyKey: 'k1' })
  assert.deepEqual(again.body, first.body)
  assert.equal(again.meta.replayed, true)
  assert.equal(asked.length, 1)
})

test('when the AI cannot plan, the grouped plan comes back with the reason', async () => {
  const row = { _id: 'd', version: 1, viewpoints: [{ nodeIds: ['a'], narrative: 'Goal', layout: 'group' }], direction: null, style: null }
  const fallback = world({ createPresentation: async () => ({ row, automatic: true, reason: 'Slatebox took too long to plan this slate.' }) })
  const made = await fallback.registry.run(fallback.agent('ana'), 'presentations.create', { shareId: 'mine' })
  assert.deepEqual([made.body.automatic, made.body.reason, made.body.style, made.body.steps.length], [true, 'Slatebox took too long to plan this slate.', null, 1])
})

test('the server plans from the slate as stored: the same tree the engine gives Present', () => {
  const layout = storedSlateLayout({
    options: { name: 'Plan' },
    nodes: [
      note('root', 'Launch', 100, 200, [{ parentId: 'root', childId: 'kid' }]),
      note('kid', 'Pricing', 300, 260, [{ parentId: 'root', childId: 'kid' }]),
      { options: { id: 'frame', text: 'Category', isCategory: true, xPos: 0, yPos: 0, width: 900, height: 900 } },
      note('lone', 'Risks', 500, 200),
    ],
  })
  assert.deepEqual(layout.nodes.map((node) => [node.nodeId, node.childrenNodes.map((kid) => kid.nodeId)]), [['root', ['kid']], ['lone', []]])
  assert.deepEqual(layout.nodes[0].metrics, { rotation: 0, bbox: { x: 0, y: 0, width: 100, height: 60 } })
  assert.deepEqual(layout.nodes[0].childrenNodes[0].metrics.bbox, { x: 200, y: 60, width: 100, height: 60 })
  assert.equal(layout.nodes[0].description, 'Launch')
  assert.deepEqual([layout.presentationWidth, layout.presentationHeight], [500, 120])
  // A loop of connected notes still starts a tree, so its notes are planned.
  const loop = storedSlateLayout({ nodes: [note('x', 'X', 0, 0, [{ parentId: 'x', childId: 'y' }]), note('y', 'Y', 0, 100, [{ parentId: 'y', childId: 'x' }])] })
  assert.deepEqual(loop.nodes.map((node) => node.nodeId), ['x'])
  assert.deepEqual(loop.nodes[0].childrenNodes.map((node) => node.nodeId), ['y'])
})

test('the server plan is Present\'s: its permission check, its planner and the AI counted for the token\'s person', () => {
  const source = readFileSync(new URL('../web/app/server/methods/presentations.js', import.meta.url), 'utf8')
  const create = source.slice(source.indexOf('export async function createPresentationFor'), source.indexOf('method[CONSTANTS.methods.presentations.update]'))
  assert.match(create, /await guardPresentation\(shareId, user\._id\)/)
  assert.match(create, /runAIAction\(\{ feature: 'presentation', estimateMicros, userId: user\._id \}, fn\)/)
  assert.match(create, /analyzePresentation\(args, user, stored, layout, counted, \{ brief, persist: !preview, keyed: false \}\)/)
  assert.match(create, /styleChange\(row, palette \? \{ id: style, overrides: \{ palette \} \} : \{ id: style \}\)/)
  // The model is chosen for that person: the presentation part's model in Admin → AI control (or their own AI).
  assert.match(source, /feature: 'presentation',\n\s+\/\/ Named, so a plan/)
  assert.match(source, /resolveRequestConnection\(\{ feature: 'presentation', request: \{ tools: true \}, userId: user\._id \}\)/)
  assert.match(source, /if \(!persist\) \{\n\s+return \{ presentationId: null/)
  // The presenter opens a presentation's link: /canvas/<id>?present=1 starts Present for someone who may edit.
  const toolbar = readFileSync(new URL('../web/app/imports/ui/components/CanvasToolbar.jsx', import.meta.url), 'utf8')
  assert.match(toolbar, /search\.get\('present'\) === '1'/)
  assert.match(toolbar, /if \(!presentAsked \|\| !slate \|\| !manage\) return/)
})
