import { mapObjectSelection } from '../../imports/api/common/map-object-edits.mjs'
import { Meteor } from 'meteor/meteor'
import { validateWorkshop, workshopToSlate } from 'slateboxjs/workshops/model'
import { withoutMoveMarks } from '../../imports/api/common/workshop-marks.mjs'
import { laneInstructions, laneTool, prepareLaneReply } from './lane-chat.mjs'
import { laneObjectSelection } from '../../imports/api/common/lane-conversation.mjs'
import { mapChatHistory, mapChatInstructions, mapChatTool, prepareMapReply } from './map-chat.mjs'
import { resolveCreativeSlate } from './creative-slates'
import { WorkshopRooms } from '../../imports/api/common/workshopRooms'
import CONSTANTS from '../../imports/api/common/constants'
import { Slates } from '../../imports/api/common/models'
import { runAIAction } from '../metering/context.mjs'
import { canStartAI } from '../metering/meteor'
import req from './ai/req'
import { surfaceOffFor } from './ai/ai-settings'
import { prepareConstraintProposal } from '../../imports/api/common/workshop-constraints.mjs'
import { constraintTool, constraintInstructions } from './workshop-constraint-draft.mjs'
import { releasePlanFromDraft, releaseInstructions, releaseDraftTool } from './workshop-release-draft.mjs'
import { conceptMapFromDraft, mapInstructions, mapDraftTool } from './workshop-map-draft.mjs'
import { promptText } from '../ai-control/prompts/index.mjs'
import { authorTool } from './workshop-lane-draft.mjs'
import { slateSaveCore, SlateEvents } from '../slate-save'
import { readMoveLog, timeInLane, waitedLine } from '../workshop-move-log.mjs'
import { MAIN_BOARD, boardIdPattern, slateAsBoard } from '../../imports/api/common/slate-boards.mjs'

// Anyone signed in may draft with AI. Who pays (own key, included amount (Pro credits) or balance) is the
// meter's decision; on a server with no meter the operator's provider is used.
const canGenerate = user => canStartAI(user)

function workshopChatTurn(input, map) {
  return runAIAction({ feature: map ? 'map-chat' : 'lane-chat' }, () => chatTurn(input, map))
}

async function chatTurn(input, map) {
  // the tools, instructions and retry are prompts an administrator can edit (ai-control/prompts/workshop.mjs)
  const tool = map ? mapChatTool() : laneTool()
  const prepare = map ? prepareMapReply : prepareLaneReply
  const { shareId, revision, message } = input || {}
  // Which board of the slate (its first, "main", when the page names none); `revision` is that board's own.
  const boardId = input?.boardId ?? MAIN_BOARD
  if (typeof shareId !== 'string' || !/^[a-zA-Z0-9]{1,40}$/.test(shareId) || typeof boardId !== 'string' || !boardIdPattern.test(boardId) ||
      !Number.isSafeInteger(revision) || revision < 0 || typeof message !== 'string' ||
      !message.trim() || message.length > 1200) throw new Meteor.Error('invalid-turn', 'Check the message and reopen the board.')
  let history
  try { history = mapChatHistory(input.history ?? []) }
  catch { throw new Meteor.Error('invalid-history', 'Reopen the conversation and try again.') }
  const user = await Meteor.userAsync()
  if (!user || user.isAnonymous) throw new Meteor.Error('sign-in', 'Sign in to use AI.')
  if (!await canGenerate(user)) throw new Meteor.Error('ai-unavailable', 'Ask your administrator to enable workshop generation for this instance.')
  let slateId = null
  const currentBoard = async () => {
    const access = await resolveCreativeSlate(shareId, user._id)
    slateId = access?.slateBase?._id ?? null
    const state = access?.slateBase && slateAsBoard(access.slateBase, boardId)?.creative
    if (!access?.canEdit || state?.model?.kind !== 'workshop' || (!state.model.workshop?.lanes?.length || Boolean(state.model.workshop.lanes[0].station) !== map)) {
      throw new Meteor.Error('unavailable', 'Open an editable board of the requested kind to continue the conversation.')
    }
    if (state.revision !== revision) throw new Meteor.Error('stale', map ? 'The map changed. Ask again on the latest version.' : 'The workshop changed. Ask again on the latest version.')
    return state.model.workshop
  }
  const workshop = await currentBoard()
  // How long cards have waited in each lane (the move log): the retro line the AI can say.
  let waited = null
  // The move log knows the first board's moves only until it records which board each was on (S4b).
  if (!map && slateId && boardId === MAIN_BOARD) {
    try { waited = waitedLine(timeInLane(await readMoveLog(SlateEvents.rawCollection(), slateId)), workshop) }
    catch (error) { console.warn('The move log could not be read.', error.message) }
  }
  let selection
  try { selection = (map ? mapObjectSelection : laneObjectSelection)(workshop, input.selection) }
  catch (error) { throw new Meteor.Error('invalid-selection', error.message) }
  // req chooses the model: the part's in Admin → AI control, or a person's own connection
  const now = Date.now()
  const acquired = await Meteor.users.updateAsync({ _id: user._id, $or: [
    { mapChatAvailableAt: { $exists: false } }, { mapChatAvailableAt: { $lte: now } },
  ] }, { $set: { mapChatAvailableAt: now + 180000 } })
  if (!acquired) throw new Meteor.Error('busy', 'Another map reply is being prepared. Try again shortly.')
  try {
    const turn = await req({
      // the board conversation's own surface (ai-control/catalogue.mjs: workshop, which follows chat)
      feature: map ? 'map-chat' : 'lane-chat', sdkChat: true, shareId,
      system: map ? mapChatInstructions() : laneInstructions(),
      prompts: [...history, { role: 'user', content: JSON.stringify({ [map ? 'currentMap' : 'currentWorkshop']: workshop, ...(waited && { waited }), ...(selection && {selection}), message }) }],
      functions: [tool], allowPlainText: true, maxResponseValidationRetries: 1,
      validateResponse: ({ message: response, toolCall }) => {
        try {
          if (!toolCall) {
            const reply = typeof response?.content === 'string' ? response.content : response?.content?.find(part => part.type === 'text')?.text
            if (!reply?.trim() || reply.length > 1200) throw new Error()
          } else {
            if (toolCall.name !== tool.name) throw new Error()
            prepare(toolCall.arguments, workshop, selection)
          }
          return null
        } catch (error) {
          // The board's own sentence for a change it turns down (a step that is not on the map, a hard limit): said to
          // the model on the retry, and to the person if the retry fails too.
          const reason = typeof error?.message === 'string' && error.message.length <= 300 ? error.message : ''
          return { code: 'invalid-map-turn', ...(reason && { reason }), retryPrompt: promptText('workshop.chat.retry', { reason }) }
        }
      },
    })
    if (turn.abort) {
      // a model that cannot do this, cannot be used, or a part an administrator turned off says so in its own words
      if (turn.capability || turn.unusable || turn.disabled) throw new Meteor.Error('reply-unavailable', turn.abortMessage)
      // The model called the tool; the change it proposed is one the board does not make. Said in the board's words.
      if (turn.rejected?.reason) throw new Meteor.Error('reply-unavailable', 'That change could not be made: ' + turn.rejected.reason + ' Your board is still saved.')
      throw new Meteor.Error('reply-unavailable', 'The model could not prepare a reply. Your board is still saved.')
    }
    await currentBoard()
    if (turn.toolCall) return { ...prepare(turn.toolCall.arguments, workshop, selection), revision }
    const reply = typeof turn.message.content === 'string' ? turn.message.content : turn.message.content.find(part => part.type === 'text').text
    return { reply, workshop: null, revision }
  } finally {
    await Meteor.users.updateAsync({ _id: user._id, mapChatAvailableAt: now + 180000 }, { $unset: { mapChatAvailableAt: true } })
  }
}

