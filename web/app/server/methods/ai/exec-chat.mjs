// The in-app conversation's AI path on exec. The model gets one tool, exec, and writes a short
// program against the typed `slatebox` client; the program runs in the sealed runner as a
// preview limited to this slate. A program that fails, or changes nothing here, goes back to
// the model once with the runner's error. Nothing here calls a provider or runs code itself:
// both are passed in, so the flow is tested with a fake model and the real runner.
import { nativeDrawingContext } from '../../../imports/api/common/native-graph-draft.mjs'
import { selectedNotesContext } from '../../../imports/api/common/chat-selection.mjs'
import { promptText } from '../../ai-control/prompts/index.mjs'
import { groupPlanErrors, planErrorHints, planErrorsOf } from 'slateboxjs/operations'

const CHAT_METHODS = ['slates.get', 'slates.applyOperations']

// The instructions are a prompt an administrator can edit (exec.chat.system,
// server/ai-control/prompts/exec.mjs); the rules and declarations come from the registry.
export function chatSystemValues(manifest, shareId) {
  const methods = manifest.methods.filter((method) => CHAT_METHODS.includes(method.name))
  const types = ['CanvasPlan'].filter((name) => manifest.types[name]).map((name) => manifest.types[name])
  const declarations = [...methods.map((method) => method.dts), manifest.errorDeclaration, ...types]
  return {
    rules: manifest.rules ?? '',
    shareId: String(shareId),
    hasDeclarations: declarations.length > 0,
    declarations: declarations.join('\n\n'),
  }
}
export const chatSystemPrompt = (manifest, shareId) => promptText('exec.chat.system', chatSystemValues(manifest, shareId))

export function chatPrompts({ board, shareId, message, history = [], selection = null }) {
  const turns = history.slice(-2).flatMap((turn) => [
    { role: 'user', content: String(turn.message).slice(0, 1200) },
    { role: 'assistant', content: String(turn.reply).slice(0, 4000) },
  ])
  // The model sees a bounded view of the drawing (nativeDrawingContext); the program, running on
  // the server, reads the slate itself.
  return [...turns, { role: 'user', content: JSON.stringify({ shareId, currentDrawing: nativeDrawingContext(board, message),
    // What is selected on the canvas (a workshop's card or lane, a line by its connector id, or
    // plain notes by id and text), as context for the request: “this line” is that connector,
    // “these notes” are those notes.
    ...(selection?.kind === 'notes'
      ? (notes => notes && { selected: notes })(selectedNotesContext(board, selection))
      : selection && { selected: { kind: selection.kind, label: selection.label.replace(/[<>]/g, ''),
        ...(selection.kind === 'line' && typeof selection.id === 'string' && { connectorId: selection.id.replace(/[<>]/g, '').slice(0, 200) }) } }), request: message }) }]
}

// The writes a preview run made to this slate, with their exact inputs, numbered in order.
export const writesTo = (result, shareId) =>
  (result?.context?.writes || [])
    .filter((write) => write.method === 'slates.applyOperations' && write.input?.shareId === shareId && write.mode === 'preview')
    .map((write, index) => {
      const { mode: _mode, ...input } = write.input
      return { n: index + 1, method: write.method, input, body: write.body }
    })

// A refused plan's problems, as validatePlan listed them: the refusal's details when the gate passed
// them on, else its message split back into sentences. Empty for any other failure.
export function planProblems(error) {
  if (error?.code !== 'invalid_operation_plan') return []
  const listed = Array.isArray(error.details?.errors) ? error.details.errors.filter((line) => typeof line === 'string') : []
  return listed.length ? listed : planErrorsOf(error.message || '')
}

