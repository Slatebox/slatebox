import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { loadSlate } from './slate-access.mjs'
import { tokenLike } from './principal.mjs'
import { ref, shareIdInput } from './slate-schemas.mjs'
import { isWorkshopOperation } from '../workshop-operation-api.mjs'
import { sharedSaveConditions } from '../methods/native-slate-save.mjs'
import { applyAddComponent, isAddComponentPlan } from './component-add-op.mjs'
import { runExpiry } from '../../imports/api/common/slate-operation-runs.mjs'
import { choreography, publicAction, withOwnGhosts } from '../agents/suggestions.mjs'

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
    outcome: {
      type: 'string',
      enum: ['saved', 'suggested'],
      description: 'suggested: an agent\'s canvas edit is shown live on the slate as suggestions for people there to keep or discard; nothing was saved yet (revision is unchanged). Its new notes\' ids work in your next edit. saved: the edit is saved.',
    },
    suggestion: { type: 'object', description: 'outcome suggested: the suggestion (actionId, items) as list_suggestions gives it.' },
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
function applyPlanTo(deps, target, plan, userMessage, requireMatches) {
  try {
    // A save refuses an operation that matched nothing (409 no_match); a preview reports it.
    return deps.applySlateOperationPlanToJSON(target, plan, { userMessage, requireMatches })
  } catch (error) {
    // The engine's own refusals (no_match, id_taken, connector_limit, ambiguous_selector)
    // carry a status, a code and details; the caller reads them as sent.
    if (error?.code && error?.status)
      throw problem(error.status, error.code, error.message, { details: error.details })
    throw problem(400, 'invalid_operation_plan', error.message)
  }
}

// attribution: which agent a kept suggestion or an undo came from (on the run every canvas draws).
// onApplied({ before, after, revision }): told what a save changed (an agent editing directly is filed as one action).
export async function applyToCanvas(principal, input, { deps, mode, now, idempotencyKey, resource: slate, attribution = null, onApplied = null }) {
  const { plan, userMessage = '', expectedRevision } = input
  if (expectedRevision === undefined)
    throw problem(400, 'invalid_request', EXPECTED_REVISION_REQUIRED, { details: { field: 'expectedRevision' } })
  const apply = (target) => applyPlanTo(deps, target, plan, userMessage, mode !== 'preview')
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
  let before = null
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
        before = current
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
    ...(attribution && { agent: attribution }),
    createdAt: now(),
    expiresAt: runExpiry(now()),
  })
  if (onApplied) await onApplied({ before, after: result.slate, revision: saved.revision })
  return { status: 201, body: response }
}

// Slate settings are not suggested (there is no ghost of a background): a person changes them, or
// an agent a person lets edit directly.
const SETTINGS_NEED_DIRECT =
  'Slate settings (update_slate) are changed by a person, or by an agent a person lets edit directly. Suggest notes and lines instead.'

/**
 * An agent's canvas edit, as suggestions everyone on the slate sees live: applied to the slate with
 * the agent's own waiting notes in it (so it builds on what it suggested), checked as a save would
 * be, and filed for people to keep or discard. Nothing is saved; the pointer goes to each ghost.
 */
export async function suggestToCanvas(principal, input, ctx, who) {
  const { deps, resource: slate } = ctx
  const { plan, userMessage = '', expectedRevision } = input
  if (expectedRevision === undefined)
    throw problem(400, 'invalid_request', EXPECTED_REVISION_REQUIRED, { details: { field: 'expectedRevision' } })
  if ((plan?.operations || []).some((operation) => operation?.kind === 'update_slate'))
    throw problem(409, 'needs_direct_edit', SETTINGS_NEED_DIRECT)
  const store = deps.suggestions
  const own = (await store.list(slate._id)).filter((action) => action.agentId === who.agentId)
  const base = withOwnGhosts(slate, own)
  const applied = applyPlanTo(deps, base, plan, userMessage, true)
  try {
    deps.saveCore.check({ current: slate, set: { nodes: applied.slate.nodes }, expectedRevision })
  } catch (error) {
    if (error?.code === 'slate_changed') throw problem(409, 'slate_changed', error.message, { details: error.details })
    throw error
  }
  const message = applied.materializedPlan.message || userMessage
  const { action, changedEarlier } = await store.suggest(principal, slate, { base, after: applied.slate, message, identity: who })
  if (action && deps.presence) {
    const { targets, point } = choreography(action.items)
    try {
      await deps.presence.saved(principal, slate, { targets, point, message, say: 'Suggesting ' + action.summary })
    } catch (error) {
      console.error('[presence]', error?.message)
    }
  }
  return {
    status: action || changedEarlier ? 202 : 200,
    body: {
      ok: true,
      shareId: slate.shareId,
      revision: slate.revision ?? 0,
      message: action
        ? `Suggested on the slate: ${action.summary}, shown live to everyone there for a person to keep or discard. Nothing is saved until then; the new notes' ids work in your next edit.`
        : changedEarlier ? 'Your waiting suggestions were changed.' : 'Nothing to suggest: the edit changes nothing.',
      operations: applied.materializedPlan.operations,
      report: applied.report,
      outcome: 'suggested',
      ...(action && { suggestion: publicAction(action) }),
    },
  }
}

