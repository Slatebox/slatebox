// For you: a component built for the person opens on a new private slate of theirs, through the same
// door as an agent's add_component (component-add-op.mjs, with op.library naming their own draft):
// an empty private slate first, then the board added as its first board, which names the slate.
// No Meteor: deps are mount.js's (saveCore, operationRuns, library, generateShareId, newId,
// loadUser), so the tests run it over stand-ins.
import { applyAddComponent } from '../actions/component-add-op.mjs'
import { privateSlateDocument } from '../private-slate-document.mjs'
import { MAX_BOARDS } from '../../imports/api/common/slate-boards.mjs'

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

/**
 * A start page tile (server/start/tiles-core.mjs): its boards, one to MAX_BOARDS library drafts of the
 * person's, opened together on one new private slate named for the tile, each through the same door
 * as an agent's add_component. A slate holds up to 8 boards (slate-boards.mjs MAX_BOARDS); each one
 * added goes BOARD_GAP to the right of everything already there, on the first board's row, past the
 * room every board keeps (component-add.mjs componentPlace), so no board covers another. A guest's
 * tile opens on the guest's own slate, as the start page's first slate does.
 * → { shareId, revision, boardIds }. `key`: this build's idempotency key (each board adds once).
 */
export async function openBoardsOnNewSlate({ deps, principal, itemIds, name, key, now = Date.now }) {
  if (!Array.isArray(itemIds) || !itemIds.length || itemIds.length > MAX_BOARDS) throw Object.assign(new Error(`A slate holds 1 to ${MAX_BOARDS} boards.`), { status: 400, code: 'invalid_request' })
  const user = await deps.loadUser(principal.userId)
  if (!user) throw Object.assign(new Error('Open Slatebox again to make this slate.'), { status: 403, code: 'sign_in' })
  const shareId = await deps.generateShareId()
  const id = deps.newId()
  const row = privateSlateDocument({
    content: { options: { name: String(name || 'Untitled slate').slice(0, 100), description: '' }, nodes: [], nativeCanvasDrawing: true },
    id, user, shareId, now: now(),
  })
  const made = await deps.saveCore.create({ row, actor: principal, source: 'start-tile' })
  if (!made?.created || !made.slate) throw new Error('The new slate could not be made.')
  let slate = made.slate
  let revision = slate.revision ?? 0
  const boardIds = []
  for (const [index, itemId] of itemIds.entries()) {
    const plan = { message: 'Made from your tile on the start page.', operations: [{ kind: 'add_component', library: { itemId }, expectedRevision: revision }] }
    const { body } = await applyAddComponent(principal, { shareId, plan }, { deps, mode: 'save', now, idempotencyKey: `${key}-${index}`, resource: slate })
    boardIds.push(body.boardId)
    revision = body.revision
    // the slate as it stands now: the next board is placed beside this one
    if (index < itemIds.length - 1) slate = (await deps.resolveSlateForUser(shareId, principal.userId))?.slate
    if (!slate) throw new Error('The new slate could not be read.')
  }
  return { shareId, revision, boardIds }
}
