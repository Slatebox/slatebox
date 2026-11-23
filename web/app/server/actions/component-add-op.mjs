// add_component on slates.applyOperations: a library component added to a slate by exec or an
// agent, through the same door as the chat's Keep (component-add.mjs). The board is placed beside
// the slate's notes and its other boards as they stand when it is saved (a slate holds up to 8), and
// open pages draw it live (they hear the slate's conversation revision move, with the board's place).
import { problem } from './errors.mjs'
import { sharedSaveConditions } from '../methods/native-slate-save.mjs'
import { componentAddition, componentPlacing, readComponentRequest } from '../../imports/api/common/component-add.mjs'
import { workshopNodeIds } from 'slateboxjs/workshops/model'
import { rulebook } from 'slateboxjs/workshops/model'
import 'slateboxjs/workshops/behaviour'
import { catalogSamples as samples } from 'slateboxjs/workshops/samples'
import { runExpiry } from '../../imports/api/common/slate-operation-runs.mjs'


export const isAddComponentPlan = (plan) => Array.isArray(plan?.operations) && plan.operations.some((op) => op?.kind === 'add_component')

function readPlan(plan) {
  const ops = plan.operations
  if (ops.length !== 1 || typeof plan.message !== 'string' || !plan.message.trim())
    throw problem(400, 'invalid_operation_plan', 'An add_component plan holds one operation and a message.')
  const op = ops[0]
  const extra = Object.keys(op).filter((key) => !['kind', 'component', 'topic', 'expectedRevision'].includes(key))
  if (extra.length) throw problem(400, 'invalid_operation_plan', 'add_component takes component, topic and expectedRevision only.')
  if (!Number.isSafeInteger(op.expectedRevision) || op.expectedRevision < 0)
    throw problem(400, 'invalid_request', 'add_component names the slate revision it was made on (expectedRevision, from slates.get).', { details: { field: 'expectedRevision' } })
  let request
  try { request = readComponentRequest(op) } catch (error) { throw problem(400, error.code || 'invalid_component', error.message) }
  return { ...request, expectedRevision: op.expectedRevision }
}

const lines = (workshop) => (workshop.behaviour ? rulebook().lines(workshop) : [])

/** Preview or save an add_component plan on `slate` (ctx as the registry hands it). */
export async function applyAddComponent(principal, input, { deps, mode, now, idempotencyKey, resource: slate }) {
  if (input.expectedRevision !== undefined)
    throw problem(400, 'invalid_request', 'add_component carries its expectedRevision inside the plan operation.')
  const op = readPlan(input.plan)
  const respond = (made, revision) => ({
    ok: true,
    shareId: slate.shareId,
    revision,
    message: input.plan.message,
    operations: [{ kind: 'add_component', component: op.component, ...(op.topic && { topic: op.topic }), expectedRevision: op.expectedRevision }],
    // The board's id on the slate (main for its first board): what workshop operations name it by (boardId).
    boardId: made.boardId,
    report: { component: op.component, boardId: made.boardId, origin: made.origin, rules: lines(made.workshop),
      targets: made.workshop.lanes.map((lane) => workshopNodeIds.of(made.boardId).lane(lane.id)) },
    workshop: { boardId: made.boardId, title: made.workshop.title, revision: 0, lanes: made.workshop.lanes.map(({ id, label }) => ({ id, label })), cards: made.workshop.cards.length },
  })
  const first = componentAddition(slate, op, samples)
  if (first.refused) throw problem(409, 'component_opens_new_slate', first.refused, { details: { component: op.component, fits: false } })
  if ((slate.revision ?? 0) !== op.expectedRevision)
    throw problem(409, 'slate_changed', 'The slate changed since you read it. Read it again (slates.get) and send its revision.', { details: { revision: slate.revision ?? 0 } })
  if (mode === 'preview') return { status: 200, body: respond(first, slate.revision ?? 0) }
  if (!idempotencyKey) throw problem(400, 'invalid_request', 'Set Idempotency-Key when adding a component.')
  const prior = await deps.operationRuns.findOneAsync({ tokenId: principal.tokenId, idempotencyKey })
  if (prior) {
    if (prior.response?.operations?.[0]?.component === op.component && prior.slateId === slate._id) return { status: 200, body: prior.response }
    throw problem(409, 'idempotency_conflict', 'That key belongs to a different request. Use a new key.')
  }
  let made = first
  let saved
  try {
    saved = await deps.saveCore.save({
      slateId: slate._id,
      actor: principal,
      source: 'operations',
      conditions: { userId: slate.userId, orgId: slate.orgId ?? null, ...sharedSaveConditions(slate, principal.userId) },
      // Placed against the notes and boards as they stand at the save, and named by the slate's board
      // counter as it stands there: the save core fences the write on the slate's revision, so two adds
      // at once never take one place or one id (the second is built again on the first).
      build(current) {
        if ((current.revision ?? 0) !== op.expectedRevision) throw Object.assign(new Error('changed'), { code: 'slate_moved' })
        const again = componentAddition(current, op, samples)
        if (again.refused) throw Object.assign(new Error(again.refused), { code: 'board_cap' })
        made = { workshop: first.workshop, ...componentPlacing(current, first.workshop) }
        return { set: made.set, inc: { nativeConversationRevision: 1 } }
      },
    })
  } catch (error) {
    if (error?.code === 'slate_moved') throw problem(409, 'slate_changed', 'The slate changed since you read it. Read it again (slates.get) and send its revision.')
    if (error?.code === 'board_cap') throw problem(409, 'component_opens_new_slate', error.message, { details: { component: op.component, fits: false } })
    throw error
  }
  const response = respond(made, saved.revision)
  await deps.operationRuns.insertAsync({
    userId: principal.userId,
    tokenId: principal.tokenId,
    slateId: slate._id,
    slateShareId: slate.shareId,
    idempotencyKey,
    revision: saved.revision,
    plan: { message: input.plan.message, operations: response.operations },
    userMessage: input.userMessage ?? '',
    report: response.report,
    response: { ...response, mode },
    createdAt: now(),
    expiresAt: runExpiry(now()),
  })
  return { status: 201, body: response }
}
