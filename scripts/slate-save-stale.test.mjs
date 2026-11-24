// A canvas save from a page that is behind never overwrites notes its person did not change.
//
// The repro (app e2e app-save-path, with no relay): the owner types "Draft by the owner" and it is
// saved; the guest's page never hears of it, the guest types into another note, and the guest's
// whole-canvas save turned the owner's note back into "Draft". A page now sends what it changed
// since what it last knew the server held (slate-save-patch.mjs), and the server applies that to
// the slate as stored.
import assert from 'node:assert/strict'
import test from 'node:test'
import { saveNativeSlate } from '../web/app/server/methods/native-slate-save.mjs'
import { createSlateSaveCore } from '../web/app/server/slate-save-core.mjs'
import { applySavePatch, foldIntoBase, saveBaseOf, savePatch, validSavePatch } from '../web/app/imports/api/common/slate-save-patch.mjs'

const clone = value => structuredClone(value)
const note = (id, text, extra = {}) => ({ options: { id, text, xPos: 10, yPos: 20, ...extra.options }, relationships: { associations: [] }, ...extra.top })

// A stored slate the save core really writes to: $set (dotted paths), $inc and $push applied.
function store(doc) {
  const board = clone(doc)
  const get = (at, path) => path.split('.').reduce((v, k) => v?.[k], at)
  const set = (at, path, value) => {
    const keys = path.split('.')
    const last = keys.pop()
    const parent = keys.reduce((v, k) => (v[k] ??= {}), at)
    parent[last] = value
  }
  const match = selector => Object.entries(selector).every(([key, value]) => (get(board, key) ?? null) === (value ?? null))
  const slates = {
    async findOne(selector) { return match(selector) ? clone(board) : null },
    async updateOne(selector, update) {
      if (!match(selector)) return { matchedCount: 0 }
      for (const [path, value] of Object.entries(update.$set || {})) set(board, path, clone(value))
      for (const [path, value] of Object.entries(update.$inc || {})) set(board, path, (get(board, path) ?? 0) + value)
      for (const [path, { $each, $slice }] of Object.entries(update.$push || {})) set(board, path, [...(get(board, path) || []), ...$each].slice($slice))
      return { matchedCount: 1 }
    },
    async insertOne() { throw new Error('unexpected insert') },
  }
  const saveCore = createSlateSaveCore({ slates, events: { insertOne: async () => {} } })
  const deps = {
    slates, saveCore, denied: () => new Error('denied'),
    access: { find: () => ({ toArray: async () => [{ slateId: board._id, type: 'unlisted', userId: null, accessKey: 'editkey', slateAccessPermissionId: 'EDIT' }] }) },
    guestViews: { findOne: async () => ({ _id: 'receipt' }) }, isTeamAdmin: async () => false,
    rememberInvitedEdit: async () => {}, recordGuestEdit: async () => false, now: 1700000000000,
  }
  return { board, save: (user, request) => saveNativeSlate(deps, user, request) }
}

const owner = { _id: 'owner' }
const guest = { _id: 'guest' }
const slateDoc = () => ({
  _id: 'slate1', userId: 'owner', shareId: 'share1', revision: 1, recentTouches: [],
  options: { name: 'Plan', isUnlisted: true, theme: 'light' },
  nodes: [note('draft', 'Draft'), note('review', 'Review'), note('ship', 'Ship')],
})
const exported = (nodes, options = { name: 'Plan', theme: 'light' }) => ({ options: { id: 'slate1', ...options }, nodes: clone(nodes) })

// A page: it loads the stored slate, edits its own copy, and saves the way saveSlateLite does.
function page(from) {
  let nodes = clone(from.nodes)
  let options = { name: from.options.name, theme: from.options.theme }
  let base = saveBaseOf(exported(nodes, options))
  return {
    edit(id, change) { nodes = nodes.map(n => (n.options.id === id ? change(clone(n)) : n)) },
    add(n) { nodes.push(n) },
    remove(id) { nodes = nodes.filter(n => n.options.id !== id) },
    reorder(ids) { nodes = ids.map(id => nodes.find(n => n.options.id === id)) },
    setOption(key, value) { options = { ...options, [key]: value } },
    nodes: () => nodes,
    fold(notes) { foldIntoBase(base, notes) },
    async save(store, user) {
      const slate = exported(nodes, options)
      const patch = savePatch(base, slate)
      await store.save(user, { slate, ...(patch && { patch }), routeKey: 'share1' })
      base = saveBaseOf(slate)
    },
  }
}
const text = (board, id) => board.nodes.find(n => n.options.id === id)?.options.text
const ids = board => board.nodes.map(n => n.options.id)

test('repro: a page that is behind saves its own edit and leaves the note someone else changed as they left it', async () => {
  const s = store(slateDoc())
  const ownerPage = page(s.board)
  const guestPage = page(s.board)
  ownerPage.edit('draft', n => ((n.options.text = 'Draft by the owner'), n))
  await ownerPage.save(s, owner)
  assert.equal(text(s.board, 'draft'), 'Draft by the owner')
  // The guest's page never heard of it (no relay) and changes another note.
  guestPage.edit('ship', n => ((n.options.text = 'Ship by the guest'), n))
  await guestPage.save(s, guest)
  assert.equal(text(s.board, 'ship'), 'Ship by the guest')
  assert.equal(text(s.board, 'draft'), 'Draft by the owner', 'the guest\'s save does not turn the owner\'s note back')
  assert.equal(s.board.revision, 3)
})

