import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { loadSlate } from './slate-access.mjs'
import { tokenLike } from './principal.mjs'
import { ref, shareIdInput } from './slate-schemas.mjs'
import { isWorkshopOperation } from '../workshop-operation-api.mjs'
import { sharedSaveConditions } from '../methods/native-slate-save.mjs'
import { applyAddComponent, isAddComponentPlan } from './component-add-op.mjs'
import { runExpiry } from '../../imports/api/common/slate-operation-runs.mjs'

// Where update_slate's keys are stored: the fields the engine applier writes on
// the slate's options (slateboxjs/operations SLATE_KEYS). The line colour also
// recolours connectors, which are saved with the notes.
const SLATE_OPTION_PATHS = {
  name: 'options.name',
  description: 'options.description',
  background: 'options.containerStyle',
  mindMapMode: 'options.mindMapMode',
  autoResizeNodesBasedOnText: 'options.autoResizeNodesBasedOnText',
  showGrid: 'options.viewPort.showGrid',
  snapToObjects: 'options.viewPort.snapToObjects',
  defaultLineColor: 'options.defaultLineColor',
}

const result = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    mode: { type: 'string', enum: ['save', 'preview'] },
    shareId: { type: 'string' },
    revision: { type: 'integer', minimum: 0, description: 'The slate revision after this save (for a preview, as read).' },
    message: { type: 'string' },
    operations: { type: 'array', items: { type: 'object' } },
    report: {
      type: 'object',
      properties: {
        presentationOrder: { type: 'array', items: { type: 'string' } },
        edits: { type: 'array', items: { type: 'object' }, description: 'workshop_edits: what each edit did, in the sentence a person is told.' },
        movedCards: { type: 'array', items: { type: 'object' } },
        addedCards: { type: 'array', items: { type: 'string' } },
        removedCards: { type: 'array', items: { type: 'string' } },
        removedLanes: { type: 'array', items: { type: 'string' } },
        removedLinks: { type: 'array', items: { type: 'object' } },
        removedOutcomes: { type: 'array', items: { type: 'string' } },
        targets: { type: 'array', items: { type: 'string' }, description: 'The notes the edit touched, as the canvas names them (card-<id>, lane-<id>).' },
        undone: { type: 'string', description: 'undo_workshop_edit: the receipt it undid.' },
        addedBranches: { type: 'array', items: { type: 'object' } },
        updatedOutcomes: { type: 'array', items: { type: 'object' } },
        lines: { type: 'array', items: { type: 'object' } },
        removedLines: { type: 'array', items: { type: 'string' } },
      },
    },
    receiptId: { type: 'string', description: 'A saved workshop edit: pass it to undo_workshop_edit.' },
    workshop: ref('Workshop'),
  },
  required: ['ok', 'mode', 'shareId', 'message', 'operations', 'report'],
}

// A workshop or map edit goes to the workshop core; anything else to the canvas reducer.
async function applyToWorkshop(principal, input, { deps, mode, idempotencyKey, resource: slate }) {
  let outcome
  try {
    outcome = await deps.applyWorkshopOperations({
      slate,
      token: tokenLike(principal),
      plan: input.plan,
      userMessage: input.userMessage ?? '',
      dryRun: mode === 'preview',
      key: idempotencyKey ?? undefined,
    })
  } catch (error) {
    if (error?.status && error.status < 500 && error.code) throw error
    throw problem(500, 'workshop_save_failed', 'The request could not be completed. Retry with the same key.')
  }
  // The core's own receipt still says dryRun; the registry states the mode instead.
  const { dryRun: _dryRun, ...body } = outcome.body
  return { status: outcome.status, body }
}

// Everyone on the slate sees the agent that saved: its pointer goes to what the save touched.
// Only a save does this (never a preview or a held plan), and it never fails the save.
async function showAgent(principal, slate, body, deps) {
  if (!deps.presence) return
  const report = body?.report || {}
  const created = new Set(report.created || [])
  const targets = Array.isArray(report.targets)
    ? report.targets
    : [...(report.created || []), ...(report.updated || []).filter((id) => !created.has(id))]
  try {
    await deps.presence.saved(principal, slate, { targets, message: body?.message || '' })
  } catch (error) {
    console.error('[presence]', error?.message)
  }
}

