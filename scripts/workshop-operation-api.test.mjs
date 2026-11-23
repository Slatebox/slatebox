import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createWorkshopOperations as workshopOperations,
  summarizeWorkshop,
} from '../web/app/server/workshop-operation-api.mjs'
import { createSlateSaveCore } from '../web/app/server/slate-save-core.mjs'

// Restated (P05a): the cores save through the save core. Each test's slates stand-in is also the
// core's, with an event log that keeps nothing (or the test's own, when it passes one).
const withSaveCore = (stores) => ({
  ...stores,
  saveCore: stores.slates && createSlateSaveCore({ slates: stores.slates, events: stores.events || { insertOne: async () => {} } }),
})
const createWorkshopOperations = (stores) => workshopOperations(withSaveCore(stores))
const privateSlates = async () => {
  const { createPrivateSlateOperation } = await import('../web/app/server/create-slate-api.mjs')
  return { createPrivateSlateOperation: (stores) => createPrivateSlateOperation(withSaveCore(stores)) }
}
import { createSlateReader } from '../web/app/server/slate-read.mjs'
import { createRequire } from 'node:module'

const requireModel = createRequire(
  new URL('../web/app/package.json', import.meta.url)
)
const { createInterviewWorkshop, createWorkshopMap } = requireModel(
  'slateboxjs/workshops/model'
)

function fixture(workshop = createWorkshopMap()) {
  const board = {
    _id: 'board',
    shareId: 'example',
    userId: 'owner',
    nodes: [],
    options: { isPrivate: true },
    creative: {
      revision: 3,
      model: { version: 1, kind: 'workshop', workshop },
    },
  }
  return {
    board,
    request: {
      slate: board,
      token: { _id: 'credential', userId: 'owner' },
      key: 'first',
      plan: {
        message: 'Move the decision',
        operations: [
          {
            kind: 'move_workshop_card',
            cardId: 'token',
            laneId: 'next',
            expectedRevision: 3,
          },
        ],
      },
    },
  }
}

test('a saved map previews its reachable stations without writing or substituting blank content', async () => {
  const { board, request } = fixture()
  board.creative.model.workshop.title =
    'Should the design partner see a preview?'
  const model = structuredClone(board.creative.model)
  assert.deepEqual(summarizeWorkshop(board).cards[0].legalLaneIds, ['next'])
  const run = createWorkshopOperations({})
  const { body } = await run({ ...request, dryRun: true })
  assert.equal(body.workshop.title, model.workshop.title)
  assert.equal(body.workshop.revision, 3)
  assert.deepEqual(body.workshop.cards[0].legalLaneIds, [])
  assert.equal(body.workshop.cards[0].laneId, 'next')
  assert.deepEqual(board.creative.model, model)
  for (const op of [
    { laneId: 'unknown' },
    { laneId: 'start' },
    { cardId: 'missing' },
    { cardId: null },
    { expectedRevision: -1 },
  ]) {
    await assert.rejects(
      run({
        ...request,
        dryRun: true,
        plan: {
          ...request.plan,
          operations: [{ ...request.plan.operations[0], ...op }],
        },
      }),
      { code: 'invalid_operation_plan' }
    )
  }
  await assert.rejects(
    run({
      ...request,
      plan: {
        ...request.plan,
        operations: [...request.plan.operations, { kind: 'add_nodes' }],
      },
    }),
    { code: 'invalid_operation_plan' }
  )
  await assert.rejects(run({ ...request, key: '' }), {
    code: 'invalid_operation_plan',
  })
  board.creative.model.workshop = {}
  assert.throws(() => summarizeWorkshop(board), {
    code: 'invalid_operation_plan',
  })
})

test('interview selection reports both affected cards and resolved authored outcomes', async () => {
  const { board, request } = fixture(createInterviewWorkshop())
  const original = summarizeWorkshop(board)
  assert.deepEqual(
    original.cards.find((c) => c.id === 'duplicate').legalLaneIds,
    ['prototype']
  )
  Object.assign(request.plan.operations[0], {
    cardId: 'duplicate',
    laneId: 'prototype',
  })
  const { body } = await createWorkshopOperations({})({
    ...request,
    dryRun: true,
  })
  assert.deepEqual(body.report.movedCards, [
    { cardId: 'preview', fromLaneId: 'prototype', toLaneId: 'interviews' },
    { cardId: 'duplicate', fromLaneId: 'interviews', toLaneId: 'prototype' },
  ])
  assert.notDeepEqual(body.workshop.outcomes, original.outcomes)
})

test('ordinary lane capacities and per-card restrictions constrain the API and discovery together', async () => {
  const { board, request } = fixture({
    version: 1,
    title: 'Record one',
    lanes: [
      { id: 'ready', label: 'Pitches' },
      { id: 'slot', label: 'Friday', capacity: 1 },
      { id: 'done', label: 'Archive' },
    ],
    cards: [
      {
        id: 'horn',
        label: 'Horn',
        laneId: 'ready',
        allowedLaneIds: ['ready', 'slot'],
      },
      { id: 'chorus', label: 'Chorus', laneId: 'slot' },
    ],
  })
  assert.deepEqual(summarizeWorkshop(board).cards[0].legalLaneIds, [])
  Object.assign(request.plan.operations[0], { cardId: 'horn', laneId: 'slot' })
  // Restated (P01): a move the rules refuse is a 409 move_refused with the rule's own
  // sentence, as on the canvas, not a 400 with one generic sentence.
  await assert.rejects(
    createWorkshopOperations({})({ ...request, dryRun: true }),
    { status: 409, code: 'move_refused' }
  )
})

