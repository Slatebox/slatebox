// The AI control store (web/app/server/ai-control/store.mjs): a change and its audit row in one
// call, the generation moves on, the audit row never carries a key, refused changes are recorded,
// and nothing can change or remove an audit row.
import test from 'node:test'
import assert from 'node:assert/strict'
import { COLLECTIONS, ControlStoreError, STATE_ID, createControlStore, ensureAIControlIndexes, redact } from '../web/app/server/ai-control/store.mjs'

function memoryCollection() {
  const docs = new Map()
  const indexes = []
  return {
    docs, indexes,
    async findOne(query) { const doc = docs.get(query._id); return doc ? structuredClone(doc) : null },
    async replaceOne(query, doc, options = {}) {
      if (!docs.has(query._id) && !options.upsert) return { matchedCount: 0 }
      docs.set(query._id, structuredClone(doc))
      return { matchedCount: 1 }
    },
    async deleteOne(query) { return { deletedCount: docs.delete(query._id) ? 1 : 0 } },
    async insertOne(doc) {
      if (docs.has(doc._id)) throw new Error('duplicate key')
      docs.set(doc._id, structuredClone(doc))
      return { insertedId: doc._id }
    },
    async findOneAndUpdate(query, update, options = {}) {
      let doc = docs.get(query._id)
      if (!doc) {
        if (!options.upsert) return null
        doc = { _id: query._id, ...(update.$setOnInsert || {}) }
      }
      for (const [key, by] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + by
      Object.assign(doc, update.$set || {})
      docs.set(query._id, doc)
      return structuredClone(doc)
    },
    async createIndex(keys, options = {}) { indexes.push({ keys, options }) },
  }
}

function setup() {
  const collections = Object.fromEntries(Object.keys(COLLECTIONS).map((key) => [key, memoryCollection()]))
  let id = 0
  const swaps = []
  const store = createControlStore({ collections, newId: () => `a${++id}`, now: () => new Date('2026-11-24T10:00:00Z'), onWrite: (g) => swaps.push(g) })
  return { collections, store, swaps }
}

const ADMIN = { userId: 'root', principal: 'person', via: 'ddp' }

test('a write saves the document, appends its audit row and moves the generation on', async () => {
  const { collections, store, swaps } = setup()
  const doc = { surface: 'agent.slatebox', scope: { level: 'server' }, chain: [{ model: 'muse:muse-ember-1.0' }], status: 'published', version: 1 }
  const first = await store.write({ kind: 'bindings', id: 'agent.slatebox|server', doc, action: 'ai.bindings.publish', actor: ADMIN, reason: 'agent on muse' })
  assert.equal(first.generation, 1)
  assert.deepEqual(swaps, [1])
  const saved = collections.bindings.docs.get('agent.slatebox|server')
  assert.equal(saved.updatedBy, 'root')
  assert.deepEqual(saved.chain, doc.chain)
  const row = collections.audit.docs.get(first.auditId)
  assert.equal(row.action, 'ai.bindings.publish')
  assert.deepEqual(row.actor, { userId: 'root', principal: 'person', via: 'ddp' })
  assert.deepEqual(row.target, { kind: 'bindings', id: 'agent.slatebox|server' })
  assert.equal(row.before, null)
  assert.equal(row.after.surface, 'agent.slatebox')
  assert.equal(row.reason, 'agent on muse')
  assert.equal(row.generation, 1)
  assert.equal(row.outcome, 'ok')
  // a second change records the first as before; a removal records after null
  const second = await store.write({ kind: 'bindings', id: 'agent.slatebox|server', doc: { ...doc, version: 2 }, action: 'ai.bindings.publish', actor: ADMIN, reason: 'v2' })
  assert.equal(second.generation, 2)
  assert.equal(collections.audit.docs.get(second.auditId).before.version, 1)
  const removed = await store.write({ kind: 'bindings', id: 'agent.slatebox|server', doc: null, action: 'ai.bindings.remove', actor: ADMIN, reason: 'back to chat' })
  assert.equal(collections.bindings.docs.has('agent.slatebox|server'), false)
  assert.equal(collections.audit.docs.get(removed.auditId).after, null)
  assert.equal(collections.state.docs.get(STATE_ID).generation, 3)
})

test('no key, cipher or key-looking value reaches the audit trail; the fingerprint does', async () => {
  const { collections, store } = setup()
  const connection = {
    provider: 'gemini', name: 'gem', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    cipher: 'AAAAsealedBYTESthatAreLongEnoughToLookLikeAKey==', keyFingerprint: 'sha256:1a2b3c4d…a91f',
    previousCipher: { cipher: 'old-sealed', until: new Date('2026-11-25') }, apiKey: 'AIzaSyD-not-a-real-key-000000000000', note: 'sk-proj-abcdefghijklmnop',
  }
  const result = await store.write({ kind: 'models', id: 'gem:x', doc: connection, action: 'ai.connections.save', actor: ADMIN })
  const row = collections.audit.docs.get(result.auditId)
  const text = JSON.stringify(row)
  for (const secret of ['sealedBYTES', 'old-sealed', 'AIzaSy', 'sk-proj']) assert.ok(!text.includes(secret), `${secret} leaked: ${text}`)
  assert.deepEqual(row.after.cipher, { redacted: true, fingerprint: 'sha256:1a2b3c4d…a91f' })
  assert.deepEqual(row.after.previousCipher, { redacted: true, fingerprint: 'sha256:1a2b3c4d…a91f' })
  assert.deepEqual(row.after.note, { redacted: true, fingerprint: 'sha256:1a2b3c4d…a91f' })
  assert.equal(row.after.keyFingerprint, 'sha256:1a2b3c4d…a91f')
  // what the write returns is redacted too
  assert.ok(!JSON.stringify(result).includes('AIzaSy'))
  // ordinary values stay
  assert.deepEqual(redact({ model: 'Qwen/Qwen3-235B-A22B-Instruct-2507', body: 'Draw {{count}} shapes.', n: 3, at: new Date(0) }),
    { model: 'Qwen/Qwen3-235B-A22B-Instruct-2507', body: 'Draw {{count}} shapes.', n: 3, at: new Date(0) })
})

test('publish, rollback, remove, reset and rotate need a reason; actors and actions are checked', async () => {
  const { store } = setup()
  const base = { kind: 'prompts', id: 'shape.system', doc: { labels: { published: 2 } }, actor: ADMIN }
  for (const action of ['ai.prompts.publish', 'ai.prompts.rollback', 'ai.connections.remove', 'ai.control.reset', 'ai.connections.rotate', 'ai.control.setGlobal']) {
    await assert.rejects(store.write({ ...base, action }), (error) => error instanceof ControlStoreError && /needs a reason/.test(error.message), action)
  }
  await store.write({ ...base, action: 'ai.prompts.saveDraft' })
  await assert.rejects(store.write({ ...base, action: 'ai.prompts.publish', reason: 'x'.repeat(501) }), /at most 500/)
  await assert.rejects(store.write({ ...base, action: 'slates.delete', reason: 'r' }), /ai\.<area>\.<verb>/)
  await assert.rejects(store.write({ ...base, action: 'ai.prompts.saveDraft', actor: { userId: 'x', principal: 'guest' } }), /principal/)
  await assert.rejects(store.write({ ...base, action: 'ai.prompts.saveDraft', actor: { ...ADMIN, via: 'carrier-pigeon' } }), /via/)
  await assert.rejects(store.write({ ...base, kind: 'audit', action: 'ai.prompts.saveDraft' }), /not an AI control collection/)
  await assert.rejects(store.write({ ...base, doc: [1], action: 'ai.prompts.saveDraft' }), /is an object/)
})

test('refused changes are recorded; the audit trail has no way to be changed', async () => {
  const { collections, store } = setup()
  const row = await store.refused({ action: 'ai.bindings.publish', actor: { userId: 'mallory', principal: 'agent', via: 'mcp', tokenId: 't1' }, target: { kind: 'bindings', id: 'chat|server' }, error: 'Only a person publishes.' })
  assert.equal(row.outcome, 'refused')
  assert.equal(row.actor.tokenId, 't1')
  assert.equal(collections.audit.docs.size, 1)
  // a malformed actor is still recorded, not thrown
  const odd = await store.refused({ action: 'ai.x.y', actor: { principal: 'robot' }, error: 'no' })
  assert.equal(odd.actor.principal, 'unknown')
  assert.deepEqual(Object.keys(store).sort(), ['bump', 'refused', 'state', 'write'])
})

test('the global state keeps its generation moving forward', async () => {
  const { collections, store } = setup()
  assert.deepEqual(await store.state(), { _id: STATE_ID, generation: 0, aiEnabled: true, dbLayer: 'on' })
  await store.write({ kind: 'prompts', id: 'p', doc: {}, action: 'ai.prompts.saveDraft', actor: ADMIN })
  const off = await store.write({ kind: 'state', id: STATE_ID, doc: { aiEnabled: false, aiDisabledMessage: 'Paused.', generation: 0, dbLayer: 'on' }, action: 'ai.control.setGlobal', actor: ADMIN, reason: 'incident' })
  assert.equal(off.generation, 2)
  assert.equal(collections.state.docs.get(STATE_ID).generation, 2)
  assert.equal(collections.state.docs.get(STATE_ID).aiEnabled, false)
})

test('indexes: the audit trail expires after 400 days unless the settings say otherwise', async () => {
  const { collections } = setup()
  await ensureAIControlIndexes(collections)
  const ttl = collections.audit.indexes.find((i) => i.options.expireAfterSeconds)
  assert.equal(ttl.options.expireAfterSeconds, 400 * 86400)
  assert.ok(collections.promptVersions.indexes.some((i) => i.options.unique))
  const other = setup().collections
  await ensureAIControlIndexes(other, { auditDays: 30 })
  assert.equal(other.audit.indexes.find((i) => i.options.expireAfterSeconds).options.expireAfterSeconds, 30 * 86400)
})