export default defineAction({
  id: 'slates.applyOperations',
  title: 'Edit a slate',
  description:
    'mode "preview" shows the result without saving. Every edit names the revision it was made on: a canvas plan (notes and connections) sends expectedRevision, the revision slates.get returned; a workshop or map plan holds one operation with its own expectedRevision (workshop.revision), and saving it requires an Idempotency-Key. Without it the edit is refused with 400 invalid_request naming expectedRevision. On a workshop, workshop_edits makes 1 to 50 edits (add, move, rename, remove cards and lanes) by the rules people meet; a refusal answers 409 edit_refused with the sentence a person sees, and a move the rules refuse answers 409 move_refused. A saved workshop edit answers with a receiptId that undo_workshop_edit takes. A slate holds up to 8 boards: a workshop operation names its board (boardId, from slates.get boards[]); on a slate of several boards one that names none is refused with 400 board_required listing them. add_component adds a library component (components.list) beside the slate\'s notes and boards and answers with its boardId; it carries its own expectedRevision (the slate revision). A canvas plan saved by an agent is shown live on the slate as suggestions (outcome "suggested", 202) for people there to keep or discard, unless a person lets that agent edit directly; its new notes\' ids work in the next edit.',
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
  tool: { name: 'edit_slate', title: 'Edit a slate', description: 'Edit a slate: add, change, connect, lay out or remove notes and lines, and edit boards (cards, lanes, rules, plan weeks, budgets, presentation order; name the board on a slate with several). One call saves atomically; mode "preview" shows the result without saving. Your canvas edits appear live as suggestions people on the slate keep or discard.' },
  async handler(principal, input, ctx) {
    const slate = ctx.resource
    const requested = input.plan?.operations
    const workshopPlan = Array.isArray(requested) && requested.some((op) => isWorkshopOperation(op?.kind))
    const store = ctx.deps.suggestions
    // Pause all agents (agents.control): anyone who may edit the slate stops every agent's edits on it.
    if (store && principal.kind === 'agent' && ctx.mode === 'save' && (await store.controlsOf(slate._id)).paused)
      throw problem(423, 'agents_paused', 'People on this slate paused its agents. Ask one of them to resume agents, then retry.')
    const canvas = (inputs) => canvasEdit(principal, inputs, ctx)
    let result
    // A library component: the board the chat's Add adds, placed beside the slate's notes.
    if (isAddComponentPlan(input.plan)) result = await applyAddComponent(principal, input, ctx)
    else if (slate.creative?.model?.kind === 'workshop') {
      // A slate's drawing is the notes beside whatever it holds, and a workshop is drawn on that
      // same canvas: a canvas plan edits those notes, as the in-app conversation can; a workshop
      // plan edits the workshop.
      if (!workshopPlan) result = await canvas(input)
      else {
        if (input.expectedRevision !== undefined)
          throw problem(400, 'invalid_request', 'A workshop or map edit carries its expectedRevision inside the plan operation.')
        result = await applyToWorkshop(principal, input, ctx)
      }
    } else {
      if (slate.creative?.model || workshopPlan)
        throw problem(400, 'invalid_operation_plan', 'Choose an operation supported by this type of slate.')
      result = await canvas(input)
    }
    if (ctx.mode === 'save' && result.status === 201) await showAgent(principal, slate, result.body, ctx.deps)
    return result
  },
})

// A canvas plan. An agent's save is a suggestion (ghosts everyone on the slate sees, for a person
// to keep), unless a person let that agent edit directly; then it saves, filed as one undoable
// action. The Slatebox agent works on tasks a person assigned and approved, and saves; a person's
// own edits and every preview are unchanged.
async function canvasEdit(principal, input, ctx) {
  const { deps, mode, resource: slate } = ctx
  const store = deps.suggestions
  if (!store || principal.kind !== 'agent' || principal.builtin === 'slatebox' || mode !== 'save' || !deps.presence?.identify)
    return applyToCanvas(principal, input, ctx)
  const who = await deps.presence.identify(principal, slate)
  const direct = (await store.modeOf(slate._id, who.agentId, Boolean(deps.agentOptions?.editDirectly?.()))) === 'direct'
  if (!direct) return suggestToCanvas(principal, input, ctx, who)
  const result = await applyToCanvas(principal, input, {
    ...ctx,
    onApplied: ({ before, after, revision }) =>
      store.applied(principal, slate, { before, after, revision, message: input.plan?.message || input.userMessage || '', identity: who }),
  })
  return { ...result, body: { ...result.body, outcome: 'saved' } }
}
