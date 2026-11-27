/* eslint-disable no-underscore-dangle */
// What the activity log keeps of a slate write. The save core (server/slate-save-core.mjs) tells
// the log after every create and every save that changed something; this turns that into
// entries. Pure. Every slate write on the server goes through the save core, so a slate created,
// copied, renamed or edited is in the log whichever door the change came through (the canvas, an
// agent's operations, a script, the library, a conversation).
//
// Not kept: a team import's or a move's slates (the import is one entry, import.team / move.team)
// and a migration's rewrite (no person did it).
import { clipName } from './events.mjs'

export const UNLOGGED_SOURCES = Object.freeze(['import', 'move', 'migration'])

const slateTarget = (slate) => ({ type: 'slate', id: slate?.shareId || slate?._id, name: slate?.options?.name || 'Untitled slate' })

// The save core's actor ({ kind, userId, tokenId?, tokenName?, visitor? }) as an entry names it.
export function saveActor(actor) {
  if (!actor || typeof actor !== 'object') return null
  const kind = ['person', 'guest', 'agent'].includes(actor.kind) ? actor.kind : 'person'
  if (kind !== 'guest' && !actor.userId) return null
  return {
    kind,
    ...(actor.userId && { userId: actor.userId }),
    ...(actor.tokenId && { tokenId: actor.tokenId }),
    ...(actor.tokenName && { tokenName: actor.tokenName }),
    ...(kind === 'guest' && typeof actor.visitor === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(actor.visitor) && { visitor: actor.visitor }),
  }
}

/**
 * → [[entry, options], ...] for one write.
 *   kind     'created' | 'saved'
 *   slate    the slate as it was before the save (saved) or as stored (created)
 *   set      the fields the save set (saved)
 *   notes    the notes it touched; fields: the other fields it changed
 */
export function slateWriteEntries({ kind, slate, set = {}, actor, source, notes = [], fields = [] }) {
  if (!slate || UNLOGGED_SOURCES.includes(source)) return []
  const who = saveActor(actor)
  if (!who) return []
  const base = { actor: who, target: slateTarget(slate), slateId: slate.shareId || slate._id, ...(slate.orgId && { orgId: slate.orgId }) }
  if (kind === 'created') {
    if (source === 'copy') return [[{ ...base, action: 'slate.copied' }, {}]]
    return [[{ ...base, action: 'slate.created', details: { source } }, {}]]
  }
  const out = []
  const renamed = Object.hasOwn(set, 'options.name') && clipName(set['options.name']) !== clipName(slate.options?.name)
  if (renamed) {
    const to = clipName(set['options.name']) || 'Untitled slate'
    out.push([{ ...base, target: { ...base.target, name: to }, action: 'slate.renamed', details: { from: clipName(slate.options?.name) || 'Untitled slate', to } }, {}])
  }
  const others = fields.filter((field) => !['options.name', 'options.searchName', 'name'].includes(field))
  if (notes.length || others.length) {
    const action = source === 'settings' && !notes.length ? 'slate.settingsChanged' : 'slate.edited'
    out.push([{ ...base, ...(renamed && { target: { ...base.target, name: clipName(set['options.name']) } }), action }, { coalesce: true }])
  }
  return out
}