async function draftWorkshop(brief, format = 'lanes', currentDraft) {
  if (!['lanes', 'map', 'release-plan'].includes(format)) throw new Meteor.Error('invalid-format', 'Choose a workshop format.')
  if (typeof brief !== 'string' || brief.trim().length < 10 || brief.length > 1200) {
    throw new Meteor.Error('invalid-brief', 'Describe the decision in 10 to 1,200 characters.')
  }
  const user = await Meteor.userAsync()
  if (!user || user.isAnonymous) throw new Meteor.Error('sign-in', 'Sign in to use AI.')
  if (!await canGenerate(user)) throw new Meteor.Error('ai-unavailable', 'Ask your administrator to enable workshop generation for this instance.')
  let base
  if (currentDraft !== undefined) {
    try {
      base = validateWorkshop(currentDraft)
      if (!(format === 'map' && base.lanes[0].station || format === 'release-plan' && base.kind === format)) throw new Error()
    } catch { throw new Meteor.Error('invalid-workshop', 'Review the current workshop rules before asking for a revision.') }
  }

  // A part an administrator turned off says so in their words before the one-draft-a-minute lock.
  const off = await surfaceOffFor({ feature: 'workshop', userId: user._id })
  if (off) throw new Meteor.Error('draft-unavailable', off.message)

  // A conditional write covers simultaneous requests from multiple tabs or app replicas.
  const now = Date.now()
  const acquired = await Meteor.users.updateAsync({
    _id: user._id, $or: [
      { workshopDraftAvailableAt: { $exists: false } },
      { workshopDraftAvailableAt: { $lte: now } },
    ],
  }, { $set: { workshopDraftAvailableAt: now + 60000 } })
  if (!acquired) throw new Meteor.Error('busy', 'Please wait a minute before requesting another draft.')

  // the instructions, tools and retries are prompts an administrator can edit (ai-control/prompts/workshop.mjs)
  const special = base ? {
    tool: constraintTool(format), instructions: constraintInstructions(), error: 'invalidConstraintProposal',
    parse: result => prepareConstraintProposal(base, result),
  } : {
    map: () => ({ tool: mapDraftTool(), parse: conceptMapFromDraft, instructions: mapInstructions(), error: 'invalidConceptMapDraft' }),
    'release-plan': () => ({ tool: releaseDraftTool(), parse: releasePlanFromDraft, instructions: releaseInstructions(), error: 'invalidReleasePlanDraft' }),
  }[format]?.()
  const tool = special?.tool || { ...authorTool, description: promptText('tool.draft_workshop') }
  const parse = special?.parse || validateWorkshop
  const plan = await req({
    feature: 'workshop',
    prompts: [{ role: 'user', content: base ? JSON.stringify({ currentWorkshop: base, requestedChange: brief.trim() }) : brief.trim() }],
    system: special?.instructions || promptText('workshop.draft.system'),
    functions: [tool], function_call: { name: tool.name },
    maxResponseValidationRetries: 1,
    validateResponse({ toolCall }) {
      try {
        if (toolCall?.name !== tool.name) throw new Error('Call the requested tool.')
        parse(toolCall.arguments)
        return null
      } catch (error) {
        if (special) return {
          code: special.error,
          retryPrompt: promptText('workshop.draft.repair', { instructions: special.instructions, problem: String(error.message) }),
        }
        return { code: 'invalidWorkshopDraft', retryPrompt: promptText('workshop.draft.retry') }
      }
    },
  })
  // a chosen model that cannot do this says so; a chosen model that failed is named, never replaced
  if (plan.abort) throw new Meteor.Error('draft-unavailable', plan.capability || plan.unusable || plan.disabled ? plan.abortMessage : plan.chosen
    ? `${plan.chosenLabel} could not return a usable draft. Check the model service and its tool-calling support, or choose another model in your AI settings.`
    : 'The agent could not produce a valid draft. Revise the brief and try again.')
  return parse(plan.toolCall.arguments)
}

