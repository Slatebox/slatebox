import { resolveSlateRole, slateVisibility } from './slate-role.mjs'
import { hasWorkshop, workshopNamesSlate } from '../../imports/api/common/workshop-notes.mjs'
import { holdsManyBoards, slateBoards } from '../../imports/api/common/slate-boards.mjs'

// Visibility, tenant and identity change through their own workflows. Canvas
// autosaves update content without replacing the persisted options document.
const protectedOptions = new Set([
  'id', 'shareId', 'userId', 'orgId', 'isPrivate', 'isUnlisted', 'isPublic',
  'allowCollaboration', 'isSharing', 'accessKey', 'url_name', 'isTemplate', 'templateApproved', 'isCommunity', 'isFeatured',
])

function validKey(key) {
  return key && !key.includes('.') && !key.startsWith('$') &&
    !key.includes('\0') && !['__proto__', 'constructor', 'prototype'].includes(key)
}

const visibilityFields = ['isPrivate', 'isUnlisted', 'isPublic']
const projection = { nativeConversationRevision: 1, _id: 1, userId: 1, orgId: 1, shareId: 1, sharingRevision: 1, 'options.url_name': 1,
  'creative.model': 1, 'creative.revision': 1, 'creative.trades': 1, nativeCanvasDrawing: 1, boards: 1, boardsRevision: 1 }

/**
 * The notes a canvas save stores on a slate whose notes and cards have traded places
 * (creative.trades, recorded by creativeSlates.play with the revision of each trade). `seen` is the
 * revision the screen had drawn every trade through; a page that does not say (one loaded before
 * this release) is taken to have drawn none. A note that is a card now is never stored; a note a
 * card became that the screen had not drawn yet is kept as stored. Anything else is the screen's: a
 * traded note its person moved or deleted after it was drawn stays so.
 *
 * The record is only as good as its writers: a previous release's server (a rolling deploy) trades
 * without recording it. Its trade back to a note puts the note in the stored drawing, which a trade
 * to a card this release recorded never leaves there: a "card" record whose note the stored drawing
 * holds is older than that drawing, and the note is kept.
 */
async function settleSavedTrades(nodes, trades, seen, storedNodes) {
  if (!trades || typeof trades !== 'object') return nodes
  const ids = new Set(nodes.map(node => node?.options?.id))
  // A record kept under another key names its note (an older note id; see tradeKey).
  const records = Object.entries(trades).map(([key, trade]) => [typeof trade?.id === 'string' ? trade.id : key, trade])
  const carded = records.filter(([id, trade]) => trade?.as === 'card' && ids.has(id)).map(([id]) => id)
  const drewAll = Number.isSafeInteger(seen)
  const unseen = records
    .filter(([id, trade]) => trade?.as === 'note' && (!drewAll || (Number.isSafeInteger(trade.r) && trade.r > seen)) && !ids.has(id)).map(([id]) => id)
  if (!carded.length && !unseen.length) return nodes
  const stored = await storedNodes()
  const storedIds = new Set(stored.map(node => node?.options?.id))
  const cards = new Set(carded.filter(id => !storedIds.has(id)))
  const kept = cards.size ? nodes.filter(node => !cards.has(node?.options?.id)) : nodes
  const back = unseen.map(id => stored.find(node => node?.options?.id === id)).filter(Boolean)
  return back.length ? [...kept, ...back] : kept
}
for (const key of visibilityFields) projection['options.' + key] = 1

// Content writes leave sharing alone. Only a collaborator relies on a mutable grant.
export function sharedSaveConditions(board, userId) {
  if (userId && userId === board.userId) return {}
  const conditions = { sharingRevision: board.sharingRevision ?? null }
  for (const key of visibilityFields) conditions['options.' + key] = board.options?.[key] ?? null
  return conditions
}

export async function canEditNativeSlate({ access, guestViews, isTeamAdmin, now = Date.now() }, user, board, guestCollaboratorId, routeKey) {
  if (user?._id && board.userId === user._id) return true
  const visibility = slateVisibility(board)
  if (!user?._id && (visibility === 'private' || typeof guestCollaboratorId !== 'string' ||
      !await guestViews.findOne({ guestCollaboratorId, slateId: board._id,
        userId: null, actualGuest: { $ne: false }, timestamp: { $gt: now - 86400000 } }))) return false
  const admin = user?.isMasterUser === true ||
    Boolean(user?.orgId && user.orgId === board.orgId && await isTeamAdmin(user._id))
  const grants = await access.find({ slateId: board._id, type: visibility }, {
    projection: { slateId: 1, type: 1, userId: 1, accessKey: 1, slateAccessPermissionId: 1 },
  }).toArray()
  const invitation = routeKey !== board.shareId && routeKey !== board.options?.url_name ? routeKey : undefined
  // Older clients omit their URL. Existing unsigned admissions can use the
  // sole general edit grant; mixed-grant slates require a specific invitation.
  if (!user?._id && visibility === 'public' && routeKey === undefined) {
    const general = grants.filter(g => !g.userId)
    return general.length === 1 && general[0].slateAccessPermissionId === 'EDIT'
  }
  return resolveSlateRole(board, user, admin, grants, invitation) === 'EDIT'
}

// Who a browser save is from, for the event log.
const browserActor = (user, request) => user?._id
  ? { kind: user.isAnonymous ? 'guest' : 'person', userId: user._id }
  : { kind: 'guest', userId: null, ...(typeof request?.guestCollaboratorId === 'string' && { visitor: request.guestCollaboratorId }) }

