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

// What the columns are called on one board or another, and what the words for "more" and "less" are. The board's own
// structure (STRUCT) can be highlighted; a map's steps or a board's teams only take a look word, never "highlight".
const STRUCT = '(?:columns?|lanes?|lists?|stages?|quadrants?|squares?|boxes|sections?|areas?|grid|matrix|2 ?x ?2|cells?)'
const COLS = '(?:' + STRUCT + '|teams?|steps?)'
// Only words about how a thing looks: "clearer", "more obvious" and "easier to see" are as often about the wording
// ("make the labels clearer"), so they are the agent's to read, not a look.
const MORE = '(?:more pronounced|more prominent|more visible|more defined|more distinct|sharper|stand out(?: more)?|pop(?: more)?|stronger|bolder|bold|darker|thicker|heavier|crisper|more contrast(?:y)?|higher contrast)'
// Said of the whole board, only the words of emphasis: "make the board darker" is a dark theme, not a look we have.
const EMPHASIS = '(?:more pronounced|more prominent|more visible|more defined|more distinct|sharper|stand out(?: more)?|pop(?: more)?|stronger|bolder|crisper|more contrast(?:y)?|higher contrast)'
const LESS = '(?:less pronounced|less prominent|subtler|more subtle|lighter|thinner|fainter|quieter|calmer|less busy|less loud|toned down)'
const THE = '(?:(?:the|its|their|all the|all|my|our|these|those)\\s+)?'
const BORDER = '(?:(?:column |lane |quadrant |cell )?(?:borders?|outlines?|edges?|frames?|strokes?))'
const HEAD = '(?:(?:column |lane |quadrant )?(?:headers?|headings?|titles?|names|labels|header row))'
const BACK = '(?:background|backgrounds|colou?rs|fills?|column colou?rs|lane colou?rs|shading)'
const CARDS = '(?:cards?|notes?|items?|tasks?|stickies|sticky notes)'
// Shorter or smaller notes and tasks are as often shorter words: only cards are made smaller by a look.
const CARD = '(?:cards?)'
const LINES = '(?:(?:the\\s+)?(?:grid|quadrant|divider|dividing|separator|axis|axes|guide)\\s*lines?|(?:the\\s+)?grid|(?:the\\s+)?dividers?|(?:the\\s+)?lines|lines between (?:the )?' + COLS + ')'

/** Three looks for a sentence that could mean any of them: each a whole sentence the chat reads as it is. */
export const emphasisChoices = Object.freeze([
  { label: 'Stronger borders', say: 'Make the column borders stronger' },
  { label: 'Bolder headers', say: 'Make the headers bolder' },
  { label: 'Both', say: 'Make the columns more pronounced' },
])

function choices(reply = 'Which should stand out more?', options = emphasisChoices) {
  const error = Error(reply)
  error.code = 'appearance-choices'
  error.choices = options
  return error
}

const plainName = text => String(text ?? '').toLowerCase().replace(/×/g, 'x').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
const matrixOf = board => board.kind === 'nest' && board.nest?.layout === 'matrix'

// Whether a name said after the board's parts ("the columns in Impact × effort") is the board itself: its title, the
// part of its title before a colon, a 2 by 2's two axes ("impact x effort") or its square, or a name said as a board.
function namesBoard(board, name) {
  const said = plainName(name)
  if (/\b(?:board|component)$/.test(said)) return true
  const title = String(board.title ?? '')
  const names = new Set([plainName(title), plainName(title.split(':')[0])])
  if (matrixOf(board)) {
    const [x, y] = (board.nest.axes ?? []).map(id => board.nest.fields?.find(field => field.id === id)?.label).map(plainName)
    if (x && y) { names.add(y + ' x ' + x); names.add(x + ' x ' + y); names.add(y + ' ' + x); names.add(x + ' ' + y) }
    names.add(plainName(board.lanes[0]?.label))
  }
  names.delete('')
  return names.has(said.replace(/\s+(?:matrix|2 ?x ?2)$/, '')) || names.has(said)
}

