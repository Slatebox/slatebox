// The in-app conversation's drawing requests on exec: Preview / Keep / Discard.
//   preview: the direct path (typed steps and pasted lines, and anything with no AI to draft it)
//            turns the request into one canvas plan and previews it through the registry; the
//            AI path (anyone signed in on Cloud, metered; self-host with workshop AI) lets the model
//            write a program that runs in the sealed runner as a preview of this slate only.
//            Either way, what Keep will save is recorded: the writes, with their exact inputs.
//   keep:    sends those writes again in save mode, in order, with keys derived from the
//            preview's run, so a double click replays instead of saving twice. Keep is the
//            person's confirmation, so nothing is held; the reasons a script run would be held
//            for are shown as warnings in the preview instead.
// The principal is the person's session acting as an agent of their own account, with read
// and write but never sharing; it is rate-limited through the account's window.
import { createHash } from 'node:crypto'
import { nativeCanvasDraft } from '../../imports/api/common/native-canvas-conversation.mjs'
import { draftToPlan } from '../../imports/api/common/canvas-draft-plan.mjs'
import { lineRequest } from '../../imports/api/common/line-requests.mjs'
import { previewCanvasOf } from '../../imports/api/common/conversation-preview.mjs'
import { applyPlanToJSON } from 'slateboxjs/operations'
import { deriveKey, newExecId as defaultExecId } from './keys.mjs'
import { execChat } from '../methods/ai/exec-chat.mjs'

export const sessionPrincipal = (userId, connectionId) => ({
  kind: 'agent',
  userId,
  tokenId: 'session:' + connectionId,
  tokenName: 'Slatebox conversation',
  scopes: ['slates:read', 'slates:write'],
})

// The AI gate, unchanged: a model drafts only for an account that may generate, and only for
// a request that reads as prose (typed steps and pasted arrows are drawn directly).
export const aiQualifies = ({ canGenerate, message }) =>
  Boolean(canGenerate) && typeof message === 'string' && message.trim().length >= 10 && !/[→]|->/.test(message)

// What Keep compares with what Preview saw: a change to the drawing in between refuses Keep.
export const boardDigest = (board) =>
  createHash('sha256')
    .update(JSON.stringify([
      board.nodes || [], board.nativeConversationRevision || 0, board.creative?.model?.kind || null,
      board.options?.creationBrief || '', board.options?.name || '',
    ]))
    .digest('hex')

// The conversation's registry authorizes by the person's session (the rule the canvas uses):
// `opened` is what resolvePresentationSlate answered, {slateBase, accessLevel, canEdit}, or null.
// It answers what the token service answers, the slate read's access included (P07's read needs
// it), for a slate whose drawing the conversation may change.
export function sessionAuthorization(opened, userId, write = false) {
  const slate = opened?.slateBase
  if (!slate) return { slate: null, authorized: false }
  const drawable = !slate.creative || slate.nativeCanvasDrawing || slate.creative.model?.kind === 'workshop'
  const access = {
    role: opened.accessLevel || null,
    canEdit: Boolean(opened.canEdit),
    isOwner: Boolean(userId) && slate.userId === userId,
    linkRole: null,
    grantKey: null,
  }
  return { slate, authorized: drawable && (write ? access.canEdit : Boolean(access.role)), access }
}

export class TurnRefused extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const plainText = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()

// What the person is shown before Keep, written by the server from what the writes did, never
// from the program's own words (a plan's message is the model's to write, and board text the
// model read may steer it): the notes added, the old and new text of every note it rewrites,
// the notes it removes, and how many other notes it moves or restyles.
export function describeWrites(board, writes) {
  const before = new Map((board?.nodes || []).map((node) => [node.options?.id, String(node.options?.text ?? '')]))
  const created = new Set()
  const labels = []
  const changes = new Map()
  const removed = new Map()
  const restyled = new Set()
  const linesChanged = new Set()
  let links = 0
  for (const { body } of writes) {
    const report = body?.report || {}
    for (const id of report.created || []) created.add(id)
    for (const op of body?.operations || []) {
      if (op?.kind === 'add_nodes' && (op.ids || []).some((id) => created.has(id)) && op.text) labels.push(String(op.text))
      if (op?.kind === 'update_nodes' && op.changes?.text !== undefined)
        for (const id of op.target?.ids || [])
          if (before.has(id) && !created.has(id)) {
            const after = String(op.changes.text)
            if (plainText(after) === plainText(before.get(id))) changes.delete(id)
            else changes.set(id, { id, before: before.get(id), after })
          }
    }
    for (const id of report.deleted || [])
      if (before.has(id) && !created.has(id)) removed.set(id, { id, text: before.get(id) })
    for (const id of report.updated || []) if (before.has(id)) restyled.add(id)
    links += (report.connected || []).length
    for (const id of report.connectionsUpdated || []) linesChanged.add(id)
  }
  for (const id of [...changes.keys(), ...removed.keys()]) restyled.delete(id)
  if (restyled.size) labels.push(`Moves or restyles ${restyled.size} ${restyled.size === 1 ? 'note' : 'notes'}`)
  if (linesChanged.size) labels.push(`Changes ${linesChanged.size} ${linesChanged.size === 1 ? 'line' : 'lines'}`)
  return { labels, links, changes: [...changes.values()], removed: [...removed.values()] }
}

