// Mermaid through the API (and so MCP, the CLI and exec): export_mermaid reads any slate the
// caller may read as Mermaid, import_mermaid draws Mermaid as real notes and lines on a slate
// the caller may edit or on a new private slate, and a public slate has a stable plain-text
// address, /slates/<id>.mmd. The registry runs here on in-memory stores.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import express from 'express'
import { beforeEach, test } from 'node:test'
import { createSlateSaveCore } from '../web/app/server/slate-save-core.mjs'
import { createApiTokenService } from '../web/app/server/api-token-core.mjs'
import { actions, createAppRegistry } from '../web/app/server/actions/index.mjs'
import { buildContract } from '../web/app/server/actions/contract.mjs'
import { createIdempotencyStore } from '../web/app/server/actions/idempotency.mjs'
import { principalFromToken, principalFromUser } from '../web/app/server/actions/principal.mjs'
import { mountMermaidFiles } from '../web/app/server/actions/mermaid-file.mjs'
import { API_TOKEN_SCOPES } from '../web/app/server/api-token-core.mjs'
import { memoryDriverCollection, memoryMeteorCollection, serve } from './action-test-stores.mjs'
import { mermaidStructure } from './mermaid-oracle.mjs'
import { NOTE_STYLE } from '../web/app/imports/api/common/mermaid/plan.mjs'

const { applyPlanToJSON } = createRequire(new URL('../web/app/package.json', import.meta.url))('slateboxjs/operations')

const note = (id, text, x, y) => ({
  options: { id, text, xPos: x, yPos: y, width: 180, height: 80, vectorPath: 'rectangle' },
  relationships: { associations: [] },
})

let world