export async function saveNativeSlate({ slates, saveCore, access, guestViews, isTeamAdmin, rememberInvitedEdit, recordGuestEdit, denied, now = Date.now() }, user, request, attempt = 0) {
  const snapshot = request?.slate
  const id = snapshot?.options?.id
  if (typeof id !== 'string' || !id.length || !Array.isArray(snapshot.nodes)) throw denied()
  const options = Object.fromEntries(Object.entries(snapshot.options).filter(([key]) => validKey(key)))
  if (user?.isMasterUser === true && options.isTemplate) {
    options.templateApproved = true
    options.userNameOverride = 'Slatebox'
  }
  let board = await slates.findOne({ _id: id }, { projection })
  if (!board) {
    if (!user?._id || typeof snapshot.shareId !== 'string' || !snapshot.shareId) throw denied()
    if (await slates.findOne({ shareId: snapshot.shareId, _id: { $ne: id } }, { projection: { _id: 1 } })) throw denied()
    if (user.isMasterUser !== true) {
      delete options.templateApproved
      delete options.isFeatured
    }
    // Insert only, through the save core (revision 1, search fields, a create event). A racing
    // save must reauthorize against the winning document.
    const made = await saveCore.create({
      row: { _id: id, userId: user._id, ...(user.orgId && { orgId: user.orgId }),
        shareId: snapshot.shareId, created: now, lastSaved: now, nodes: snapshot.nodes, options },
      actor: browserActor(user, request),
      source: 'create',
    })
    if (made.created) return now
    board = await slates.findOne({ _id: id }, { projection })
    if (!board || board.userId !== user._id || board.shareId !== snapshot.shareId) throw denied()
  }

  if (!await canEditNativeSlate({ access, guestViews, isTeamAdmin, now }, user, board, request.guestCollaboratorId, request.routeKey)) throw denied()

  // A workshop slate is edited by people who have joined it. A visitor who has not joined reads it,
  // the ordinary notes beside the workshop included.
  if (hasWorkshop(board) && !user?._id) throw denied()

  if ((request.nativeConversationRevision ?? 0) !== (board.nativeConversationRevision ?? 0)) throw denied()
  // Every note the canvas sends is the slate's own, whatever it is called. The workshop's lanes
  // and cards are never among them: the engine keeps them out of what it exports, and they are
  // saved as creative.model by creativeSlates.save. A note and a card that traded places are as
  // the server recorded the trade (settleSavedTrades), and a trade saved meanwhile makes this
  // save again on what it left.
  // On a slate of many boards every board's trades count (each note traded on one board only; the
  // trades of all of them are recorded at the slate's counter for all its boards, slate-boards.mjs).
  const many = holdsManyBoards(board)
  const trades = many ? Object.assign({}, ...slateBoards(board).map(item => item.trades ?? {})) : board.creative?.trades
  const nodes = await settleSavedTrades(snapshot.nodes, trades, request.tradesThrough,
    async () => (await slates.findOne({ _id: id }, { projection: { nodes: 1 } }))?.nodes ?? [])
  // The undo marker (collabBaseline: the room's whole-slate replacement this drawing holds) is the
  // save's own or none. A save from a screen that had not seen someone's undo must not leave that
  // undo's marker on its notes: the next to load would keep them and never replay the undo.
  const fields = { nodes, 'options.collabBaseline': null }
  // The workshop's title names its slate. A canvas save holds whatever name the page loaded with.
  const named = workshopNamesSlate(board)
  for (const [key, value] of Object.entries(options)) {
    if (protectedOptions.has(key) || (named && (key === 'name' || key === 'description'))) continue
    // Where the workshop sits is two finite numbers, or it is not stored.
    if (key === 'workshopOrigin') {
      if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) fields['options.workshopOrigin'] = { x: value.x, y: value.y }
      continue
    }
    fields['options.' + key] = value
  }
  const revision = board.creative ? board.creative.revision ?? null : undefined
  const conditions = { nativeConversationRevision: board.nativeConversationRevision ?? null, _id: id, userId: board.userId ?? null, orgId: board.orgId ?? null, shareId: board.shareId ?? null,
    ...(revision !== undefined && { 'creative.revision': revision }), ...(many && { boardsRevision: board.boardsRevision ?? null }), ...sharedSaveConditions(board, user?._id) }
  // The save core diffs what is stored against this snapshot, records the notes it touched,
  // raises the revision and builds the search fields. The browser names no revision (P05b).
  const { _id: _slateId, ...holding } = conditions
  try {
    await saveCore.save({ slateId: id, actor: browserActor(user, request), source: 'autosave', conditions: holding, build: () => ({ set: fields }) })
  } catch (error) {
    if (error?.code !== 'save_refused') throw error
    // A workshop change was saved between this save's read and its write: made again on it.
    const latest = revision !== undefined && await slates.findOne({ _id: id }, { projection })
    const moved = latest?.creative && ((latest.creative.revision ?? null) !== revision || (many && (latest.boardsRevision ?? null) !== (board.boardsRevision ?? null)))
    if (moved && attempt < 4) {
      return saveNativeSlate({ slates, saveCore, access, guestViews, isTeamAdmin, rememberInvitedEdit, recordGuestEdit, denied, now }, user, request, attempt + 1)
    }
    throw denied()
  }
  if (request.hasLocalEdit === true && !user?._id && request.keepProof) {
    let canKeep = false
    try { canKeep = await recordGuestEdit(board, request.guestCollaboratorId, request.routeKey, request.keepProof) }
    catch { console.warn('Could not prepare the guest’s saved slate for My Slates.') }
    return { savedAt: now, canKeep }
  }
  if (request.hasLocalEdit === true) await rememberInvitedEdit(user?._id, board, request.routeKey)
  return now
}
