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
 * What the drafting agent is given: the person's words, at most 1,200 characters (workshops.draft's limit). How to
 * make a component of them (cards are the pieces people move, lanes where they go, limits and rules as behavior,
 * with worked examples) is the draft's own instructions (workshop.draft.component), an administrator's to edit.
 */
export function builderBrief(message) {
  return words(message).slice(0, 1200)
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

// ---- The quality gate: what makes a board a working tool, not a toy ----
// One check, read by the drafting request (workshop-component-draft.mjs: a draft that fails it is asked again, naming
// what is wrong), by the preview (a drafted board is repaired where that is unambiguous) and by both eval layers.

// Words that name a piece without saying what it is ("Piece 3", "Item B", "Card 1").
const GENERIC = new Set(['piece', 'card', 'item', 'tile', 'block', 'task', 'step', 'thing', 'option', 'idea', 'note', 'part', 'module',
  'element', 'entry', 'component', 'shape', 'token', 'unit', 'slot', 'object', 'sample', 'example', 'placeholder', 'new', 'lane', 'column',
  'stage', 'group', 'section', 'brick', 'other', 'misc', 'untitled', 'label', 'text', 'name', 'number', 'no', 'version', 'variant', 'type'])
const tokens = (text) => String(text ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
const singular = (word) => (word.length > 3 && /s$/.test(word) && !/ss$/.test(word) ? word.replace(/(?<=[^aeiou]|[aeiou]{2})es$|s$/, '') : word)

// What counts a card off in a sequence instead of naming it: a number, a letter, a spelled-out number (one … twenty),
// an ordinal (first … twentieth, 1st, 2nd), a Roman numeral (I … XX), a letter and number code (A1, 2B), or a Greek
// letter (Alpha, Beta …).
const SPELLED = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ')
const ORDINALS = 'first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth twentieth last final'.split(' ')
const ROMAN = 'i ii iii iv v vi vii viii ix x xi xii xiii xiv xv xvi xvii xviii xix xx'.split(' ')
const GREEK = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega'.split(' ')
const WEAK = new Set([...SPELLED, ...ORDINALS, ...ROMAN.filter((r) => r.length > 1), ...GREEK])
// Fractions and quantities read as one thing ("One half", "Two thirds"), never as a count.
const FRACTION = new Set(['half', 'halves', 'third', 'thirds', 'quarter', 'quarters', 'fourth', 'fourths', 'fifth', 'fifths', 'sixth', 'sixths', 'eighth', 'eighths', 'tenth', 'tenths', 'whole', 'dozen', 'hundred', 'thousand'])
const strongMarker = (word) => /^#?\d{1,3}$/.test(word) || /^[a-z]$/.test(word) || /^\d{1,3}(st|nd|rd|th)$/.test(word) || /^[a-z]\d{1,3}$/.test(word) || /^\d{1,3}[a-z]$/.test(word)
const marker = (word) => strongMarker(word) || WEAK.has(word)

/**
 * A card label read as a sequence marker and what it counts ("Piece one" → { marker: 'one', stem: 'piece' }), or null
 * when no end of it counts. A marker at the end, or (for any marker but a lone letter) at the start.
 */
export function labelMarker(label) {
  const parts = tokens(label)
  if (!parts.length) return null
  const last = parts.at(-1), first = parts[0]
  if (parts.length === 1) return marker(last) ? { marker: last, stem: '', at: 'end' } : null
  if (marker(last) && !(FRACTION.has(last) && marker(parts.at(-2)))) return { marker: last, stem: parts.slice(0, -1).join(' '), at: 'end' }
  if (marker(first) && !/^[a-z]$/.test(first) && !FRACTION.has(parts[1])) return { marker: first, stem: parts.slice(1).join(' '), at: 'start' }
  return null
}

const stemWords = (stem) => (stem ? stem.split(' ') : [])
const sayNothing = (stem, known) => stemWords(stem).every((word) => GENERIC.has(singular(word)) || known.has(word) || known.has(singular(word)))

/**
 * Whether a card's label only counts off a phrase the board already says: its title, a lane, the person's words or a
 * generic noun, with a number or letter at the end ("Snappable piece 3", "Laptop B"); or a generic noun with any
 * sequence marker at either end ("Piece one", "First piece", "Block A1", "1 piece"); or a marker alone ("7", "Alpha").
 * `stems`: how many cards of the board count off each stem; a stem counted off on two or more cards is a sequence,
 * whatever it says ("Red block one", "Red block two").
 */
export function placeholderLabel(label, known = new Set(), stems = new Map()) {
  const parts = tokens(label)
  if (!parts.length) return true
  const read = labelMarker(label)
  if (!read) return false
  // A marker alone: a number or letter is never a name; a word that counts ("Alpha", "Two") is one when two or more
  // cards of the board are only such words.
  if (!read.stem) return strongMarker(read.marker) || (stems.get('') ?? 0) >= 2
  if (stemWords(read.stem).every((word) => GENERIC.has(singular(word)))) return true
  if ((stems.get(read.stem) ?? 0) >= 2) return true
  return read.at === 'end' && strongMarker(read.marker) && sayNothing(read.stem, known)
}

/** How many cards count off each stem (labelMarker), for placeholderLabel's sequence reading. */
const stemCounts = (cards) => {
  const counts = new Map()
  for (const card of cards) {
    const read = labelMarker(card.label)
    if (read) counts.set(read.stem, (counts.get(read.stem) ?? 0) + 1)
  }
  return counts
}

const behaves = (workshop) => workshop.lanes.some((lane) => lane.capacity !== undefined) || workshop.cards.some((card) => card.allowedLaneIds) ||
  (workshop.behaviour?.rules ?? []).some((rule) => rule.on) || (workshop.signals ?? []).length > 0
const known = (workshop, message) => new Set([...tokens(message), ...tokens(workshop.title), ...workshop.lanes.flatMap((lane) => tokens(lane.label))].flatMap((word) => [word, singular(word)]))
// A last word and its plural as one ("square", "squares").
const tailWord = (word) => (word.length > 3 && /s$/.test(word) && !/ss$/.test(word) ? word.slice(0, -1) : word)
const quote = (labels) => labels.slice(0, 3).map((label) => `“${String(label).replace(/\s+/g, ' ').trim()}”`).join(', ')

// A lane where finished work ends up: done, ready, printed, shipped, archived …
const FINISHED = /\b(done|finished|complete|completed|ready|print|printed|printable|archive|archived|shipped|published|filed|discard|discarded|exported|delivered|closed|resolved|fixed|achieved|harvested|terminad[ao]s?|fini|erledigt|fertig|完了)\b|完了/i
const NUMBER_WORD = new RegExp(`^(\\d{1,3}|${SPELLED.join('|')})$`)

/**
 * The lanes whose capacity stops the board once they fill: a lane filed as an archive (an archive rule), or the last
 * lane of a flow (cards move one column at a time) named as where finished work goes ("Done", "Ready to print").
 * → [{ lane, capacity, ambiguous }], `ambiguous` when the person's words give a number beside the lane's own words
 * ("done holds 5"), so the limit may be theirs.
 */
export function finishedLaneCaps(workshop, { message = '' } = {}) {
  const rules = (workshop?.behaviour?.rules ?? []).filter((rule) => rule.on !== false)
  const archived = new Set(rules.filter((rule) => rule.kind === 'bin').map((rule) => rule.lane))
  const flow = rules.some((rule) => rule.kind === 'path' && rule.from === 'any' && rule.noSkip)
  const lanes = workshop?.lanes ?? []
  const words = tokens(message)
  const out = []
  lanes.forEach((lane, index) => {
    const caps = [lane.capacity, ...rules.filter((rule) => rule.kind === 'capacity' && rule.where === lane.id).map((rule) => rule.max)].filter((n) => n !== undefined)
    if (!caps.length) return
    const finished = archived.has(lane.id) || (flow && index === lanes.length - 1 && lanes.length >= 2 && FINISHED.test(lane.label))
    if (!finished) return
    const own = new Set(tokens(lane.label).filter((word) => word.length > 2).flatMap((word) => [word, singular(word)]))
    const ambiguous = words.some((word, i) => (own.has(word) || own.has(singular(word))) && words.slice(Math.max(0, i - 4), i + 5).some((near) => NUMBER_WORD.test(near)))
    out.push({ lane, capacity: caps[0], ambiguous })
  })
  return out
}

/**
 * The quality of a smart component (a validated board of lanes): [] when it is a tool someone would use, else what is
 * wrong, one plain sentence each (sent to the drafting agent as is): at least three cards; every card named as the
 * real thing it is, never a lane, title or generic phrase counted off with a number, letter, ordinal or numeral; no
 * card named twice; no one word ending most cards; no capacity on the lane finished work ends up in; and at least one
 * piece of behavior (a lane capacity, allowed lanes on a card, a rule or a signal).
 */
export function componentQuality(workshop, { message = '' } = {}) {
  const problems = []
  const cards = workshop?.cards ?? []
  if (cards.length < 3) problems.push('Give the board at least three cards people will drag.')
  const words = known(workshop, message)
  const stems = stemCounts(cards)
  const placeholders = cards.filter((card) => placeholderLabel(card.label, words, stems)).map((card) => card.label)
  if (placeholders.length) problems.push(`Name every card as the real, specific thing it is: ${quote(placeholders)} ${placeholders.length === 1 ? 'is' : 'are'} only a phrase counted off with a number, letter or numeral.`)
  // Quoted as first written, trimmed, once however its case and spaces vary.
  const first = new Map(), twice = []
  for (const card of cards) {
    const key = tokens(card.label).join(' ')
    if (first.has(key) && !twice.includes(first.get(key))) twice.push(first.get(key))
    if (!first.has(key)) first.set(key, card.label)
  }
  // One word ending most cards ("Title square", "Question square", "Picture square" …): named by the word, not the piece.
  const tails = new Map()
  for (const card of cards) {
    const parts = tokens(card.label)
    if (parts.length >= 2) { const tail = tailWord(parts.at(-1)); tails.set(tail, (tails.get(tail) ?? 0) + 1) }
  }
  const shared = [...tails].find(([, count]) => cards.length >= 4 && count * 3 > cards.length * 2)
  if (shared) {
    // The words those cards share at their end ("square tile 2x2"), said as they are written.
    const ends = cards.map((card) => tokens(card.label)).filter((parts) => parts.length >= 2 && tailWord(parts.at(-1)) === shared[0])
    let common = ends[0]
    for (const parts of ends) { let n = 0; while (n < common.length && n < parts.length && common.at(-1 - n) === parts.at(-1 - n)) n++; common = common.slice(common.length - n) }
    const phrase = common.length ? common.join(' ') : shared[0]
    problems.push(`Name each card for what makes it different: ${shared[1]} of ${cards.length} cards end in the same ${common.length > 1 ? 'words' : 'word'}, “${phrase}”.`)
  }
  if (twice.length) problems.push(`Give each card its own name: ${quote(twice)} ${twice.length === 1 ? 'appears' : 'appear'} more than once.`)
  for (const { lane, capacity } of finishedLaneCaps(workshop, { message })) {
    problems.push(`“${lane.label}” is where finished cards go, so a capacity of ${capacity} there stops the board once it fills: leave it without a capacity, and put the limit on the lane where the work happens.`)
  }
  if (workshop?.lanes && !behaves(workshop)) problems.push('Give the board at least one rule: a lane capacity, allowedLaneIds on a card, or a rule such as one-step.')
  return problems
}

/**
 * A drafted board's unambiguous quality slips, repaired: a card named again is left out; placeholder cards are left
 * out when at least three named cards remain (with any signal about them); and a capacity on the lane finished work
 * ends up in is dropped, unless the person's words give that lane a number. Nothing is invented: a board with no
 * behavior, or too few named cards, stays as it is for componentQuality to refuse. → { workshop, repairs }
 */
export function repairComponent(workshop, { message = '' } = {}) {
  const repairs = []
  const words = known(workshop, message)
  const seen = new Set()
  let cards = workshop.cards.filter((card) => {
    const key = tokens(card.label).join(' ')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (cards.length < workshop.cards.length) repairs.push(`left out ${workshop.cards.length - cards.length} repeated card(s)`)
  const stems = stemCounts(cards)
  const named = cards.filter((card) => !placeholderLabel(card.label, words, stems))
  if (named.length < cards.length && named.length >= 3) {
    repairs.push(`left out ${cards.length - named.length} placeholder card(s)`)
    cards = named
  }
  let lanes = workshop.lanes, behaviour = workshop.behaviour
  const drop = new Set(finishedLaneCaps(workshop, { message }).filter((cap) => !cap.ambiguous).map((cap) => cap.lane.id))
  if (drop.size) {
    lanes = lanes.map((lane) => (drop.has(lane.id) && lane.capacity !== undefined ? (({ capacity, ...rest }) => rest)(lane) : lane))
    if (behaviour?.rules) behaviour = { ...behaviour, rules: behaviour.rules.filter((rule) => !(rule.kind === 'capacity' && drop.has(rule.where))) }
    repairs.push(`dropped the capacity on ${[...drop].map((id) => `“${workshop.lanes.find((lane) => lane.id === id).label}”`).join(', ')}, where finished cards go`)
  }
  if (!repairs.length) return { workshop, repairs }
  const ids = new Set(cards.map((card) => card.id))
  const out = { ...workshop, lanes, cards }
  if (behaviour) out.behaviour = behaviour
  if (workshop.signals) {
    const signals = workshop.signals.filter((signal) => ids.has(signal.cardId))
    if (signals.length) out.signals = signals
    else delete out.signals
  }
  return { workshop: validateWorkshop(out), repairs }
}

// ---- The starter: a board built from the words, when no agent drafts it ----

const cap = (text) => (text ? text[0].toLocaleUpperCase() + text.slice(1) : text)

// Number words a description states a limit with (English and the eval's other languages).
const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, ein: 1, eine: 1, zwei: 2,
  drei: 3, vier: 4, fünf: 5, sechs: 6, um: 1, uma: 1, duas: 2, três: 3, quatro: 4 }
const NUMBER = `(\\d{1,2}|${Object.keys(NUMBERS).join('|')})`
const toNumber = (word) => (/^\d+$/.test(word) ? Number(word) : NUMBERS[word])
const LIMIT_BEFORE = new RegExp(`\\b(?:max(?:imum)?|at most|no more than|up to|only|just|holds?|limit of|capacity of)\\s+${NUMBER}\\b`, 'gi')
const LIMIT_AFTER = new RegExp(`\\b${NUMBER}\\s+(?:[\\p{L}-]+\\s+){0,2}(?:per|each|max(?:imum)?|par|pro|por|at a time)\\b`, 'giu')

/** The one limit a description states ("max 6 per order run", "three talks per slot", "holds four people each"), or null when it states none or several. */
export function statedLimit(message) {
  const text = words(message).toLowerCase()
  if (new RegExp(`\\b(?:no more than|max(?:imum)?|at most|up to)\\s+${NUMBER}\\b[^,.;]*?\\band\\s+${NUMBER}\\b`, 'i').test(text)) return null
  const found = new Set()
  for (const pattern of [LIMIT_BEFORE, LIMIT_AFTER]) for (const match of text.matchAll(pattern)) { const n = toNumber(match[1]); if (n >= 1 && n <= 24) found.add(n) }
  return found.size === 1 ? [...found][0] : null
}

// Kits: what a kind of component is made of, matched by the description's nouns (most specific first). Each names its
// lanes (in the order cards move), its cards (`cards(ctx)`: real, varied names; ctx has the lowercased text and the
// word the description uses for its pieces), the lane limits by lane index, whether cards move through the lanes in
// order (a one-step rule) or go where they fit, cards held to some lanes (`allowed`: label → lane indexes), and what a
// list in the description is (`list`): the cards (default), the working lanes after the kit's first lane
// ('categories'), or every lane in order ('flow').
const lang = (text, table) => table[Object.keys(table).find((key) => key !== 'default' && new RegExp(key).test(text))] ?? table.default
const KITS = [
  { test: /lesson|\bclass period|curriculum/, lanes: ['Activity bank', 'Warm-up', 'Main activity', 'Practice', 'Exit ticket'], limits: { 1: 5, 2: 5, 3: 5, 4: 5 }, ordered: false, list: 'categories',
    cards: () => ['Think-pair-share', 'Mini whiteboard quiz', 'Reading circle', 'Vocabulary match', 'Worked example', 'Gallery walk', 'One-minute summary'] },
  { test: /married|wedding/, lanes: ['Not started', 'Someone owns it', 'Stuck', 'Done'], limits: { 1: 4 }, ordered: false,
    cards: () => ['Book the caterer', 'Finalize the guest list', 'Order flowers', 'Book the band', 'Send invitations', 'Choose the cake', 'Venue walkthrough'] },
  { test: /\bhir(?:e|ing)|candidate|interview|recruit/, lanes: ['Applied', 'Interviewing', 'Offer'], limits: { 1: 4, 2: 2 }, ordered: true,
    cards: () => ['Sam Lee', 'Priya Shah', 'Marco Ruiz', 'Jo Kim', 'Alex Chen', 'Nia Okafor'] },
  { test: /\bhaiku|\bpoem|poetry|\bverses?\b/, lanes: ['Word bank', 'Line one', 'Line two', 'Line three'], limits: { 1: 4, 2: 5, 3: 4 }, ordered: false,
    cards: () => ['Old pond', 'A frog leaps', 'Splash of water', 'Autumn moon', 'Silent', 'Cherry blossoms', 'Evening wind', 'Falling'] },
  { test: /\bband\b|setlist|set list|\bgig\b|\bsongs?\b|concert/, lanes: ['Song bank', 'First set', 'Second set', 'Encore'], limits: { 3: 2 }, ordered: false,
    cards: () => ['Johnny B. Goode', 'Brown Eyed Girl', 'Proud Mary', 'Superstition', 'Stand by Me', 'Twist and Shout', 'Mustang Sally', 'Sweet Caroline'] },
  { test: /flash ?cards?|vocab|\bwords? (?:list|cards?)\b|\bvocabulario|\bvokabeln/, lanes: ['New words', 'Learning', 'Review', 'Known'], limits: { 1: 5 }, ordered: true,
    cards: ({ text }) => lang(text, {
      'spanish|español|espanol': ['hola · hello', 'gracias · thank you', 'la casa · house', 'el perro · dog', 'la biblioteca · library', 'correr · to run', 'mañana · tomorrow', 'el agua · water'],
      'french|français|francais': ['bonjour · hello', 'merci · thank you', 'la maison · house', 'le chien · dog', 'la bibliothèque · library', 'courir · to run', 'demain · tomorrow', "l'eau · water"],
      'german|deutsch': ['hallo · hello', 'danke · thank you', 'das Haus · house', 'der Hund · dog', 'die Bibliothek · library', 'laufen · to run', 'morgen · tomorrow', 'das Wasser · water'],
      'italian|italiano': ['ciao · hello', 'grazie · thank you', 'la casa · house', 'il cane · dog', 'la biblioteca · library', 'correre · to run', 'domani · tomorrow', "l'acqua · water"],
      'biology|science|chemistry|physics': ['Photosynthesis', 'Mitosis', 'Osmosis', 'Ecosystem', 'Covalent bond', "Newton's first law", 'Evaporation', 'Enzyme'],
      default: ['Ubiquitous', 'Ephemeral', 'Candid', 'Meticulous', 'Resilient', 'Ambiguous', 'Benevolent', 'Concise'],
    }) },
  { test: /invest|portfolio (?:rebalanc|allocation|tracker)|\bstocks?\b|rebalanc|\betfs?\b|index funds?/, lanes: ['Holdings', 'Over target', 'Under target', 'Rebalanced'], limits: {}, ordered: false,
    cards: () => ['US total market fund', 'International stocks', 'Bond index fund', 'Real estate (REIT)', 'Emerging markets', 'Cash reserve', 'Tech sector ETF'] },
  { test: /budget|expenses?|spending|\bbills\b|finances/, lanes: ['Unplanned', 'This month', 'Paid'], limits: {}, ordered: true,
    cards: () => ['Rent', 'Groceries', 'Electricity', 'Phone plan', 'Car insurance', 'Savings transfer', 'Eating out', 'Gym membership'] },
  { test: /workout|exercise|\bgym\b|fitness|training plan|\bruns?\b.*week/, lanes: ['Exercise bank', 'Today', 'Done'], limits: { 1: 5 }, ordered: true,
    cards: () => ['Squats', 'Push-ups', 'Plank', 'Walking lunges', 'Deadlifts', 'Jump rope', 'Cool-down stretch'] },
  { test: /garden|\bhorta|planting|\bseeds?\b|sementes|vegetables/, lanes: ['Seeds', 'Seedlings', 'In the bed', 'Harvested'], limits: {}, ordered: true, list: 'flow',
    cards: ({ text }) => (/horta|sementes|canteiro|colheita/.test(text) ? ['Tomate', 'Manjericão', 'Alface', 'Cenoura', 'Abobrinha', 'Pimentão'] : ['Tomatoes', 'Basil', 'Lettuce', 'Carrots', 'Zucchini', 'Bell peppers']) },
  { test: /hoard|treasure|\bloot\b|inventory/, lanes: ['Unsorted', 'Shiniest', 'Bedroom pile', 'Cursed vault'], limits: { 2: 5 }, ordered: false,
    allowed: { 'Cursed amulet': [0, 3], 'Hexed goblet': [0, 3] },
    cards: () => ['Gold crown', 'Ruby ring', 'Pearl necklace', 'Cursed amulet', 'Tarnished shield', 'Jeweled dagger', 'Hexed goblet'] },
  { test: /\blunch|takeout|take-out|food order|order run/, lanes: ['Menu', 'This order run', 'Ordered'], limits: { 1: 6 }, ordered: true,
    cards: () => ['Margherita pizza', 'Cheeseburger', 'Chicken tacos', 'Caesar salad', 'Veggie wrap', 'Pad thai', 'Sushi combo'] },
  { test: /restaurant|\bmenu\b|entr[ée]es|desserts|\bplats\b/, lanes: ['Dish ideas', 'Starters', 'Mains', 'Desserts'], limits: { 1: 3, 2: 3, 3: 3 }, ordered: false, list: 'categories',
    cards: () => ['Soupe à l’oignon', 'Salade niçoise', 'Bœuf bourguignon', 'Coq au vin', 'Ratatouille', 'Crème brûlée', 'Tarte Tatin', 'Mousse au chocolat'] },
  { test: /\brecipe|ingredient/, lanes: ['Pantry', 'Recipe card', 'Ready to print'], limits: { 1: 8 }, ordered: true,
    cards: () => ['Flour', 'Eggs', 'Butter', 'Sugar', 'Preheat the oven', 'Mix the dry ingredients', 'Bake for 25 minutes', 'Serves four'] },
  { test: /grocer|shopping list/, lanes: ['Need', 'In the cart', 'Bought'], limits: {}, ordered: true,
    cards: () => ['Milk', 'Eggs', 'Sourdough bread', 'Apples', 'Coffee beans', 'Spinach', 'Olive oil'] },
  { test: /\bmeals?\b|dinner|breakfast/, lanes: ['Meal ideas', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'], limits: { 1: 1, 2: 1, 3: 1, 4: 1 }, ordered: false,
    cards: () => ['Tacos', 'Pasta bake', 'Vegetable stir-fry', 'Soup and bread', 'Salmon and rice', 'Pizza night'] },
  { test: /\bfraction|manipulative|\bhalves|\bthirds|\bquarters/, lanes: ['Tile bank', 'Build a whole', 'Checked'], limits: { 1: 4 }, ordered: true,
    cards: () => ['One half', 'One third', 'One quarter', 'One sixth', 'One eighth', 'Whole bar'] },
  { test: /\bchore/, lanes: ['Chore jar', 'Maya', 'Leo', 'Ava', 'Done'], limits: { 1: 2, 2: 2, 3: 2 }, ordered: false,
    cards: () => ['Feed the cat', 'Empty the dishwasher', 'Water the plants', 'Take out recycling', 'Make the beds', 'Fold laundry', 'Sweep the porch'] },
  { test: /classroom jobs|\bjobs?\b.*\b(kids?|students?|class)\b|line leader/, lanes: ['Bench', 'Line leader', 'Door holder', 'Plant waterer', 'Librarian'], limits: { 1: 1, 2: 1, 3: 1, 4: 1 }, ordered: false,
    cards: () => ['Mia', 'Jamal', 'Sofia', 'Ethan', 'Priya', 'Noah', 'Lucia'] },
  { test: /volunteer|\bshifts?\b|roster|sign-?up/, lanes: ['Available', 'Morning shift', 'Afternoon shift'], limits: { 1: 4, 2: 4 }, ordered: false,
    cards: () => ['Rosa', 'Malik', 'Jen', 'Tomás', 'Aisha', 'Pedro', 'Lena', 'Sam'] },
  { test: /\bseat|\bdesk/, lanes: ['Unassigned', 'Table one', 'Table two'], limits: { 1: 4, 2: 4 }, ordered: false,
    cards: () => ['Ava', 'Ben', 'Chloe', 'Diego', 'Emma', 'Farah', 'Gus', 'Hana'] },
  { test: /\bretro|went well|to improve/, lanes: ['Went well', 'To improve', 'Action items'], limits: { 2: 3 }, ordered: false,
    cards: () => ['Fast code reviews', 'Flaky tests', 'Unclear priorities', 'Great pairing', 'Smooth release', 'Too many meetings'] },
  { test: /card sort|help (?:center|centre)|\barticles\b|\btopics\b/, lanes: ['Unsorted topics', 'Account', 'Billing', 'Troubleshooting'], limits: {}, ordered: false,
    cards: () => ['Reset your password', 'Update payment method', 'Download invoices', 'Fix sync errors', 'Invite teammates', 'Cancel a subscription', 'Change your email'] },
  { test: /\blaunch(?:ing)?\b.*\b(?:feature|product|marketing)|\b(?:feature|product) launch/, lanes: ['To do', 'In progress', 'Blocked', 'Done'], limits: { 1: 3 }, ordered: false,
    cards: () => ['Launch blog post', 'Demo video', 'Sales deck', 'Support docs', 'Fix release bugs', 'Pricing page update', 'Press email'] },
  { test: /\bbug|triage|\bissues?\b|tickets?|support queue/, lanes: ['New', 'Triaged', 'Fixed'], limits: { 1: 5 }, ordered: true, list: 'categories',
    cards: () => ['Sign-in fails on Safari', 'Crash when saving offline', 'Typo on the pricing page', 'Slow search results', 'Export drops images'] },
  { test: /\bsales|\bleads?\b|\bdeals?\b|\bcrm\b|prospects?/, lanes: ['Lead', 'Contacted', 'Proposal sent', 'Won'], limits: { 2: 5 }, ordered: true,
    cards: () => ['Acme Corp', 'Northwind Traders', 'Globex', 'Blue Harbor Cafe', 'Summit Dental', 'Riverside Gym'] },
  { test: /\bbracket|tournament/, lanes: ['First round', 'Semifinals', 'Final'], limits: { 1: 4, 2: 2 }, ordered: true,
    cards: () => ['Falcons', 'Tigers', 'Sharks', 'Wolves', 'Comets', 'Rockets', 'Bears', 'Hawks'] },
  { test: /board game|card game|\bdeck\b|hand limit/, lanes: ['Deck', 'Hand', 'Played', 'Discard'], limits: { 1: 5 }, ordered: true,
    cards: () => ['Draw two', 'Skip a turn', 'Swap hands', 'Wild card', 'Double move', 'Reverse order', 'Steal a point'] },
  { test: /conference|\btalks\b|agenda|speakers?/, lanes: ['Talk pool', 'Morning', 'Afternoon', 'Evening'], limits: { 1: 3, 2: 3, 3: 3 }, ordered: false, list: 'categories',
    cards: () => ['Keynote: the year ahead', 'Scaling design systems', 'Hands-on accessibility', 'Live demo: data pipelines', 'Panel on remote teams', 'Lightning talks', 'Closing fireside chat'] },
  { test: /\bhabit/, lanes: ['Not yet', 'Done today', 'Skipped'], limits: {}, ordered: false,
    cards: () => ['Drink water', 'Read 20 minutes', 'Walk outside', 'Stretch', 'Journal', 'No screens after ten'] },
  { test: /\bpack(?:ing)?\b|camping|\btrip\b|travel/, lanes: ['To pack', 'Packed', 'In the car'], limits: {}, ordered: true,
    cards: () => ['Tent', 'Sleeping bag', 'Headlamp', 'Water filter', 'First aid kit', 'Rain jacket'] },
  { test: /umzug|moving (?:house|home|day|boxes)|\bmove (?:out|in|house)\b|\bmovers?\b|relocat/, lanes: ['To pack', 'Labeled', 'In the van', 'Unpacked'], limits: {}, ordered: true, list: 'flow',
    cards: ({ text }) => (/umzug|kisten|auspacken/.test(text) ? ['Küche', 'Bücher', 'Winterkleidung', 'Badezimmer', 'Spielzeug', 'Werkzeug'] : ['Kitchen dishes', 'Books', 'Winter clothes', 'Bathroom supplies', 'Toys', 'Tools']) },
  { test: /\bread(?:ing)? list|\bbooks?\b/, lanes: ['Want to read', 'Reading now', 'Finished'], limits: { 1: 2 }, ordered: true,
    cards: () => ['Project Hail Mary', 'The Overstory', 'Educated', 'Dune', 'Atomic Habits', 'The Hobbit'] },
  { test: /\bparty|birthday|\bevent/, lanes: ['Ideas', 'Booked', 'Done'], limits: { 1: 4 }, ordered: true,
    cards: () => ['Venue', 'Guest list', 'Invitations', 'Food and drinks', 'Music', 'Decorations', 'Cake'] },
  { test: /\bcomic/, lanes: ['Characters and bubbles', 'Panel layout', 'Ready to print'], limits: { 1: 6 }, ordered: true,
    cards: () => ['Captain Comet', 'Robot sidekick', 'Speech bubble', 'Thought bubble', 'Shout bubble: Bam!', 'City skyline backdrop', 'Narration box'] },
  { test: /\bstory|\bscenes?\b|\bpanels?\b|\bad\b|\bvideo\b/, lanes: ['Scene pool', 'Sequence', 'Final cut'], limits: { 1: 6 }, ordered: true, list: 'categories',
    cards: () => ['Opening shot', 'The problem', 'Product reveal', 'Customer smile', 'Logo and tagline'] },
  { test: /mood ?board|\bbrand/, lanes: ['Inspiration', 'Color', 'Type', 'Imagery'], limits: {}, ordered: false, list: 'categories',
    cards: () => ['Warm coral swatch', 'Deep navy swatch', 'Geometric sans headline', 'Serif body text', 'Sunlit office photo', 'Hand-drawn texture'] },
  { test: /science fair|hypothesis|experiment/, lanes: ['Step cards', 'In order', 'Checked'], limits: { 1: 5 }, ordered: true,
    cards: () => ['Ask a question', 'Form a hypothesis', 'Run the experiment', 'Record results', 'Draw a conclusion'] },
  { test: /試験|勉強|\bstudy|\bexams?\b|finals|revision/, lanes: ['Not started', 'Studying', 'Review', 'Done'], limits: { 1: 3 }, ordered: true, list: 'flow',
    cards: ({ text }) => (/[぀-ヿ一-鿿]/.test(text) ? ['数学', '英語', '歴史', '理科', '国語', '地理'] : ['Algebra review', 'Biology chapter 4', 'Essay outline', 'Chemistry practice test', 'History timeline', 'Spanish vocabulary']) },
  { test: /\btareas?\b|deberes/, lanes: ['Pendientes', 'En progreso', 'Terminadas'], limits: { 1: 3 }, ordered: true, list: 'flow',
    cards: () => ['Leer el capítulo 3', 'Ejercicios de matemáticas', 'Proyecto de ciencias', 'Redacción en inglés', 'Mapa de geografía', 'Estudiar vocabulario'] },
  { test: /\brooms?\b|floor plan|\bhouse|apartment/, lanes: ['Unplaced rooms', 'Ground floor', 'Upstairs'], limits: { 1: 4, 2: 4 }, ordered: false,
    cards: () => ['Kitchen', 'Living room', 'Bedroom', 'Bathroom', 'Office', 'Hallway'] },
  { test: /\bpodcast|\bblog|newsletter|content calendar|social posts?/, lanes: ['Ideas', 'Drafting', 'Scheduled', 'Published'], limits: { 1: 3 }, ordered: true,
    cards: () => ['Guest interview: a founder story', 'Listener questions', 'Behind the scenes', 'Top five tools', 'Myth-busting episode', 'Year in review'] },
  { test: /\b(?:laptops?|phones?|cars?|apartments?|cameras?|headphones)\b/, lanes: ['Considering', 'Shortlist', 'Chosen'], limits: { 1: 3, 2: 1 }, ordered: true,
    cards: ({ text }) => lang(text, {
      laptop: ['MacBook Air 13', 'Dell XPS 13', 'ThinkPad X1 Carbon', 'Framework Laptop 13', 'Surface Laptop', 'ASUS Zenbook 14'],
      phone: ['iPhone 16', 'Pixel 9', 'Galaxy S25', 'iPhone SE', 'Pixel 9a', 'Nothing Phone 3'],
      car: ['Toyota RAV4 Hybrid', 'Honda Civic', 'Tesla Model 3', 'Mazda CX-5', 'Subaru Outback', 'Kia EV6'],
      apartment: ['Two-bed near the park', 'Downtown studio', 'Loft by the river', 'Garden flat', 'Top floor with a balcony', 'Townhouse share'],
      camera: ['Sony A7 IV', 'Fujifilm X-T5', 'Canon R6 II', 'Nikon Z6 III', 'Ricoh GR III', 'Panasonic S5 II'],
      default: ['Sony WH-1000XM5', 'Bose QC Ultra', 'AirPods Max', 'Sennheiser Momentum 4', 'Anker Space One', 'Beats Studio Pro'],
    }) },
  { test: /\bwine|tasting/, lanes: ['To taste', 'Tasted', 'Favorites'], limits: { 2: 3 }, ordered: true,
    cards: () => ['Pinot Noir', 'Sauvignon Blanc', 'Malbec', 'Chardonnay', 'Rioja', 'Prosecco', 'Riesling'] },
  { test: /\bprint|worksheet|handout|flyer|poster|\bpages?\b/, lanes: ['Pieces', 'Compose', 'Ready to print'], limits: { 1: 6 }, ordered: true,
    cards: ({ noun, text }) => (/\bmath|worksheet/.test(text)
      ? ['Addition drill', 'Fraction strip', 'Word problem', 'Number line', 'Times table grid', 'Answer box', 'Name and date line', 'Title banner']
      : [`Square ${noun}`, `Triangle ${noun}`, `Hexagon ${noun}`, 'Half-width strip', 'Title banner', 'Text box', 'Image frame', 'Page margins']) },
  { test: /puzzle|jigsaw/, lanes: ['Loose pieces', 'Top row', 'Bottom row'], limits: { 1: 2, 2: 2 }, ordered: false,
    allowed: { 'Barn roof (top left)': [0, 1], 'Blue sky (top right)': [0, 1], 'Green field (bottom left)': [0, 2], 'Duck pond (bottom right)': [0, 2] },
    cards: () => ['Barn roof (top left)', 'Blue sky (top right)', 'Green field (bottom left)', 'Duck pond (bottom right)', 'Spare edge with a fence'] },
  { test: /\blego|\bbricks?\b/, lanes: ['Unsorted', 'Small', 'Large', 'Plates and slopes'], limits: {}, ordered: false,
    cards: () => ['Red 2x4', 'Blue 1x2', 'Yellow 2x2', 'Green 1x1 round', 'Gray 1x6 plate', 'Red slope 45°', 'Black arch'] },
  { test: /\bblocks?\b|\btiles?\b|\bpieces?\b|\bshapes?\b|\bmodules?\b|\bparts?\b|bill of materials/, lanes: ['Tray', 'Build', 'Finished'], limits: { 1: 6 }, ordered: true,
    cards: ({ noun, text }) => (/bookshel|shelf|wood|furniture|bill of materials/.test(text)
      ? ['Side panel (2)', 'Shelf board (4)', 'Back panel', 'Wood screws', 'Shelf pins', 'Wood glue', 'Sandpaper']
      : [`Square ${noun}`, 'Long bar', 'L-shaped corner', 'Edge strip', 'Center plate', 'Connector peg']) },
  { test: /\bkanban|\btasks?\b|\bsprint|\bprojects?\b|\blaunch|\bwork\b|\bteam\b|\bokrs?\b|monday|weekly/, lanes: ['Backlog', 'In progress', 'In review', 'Done'], limits: { 1: 3, 2: 2 }, ordered: true,
    cards: ({ text }) => (/\bokrs?\b|objectives?|key results?/.test(text)
      ? ['Grow weekly active users 20%', 'Cut support response to 4 hours', 'Launch the mobile app', 'Hire two engineers', 'Raise NPS to 50', 'Reduce churn below 3%']
      : ['Write the brief', 'Design review', 'Fix open bugs', 'Update the docs', 'Prepare the demo', 'Share release notes']) },
]

// Lane words: a list made of these is where cards go, not the cards.
const STAGES = /^(to ?do|doing|done|in progress|in review|review|backlog|pending|pendientes|en progreso|terminadas|finished|ready|packed|to pack|in the car|ordered|needed|in hand|shortlist|chosen|considering|applied|offer|draft|committed|achieved|morning|afternoon|evening|beginning|middle|end|not yet|skipped|done today|went well|to improve|action items|now|next|later|someday|want to read|reading now|deck|hand|played|discard|[^ ]+ (?:soon|today))$/i
const LIST_SPLIT = /\s*(?:,|;|\/|、|，|・|\band\b|\bor\b|\by\b|\be\b|\bet\b|\bund\b|\boder\b|\bou\b)\s*/i
// Words that say a list is where cards go ("severity lanes: …", "drag talks into …", "… sections").
const LANE_WORDS = /\b(?:lanes?|columns?|sections?|slots?|categories|buckets|piles|groups|into|onto)\b/i
// A list item that states a limit, not a place or a piece ("three talks per slot", "trois choix maximum par section").
const LIMIT_ITEM = /\b(?:per|each|max(?:imum)?|at most|par|por|pro)\b/i

/** The items a description lists ("…: kitchen, two bedrooms, bath, living room"), 2 to 12 short ones, or []. */
export function listedItems(message) {
  const text = words(message)
  const after = text.match(/[:：]\s*(.+)$/)?.[1] ?? (text.match(/,/g)?.length >= 2 ? text : '')
  if (!after) return []
  let items = after.replace(/[.!?。]+$/, '').split(LIST_SPLIT).map((item) => item.trim()).filter((item) => item && !(LIMIT_ITEM.test(item) && new RegExp(`\\b${NUMBER}\\b`, 'i').test(item)))
  // No colon: the first item is the sentence that leads into the list ("sprint retro with voting, went well, …").
  // Its last words may be the first item ("… with color, type and imagery"), unless the rest are stages and it is none.
  if (after === text && items[0]?.split(' ').length >= 3) {
    const lead = items[0].match(/\b(?:with|including|like)\s+(.+)$/i)?.[1]
    const rest = items.slice(1)
    items = lead && lead.split(' ').length <= 3 && !(rest.filter((item) => STAGES.test(item)).length >= 2 && !STAGES.test(lead)) ? [lead, ...rest] : rest
  }
  if (items.length < 2 || items.length > 12) return []
  const short = items.every((item) => item.split(' ').length <= 4 && item.length <= 40)
  // "drag scenes into beginning, middle and end": the first item's lead-in is not part of it; "exit ticket each day",
  // "evening slots": nor is a trailing "each day" or the word for the lanes.
  const clean = (item) => cap(item.replace(/^.*\b(?:into|onto)\s+/i, '').replace(/^(?:a|an|the)\s+/i, '').replace(/\s+(?:each|every|per)\s+\S+$/i, '').replace(/\s+(?:slots?|sections?|lanes?|columns?)$/i, ''))
  return short ? [...new Set(items.map(clean).filter(Boolean))] : []
}

/**
 * The lanes a description walks cards through, in its own words: "from considering to shortlist (max 3) to chosen
 * (just one)", "design before build, build before test, test before launch". → [{ label, limit? }] (3 to 5) or [].
 */
export function flowLanes(message) {
  const text = words(message)
  const from = text.match(/\bfrom\s+(.+?)(?:[.;!?]|$)/i)?.[1]
  if (from) {
    const parts = from.split(/\s+to\s+/i)
    if (parts.length >= 3 && parts.length <= 5) {
      const lanes = parts.map((part) => {
        const limit = part.match(/\(([^)]*)\)/)?.[1]
        const label = part.replace(/\([^)]*\)/g, '').replace(/^(?:the|a|an)\s+/i, '').trim()
        const n = limit ? (limit.toLowerCase().match(new RegExp(NUMBER))?.[1]) : null
        return { label: cap(label), ...(n && { limit: toNumber(n) }) }
      })
      if (lanes.every((lane) => lane.label && lane.label.split(' ').length <= 3)) return lanes
    }
  }
  const chain = [...text.matchAll(/\b([\p{L}-]+)\s+before\s+([\p{L}-]+)/giu)]
  if (chain.length >= 2) {
    const order = []
    for (const [, a, b] of chain) for (const step of [a, b]) if (!order.includes(step.toLowerCase())) order.push(step.toLowerCase())
    if (order.length >= 3 && order.length <= 5) return order.map((label) => ({ label: cap(label) }))
  }
  return []
}

// When no kit fits and nothing is listed: a working triage set, never the description's own words handed back.
const TRIAGE = ['Top priority', 'Quick win', 'Waiting on someone', 'Needs a decision', 'Nice to have', 'Someday']

const slug = (label, index, prefix) => {
  const ascii = label.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return /^[a-z]/.test(ascii) ? ascii : `${prefix}-${index + 1}`
}
const uniqueIds = (labels, prefix) => {
  const used = new Set()
  return labels.map((label, index) => {
    let id = slug(label, index, prefix)
    while (used.has(id)) id = `${prefix}-${index + 1}-${used.size}`
    used.add(id)
    return id
  })
}

/**
 * The starter board for a description, when no agent drafts it, built deterministically from its words: the kind of
 * component its nouns name (a kit: a band setlist is songs in sets, Spanish flashcards are word cards moving from
 * Learning to Known, printable pieces, a seating chart …, cards named with the description's own word for a piece),
 * the lanes it walks cards through ("from draft to committed to achieved"), the items it lists (as the cards, or as
 * the lanes when they are stages or places: "to pack, packed, in the car", "severity lanes: critical, major …") and
 * the one limit it states ("max 6 per order run"). Lanes in the order cards move, with limits on the working lanes
 * (never on the lane finished work goes to) and, for a flow, a one-step rule. With no kit and no list, a triage set:
 * never the description's own words handed back as cards. Named after the words; the chat renames, adds and reshapes
 * from here. `now` stamps the rules.
 */
export function componentStarter(message, { now = new Date(), by = 'Slatebox' } = {}) {
  const text = words(message).toLowerCase()
  const noun = pieceNoun(message).toLowerCase()
  const kit = KITS.find((item) => item.test.test(text))
  const flow = flowLanes(message)
  const listed = flow.length ? [] : listedItems(message)
  const stages = listed.length >= 2 && listed.length <= 5 && listed.filter((item) => STAGES.test(item)).length * 2 >= listed.length
  const into = /\b(?:into|onto)\b/i.test(text)
  const placesListed = listed.length >= 2 && listed.length <= 4 && (into || (!stages && (LANE_WORDS.test(text) || kit?.list === 'categories')))
  let lanes = kit?.lanes ?? ['To sort', 'In use', 'Done']
  let cards = kit?.cards({ noun, text }) ?? []
  let limits = { ...(kit?.limits ?? { 1: 4 }) }
  let ordered = kit?.ordered ?? true
  const stated = statedLimit(message)
  if (flow.length) {
    lanes = flow.map((lane) => lane.label)
    ordered = true
    limits = Object.fromEntries(flow.map((lane, index) => [index, lane.limit]).filter(([index, n]) => n && Number(index) > 0))
    if (!Object.keys(limits).length && lanes.length >= 3) limits = { 1: stated ?? 4 }
  } else if (!placesListed && (stages || (kit?.list === 'flow' && listed.length >= 3 && listed.length <= 5))) {
    // The kit's own lanes, listed in other words or another order, keep the kit's limits and flow.
    const same = kit && listed.length === kit.lanes.length && listed.every((item) => kit.lanes.some((lane) => lane.toLowerCase() === item.toLowerCase()))
    lanes = listed
    if (same) limits = Object.fromEntries(Object.entries(kit.limits).map(([index, max]) => [listed.findIndex((item) => item.toLowerCase() === kit.lanes[index].toLowerCase()), max]))
    else {
      ordered = true
      limits = lanes.length >= 3 ? { 1: stated ?? 4 } : {}
    }
  } else if (placesListed) {
    // The listed places are the working lanes, after the kit's first lane (where cards wait).
    const source = listed.find((item) => item.toLowerCase() === lanes[0].toLowerCase() || /^(?:not yet|to do|to sort|backlog|unsorted)$/i.test(item))
    lanes = (source ? [source, ...listed.filter((item) => item !== source)] : [lanes[0], ...listed]).slice(0, 5)
    ordered = false
    const each = stated ?? Object.values(kit?.limits ?? {})[0]
    limits = each ? Object.fromEntries(lanes.slice(1).map((_, index) => [index + 1, each])) : {}
  } else {
    if (listed.length) cards = listed
    if (stated) {
      // The stated limit holds on the lanes the kit already limits, else on the working lanes between first and last.
      const capped = Object.keys(limits).length ? Object.keys(limits) : lanes.map((_, index) => String(index)).slice(1, -1)
      limits = Object.fromEntries(capped.map((index) => [index, stated]))
    }
  }
  if (!cards.length) cards = TRIAGE
  if (cards.length < 3) cards = [...cards, ...TRIAGE.filter((label) => !cards.includes(label))].slice(0, Math.max(4, cards.length))
  cards = cards.slice(0, 12)
  const laneIds = uniqueIds(lanes, 'lane')
  const cardIds = uniqueIds(cards, noun || 'piece')
  const set = { by, at: new Date(now).toISOString(), via: 'preset' }
  // A limit fits the cards that start in its lane (all start in the first), and never sits on the last lane of a flow.
  const rules = Object.entries(limits).filter(([index, max]) => Number(index) > 0 && Number(index) < lanes.length && max >= 1 && !(ordered && Number(index) === lanes.length - 1 && lanes.length >= 3 && FINISHED.test(lanes[index])))
    .map(([index, max]) => ({ id: `${laneIds[index]}-holds`.slice(0, 60), kind: 'capacity', where: laneIds[index], max: Math.min(24, max), on: true, severity: 'refuse', set }))
  if (ordered && lanes.length >= 3) rules.push({ id: 'one-step', kind: 'path', from: 'any', noSkip: true, on: true, severity: 'refuse', set })
  const allowed = kit && !flow.length && !stages && !placesListed ? kit.allowed ?? {} : {}
  // A board cards are sorted on, with no limit: once sorted, a card moves between the sorted lanes, never back to wait.
  if (!rules.length && !ordered && lanes.length >= 3) {
    for (let index = 1; index < lanes.length; index++) rules.push({ id: `path-${laneIds[index]}`.slice(0, 60), kind: 'path', from: laneIds[index], to: laneIds.filter((id, other) => other > 0 && other !== index), on: true, severity: 'refuse', set })
  }
  return {
    version: 1,
    title: builderTitle(message),
    lanes: lanes.map((label, index) => ({ id: laneIds[index], label: label.slice(0, 80) })),
    cards: cards.map((label, index) => ({ id: cardIds[index], label: label.slice(0, 80), laneId: laneIds[0],
      ...(allowed[label] && { allowedLaneIds: allowed[label].filter((i) => i < lanes.length).map((i) => laneIds[i]) }) })),
    behaviour: { version: 1, rev: 1, rules: rules.length ? rules : [{ id: 'one-step', kind: 'path', from: 'any', noSkip: true, on: true, severity: 'refuse', set }] },
  }
}

/**
 * The board a description makes: the agent's draft when it holds together as a board of plain lanes (validateWorkshop,
 * the one gate) and, once its unambiguous slips are repaired (repairComponent), passes the quality gate
 * (componentQuality); else the starter built from the words. `drafted` says which, so the preview never claims a
 * draft it threw away; `repairs` what was repaired.
 */
export function builderBoard(draft, message, options = {}) {
  if (draft) {
    try {
      const valid = validateWorkshop(draft)
      if (!valid.kind && !valid.experience && !valid.lanes.some((lane) => lane.station)) {
        const { workshop, repairs } = repairComponent(valid, { message })
        if (!componentQuality(workshop, { message }).length) return { workshop, drafted: true, repairs }
      }
    } catch { /* the starter below */ }
  }
  return { workshop: validateWorkshop(componentStarter(message, options)), drafted: false, repairs: [] }
}

/**
 * What the preview says of a board made from a description: drafted by the agent, or started here. `guest`: a visitor
 * not signed in, told plainly that signing in lets the agent draft it from their words.
 */
export function builderSaid(workshop, { drafted, guest = false }) {
  const lanes = workshop.lanes.map((lane) => lane.label)
  const list = lanes.length > 1 ? lanes.slice(0, -1).join(', ') + ' and ' + lanes.at(-1) : lanes[0]
  const pieces = workshop.cards.length
  const made = `“${workshop.title}” from your description: ${list}, with ${pieces} ${pieces === 1 ? 'piece' : 'pieces'} to drag.`
  if (drafted) return `Drafted ${made} Change anything by saying it, or drag the controls on the board.`
  if (guest) return `Started ${made} This is a starter from your words: sign in and the agent drafts the whole component for you.`
  return `Started ${made} Rename the lanes and pieces, or change the rules, by saying it.`
}
