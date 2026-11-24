// Which board a chat message is about, on a slate of many boards (boards S4a, plan §2.4). In order:
// 1. the board in focus (the gear's "Change this board");
// 2. the board of the card or lane selected on the canvas;
// 3. a board the message names ("on the Sprint board, add a column called Blocked");
// 4. the only board on the slate;
// 5. otherwise a message for the slate itself (notes, a drawing, a question) goes to the slate;
// 6. and only a change to a board makes the chat ask: "Which board, Retro or Sprint?", one chip per board.
// Pure: `boards` are the page's boards ({ boardId, focus, selection, model }), first board first.
import { noteRequest, noteRequestProblem } from './note-requests.mjs'
import { asksWhatElse } from './board-focus.mjs'

// "Impact × effort" is said "impact x effort": the sign is the letter.
const words = text => String(text ?? '').toLowerCase().replace(/×/g, ' x ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** What a person may call a board: its title, and the part before a colon ("Retro" of "Retro: Q3 launch"). */
export function boardNames(model) {
  const title = String(model?.title ?? '').trim()
  const names = new Set([words(title), words(title.split(':')[0])].filter(Boolean))
  return [...names].sort((a, b) => b.length - a.length)
}

/**
 * A board the message names, and the message without the naming: "On the Sprint board, add a column
 * called Blocked" → Sprint and "add a column called Blocked". At the start ("on Sprint:", "in the Retro
 * board,") or at the end ("… on the Sprint board"). Null when no board, or more than one, is named so.
 */
export function boardInMessage(boards, message) {
  const text = String(message ?? '').trim()
  const found = []
  for (const board of boards) {
    for (const name of boardNames(board.model)) {
      const said = name.split(' ').map(escape).join('[^a-z0-9]+')
      const start = new RegExp('^(?:on|in|to|for)\\s+(?:the\\s+)?' + said + '(?:\\s+board)?\\s*[,:\\-–—]\\s*', 'i')
      const end = new RegExp('\\s+(?:on|in|to|for)\\s+(?:the\\s+)?' + said + '(?:\\s+board)?\\s*[.!]?$', 'i')
      // Or after the board's parts it names ("make the columns in Impact × effort more pronounced").
      const middle = new RegExp('(?<=\\b(?:columns?|lanes?|cards?|quadrants?|squares?|headers?|borders?|stages?))\\s+(?:on|in|of)\\s+(?:the\\s+)?' + said + '(?:\\s+board)?(?=\\s)', 'i')
      const hit = start.exec(text) ?? end.exec(text) ?? middle.exec(text)
      if (hit) { found.push({ board, rest: (text.slice(0, hit.index) + ' ' + text.slice(hit.index + hit[0].length)).trim() }); break }
    }
  }
  return found.length === 1 && found[0].rest ? found[0] : null
}

const politely = /^(?:(?:can|could|would|will) you(?: please)?\s+|please\s+|i(?:'|’)?d like (?:you to\s+)?|i want (?:you to\s+)?|let(?:'|’)?s\s+)*/i
// The things a board holds: a message about them (or put into them) is a change to a board.
const boardThings = /\b(?:boards?|lanes?|columns?|cards?|stages?|stations?|tokens?|deals?|tasks?|swimlanes?|wip|limits?|rules?)\b/i
const intoBoardThing = /\s(?:to|into|in|under|on|onto)\s+(?:the\s+|this\s+|that\s+)?[^,]*\b(?:lanes?|columns?|stages?|stations?|cards?|boards?)\b/i
// Notes thought up about something ("add 3 notes about risks", "brainstorm some stickies on hiring").
const notesAbout = /^(?:add|make|create|write|draw|put|give me|brainstorm|suggest|jot down|list)\s+(?:(?:a|an|some|a few|several|a couple(?: of)?|more|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+)*(?:(?:more|new|other|extra|regular|ordinary|plain|sticky)\s+)*(?:sticky notes?|stickies|notes?|post-?its?|ideas?)\s+(?:about|on|around|covering|listing|for)\s+\S/i
// A drawing for the slate: "draw a flowchart of onboarding", steps typed out with arrows.
const drawingWords = /^(?:draw|sketch|diagram|map out|chart)\b/i

/**
 * Whether a message is for the slate itself, not for one of its boards: notes (by number, by name or
 * about something), a drawing, or a question that names nothing a board holds. `kind` is how the slate's
 * conversation reads it (nativeRequestKind): only a plain drawing request ('draw') can be the slate's here;
 * a new board, an interactive route or a library entry is read elsewhere.
 */
export function forTheSlate(message, kind = 'draw') {
  const text = String(message ?? '').trim()
  if (!text || kind !== 'draw' || asksWhatElse(text)) return false
  const bare = text.replace(politely, '')
  if (intoBoardThing.test(bare)) return false
  if (noteRequest(text) || noteRequestProblem(text)) return true
  if (notesAbout.test(bare) || drawingWords.test(bare) || /→|->/.test(text)) return true
  return /\?$/.test(text) && !boardThings.test(text)
}

/**
 * The board a message goes to: `{ board, message }` (the message less any naming of the board), or
 * `{ ask: boards }` when the chat has to ask which, or `{ slate: true, message }` when the message is for
 * the slate itself (forTheSlate; `kind` is nativeRequestKind's reading of it), so asking "Which board?" would
 * change nothing. `chosen`: a board the person picked for this message.
 */
export function pickBoard(boards, message, chosen = null, kind = 'draw') {
  if (chosen) return { board: chosen, message }
  if (boards.length <= 1) return { board: boards[0] ?? null, message }
  const held = boards.find(board => board.preview) ?? boards.find(board => board.focus) ?? boards.find(board => board.selection)
  if (held) return { board: held, message }
  const named = boardInMessage(boards, message)
  if (named) return { board: named.board, message: named.rest }
  if (forTheSlate(message, kind)) return { slate: true, message }
  return { ask: boards }
}

/** The chat's question when it can't tell: "Which board, Retro or Sprint?" */
export function whichBoard(boards) {
  const titles = boards.map(board => String(board.model?.title ?? 'Board'))
  return 'Which board, ' + (titles.length > 1 ? titles.slice(0, -1).join(', ') + ' or ' + titles.at(-1) : titles[0]) + '?'
}
