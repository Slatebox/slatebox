// A printable page built from a description (snap-grid spec §6–§8): on a builder slate, words that name a composed page
// ("snappable congruent pieces to compose new printable materials", "a worksheet builder … six blocks per page",
// "bingo card maker: 5 by 5 squares") are a grid sheet, not lanes: a page of equal cells and a tray of tiles people
// drag into them, then print. The agent drafts it (workshops.draft, the grid format, workshop-grid-draft.mjs); without
// one, or when its draft does not hold together, a starter is made here from the words (gridStarter). Both are held to
// one quality gate (gridQuality), which the drafting request also asks again by. Pure: the server and the tests read
// the same. Server only (it loads the sheet's rules): the page reads a preview, never this module.
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { cellSizeProblem, gridNeeds, gridSheet, inBounds, spanOf } from 'slateboxjs/workshops/rules'
import { flowLanes, placeholderLabel, statedLimit, useGridBuilder } from './builder-freeform.mjs'

const words = (message) => (typeof message === 'string' ? message.replace(/\s+/g, ' ').trim() : '')

const PAGE_WORDS = /\b(?:print|prints|printed|printing|printable|printables|worksheets?|pages?|sheets?|a4|letter-size|handouts?|pdfs?)\b/i
const GRID_WORDS = /\b(?:grid|cells?|frame|\d+\s*by\s*\d+|\d+\s*x\s*\d+|bingo|sticker sheet|flash ?card sheet|comic (?:page|strip))\b/i
// A grid of days or periods is a timetable, a board of lanes: never a page to print.
const TIMETABLE = /\b(?:each day|every day|for a week|for the week|weekly|schedule|timetable|calendar|agenda|lesson plan)\b/i

/**
 * Whether a description names a composed page: a page or print word, or a grid or cell word, in a request that is not
 * a question, not a timetable and not a flow of stages ("from draft to committed to achieved").
 */
export function gridDescription(message) {
  const text = words(message)
  if (!text || /\?$/.test(text)) return false
  if (!PAGE_WORDS.test(text) && !GRID_WORDS.test(text)) return false
  if (TIMETABLE.test(text) || flowLanes(text).length) return false
  return true
}

// ---- Starters: a finished example page from the words, one kit per kind of material (spec §7) ----

const letter = (rows, cols, gutter = 0.125) => ({ page: { size: 'letter', orientation: 'portrait', margin: 0.5 }, cells: { rows, cols, gutter } })
/** The page the words ask for: A4 or Letter, landscape or portrait, over the kit's own. */
function pageFrom(text, grid) {
  const size = /\ba4\b/i.test(text) ? 'a4' : /\bletter\b/i.test(text) ? 'letter' : grid.page.size
  const orientation = /\blandscape\b/i.test(text) ? 'landscape' : /\bportrait\b/i.test(text) ? 'portrait' : grid.page.orientation
  return { ...grid, page: { ...grid.page, size, orientation } }
}
const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 }
const num = (word) => (/^\d+$/.test(word) ? Number(word) : NUMBERS[String(word).toLowerCase()])
const N = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve)'
/** How many across the words ask for ("3 across", "three per row"), or null. */
const across = (text) => { const m = new RegExp(`\\b${N}\\s+(?:across|per row|in a row|wide)\\b`, 'i').exec(text); return m ? num(m[1]) : null }

const lang = (text, table) => table[Object.keys(table).find((key) => key !== 'default' && new RegExp(key).test(text))] ?? table.default
const ANIMALS = ['Lion', 'Tiger', 'Zebra', 'Giraffe', 'Panda', 'Koala', 'Otter', 'Eagle', 'Shark', 'Whale', 'Camel', 'Rhino', 'Hippo', 'Moose', 'Bison',
  'Llama', 'Gecko', 'Parrot', 'Penguin', 'Dolphin', 'Fox', 'Wolf', 'Bear', 'Owl']
const rule = {
  maxHeading: { kind: 'tileMax', type: 'heading', max: 1, per: 'page' },
  needsHeading: { kind: 'tileNeeds', type: 'heading', atLeast: 1, per: 'page' },
}

