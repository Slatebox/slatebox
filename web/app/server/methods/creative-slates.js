import { readStoredWorkshop, storedWorkshopLimit } from '../../imports/api/common/legacy-workshop-entry.mjs'
import { privateSlateDocument } from '../private-slate-document.mjs'
import { commandLiveSession, visibleLiveSession } from './live-presentation.mjs'
import { Meteor } from 'meteor/meteor'
import { rememberJoinedSlate, rememberInvitedEdit } from './joined-slates'
import { getSlatesForUser } from './slates'
import { createGuestAccount, guestLoginToken } from '../common/accounts'
import { canEditNativeSlate, sharedSaveConditions } from './native-slate-save.mjs'
import AuthManager from '../../imports/api/common/AuthManager'
import CONSTANTS from '../../imports/api/common/constants'
import { Slates, SlateAccess, Permissions, GuestViews } from '../../imports/api/common/models'
import { creativeSlates, nativeSlateStarters } from '../../imports/api/common/creativeSlates.mjs'
import { maxWorkshopFragmentLength } from '../../imports/api/common/portableWorkshopSlate.mjs'
import { slateSaveCore, fencedSlateSaveCore } from '../slate-save'
import { playWorkshopChanges, readWorkshopChanges, drawingAfter, tradeKey, tradesAfter } from './workshop-play.mjs'
import { storeTradePictures, storeWorkshopPictures } from './workshop-pictures.mjs'
import { recordedUndo, replaceWorkshop } from './workshop-replace.mjs'
import { moverName } from '../../imports/api/common/mover-name.mjs'
import { uploadS3Object } from '../common/s3Utils'
import { MAIN_BOARD, boardIdPattern, boardRecordId, boardSaveWrite, boardRecords, boardsCounter, boardsCounterRecordId, slateAsBoard, slateBoards } from '../../imports/api/common/slate-boards.mjs'

// The slate's picture store (the file store its images use), or null when this server has none.
const pictureStore = () => Meteor.settings.aws?.imageBucket && Meteor.settings.aws?.cloudUrl ? uploadS3Object : null

// An interactive slate is named and described from its model. The save core builds the search
// fields from that name and description.
function namedFrom(config, model) {
  return { name: config.name?.(model) ?? config.title, description: config.describe(model) }
}

const unavailable = () => new Meteor.Error('unavailable', 'This slate is unavailable.')
const validKey = value => typeof value === 'string' && /^[A-Za-z0-9]{1,40}$/.test(value)
// Which of the slate's boards a save or a move is for: its first board ("main") when the page names none.
const readBoardId = value => value === undefined || value === null ? MAIN_BOARD : typeof value === 'string' && boardIdPattern.test(value) ? value : null
const edit = CONSTANTS.slateAccessPermissions.edit.id

export async function resolvePresentationSlate(shareId, userId, includeNative = true) {
  const user = userId && await Meteor.users.findOneAsync(userId, { fields: { orgId: 1, isMasterUser: 1 } })
  const access = await getSlatesForUser({ shareId }, user)
  if (!access?.slateBase || (!includeNative && !access.slateBase.creative) || !access.accessLevel) return null
  const canEdit = Boolean(user && access.accessLevel === edit && await canEditNativeSlate({
    access: SlateAccess.rawCollection(),
    isTeamAdmin: id => AuthManager.userHasClaim(id, [CONSTANTS.claims.admin._id]),
  }, user, access.slateBase, undefined, shareId))
  let canJoin = false
  if (!userId && access.accessLevel === edit) {
    const board = access.slateBase
    const type = board.options.isPublic ? 'public' : board.options.isUnlisted ? 'unlisted' : null
    if (type) {
      // Offer a guest session only for the edit link the owner actually shared.
      canJoin = Boolean(await SlateAccess.findOneAsync({
        slateId: board._id, accessKey: shareId, type, userId: null, slateAccessPermissionId: edit,
      }, { fields: { _id: 1 } }))
    }
  }
  return { ...access, canEdit, canJoin }
}

export const resolveCreativeSlate = (shareId, userId) => resolvePresentationSlate(shareId, userId, false)

const liveSession = (principal, shareId, command, args) => commandLiveSession({
  boards: Slates.rawCollection(), resolve: resolvePresentationSlate, fail: (code, message) => new Meteor.Error(code, message),
}, principal, shareId, command, args)

