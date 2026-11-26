// A grid sheet's own sentences (snap-grid spec §6): its page and grid ("make it 3 columns", "A4 landscape", "no gaps"),
// its tiles ("add a word bank: sun, rain, cloud", "put Map on Page 1 at row 2 column 1 spanning 2 by 2", "make the
// picture 2 by 2"), its pages ("duplicate page 1 shuffled", "remove page 2"), its rules ("only one heading per page",
// "every page needs a heading", "pictures can be 2 by 2", "no QR codes") and print ("print page 2", "export a PDF").
// Each is one of the engine's edits, made by the one reducer (board-chat.mjs make); print is an action the page runs.
// Read from the model only, so a page that loads the board chat never downloads the sheet's rules for it.
import { workshopReferences } from 'slateboxjs/workshops/model'

const TYPES = [
  ['heading', /^(?:titles?|headings?|headers?)$/], ['text', /^(?:texts?|text (?:blocks?|boxes?)|paragraphs?|captions?|instructions?)$/],
  ['image', /^(?:pictures?|images?|photos?|illustrations?|drawings?)$/], ['question', /^questions?$/],
  ['answer-lines', /^(?:answer ?lines?|lines|writing lines|answer space)$/], ['word-bank', /^(?:word ?banks?|word lists?)$/],
  ['diagram', /^(?:diagrams?|charts?)$/], ['qr', /^(?:qr ?codes?|qrs?)$/], ['panel', /^(?:panels?|comic panels?)$/],
  ['speech', /^(?:speech ?bubbles?|bubbles?)$/], ['term', /^(?:terms?|squares?)$/], ['sticker', /^stickers?$/],
]
/** The kind of tile these words name ("word banks", "a picture", "QR codes"), or null. */
export function gridTypeOf(phrase) {
  const text = String(phrase ?? '').toLowerCase().replace(/^(?:an?|the|one|any)\s+/, '').replace(/\s+tiles?$/, '').replace(/-/g, ' ').trim()
  return TYPES.find(([, pattern]) => pattern.test(text))?.[0] ?? null
}
const N = '(\\d{1,2}|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)'
const NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 }
const num = (word) => (/^\d+$/.test(word) ? Number(word) : NUMBERS[String(word).toLowerCase()])
const listOf = (text) => text.split(/\s*(?:,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+)\s*/).map((item) => item.trim().replace(/^["“'‘]|["”'’.]$/g, '')).filter(Boolean)
const unquote = (text) => String(text ?? '').trim().replace(/^["“'‘](.+)["”'’]$/, '$1').trim()
const MARGINS = { 'quarter-inch': 0.25, 'quarter inch': 0.25, 'half-inch': 0.5, 'half inch': 0.5, 'three-quarter-inch': 0.75, 'one-inch': 1, 'one inch': 1, 'inch': 1, 'narrow': 0.25, 'wide': 1 }

/** The command formats the agent's lane chat proposes on a grid sheet (lane-chat.mjs swaps these in). */
export const gridEditFormats = [
  'Set page to letter|a4 portrait|landscape',
  'Set grid to R rows C columns',
  'Add TYPE tile LABEL[: body] [on PAGE at row R column C]',
  'Put TILE on PAGE at row R column C [spanning R by C]',
  'Duplicate PAGE [shuffled]',
  'Rule: at most N TYPE per page|sheet / every page needs N TYPE / only TYPE, TYPE / TYPE spans up to R by C',
  'Print PAGE|all pages',
]

const rulesOf = (board, kind) => (board.behaviour?.rules ?? []).filter((rule) => rule.kind === kind)

/**
 * What a grid sheet's conversation makes of a sentence: `{ edits }`, `{ reply }`, `{ reply, action }` (print), or null when
 * the sentence is not one of the sheet's. `selection` is what is selected (a tile, a page).
 */
export function gridChat(board, text, selection = null) {
  if (board?.kind !== 'grid') return null
  const refs = workshopReferences(board, selection)
  const tile = (name) => { const found = /^(?:this|it|this tile|the tile)$/i.test(name.trim()) && selection?.kind === 'card' ? board.cards.find((card) => card.id === selection.id) : refs.cards.attempt(unquote(name)); return found ?? null }
  const page = (name) => {
    const words = unquote(name).replace(/^(?:the\s+)?/i, '')
    if (/^(?:this|the)?\s*page$/i.test(words) && selection?.kind === 'lane') return board.lanes.find((lane) => lane.id === selection.id)
    const n = /^page\s+(\d)$/i.exec(words)
    if (n) return board.lanes.find((lane) => lane.label.toLowerCase() === 'page ' + n[1]) ?? board.lanes[Number(n[1])] ?? null
    const found = refs.lanes.attempt(words)
    return found && found.id !== board.lanes[0].id ? found : null
  }
  const typed = (phrase) => gridTypeOf(phrase)
  const pageOf = (card) => board.lanes.find((lane) => lane.id === card.laneId)
  let m

  // ---- print ----
  if ((m = /^(?:print|export|save)(?:\s+(?:it|this|the sheet))?(?:\s+(?:as\s+)?(?:an?\s+)?(pdf))?(?:\s+(all pages|every page|page \d|this page))?(?:\s+(?:as\s+)?(?:an?\s+)?(pdf))?$/i.exec(text)) ||
    (m = /^(?:export|download|make)\s+(?:an?\s+)?(pdf)(?:\s+of\s+(all pages|every page|page \d|this page))?$/i.exec(text))) {
    const which = m[2] ?? (m[1] && !/pdf/i.test(m[1]) ? m[1] : null)
    const pdf = /pdf/i.test(m[1] ?? '') || /pdf/i.test(m[3] ?? '') || /^(?:export|download|make)/i.test(text) && /pdf/i.test(text)
    const one = which && /^page \d$|^this page$/i.test(which) ? page(which) : null
    if (which && /^page \d$/i.test(which) && !one) return { reply: 'This sheet has no ' + which.toLowerCase() + '.' }
    const pages = one ? [one.id] : board.lanes.slice(1).map((lane) => lane.id)
    const named = one ? one.label : pages.length === 1 ? board.lanes[1].label : 'all ' + pages.length + ' pages'
    return { reply: (pdf ? 'Saving ' : 'Printing ') + named + (pdf ? ' as a PDF.' : '.'), action: { kind: 'print', pages, pdf: Boolean(pdf) } }
  }

  // ---- questions ----
  if (/^how many (?:cells|spaces|spots) (?:are )?(?:free|left|empty)/i.test(text)) {
    const grid = board.grid.cells
    const lines = board.lanes.slice(1).map((lane) => {
      const held = new Set()
      for (const card of board.cards.filter((item) => item.laneId === lane.id && item.cell)) {
        for (let r = 0; r < (card.cell.rows ?? 1); r++) for (let c = 0; c < (card.cell.cols ?? 1); c++) held.add((card.cell.row + r) + ':' + (card.cell.col + c))
      }
      const free = grid.rows * grid.cols - held.size
      return lane.label + ' has ' + free + ' of ' + grid.rows * grid.cols + ' cells free.'
    })
    return { reply: lines.join(' ') }
  }
  if ((m = /^why\s+(?:can(?:'|’|no)?t|won(?:'|’)t)\s+(?:i|we)\s+(?:put|place|drop|move)\s+(.+?)(?:\s+(?:there|on\s+(.+?)))?(?:\s+at\s+row\s+(\d{1,2}),?\s+(?:and\s+)?col(?:umn)?\s+(\d{1,2}))?\??$/i.exec(text))) {
    const card = tile(m[1])
    if (!card) return null
    const lines = []
    if (card.tile?.stamp) lines.push(card.label + ' is a stamp: dropping it on a page makes a copy, and the stamp stays in the tray.')
    lines.push('Tiles snap to free cells; none overlap, and none run past the page’s edge.')
    for (const rule of (board.behaviour?.rules ?? []).filter((item) => item.on)) if (rule.type === card.tile?.type || rule.kind === 'tileTypes') lines.push(ruleWords(rule))
    return { reply: lines.join(' ') }
  }

  // ---- the page and the grid ----
  const paging = /^(?:(?:make|set|change)\s+(?:it|the page|the sheet|this|page)\s+(?:to\s+)?|set page to\s+|use\s+)?(a4|letter|us letter)?\s*(portrait|landscape)?(?:\s+page)?$/i.exec(text)
  if (paging && (paging[1] || paging[2])) {
    return { edits: [{ kind: 'set_page', ...(paging[1] && { size: /a4/i.test(paging[1]) ? 'a4' : 'letter' }), ...(paging[2] && { orientation: paging[2].toLowerCase() }) }] }
  }
  if ((m = /^(?:(?:make|use|set)\s+(?:the\s+)?(?:margins?|it)\s+(?:to\s+)?)?(quarter[- ]inch|half[- ]inch|three-quarter-inch|one[- ]inch|inch|narrow|wide)\s+margins?$/i.exec(text))) {
    return { edits: [{ kind: 'set_page', margin: MARGINS[m[1].toLowerCase()] }] }
  }
  if (/^(?:no|remove the|take away the)\s+(?:gaps?|gutters?|spaces between (?:the )?cells)$/i.test(text)) return { edits: [{ kind: 'set_grid', gutter: 0 }] }
  const gridSays = [
    new RegExp(`^(?:(?:make|set|change)\\s+(?:it|the grid|the page|this)\\s+(?:to\\s+)?|set grid to\\s+)?${N}\\s+rows?(?:,?\\s+(?:(?:and|by|x)\\s+)?${N}\\s+col(?:umn)?s?)?$`, 'i'),
    new RegExp(`^(?:(?:make|set|change)\\s+(?:it|the grid|the page|this)\\s+(?:to\\s+)?|set grid to\\s+)?${N}\\s+col(?:umn)?s?(?:,?\\s+(?:(?:and|by|x)\\s+)?${N}\\s+rows?)?$`, 'i'),
    new RegExp(`^(?:(?:make|set|change)\\s+(?:it|the grid|the page|this)\\s+(?:to\\s+)?(?:a\\s+)?|set grid to\\s+)?(\\d{1,2})\\s*(?:by|x|×)\\s*(\\d{1,2})(?:\\s+grid)?$`, 'i'),
  ]
  if ((m = gridSays[0].exec(text))) return { edits: [{ kind: 'set_grid', rows: num(m[1]), ...(m[2] && { cols: num(m[2]) }) }] }
  if ((m = gridSays[1].exec(text))) return { edits: [{ kind: 'set_grid', cols: num(m[1]), ...(m[2] && { rows: num(m[2]) }) }] }
  // "3 by 4": rows by columns, as the page's caption says its grid.
  if ((m = gridSays[2].exec(text))) return { edits: [{ kind: 'set_grid', rows: Number(m[1]), cols: Number(m[2]) }] }

  // ---- pages ----
  if (/^(?:add|new)\s+(?:a\s+|another\s+)?(?:blank\s+|empty\s+)?page$/i.test(text)) return { edits: [{ kind: 'add_page' }] }
  if ((m = /^(?:duplicate|copy)\s+(this page|page \d|the page)(?:,?\s+(shuffled|and shuffle it|with the terms shuffled))?$/i.exec(text))) {
    const source = page(m[1]) ?? (selection?.kind === 'card' ? pageOf(board.cards.find((card) => card.id === selection.id) ?? {}) : null) ?? board.lanes[1]
    return { edits: [{ kind: 'add_page', copyOf: { id: source.id }, ...(m[2] && { shuffle: true }) }] }
  }
  if ((m = /^(?:remove|delete|drop)\s+(page \d|this page)$/i.exec(text))) {
    const gone = page(m[1])
    if (!gone) return { reply: 'This sheet has no ' + m[1].toLowerCase() + '.' }
    return { edits: [{ kind: 'remove_lane', lane: { id: gone.id } }] }
  }

  // ---- rules ----
  if ((m = new RegExp(`^(?:rule:\\s*)?(?:only|at most|no more than|max(?:imum)?(?:\\s+of)?)\\s+${N}\\s+(.+?)\\s+(?:per|a|on each|on every|in each)\\s+(page|sheet)$|^(?:rule:\\s*)?(?:a|each|every)\\s+(page|sheet)\\s+holds\\s+(?:at most|up to|only)\\s+${N}\\s+(.+)$`, 'i').exec(text))) {
    const max = num(m[1] ?? m[5]), type = typed(m[2] ?? m[6]), per = (m[3] ?? m[4]).toLowerCase()
    if (!type) return null
    const rule = rulesOf(board, 'tileMax').find((item) => item.type === type && item.per === per)
    return { edits: [rule ? { kind: 'set_rule', rule: rule.id, max, on: true } : { kind: 'add_rule', rule: { kind: 'tileMax', type, max, per } }] }
  }
  if ((m = new RegExp(`^(?:rule:\\s*)?(?:every|each)\\s+page\\s+(?:needs|has|must have)\\s+(?:at least\\s+)?${N}\\s+(.+)$`, 'i').exec(text))) {
    const atLeast = num(m[1]), type = typed(m[2])
    if (!type) return null
    const rule = rulesOf(board, 'tileNeeds').find((item) => item.type === type)
    return { edits: [rule ? { kind: 'set_rule', rule: rule.id, atLeast, on: true } : { kind: 'add_rule', rule: { kind: 'tileNeeds', type, atLeast, per: 'page' } }] }
  }
  if ((m = /^(?:rule:\s*)?(.+?)\s+(?:can be|can span|span|spans|may span|may be)\s+(?:up to\s+)?(\d{1,2})\s*(?:by|x|×)\s*(\d{1,2})(?:\s+cells)?$/i.exec(text)) && typed(m[1])) {
    const type = typed(m[1]), rows = Number(m[2]), cols = Number(m[3])
    const rule = rulesOf(board, 'tileSpan').find((item) => item.type === type)
    return { edits: [rule ? { kind: 'set_rule', rule: rule.id, rows, cols, on: true } : { kind: 'add_rule', rule: { kind: 'tileSpan', type, rows, cols } }] }
  }
  const usedTypes = () => [...new Set(board.cards.map((card) => card.tile?.type).filter(Boolean))]
  const typesRule = rulesOf(board, 'tileTypes')[0]
  if ((m = /^(?:rule:\s*)?(?:only|use only|just)\s+(.+?)(?:\s+tiles)?$/i.exec(text))) {
    const types = listOf(m[1]).map(typed)
    if (types.length && types.every(Boolean)) return { edits: [typesRule ? { kind: 'set_rule', rule: typesRule.id, types, on: true } : { kind: 'add_rule', rule: { kind: 'tileTypes', types } }] }
  }
  if ((m = /^(?:no|without)\s+(.+?)(?:\s+tiles)?$/i.exec(text)) && listOf(m[1]).every(typed)) {
    const gone = listOf(m[1]).map(typed)
    const types = (typesRule ? typesRule.types : usedTypes()).filter((type) => !gone.includes(type))
    if (!types.length) return { reply: 'A sheet needs at least one kind of tile.' }
    return { edits: [typesRule ? { kind: 'set_rule', rule: typesRule.id, types, on: true } : { kind: 'add_rule', rule: { kind: 'tileTypes', types } }] }
  }

  // ---- tiles ----
  if ((m = /^add\s+(?:a\s+|an\s+)?(?:qr ?code|qr)(?:\s+(?:called|named)\s+(.+?))?\s+(?:to|for|linking to|that links to)\s+(https?:\/\/\S+)$/i.exec(text))) {
    return { edits: [{ kind: 'add_tile', type: 'qr', label: unquote(m[1] ?? 'Scan me'), link: m[2] }] }
  }
  if ((m = /^add\s+(?:a\s+|another\s+)?word ?bank(?:\s+(?:called|named)\s+([^:]+?))?(?:\s*(?::|with|of)\s*(.+))?$/i.exec(text))) {
    const words = m[2] ? listOf(m[2]) : []
    if (!words.length) return { reply: 'Which words go in the bank? Say them, such as “Add a word bank: sun, rain, cloud”.' }
    if (words.length < 3 || words.length > 24) return { reply: 'A word bank holds 3 to 24 words.' }
    return { edits: [{ kind: 'add_tile', type: 'word-bank', label: unquote(m[1] ?? 'Word bank'), words }] }
  }
  if ((m = /^add\s+(?:a\s+|an\s+|another\s+)?(.+?)(?:\s+tile)?(?:\s+(?:called|named|saying|that says))?\s+(["“].+?["”]|[^:]+?)(?:\s*:\s*(.+?))?(?:\s+on\s+(page \d|this page))?(?:\s+at\s+row\s+(\d{1,2}),?\s+(?:and\s+)?col(?:umn)?\s+(\d{1,2}))?$/i.exec(text)) && typed(m[1])) {
    const type = typed(m[1])
    if (type === 'qr') return { reply: 'A QR code needs its web address: say “Add a QR code to https://…”.' }
    const where = m[4] ? page(m[4]) : null
    if (m[4] && !where) return { reply: 'This sheet has no ' + m[4].toLowerCase() + '.' }
    return { edits: [{ kind: 'add_tile', type, label: unquote(m[2]), ...(m[3] && { body: m[3] }), ...(where && { page: { id: where.id } }), ...(m[5] && { row: Number(m[5]), col: Number(m[6]) }),
      ...((type === 'image' || type === 'diagram') && { alt: unquote(m[2]) }) }] }
  }
  if ((m = /^add\s+(?:a\s+|an\s+|another\s+)?(.+?)(?:\s+tile)?$/i.exec(text)) && typed(m[1])) {
    const type = typed(m[1])
    if (type === 'qr') return { reply: 'A QR code needs its web address: say “Add a QR code to https://…”.' }
    const name = { heading: 'Heading', text: 'Text block', image: 'Picture', question: 'Question', 'answer-lines': 'Answer lines', diagram: 'Diagram', panel: 'Panel', speech: 'Speech bubble', term: 'Term', sticker: 'Sticker' }[type]
    if (type === 'question' || type === 'text') return { reply: 'What should it say? Such as “Add a ' + (type === 'question' ? 'question Seeds: What do seeds need to grow?' : 'text block Facts: Bees make honey.') + '”.' }
    return { edits: [{ kind: 'add_tile', type, label: name, ...(type === 'answer-lines' && { body: '3' }), ...((type === 'image' || type === 'diagram') && { alt: name }) }] }
  }
  if ((m = /^(?:put|place|move|drop)\s+(.+?)\s+on\s+(page \d|this page|the page)\s+at\s+row\s+(\d{1,2}),?\s+(?:and\s+)?col(?:umn)?\s+(\d{1,2})(?:,?\s+spanning\s+(\d{1,2})\s*(?:by|x)\s*(\d{1,2}))?$/i.exec(text))) {
    const card = tile(m[1]), where = page(m[2])
    if (!card || !where) return null
    return { edits: [{ kind: 'place_tile', card: { id: card.id }, page: { id: where.id }, row: Number(m[3]), col: Number(m[4]), ...(m[5] && { rows: Number(m[5]), cols: Number(m[6]) }) }] }
  }
  if ((m = /^(?:put|move)\s+(.+?)\s+(?:back\s+)?(?:in|into|to)\s+the\s+tray$/i.exec(text))) {
    const card = tile(m[1])
    if (!card) return null
    return { edits: [{ kind: 'place_tile', card: { id: card.id }, page: { id: board.lanes[0].id }, row: 1, col: 1 }] }
  }
  if ((m = /^(?:make|set)\s+(.+?)\s+(\d{1,2})\s*(?:by|x|×)\s*(\d{1,2})(?:\s+cells)?$|^(?:span|stretch)\s+(.+?)\s+across(?:\s+the\s+(?:row|page))?$/i.exec(text))) {
    const name = (m[1] ?? m[4]).replace(/^the\s+/i, '')
    // "the picture": the one on the page (a stamp of that name stays in the tray), else the tile so named.
    const named = tile(name)
    const card = (named?.cell ? named : null) ?? (typed(name) && board.cards.find((item) => item.cell && item.tile?.type === typed(name))) ?? named
    if (!card?.cell) return card ? { reply: card.label + ' is in the tray: put it on a page first.' } : null
    const rows = m[4] ? (card.cell.rows ?? 1) : Number(m[2]), cols = m[4] ? board.grid.cells.cols - card.cell.col : Number(m[3])
    return { edits: [{ kind: 'place_tile', card: { id: card.id }, page: { id: card.laneId }, row: card.cell.row + 1, col: card.cell.col + 1, rows, cols }] }
  }
  if ((m = /^(?:make|have)\s+(.+?)\s+(?:say|read)\s+(.+)$/i.exec(text))) {
    const card = tile(m[1])
    if (!card) return null
    return { edits: [{ kind: 'set_tile', card: { id: card.id }, body: unquote(m[2]) }] }
  }
  if ((m = /^rename\s+(.+?)\s+to\s+(.+)$/i.exec(text))) {
    const card = tile(m[1])
    if (card) return { edits: [{ kind: 'rename_card', card: { id: card.id }, label: unquote(m[2]) }] }
    const lane = page(m[1])
    if (lane) return { edits: [{ kind: 'rename_lane', lane: { id: lane.id }, label: unquote(m[2]) }] }
    return null
  }
  if ((m = /^(?:remove|delete)\s+(.+)$/i.exec(text))) {
    const card = tile(m[1])
    if (card) return { edits: [{ kind: 'remove_card', card: { id: card.id } }] }
  }
  return null
}

const ONE_WORD = { heading: 'heading', text: 'text block', image: 'picture', question: 'question', 'answer-lines': 'set of answer lines', 'word-bank': 'word bank', diagram: 'diagram', qr: 'QR code', panel: 'panel', speech: 'speech bubble', term: 'term', sticker: 'sticker' }
const TYPE_WORDS = { heading: 'headings', text: 'text blocks', image: 'pictures', question: 'questions', 'answer-lines': 'answer lines', 'word-bank': 'word banks', diagram: 'diagrams', qr: 'QR codes', panel: 'panels', speech: 'speech bubbles', term: 'terms', sticker: 'stickers' }
function ruleWords(rule) {
  if (rule.kind === 'tileTypes') return 'This sheet uses ' + rule.types.map((type) => TYPE_WORDS[type]).join(', ') + '.'
  if (rule.kind === 'tileMax') return (rule.per === 'sheet' ? 'The sheet' : 'A page') + ' holds at most ' + rule.max + ' ' + (rule.max === 1 ? ONE_WORD : TYPE_WORDS)[rule.type] + '.'
  if (rule.kind === 'tileSpan') return TYPE_WORDS[rule.type][0].toUpperCase() + TYPE_WORDS[rule.type].slice(1) + ' can span up to ' + rule.rows + ' by ' + rule.cols + ' cells.'
  return 'Every page needs ' + (rule.atLeast === 1 ? (/^[aeiou]/i.test(ONE_WORD[rule.type]) ? 'an ' : 'a ') + ONE_WORD[rule.type] : rule.atLeast + ' ' + TYPE_WORDS[rule.type]) + '.'
}