/** Each kit: its test (the description's nouns), title, page, stamps, page 1's finished example and rules. */
const KITS = [
  { id: 'bingo', test: /\bbingo\b/, title: 'Animal bingo', grid: () => letter(6, 5),
    stamps: () => [['Card title', { type: 'heading' }], ['Animal', { type: 'term' }]],
    page: () => {
      const terms = []
      let i = 0
      for (let row = 1; row <= 5; row++) for (let col = 0; col < 5; col++) terms.push(row === 3 && col === 2 ? ['Free', { type: 'term' }, { row, col }] : [ANIMALS[i++], { type: 'term' }, { row, col }])
      return [['Animal bingo', { type: 'heading' }, { row: 0, col: 0, cols: 5 }], ...terms]
    },
    rules: () => [rule.maxHeading, rule.needsHeading, { kind: 'tileTypes', types: ['heading', 'term'] }],
    said: 'Say “duplicate page 1 shuffled” for a different card per player.' },
  { id: 'flashcards', test: /\bflash ?cards?\b/, title: ({ text }) => lang(text, { 'spanish|español|espanol': 'Spanish flashcards', 'french|français': 'French flashcards', default: 'Science flashcards' }),
    grid: () => letter(4, 2, 0.25),
    stamps: ({ text }) => [['Word and meaning', { type: 'term', body: lang(text, { 'spanish|español|espanol': 'English meaning', default: 'What it means' }) }], ['Picture', { type: 'image', image: { alt: 'A picture of the term' } }]],
    page: ({ text }) => lang(text, {
      'spanish|español|espanol': [['hola', 'hello'], ['gracias', 'thank you'], ['la casa', 'house'], ['el perro', 'dog'], ['la biblioteca', 'library'], ['correr', 'to run'], ['mañana', 'tomorrow'], ['el agua', 'water']],
      'french|français': [['bonjour', 'hello'], ['merci', 'thank you'], ['la maison', 'house'], ['le chien', 'dog'], ['la bibliothèque', 'library'], ['courir', 'to run'], ['demain', 'tomorrow'], ["l'eau", 'water']],
      default: [['Photosynthesis', 'How plants make food from light'], ['Mitosis', 'A cell splitting into two'], ['Evaporation', 'Liquid turning into gas'], ['Gravity', 'The pull between masses'],
        ['Habitat', 'Where a living thing lives'], ['Predator', 'An animal that hunts others'], ['Erosion', 'Land worn away by wind or water'], ['Fossil', 'Remains kept in rock']],
    }).map(([term, meaning], i) => [term, { type: 'term', body: meaning }, { row: Math.floor(i / 2), col: i % 2 }]),
    rules: () => [{ kind: 'tileTypes', types: ['term', 'image'] }] },
  { id: 'stickers', test: /\bstickers?\b/, title: 'Classroom reward stickers', grid: ({ text }) => letter(5, across(text) ?? 3),
    stamps: () => [['Reward sticker', { type: 'sticker', body: 'Well done' }]],
    page: () => ['Great job!', 'Star reader', 'Kind helper', 'Math whiz', 'Super speller', 'Team player'].map((label, i) => [label, { type: 'sticker' }, { row: Math.floor(i / 3), col: i % 3 }]),
    rules: () => [{ kind: 'tileTypes', types: ['sticker'] }] },
  { id: 'comic', test: /\bcomics?\b|\bpanels?\b|\bstrips?\b/, title: 'Captain Comet comic page', grid: () => letter(3, 2),
    stamps: () => [['Comic panel', { type: 'panel', body: 'What happens here' }], ['Speech bubble', { type: 'speech', body: 'Look out!' }], ['Comic title', { type: 'heading' }]],
    page: () => [
      ['Captain Comet spots trouble', { type: 'panel' }, { row: 0, col: 0 }], ['A meteor heads for the city', { type: 'panel' }, { row: 0, col: 1 }],
      ['Robot sidekick powers up', { type: 'panel' }, { row: 1, col: 0 }], ['The meteor bounces into space', { type: 'panel' }, { row: 1, col: 1 }],
      ['Captain Comet', { type: 'speech', body: 'Hold on, everyone!' }, { row: 2, col: 0 }], ['Robot sidekick', { type: 'speech', body: 'Shields at full power!' }, { row: 2, col: 1 }],
    ],
    rules: () => [{ kind: 'tileSpan', type: 'panel', rows: 2, cols: 2 }, rule.maxHeading] },
  { id: 'recipe', test: /\brecipes?\b/, title: 'Tomato soup', grid: () => ({ page: { size: 'a4', orientation: 'landscape', margin: 0.5 }, cells: { rows: 2, cols: 3, gutter: 0.125 } }),
    stamps: () => [['Recipe name', { type: 'heading' }], ['Cooking steps', { type: 'text', body: 'Chop, simmer, then serve warm.' }], ['Photo', { type: 'image', image: { alt: 'The finished dish' } }]],
    page: () => [['Tomato soup', { type: 'heading' }, { row: 0, col: 0, cols: 3 }],
      ['What you need', { type: 'text', body: 'Ingredients\n4 ripe tomatoes\n1 onion\n2 cups vegetable stock\nSalt and pepper' }, { row: 1, col: 0 }],
      ['How to make it', { type: 'text', body: 'Method\nChop the onion and tomatoes.\nSimmer in the stock for 20 minutes.\nBlend until smooth.' }, { row: 1, col: 1 }],
      ['A bowl of tomato soup', { type: 'image', image: { alt: 'A bowl of tomato soup' } }, { row: 1, col: 2 }]],
    rules: () => [rule.needsHeading] },
  { id: 'jigsaw', test: /\bpuzzles?\b|\bjigsaws?\b/, title: 'Farm jigsaw', grid: () => ({ page: { size: 'letter', orientation: 'landscape', margin: 0.5 }, cells: { rows: 3, cols: 2, gutter: 0 } }),
    stamps: () => [['Puzzle piece', { type: 'image', image: { alt: 'One piece of the picture' } }], ['Puzzle title', { type: 'heading' }]],
    page: () => [['Farm jigsaw', { type: 'heading' }, { row: 0, col: 0, cols: 2 }],
      ['Barn roof (top left)', { type: 'image', image: { alt: 'A red barn roof' } }, { row: 1, col: 0 }], ['Blue sky (top right)', { type: 'image', image: { alt: 'Blue sky with a cloud' } }, { row: 1, col: 1 }],
      ['Green field (bottom left)', { type: 'image', image: { alt: 'A green field with a fence' } }, { row: 2, col: 0 }], ['Duck pond (bottom right)', { type: 'image', image: { alt: 'Ducks on a pond' } }, { row: 2, col: 1 }]],
    rules: () => [{ kind: 'tileTypes', types: ['heading', 'image'] }, rule.maxHeading] },
  { id: 'worksheet', test: /\bworksheets?\b|\bmath\b|\bquiz(?:zes)?\b/, title: 'Fractions practice', grid: () => letter(6, 2),
    stamps: () => [['Worksheet title', { type: 'heading', body: 'Name and date' }], ['Practice question', { type: 'question', body: 'What is 3/4 - 1/4?' }],
      ['Answer lines', { type: 'answer-lines', body: '3' }], ['Fraction bar picture', { type: 'image', image: { alt: 'A fraction bar' } }], ['Word bank', { type: 'word-bank', words: ['numerator', 'denominator', 'equivalent'] }]],
    page: () => [['Fractions practice', { type: 'heading', body: 'Name and date' }, { row: 0, col: 0, cols: 2 }],
      ['Adding fractions', { type: 'question', body: 'What is 1/2 + 1/4?' }, { row: 1, col: 0 }], ['Show your work', { type: 'answer-lines', body: '3' }, { row: 1, col: 1 }],
      ['Shade the bar', { type: 'question', body: 'Shade 3/8 of a bar split into 8 equal parts.' }, { row: 2, col: 0 }], ['Your answer', { type: 'answer-lines', body: '2' }, { row: 2, col: 1 }],
      ['Compare', { type: 'question', body: 'Which is larger, 2/3 or 3/5? Explain how you know.' }, { row: 3, col: 0 }],
      ['Words to use', { type: 'word-bank', words: ['numerator', 'denominator', 'equivalent', 'whole'] }, { row: 5, col: 0, cols: 2 }]],
    rules: ({ text }) => [rule.maxHeading, rule.needsHeading, { kind: 'tileMax', type: 'question', max: statedLimit(text) ?? 6, per: 'page' }] },
  { id: 'printable', test: /./, title: 'Printable page kit', grid: () => letter(4, 2),
    stamps: () => [['Lesson title', { type: 'heading' }], ['Fact', { type: 'text', body: 'Rain falls when droplets in a cloud grow too heavy.' }],
      ['Picture', { type: 'image', image: { alt: 'A labeled drawing' } }], ['Question', { type: 'question', body: 'Why does a puddle shrink on a sunny day?' }],
      ['Answer lines', { type: 'answer-lines', body: '3' }], ['Word bank', { type: 'word-bank', words: ['sun', 'cloud', 'rain'] }], ['Diagram', { type: 'diagram', image: { alt: 'A cycle with four arrows' } }]],
    page: () => [['The water cycle', { type: 'heading' }, { row: 0, col: 0, cols: 2 }],
      ['How water moves', { type: 'text', body: 'Water moves from the sea to the sky and back again.' }, { row: 1, col: 0 }],
      ['Clouds over a hill', { type: 'image', image: { alt: 'Clouds over a hill' } }, { row: 1, col: 1 }],
      ['Think about it', { type: 'question', body: 'What makes clouds form?' }, { row: 2, col: 0 }], ['Your answer', { type: 'answer-lines', body: '3' }, { row: 2, col: 1 }],
      ['Words to use', { type: 'word-bank', words: ['evaporation', 'condensation', 'precipitation'] }, { row: 3, col: 0 }]],
    rules: () => [rule.maxHeading, rule.needsHeading, { kind: 'tileSpan', type: 'image', rows: 2, cols: 2 }] },
]

