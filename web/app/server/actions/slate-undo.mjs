// slates.undo and slates.redo (see slate-undo-record.mjs for what an edit keeps and how it is taken back).
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { loadSlate } from './slate-access.mjs'
import { shareIdInput } from './slate-schemas.mjs'
import { applyToCanvas } from './slate-operations.mjs'
import { stepPlan } from './slate-undo-record.mjs'

// The caller's own: their account, and the token they call with (an agent's token is that agent's).
const own = (principal, slate) => ({ slateId: slate._id, userId: principal.userId ?? null, tokenId: principal.tokenId ?? null })
const newest = { sort: { createdAt: -1, revision: -1 } }

/** The caller's newest saved canvas edit on this slate that is not undone. */
async function nextToUndo(runs, principal, slate) {
  return runs.findOneAsync({ ...own(principal, slate), undoable: { $exists: true }, undoneBy: null }, newest)
}

/**
 * The caller's edit they undid last, if nothing of theirs was saved on this slate after that undo (a new
 * edit clears what can be redone, as on the canvas).
 */
async function nextToRedo(runs, principal, slate) {
  const undone = await runs.findOneAsync({ ...own(principal, slate), undoable: { $exists: true }, undoneBy: { $ne: null } }, { sort: { undoneAt: -1 } })
  if (!undone) return null
  const later = await runs.findOneAsync({ ...own(principal, slate), undoable: { $exists: true }, createdAt: { $gt: undone.undoneAt } }, newest)
  return later ? null : undone
}

const output = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    shareId: { type: 'string' },
    revision: { type: 'integer', minimum: 0, description: 'The slate revision after this save.' },
    message: { type: 'string' },
    undone: { type: 'string', description: 'slates.undo: the edit it took back (its run id).' },
    redone: { type: 'string', description: 'slates.redo: the edit it made again (its run id).' },
    operations: { type: 'array', items: { type: 'object' }, description: 'The canvas plan that was saved to do it.' },
    left: {
      type: 'array',
      description: 'Each note, connection or setting someone else changed since, left as they left it.',
      items: { type: 'object', properties: { kind: { type: 'string' }, id: { type: 'string' }, key: { type: 'string' }, reason: { type: 'string' } } },
    },
  },
  required: ['ok', 'shareId', 'operations', 'left'],
}

function stepAction(direction) {
  const undo = direction === 'undo'
  return defineAction({
    id: undo ? 'slates.undo' : 'slates.redo',
    title: undo ? 'Undo' : 'Redo',
    description: undo
      ? 'Takes back the newest canvas edit this caller saved on the slate with slates.applyOperations (notes, connections, slate settings) that is not undone yet: the same account and the same token, so it never takes back a person\'s or another agent\'s edit. Each note, connection and setting the edit changed goes back to how it was, unless someone else changed it since: that part stays as they left it and is listed in left[]. The undo is saved as an edit (the revision goes up, every open canvas shows it) and answers the run it undid (undone). Workshop and map edits are undone with undo_workshop_edit. 409 nothing_to_undo when no edit of the caller is left to undo; 409 slate_changed when the slate changed while it was being saved (call again).'
      : 'Makes again the edit this caller last took back with slates.undo, if the caller has saved no edit on this slate since (a new edit clears what can be redone). Each part goes back to how the edit left it, unless someone else changed it since: that part stays as they left it and is listed in left[]. Saved as an edit, as slates.undo is. 409 nothing_to_redo when there is nothing of the caller\'s to redo.',
    toolset: 'slates',
    kind: 'write',
    // An undo of an edit that added notes removes them again.
    destructive: true,
    scope: 'slates:write',
    principals: ['agent'],
    mounts: { http: { method: 'POST', path: undo ? '/slates/{shareId}/undo' : '/slates/{shareId}/redo', operationId: undo ? 'undoSlateEdit' : 'redoSlateEdit' } },
    // Sent again with the same Idempotency-Key, it answers as it did the first time and undoes nothing more.
    idempotency: 'optional',
    replay: 'stored',
    input: { type: 'object', properties: { shareId: shareIdInput }, required: ['shareId'], additionalProperties: false },
    output,
    load: loadSlate(true),
    failure: { code: 'operation_failed', message: 'The request could not be completed. Call again.' },
    tool: undo
      ? { name: 'undo_my_edit', title: 'Undo my last edit', description: 'Take back your own newest canvas edit on a slate (never anyone else\'s); what someone changed since stays and is listed.' }
      : { name: 'redo_my_edit', title: 'Redo my last undo', description: 'Make again the canvas edit you last undid on a slate, if you have made no edit there since.' },
    async handler(principal, input, ctx) {
      const slate = ctx.resource
      const runs = ctx.deps.operationRuns
      const target = undo ? await nextToUndo(runs, principal, slate) : await nextToRedo(runs, principal, slate)
      if (!target) {
        throw undo
          ? problem(409, 'nothing_to_undo', 'There is no canvas edit of yours on this slate left to undo.')
          : problem(409, 'nothing_to_redo', 'There is nothing of yours on this slate to redo.')
      }
      const { operations, left } = stepPlan(target.undoable, slate, direction)
      const said = undo ? 'Undid your last edit.' : 'Redid your last undo.'
      let body = { ok: true, shareId: slate.shareId, revision: slate.revision ?? 0, message: said, operations: [], left }
      if (operations.length) {
        const saved = await applyToCanvas(principal, {
          plan: { message: said, operations },
          userMessage: undo ? 'Undo' : 'Redo',
          expectedRevision: slate.revision ?? 0,
        }, { ...ctx, mode: 'save', stepOf: { [direction]: target._id } })
        body = { ...body, revision: saved.body.revision, operations: saved.body.operations }
      } else if (left.length) {
        body.message = undo
          ? 'Someone else changed everything that edit changed since, so there was nothing of yours to take back.'
          : 'Someone else changed everything that edit changed since, so there was nothing of yours to make again.'
      }
      const at = ctx.now()
      await runs.updateAsync({ _id: target._id }, undo ? { $set: { undoneBy: 'undo-' + at, undoneAt: at } } : { $set: { undoneBy: null, redoneAt: at } })
      return { status: 200, body: { ...body, [undo ? 'undone' : 'redone']: target._id } }
    },
  })
}

export const slatesUndo = stepAction('undo')
export const slatesRedo = stepAction('redo')
export default [slatesUndo, slatesRedo]