function makeWorld() {
  const users = memoryMeteorCollection('user')
  users.docs.push({ _id: 'owner' }, { _id: 'reader' }, { _id: 'guest', isAnonymous: true })
  const tokens = memoryMeteorCollection('token')
  const grants = memoryMeteorCollection('grant')
  const slates = []
  const add = (row) => {
    slates.push({ revision: 0, lastSaved: 1000, ...row })
    return slates.at(-1)
  }
  const demo = add({
    _id: 'slate-1', shareId: 'demo', userId: 'owner',
    options: { name: 'Demo', isPrivate: true },
    nodes: [
      { ...note('a', 'Plan', 0, 0), relationships: { associations: [{ id: 'a->b', parentId: 'a', childId: 'b', label: 'then' }] } },
      { ...note('b', 'Ship "it"', 300, 0), options: { ...note('b', 'Ship "it"', 300, 0).options, backgroundColor: '#e2f0d9', borderColor: '#38761d' } },
    ],
  })
  const open = add({
    _id: 'slate-2', shareId: 'open', userId: 'owner',
    options: { name: 'Open map', isPublic: true, isPrivate: false },
    nodes: [note('x', 'Public idea', 0, 0)],
  })
  add({
    _id: 'slate-3', shareId: 'plan', userId: 'owner',
    options: { name: 'Plan board' },
    nodes: [note('own', 'Own note', 0, 0)],
    creative: { revision: 2, model: { kind: 'workshop', version: 1, workshop: {
      version: 1, kind: 'release-plan', title: 'Plan board',
      lanes: [{ id: 'now', label: 'Now' }, { id: 'next', label: 'Next' }],
      cards: [{ id: 'one', label: 'One', laneId: 'now', points: 2 }, { id: 'two', label: 'Two', laneId: 'next', points: 1, dependsOn: ['one'] }],
    } } },
  })
  add({ _id: 'slate-4', shareId: 'gallery', userId: 'owner', options: { name: 'Gallery' }, nodes: [], creative: { revision: 0, model: { kind: 'moon-gallery' } } })
  grants.docs.push({ slateId: 'slate-1', type: 'private', userId: 'reader', slateAccessPermissionId: 'READ' })
  const byShareId = (shareId) => slates.find((s) => s.shareId === shareId) ?? null
  const service = createApiTokenService({
    apiTokens: tokens,
    users,
    slates: { findOneAsync: async ({ shareId }) => byShareId(shareId) },
    slateAccess: grants,
    now: () => 5000,
  })
  const runs = []
  const events = []
  const saveCore = createSlateSaveCore({
    slates: {
      async findOne(selector) {
        const slate = slates.find((s) => s._id === selector._id)
        if (!slate) return null
        const holds = Object.entries(selector).every(([key, want]) =>
          key === 'revision' ? (slate.revision ?? null) === want : want === null ? slate[key] == null : key.includes('.') ? true : slate[key] === want)
        return holds ? structuredClone(slate) : null
      },
      async updateOne(selector, modifier) {
        const slate = slates.find((s) => s._id === selector._id)
        if (!slate || (slate.revision ?? null) !== selector.revision) return { matchedCount: 0 }
        for (const [path, value] of Object.entries(modifier.$set)) {
          const keys = path.split('.')
          keys.slice(0, -1).reduce((record, key) => (record[key] ||= {}), slate)[keys.at(-1)] = value
        }
        slate.revision = (slate.revision ?? 0) + 1
        return { matchedCount: 1 }
      },
      async insertOne(row) {
        slates.push(structuredClone(row))
        return { insertedId: row._id }
      },
    },
    events: { insertOne: async (row) => events.push(row) },
    now: () => 2000,
  })
  let ids = 0
  const deps = {
    apiTokens: service,
    authorizeTokenForSlate: service.authorizeTokenForSlate,
    applySlateOperationPlanToJSON: applyPlanToJSON,
    saveCore,
    operationRuns: {
      findOneAsync: async (q) => runs.find((r) => r.tokenId === q.tokenId && r.idempotencyKey === q.idempotencyKey),
      insertAsync: async (run) => runs.push(run),
    },
    async resolveSlateForUser(shareId, userId) {
      const slate = byShareId(shareId)
      if (!slate) return null
      const owner = slate.userId === userId
      const grant = grants.docs.find((g) => g.slateId === slate._id && g.userId === userId)
      return { slate, canRead: owner || Boolean(grant) || slate.options.isPublic === true, canEdit: owner || grant?.slateAccessPermissionId === 'EDIT' }
    },
    loadUser: (userId) => users.findOneAsync({ _id: userId }),
    generateShareId: async () => `new${(ids += 1)}`,
    newId: () => `id-${(ids += 1)}`,
    appOrigin: () => 'https://app.example',
  }
  const idempotencyRows = memoryDriverCollection()
  const build = () => createAppRegistry({ deps, now: () => 3000, idempotency: createIdempotencyStore({ collection: idempotencyRows, now: () => 3000 }) })
  const authenticate = async (req) => principalFromToken(await service.authenticateApiRequest(req))
  const mint = (scopes = ['slates:read', 'slates:write'], userId = 'owner') => service.createApiToken({ userId, name: 'Agent', scopes })
  return { slates, demo, open, runs, events, build, authenticate, mint, byShareId, users }
}

beforeEach(() => {
  world = makeWorld()
})

const person = (userId) => principalFromUser(world.users.docs.find((u) => u._id === userId), API_TOKEN_SCOPES)

// ─── Declared once, served everywhere ──────────────────────────────────

test('export_mermaid and import_mermaid are actions with a route, a tool and a command', () => {
  const contract = buildContract(world.build())
  const exp = contract.actions.find((a) => a.id === 'slates.exportMermaid')
  const imp = contract.actions.find((a) => a.id === 'slates.importMermaid')
  assert.equal(exp.tool.name, 'export_mermaid')
  assert.equal(imp.tool.name, 'import_mermaid')
  assert.deepEqual([exp.http.method, exp.http.path], ['GET', '/api/v1/slates/{shareId}/mermaid'])
  assert.deepEqual([imp.http.method, imp.http.path], ['POST', '/api/v1/slates/mermaid'])
  assert.equal(exp.tool.annotations.readOnlyHint, true)
  assert.equal(imp.tool.annotations.destructiveHint, false, 'an import only adds')
  const action = actions.find((a) => a.id === 'slates.importMermaid')
  assert.ok(action.mounts.ddp, 'the app calls the same action')
  assert.deepEqual(action.modes, ['save', 'preview'])
})

// ─── Export ────────────────────────────────────────────────────────────