const kitOf = (message) => { const text = words(message).toLowerCase(); return KITS.find((kit) => kit.test.test(text)) }
const at = (value, ctx) => (typeof value === 'function' ? value(ctx) : value)

/**
 * A finished example page from the words, deterministic: the kit the description's nouns pick, on the page it asks
 * for (A4, landscape, so many across), its rules stamped as preset. Passes validateWorkshop and gridQuality.
 */
export function gridStarter(message, { now = new Date(), by = 'Slatebox' } = {}) {
  const text = words(message).toLowerCase()
  const kit = kitOf(message)
  const ctx = { text }
  let grid = pageFrom(text, at(kit.grid, ctx))
  // A page turned to landscape may make cells too small for the kit's rows: the kit's own page then.
  if (cellSizeProblem(grid)) grid = at(kit.grid, ctx)
  const board = gridSheet(at(kit.title, ctx), grid, at(kit.stamps, ctx), at(kit.page, ctx), at(kit.rules, ctx))
  const set = { by, at: new Date(now).toISOString(), via: 'preset' }
  return { ...board, behaviour: { ...board.behaviour, rules: board.behaviour.rules.map((item) => ({ ...item, set })) } }
}

/** The kit a description picks, by id (for the preview's last line and the eval's checks). */
export const gridKitId = (message) => kitOf(message).id