const { releasePlan, validateWorkshop, workshopRefusal } = requireModel(
  'slateboxjs/workshops/model'
)

async function refusal(workshop, cardId, laneId) {
  const { board, request } = fixture(workshop)
  Object.assign(request.plan.operations[0], { cardId, laneId })
  const run = createWorkshopOperations({
    runs: { findOne: async () => null, insertOne: async () => assert.fail('a refused move is not recorded') },
    slates: { updateOne: async () => assert.fail('a refused move is not written') },
    withTransaction: (cb) => cb({}),
  })
  for (const dryRun of [true, false]) {
    let error
    try {
      await run({ ...request, dryRun })
    } catch (caught) {
      error = caught
    }
    assert.ok(error, 'the move must be refused')
    assert.equal(error.status, 409)
    assert.equal(error.code, 'move_refused')
    assert.equal(error.message, workshopRefusal(workshop, cardId, laneId))
    assert.deepEqual(error.details, {
      cardId,
      laneId,
      legalLaneIds: summarizeWorkshop(board).cards.find((c) => c.id === cardId)
        .legalLaneIds,
      revision: 3,
      workshop: summarizeWorkshop(board),
    })
    if (!dryRun) return error
  }
}

const recordOne = () => ({
  version: 1,
  title: 'Record one',
  lanes: [
    { id: 'ready', label: 'Pitches' },
    { id: 'slot', label: 'Friday', capacity: 1 },
    { id: 'done', label: 'Archive' },
  ],
  cards: [
    { id: 'horn', label: 'Horn', laneId: 'ready', allowedLaneIds: ['ready', 'slot'] },
    { id: 'chorus', label: 'Chorus', laneId: 'slot' },
  ],
})

test('a full lane is refused with the canvas sentence, the legal lanes and the current board', async () => {
  const error = await refusal(recordOne(), 'horn', 'slot')
  assert.equal(error.message, 'It already holds 1 of 1 card.')
})

test('a lane the card may not enter is refused with the canvas sentence', async () => {
  const error = await refusal(recordOne(), 'horn', 'done')
  assert.equal(error.message, "This card can't go in Archive.")
})

test('a station with no route from the current one is refused with the canvas sentence', async () => {
  const map = createWorkshopMap()
  map.lanes.push({ id: 'other', label: 'Other', station: { column: 1, row: 1, next: [], outcome: 'Other.' } })
  const error = await refusal(validateWorkshop(map), 'token', 'other')
  assert.equal(error.message, "Other can't be reached from Start.")
})

test('a release without room is refused with the points it needs and holds', async () => {
  const plan = structuredClone(releasePlan)
  plan.lanes.find((lane) => lane.id === 'friday').capacity = 5
  const error = await refusal(validateWorkshop(plan), 'export', 'friday')
  assert.equal(error.message, 'Needs 4 points. It already holds 3 of 5 points.')
})

test('on the interview board the API decides moves by the canvas rule: the prototype interview can swap back out', async () => {
  const { board, request } = fixture(createInterviewWorkshop())
  const before = summarizeWorkshop(board)
  assert.deepEqual(before.cards.find((c) => c.id === 'preview').legalLaneIds, ['interviews'])
  assert.deepEqual(before.cards.find((c) => c.id === 'duplicate').legalLaneIds, ['prototype'])
  Object.assign(request.plan.operations[0], { cardId: 'preview', laneId: 'interviews' })
  const { body } = await createWorkshopOperations({})({ ...request, dryRun: true })
  assert.deepEqual(body.report.movedCards, [
    { cardId: 'preview', fromLaneId: 'prototype', toLaneId: 'interviews' },
  ])
})

test('a change refused after a race returns the current revision and board in one answer', async () => {
  const { board, request } = fixture()
  const current = structuredClone(board)
  current.creative.revision = 5
  current.creative.model.workshop.title = 'Changed by a teammate'
  // Stale before the write: the slate the route read is newer than the caller's revision.
  const ahead = structuredClone(board)
  ahead.creative.revision = 5
  await assert.rejects(
    createWorkshopOperations({})({ ...request, slate: ahead, dryRun: true }),
    (error) => {
      assert.equal(error.status, 409)
      assert.equal(error.code, 'slate_changed')
      assert.deepEqual(error.details, { revision: 5, workshop: summarizeWorkshop(ahead) })
      return true
    }
  )
  // Stale at the write: another writer saved between the read and the conditional update.
  const run = createWorkshopOperations({
    runs: { findOne: async () => null, insertOne: async () => assert.fail('no receipt for a refused write') },
    slates: {
      updateOne: async () => ({ matchedCount: 0 }),
      findOne: async (query) => (query._id === board._id ? current : null),
    },
    withTransaction: (cb) => cb({}),
  })
  await assert.rejects(run(request), (error) => {
    assert.equal(error.status, 409)
    assert.equal(error.code, 'slate_changed')
    assert.deepEqual(error.details, { revision: 5, workshop: summarizeWorkshop(current) })
    assert.equal(error.details.workshop.title, 'Changed by a teammate')
    return true
  })
})

