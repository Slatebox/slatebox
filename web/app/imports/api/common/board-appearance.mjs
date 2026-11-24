// How a board looks, said in a sentence ("make the columns more pronounced", "bigger headers", "color Do now green",
// "softer background", "show grid lines", "compact cards"), read here with no AI call, on every kind of board. A sentence
// becomes the engine's one set_appearance edit (slateboxjs/workshops/appearance), so chat, exec, the AI turn and the
// board's own chips change the same data on the board, as one step. A sentence that could mean more than one look
// ("make it pop") is answered with two or three looks to choose from, never refused.
import { applyWorkshopEdits, appearancePalette, appearanceQuadrants } from 'slateboxjs/workshops/model'
import { plainRequest } from './plain-words.mjs'

const colorNames = [...Object.keys(appearancePalette), 'grey']
const colorWord = '(' + colorNames.join('|') + '|its own colou?r|the default colou?r|default|normal|no colou?r)'
const colorOf = word => word === 'grey' ? 'gray' : appearancePalette[word] ? word : 'none'

// What the columns are called on one board or another, and what the words for "more" and "less" are.
const COLS = '(?:columns?|lanes?|lists?|stages?|quadrants?|squares?|boxes|sections?|areas?|board|grid|matrix|2 ?x ?2|cells?|teams?|steps?)'
const MORE = '(?:more pronounced|more prominent|more visible|more defined|more distinct|clearer|sharper|stand out(?: more)?|pop(?: more)?|stronger|bolder|bold|darker|thicker|heavier|crisper|more contrast(?:y)?|higher contrast|more obvious|easier to see)'
const LESS = '(?:less pronounced|less prominent|subtler|more subtle|lighter|thinner|fainter|quieter|calmer|less busy|less loud|toned down)'
const THE = '(?:(?:the|its|their|all the|all|my|our|these|those)\\s+)?'
const BORDER = '(?:(?:column |lane |quadrant |cell )?(?:borders?|outlines?|edges?|frames?|strokes?))'
const HEAD = '(?:(?:column |lane |quadrant )?(?:headers?|headings?|titles?|names|labels|header row))'
const BACK = '(?:background|backgrounds|colou?rs|fills?|column colou?rs|lane colou?rs|shading)'
const CARDS = '(?:cards?|notes?|items?|tasks?|stickies|sticky notes)'
const LINES = '(?:(?:the\\s+)?(?:grid|quadrant|divider|dividing|separator|axis|axes|guide)\\s*lines?|(?:the\\s+)?grid|(?:the\\s+)?dividers?|lines between (?:the )?' + COLS + ')'

/** Three looks for a sentence that could mean any of them: each a whole sentence the chat reads as it is. */
export const emphasisChoices = Object.freeze([
  { label: 'Stronger borders', say: 'Make the column borders stronger' },
  { label: 'Bolder headers', say: 'Make the headers bolder' },
  { label: 'Both', say: 'Make the columns more pronounced' },
])

function choices(reply = 'Which should stand out more?') {
  const error = Error(reply)
  error.code = 'appearance-choices'
  error.choices = emphasisChoices
  return error
}

// The words that name the board itself ("in Impact × effort", "on this board"): about the board, so they go.
function aboutBoard(board, text) {
  const title = String(board.title ?? '').toLowerCase().replace(/×/g, 'x').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let out = text.toLowerCase().replace(/×/g, 'x').replace(/[.!]+$/, '').trim()
  if (title) out = out.replace(new RegExp('\\s*\\b(?:in|on|of|for)\\s+(?:the\\s+)?' + title + '(?:\\s+(?:board|component|matrix))?\\b', 'g'), '')
  return out.replace(/\s+(?:in|on|of|for|across)\s+(?:the|this|my|our)\s+(?:board|component|slate|matrix|2 ?x ?2)\b/g, '').replace(/\s+(?:a bit|a little|a lot|much|way|even)\b/g, '').trim()
}

