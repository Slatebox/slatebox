// slates.undo and slates.redo (see slate-undo-record.mjs for what an edit keeps and how it is taken back).
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { loadSlate } from './slate-access.mjs'
import { shareIdInput } from './slate-schemas.mjs'
import { applyToCanvas, showAgent } from './slate-operations.mjs'
import { stepPlan } from './slate-undo-record.mjs'

// The caller's own: their account, and the token they call with (an agent's token is that agent's).
const own = (principal, slate) => ({ slateId: slate._id, userId: principal.userId ?? null, tokenId: principal.tokenId ?? null })
const newest = { sort: { createdAt: -1, revision: -1 } }
// An undo or redo holds the edit it takes back while it saves, so two calls at once never pick the same
// edit. A hold older than this (a server that stopped mid-save) is free again.
const CLAIM_MS = 60000
const unclaimed = (at) => ({ $or: [{ claimedAt: null }, { claimedAt: { $lt: at - CLAIM_MS } }] })
const count = (result) => (typeof result === 'number' ? result : result?.modifiedCount ?? result?.matchedCount ?? 0)

/** The caller's newest saved canvas edit on this slate that is not undone. */
async function nextToUndo(runs, principal, slate, at) {
  return runs.findOneAsync({ ...own(principal, slate), undoable: { $exists: true }, undoneBy: null, ...unclaimed(at) }, newest)
}

/**
 * The caller's edit they undid last, if nothing of theirs was saved on this slate after that undo (a new
 * edit clears what can be redone, as on the canvas). An edit found already taken back by other means
 * (gone) is never redone.
 */
async function nextToRedo(runs, principal, slate, at) {
  const undone = await runs.findOneAsync(
    { ...own(principal, slate), undoable: { $exists: true }, undoneBy: { $ne: null }, gone: { $ne: true }, ...unclaimed(at) },
    { sort: { undoneAt: -1 } }
  )
  if (!undone) return null
  const later = await runs.findOneAsync({ ...own(principal, slate), undoable: { $exists: true }, createdAt: { $gt: undone.undoneAt } }, newest)
  return later ? null : undone
}

/**
 * An agent undoes and redoes by the rules its edits meet (slates.applyOperations): not while people paused
 * the slate's agents, and only straight to the slate when a person lets it edit directly. Its undo is then
 * filed as one action, so its Undo chip and the activity list stay in step. Answers the save's extra context.
 */
async function asAgent(principal, slate, ctx, message) {
  const store = ctx.deps.suggestions
  if (!store || principal.kind !== 'agent') return {}
  if ((await store.controlsOf(slate._id)).paused)
    throw problem(423, 'agents_paused', 'People on this slate paused its agents. Ask one of them to resume agents, then retry.')
  if (principal.builtin === 'slatebox' || !ctx.deps.presence?.identify) return {}
  const who = await ctx.deps.presence.identify(principal, slate)
  const direct = (await store.modeOf(slate._id, who.agentId, Boolean(ctx.deps.agentOptions?.editDirectly?.()))) === 'direct'
  if (!direct)
    throw problem(409, 'needs_direct_edit', 'People on this slate see this agent\'s edits as suggestions, so it cannot undo or redo straight to the slate. Suggest the change with slates.applyOperations, or ask a person to let it edit directly.')
  return {
    onApplied: ({ before, after, revision }) => store.applied(principal, slate, { before, after, revision, message, identity: who }),
  }
}