test('a token reads a slate it may open as Mermaid, in the format it asks for', async (t) => {
  const call = await serve(t, world.build(), world.authenticate)
  const { token } = await world.mint(['slates:read'])
  const got = await call('/api/v1/slates/demo/mermaid', { token })
  assert.equal(got.status, 200)
  assert.equal(got.body.format, 'flowchart')
  assert.equal(got.body.shareId, 'demo')
  assert.equal(got.body.revision, 0)
  assert.equal(got.body.markdown, '```mermaid\n' + got.body.mermaid + '\n```\n')
  assert.equal(got.body.publicUrl, null, 'a private slate has no public address')
  const read = await mermaidStructure(got.body.mermaid)
  assert.deepEqual(read.nodes.map((n) => n.text).sort(), ['Plan', 'Ship "it"'])
  assert.deepEqual(read.edges.map((e) => [e.from, e.to, e.text]), [['a', 'b', 'then']])
  const mind = await call('/api/v1/slates/demo/mermaid?format=mindmap', { token })
  assert.equal(mind.body.format, 'mindmap')
  const gantt = await call('/api/v1/slates/demo/mermaid?format=gantt', { token })
  assert.equal(gantt.status, 422)
  assert.equal(gantt.body.error.code, 'mermaid_unavailable')
  const plan = await call('/api/v1/slates/plan/mermaid?format=gantt&start=2026-12-01', { token })
  assert.equal(plan.status, 200)
  assert.match(plan.body.mermaid, /^gantt\n/)
  const bad = await call('/api/v1/slates/demo/mermaid?format=sequence', { token })
  assert.equal(bad.status, 400)
})

test('a public slate reads as Mermaid without a token; a private one does not', async (t) => {
  const call = await serve(t, world.build(), world.authenticate)
  const open = await call('/api/v1/slates/open/mermaid')
  assert.equal(open.status, 200)
  assert.equal(open.body.publicUrl, 'https://app.example/slates/open.mmd')
  const hidden = await call('/api/v1/slates/demo/mermaid')
  assert.equal(hidden.status, 401)
  // Someone invited to read may export; a stranger's token may not.
  const reader = await world.mint(['slates:read'], 'reader')
  assert.equal((await call('/api/v1/slates/demo/mermaid', { token: reader.token })).status, 200)
})

async function serveFiles(t, registry) {
  const app = express()
  mountMermaidFiles(app, registry)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  return async (path, headers = {}) => {
    const response = await fetch(base + path, { headers })
    return { status: response.status, headers: response.headers, text: await response.text() }
  }
}

test('a public slate has a stable plain-text address: /slates/<id>.mmd and .md', async (t) => {
  const registry = world.build()
  const get = await serveFiles(t, registry)
  const mmd = await get('/slates/open.mmd')
  assert.equal(mmd.status, 200)
  assert.equal(mmd.headers.get('content-type'), 'text/plain; charset=utf-8')
  assert.equal(mmd.headers.get('x-content-type-options'), 'nosniff')
  assert.match(mmd.text, /^---\ntitle: "Open map"\n---\nflowchart/)
  assert.match(mmd.text, /x\["Public idea"\]/)
  const md = await get('/slates/open.md')
  assert.equal(md.headers.get('content-type'), 'text/markdown; charset=utf-8')
  assert.equal(md.text, '```mermaid\n' + mmd.text.replace(/\n$/, '') + '\n```\n')
  assert.match((await get('/slates/open.mmd?format=mindmap')).text, /^mindmap\n/)
  // A private slate, or none, is not found, and says nothing more; a token is never read here.
  for (const path of ['/slates/demo.mmd', '/slates/nope.mmd']) {
    const missing = await get(path, { authorization: 'Bearer anything' })
    assert.equal(missing.status, 404)
    assert.equal(missing.text, 'Not found. Only a public slate has a Mermaid address.\n')
  }
  // Anything else under /slates is the app's own page.
  assert.equal((await get('/slates/open')).status, 404)
})

// ─── Import ────────────────────────────────────────────────────────────

const flow = 'flowchart LR\n  s1["First"] --> s2(["Second"])\n  s2 -.->|"maybe"| s3{"Third?"}\n  subgraph team["Team"]\n    s3\n  end'