// The column (or a 2 by 2's quadrant) a name picks: by its whole name, case aside, or the one selected ("this column").
function partNamed(board, name, selection) {
  const words = name.trim().replace(/^(?:the|this|that)\s+/, '').replace(/\s+(?:column|lane|list|stage|quadrant|square|box|area|step|team)$/, '').trim()
  if (!words) return null
  if (/^(?:column|lane|list|stage|quadrant|square|one)$/.test(words) || /^(?:this|it|that)$/.test(name.trim())) {
    return selection?.kind === 'lane' ? { ref: { id: selection.id } } : null
  }
  const matrix = board.kind === 'nest' && board.nest?.layout === 'matrix'
  const quadrant = matrix && Object.entries(appearanceQuadrants).find(([key, label]) => label.toLowerCase() === words || key.slice(2) === words)
  if (quadrant) return { ref: { id: quadrant[0] } }
  const lane = board.lanes.find(item => item.label.toLowerCase().replace(/×/g, 'x') === words)
  if (!lane) return null
  // A name a card has too is a card's, unless the sentence says column.
  if (board.cards.some(card => card.label.toLowerCase() === words) && words === name.trim().replace(/^(?:the|this|that)\s+/, '')) return null
  return { ref: { id: lane.id } }
}

/**
 * The set_appearance edits a sentence asks for: an array of edits, null when it is not about how the board looks, or
 * a thrown error with code 'appearance-choices' (and `choices`) when it could mean more than one look.
 */
