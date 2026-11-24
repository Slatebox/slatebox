// The in-app conversation's AI path on exec. The model gets one tool, exec, and writes a short
// program against the typed `slatebox` client; the program runs in the sealed runner as a
// preview limited to this slate. A program that fails, or changes nothing here, goes back to
// the model once with the runner's error. Nothing here calls a provider or runs code itself:
// both are passed in, so the flow is tested with a fake model and the real runner.
import { nativeDrawingContext } from '../../../imports/api/common/native-graph-draft.mjs'
import { selectedNotesContext } from '../../../imports/api/common/chat-selection.mjs'
import { promptText } from '../../ai-control/prompts/index.mjs'

const CHAT_METHODS = ['slates.get', 'slates.applyOperations']

// The instructions are a prompt an administrator can edit (exec.chat.system,
// server/ai-control/prompts/exec.mjs); the rules and declarations come from the registry.
export function chatSystemPrompt(manifest, shareId) {
  const methods = manifest.methods.filter((method) => CHAT_METHODS.includes(method.name))
  const types = ['CanvasPlan'].filter((name) => manifest.types[name]).map((name) => manifest.types[name])
  const declarations = [...methods.map((method) => method.dts), manifest.errorDeclaration, ...types]
  return promptText('exec.chat.system', {
    rules: manifest.rules ?? '',
    shareId: String(shareId),
    hasDeclarations: declarations.length > 0,
    declarations: declarations.join('\n\n'),
  })
}

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

export class ChatUnavailable extends Error {}

// model({system, prompts, tool}) -> {toolCall: {name, arguments} | null, text?, abort?}
// run(intent, code) -> the exec output of a preview run limited to shareId
export async function execChat({ model, manifest, tool, shareId, board, message, history, selection = null, run, attempts = 2 }) {
  const system = chatSystemPrompt(manifest, shareId)
  let prompts = chatPrompts({ board, shareId, message, history, selection })
  let last
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const turn = await model({ system, prompts, tool })
    // a chosen model that cannot do this says so (model returns { abort, message })
    if (!turn || turn.abort) throw Object.assign(new ChatUnavailable(turn?.message || 'The model could not prepare a change.'), { said: Boolean(turn?.message) })
    if (!turn.toolCall) {
      const text = typeof turn.text === 'string' ? turn.text.trim() : ''
      if (text && text.length <= 1200) return { reply: text }
      throw new ChatUnavailable('The model could not prepare a change.')
    }
    const args = turn.toolCall.arguments || {}
    const code = typeof args.code === 'string' ? args.code : ''
    const intent = typeof args.intent === 'string' && args.intent.trim() ? args.intent.trim().slice(0, 200) : message.slice(0, 200)
    last = code ? await run(intent, code) : { status: 'failed', error: { code: 'invalid_request', message: 'exec needs code.' }, calls: [] }
    const writes = writesTo(last, shareId)
    if (last.status === 'completed' && writes.length) return { result: last, writes }
    const why = last.status !== 'completed'
      ? `${last.error?.code}: ${last.error?.message}${last.error?.line ? ` (line ${last.error.line})` : ''}`
      : 'it made no change to this slate'
    prompts = [
      ...prompts,
      { role: 'assistant', content: `exec ${JSON.stringify({ intent, code: code.slice(0, 8000) })}` },
      { role: 'user', content: promptText('exec.chat.fix', { why, shareId: String(shareId) }) },
    ]
  }
  throw new ChatUnavailable(last?.error?.message || 'The model could not prepare a change.')
}