test('a request the workshop cannot act on says what this board supports', async () => {
  const unsupported = { message: 'Do something', operations: [{ kind: 'add_nodes', count: 1 }] }
  for (const [workshop, supported] of [
    [createWorkshopMap(), ['workshop_edits', 'undo_workshop_edit', 'move_workshop_card', 'set_presentation_order', 'add_map_branch', 'update_map_outcome']],
    [createInterviewWorkshop(), ['workshop_edits', 'undo_workshop_edit', 'move_workshop_card', 'set_presentation_order']],
  ]) {
    const { request } = fixture(workshop)
    await assert.rejects(
      createWorkshopOperations({})({ ...request, dryRun: true, plan: unsupported }),
      (error) => {
        assert.equal(error.code, 'invalid_operation_plan')
        assert.deepEqual(error.details, { supported })
        return true
      }
    )
  }
  const { request } = fixture(createInterviewWorkshop())
  const branch = { kind: 'add_map_branch', fromStationId: 'interviews', label: 'More', outcome: 'More.', expectedRevision: 3 }
  await assert.rejects(
    createWorkshopOperations({})({ ...request, dryRun: true, plan: { message: 'Add', operations: [branch] } }),
    (error) => {
      assert.equal(error.code, 'invalid_operation_plan')
      assert.deepEqual(error.details, { supported: ['workshop_edits', 'undo_workshop_edit', 'move_workshop_card', 'set_presentation_order'] })
      return true
    }
  )
})

// Integration (w1): P01's route test, mounted from the action registry (P02) that replaced
// the hand-built handlers; dryRun became mode "preview". The assertions are P01's.
test('the operations route passes a refusal through with its status, code, sentence and details', async (t) => {
  const { default: express } = await import('express')
  const { createAppRegistry } = await import('../web/app/server/actions/index.mjs')
  const { mountHttp } = await import('../web/app/server/actions/http.mjs')
  const { createIdempotencyStore } = await import('../web/app/server/actions/idempotency.mjs')
  const { memoryDriverCollection } = await import('./action-test-stores.mjs')
  const { board } = fixture(recordOne())
  const registry = createAppRegistry({
    deps: {
      authorizeTokenForSlate: async () => ({ authorized: true, slate: board }),
      applyWorkshopOperations: createWorkshopOperations({}),
    },
    idempotency: createIdempotencyStore({ collection: memoryDriverCollection() }),
  })
  const app = express()
  mountHttp(app, registry, {
    express,
    authenticate: async () => ({ kind: 'agent', tokenId: 'credential', userId: 'owner', scopes: ['slates:read', 'slates:write'] }),
  })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/v1/slates/example/operations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'preview',
      plan: { message: 'Move', operations: [{ kind: 'move_workshop_card', cardId: 'horn', laneId: 'slot', expectedRevision: 3 }] },
    }),
  })
  assert.equal(response.status, 409)
  const { error } = await response.json()
  assert.equal(error.code, 'move_refused')
  assert.equal(error.message, 'It already holds 1 of 1 card.')
  assert.equal(error.details.laneId, 'slot')
  assert.equal(error.details.revision, 3)
  assert.deepEqual(error.details.legalLaneIds, [])
  assert.equal(error.details.workshop.revision, 3)
})

// A filter on stored fields, as Mongo reads it: dotted paths, and null matching a missing field.
const matchesQuery = (doc, query) =>
  Object.entries(query).every(([path, want]) => {
    const have = path.split('.').reduce((value, key) => value?.[key], doc)
    return want === null ? have == null : have === want
  })

test('a write refused because sharing changed returns no board to a caller who lost access', async () => {
  const { board, request } = fixture()
  // The agent's account read the slate while it was public.
  board.options = { isPrivate: false, isPublic: true }
  board.sharingRevision = 1
  const stored = structuredClone(board)
  // The owner then made it private and renamed the board.
  stored.sharingRevision = 2
  stored.options = { isPrivate: true, isPublic: false }
  stored.creative.revision = 4
  stored.creative.model.workshop.title = 'PRIVATE: acquisition shortlist'
  const run = createWorkshopOperations({
    runs: { findOne: async () => null, insertOne: async () => assert.fail('no receipt for a refused write') },
    slates: {
      updateOne: async (query) => ({ matchedCount: Number(matchesQuery(stored, query)) }),
      findOne: async (query) => (matchesQuery(stored, query) ? stored : null),
    },
    withTransaction: (cb) => cb({}),
  })
  await assert.rejects(
    run({ ...request, token: { _id: 'agent', userId: 'member' } }),
    (error) => {
      assert.equal(error.status, 409)
      assert.equal(error.code, 'slate_changed')
      assert.equal(error.details, undefined)
      return true
    }
  )
  // The owner keeps access through any sharing change, so the owner still gets the board.
  await assert.rejects(run(request), (error) => {
    assert.equal(error.code, 'slate_changed')
    assert.deepEqual(error.details, { revision: 4, workshop: summarizeWorkshop(stored) })
    return true
  })
})