// What the model is told of a failed program: a refused plan grouped (one line per problem, not one per
// operation) with what the contract wants instead; any other failure in the runner's words.
export function failureWhy(error) {
  const problems = planProblems(error)
  if (problems.length) {
    const grouped = groupPlanErrors(problems).map((group) => group.message).join(' ')
    const hints = planErrorHints(problems)
    return `the plan was refused (invalid_operation_plan): ${grouped}${hints.length ? ` To fix it: ${hints.join(' ')}` : ''} Keep the operations that were right`
  }
  return `${error?.code}: ${error?.message}${error?.line ? ` (line ${error.line})` : ''}`
}

// A program that only read (slates.get and nothing else) and wrote nothing: a look before the change,
// not a failure. It is answered with "now make the change" without spending a repair.
const onlyRead = (result) => {
  const calls = Array.isArray(result?.calls) ? result.calls : []
  return calls.length > 0 && calls.every((call) => call?.method === 'slates.get' && call.ok !== false)
}

// Why no change came back, so the person is told something they can act on:
//   no_answer  the model answered nothing usable;  no_change  its program changed nothing here;
//   failed     its program failed (message: the runner's words, e.g. a note it named is not there;
//              problems: a refused plan's problems, grouped, once the repairs ran out).
export class ChatUnavailable extends Error {
  constructor(message, reason = 'no_answer', extra = {}) {
    super(message)
    this.reason = reason
    Object.assign(this, extra)
  }
}

// model({system, prompts, tool}) -> {toolCall: {name, arguments} | null, text?, abort?}
// run(intent, code) -> the exec output of a preview run limited to shareId
// attempts: programs that may fail or change nothing (the first and its repairs, each sent back with
// what was wrong). looks: programs that only read the slate, answered "now make the change" without
// spending an attempt. Every model call is charged to the one request the caller opened.
export async function execChat({ model, manifest, tool, shareId, board, message, history, selection = null, run, attempts = 3, looks = 1 }) {
  const system = chatSystemPrompt(manifest, shareId)
  let prompts = chatPrompts({ board, shareId, message, history, selection })
  let last
  let failures = 0
  let looked = 0
  while (failures < attempts) {
    const turn = await model({ system, prompts, tool })
    // a chosen model that cannot do this says so (model returns { abort, message })
    if (!turn || turn.abort) throw Object.assign(new ChatUnavailable(turn?.message || 'The model could not prepare a change.'), { said: Boolean(turn?.message) })
    if (!turn.toolCall) {
      const text = typeof turn.text === 'string' ? turn.text.trim() : ''
      if (text && text.length <= 1200) return { reply: text }
      throw new ChatUnavailable('The model could not prepare a change.', 'no_answer')
    }
    const args = turn.toolCall.arguments || {}
    const code = typeof args.code === 'string' ? args.code : ''
    const intent = typeof args.intent === 'string' && args.intent.trim() ? args.intent.trim().slice(0, 200) : message.slice(0, 200)
    last = code ? await run(intent, code) : { status: 'failed', error: { code: 'invalid_request', message: 'exec needs code.' }, calls: [] }
    const writes = writesTo(last, shareId)
    if (last.status === 'completed' && writes.length) return { result: last, writes }
    const look = last.status === 'completed' && looked < looks && onlyRead(last)
    if (look) looked += 1
    else failures += 1
    const why = last.status !== 'completed'
      ? failureWhy(last.error)
      : look ? 'it only read the slate and changed nothing; now make the change' : 'it made no change to this slate'
    prompts = [
      ...prompts,
      { role: 'assistant', content: `exec ${JSON.stringify({ intent, code: code.slice(0, 8000) })}` },
      { role: 'user', content: promptText('exec.chat.fix', { why, shareId: String(shareId) }) },
    ]
  }
  if (last?.status === 'completed') throw new ChatUnavailable('It made no change to this slate.', 'no_change')
  const problems = planProblems(last?.error)
  throw new ChatUnavailable(last?.error?.message || 'The model could not prepare a change.', last?.error?.message ? 'failed' : 'no_answer',
    { code: last?.error?.code ?? null, ...(problems.length && { problems: groupPlanErrors(problems) }) })
}