// A canvas plan is applied to the slate as stored, inside the save core, so a person's save
// that lands first is built on rather than overwritten. It names the revision it was made on
// (expectedRevision, required), and is refused only when a note or setting the plan changes was
// changed after that revision.
export const EXPECTED_REVISION_REQUIRED =
  'expectedRevision is required: send the revision slates.get returned (GET /api/v1/slates/{shareId}). A workshop or map edit carries it in its plan operation instead.'
export async function applyToCanvas(principal, input, { deps, mode, now, idempotencyKey, resource: slate }) {
  const { plan, userMessage = '', expectedRevision } = input
  if (expectedRevision === undefined)
    throw problem(400, 'invalid_request', EXPECTED_REVISION_REQUIRED, { details: { field: 'expectedRevision' } })
  const apply = (target) => {
    try {
      // A save refuses an operation that matched nothing (409 no_match); a preview reports it.
      return deps.applySlateOperationPlanToJSON(target, plan, { userMessage, requireMatches: mode !== 'preview' })
    } catch (error) {
      // The engine's own refusals (no_match, id_taken, connector_limit, ambiguous_selector)
      // carry a status, a code and details; the caller reads them as sent.
      if (error?.code && error?.status)
        throw problem(error.status, error.code, error.message, { details: error.details })
      throw problem(400, 'invalid_operation_plan', error.message)
    }
  }
  const respond = (result, revision) => ({
    ok: true,
    shareId: slate.shareId,
    revision,
    message: result.materializedPlan.message,
    operations: result.materializedPlan.operations,
    report: result.report,
  })
  // What a plan stores: the notes, and the slate settings its update_slate operations change.
  const setFor = (applied) => {
    const set = { nodes: applied.slate.nodes }
    for (const operation of applied.materializedPlan.operations) {
      if (operation.kind !== 'update_slate') continue
      Object.keys(operation.changes).forEach((key) => {
        const path = SLATE_OPTION_PATHS[key]
        // A slate key the engine accepts but this route cannot save is a contract gap, not a silent no-op.
        if (!path) throw problem(500, 'unsaved_slate_key', `The slate key ${key} cannot be saved by this server.`)
        set[path] = path.split('.').reduce((value, part) => value?.[part], applied.slate)
      })
    }
    return set
  }
  const conflict = (error) => problem(409, 'slate_changed', error.message, { details: error.details })
  if (mode === 'preview') {
    const previewed = apply(slate)
    // A preview names the conflict its save would meet.
    try {
      deps.saveCore.check({ current: slate, set: setFor(previewed), expectedRevision })
    } catch (error) {
      if (error?.code === 'slate_changed') throw conflict(error)
      throw error
    }
    return { status: 200, body: respond(previewed, slate.revision ?? 0) }
  }
  // Run receipts are unique per token and key. A key that already names a receipt (one
  // written before the registry kept its own record) is refused before the slate changes.
  if (
    idempotencyKey &&
    (await deps.operationRuns.findOneAsync({ tokenId: principal.tokenId, idempotencyKey }))
  )
    throw problem(409, 'idempotency_conflict', 'That key belongs to a different request. Use a new key.')
  let result
  let saved
  try {
    saved = await deps.saveCore.save({
      slateId: slate._id,
      actor: principal,
      source: 'operations',
      expectedRevision,
      conditions: {
        userId: slate.userId,
        orgId: slate.orgId ?? null,
        ...sharedSaveConditions(slate, principal.userId),
      },
      build(current) {
        result = apply(current)
        return { set: setFor(result) }
      },
    })
  } catch (error) {
    if (error?.code === 'slate_changed') throw conflict(error)
    if (error?.code === 'save_refused')
      throw problem(409, 'slate_changed', 'The slate changed while the operation was being applied. Refresh and retry.')
    throw error
  }
  const response = respond(result, saved.revision)
  await deps.operationRuns.insertAsync({
    userId: principal.userId,
    tokenId: principal.tokenId,
    slateId: slate._id,
    slateShareId: slate.shareId,
    idempotencyKey: idempotencyKey || null,
    revision: saved.revision,
    plan: result.materializedPlan,
    userMessage,
    report: result.report,
    response: { ...response, mode },
    createdAt: now(),
    expiresAt: runExpiry(now()),
  })
  return { status: 201, body: response }
}

