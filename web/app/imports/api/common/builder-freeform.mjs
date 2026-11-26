// Building a smart component from a description (library spec §4.2, "Pick a shape to start from, or describe it"):
// on a builder slate that holds no board yet, words that are no shape, no catalogue board, no lanes, board or
// play request and no notes asked for by name describe the component itself ("snappable congruent pieces to
// compose new printable materials"). They are made into a board of lanes, its pieces cards, with drag rules in its
// rulebook (behaviour as data), never into loose notes: only a board can be saved as a smart component (useBuilder).
// With an agent to draft it (workshops.draft, the lanes format) the board is drafted from the words; without one,
// or when the draft fails, a starter board named after the words is made here, for the chat to reshape. Pure, so
// the server, the page and the tests read the same.
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { nativeRequestKind } from './native-canvas-conversation.mjs'
import { noteRequest, noteRequestProblem } from './note-requests.mjs'

const words = (message) => (typeof message === 'string' ? message.replace(/\s+/g, ' ').trim() : '')

/**
 * Whether this message, on this slate, describes the smart component to build. `board` is the slate (its
 * `library` field and whether it holds a board yet, `creative`).
 */
export function builderDescription(board, message) {
  if (board?.library?.mode !== 'build' || board.creative) return false
  const text = words(message)
  if (!text || text.length > 1200 || /[→\n]|->/.test(String(message))) return false
  // A question is asked of the library ("what can I build?"), not built.
  if (/\?$/.test(text)) return false
  if (nativeRequestKind(text) !== 'draw' || noteRequest(text) || noteRequestProblem(text)) return false
  // Three words, or, in a script written without spaces (Japanese, Chinese, Korean, Thai), six characters:
  // "試験勉強の計画ボード：未着手、学習中、復習、完了" is a description, not a word or two.
  return text.split(' ').length >= 3 || (UNSPACED.test(text) && [...text.replace(/\s/g, '')].length >= 6)
}

const UNSPACED = /[\u0E00-\u0E7F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/

/**
 * What the drafting agent is given: the person's words as the brief, framed as a component whose cards are the
 * pieces people move and whose lanes are where they go, with the board's limits as its rules. At most 1,200
 * characters (workshops.draft's limit), the framing first so long words are cut, not the framing.
 */
export function builderBrief(message) {
  const frame = 'Build a reusable smart component people drag to use. Its cards are the pieces people move; its lanes are where the pieces go, in order. Use lane capacity and allowedLaneIds for the rules that matter (how many fit, what may go where). The component: '
  return frame + words(message).slice(0, 1200 - frame.length)
}

const PIECE_NOUNS = ['piece', 'tile', 'block', 'brick', 'part', 'module', 'component', 'shape', 'card', 'token', 'step', 'item']

/** The word the description uses for its pieces ("pieces" → Piece), or Piece. */
export function pieceNoun(message) {
  const text = words(message).toLowerCase()
  for (const noun of PIECE_NOUNS) if (new RegExp(`\\b${noun}s?\\b`).test(text)) return noun[0].toUpperCase() + noun.slice(1)
  return 'Piece'
}

/** A board title from the description: its first 80 characters, cut at a word, capitalized. */
export function builderTitle(message) {
  let text = words(message).replace(/[.!]+$/, '')
  if (text.length > 80) text = text.slice(0, 80).replace(/\s+\S*$/, '')
  return text ? text[0].toUpperCase() + text.slice(1) : 'Untitled smart component'
}

/**
 * The starter board for a description, when no agent drafts it: a kit of four pieces, a place to compose them
 * (holding up to four) and a place for what is ready, with two rules: the compose lane's limit, and pieces move one
 * lane at a time. Named after the words; the chat renames, adds and reshapes from here. `now` stamps the rules.
 */
export function componentStarter(message, { now = new Date(), by = 'Slatebox' } = {}) {
  const noun = pieceNoun(message)
  const printable = /\bprint/i.test(words(message))
  const set = { by, at: new Date(now).toISOString(), via: 'preset' }
  return {
    version: 1,
    title: builderTitle(message),
    lanes: [
      { id: 'kit', label: 'Kit' },
      { id: 'compose', label: 'Compose' },
      { id: 'ready', label: printable ? 'Ready to print' : 'Ready' },
    ],
    cards: ['A', 'B', 'C', 'D'].map((letter) => ({ id: noun.toLowerCase() + '-' + letter.toLowerCase(), label: noun + ' ' + letter, laneId: 'kit' })),
    behaviour: {
      version: 1,
      rev: 1,
      rules: [
        { id: 'compose-holds', kind: 'capacity', where: 'compose', max: 4, on: true, severity: 'refuse', set },
        { id: 'one-step', kind: 'path', from: 'any', noSkip: true, on: true, severity: 'refuse', set },
      ],
    },
  }
}

/**
 * The board a description makes: the agent's draft when it holds together as a board of plain lanes (validateWorkshop,
 * the one gate), else the starter. `drafted` says which, so the preview never claims a draft it threw away.
 */
export function builderBoard(draft, message, options = {}) {
  if (draft) {
    try {
      const workshop = validateWorkshop(draft)
      if (!workshop.kind && !workshop.experience && !workshop.lanes.some((lane) => lane.station)) return { workshop, drafted: true }
    } catch { /* the starter below */ }
  }
  return { workshop: validateWorkshop(componentStarter(message, options)), drafted: false }
}

/** What the preview says of a board made from a description: drafted by the agent, or started here. */
export function builderSaid(workshop, { drafted }) {
  const lanes = workshop.lanes.map((lane) => lane.label)
  const list = lanes.length > 1 ? lanes.slice(0, -1).join(', ') + ' and ' + lanes.at(-1) : lanes[0]
  const pieces = workshop.cards.length
  return drafted
    ? `Drafted “${workshop.title}” from your description: ${list}, with ${pieces} ${pieces === 1 ? 'piece' : 'pieces'} to drag. Change anything by saying it, or drag the controls on the board.`
    : `Started “${workshop.title}” from your description: ${list}, with ${pieces} pieces to drag. Rename the lanes and pieces, or change the rules, by saying it.`
}
