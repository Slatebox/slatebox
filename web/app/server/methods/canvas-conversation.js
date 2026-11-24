// canvasConversation.preview / canvasConversation.keep: the drawing requests of the in-app
// conversation (NativeCanvasConversation), on exec. Workshop and interactive-route requests
// stay on nativeCanvas.* until the registry has actions for them (P11).
//
// The AI path runs only for an account that may draft (anyone signed in on Cloud, where the
// meter decides who pays; selfHosted.workshopAI on a self-hosted instance), inside one metered
// request (runAIAction: own key, included amount (Pro credits) or balance, with its holds and ceiling), under the
// one-draft-a-minute lock, for a request that reads as prose. Every model call the exec turn
// makes (execChat's retries included) is charged to that request; req() refuses any call made
// outside one. Everything else takes the direct path, with no model, no code and no runner.
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { SlateAccess, Slates } from '../../imports/api/common/models'
import { draftingRefusal, nativeRequestKind, needsDrafting, unrecordedWorkshopOrigin } from '../../imports/api/common/native-canvas-conversation.mjs'
import { noteRequest, noteRequestProblem } from '../../imports/api/common/note-requests.mjs'
import { lineRequest } from '../../imports/api/common/line-requests.mjs'
import { renderExecTool } from '../actions/client-render.mjs'
import { createAppRegistry } from '../actions/index.mjs'
import { deps, exec as apiExec, idempotency, limiter } from '../actions/mount'
import { createMeteorExec } from '../exec/meteor'
import { aiQualifies, boardDigest as digest, createCanvasConversation, sessionAuthorization, sessionPrincipal, TurnRefused } from '../exec/conversation.mjs'
import { ChatUnavailable } from './ai/exec-chat.mjs'
import { resolvePresentationSlate } from './creative-slates'
import { sharedSaveConditions } from './native-slate-save.mjs'
import { slateSaveCore } from '../slate-save'
import { rememberInvitedEdit } from './joined-slates'
import { resolveAIFeatureConfig } from './ai/feature-config.mjs'
import req from './ai/req'
import { runAIAction } from '../metering/context.mjs'
import { aiRefusal } from '../metering/meteor'
import { refusalErrorArgs } from '../metering/refusal-pay.mjs'
import { validSelection } from '../../imports/api/common/chat-selection.mjs'

// In the app, a person opens a slate by its address, which may be an invitation key; the
// session's own rule decides access (the same rule the conversation has always used).
// A slate's drawing is the notes beside whatever it holds; a workshop is drawn on that same canvas.
const drawable = (slate) => !slate.creative || slate.nativeCanvasDrawing || slate.creative.model?.kind === 'workshop'
async function sessionAuthorize(token, shareId, write = false) {
  return sessionAuthorization(await resolvePresentationSlate(shareId, token.userId), token.userId, write)
}
async function readSlate(shareId) {
  if (typeof shareId !== 'string') return null
  const direct = await Slates.findOneAsync({ shareId })
  if (direct) return direct
  const grant = await SlateAccess.findOneAsync({ accessKey: shareId }, { fields: { slateId: 1 } })
  return grant ? Slates.findOneAsync({ _id: grant.slateId }) : null
}

const registry = createAppRegistry({ deps: { ...deps, authorizeTokenForSlate: sessionAuthorize }, idempotency, limiter })
const inApp = createMeteorExec({ registry, idempotency, readSlate, pool: apiExec.pool })
const conversation = createCanvasConversation({
  registry,
  gate: inApp.gate,
  service: inApp.service,
  manifest: inApp.manifest,
  tool: (({ name, description, inputSchema }) => ({ name, description, parameters: inputSchema }))(renderExecTool(inApp.manifest).exec),
  presence: deps.presence,
})

async function recordWorkshopOrigin(board, at, userId) {
  try {
    await slateSaveCore.save({ slateId: board._id, actor: { kind: 'person', userId }, source: 'conversation',
      conditions: { userId: board.userId, orgId: board.orgId ?? null, 'creative.model.kind': 'workshop', 'options.workshopOrigin': null, ...sharedSaveConditions(board, userId) },
      build: () => ({ set: { 'options.workshopOrigin': { x: at.x, y: at.y } } }) })
  } catch (error) {
    if (error?.code !== 'save_refused') throw error
  }
}

const changed = () => new Meteor.Error('stale', 'The drawing changed. Preview the request again.')
async function resolve(shareId, uid) {
  if (!uid || typeof shareId !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(shareId)) throw new Meteor.Error('unavailable')
  const access = await resolvePresentationSlate(shareId, uid)
  if (!access?.canEdit || !drawable(access.slateBase)) throw new Meteor.Error('unavailable', 'Open a drawing you can edit.')
  return access.slateBase
}