// ---- The quality gate (spec §8): plain sentences, sent back to the agent ----

const tokens = (text) => String(text ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
const singular = (word) => (word.length > 3 && /s$/.test(word) && !/ss$/.test(word) ? word.replace(/(?<=[^aeiou]|[aeiou]{2})es$|s$/, '') : word)
// Words that say how a sheet works, never what it is about.
const SHEET_WORDS = new Set(('snappable congruent piece compose composing new printable print material page sheet grid cell tile block frame card maker builder ' +
  'drag drop onto onto letter a4 landscape portrait per each with and the for of to a an my our your in on at by i we can then that it is are be some big small ' +
  'arrange arrangeable layout lay out kit make makes making build template thing stuff one two three four five six seven eight nine ten different player ' +
  'square space middle top bottom title heading question picture image answer line word bank panel speech bubble sticker term diagram qr code free across ' +
  'class classroom grade student kid teacher reward use who what simple quick fit into like flashcard flash vocabulary vocab ' +
  'spanish french german italian english chinese japanese portuguese language').split(' '))
const topicOf = (message) => [...new Set(tokens(message).map(singular))].filter((word) => word.length > 2 && !SHEET_WORDS.has(word) && !/^\d+(?:st|nd|rd|th)?$/.test(word))
const ALL_CAPS = /\b[A-Z]{2,}(?:\s+[A-Z]{2,})+\b/
// A tile's name that starts with its kind.
const KIND_PREFIX = /^(?:heading|title|text(?: block)?|picture|image|question|answer lines?|word bank|diagram|qr code|panel|speech(?: bubble)?|term|sticker)\s*(?::|\s[-–—])\s*/i
const said = (text) => `“${String(text).replace(/\s+/g, ' ').trim()}”`
const tileKey = (card) => [card.tile?.type, card.label.trim().toLowerCase(), (card.tile?.body ?? '').trim().toLowerCase(), (card.tile?.words ?? []).join('|').toLowerCase()].join('\u0000')

/**
 * What keeps a grid sheet from being a page a teacher or maker would print today, as sentences; [] when nothing does.
 * Read by the drafting request (a draft that fails is asked again, naming it), the preview, the starter's own test and
 * both eval layers.
 */
export function gridQuality(board, { message = '' } = {}) {
  const problems = []
  const tray = board.cards.filter((card) => card.laneId === board.lanes[0].id)
  const first = board.lanes[1]
  const placed = board.cards.filter((card) => card.laneId !== board.lanes[0].id)
  const pageOne = board.cards.filter((card) => card.laneId === first?.id)
  if (board.cards.length < 3) problems.push('Give the sheet at least three tiles.')
  if (!pageOne.length) problems.push('Compose page 1 as a finished example.')
  if (!tray.length) problems.push('Put the tiles people add in the tray.')
  const filler = board.cards.filter((card) => {
    const body = card.tile?.body ?? ''
    const all = card.label + ' ' + body + ' ' + (card.tile?.words ?? []).join(' ') + ' ' + (card.tile?.image?.alt ?? '')
    if ((card.tile?.type === 'question' || card.tile?.type === 'text') && !body.trim()) return true
    if (/lorem ipsum|\[[^\]]*\]|\bTBD\b|\bTODO\b/i.test(all) || ALL_CAPS.test(all)) return true
    return placeholderLabel((card.label + ' ' + body).trim())
  })
  if (filler.length) problems.push(`Write real content in every tile: ${filler.slice(0, 3).map((card) => said(card.label)).join(', ')} ${filler.length === 1 ? 'is' : 'are'} only a placeholder or has no words.`)
  // Within the tray, and within each page (a copied page repeats its first, as a bingo card per player does).
  for (const group of [tray, ...board.lanes.slice(1).map((lane) => placed.filter((card) => card.laneId === lane.id))]) {
    const seen = new Set()
    const twice = group.find((card) => { const key = tileKey(card); if (seen.has(key)) return true; seen.add(key); return false })
    if (twice) { problems.push(`Give each tile its own content: ${said(twice.label)} appears more than once.`); break }
  }
  const types = new Set(board.cards.map((card) => card.tile?.type))
  const distinct = new Set(board.cards.map((card) => card.label.trim().toLowerCase())).size
  if (types.size === 1 && !(board.cards.length >= 6 && distinct >= 6)) problems.push('Use more than one kind of tile (a heading with questions, a picture with words), or six or more different tiles of one kind.')
  const rules = (board.behaviour?.rules ?? []).filter((item) => item.on)
  if (!rules.length) problems.push('Give the sheet at least one rule: allowed tiles, a maximum, a requirement or a span.')
  for (const item of rules) {
    if (item.kind === 'tileTypes' || types.has(item.type)) continue
    problems.push(`A rule names ${item.type.replace('-', ' ')} tiles, and no tile is one: make one, or leave the rule out.`)
    break
  }
  if (first) for (const need of gridNeeds(board, first.id)) problems.push(`${first.label} needs ${need}.`)
  const bank = board.cards.find((card) => card.tile?.type === 'word-bank' && (card.tile.words?.length ?? 0) < 3)
  if (bank) problems.push(`${said(bank.label)} is a word bank with fewer than three words.`)
  const qr = board.cards.find((card) => card.tile?.type === 'qr' && !card.tile.link)
  if (qr) problems.push(`${said(qr.label)} is a QR code with no web address: give it one from the person's words, or leave it out.`)
  const topic = topicOf(message)
  if (topic.length) {
    const known = new Set([...topic, ...tokens(board.title).map(singular), ...tokens(KIT_WORDS[kitOf(message).id]).map(singular)].filter((word) => !SHEET_WORDS.has(word)))
    const about = board.cards.some((card) => tokens([card.label, card.tile?.body, ...(card.tile?.words ?? []), card.tile?.image?.alt].join(' ')).map(singular).some((word) => known.has(word)))
    if (!about) problems.push(`None of the tiles is about ${topic.slice(0, 3).join(' ')}: fill the page with real content for it.`)
  }
  return problems
}