export function appearanceEdits(board, message, selection = null) {
  const said = aboutBoard(board, plainRequest(String(message ?? '')).replace(/\?$/, ''))
  // "the columns in the sprint board more pronounced": the board named after its parts is this one (the chat picked it).
  const text = said.replace(new RegExp('\\b(' + COLS + '|' + HEAD + '|' + BORDER + ')\\s+(?:in|on|of)\\s+(?:the\\s+)?[^,]+?\\s+(?=' + MORE + '|' + LESS + ')', 'i'), '$1 ')
  const is = pattern => new RegExp('^' + pattern + '$', 'i').exec(text)
  const edit = fields => [{ kind: 'set_appearance', ...fields }]
  const make = '(?:make|turn|set|give|have|let|i want|we want|could|want)?\\s*'
  let m
  // A column's color: "color Do now green", "make the Doing column blue", "change the color of Later to red", "Do now should be green".
  if ((m = is('(?:colou?r|paint|shade|tint)\\s+' + THE + '(.+?)\\s+(?:in\\s+|to\\s+|with\\s+)?' + colorWord)) ||
      (m = is('(?:make|turn|set)\\s+' + THE + '(.+?)\\s+(?:to\\s+|into\\s+)?' + colorWord)) ||
      (m = is('(?:change|set)\\s+(?:the\\s+)?colou?r\\s+(?:of\\s+)?' + THE + '(.+?)\\s+to\\s+' + colorWord)) ||
      (m = is(THE + '(.+?)\\s+(?:should be|in|as)\\s+' + colorWord)) ||
      (m = is('(?:give|use)\\s+' + THE + '(.+?)\\s+(?:a|the)?\\s*' + colorWord + '(?:\\s+colou?r)?'))) {
    const part = partNamed(board, m[1], selection)
    if (part) return edit({ lane: part.ref, color: colorOf(m[2]) })
    if (/^(?:the\s+)?(?:columns?|lanes?|quadrants?|board|background)$/.test(m[1])) return null
  }
  // Grid lines.
  if (is('(?:show|add|draw|turn on|put|use|i want|give (?:it|me|us))\\s+' + LINES + '(?:\\s+on)?') || is(LINES + '\\s+on') || is('(?:with\\s+)?' + LINES + '(?:,?\\s+please)?')) return edit({ lines: true })
  if (is('(?:hide|remove|take away|turn off|drop|no|get rid of)\\s+' + LINES) || is(LINES + '\\s+off')) return edit({ lines: false })
  // Header size and weight.
  if (is(make + THE + HEAD + '\\s+(?:bigger|larger|huger|taller|more readable|easier to read)') || is('(?:bigger|larger)\\s+' + HEAD) || is('(?:increase|enlarge|grow)\\s+' + THE + HEAD + '(?:\\s+size)?')) return edit({ headerSize: 'large' })
  if (is(make + THE + HEAD + '\\s+(?:smaller|normal size|regular size)') || is('(?:smaller|normal-size|normal size)\\s+' + HEAD)) return edit({ headerSize: 'normal' })
  if (is(make + THE + HEAD + '\\s+' + MORE) || is(MORE + '\\s+' + HEAD) || is('(?:bold|embolden)\\s+' + THE + HEAD)) return edit({ headers: 'strong' })
  if (is(make + THE + HEAD + '\\s+' + LESS) || is(LESS + '\\s+' + HEAD)) return edit({ headers: 'subtle' })
  // Borders.
  if (is(make + THE + BORDER + '\\s+' + MORE) || is(MORE + '\\s+' + BORDER) || is(make + THE + COLS + "(?:'s|’s)?\\s+" + BORDER + '\\s+' + MORE)) return edit({ borders: 'strong' })
  if (is(make + THE + BORDER + '\\s+' + LESS) || is(LESS + '\\s+' + BORDER) || is(make + THE + COLS + "(?:'s|’s)?\\s+" + BORDER + '\\s+' + LESS)) return edit({ borders: 'subtle' })
  // Fills: "softer background", "darker column colors".
  if (is(make + THE + BACK + '\\s+(?:softer|paler|lighter|calmer|more muted|muted|less saturated|gentler|subtler|more subtle)') ||
      is('(?:softer|paler|lighter|calmer|muted|gentler|subtler)\\s+' + BACK) || is('(?:soften|mute|lighten)\\s+' + THE + BACK)) return edit({ fill: 'soft' })
  if (is(make + THE + BACK + '\\s+(?:darker|stronger|deeper|richer|bolder|more saturated|more colou?rful|more vivid|brighter)') ||
      is('(?:darker|stronger|deeper|richer|bolder|more vivid)\\s+' + BACK) || is('(?:more colou?rful|more colou?r)(?:\\s+columns?)?')) return edit({ fill: 'strong' })
  // Card density.
  if (is(make + THE + CARDS + '\\s+(?:more\\s+)?(?:compact|smaller|tighter|denser|shorter)') || is('(?:compact|smaller|tighter|denser|shorter)\\s+' + CARDS) || is('(?:more\\s+)?compact(?:\\s+(?:layout|view|board|mode))?')) return edit({ density: 'compact' })
  if (is(make + THE + CARDS + '\\s+(?:roomier|roomy|bigger|larger|taller|normal size|regular size)') || is('(?:roomy|roomier|bigger|larger|normal-size)\\s+' + CARDS)) return edit({ density: 'normal' })
  // The columns as a whole: "make the columns more pronounced", "bolder columns", "stronger lane borders" (above).
  if (is(make + THE + COLS + '\\s+' + MORE) || is(MORE + '\\s+' + COLS) || is('(?:emphasi[sz]e|highlight|accentuate|strengthen)\\s+' + THE + COLS)) return edit({ emphasis: 'strong' })
  if (is(make + THE + COLS + '\\s+' + LESS) || is(LESS + '\\s+' + COLS) || is('(?:tone down|soften|quiet down)\\s+' + THE + COLS)) return edit({ emphasis: 'subtle' })
  // The look back to the board's own.
  if (is('(?:reset|restore|undo|clear)\\s+' + THE + '(?:look|appearance|style|styling|formatting|colou?rs)(?:\\s+to\\s+(?:the\\s+)?default)?') || is('(?:use\\s+)?(?:the\\s+)?(?:default|standard|normal|original)\\s+(?:look|appearance|style|styling)')) {
    return edit({ emphasis: 'normal', headerSize: 'normal', lines: false, density: 'normal' })
  }
  // Said of the board as a whole, a look with no part named: which part is meant is asked, with the looks to choose from.
  if (is(make + '(?:it|this|everything|things|the board|this board|the whole board|the design|the look)?\\s*' + MORE) || is('(?:emphasi[sz]e|highlight)(?:\\s+(?:it|this|things))?') ||
      is('(?:more|stronger|bolder)\\s+(?:emphasis|contrast|definition|structure)') || is(make + '(?:it|this|the board)\\s+(?:look\\s+)?(?:more\\s+)?(?:structured|defined|organi[sz]ed-looking)')) throw choices()
  return null
}

/** The board a sentence about its look makes, with what to tell the person: `{ workshop, reply }`, or null when it is not one. */
export function proposeAppearance(board, message, selection = null) {
  const edits = appearanceEdits(board, message, selection)
  if (!edits) return null
  const made = applyWorkshopEdits(board, edits, {})
  if ('refused' in made) throw Error(made.refused.reason)
  return { workshop: made.workshop, reply: made.report.edits.map(item => item.said).join(' ') }
}