// The model, through the app's provider plumbing: provider choice, a self-hosted model, usage
// accounting and response validation all stay in req(). The Slatebox agent (server/agents) drafts
// through it too, under its own request feature (agent: the agent.slatebox surface, which follows
// the canvas conversation and then chat until an administrator chooses a model for it).
export function modelFor(shareId, feature = 'canvas') {
  // req chooses the model: the person's, their team's or the operator's connection, or the built-in AI
  const config = resolveAIFeatureConfig('generation', Meteor.settings)
  return async ({ system, prompts, tool }) => {
    const turn = await req({
      provider: config.provider, engine: config.engine, feature, sdkChat: true, shareId,
      system, prompts, functions: [tool], function_call: { name: tool.name }, allowPlainText: true,
      maxResponseValidationRetries: 1,
      validateResponse: ({ message, toolCall }) => {
        if (toolCall) return toolCall.name === tool.name && typeof toolCall.arguments?.code === 'string' && toolCall.arguments.code.trim()
          ? null : { code: 'invalid-exec-call', retryPrompt: 'Call exec with intent and code.' }
        const text = typeof message?.content === 'string' ? message.content : message?.content?.find?.(part => part.type === 'text')?.text
        return text?.trim() && text.length <= 1200 ? null : { code: 'invalid-exec-call', retryPrompt: 'Call exec with intent and code.' }
      },
    })
    if (turn.abort) return { abort: true, ...((turn.capability || turn.unusable) && { message: turn.abortMessage }) }
    const text = typeof turn.message?.content === 'string' ? turn.message.content : turn.message?.content?.find?.(part => part.type === 'text')?.text
    return { toolCall: turn.toolCall || null, text }
  }
}

const fail = (error) => {
  if (error instanceof Meteor.Error) return error
  if (error instanceof TurnRefused) return new Meteor.Error(error.code, error.message)
  if (error instanceof ChatUnavailable) return new Meteor.Error('draft-unavailable', error.said ? error.message : 'The agent could not produce a valid change. Revise the request and try again.')
  if (['slate_changed', 'no_match', 'id_taken'].includes(error?.code)) return changed()
  if (error?.code === 'rate_limited' || error?.code === 'exec_busy') return new Meteor.Error('busy', 'Another change is being prepared. Try again shortly.')
  if (error?.status && error.status < 500 && error.message) return new Meteor.Error('invalid-turn', error.message)
  console.error('[canvasConversation]', error?.code || error?.message)
  return new Meteor.Error('unavailable', 'The change could not be prepared. Try again.')
}