test('import adds real notes and lines beside what a slate holds, and open canvases draw it', async (t) => {
  const call = await serve(t, world.build(), world.authenticate)
  const { token } = await world.mint()
  const preview = await call('/api/v1/slates/mermaid', { token, method: 'POST', body: { shareId: 'demo', mermaid: flow, mode: 'preview' } })
  assert.equal(preview.status, 200)
  assert.equal(preview.body.mode, 'preview')
  assert.deepEqual([preview.body.notes, preview.body.frames, preview.body.lines], [3, 1, 2])
  assert.equal(world.demo.nodes.length, 2, 'a preview saves nothing')
  assert.equal(world.runs.length, 0)

  const saved = await call('/api/v1/slates/mermaid', { token, key: 'import-1', method: 'POST', body: { shareId: 'demo', mermaid: flow } })
  assert.equal(saved.status, 201)
  assert.equal(saved.body.mode, 'save')
  assert.equal(saved.body.kind, 'flowchart')
  assert.equal(saved.body.revision, 1, 'one save')
  assert.equal(saved.body.url, 'https://app.example/canvas/demo')
  assert.deepEqual(saved.body.created, ['team', 's1', 's2', 's3'])
  const ids = world.demo.nodes.map((n) => n.options.id)
  assert.deepEqual(ids, ['a', 'b', 'team', 's1', 's2', 's3'])
  const byId = Object.fromEntries(world.demo.nodes.map((n) => [n.options.id, n.options]))
  assert.equal(byId.s2.shape, 'ellipse')
  assert.equal(byId.s3.shape, 'diamond')
  assert.equal(byId.team.text, 'Team')
  assert.ok(byId.s1.xPos > 480, 'to the right of the slate\'s own notes')
  // The new notes take after the slate's last note, as a note a person adds does.
  assert.equal(byId.s1.backgroundColor, '#e2f0d9')
  assert.equal(byId.s1.borderColor, '#38761d')
  const line = world.demo.nodes.flatMap((n) => n.relationships.associations).find((a) => a.parentId === 's2')
  assert.equal(line.label, 'maybe')
  assert.equal(line.lineDash, 'dotted')
  // The run is what open canvases replay (SlateOperationListener): the same plan, as saved.
  assert.equal(world.runs.length, 1)
  assert.equal(world.runs[0].slateShareId, 'demo')
  assert.equal(world.runs[0].idempotencyKey, 'import-1')
  assert.equal(world.runs[0].plan.operations.length, 6)
  // Exported again, it reads as it was written.
  const back = await call('/api/v1/slates/demo/mermaid', { token })
  const read = await mermaidStructure(back.body.mermaid)
  assert.deepEqual(read.subgraphs.map((s) => [s.id, s.title, s.nodes]), [['team', 'Team', ['s3']]])
  // The same key and body replay; the slate does not change again.
  const again = await call('/api/v1/slates/mermaid', { token, key: 'import-1', method: 'POST', body: { shareId: 'demo', mermaid: flow } })
  assert.equal(again.status, 200)
  assert.equal(world.demo.nodes.length, 6)
})

test('a large import is saved once and replayed on open canvases in plans of at most 50 operations', async (t) => {
  const call = await serve(t, world.build(), world.authenticate)
  const { token } = await world.mint()
  const lines = ['flowchart TD']
  for (let k = 0; k < 60; k += 1) lines.push(`  n${k} --> n${k + 1}`)
  const saved = await call('/api/v1/slates/mermaid', { token, key: 'big', method: 'POST', body: { shareId: 'demo', mermaid: lines.join('\n') } })
  assert.equal(saved.status, 201)
  assert.equal(saved.body.notes, 61)
  assert.equal(world.demo.revision, 1)
  assert.equal(world.runs.length, 3)
  assert.ok(world.runs.every((run) => run.plan.operations.length <= 50))
  assert.deepEqual(world.runs.map((run) => run.idempotencyKey), ['big', null, null], 'the key names the first run only')
  assert.deepEqual(world.runs.map((run) => run.createdAt), [3000, 3001, 3002], 'in order')
  // Replaying the runs in order on the slate as it was gives the slate as saved.
  let replay = { options: {}, nodes: makeWorld().demo.nodes }
  for (const run of world.runs) replay = applyPlanToJSON(replay, run.plan, { replay: true }).slate
  assert.deepEqual(replay.nodes.map((n) => n.options.id), world.demo.nodes.map((n) => n.options.id))
})