test('commit and receipt share a transaction, exact retries replay and racing changes fail closed', async () => {
  const { board, request } = fixture()
  let receipt,
    writes = 0,
    changed = true
  const session = {}
  const run = createWorkshopOperations({
    runs: {
      findOne: async () => receipt,
      insertOne: async (row, opts) => {
        assert.equal(opts.session, session)
        receipt = row
      },
    },
    slates: {
      updateOne: async (selector, change, opts) => {
        assert.equal(opts.session, session)
        assert.equal(selector['creative.revision'], 3)
        assert.equal(selector.sharingRevision, null)
        assert.equal(selector['options.isPrivate'], true)
        assert.equal(change.$inc['creative.revision'], 1)
        assert.equal(
          change.$set['creative.model.workshop'].cards[0].laneId,
          'next'
        )
        if (changed) return { matchedCount: 0 }
        writes++
        return { matchedCount: 1 }
      },
      findOne: async () => board,
    },
    withTransaction: (cb) => cb(session),
  })
  request.token.userId = 'edit-member'
  await assert.rejects(run(request), { code: 'slate_changed' })
  assert.equal(receipt, undefined)
  changed = false
  const first = await run(request)
  assert.equal(first.status, 201)
  assert.equal(first.body.workshop.revision, 4)
  board.creative.revision = 4
  const replay = await run(request)
  assert.equal(replay.status, 200)
  assert.deepEqual(replay.body, first.body)
  request.plan.message = 'different intent'
  await assert.rejects(run(request), { code: 'idempotency_conflict' })
  assert.equal(writes, 1)
  receipt = null
  await assert.rejects(run({ ...request, key: 'fresh' }), {
    code: 'slate_changed',
  })
})