Meteor.methods({
  // Presenting to everyone on a slate: the presenter's deck, and the step everyone is on.
  'creativeSlates.startPresentation'(shareId, deck) {
    return liveSession(this.userId, shareId, 'start', { deck })
  },
  'creativeSlates.movePresentation'(shareId, sessionId, controlKey, revision, step) {
    return liveSession(this.userId, shareId, 'move', { sessionId, controlKey, revision, step })
  },
  'creativeSlates.endPresentation'(shareId, sessionId, controlKey, revision) {
    return liveSession(this.userId, shareId, 'end', { sessionId, controlKey, revision })
  },
  async 'creativeSlates.createGuest'(shareId) {
    const admission = this.connection?.slateboxGuestAdmission
    if (this.userId || !validKey(shareId) || !admission) throw unavailable()
    const access = await resolveCreativeSlate(shareId, null)
    if (!access?.canJoin || access.slateBase._id !== admission.slateId) throw unavailable()
    const receipt = await GuestViews.findOneAsync({
      slateId: admission.slateId, guestCollaboratorId: admission.visitor,
      userId: null, actualGuest: true, joinedUserId: null,
      $expr: { $gt: [{ $ifNull: ['$passStartedAt', '$timestamp'] }, Date.now() - 86400000] },
    }, { fields: { _id: 1 } })
    if (!receipt) throw unavailable()
    const { userId: guestId, email } = await createGuestAccount()
    const guest = { _id: guestId }
    // Only the guest generated in this verified Join inherits this admission.
    const linked = await GuestViews.updateAsync(
      { _id: receipt._id, joinedUserId: null },
      { $set: { joinedUserId: guest._id } }
    )
    if (!linked) {
      await Meteor.users.removeAsync({ _id: guest._id })
      throw unavailable()
    }
    // Admission already succeeded. A history write must never strand the new account.
    await rememberJoinedSlate(guest._id, admission.slateId, shareId).catch(() =>
      console.warn('Could not remember the joined slate for the new guest.'))
    return { email, token: await guestLoginToken(guest._id) }
  },

  async 'creativeSlates.create'(kind, query, requestId) {
    const user = await Meteor.userAsync()
    const config = creativeSlates.get(kind)
    const starter = nativeSlateStarters.get(kind)
    const localWorkshop = kind === 'workshop' && typeof query === 'string' && query.startsWith('draft:')
    const maxLength = localWorkshop ? storedWorkshopLimit + 6 : starter?.maxLength ?? (kind === 'workshop' ? maxWorkshopFragmentLength : 1024)
    if (!user || !(config || starter) || typeof query !== 'string' || query.length > maxLength || typeof requestId !== 'string' || !/^[a-zA-Z0-9]{17}$/.test(requestId)) throw unavailable()
    let content = starter?.source
    if (starter?.readFragment) {
      try { content = starter.readFragment(query) }
      catch { throw new Meteor.Error('invalid-model', 'This slate link contains invalid notes.') }
    }
    if (config) {
      let model
      if (localWorkshop) {
        try { model = config.normalize({kind,version:1,workshop:readStoredWorkshop(query)}) }
        catch { throw new Meteor.Error('invalid-model','This workshop draft could not be opened.') }
      } else {
        try { model = config.initial(kind === 'workshop' ? query : new URLSearchParams(query)) }
        catch { throw new Meteor.Error('invalid-model', 'This workshop link contains an invalid model.') }
      }
      if (model?.kind !== kind) throw unavailable()
      content = { options: namedFrom(config, model), nodes: [], creative: { model, revision: 0 } }
    }
    const id = 'creative-' + user._id + '-' + requestId
    const shareId = await Meteor.callAsync(CONSTANTS.methods.slates.generateShareId)
    const now = Date.now()
    const row = privateSlateDocument({content, id, user, shareId, now})
    // A retried request names the same id: the slate is made once.
    await slateSaveCore.create({ row, actor: { kind: user.isAnonymous ? 'guest' : 'person', userId: user._id }, source: 'create' })
    return (await Slates.findOneAsync({ _id: id, userId: user._id }, { fields: { shareId: 1 } })).shareId
  },

  // `boardId`: which board of the slate (its first, "main", when not given); `revision` is that board's own.
  async 'creativeSlates.save'(shareId, revision, draft, boardId) {
    const board = readBoardId(boardId)
    if (!this.userId || !validKey(shareId) || !Number.isSafeInteger(revision) || revision < 0 || !board) throw unavailable()
    const access = await resolveCreativeSlate(shareId, this.userId)
    if (!access?.canEdit) throw unavailable()
    // The slate as this board sees it: creative is the board's own record.
    const slate = slateAsBoard(access.slateBase, board)
    if (!slate) throw unavailable()
    const config = creativeSlates.get(slate.creative.model.kind)
    if (!config || draft?.kind !== config.kind) throw unavailable()
    let model
    try { model = config.normalize(draft) }
    catch { throw new Meteor.Error('invalid-model', 'That change could not be saved.') }
    if (model?.kind !== config.kind) throw new Meteor.Error('invalid-model', 'That change could not be saved.')
    // A workshop keeps its kind and what its kind keeps, whole saves included. A launch plan, pipeline
    // or budget takes a whole board only as the Undo recorded for this person's last change, or as
    // the edits it amounts to, made here by its rules (workshop-replace.mjs). A picture held in the
    // page is stored with the slate's pictures first.
    let undo = null
    if (model.kind === 'workshop') {
      const before = slate.creative.model?.workshop
      if (!before) throw unavailable()
      try { model = { ...model, workshop: await storeWorkshopPictures(model.workshop, { slateId: shareId, store: pictureStore() }) } } catch (error) {
        throw new Meteor.Error('refused', error?.refused?.reason ?? 'That change could not be saved.', { laneId: error?.refused?.laneId ?? null })
      }
      let replaced
      // Who changes a rule, as the rule's audit line says it (the server stamps it, never the page).
      const account = await Meteor.users.findOneAsync(this.userId, { fields: { 'profile.name': 1, username: 1, isAnonymous: 1 } })
      const actor = { by: moverName(account) }
      try { replaced = replaceWorkshop(before, model.workshop, { undo: slate.creative.undo ?? null, revision, current: slate.creative.revision, userId: this.userId, actor }) }
      catch { throw new Meteor.Error('invalid-model', 'That change could not be saved.') }
      // Made on an older revision: a teammate's change came first (before anything else is said of it).
      if (replaced.stale) throw stale()
      if (replaced.refused) {
        const { reason, laneId, limits } = replaced.refused
        throw new Meteor.Error('refused', reason, { revision: slate.creative.revision, model: slate.creative.model, ...(laneId && { laneId }), ...(limits && { limits }) })
      }
      model = { ...model, workshop: replaced.workshop }
      undo = replaced.undone ? null : recordedUndo(before, revision + 1, this.userId)
    }
    if (!await storeModel(slate, config, model, revision, this.userId, null, null, undo, access.slateBase)) throw stale()
    await rememberInvitedEdit(this.userId, slate, shareId)
    return revision + 1
  },

  // A workshop played on its canvas: moves and renames, made here on the workshop as it stands
  // (server/methods/workshop-play.mjs). A note and a card trading places changes the slate's
  // drawing too, and both halves are saved in the same write: a page closed or reloaded the
  // moment after the trade keeps the note or the card, never both and never neither. Answers
  // with the saved model, its revision, and the model it replaced (what "Undo last change" puts
  // back). A refusal names the change refused (`at`), and `taken` when someone else made that
  // same trade first.
  // `boardId`: which board of the slate (its first, "main", when not given).
  async 'creativeSlates.play'(shareId, input, boardId) {
    const boardKey = readBoardId(boardId)
    if (!this.userId || !validKey(shareId) || !boardKey) throw unavailable()
    const invalid = () => new Meteor.Error('invalid-model', 'That change could not be saved.')
    let changes
    try { changes = readWorkshopChanges(input) } catch { throw invalid() }
    // A picture held in the page goes with its card: it is stored with the slate's pictures first.
    try { changes = await storeTradePictures(changes, { slateId: shareId, store: pictureStore() }) } catch (error) {
      if (error?.refused) throw new Meteor.Error('refused', error.refused.reason, { laneId: error.refused.laneId ?? null, at: error.at })
      throw invalid()
    }
    const config = creativeSlates.get('workshop')
    // Someone else's save can land between reading the workshop and writing it. Then the changes
    // are made again on what they saved.
    for (let attempt = 0; attempt < 5; attempt++) {
      const access = await resolveCreativeSlate(shareId, this.userId)
      if (!access?.canEdit) throw unavailable()
      const slate = slateAsBoard(access.slateBase, boardKey)
      if (!slate) throw unavailable()
      const before = slate.creative.model
      if (before?.kind !== config.kind) throw unavailable()
      const revision = slate.creative.revision
      // The revision a trade is recorded at: the slate's counter for all its boards (slate-boards.mjs).
      const counter = boardsCounter(access.slateBase)
      // The drawing as saved now, for a request that trades notes and cards.
      const drawn = changes.some(change => change.noteToCard || change.cardToNote)
        ? await Slates.findOneAsync({ _id: slate._id }, { fields: { nodes: 1, lastSaved: 1 } }) : null
      const noteIds = drawn ? (drawn.nodes ?? []).map(node => node?.options?.id).filter(id => typeof id === 'string') : undefined
      let played
      // Who moves a card anyway, as the card says it (the server stamps it, never the page).
      const account = changes.some(change => change.override) ? await Meteor.users.findOneAsync(this.userId, { fields: { 'profile.name': 1, username: 1, isAnonymous: 1 } }) : null
      const actor = account ? { by: moverName(account) } : null
      try { played = playWorkshopChanges(before.workshop, changes, noteIds, slate.creative.trades, actor) } catch { throw invalid() }
      if (played.refused) {
        throw new Meteor.Error('refused', played.refused.reason, { laneId: played.refused.laneId, revision, model: before, at: played.at, ...(played.taken ? { taken: true } : {}),
          ...(played.refused.overridable && { overridable: true }),
          ...(played.refused.limits && { limits: played.refused.limits }) })
      }
      let model
      try { model = config.normalize({ kind: config.kind, version: 1, workshop: played.workshop }) } catch { throw invalid() }
      const nodes = drawn ? drawingAfter(drawn.nodes, played.drawing) : null
      const drawing = nodes && JSON.stringify(nodes) !== JSON.stringify(drawn.nodes ?? []) ? { nodes, lastSaved: drawn.lastSaved ?? null } : null
      if (!drawing && JSON.stringify(model.workshop) === JSON.stringify(before.workshop)) return { revision, through: counter, model: before, previous: null, trades: slate.creative.trades ?? {}, ...(played.warnings?.length && { warnings: played.warnings }) }
      // The trades are recorded in the same write, with the revision they make: every screen, and
      // the room through the next to load the slate, follow this record (see tradesAfter).
      const traded = drawn ? played.drawing : { remove: [], add: [] }
      const trades = tradesAfter(slate.creative.trades, traded, counter + 1)
      const recorded = Object.fromEntries([...traded.remove, ...traded.add.map(note => note.options.id)].map(id => [tradeKey(id), trades[tradeKey(id)]]))
      // What "Undo last change" may put back on a launch plan, pipeline or budget: this board, for this
      // person, while nothing has changed since. A trade of a note and a card is undone on the canvas.
      const undo = drawing ? null : recordedUndo(before.workshop, revision + 1, this.userId)
      if (await storeModel(slate, config, model, revision, this.userId, drawing, recorded, undo, access.slateBase)) {
        await rememberInvitedEdit(this.userId, slate, shareId)
        // A warn rule let a card land: its sentence, for the board and the chat to say.
        return { revision: revision + 1, through: counter + 1, model, previous: before, trades, ...(played.warnings?.length && { warnings: played.warnings }) }
      }
    }
    throw stale()
  },
})