test('import with no slate makes a new private slate of the caller\'s; a mind map is a mind-map slate', async (t) => {
  const call = await serve(t, world.build(), world.authenticate)
  const { token } = await world.mint()
  const made = await call('/api/v1/slates/mermaid', {
    token, key: 'new-1', method: 'POST',
    body: { mermaid: 'mindmap\n  root((Launch))\n    A\n    B', name: 'Ideas' },
  })
  assert.equal(made.status, 201)
  const row = world.byShareId(made.body.shareId)
  assert.equal(row.userId, 'owner')
  assert.equal(row.options.name, 'Ideas')
  assert.equal(row.options.isPrivate, true)
  assert.equal(row.options.mindMapMode, true)
  assert.equal(row.nodes.length, 3)
  // On a new slate the notes look like the first note a person adds there.
  assert.ok(row.nodes.every((n) => n.options.backgroundColor === NOTE_STYLE.backgroundColor), row.nodes.map((n) => n.options.backgroundColor).join(' '))
  assert.equal(made.body.url, `https://app.example/canvas/${made.body.shareId}`)
  assert.equal(made.body.kind, 'mindmap')
  // The front matter title names a slate when no name is given.
  const titled = await call('/api/v1/slates/mermaid', { token, key: 'new-2', method: 'POST', body: { mermaid: '---\ntitle: From README\n---\nflowchart TD\n  A --> B' } })
  assert.equal(world.byShareId(titled.body.shareId).options.name, 'From README')
})

test('another kind of diagram is refused with a plain reason and nothing changes; a mistake names its line', async (t) => {
  const call = await serve(t, world.build(), world.authenticate)
  const { token } = await world.mint()
  const seq = await call('/api/v1/slates/mermaid', { token, method: 'POST', body: { shareId: 'demo', mermaid: 'sequenceDiagram\n  A->>B: hi' } })
  assert.equal(seq.status, 422)
  assert.equal(seq.body.error.code, 'mermaid_unsupported')
  assert.match(seq.body.error.message, /sequence diagram/)
  const broken = await call('/api/v1/slates/mermaid', { token, method: 'POST', body: { shareId: 'demo', mermaid: 'flowchart TD\n  A --> B\n  C["open' } })
  assert.equal(broken.status, 400)
  assert.equal(broken.body.error.code, 'mermaid_invalid')
  assert.equal(broken.body.error.details.line, 3)
  assert.equal(world.demo.nodes.length, 2)
  assert.equal(world.slates.length, 4)
})

test('an import too large for a slate is refused early with a plain reason (422), never a server error', async (t) => {
  const call = await serve(t, world.build(), world.authenticate)
  const { token } = await world.mint()
  const side = (p) => Array.from({ length: 1000 }, (_, k) => `${p}${k}`).join('&')
  const pairs = await call('/api/v1/slates/mermaid', { token, method: 'POST', body: { shareId: 'demo', mermaid: `flowchart TD\n${side('a')}-->${side('b')}` } })
  assert.equal(pairs.status, 422)
  assert.equal(pairs.body.error.code, 'mermaid_too_large')
  const nested = Array.from({ length: 60 }, (_, k) => `subgraph s${k}`).join('\n') + '\nx\n' + 'end\n'.repeat(60)
  const deep = await call('/api/v1/slates/mermaid', { token, method: 'POST', body: { mermaid: `flowchart TD\n${nested}`, mode: 'preview' } })
  assert.equal(deep.status, 422)
  assert.equal(deep.body.error.code, 'mermaid_too_large')
  // Too much for one frame: found only when laid out, refused the same way.
  const crowd = Array.from({ length: 400 }, (_, k) => `    p${k}["${'a long label that wraps '.repeat(6)}"]`).join('\n')
  const frame = await call('/api/v1/slates/mermaid', { token, method: 'POST', body: { shareId: 'demo', mermaid: `flowchart TD\n  subgraph Crowd["Everyone"]\n${crowd}\n  end` } })
  assert.equal(frame.status, 422)
  assert.equal(frame.body.error.code, 'mermaid_too_large')
  assert.match(frame.body.error.message, /Everyone/)
  assert.equal(world.demo.nodes.length, 2)
})