// The keys every column (or a 2 by 2's quadrant) is colored by.
const everyPart = board => matrixOf(board) ? Object.keys(appearanceQuadrants) : board.lanes.map(lane => lane.id)
const partLabel = (board, id) => board.lanes.find(lane => lane.id === id)?.label ?? appearanceQuadrants[id] ?? id
const colorEach = (board, keys, color) => keys.map(id => ({ kind: 'set_appearance', lane: { id }, color }))

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
  // A column named there ("the headers of Doing bolder") is not the board: a look is the whole board's, so it asks.
  let text = said
  const after = new RegExp('\\b(' + COLS + '|' + HEAD + '|' + BORDER + ')\\s+(?:in|on|of|for)\\s+(?:the\\s+)?([^,]+?)\\s+(?=(?:' + MORE + '|' + LESS + '|clearer)$)', 'i').exec(said)
  if (after) {
    const whole = said.slice(0, after.index) + after[1] + ' ' + said.slice(after.index + after[0].length)
    if (namesBoard(board, after[2])) text = whole
    else {
      const part = partNamed(board, after[2], selection)
      if (!part) return null
      const label = partLabel(board, part.ref.id)
      throw choices('Borders and headers change for the whole board; ' + label + ' can have its own color.', [
        { label: 'The whole board', say: whole.replace(/^./, c => c.toUpperCase()) }, { label: 'Color ' + label, say: 'Color ' + label + ' yellow' }])
    }
  }
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
    // Every column at once: "make the columns blue".
    const name = colorOf(m[2])
    if (name !== 'none' && new RegExp('^(?:(?:all|every|each)\\s+)?(?:the\\s+|of the\\s+)?(?:' + STRUCT + '|board|background)$').test(m[1])) return colorEach(board, everyPart(board), name)
    // A header's color is its column's: offered, with bolder headers.
    if (name !== 'none' && new RegExp('^' + HEAD + '$').test(m[1])) {
      throw choices('A column’s header takes the column’s color.', [{ label: 'Color every column ' + name, say: 'Color the columns ' + name }, { label: 'Bolder headers', say: 'Make the headers bolder' }])
    }
  }
  // One column made to stand out ("highlight Doing", "make Do now stand out"): it takes a color of its own.
  if ((m = is('(?:highlight|emphasi[sz]e|accentuate|spotlight)\\s+' + THE + '(.+?)')) || (m = is(make + THE + '(.+?)\\s+(?:stand out|pop)(?: more)?'))) {
    const part = partNamed(board, m[1], selection)
    if (part) {
      const now = board.appearance?.colors?.[part.ref.id]
      return edit({ lane: part.ref, color: now === 'yellow' ? 'orange' : 'yellow' })
    }
  }
  // Grid lines.
  if (is('(?:show|add|draw|turn on|put|use|i want|give (?:it|me|us))\\s+' + LINES + '(?:\\s+on)?') || is(LINES + '\\s+on') || is('(?:with\\s+)?' + LINES + '(?:,?\\s+please)?')) return edit({ lines: true })
  if (is('(?:hide|remove|take away|turn off|drop|no|get rid of)\\s+' + LINES) || is(LINES + '\\s+off')) return edit({ lines: false })
  if (is(make + THE + LINES + '\\s+(?:thicker|bolder|darker|heavier|stronger|more visible|more pronounced)') || is('(?:thicker|bolder|darker|heavier|stronger)\\s+' + LINES)) return edit({ lines: true, borders: 'strong' })
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
  if (is(make + THE + CARDS + '\\s+(?:more\\s+)?(?:compact|tighter|denser)') || is('(?:compact|tighter|denser)\\s+' + CARDS) ||
      is(make + THE + CARD + '\\s+(?:smaller|shorter)') || is('(?:smaller|shorter)\\s+' + CARD) || is('(?:more\\s+)?compact(?:\\s+(?:layout|view|board|mode))?')) return edit({ density: 'compact' })
  if (is(make + THE + CARD + '\\s+(?:roomier|roomy|bigger|larger|taller|normal size|regular size)') || is('(?:roomy|roomier|bigger|larger|normal-size)\\s+' + CARD)) return edit({ density: 'normal' })
  // The columns as a whole: "make the columns more pronounced", "bolder columns", "stronger lane borders" (above).
  if (is(make + THE + COLS + '\\s+' + MORE) || is(MORE + '\\s+' + COLS) || is('(?:emphasi[sz]e|highlight|accentuate|strengthen)\\s+' + THE + STRUCT)) return edit({ emphasis: 'strong' })
  if (is(make + THE + COLS + '\\s+' + LESS) || is(LESS + '\\s+' + COLS) || is('(?:tone down|soften|quiet down)\\s+' + THE + STRUCT)) return edit({ emphasis: 'subtle' })
  // The columns' colors taken away: every column (or quadrant) back to its own.
  const colored = Object.keys(board.appearance?.colors ?? {})
  if (is('(?:reset|restore|undo|clear|remove|drop|take away|take off|get rid of)\\s+' + THE + '(?:column |lane |quadrant )?colou?rs(?:\\s+to\\s+(?:the\\s+)?default)?') ||
      is('(?:no|default|standard|original)\\s+(?:column |lane |quadrant )?colou?rs')) return colorEach(board, colored, 'none')
  // The look back to the board's own, colors and all.
  if (is('(?:reset|restore|undo|clear)\\s+' + THE + '(?:look|appearance|style|styling|formatting)(?:\\s+to\\s+(?:the\\s+)?default)?') || is('(?:use\\s+)?(?:the\\s+)?(?:default|standard|normal|original)\\s+(?:look|appearance|style|styling)')) {
    return [...edit({ emphasis: 'normal', headerSize: 'normal', lines: false, density: 'normal' }), ...colorEach(board, colored, 'none')]
  }
  // Said of the board as a whole, a look with no part named: which part is meant is asked, with the looks to choose from.
  // The board must be said ("make it pop", "make this more pronounced"): a bare "bold" or "clearer" is not a look.
  if (is(make + '(?:it|this|everything|things|the board|this board|the whole board|the design|the look)\\s*' + EMPHASIS) || is('(?:emphasi[sz]e|highlight)\\s+(?:it|this|things)') ||
      is('(?:more|stronger|bolder)\\s+(?:emphasis|contrast|definition|structure)') || is(make + '(?:it|this|the board)\\s+(?:look\\s+)?(?:more\\s+)?(?:structured|defined|organi[sz]ed-looking)')) throw choices()
  return null
}