test('only the properties a page changed are written: a move on one page and a retype on another both stay', async () => {
  const s = store(slateDoc())
  const a = page(s.board)
  const b = page(s.board)
  a.edit('review', n => ((n.options.xPos = 400), n))
  await a.save(s, owner)
  b.edit('review', n => ((n.options.text = 'Review, retyped'), n))
  await b.save(s, guest)
  const review = s.board.nodes.find(n => n.options.id === 'review')
  assert.equal(review.options.xPos, 400)
  assert.equal(review.options.text, 'Review, retyped')
})

test('a behind page keeps notes others added, removes only what it removed, and adds its own', async () => {
  const s = store(slateDoc())
  const a = page(s.board)
  const b = page(s.board)
  a.add(note('qa', 'QA by the owner'))
  await a.save(s, owner)
  b.remove('review')
  b.add(note('docs', 'Docs by the guest'))
  await b.save(s, guest)
  assert.deepEqual(ids(s.board), ['draft', 'ship', 'qa', 'docs'])
  assert.equal(text(s.board, 'qa'), 'QA by the owner')
})

test('a note someone removed that a behind page then changed is kept as that page has it: nothing written is lost', async () => {
  const s = store(slateDoc())
  const a = page(s.board)
  const b = page(s.board)
  a.remove('ship')
  await a.save(s, owner)
  b.edit('ship', n => ((n.options.text = 'Ship, still wanted'), n))
  await b.save(s, guest)
  assert.equal(text(s.board, 'ship'), 'Ship, still wanted')
})

test('a new order is the page\'s for the notes it knows; notes added by others since keep their place after them', async () => {
  const s = store(slateDoc())
  const a = page(s.board)
  const b = page(s.board)
  a.add(note('qa', 'QA'))
  await a.save(s, owner)
  b.reorder(['ship', 'draft', 'review'])
  await b.save(s, guest)
  assert.deepEqual(ids(s.board), ['ship', 'draft', 'review', 'qa'])
})

test('a behind page writes only the settings it changed', async () => {
  const s = store(slateDoc())
  const a = page(s.board)
  const b = page(s.board)
  a.setOption('name', 'Plan, renamed by the owner')
  await a.save(s, owner)
  b.setOption('theme', 'dark')
  b.edit('draft', n => ((n.options.text = 'Draft by the guest'), n))
  await b.save(s, guest)
  assert.equal(s.board.options.name, 'Plan, renamed by the owner')
  assert.equal(s.board.options.theme, 'dark')
})

test('a run the page drew (not made) is folded into its base, so its next save does not write those words back', async () => {
  const s = store(slateDoc())
  const p = page(s.board)
  // An agent run saved on the server and drawn on this page; the owner then changes that note again.
  const run = note('review', 'Review by the agent')
  s.board.nodes = s.board.nodes.map(n => (n.options.id === 'review' ? clone(run) : n))
  p.edit('review', () => clone(run))
  p.fold([run])
  s.board.nodes = s.board.nodes.map(n => (n.options.id === 'review' ? note('review', 'Review by the owner, later') : n))
  p.edit('draft', n => ((n.options.text = 'Draft by the guest'), n))
  await p.save(s, guest)
  assert.equal(text(s.board, 'review'), 'Review by the owner, later')
  assert.equal(text(s.board, 'draft'), 'Draft by the guest')
})

test('a page with nothing to patch from (a previous release, or notes it cannot name) saves its whole slate as before', async () => {
  const s = store(slateDoc())
  await s.save(owner, { slate: exported([note('draft', 'Only note')]), routeKey: 'share1' })
  assert.deepEqual(ids(s.board), ['draft'])
  assert.equal(savePatch(saveBaseOf(exported([note('a', 'A')])), exported([{ options: { text: 'no id' } }])), null)
})

test('a patch that is not the shape a page makes is refused, and nothing is written', async () => {
  const s = store(slateDoc())
  const slate = exported(s.board.nodes)
  for (const patch of [
    { v: 2, changed: [], added: [], removed: [], order: null, options: {} },
    { v: 1, changed: [{ id: 'draft', paths: ['$where'], note: note('draft', 'x') }], added: [], removed: [], order: null, options: {} },
    { v: 1, changed: [{ id: 'draft', paths: ['options.text'], note: note('other', 'x') }], added: [], removed: [], order: null, options: {} },
    { v: 1, changed: [], added: [{ options: {} }], removed: [], order: null, options: {} },
    { v: 1, changed: [], added: [], removed: [], order: null, options: { 'a.b': 1 } },
  ]) {
    assert.equal(validSavePatch(patch), false, JSON.stringify(patch))
    await assert.rejects(() => s.save(owner, { slate, patch, routeKey: 'share1' }), /denied/)
  }
  assert.equal(s.board.revision, 1)
})

test('the patch round-trips: applying a page\'s patch to its own base gives the page', () => {
  const before = exported([note('a', 'A'), note('b', 'B'), note('c', 'C')])
  const after = exported([note('c', 'C2'), note('a', 'A', { options: { color: 'red' } }), note('d', 'D')])
  const patch = savePatch(saveBaseOf(before), after)
  assert.ok(validSavePatch(patch))
  assert.deepEqual(applySavePatch(before.nodes, patch), after.nodes)
})