// What the canvas draws as the preview (previewArtwork): the notes the writes add, in the places
// Keep saves them, and the lines they draw from notes already on the board. Worked out by
// applying the previewed operations to a copy of the board, as the save will; null when the
// writes cannot be replayed here (the text summary is still shown).
export function canvasOfWrites(board, writes, shareId) {
  try {
    const before = new Map((board?.nodes || []).map((node) => [node.options?.id, node]))
    let slate = structuredClone({ ...board, nodes: board?.nodes || [] })
    for (const { method, input, body } of writes) {
      if (method !== 'slates.applyOperations' || input?.shareId !== shareId || !Array.isArray(body?.operations)) return null
      slate = applyPlanToJSON(slate, { message: body.message || 'Preview', operations: body.operations }, { requireMatches: false }).slate
    }
    const nodes = slate.nodes.filter((node) => !before.has(node.options?.id))
    const links = []
    for (const node of slate.nodes) {
      const was = before.get(node.options?.id)
      if (!was) continue
      const had = new Set((was.relationships?.associations || []).map((a) => a.id ?? a.childId))
      for (const association of node.relationships?.associations || [])
        if (!had.has(association.id ?? association.childId)) links.push({ parentId: node.options.id, association })
    }
    return nodes.length || links.length ? { nodes, links } : null
  } catch {
    return null
  }
}

export function createCanvasConversation({ registry, gate, service, manifest, tool, newExecId = defaultExecId, presence = null }) {
  // The reasons a script run would be held for, as warnings. The program's reads carry over:
  // what it read decides whether saving here puts content where more people can see it.
  async function warningsFor(principal, writes, readRank = null) {
    const ctx = gate.newContext({ execId: newExecId(), principal, surface: 'app', codeSha256: '', intent: '' })
    ctx.minReadRank = readRank
    const warnings = []
    for (const write of writes) {
      const { reasons, rewrites } = await gate.assess(ctx, registry.get(write.method), write.input)
      if (rewrites) ctx.counters.rewrittenText += rewrites
      for (const reason of reasons) warnings.push({ rule: reason.rule, ...(reason.count && { count: reason.count }) })
    }
    return warnings
  }

  async function preview({ principal, shareId, board, message, history = [], useAI, id, model, selection = null }) {
    let writes
    let execId
    let provider = 'direct'
    let calls
    let readRank = null
    let canvas = null
    if (useAI) {
      const outcome = await execChat({
        model,
        manifest,
        tool,
        shareId,
        board,
        message,
        history,
        selection,
        run: (intent, code) =>
          service.run({ principal, surface: 'app', intent, code, mode: 'preview', writableShareIds: [shareId] }),
      })
      if (outcome.reply) return { id, mode: 'draw', format: 'drawing', provider: 'ai', reply: outcome.reply, labels: [], links: 0, changes: [], removed: [], warnings: [], calls: [], writes: [] }
      writes = outcome.writes
      execId = outcome.result.execId
      readRank = outcome.result.context?.minReadRank ?? null
      calls = outcome.result.calls
      provider = 'ai'
      canvas = canvasOfWrites(board, writes, shareId)
    } else {
      // A plain request about lines is its own plan; anything else is drawn from the words.
      const lines = lineRequest(board, message, selection)
      if (lines?.problem) throw new TurnRefused('invalid-turn', lines.problem)
      let draft = null
      if (!lines) {
        try {
          draft = nativeCanvasDraft(board, message, id)
        } catch (error) {
          throw new TurnRefused('invalid-turn', error.message)
        }
        if (draft.mode !== 'draw') throw new TurnRefused('invalid-turn', 'Ask for a drawing change here.')
      }
      const { plan } = lines ?? draftToPlan(draft)
      // The edit names the revision the preview was made on, as every edit does.
      const input = { shareId, plan, userMessage: message, expectedRevision: board.revision ?? 0 }
      const result = await registry.run(principal, 'slates.applyOperations', { ...input, mode: 'preview' })
      writes = [{ n: 1, method: 'slates.applyOperations', input, body: result.body }]
      execId = newExecId()
      calls = [{ n: 1, method: 'slates.applyOperations', mode: 'preview', ok: true, status: result.status }]
      canvas = draft ? previewCanvasOf(draft) : canvasOfWrites(board, writes, shareId)
    }
    const { labels, links, changes, removed } = describeWrites(board, writes)
    return {
      id,
      mode: 'draw',
      format: 'drawing',
      provider,
      labels,
      links,
      changes,
      removed,
      canvas,
      warnings: await warningsFor(principal, writes, readRank),
      calls,
      writes: writes.map(({ body: _body, ...write }) => write),
      execId,
    }
  }

  // Keep saves as the person's agent: everyone on the slate sees "{first name}'s agent" do it,
  // with the plan the preview's script set (presence.plan is one of the writes), and then end.
  async function keep({ principal, writes, execId }) {
    const subject = principal.tokenId || principal.userId
    const saved = []
    let outcome = 'stopped'
    try {
      for (const write of writes) {
        const result = await registry.run(
          { ...principal, runId: execId },
          write.method,
          { ...write.input, mode: 'save' },
          { idempotencyKey: deriveKey(subject, execId, write.n) }
        )
        saved.push({ n: write.n, method: write.method, status: result.status, replayed: Boolean(result.meta?.replayed), body: result.body })
      }
      outcome = 'done'
      return saved
    } finally {
      await presence?.end(execId, outcome).catch(() => {})
    }
  }

  return { preview, keep }
}