/** The board a sentence about its look makes, with what to tell the person: `{ workshop, reply }`, or null when it is not one. */
export function proposeAppearance(board, message, selection = null) {
  const edits = appearanceEdits(board, message, selection)
  if (!edits) return null
  // Nothing to take away ("clear the colors" with none): said, with no board to keep.
  if (!edits.length) return { reply: 'The columns already have their own colors.' }
  const made = applyWorkshopEdits(board, edits, {})
  if ('refused' in made) throw Error(made.refused.reason)
  const said = made.report.edits.map(item => item.said)
  // A look the board already has is said, not shown as a change that changes nothing.
  if (JSON.stringify(made.workshop.appearance ?? {}) === JSON.stringify(board.appearance ?? {})) {
    return { reply: said.join(' ') + (edits.some(item => item.density === 'normal') ? ' Cards are roomy or compact; there is no larger size.' : '') }
  }
  // Several color edits said once: "The board now has To do in blue, Doing in blue…" reads as one sentence.
  return { workshop: made.workshop, reply: said.length > 1 && edits.every(item => item.color) ? oneSentence(said) : said.join(' ') }
}

function oneSentence(said) {
  const parts = said.map(text => text.replace(/^The board now has /, '').replace(/\.$/, ''))
  return 'The board now has ' + (parts.length < 2 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1)) + '.'
}
