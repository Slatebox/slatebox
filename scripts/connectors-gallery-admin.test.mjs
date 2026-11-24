// /admin/ai › Gallery (owner, 2026-11-24: "the prompting behind all of this is in our admin page?"):
// the invite gallery's cards, their order and recipes are aiAgents documents, each change written
// through the AI control store (an audit row, the generation moves); a card's address never changes;
// only a person saves; the service serves the live gallery.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/connectors-gallery-admin.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COLLECTIONS, createControlStore } from '../web/app/server/ai-control/store.mjs'
import { buildSnapshot } from '../web/app/server/ai-control/snapshot.mjs'
import { PROMPT_IDS } from '../web/app/server/ai-control/prompts/index.mjs'
import { GALLERY } from '../enterprise/common/gallery.mjs'
import { checkCardEdit, createGalleryOps, galleryActions, liveGallery } from '../enterprise/server/gallery-admin.mjs'

function memoryCollection() {
  const docs = new Map()
  return {
    docs,
    async findOne(query) { const doc = docs.get(query._id); return doc ? structuredClone(doc) : null },
    async replaceOne(query, doc, options = {}) { if (!docs.has(query._id) && !options.upsert) return { matchedCount: 0 }; docs.set(query._id, structuredClone(doc)); return { matchedCount: 1 } },
    async deleteOne(query) { return { deletedCount: docs.delete(query._id) ? 1 : 0 } },
    async insertOne(doc) { docs.set(doc._id, structuredClone(doc)); return { insertedId: doc._id } },
    async findOneAndUpdate(query, update, options = {}) {
      let doc = docs.get(query._id)
      if (!doc) { if (!options.upsert) return null; doc = { _id: query._id, ...(update.$setOnInsert || {}) } }
      for (const [key, by] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + by
      Object.assign(doc, update.$set || {})
      docs.set(query._id, doc)
      return structuredClone(doc)
    },
    async createIndex() {},
  }
}
function setup() {
  const collections = Object.fromEntries(Object.keys(COLLECTIONS).map((key) => [key, memoryCollection()]))
  let id = 0
  const store = createControlStore({ collections, newId: () => `a${++id}`, now: () => new Date('2026-11-24T10:00:00Z') })
  const ops = createGalleryOps({ find: async () => [...collections.agents.docs.values()], store })
  return { collections, store, ops }
}
const ADMIN = { userId: 'root', principal: 'person', via: 'ddp' }

test('the built-in cards serve until edited; an edit changes words, recipe, on/off and order, never the address', async () => {
  const { collections, ops } = setup()
  assert.deepEqual((await ops.live()).map((c) => c.id), GALLERY.map((c) => c.id))
  await ops.save({ actor: ADMIN, id: 'github', changes: { lands: 'Your commits and pull requests as linked notes.', enabled: true } })
  await ops.save({ actor: ADMIN, id: 'exa', changes: { enabled: false } })
  const live = await ops.live()
  assert.equal(live.find((c) => c.id === 'github').lands, 'Your commits and pull requests as linked notes.')
  assert.equal(live.find((c) => c.id === 'github').url, 'https://api.githubcopilot.com/mcp/')
  assert.ok(!live.some((c) => c.id === 'exa'), 'a card turned off is not offered')
  const ids = ['github', ...GALLERY.map((c) => c.id).filter((id) => id !== 'github')]
  await ops.reorder({ actor: ADMIN, ids })
  assert.equal((await ops.live())[0].id, 'github')
  // every change has its audit row
  const rows = [...collections.audit.docs.values()].map((r) => r.action)
  assert.ok(rows.includes('ai.agents.gallery.save') && rows.includes('ai.agents.gallery.reorder'))
  // the documents are valid AI control agents (the snapshot keeps them, health stays clean)
  const snap = buildSnapshot({ state: { generation: 3, dbLayer: 'on' }, agents: [...collections.agents.docs.values()] }, { codePromptIds: PROMPT_IDS })
  assert.ok(Object.keys(snap.agents).length >= 2)
  assert.deepEqual(snap.health.filter((h) => h.kind === 'agent'), [])
  // listing shows what is off, the retired agents and the prompt that hints each card's planner
  const listed = await ops.list()
  assert.equal(listed.cards.find((c) => c.id === 'exa').enabled, false)
  assert.equal(listed.cards.find((c) => c.id === 'github').promptId, 'connectors.recipe.github')
  assert.deepEqual(listed.retired.map((c) => c.id), ['excalidraw', 'apexcharts'])
})

test('a card edit is checked: plain words, no address change, a recipe that reads', () => {
  assert.throws(() => checkCardEdit('github', { url: 'https://evil.example/mcp' }), /address cannot change/)
  assert.throws(() => checkCardEdit('nope', { enabled: false }), /not a card/)
  assert.throws(() => checkCardEdit('github', { lands: 'See https://evil.example' }), /no web addresses/)
  assert.throws(() => checkCardEdit('github', { recipe: { intents: [{ key: 'x', keywords: ['('], steps: [{ tool: 'get_me' }] }] } }), /missing its key, its words or its steps/)
  const ok = checkCardEdit('github', { name: ' GitHub‮ ', recipe: { rounds: 9, calls: 99, intents: [{ key: 'mine', keywords: ['\\bmine\\b'], steps: [{ tool: 'get_me', args: {} }] }] } })
  assert.equal(ok.name, 'GitHub')
  assert.deepEqual({ rounds: ok.recipe.rounds, calls: ok.recipe.calls }, { rounds: 3, calls: 5 }, 'clamped to the recipe ceiling')
  // a saved recipe that no longer reads falls back to the built-in one
  assert.deepEqual(liveGallery([{ kind: 'outbound-connector', galleryId: 'github', recipe: 'junk' }])[1].recipe ?? liveGallery([{ kind: 'outbound-connector', galleryId: 'github', recipe: 'junk' }]).find((c) => c.id === 'github').recipe, GALLERY.find((c) => c.id === 'github').recipe)
})

test('the actions: administrators only; saving and reordering are people only, on the app\'s page', async () => {
  const actions = galleryActions(() => async () => [])
  const byId = Object.fromEntries(actions.map((a) => [a.id, a]))
  assert.deepEqual(Object.keys(byId).sort(), ['ai.agents.gallery.list', 'ai.agents.gallery.reorder', 'ai.agents.gallery.save'])
  for (const id of ['ai.agents.gallery.save', 'ai.agents.gallery.reorder']) {
    assert.deepEqual(byId[id].principals, ['person'], id)
    assert.ok(byId[id].mounts.ddp && !byId[id].mounts.http, id)
    assert.equal(byId[id].toolset, 'admin')
  }
  assert.ok(byId['ai.agents.gallery.list'].mounts.http)
  const { store } = setup()
  const deps = { aiControlAdmin: async (userId) => userId === 'root', aiControlStore: store }
  await assert.rejects(byId['ai.agents.gallery.list'].handler({ kind: 'person', userId: 'ana' }, {}, { deps }), /Only an administrator/)
  const listed = await byId['ai.agents.gallery.list'].handler({ kind: 'person', userId: 'root' }, {}, { deps })
  assert.equal(listed.body.cards.length, GALLERY.length)
  await assert.rejects(byId['ai.agents.gallery.save'].handler({ kind: 'agent', userId: 'root', tokenId: 't' }, { id: 'github', changes: { enabled: false } }, { deps }), /Only a person changes the agent gallery/)
})