const stale = () => new Meteor.Error('stale', 'A teammate changed this slate. Try your change on the latest version.')

// Store a model on the revision it was made on, through the save core. False when the slate has
// moved on, or the person's access has changed since it was read. `slate` is the slate as the board
// sees it (slateAsBoard: creative is the board's record, `boardId` which board); `stored` the slate as
// stored. `drawing`: the slate's notes to save with it, read when the drawing was last saved; false as
// well when the drawing has been saved since. `trades`: the note and card trades this write makes, by
// note id (see tradesAfter). `undo`: the Undo this change records (workshop-replace.mjs), or null for none.
// On a slate of many boards the slate's counter for all of them goes up in the same write (slate-boards.mjs).
async function storeModel(slate, config, model, revision, userId, drawing = null, trades = null, undo = null, stored = slate) {
  const write = boardSaveWrite(slate, stored, { model, revision, drawing, trades, undo })
  const conditions = { ...write.conditions, ...sharedSaveConditions(slate, userId) }
  // The first board names its slate (a slate of one board); a further board never renames it.
  const names = (slate.boardId ?? MAIN_BOARD) === MAIN_BOARD && !slate.nativeCanvasDrawing && config.name
  const set = { ...write.set, ...(names && Object.fromEntries(Object.entries(namedFrom(config, model)).map(([key, value]) => ['options.' + key, value]))) }
  try {
    const account = await Meteor.users.findOneAsync(userId, { fields: { isAnonymous: 1 } })
    await fencedSlateSaveCore.save({ slateId: slate._id, actor: { kind: account?.isAnonymous ? 'guest' : 'person', userId }, source: 'workshop', conditions,
      build: () => ({ set, inc: write.inc }) })
    return true
  } catch (error) {
    if (error?.code === 'save_refused') return false
    throw error
  }
}