Meteor.methods({
  // `selection` is what is selected on the canvas (a workshop's card or lane, a line, or plain notes
  // by id: chat-selection.mjs), given to the model as context.
  async 'canvasConversation.preview'(shareId, message, history = [], selection = null) {
    if (typeof message !== 'string' || !message.trim() || message.length > 1200) throw new Meteor.Error('invalid-turn', 'Write a request of up to 1,200 characters.')
    if (!Array.isArray(history) || history.length > 6 || history.some(turn => !turn || typeof turn.message !== 'string' || turn.message.length > 1200 || typeof turn.reply !== 'string' || turn.reply.length > 4000)) throw new Meteor.Error('invalid-turn', 'Reload the conversation and try again.')
    if (!validSelection(selection)) throw new Meteor.Error('invalid-turn', 'Reload the conversation and try again.')
    if (nativeRequestKind(message) !== 'draw') throw new Meteor.Error('invalid-turn', 'Ask for a drawing change here.')
    // Too many notes at once, or markup in their words: say what to change.
    const problem = noteRequestProblem(message)
    if (problem) throw new Meteor.Error('invalid-turn', problem)
    const board = await resolve(shareId, this.userId), base = digest(board), id = Random.id()
    const principal = sessionPrincipal(this.userId, this.connection.id)
    const { canGenerate } = await Meteor.callAsync('workshops.account')
    // A plain request about the slate's lines (“connect sing to asfd”, “unpin the line ends”,
    // “detach this line from asfd”) is read as it stands, with no model, as notes asked for are.
    const lines = lineRequest(board, message, selection)
    if (lines?.problem) throw new Meteor.Error('invalid-turn', lines.problem)
    // Notes asked for by number or name are drawn as they stand. A request that has to be thought
    // up is drafted by AI for anyone signed in (and on an install with AI turned on); anyone else
    // is told how to get it rather than given a note holding the request.
    if (!canGenerate && !lines && needsDrafting(message)) {
      const user = await Meteor.userAsync()
      const refusal = draftingRefusal({ selfHosted: Meteor.settings.public?.env === 'selfhost', aiOn: Meteor.settings.selfHosted?.workshopAI === true,
        guest: Boolean(user?.isAnonymous), meter: await aiRefusal(user) })
      throw new Meteor.Error(...refusalErrorArgs(refusal))
    }
    const useAI = !noteRequest(message) && !lines && aiQualifies({ canGenerate, message })
    try {
      const turn = async () => {
        if (useAI) {
          const now = Date.now()
          const acquired = await Meteor.users.updateAsync({ _id: this.userId, $or: [
            { workshopDraftAvailableAt: { $exists: false } }, { workshopDraftAvailableAt: { $lte: now } },
          ] }, { $set: { workshopDraftAvailableAt: now + 60000 } })
          // The same one-draft-a-minute lock workshops.draft takes.
          if (!acquired) throw new Meteor.Error('busy', 'Please wait a minute before requesting another draft.')
        }
        return conversation.preview({ principal, shareId, board, message, history, useAI, id, selection, model: useAI ? modelFor(shareId) : null })
      }
      // The meter decides first (who pays, or a refusal), as workshops.draft does.
      const result = useAI ? await runAIAction({ feature: 'workshop' }, turn) : await turn()
      if (digest(await resolve(shareId, this.userId)) !== base) throw changed()
      if (result.reply) return { id, mode: 'draw', format: 'drawing', provider: 'ai', reply: result.reply, labels: [], links: 0, warnings: [], calls: [] }
      this.connection.slateboxCanvasPreview = { id, uid: this.userId, boardId: board._id, base, writes: result.writes, execId: result.execId, message, until: Date.now() + 600000,
        workshopOrigin: unrecordedWorkshopOrigin(board) }
      const { writes: _writes, execId: _execId, ...shown } = result
      return shown
    } catch (error) {
      throw fail(error)
    }
  },

  async 'canvasConversation.keep'(shareId, id) {
    const board = await resolve(shareId, this.userId)
    if (typeof id !== 'string' || !/^[A-Za-z0-9]{17}$/.test(id)) throw changed()
    const p = this.connection.slateboxCanvasPreview
    if (!p || p.id !== id || p.uid !== this.userId || p.boardId !== board._id || p.until < Date.now()) throw changed()
    // A second Keep of the same preview replays the saved writes instead of saving again.
    if (!p.kept && digest(board) !== p.base) throw changed()
    const principal = sessionPrincipal(this.userId, this.connection.id)
    let saved
    try {
      saved = await conversation.keep({ principal, writes: p.writes, execId: p.execId })
    } catch (error) {
      // The board moved on since the preview (a note it names is gone, or it changed under the save).
      if (error?.status >= 400 && error.status < 500 && !['rate_limited', 'forbidden', 'not_found'].includes(error.code)) throw changed()
      throw fail(error)
    }
    // The conversation changed this drawing: the same mark nativeCanvas.keep sets, which reopens
    // the conversation after the reload and refuses an older tab's autosave over the kept change.
    if (!p.kept) await Slates.rawCollection().updateOne({ _id: board._id }, {
      $inc: { nativeConversationRevision: 1 }, $set: { lastNativeCanvasProposal: { id, uid: this.userId } },
    })
    p.kept = true
    // A workshop drawn beside new notes stays where it was: its place, as it was drawn at the
    // preview, is recorded once the notes are saved.
    if (p.workshopOrigin) await recordWorkshopOrigin(board, p.workshopOrigin, this.userId).catch(() => {})
    await inApp.store.writeRun({
      _id: Random.id() + '-keep', subject: principal.tokenId, userId: this.userId, tokenId: principal.tokenId,
      tokenName: principal.tokenName, surface: 'app', intent: String(p.message).slice(0, 200), codeSha256: null,
      mode: 'save', keptFrom: p.execId, status: 'completed',
      calls: saved.map(({ n, method, status, replayed }) => ({ n, method, mode: 'save', ok: true, status, ...(replayed && { replayed }) })),
      counters: { calls: saved.length }, startedAt: new Date(), endedAt: new Date(),
    }).catch(() => {})
    if (board.userId !== this.userId) await rememberInvitedEdit(this.userId, board, shareId).catch(() => {})
    // The page that kept it draws the kept change itself, as one step its person can undo, instead of
    // reloading (which lost their undo history): the revisions its saves were stored at name the runs
    // it draws as its own (SlateOperationListener), and the conversation revision fences its autosave.
    // Only for a Keep that changed the drawing alone: one that added a board (add_component, a workshop edit)
    // opens it the way it always has.
    const stored = await Slates.rawCollection().findOne({ _id: board._id }, { projection: { nativeConversationRevision: 1, 'creative.revision': 1 } })
    const edits = saved.filter(({ method }) => !String(method).startsWith('presence.'))
    const drawingOnly = edits.length > 0 && edits.every(({ method, body }) => method === 'slates.applyOperations' && !body?.boardId && !body?.workshop) &&
      (stored?.creative?.revision ?? null) === (board.creative?.revision ?? null)
    if (!drawingOnly) return true
    return {
      revisions: edits.map(({ body }) => body?.revision).filter(Number.isInteger),
      nativeConversationRevision: stored?.nativeConversationRevision ?? 0,
    }
  },
})