// Optional integration against a loopback replica set. A uniquely named throwaway
// database is created for this test; no existing database is selected or dropped.
test(
  'HTTP + Mongo: competing retries commit once, persisted board reopens, and failed receipts roll back',
  {
    skip: !process.env.SLATEBOX_TEST_WORKSHOP_MONGO_PORT,
  },
  async (t) => {
    const port = Number(process.env.SLATEBOX_TEST_WORKSHOP_MONGO_PORT)
    assert.ok(Number.isInteger(port) && port > 0 && port < 65536)
    const { MongoClient } = requireModel(
      process.env.SLATEBOX_TEST_MONGODB_DRIVER || 'mongodb'
    )
    const { default: express } = await import('express')
    const { randomUUID } = await import('node:crypto')
    // Restated (P02): mounted from the action registry, with its idempotency records in this
    // database; dryRun became mode "preview".
    const { createAppRegistry } = await import('../web/app/server/actions/index.mjs')
    const { mountHttp } = await import('../web/app/server/actions/http.mjs')
    const { createIdempotencyStore } = await import('../web/app/server/actions/idempotency.mjs')
    const client = new MongoClient('mongodb://127.0.0.1:' + port)
    const db = client.db(
      'slatebox_workshop_test_' + randomUUID().replaceAll('-', '')
    )
    t.after(async () => {
      await db.dropDatabase()
      await client.close()
    })
    const slates = db.collection('slates'),
      runs = db.collection('runs')
    const { board, request } = fixture()
    await slates.insertOne(board)
    await runs.createIndex({ tokenId: 1, idempotencyKey: 1 }, { unique: true })
    const opts = {
      slates,
      runs,
      withTransaction: (action) =>
        client.withSession((session) =>
          session.withTransaction(() => action(session))
        ),
    }
    const registry = createAppRegistry({
      deps: {
        // Restated (P07): the service also says what the caller may do; GET is the slate read.
        authorizeTokenForSlate: async () => ({
          authorized: true,
          slate: await slates.findOne({ _id: board._id }),
          access: { role: 'EDIT', canEdit: true, isOwner: true, linkRole: null, grantKey: null },
        }),
        readSlate: createSlateReader({
          listComments: async () => [],
          findPresentation: async () => null,
          appOrigin: () => 'http://127.0.0.1',
          embedOrigin: () => 'http://127.0.0.1',
        }),
        applyWorkshopOperations: createWorkshopOperations(opts),
      },
      idempotency: createIdempotencyStore({ collection: db.collection('idempotency') }),
    })
    const app = express()
    mountHttp(app, registry, {
      express,
      authenticate: async () => ({
        kind: 'agent', tokenId: request.token._id, userId: request.token.userId,
        scopes: ['slates:read', 'slates:write'],
      }),
    })
    const server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    t.after(() => new Promise((resolve) => server.close(resolve)))
    const url =
      'http://127.0.0.1:' +
      server.address().port +
      '/api/v1/slates/' +
      board.shareId
    const post = (key, plan = request.plan, dryRun = false) =>
      fetch(url + '/operations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify({ plan, ...(dryRun && { mode: 'preview' }) }),
      })
    assert.equal((await (await fetch(url)).json()).workshop.revision, 3)
    assert.equal((await post('preview', request.plan, true)).status, 200)
    assert.equal(await runs.countDocuments(), 0)
    const simultaneous = await Promise.all([post('same'), post('same')])
    assert.deepEqual(
      simultaneous.map((result) => result.status).sort(),
      [200, 201]
    )
    assert.deepEqual(await simultaneous[0].json(), await simultaneous[1].json())
    assert.equal((await post('different')).status, 409)
    assert.equal(
      (await post('same', { ...request.plan, message: 'Different request' }))
        .status,
      409
    )
    const saved = await slates.findOne({ _id: board._id })
    assert.equal(saved.creative.revision, 4)
    assert.equal(saved.creative.model.workshop.cards[0].laneId, 'next')
    assert.deepEqual(saved.nodes, board.nodes)
    // Restated (P05a): the first save of a slate stored without search fields adds them.
    // Restated (fix-P05a): all three of them, not only searchText (review finding 9).
    const { searchText, searchName, searchDescription, ...settings } = saved.options
    assert.deepEqual(settings, board.options)
    assert.deepEqual([searchText, searchName, searchDescription], ['', '', ''])
    assert.equal(await runs.countDocuments(), 1)
    const editPlan = (kind, fields, expectedRevision) => ({
      message: 'Update the route',
      operations: [{ kind, ...fields, expectedRevision }],
    })
    const branch = editPlan('add_map_branch', {
      fromStationId: 'next', label: 'Peer review', outcome: 'A reviewer checks the route.',
    }, 4)
    const preview = await (await post('preview-branch', branch, true)).json()
    const added = preview.report.addedBranches[0]
    assert.equal(added.fromStationId, 'next')
    assert.equal(await runs.countDocuments(), 1)
    const forked = await Promise.all([post('branch', branch), post('branch', branch)])
    assert.deepEqual(forked.map(response => response.status).sort(), [200, 201])
    const results = await Promise.all(forked.map(response => response.json()))
    assert.deepEqual(results[0], results[1])
    assert.deepEqual(results[0].report, preview.report)
    const update = editPlan('update_map_outcome', { stationId: added.stationId, outcome: 'Reviewed and approved.' }, 5)
    assert.equal((await post('branch', update)).status, 409)
    assert.equal((await post('stale-change', branch)).status, 409)
    assert.equal((await post('update', update)).status, 201)
    const fresh = await slates.findOne({ _id: board._id })
    assert.equal(fresh.creative.revision, 6)
    assert.equal(fresh.options.description, 'Untitled map · 3 lanes · 1 cards')
    assert.equal(fresh.creative.model.workshop.lanes.at(-1).station.outcome, 'Reviewed and approved.')
    assert.deepEqual(fresh.creative.model.workshop.lanes[1].station.next, [added.stationId])
    assert.deepEqual(fresh.creative.model.workshop.cards, saved.creative.model.workshop.cards)
    assert.equal(await runs.countDocuments(), 3)
    const order = [added.stationId, 'next', 'start']
    const reorder = editPlan('set_presentation_order', { laneIds: order }, 6)
    const orderPreview = await (await post('preview-order', reorder, true)).json()
    assert.deepEqual(orderPreview.report.presentationOrder, order)
    assert.deepEqual(orderPreview.workshop.lanes, results[0].workshop.lanes.map(lane =>
      lane.id === added.stationId ? { ...lane, outcome: 'Reviewed and approved.' } : lane))
    assert.equal((await slates.findOne({ _id: board._id })).creative.model.workshop.presentationOrder, undefined)
    const concurrent = await Promise.all([post('order', reorder), post('order', reorder)])
    assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 201])
    const orderedResults = await Promise.all(concurrent.map(r => r.json()))
    assert.deepEqual(orderedResults[0], orderedResults[1])
    assert.equal((await post('stale-order', reorder)).status, 409)
    const changedOrder = editPlan('set_presentation_order', { laneIds: order.toReversed() }, 6)
    assert.equal((await post('order', changedOrder)).status, 409)
    assert.deepEqual((await (await fetch(url)).json()).workshop.presentationOrder, order)
    const reordered = await slates.findOne({ _id: board._id })
    assert.equal(reordered.creative.revision, 7)
    assert.deepEqual(reordered.creative.model.workshop, { ...fresh.creative.model.workshop, presentationOrder: order })
    assert.deepEqual(reordered.options, fresh.options)
    assert.equal(await runs.countDocuments(), 4)
    const unableToRecord = createWorkshopOperations({
      ...opts,
      runs: {
        findOne: () => null,
        insertOne: () => {
          throw new Error('Receipt unavailable')
        },
      },
    })
    const second = { ...board, _id: 'second', shareId: 'second' }
    await slates.insertOne(second)
    await assert.rejects(
      unableToRecord({ ...request, slate: second, key: 'no-receipt' }),
      /Receipt unavailable/
    )
    assert.equal((await slates.findOne({ _id: 'second' })).creative.revision, 3)
    // A member read the slate while it was public; the owner then made it private
    // and renamed the board. The member's write is refused without the board.
    const shared = {
      ...board,
      _id: 'shared',
      shareId: 'shared',
      sharingRevision: 1,
      options: { isPrivate: false, isPublic: true },
    }
    await slates.insertOne(shared)
    await slates.updateOne(
      { _id: 'shared' },
      {
        $set: {
          sharingRevision: 2,
          'options.isPrivate': true,
          'options.isPublic': false,
          'creative.model.workshop.title': 'PRIVATE: acquisition shortlist',
        },
      }
    )
    const member = { _id: 'member-token', userId: 'member' }
    const commit = createWorkshopOperations(opts)
    await assert.rejects(
      commit({ ...request, slate: shared, token: member, key: 'revoked' }),
      (error) => {
        assert.equal(error.code, 'slate_changed')
        assert.equal(error.details, undefined)
        return true
      }
    )
    // A member whose access stands still gets the board after an ordinary race.
    const open = { ...shared, _id: 'open', shareId: 'open' }
    await slates.insertOne(open)
    await slates.updateOne({ _id: 'open' }, { $inc: { 'creative.revision': 1 } })
    await assert.rejects(
      commit({ ...request, slate: open, token: member, key: 'raced' }),
      (error) => {
        assert.equal(error.code, 'slate_changed')
        assert.equal(error.details.revision, 4)
        return true
      }
    )
    assert.equal(await runs.countDocuments(), 4)
  }
)

