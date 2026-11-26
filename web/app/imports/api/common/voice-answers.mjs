// What a surface's own submit answered, as the text a voice session's tool call returns
// (send_to_slatebox: voice-protocol.mjs). It is the answer the person sees on screen, in the
// screen's own words, flattened to sentences the agent can say, or a code where the screen has no
// words (ANSWER): never words written for the model (those are registry prompts,
// server/ai-control/prompts/voice.mjs, and the relay wraps this text as data). Pure, so the words are
// tested (scripts/voice-client.test.mjs).
import { LIMITS } from './voice-protocol.mjs'

export const ANSWER_WORDS = Object.freeze({
  // the screen's own sentence under a preview (NativeCanvasConversation, WorkshopConversation)
  shown: 'Shown on the canvas with dashed outlines. Nothing is added until you keep it.',
  // the interview's own helper line under its message box
  interviewKeep: 'Nothing is kept until you choose Keep.',
})

// What an answer is when the screen has no words for it (voice-protocol.mjs ANSWER_CODES): the
// relay puts each in the registry's words (prompts voice.answer.<code>).
export const ANSWER = Object.freeze({
  none: Object.freeze({ code: 'none' }),
  discarded: Object.freeze({ code: 'discarded' }),
  empty: Object.freeze({ code: 'empty' }),
  busy: Object.freeze({ code: 'busy' }),
})

const MAX_LISTED = 8
const stop = (text) => {
  const t = String(text ?? '').trim()
  return !t || /[.!?…:]$/.test(t) ? t : `${t}.`
}
const sentences = (...parts) => parts.map(stop).filter(Boolean).join(' ').slice(0, LIMITS.toolOutput)
const listOf = (items) => {
  const words = items.map((item) => String(item ?? '').trim()).filter(Boolean)
  const shown = words.slice(0, MAX_LISTED)
  const more = words.length - shown.length
  return shown.join('; ') + (more > 0 ? `; and ${more} more` : '')
}

/**
 * A preview waiting for Keep or Discard, as the screen shows it. heading: previewHeading or
 * drawingHeading's words; labels: what it adds; changes: [{ before, after }]; removed: [{ text }];
 * warnings: the warning sentences the screen shows; extra: the screen's own further lines
 * (previewSaidLine, previewKeepSentence).
 */
export function previewAnswer({ heading = '', labels = [], changes = [], removed = [], warnings = [], extra = [] } = {}) {
  return sentences(
    String(heading).replace(/ · /g, ', '),
    ANSWER_WORDS.shown,
    labels.length ? `It adds: ${listOf(labels)}` : '',
    changes.length ? `It rewrites ${changes.length === 1 ? '1 note' : `${changes.length} notes`}: ${listOf(changes.map((c) => `${c.before} becomes ${c.after}`))}` : '',
    removed.length ? `It removes ${removed.length === 1 ? '1 note' : `${removed.length} notes`}: ${listOf(removed.map((r) => r.text))}` : '',
    ...warnings,
    ...extra,
  )
}

/** A reply in words (a question answered, a refusal, a kept change): the screen's own text. */
export const replyAnswer = (reply) => sentences(reply)

/**
 * The interview's answer: the agent's reply, and what it proposes to keep in About you (the chips
 * under its turn) with the screen's own line about keeping. proposed: [{ kind, text }]; kindLabel(kind) → its name.
 */
export function interviewAnswer(reply, proposed = [], kindLabel = (kind) => kind) {
  if (!proposed.length) return sentences(reply)
  return sentences(reply, `Proposed for About you: ${listOf(proposed.map((fact) => `${kindLabel(fact.kind)}: ${fact.text}`))}`, ANSWER_WORDS.interviewKeep)
}

/** What keeping the interview's proposals came to: [{ text, state: 'kept' | 'had' } | { text, error }]. */
export function keptFactsAnswer(results) {
  if (!results.length) return ANSWER.none
  return sentences(...results.map((r) => (r.error ? `${r.text}: ${r.error}` : r.state === 'had' ? `You already had: ${r.text}` : `Kept: ${r.text}`)))
}