const removals = (operations) =>
  operations.reduce((sum, op) => sum + (op.kind === 'delete_nodes' ? op.target?.ids?.length ?? 0 : op.kind === 'disconnect_nodes' ? op.connectionIds?.length ?? 0 : 0), 0)

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
      ? 'Takes back the newest canvas edit this caller saved on the slate with slates.applyOperations (notes, connections, slate settings) that is not undone yet: the same account and the same token, so it never takes back a person\'s or another agent\'s edit. Each note, connection and setting the edit changed goes back to how it was, unless someone else changed it since: that part stays as they left it and is listed in left[]. The undo is saved as an edit (the revision goes up, every open canvas shows it) and answers the run it undid (undone). Workshop and map edits are undone with undo_workshop_edit. An agent undoes by the rules its edits meet: 423 agents_paused while people paused agents, 409 needs_direct_edit unless a person lets it edit directly. 409 nothing_to_undo when no edit of the caller is left to undo; 409 slate_changed when the slate changed while it was being saved (call again).'
      : 'Makes again the edit this caller last took back with slates.undo, if the caller has saved no edit on this slate since (a new edit clears what can be redone). Each part goes back to how the edit left it, unless someone else changed it since: that part stays as they left it and is listed in left[]. Saved as an edit, and refused for an agent, as slates.undo is. 409 nothing_to_redo when there is nothing of the caller\'s to redo.',
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
    // What a held call would take back: the exec gate holds it only when it removes notes or lines, and
    // the person's agreement names that edit (a newer edit in between makes the agreement stale).
    async peek(principal, input, ctx) {
      const slate = ctx.resource
      const runs = ctx.deps.operationRuns
      const at = ctx.now()
      const target = undo ? await nextToUndo(runs, principal, slate, at) : await nextToRedo(runs, principal, slate, at)
      if (!target) return null
      return { edit: target._id, removes: removals(stepPlan(target.undoable, slate, direction).operations) }
    },
    async handler(principal, input, ctx) {
      const slate = ctx.resource
      const runs = ctx.deps.operationRuns
      const said = undo ? 'Undid your last edit.' : 'Redid your last undo.'
      const extra = await asAgent(principal, slate, ctx, said)
      // An edit someone took back by other means (a person's Undo on the agent's action) has nothing left
      // to undo or redo: it is marked gone and the next one is taken, so it never blocks older edits.
      for (let tries = 0; tries < 20; tries += 1) {
        const at = ctx.now()
        const target = undo ? await nextToUndo(runs, principal, slate, at) : await nextToRedo(runs, principal, slate, at)
        if (!target) break
        // Taken for this call alone; a call that lost the race moves on to the next edit.
        // It must still be as it was read (not undone, or redone, meanwhile).
        const claimed = count(await runs.updateAsync(
          { _id: target._id, claimedAt: target.claimedAt ?? null, undoneBy: target.undoneBy ?? null, ...(target.redoneAt !== undefined && { redoneAt: target.redoneAt }) },
          { $set: { claimedAt: at } }
        ))
        if (!claimed) continue
        try {
          const { operations, left } = stepPlan(target.undoable, slate, direction)
          if (!operations.length && !left.length) {
            await runs.updateAsync({ _id: target._id }, { $set: { undoneBy: 'gone-' + at, undoneAt: at, gone: true, claimedAt: null } })
            continue
          }
          let body = { ok: true, shareId: slate.shareId, revision: slate.revision ?? 0, message: said, operations: [], left }
          if (operations.length) {
            const saved = await applyToCanvas(principal, {
              plan: { message: said, operations },
              userMessage: undo ? 'Undo' : 'Redo',
              expectedRevision: slate.revision ?? 0,
            }, { ...ctx, ...extra, mode: 'save', stepOf: { [direction]: target._id } })
            body = { ...body, revision: saved.body.revision, operations: saved.body.operations }
            await showAgent(principal, slate, saved.body, ctx.deps)
          } else {
            body.message = undo
              ? 'Someone else changed everything that edit changed since, so there was nothing of yours to take back.'
              : 'Someone else changed everything that edit changed since, so there was nothing of yours to make again.'
          }
          const done = ctx.now()
          await runs.updateAsync(
            { _id: target._id },
            undo ? { $set: { undoneBy: 'undo-' + done, undoneAt: done, claimedAt: null } } : { $set: { undoneBy: null, redoneAt: done, claimedAt: null } }
          )
          return { status: 200, body: { ...body, [undo ? 'undone' : 'redone']: target._id } }
        } catch (error) {
          await runs.updateAsync({ _id: target._id, claimedAt: at }, { $set: { claimedAt: null } })
          throw error
        }
      }
      throw undo
        ? problem(409, 'nothing_to_undo', 'There is no canvas edit of yours on this slate left to undo.')
        : problem(409, 'nothing_to_redo', 'There is nothing of yours on this slate to redo.')
    },
  })
}

export const slatesUndo = stepAction('undo')
export const slatesRedo = stepAction('redo')
export default [slatesUndo, slatesRedo]