test('private API slate creation shares the app starter, rejects ownership overrides and replays its original receipt', async () => {
  const { createPrivateSlateOperation } = await privateSlates()
  const { readTeamMapBrief } =
    await import('../web/app/imports/api/common/team-map-brief.mjs')
  const { decodeWorkshopFragment } = requireModel('slateboxjs/workshops/model')
  const user = { _id: 'registered', orgId: 'team' },
    token = { _id: 'credential', userId: user._id }
  let row, receipt
  const session = {}
  const run = createPrivateSlateOperation({
    users: {
      findOne: async (query) => {
        assert.equal(query._id, user._id)
        assert.deepEqual(query.isAnonymous, { $ne: true })
        return user
      },
    },
    slates: {
      findOne: async (query) =>
        row?._id === query._id && row.userId === query.userId ? row : null,
      insertOne: async (value, opts) => {
        assert.equal(opts.session, session)
        row = value
      },
    },
    runs: {
      findOne: async (query) =>
        receipt?.idempotencyKey === query.idempotencyKey ? receipt : null,
      insertOne: async (value, opts) => {
        assert.equal(opts.session, session)
        receipt = value
      },
    },
    withTransaction: (fn) => fn(session),
    generateShareId: async () => 'deadbee123',
    appOrigin: () => 'https://selfhost.example',
    now: () => 1234,
  })
  const brief = 'Request → Review → Refund'
  const req = { body: { brief }, key: 'approval-1', token }
  for (const bad of [
    {},
    { brief: '' },
    { brief: '<x>' },
    { brief: 'a'.repeat(161) },
    { brief, userId: 'other' },
    { brief, isPublic: true },
    { brief, kind: 'other' },
    { brief, source: 'call-status' },
    { brief, kind: 'map', source: 'sign-in-outage' },
    { brief, kind: 'diagram', source: null },
    { brief, kind: 'diagram', source: 'pilot-budget' },
    { brief: 'x'.repeat(1201), kind: 'diagram' },
    { brief: 'a\0b', kind: 'diagram' },
  ]) {
    await assert.rejects(run({ ...req, body: bad }), { status: 400 })
  }
  for (const key of [null, 'a b', 'z'.repeat(129)])
    await assert.rejects(run({ ...req, key }), { status: 400 })
  const first = await run(req)
  assert.equal(first.status, 201)
  assert.equal(first.body.url, 'https://selfhost.example/canvas/deadbee123')
  assert.equal(first.body.workshop.revision, 0)
  const fromApp = decodeWorkshopFragment(
    readTeamMapBrief('#' + new URLSearchParams({ brief })).fragment
  )
  assert.deepEqual(row.creative.model.workshop, fromApp)
  assert.deepEqual(
    row.creative.model.workshop.lanes.map((l) => l.label),
    ['Request', 'Review', 'Refund']
  )
  assert.equal(row.userId, user._id)
  assert.equal(row.orgId, user.orgId)
  assert.deepEqual(
    [row.options.isPrivate, row.options.isPublic, row.options.isUnlisted],
    [true, false, false]
  )
  assert.equal(row.creative.model.workshop.lanes[0].station.outcome, brief)
  assert.deepEqual(await run(req), { status: 200, body: first.body })
  const explicitMap = await run({...req, body:{kind:'map', brief}})
  assert.deepEqual(explicitMap, {status:200, body:first.body})
  await assert.rejects(run({...req, body:{kind:'diagram', brief}}), {status:409})
  await assert.rejects(run({ ...req, body: { brief: 'Another map' } }), {
    status: 409,
    code: 'idempotency_conflict',
  })
  row = null
  await assert.rejects(run(req), { status: 410, code: 'slate_unavailable' })

  const { nativeSlateFromBrief } = await import('../web/app/imports/api/common/native-diagram-brief.mjs')
  const { summarizeSlate: summarizeSlateForAI } = requireModel('slateboxjs/operations')
  for (const source of [undefined, 'call-status', 'sign-in-outage', 'interview-notes', 'friday-launch']) {
    const words = 'Field report -> Support response\nSupport response → Follow up'
    const body = {kind:'diagram', brief:words, ...(source ? {source} : {})}
    const create = {...req, key:'diagram-'+(source || 'blank'), body}
    const first = await run(create)
    const expected = nativeSlateFromBrief(words,source)
    assert.equal(first.status,201)
    assert.deepEqual(row.nodes,expected.nodes)
    assert.equal(row.creative,undefined)
    assert.equal(row.options.creationBrief,words)
    assert.equal(row.options.briefSource,source)
    assert.deepEqual([row.userId,row.orgId,row.options.isPrivate,row.options.isPublic,row.options.isUnlisted],
      [user._id,user.orgId,true,false,false])
    assert.deepEqual(first.body,{shareId:row.shareId,url:'https://selfhost.example/canvas/'+row.shareId,diagram:JSON.parse(JSON.stringify(summarizeSlateForAI(row)))})
    assert.equal(first.body.diagram.nodeCount,expected.nodes.length)
    assert.ok(first.body.diagram.connections.length>=2)
    const again = await run({...create,body:{...body,brief:' '+words+' '}})
    assert.deepEqual(again,{status:200,body:first.body})
    await assert.rejects(run({...create,body:{...body,source:source==='call-status'?'interview-notes':'call-status'}}),{status:409})
    row=null
    await assert.rejects(run(create),{status:410})
  }
})