export { boardRecordId, boardsCounterRecordId }

async function publishPresentationState(shareId, native) {
  const collection = native ? 'nativePresentationStates' : 'creativeSlateStates'
  const resolve = async () => {
    // Every slate drawn on the canvas, a workshop slate included, can be presented live.
    return resolvePresentationSlate(shareId, this.userId, native)
  }
  if (!validKey(shareId)) { this.ready(); return }
  const userId = this.userId
  // Read using the caller's native access rules, including access keys and unlisted links.
  const initial = await resolve()
  if (!initial) { this.ready(); return }
  const id = initial.slateBase._id
  let stopped = false, initialized = false, running = false, sequence = 0
  // What each record last said (by its id): a board's record is sent again only when it changed, so
  // a card moved on one board resends that board alone.
  const shown = new Map()
  const handles = []
  let expiryTimer
  this.onStop(() => { stopped = true; clearTimeout(expiryTimer); handles.forEach(handle => handle.stop()) })
  const show = (records) => {
    for (const [id, fields] of records) {
      const said = JSON.stringify(fields)
      if (shown.get(id) === said) continue
      if (shown.has(id)) this.changed(collection, id, fields)
      else this.added(collection, id, fields)
      shown.set(id, said)
    }
    const kept = new Set(records.map(([id]) => id))
    for (const id of [...shown.keys()]) if (!kept.has(id)) { this.removed(collection, id); shown.delete(id) }
  }
  const refresh = async () => {
    sequence++
    if (!initialized || running || stopped) return
    running = true
    try {
      while (!stopped) {
        const pass = sequence
        const state = await resolve()
        if (stopped) return
        if (pass !== sequence) continue
        clearTimeout(expiryTimer)
        if (state) {
          const live = native ? visibleLiveSession(state.slateBase) : null
          if (live) expiryTimer = setTimeout(refresh, Math.max(1, live.expiresAt - Date.now()))
          // The live presentation goes to everyone who may read the slate. Its deck is a field of
          // its own: it is the same for the whole session, so it is sent once, not with every step.
          const { deck, ...livePresentation } = live ?? {}
          const boards = slateBoards(state.slateBase)
          show(native ? [[shareId, {
            livePresentation: live ? livePresentation : null,
            liveDeck: live ? { sessionId: live.sessionId, ...deck } : null,
            canEdit: state.canEdit,
            nativeConversationRevision: state.slateBase.nativeConversationRevision ?? 0,
            // A board added to the slate (from the chat, the library or an agent): open pages draw it
            // where it was placed, live, with no reload.
            holdsBoard: state.slateBase.creative?.model?.kind === 'workshop',
            workshopOrigin: state.slateBase.creative && Number.isFinite(state.slateBase.options?.workshopOrigin?.x) && Number.isFinite(state.slateBase.options?.workshopOrigin?.y)
              ? { x: state.slateBase.options.workshopOrigin.x, y: state.slateBase.options.workshopOrigin.y } : null,
            // Every board on the slate, by id, where it sits.
            boards: boards.map(board => ({ id: board.id, origin: board.origin })),
          }]] : boardRecords(state, shareId))
        } else show([])
        this.ready()
        break
      }
    } catch { if (!stopped) this.error(unavailable()) }
    finally { running = false }
  }
  // A native slate's state moves with its live session, its conversation, and a board added to it (or moved).
  const cursors = [Slates.find(id, { fields: { ...(native ? { livePresentation: 1, nativeConversationRevision: 1, 'creative.model.kind': 1, 'options.workshopOrigin': 1, boardSeq: 1 }
    : { creative: 1, boards: 1, boardsRevision: 1, 'options.workshopOrigin': 1 }), userId: 1, orgId: 1, 'options.isPrivate': 1, 'options.isUnlisted': 1, 'options.isPublic': 1 } }),
    SlateAccess.find({ slateId: id }, { fields: { userId: 1, type: 1, accessKey: 1, slateAccessPermissionId: 1 } })]
  if (userId) cursors.push(Meteor.users.find(userId, { fields: { orgId: 1, isMasterUser: 1 } }), Permissions.find({ userId }, { fields: { claimId: 1 } }))
  try {
    for (const cursor of cursors) {
      if (stopped) return
      const handle = await cursor.observeChangesAsync({ added: refresh, changed: refresh, removed: refresh })
      if (stopped) { await handle.stop(); return }
      handles.push(handle)
    }
    initialized = true
    await refresh()
  } catch { if (!stopped) this.error(unavailable()) }
}

Meteor.publish('creativeSlates.state', function (shareId) { return publishPresentationState.call(this, shareId, false) })
Meteor.publish('slates.presentationState', function (shareId) { return publishPresentationState.call(this, shareId, true) })