Meteor.methods({
  async 'workshops.account'() {
    const user = await Meteor.userAsync()
    return { canGenerate: await canGenerate(user) }
  },

  'workshops.mapChat'(input) { return workshopChatTurn(input, true) },
  'workshops.laneChat'(input) { return workshopChatTurn(input, false) },

  'workshops.draft'(brief, format = 'lanes', currentDraft) {
    return runAIAction({ feature: 'workshop' }, () => draftWorkshop.call(this, brief, format, currentDraft))
  },

  async 'workshops.saveCanvas'(draft, requestId) {
    const user = await Meteor.userAsync()
    if (!user) throw new Meteor.Error('sign-in', 'Open a guest account or sign in to save a slate.')
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9]{17}$/.test(requestId)) {
      throw new Meteor.Error('invalid-save', 'Please try opening the canvas again.')
    }
    let model
    try {
      // A new slate's board carries no move-anyway marks: the server writes those, never a page.
      model = validateWorkshop(withoutMoveMarks(draft))
    } catch {
      throw new Meteor.Error('invalid-workshop', 'The workshop must be valid before opening the canvas.')
    }
    // Retried browser calls map to one private editable copy for this account.
    const id = `workshop-${user._id}-${requestId}`
    const snapshot = workshopToSlate(model)
    const shareId = await Meteor.callAsync(CONSTANTS.methods.slates.generateShareId)
    const now = Date.now()
    const slate = {
      ...snapshot, _id: id, userId: user._id, shareId, created: now, lastSaved: now,
      workshop: model, ...(user.orgId ? { orgId: user.orgId } : {}),
      options: {
        ...snapshot.options, id, name: model.title, isPrivate: true, isPublic: false, isUnlisted: false,
      },
    }
    // Through the save core; a retried call names the same id and the slate is made once.
    await slateSaveCore.create({ row: slate, actor: { kind: user.isAnonymous ? 'guest' : 'person', userId: user._id }, source: 'create' })
    const saved = await Slates.findOneAsync({ _id: id, userId: user._id }, { fields: { shareId: 1 } })
    return saved.shareId
  },

  async 'workshops.recent'(format) {
    if (!this.userId) return []
    const selector = { userId: this.userId, 'workshop.version': 1 }
    if (format === 'map' || format === 'lanes') selector['workshop.lanes.0.station'] = { $exists: format === 'map' }
    if (format === 'release-plan') selector['workshop.kind'] = 'release-plan'
    if (format === 'lanes') selector['workshop.kind'] = { $ne: 'release-plan' }
    const rows = await Slates.find(selector, {
      fields: { shareId: 1, 'options.name': 1 }, sort: { created: -1 }, limit: 12,
    }).fetchAsync()
    const rooms = await WorkshopRooms.find({ _id: { $in: rows.map(row => row.shareId) }, ownerId: this.userId }, { fields: { _id: 1 } }).fetchAsync()
    const liveIds = new Set(rooms.map(room => room._id))
    return rows.map(row => ({ ...row, live: liveIds.has(row.shareId) }))
  },

  async 'workshops.restore'(shareId) {
    if (!this.userId || typeof shareId !== 'string' || !/^[a-f0-9]{10}$/.test(shareId)) {
      throw new Meteor.Error('unavailable', 'This workshop is unavailable.')
    }
    const slate = await Slates.findOneAsync({ shareId, userId: this.userId }, { fields: { workshop: 1 } })
    if (!slate?.workshop) throw new Meteor.Error('unavailable', 'This workshop is unavailable.')
    return validateWorkshop(slate.workshop)
  },
})