test(
  'concurrent private slate requests atomically create one Mongo board, one receipt and one owner URL',
  {
    skip: !process.env.SLATEBOX_TEST_WORKSHOP_MONGO_PORT,
  },
  async (t) => {
    const { createPrivateSlateOperation } = await privateSlates()
    const { randomUUID } = await import('node:crypto')
    const port = Number(process.env.SLATEBOX_TEST_WORKSHOP_MONGO_PORT)
    assert.ok(Number.isInteger(port) && port > 0 && port < 65536)
    const { MongoClient } = requireModel(
      process.env.SLATEBOX_TEST_MONGODB_DRIVER || 'mongodb'
    )
    const client = new MongoClient('mongodb://127.0.0.1:' + port)
    const db = client.db(
      'slatebox_create_test_' + randomUUID().replaceAll('-', '')
    )
    t.after(async () => {
      await db.dropDatabase()
      await client.close()
    })
    const users = db.collection('users'),
      slates = db.collection('slates'),
      runs = db.collection('runs')
    await users.insertOne({ _id: 'registered', isAnonymous: false })
    await runs.createIndex({ tokenId: 1, idempotencyKey: 1 }, { unique: true })
    const core = {
      users,
      slates,
      runs,
      generateShareId: async () =>
        randomUUID().replaceAll('-', '').slice(0, 10),
      withTransaction: (fn) =>
        client.withSession((s) => s.withTransaction(() => fn(s))),
      appOrigin: () => 'https://selfhost.example',
    }
    const run = createPrivateSlateOperation(core)
    const req = {
      token: { _id: 'test-token', userId: 'registered' },
      body: { brief: 'Who should approve a refund?' },
      key: 'first',
    }
    const results = await Promise.all([run(req), run(req)])
    assert.deepEqual(results.map((x) => x.status).sort(), [200, 201])
    assert.deepEqual(results[0].body, results[1].body)
    assert.equal(await slates.countDocuments(), 1)
    assert.equal(await runs.countDocuments(), 1)
    const diagramRequest = {...req, key:'diagram', body:{kind:'diagram',brief:'Alert → Support', source:'call-status'}}
    const diagrams = await Promise.all([run(diagramRequest),run(diagramRequest)])
    assert.deepEqual(diagrams.map(r=>r.status).sort(),[200,201])
    assert.deepEqual(diagrams[0].body,diagrams[1].body)
    assert.ok(diagrams[0].body.diagram.nodeCount>2)
    assert.equal(await slates.countDocuments(),2)
    assert.equal(await runs.countDocuments(),2)
    const broken = createPrivateSlateOperation({
      ...core,
      runs: {
        findOne: () => null,
        insertOne: () => {
          throw Error('failed receipt')
        },
      },
    })
    await assert.rejects(broken({ ...req, key: 'another' }), /failed receipt/)
    assert.equal(await slates.countDocuments(), 2)
    assert.equal(await runs.countDocuments(), 2)
    await users.updateOne(
      { _id: 'registered' },
      { $set: { isAnonymous: true } }
    )
    await assert.rejects(run({ ...req, key: 'unregistered' }), { status: 403 })
  }
)

// Restated (P02): the published schema is generated from the action registry.
test('public create schema distinguishes legacy maps and native diagram sources', async () => {
  const { createAppRegistry } = await import('../web/app/server/actions/index.mjs')
  const { buildOpenApi } = await import('../web/app/server/actions/openapi.mjs')
  const slateOpenApi = buildOpenApi(createAppRegistry())
  const operation = slateOpenApi.paths['/slates'].post
  const [map,diagram] = operation.requestBody.content['application/json'].schema.oneOf
  assert.deepEqual(map.required,['brief'])
  assert.equal(map.properties.brief.maxLength,160)
  assert.deepEqual(diagram.required,['kind','brief'])
  assert.equal(diagram.properties.kind.const,'diagram')
  assert.equal(diagram.properties.brief.maxLength,1200)
  assert.deepEqual([...diagram.properties.source.enum].sort(),['call-status','friday-launch','interview-notes','sign-in-outage'])
  assert.deepEqual(operation.responses[201].content['application/json'].schema,operation.responses[200].content['application/json'].schema)
  assert.equal(operation['x-required-scope'],'slates:write')
})