export default defineAction({
  id: 'slates.applyOperations',
  title: 'Edit a slate',
  description:
    'Send mode "preview" to see the result without saving. Every edit names the revision it was made on: a canvas plan (notes and connections) sends expectedRevision, the revision slates.get returned; a workshop or map plan holds one operation with its own expectedRevision (workshop.revision), and saving it requires an Idempotency-Key. Without it the edit is refused with 400 invalid_request naming expectedRevision. On a workshop, workshop_edits makes 1 to 50 edits (add, move, rename, remove cards and lanes) by the rules people meet; a refusal answers 409 edit_refused with the sentence a person sees, and a move the rules refuse answers 409 move_refused. A saved workshop edit answers with a receiptId that undo_workshop_edit takes. A slate holds up to 8 boards: a workshop operation names its board (boardId, from slates.get boards[]); on a slate of several boards one that names none is refused with 400 board_required listing them. add_component adds a library component (components.list) beside the slate\'s notes and boards and answers with its boardId; it carries its own expectedRevision (the slate revision).',
  toolset: 'slates',
  kind: 'write',
  // A canvas plan may delete notes and connections (delete_nodes, disconnect_nodes).
  destructive: true,
  scope: 'slates:write',
  principals: ['agent'],
  mounts: { http: { method: 'POST', path: '/slates/{shareId}/operations', operationId: 'applySlateOperations' } },
  modes: ['save', 'preview'],
  idempotency: 'optional',
  replay: 'stored',
  input: {
    type: 'object',
    properties: {
      shareId: shareIdInput,
      userMessage: { type: 'string', default: '', description: 'What the person asked for, in their words.' },
      expectedRevision: {
        type: 'integer',
        minimum: 0,
        description:
          'Required with a canvas plan: the slate revision you read (slates.get, GET /slates/{shareId}). The edit is refused with 409 slate_changed only if a note or setting it changes was changed after that revision; adding notes never conflicts. Leaving it out is refused with 400 invalid_request. Workshop and map edits carry their own expectedRevision in the plan, and send none here.',
      },
      plan: {
        type: 'object',
        'x-validated-by': 'handler',
        oneOf: [ref('CanvasPlan'), ref('WorkshopEditsPlan'), ref('WorkshopUndoPlan'), ref('WorkshopMovePlan'), ref('PresentationOrderPlan'), ref('WorkshopLinePlan'), ref('MapAuthoringPlan'), ref('AddComponentPlan')],
      },
    },
    required: ['shareId', 'plan'],
    additionalProperties: false,
  },
  output: result,
  load: loadSlate(true),
  failure: { code: 'operation_failed', message: 'The request could not be completed. Retry with the same key.' },
  tool: { name: 'edit_slate', title: 'Edit a slate', description: 'Edit a slate: add, change, connect, lay out or remove notes and lines, and edit boards (cards, lanes, rules, plan weeks, budgets, presentation order; name the board on a slate with several). One call saves atomically; mode "preview" shows the result without saving.' },
  async handler(principal, input, ctx) {
    const slate = ctx.resource
    const requested = input.plan?.operations
    const workshopPlan = Array.isArray(requested) && requested.some((op) => isWorkshopOperation(op?.kind))
    let result
    // A library component: the board the chat's Add adds, placed beside the slate's notes.
    if (isAddComponentPlan(input.plan)) result = await applyAddComponent(principal, input, ctx)
    else if (slate.creative?.model?.kind === 'workshop') {
      // A slate's drawing is the notes beside whatever it holds, and a workshop is drawn on that
      // same canvas: a canvas plan edits those notes, as the in-app conversation can; a workshop
      // plan edits the workshop.
      if (!workshopPlan) result = await applyToCanvas(principal, input, ctx)
      else {
        if (input.expectedRevision !== undefined)
          throw problem(400, 'invalid_request', 'A workshop or map edit carries its expectedRevision inside the plan operation.')
        result = await applyToWorkshop(principal, input, ctx)
      }
    } else {
      if (slate.creative?.model || workshopPlan)
        throw problem(400, 'invalid_operation_plan', 'Choose an operation supported by this type of slate.')
      result = await applyToCanvas(principal, input, ctx)
    }
    if (ctx.mode === 'save' && result.status === 201) await showAgent(principal, slate, result.body, ctx.deps)
    return result
  },
})