// What each kit's tiles talk about: a draft for that kind of material may use its words.
const KIT_WORDS = Object.fromEntries(KITS.map((kit) => {
  const ctx = { text: '' }
  const cards = [...at(kit.stamps, ctx), ...at(kit.page, ctx)]
  return [kit.id, cards.map(([label, tile]) => [label, tile.body, ...(tile.words ?? []), tile.image?.alt].filter(Boolean).join(' ')).join(' ')]
}))

/**
 * A draft's unambiguous slips put right, on the board as drafted (before or after validateWorkshop): a repeated tile
 * left out, a span clamped to the grid, a tile over another or past the page's edge back in the tray, a picture or QR
 * address that is not in the person's words taken away (a QR code with none left goes), a stamp on a page made a tile,
 * and a sheet's tiles that no tile uses taken off its rule. Never invents content.
 */
export function repairGrid(input, { message = '' } = {}) {
  const repairs = []
  const board = structuredClone(input)
  const grid = board.grid
  const tray = board.lanes?.[0]?.id
  if (!grid || !Array.isArray(board.cards) || !tray) return { workshop: board, repairs }
  const inWords = (address) => typeof address === 'string' && words(message).includes(address)
  const seen = new Set()
  board.cards = board.cards.filter((card) => {
    if (!card?.tile) return true
    const key = card.laneId + '\u0000' + tileKey(card)
    if (seen.has(key)) { repairs.push(`left out a repeated ${said(card.label)}`); return false }
    seen.add(key)
    return true
  })
  for (const card of board.cards) {
    if (!card?.tile) continue
    if (card.tile.image?.src && !inWords(card.tile.image.src)) { delete card.tile.image.src; repairs.push(`took away a picture address for ${said(card.label)} that is not in the person's words`) }
    if (card.tile.link && !inWords(card.tile.link)) { delete card.tile.link; repairs.push(`took away a web address for ${said(card.label)} that is not in the person's words`) }
    if (card.laneId !== tray && card.tile.stamp) { delete card.tile.stamp; repairs.push(`made the stamp ${said(card.label)} on a page a tile`) }
    if (card.laneId === tray && card.cell) delete card.cell
  }
  // A name that starts with its kind ("Heading: Spring plants", "Question: Which plant …") says the kind twice; words
  // that repeat the name say it twice: the kind and the repeat come off.
  for (const card of board.cards) {
    if (!card?.tile || typeof card.label !== 'string') continue
    const bare = card.label.replace(KIND_PREFIX, '').trim().replace(/^["'“‘](.+)["'”’]$/, '$1').trim()
    if (bare && bare !== card.label) { card.label = bare; repairs.push(`took the kind off the name ${said(bare)}`) }
    const body = card.tile.body?.trim()
    const plainWords = (text) => String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (body && plainWords(body) === plainWords(card.label)) {
      if (card.tile.type === 'question' || card.tile.type === 'text') card.label = card.tile.type === 'question' ? 'Question' : 'Text'
      else delete card.tile.body
      repairs.push(`left out words that repeat the name ${said(body)}`)
    }
  }
  const qrless = board.cards.filter((card) => card.tile?.type === 'qr' && !card.tile.link)
  if (qrless.length) { board.cards = board.cards.filter((card) => !qrless.includes(card)); repairs.push(`left out ${qrless.length === 1 ? 'a QR code' : qrless.length + ' QR codes'} with no web address`) }
  // Spans clamped to the grid; then, page by page in reading order, a tile on another or past the edge goes to the tray.
  for (const card of board.cards) {
    if (card.laneId === tray || !card.cell) continue
    const { row, col } = card.cell
    const rows = Math.max(1, Math.min(spanOf(card.cell).rows, grid.cells.rows - row)), cols = Math.max(1, Math.min(spanOf(card.cell).cols, grid.cells.cols - col))
    const was = spanOf(card.cell)
    if (row < grid.cells.rows && col < grid.cells.cols && (rows !== was.rows || cols !== was.cols)) {
      card.cell = { row, col, ...(rows > 1 && { rows }), ...(cols > 1 && { cols }) }
      repairs.push(`fit ${said(card.label)} inside the page`)
    }
  }
  const held = new Map()
  const order = [...board.cards].filter((card) => card.laneId !== tray && card.cell).sort((a, b) => a.cell.row - b.cell.row || a.cell.col - b.cell.col)
  for (const card of [...board.cards.filter((item) => item.laneId !== tray && !item.cell), ...order]) {
    const cells = []
    if (card.cell && inBounds(grid, card.cell)) {
      const { rows, cols } = spanOf(card.cell)
      for (let r = card.cell.row; r < card.cell.row + rows; r++) for (let c = card.cell.col; c < card.cell.col + cols; c++) cells.push(card.laneId + ':' + r + ':' + c)
    }
    if (cells.length && cells.every((key) => !held.has(key))) { for (const key of cells) held.set(key, card.id); continue }
    card.laneId = tray
    delete card.cell
    repairs.push(`put ${said(card.label)} back in the tray: its cell was taken or off the page`)
  }
  const used = new Set(board.cards.map((card) => card.tile?.type))
  if (board.behaviour?.rules) {
    board.behaviour.rules = board.behaviour.rules.flatMap((item) => {
      if (item.kind !== 'tileTypes') return [item]
      const types = item.types.filter((type) => used.has(type))
      if (types.length === item.types.length) return [item]
      repairs.push('took tiles no tile uses off the sheet’s list')
      return types.length ? [{ ...item, types }] : []
    })
  }
  return { workshop: board, repairs }
}

// ---- What the preview says (spec §6) ----

const pageWords = (board) => `a ${board.grid.page.size === 'a4' ? 'A4' : 'Letter'} ${board.grid.page.orientation} page, ${board.grid.cells.rows} by ${board.grid.cells.cols} cells`

/** What the preview says of a sheet made from a description: drafted by the agent, or started here (a visitor told signing in drafts it). */
export function gridSaid(board, { drafted, guest = false, message = '' } = {}) {
  const tiles = board.cards.filter((card) => card.laneId === board.lanes[0].id).length
  const made = `“${board.title}”: ${pageWords(board)}, ${tiles} ${tiles === 1 ? 'tile' : 'tiles'} to drag.`
  const more = message && kitOf(message).said ? ' ' + kitOf(message).said : ''
  if (drafted) return `Drafted ${made} Say “make it 3 columns”, or print it from the page header.`
  if (guest) return `Started ${made} This is a starter from your words: sign in and the agent drafts the whole page for you.`
  return `Started ${made} Say “make it 3 columns”, or print it from the page header.${more}`
}

/**
 * The sheet a description makes: the agent's draft when it holds together as a grid sheet and, its slips repaired,
 * passes the quality gate; else the starter from the words. `drafted` says which.
 */
export function gridBoard(draft, message, options = {}) {
  if (draft) {
    try {
      const { workshop, repairs } = repairGrid(draft, { message })
      const valid = validateWorkshop(workshop)
      if (valid.kind === 'grid' && !gridQuality(valid, { message }).length) return { workshop: valid, drafted: true, repairs }
    } catch { /* the starter below */ }
  }
  return { workshop: validateWorkshop(gridStarter(message, options)), drafted: false, repairs: [] }
}

// builderBoard and builderSaid hand a grid sheet to these (builder-freeform.mjs), on the server where this loads.
useGridBuilder({ board: gridBoard, said: gridSaid })