// Restated (P02): mounted from the action registry; a token without slates:write now gets
// 403 insufficient_scope (it was 401, when the scope was checked as authentication).
test('private map HTTP route requires write scope before reading a brief and returns a noncacheable created result', async t => {
  const {default:express} = await import('express')
  const { createAppRegistry } = await import('../web/app/server/actions/index.mjs')
  const { mountHttp } = await import('../web/app/server/actions/http.mjs')
  const { createIdempotencyStore } = await import('../web/app/server/actions/idempotency.mjs')
  const { memoryDriverCollection } = await import('./action-test-stores.mjs')
  let called=0
  const registry=createAppRegistry({
    deps:{createPrivateSlate:async({body,token,key})=>{called++;assert.equal(token.userId,'owner');assert.equal(body.brief,'Test map');assert.equal(key,'map-01');return {status:201,body:{shareId:'test',url:'https://example.test/canvas/test'}}}},
    idempotency:createIdempotencyStore({collection:memoryDriverCollection()}),
  })
  const app=express()
  mountHttp(app,registry,{express,authenticate:async req=>{
    const raw=req.get('authorization')
    if(raw==='Bearer write')return {kind:'agent',tokenId:'token',userId:'owner',scopes:['slates:write']}
    if(raw==='Bearer read')return {kind:'agent',tokenId:'reader',userId:'owner',scopes:['slates:read']}
    return null
  }})
  const server=app.listen(0,'127.0.0.1');await new Promise(ok=>server.once('listening',ok))
  t.after(()=>new Promise(ok=>server.close(ok)))
  const post=auth=>fetch('http://127.0.0.1:'+server.address().port+'/api/v1/slates',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'map-01',authorization:'Bearer '+auth},body:JSON.stringify({brief:'Test map'})})
  assert.equal((await post('read')).status,403);assert.equal(called,0)
  const result=await post('write');assert.equal(result.status,201);assert.equal(called,1)
  assert.equal(result.headers.get('cache-control'),'no-store')
})

test('map authoring follows native station and presentation rules without changing tokens or other workshop types', async () => {
  const { board, request } = fixture()
  const map = board.creative.model.workshop
  map.presentationOrder = ['next', 'start']
  map.cards[0].allowedLaneIds = ['start', 'next']
  const original = structuredClone(map)
  const op = { kind: 'add_map_branch', expectedRevision: 3, fromStationId: 'start', label: 'Support', outcome: 'Ask a teammate.' }
  const run = createWorkshopOperations({})
  const preview = (operation, slate = board) => run({ ...request, slate, dryRun: true, plan: { message: 'Update map', operations: [operation] } })
  const { body } = await preview(op)
  const stationId = body.report.addedBranches[0].stationId
  assert.deepEqual(body.workshop.lanes[0].next, ['next', stationId])
  assert.deepEqual(body.workshop.cards[0].legalLaneIds, ['next'])
  assert.deepEqual(map, original)

  let written
  const commit = createWorkshopOperations({
    runs: { findOne: async () => null, insertOne: async () => {} },
    withTransaction: fn => fn({}),
    // Restated (P05a): the save core reads the stored board before it writes.
    slates: { findOne: async () => board, updateOne: async (selector, changes) => {
      assert.equal(selector.sharingRevision, null)
      written = changes.$set['creative.model.workshop']
      return { matchedCount: 1 }
    } },
  })
  await commit({ ...request, token: { _id: 'editor-token', userId: 'editor' }, plan: { message: 'Add route', operations: [op] } })
  assert.deepEqual(written.presentationOrder, ['next', 'start', stationId])
  assert.deepEqual(written.cards, original.cards)
  assert.deepEqual(written.lanes[1], original.lanes[1])
  const change = { kind: 'update_map_outcome', expectedRevision: 3, stationId: 'next', outcome: 'Continue.' }
  assert.deepEqual((await preview(change)).body.report.updatedOutcomes, [{ stationId: 'next' }])
  for (const invalid of [{ ...op, fromStationId: 'absent' }, { ...op, label: '<svg>' }, { ...op, label: 'x'.repeat(81) },
    { ...op, position: {} }, { ...op, outcome: ' ' }, { ...change, stationId: 'gone' }, { ...change, outcome: 'x'.repeat(161) }]) {
    await assert.rejects(preview(invalid), { code: 'invalid_operation_plan' })
  }
  await assert.rejects(preview(op, fixture(createInterviewWorkshop()).board), { code: 'invalid_operation_plan' })
  await assert.rejects(preview({ ...op, expectedRevision: 2 }), { code: 'slate_changed' })
})

test('ordering ordinary lanes or map stations uses the native presentation sequence and rejects partial or non-ID input', async () => {
  const { workshopPresentationLanes } = requireModel('slateboxjs/workshops/model')
  for (const model of [createWorkshopMap(), createInterviewWorkshop()]) {
    const {board, request} = fixture(model)
    const natural = model.lanes.map(lane => lane.id)
    const original = structuredClone(model)
    assert.deepEqual(summarizeWorkshop(board).presentationOrder, workshopPresentationLanes(model).map(lane => lane.id))
    const run = createWorkshopOperations({})
    const preview = laneIds => run({ ...request, dryRun:true, plan:{ message:'Move the first scene last', operations:[
      { kind:'set_presentation_order', laneIds, expectedRevision:3 }
    ] } })
    const ordered = [...natural.slice(1), natural[0]]
    const {body} = await preview(ordered)
    assert.deepEqual(body.report.presentationOrder, ordered)
    assert.deepEqual(body.workshop.presentationOrder, ordered)
    assert.deepEqual(body.workshop.lanes.map(lane => lane.id), natural)
    assert.equal(body.workshop.revision, 3)
    assert.deepEqual(model, original)
    for (const invalid of [natural[0], [], natural.slice(1), [...natural,'unknown'], natural.map(()=>natural[0]),
      [9,...natural.slice(1)], ['missing',...natural.slice(1)], [model.lanes[0].label,...natural.slice(1)]]){
      await assert.rejects(preview(invalid),{code:'invalid_operation_plan'})
    }
  }
})