test('who may import: an editor; never a reader, a guest, or a token without write', async (t) => {
  const registry = world.build()
  const call = await serve(t, registry, world.authenticate)
  const readerToken = await world.mint(['slates:read', 'slates:write'], 'reader')
  const denied = await call('/api/v1/slates/mermaid', { token: readerToken.token, method: 'POST', body: { shareId: 'demo', mermaid: flow } })
  assert.equal(denied.status, 403)
  const readOnly = await world.mint(['slates:read'])
  assert.equal((await call('/api/v1/slates/mermaid', { token: readOnly.token, method: 'POST', body: { shareId: 'demo', mermaid: flow } })).body.error.code, 'insufficient_scope')
  // The app's own call (a Meteor method, a signed-in person) goes through the same action.
  const mine = await registry.run(person('owner'), 'slates.importMermaid', { shareId: 'demo', mermaid: flow })
  assert.equal(mine.status, 201)
  assert.equal(world.runs.at(-1).tokenId, null)
  await assert.rejects(registry.run(person('reader'), 'slates.importMermaid', { shareId: 'demo', mermaid: flow }), (e) => e.status === 404)
  await assert.rejects(registry.run(person('guest'), 'slates.importMermaid', { mermaid: flow }), (e) => e.code === 'registration_required')
})

test('a workshop slate takes an import beside its lanes; a slate that keeps its own drawing refuses one', async (t) => {
  const call = await serve(t, world.build(), world.authenticate)
  const { token } = await world.mint()
  // The canvas draws the workshop's lanes and cards as lane-* and card-* notes: an import named so takes other ids.
  const saved = await call('/api/v1/slates/mermaid', { token, method: 'POST', body: { shareId: 'plan', mermaid: 'flowchart TD\n  lane-now --> card-one' } })
  assert.equal(saved.status, 201)
  const ids = world.byShareId('plan').nodes.map((n) => n.options.id)
  assert.deepEqual(ids, ['own', 'lane-now_2', 'card-one_2'])
  const gallery = await call('/api/v1/slates/mermaid', { token, method: 'POST', body: { shareId: 'gallery', mermaid: flow } })
  assert.equal(gallery.status, 400)
  assert.equal(gallery.body.error.code, 'invalid_operation_plan')
})

// ─── Canonical export and sync import (a repository keeps the diagram) ──

test('canonical export reads back with sync: a relabel and a new line change only those, nothing moves', async (t) => {
  const call = await serve(t, world.build(), world.authenticate)
  const { token } = await world.mint()
  const out = await call('/api/v1/slates/demo/mermaid?canonical=true', { token })
  assert.equal(out.status, 200)
  assert.equal(out.body.canonical, true)
  assert.match(out.body.mermaid, /^%% slatebox:demo rev:0 hash:[0-9a-f]{16}\n/)
  assert.match(out.body.mermaid, /\n {2}a\["Plan"\]\n {2}b\["Ship #quot;it#quot;"\]\n {2}a -->\|"then"\| b\n/)
  const before = world.demo.nodes.map((n) => [n.options.id, n.options.xPos, n.options.yPos])
  const edited = out.body.mermaid.replace('"Plan"', '"Plan it"') + '  b --> a\n'
  const same = await call('/api/v1/slates/mermaid', { token, method: 'POST', body: { shareId: 'demo', mermaid: out.body.mermaid, sync: true, base: out.body.mermaid } })
  assert.equal(same.status, 200, 'the same diagram is no change and no save')
  assert.equal(world.demo.revision, 0)
  const synced = await call('/api/v1/slates/mermaid', { token, method: 'POST', body: { shareId: 'demo', mermaid: edited, sync: true, base: out.body.mermaid } })
  assert.equal(synced.status, 201)
  assert.deepEqual(synced.body.updated, ['a'])
  assert.deepEqual(synced.body.created, [])
  assert.equal(synced.body.lines, 1)
  assert.equal(world.demo.nodes.find((n) => n.options.id === 'a').options.text, 'Plan it')
  assert.deepEqual(world.demo.nodes.map((n) => [n.options.id, n.options.xPos, n.options.yPos]), before)
  assert.equal(world.runs.at(-1).plan.operations.length, 2, 'open canvases replay the two changes')
  const dropped = await call('/api/v1/slates/mermaid', { token, method: 'POST', body: { shareId: 'demo', mermaid: 'flowchart LR\n  a["Plan it"]\n', sync: true, base: edited } })
  assert.deepEqual(dropped.body.deleted, ['b'])
  const refused = await call('/api/v1/slates/mermaid', { token, method: 'POST', body: { mermaid: edited, sync: true } })
  assert.equal(refused.status, 400)
})
