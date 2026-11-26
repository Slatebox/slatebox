// What a voice session tells its realtime model, provider-neutral: the part's registry prompts
// (voice.<part>.system and .opening, tool.send_to_slatebox, voice.resume), the binding's voice and
// model, and the one tool. The adapters (adapters/*.mjs) turn it into Gemini's setup or OpenAI's
// session.update. Pure: `text` is the registry's promptText (a test run passes its own renderer).
import { VOICE_SURFACES } from '../ai-control/catalogue.mjs'
import { promptText } from '../ai-control/prompts/index.mjs'
import { ANSWER_CODES, LIMITS, TOOL_CONFIRM, TOOL_NAME } from '../../imports/api/common/voice-protocol.mjs'

// send_to_slatebox's arguments: shapes only. What each means is the registry's
// tool.send_to_slatebox, read per session (no model-facing words live in code).
export const SEND_TOOL_PARAMETERS = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: {
    text: { type: 'string', maxLength: LIMITS.text },
    confirm: { type: 'string', enum: [...TOOL_CONFIRM] },
  },
})

/** The prompt ids a voice part's session uses (the answers' are the relay's: session.mjs). */
export const voicePromptIds = (surface) => [`${surface}.system`, `${surface}.opening`, 'tool.send_to_slatebox', 'voice.resume']
/** The prompts the relay puts a tool call's answer in: the screen's text as data, or a code's words. */
export const ANSWER_PROMPT_IDS = Object.freeze(['voice.answer', 'voice.late-answer', 'voice.tool-failed', ...ANSWER_CODES.map((code) => `voice.answer.${code}`)])

/** The tool as a session sends it: its description the published tool.send_to_slatebox, read now. */
export const sendTool = (text = promptText) => ({ name: TOOL_NAME, description: text('tool.send_to_slatebox', {}), parameters: SEND_TOOL_PARAMETERS })

/**
 * A session's config. route: the connection the request path chose (ai-settings-core resolveFor:
 * { model, voice?, transcriptionModel? }); mode: open or ptt; resume: what carries on from a session
 * that moved ({ handle } for Gemini, { earlier } text for a provider without resumption).
 * → { surface, model, voice, transcriptionModel, instructions, opening, tool, mode, resumeHandle, resumeText }
 */
export function voiceConfig({ surface, route, mode = 'open', resume = null, text = promptText }) {
  if (!VOICE_SURFACES.includes(surface)) throw new Error(`voice: ${surface} is not a voice part`)
  const earlier = typeof resume?.earlier === 'string' && resume.earlier.trim() ? resume.earlier : null
  return {
    surface,
    model: route.model,
    voice: route.voice || null,
    transcriptionModel: route.transcriptionModel || null,
    instructions: text(`${surface}.system`, {}),
    opening: resume ? null : text(`${surface}.opening`, {}),
    tool: sendTool(text),
    mode,
    resumeHandle: typeof resume?.handle === 'string' ? resume.handle : null,
    resumeText: earlier ? text('voice.resume', { earlier }) : null,
  }
}
