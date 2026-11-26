// For you: a component built for the person opens on a new private slate of theirs, through the same
// door as an agent's add_component (component-add-op.mjs, with op.library naming their own draft):
// an empty private slate first, then the board added as its first board, which names the slate.
// No Meteor: deps are mount.js's (saveCore, operationRuns, library, generateShareId, newId,
// loadUser), so the tests run it over stand-ins.
import { applyAddComponent } from '../actions/component-add-op.mjs'
import { privateSlateDocument } from '../private-slate-document.mjs'

/**
 * → { shareId, revision, boardId }. `principal`: the person (or their agent) it is for; `itemId`:
 * their library draft (library.saveMade); `key`: this build's idempotency key, so a retried call
 * adds the board once.
 */
export async function openOnNewSlate({ deps, principal, itemId, key, now = Date.now }) {
  const user = await deps.loadUser(principal.userId)
  if (!user || user.isAnonymous) throw Object.assign(new Error('Sign up to keep what Slatebox builds for you.'), { status: 403, code: 'registration_required' })
  const shareId = await deps.generateShareId()
  const id = deps.newId()
  const row = privateSlateDocument({
    content: { options: { name: 'Untitled slate', description: '' }, nodes: [], nativeCanvasDrawing: true },
    id, user, shareId, now: now(),
  })
  const made = await deps.saveCore.create({ row, actor: principal, source: 'for-you' })
  if (!made?.created || !made.slate) throw new Error('The new slate could not be made.')
  const slate = made.slate
  const plan = { message: 'Built for you from an idea in For you.', operations: [{ kind: 'add_component', library: { itemId }, expectedRevision: slate.revision ?? 0 }] }
  const { body } = await applyAddComponent(principal, { shareId, plan }, { deps, mode: 'save', now, idempotencyKey: key, resource: slate })
  return { shareId, revision: body.revision, boardId: body.boardId }
}
