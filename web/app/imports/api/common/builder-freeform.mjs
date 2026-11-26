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
  'stage', 'group', 'section', 'brick', 'other', 'misc', 'untitled', 'label', 'text', 'name'])
const tokens = (text) => String(text ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
const singular = (word) => (word.length > 3 && /s$/.test(word) && !/ss$/.test(word) ? word.replace(/(?<=[^aeiou]|[aeiou]{2})es$|s$/, '') : word)

/** Whether a card's label is only a phrase the board already says (its title, a lane, the words, a generic noun) and a number or letter. */
export function placeholderLabel(label, known = new Set()) {
  const parts = tokens(label)
  if (!parts.length) return true
  const last = parts.at(-1)
  if (!/^\d{1,3}$/.test(last) && !/^[a-z]$/.test(last)) return false
  return parts.slice(0, -1).every((word) => GENERIC.has(singular(word)) || known.has(word) || known.has(singular(word)))
}

const behaves = (workshop) => workshop.lanes.some((lane) => lane.capacity !== undefined) || workshop.cards.some((card) => card.allowedLaneIds) ||
  (workshop.behaviour?.rules ?? []).some((rule) => rule.on) || (workshop.signals ?? []).length > 0
const known = (workshop, message) => new Set([...tokens(message), ...tokens(workshop.title), ...workshop.lanes.flatMap((lane) => tokens(lane.label))].flatMap((word) => [word, singular(word)]))
const quote = (labels) => labels.slice(0, 3).map((label) => `“${label}”`).join(', ')

/**
 * The quality of a smart component (a validated board of lanes): [] when it is a tool someone would use, else what is
 * wrong, one plain sentence each (sent to the drafting agent as is): at least three cards; every card named as the
 * real thing it is, never a lane, title or generic phrase plus a number or letter; no card named twice; and at least
 * one piece of behavior (a lane capacity, allowed lanes on a card, a rule or a signal).
 */
export function componentQuality(workshop, { message = '' } = {}) {
  const problems = []
  const cards = workshop?.cards ?? []
  if (cards.length < 3) problems.push('Give the board at least three cards people will drag.')
  const words = known(workshop, message)
  const placeholders = cards.filter((card) => placeholderLabel(card.label, words)).map((card) => card.label)
  if (placeholders.length) problems.push(`Name every card as the real, specific thing it is: ${quote(placeholders)} ${placeholders.length === 1 ? 'is' : 'are'} only a phrase and a number or letter.`)
  const seen = new Set(), twice = []
  for (const card of cards) {
    const key = tokens(card.label).join(' ')
    if (seen.has(key) && !twice.includes(card.label)) twice.push(card.label)
    seen.add(key)
  }
  // One phrase on every card ("Title square tile 2x2", "Answer square tile 2x2" …): named by the phrase, not the piece.
  const tails = new Map()
  for (const card of cards) {
    const parts = tokens(card.label)
    if (parts.length > 2) { const tail = parts.slice(-2).join(' '); tails.set(tail, (tails.get(tail) ?? 0) + 1) }
  }
  const shared = [...tails].find(([, count]) => cards.length >= 4 && count * 3 > cards.length * 2)
  if (shared) problems.push(`Name each card for what makes it different: ${shared[1]} of ${cards.length} cards end in the same words, “${shared[0]}”.`)
  if (twice.length) problems.push(`Give each card its own name: ${quote(twice)} ${twice.length === 1 ? 'appears' : 'appear'} more than once.`)
  if (workshop?.lanes && !behaves(workshop)) problems.push('Give the board at least one rule: a lane capacity, allowedLaneIds on a card, or a rule such as one-step.')
  return problems
}

/**
 * A drafted board's unambiguous quality slips, repaired: a card named again is left out, and placeholder cards are
 * left out when at least three named cards remain (with any signal about them). Nothing is invented: a board with
 * no behavior, or too few named cards, stays as it is for componentQuality to refuse. → { workshop, repairs }
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
  const named = cards.filter((card) => !placeholderLabel(card.label, words))
  if (named.length < cards.length && named.length >= 3) {
    repairs.push(`left out ${cards.length - named.length} placeholder card(s)`)
    cards = named
  }
  if (!repairs.length) return { workshop, repairs }
  const ids = new Set(cards.map((card) => card.id))
  const out = { ...workshop, cards }
  if (workshop.signals) {
    const signals = workshop.signals.filter((signal) => ids.has(signal.cardId))
    if (signals.length) out.signals = signals
    else delete out.signals
  }
  return { workshop: validateWorkshop(out), repairs }
}

// ---- The starter: a board built from the words, when no agent drafts it ----

// Words a request is made of that name no piece (English, and the most common of the eval's other languages).
const STOP = new Set(`a an the and or but nor of for to in on at by with from into onto over under per each every any all some my our your
their his her its this that these those it i we you they me us them is are be been being was were am can could would should will shall may
might must do does did done have has had so as if then than just like also very really only no not more most less few many much one two three
four five six seven eight nine ten first second third ok okay maybe something thing things stuff way help make makes making made build building
create want need needs let lets get gets put keep use used using drag drags dragged move moves moving snap snaps snapping sort sorting
organize organise plan planning compose composing arrange see show where who what when which while how new board boards lane lanes column
columns tool component smart simple little small big better good best kind type set lot lots im i'm i've there here up down out off
about around after before again each other own same such too can't won't don't etc so-called kinda sorta un una uno unos unas el la los las de
getting cannot teach rotate pick max run open study prototype refresh want wants signup del para por y o e en con le les des du et à pour au aux der die das und für mit zu ein eine em um uma os as do da dos das que`.split(/\s+/))
const PIECE_WORDS = new Set(['piece', 'tile', 'block', 'brick', 'part', 'module', 'shape', 'card', 'token', 'item'])
const cap = (text) => (text ? text[0].toLocaleUpperCase() + text.slice(1) : text)

// Kits: what a kind of component is made of, matched by the words (specific first). Each names its lanes, its cards
// (noun: the word the description uses for its pieces, as pieceNoun reads it), the lane limits, and whether cards move
// through the lanes in order (a one-step rule) or go where they fit.
const KITS = [
  { test: /\brecipe|ingredient/, lanes: ['Pantry', 'Recipe card', 'Ready to print'], limits: { 1: 8 }, ordered: true,
    cards: () => ['Flour', 'Eggs', 'Butter', 'Sugar', 'Preheat the oven', 'Mix the dry ingredients', 'Bake for 25 minutes', 'Serves four'] },
  { test: /\bmeal|dinner|breakfast/, lanes: ['Meal ideas', 'This week', 'Shopping done'], limits: { 1: 7 }, ordered: true,
    cards: () => ['Tacos', 'Pasta bake', 'Vegetable stir-fry', 'Soup and bread', 'Salmon and rice', 'Pizza night'] },
  { test: /\bfraction|manipulative|\bhalves|\bthirds|\bquarters/, lanes: ['Tile bank', 'Build a whole', 'Checked'], limits: { 1: 4 }, ordered: true,
    cards: () => ['One half', 'One third', 'One quarter', 'One sixth', 'One eighth', 'Whole bar'] },
  { test: /\bchore/, lanes: ['Chore jar', 'This week', 'Done'], limits: { 1: 6 }, ordered: true,
    cards: () => ['Feed the cat', 'Empty the dishwasher', 'Water the plants', 'Take out recycling', 'Make the beds', 'Fold laundry'] },
  { test: /\bseat|\bdesk/, lanes: ['Unassigned', 'Table one', 'Table two'], limits: { 1: 4, 2: 4 }, ordered: false,
    cards: () => ['Ava', 'Ben', 'Chloe', 'Diego', 'Emma', 'Farah', 'Gus', 'Hana'] },
  { test: /\bretro|went well|to improve/, lanes: ['Went well', 'To improve', 'Action items'], limits: { 2: 3 }, ordered: false,
    cards: () => ['Fast code reviews', 'Flaky tests', 'Unclear priorities', 'Great pairing', 'Smooth release', 'Too many meetings'] },
  { test: /\bbug|triage|\bissue/, lanes: ['New', 'Triaged', 'Fixed'], limits: { 1: 5 }, ordered: true,
    cards: () => ['Sign-in fails on Safari', 'Crash when saving offline', 'Typo on the pricing page', 'Slow search results', 'Export drops images'] },
  { test: /\bhir(e|ing)|candidate|interview|recruit/, lanes: ['Applied', 'Interviewing', 'Offer'], limits: { 1: 4, 2: 2 }, ordered: true,
    cards: () => ['Sam Lee', 'Priya Shah', 'Marco Ruiz', 'Jo Kim', 'Alex Chen', 'Nia Okafor'] },
  { test: /\bbracket|tournament/, lanes: ['First round', 'Semifinals', 'Final'], limits: { 1: 4, 2: 2 }, ordered: true,
    cards: () => ['Falcons', 'Tigers', 'Sharks', 'Wolves', 'Comets', 'Rockets', 'Bears', 'Hawks'] },
  { test: /\bhabit/, lanes: ['Not yet', 'Done today', 'Skipped'], limits: {}, ordered: false,
    cards: () => ['Drink water', 'Read 20 minutes', 'Walk outside', 'Stretch', 'Journal', 'No screens after ten'] },
  { test: /\bpack(ing)?\b|camping|\btrip\b|travel/, lanes: ['To pack', 'Packed', 'In the car'], limits: {}, ordered: true,
    cards: () => ['Tent', 'Sleeping bag', 'Headlamp', 'Water filter', 'First aid kit', 'Rain jacket'] },
  { test: /\bread(ing)? list|\bbooks?\b/, lanes: ['Want to read', 'Reading now', 'Finished'], limits: { 1: 2 }, ordered: true,
    cards: () => ['Project Hail Mary', 'The Overstory', 'Educated', 'Dune', 'Atomic Habits', 'The Hobbit'] },
  { test: /\bparty|wedding|birthday|\bevent/, lanes: ['Ideas', 'Booked', 'Done'], limits: { 1: 4 }, ordered: true,
    cards: () => ['Venue', 'Guest list', 'Invitations', 'Food and drinks', 'Music', 'Decorations', 'Cake'] },
  { test: /\bstory|\bscenes?\b|\bcomic|\bpanels?\b|\bad\b/, lanes: ['Scene pool', 'Sequence', 'Final cut'], limits: { 1: 6 }, ordered: true,
    cards: () => ['Opening shot', 'The problem', 'Product reveal', 'Customer smile', 'Logo and tagline'] },
  { test: /\brooms?\b|floor plan|\bhouse|apartment/, lanes: ['Unplaced rooms', 'Ground floor', 'Upstairs'], limits: { 1: 4, 2: 4 }, ordered: false,
    cards: () => ['Kitchen', 'Living room', 'Bedroom', 'Bathroom', 'Office', 'Hallway'] },
  { test: /\bprint|worksheet|handout|flyer|poster|\bpages?\b/, lanes: ['Pieces', 'Compose', 'Ready to print'], limits: { 1: 6 }, ordered: true,
    cards: (noun) => [`Square ${noun}`, `Triangle ${noun}`, `Hexagon ${noun}`, 'Half-width strip', 'Title banner', 'Text box', 'Image frame', 'Page margins'] },
  { test: /\blego|\bbricks?\b|\bblocks?\b|\btiles?\b|\bpieces?\b|puzzle|\bshapes?\b|\bmodules?\b|\bparts?\b/, lanes: ['Tray', 'Build', 'Finished'], limits: { 1: 6 }, ordered: true,
    cards: (noun) => [`Square ${noun}`, `Long ${noun}`, `Corner ${noun}`, `Edge ${noun}`, `Center ${noun}`, `Connector ${noun}`] },
  { test: /\bkanban|\btasks?\b|\bsprint|\bproject|\blaunch|\bwork\b|\bteam\b|\bokrs?\b/, lanes: ['Backlog', 'In progress', 'Done'], limits: { 1: 3 }, ordered: true,
    cards: () => ['Write the brief', 'Design review', 'Fix open bugs', 'Update the docs', 'Prepare the demo', 'Share release notes'] },
]

// Lane words: a list made of these is where cards go, not the cards.
const STAGES = /^(to ?do|doing|done|in progress|in review|review|backlog|pending|pendientes|en progreso|terminadas|finished|ready|packed|to pack|in the car|ordered|needed|in hand|shortlist|chosen|applied|offer|draft|committed|achieved|morning|afternoon|evening|beginning|middle|end|not yet|skipped|done today|went well|to improve|action items|now|next|later|someday|want to read|reading now|[^ ]+ (?:soon|today))$/i
const LIST_SPLIT = /\s*(?:,|;|\/|、|，|・|\band\b|\bor\b|\by\b|\be\b|\bet\b|\bund\b|\boder\b|\bou\b)\s*/i

/** The items a description lists ("…: kitchen, two bedrooms, bath, living room"), 2 to 12 short ones, or []. */
export function listedItems(message) {
  const text = words(message)
  const after = text.match(/[:：]\s*(.+)$/)?.[1] ?? (text.match(/,/g)?.length >= 2 ? text : '')
  if (!after) return []
  const items = after.replace(/[.!?。]+$/, '').split(LIST_SPLIT).map((item) => item.trim()).filter(Boolean)
  if (items.length < 2 || items.length > 12) return []
  const short = items.every((item) => item.split(' ').length <= 4 && item.length <= 40)
  // "drag scenes into beginning, middle and end": the first item's lead-in is not part of it.
  return short ? [...new Set(items.map((item) => cap(item.replace(/^.*\b(?:into|onto)\s+/i, '').replace(/^(?:a|an|the)\s+/i, ''))))] : []
}

/** The words of a description that could name pieces (content words, in order, once each, capitalized). */
function contentWords(message) {
  const out = []
  for (const word of tokens(message)) {
    if (word.length < 3 || STOP.has(word) || PIECE_WORDS.has(singular(word)) || /^\d+$/.test(word)) continue
    const label = cap(word)
    if (!out.includes(label)) out.push(label)
  }
  return out
}

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
 * The starter board for a description, when no agent drafts it, built from its words: the items it lists (as the
 * cards, or as the lanes when they are stages: "to pack, packed, in the car"), the kind of component its nouns name
 * (a kit: printable pieces, a seating chart, a recipe card, a retro …, its cards named with the description's own word
 * for a piece), else its own content words as the cards. Lanes in the order cards move, with limits and, for a flow,
 * a one-step rule. Named after the words; the chat renames, adds and reshapes from here. `now` stamps the rules.
 */
export function componentStarter(message, { now = new Date(), by = 'Slatebox' } = {}) {
  const text = words(message).toLowerCase()
  const noun = pieceNoun(message).toLowerCase()
  const kit = KITS.find((item) => item.test.test(text))
  const listed = listedItems(message)
  const stages = listed.length >= 2 && listed.length <= 5 && listed.filter((item) => STAGES.test(item)).length * 2 >= listed.length
  let lanes = kit?.lanes ?? ['To sort', 'In use', 'Done']
  let cards = kit?.cards(noun) ?? []
  let limits = kit?.limits ?? { 1: 4 }
  let ordered = kit?.ordered ?? true
  if (stages) {
    lanes = listed
    limits = lanes.length >= 3 ? { 1: 4 } : {}
  } else if (listed.length) cards = listed
  if (!cards.length) cards = contentWords(message).slice(0, 8)
  // Too few words to name pieces by ("help me organize stuff better"): a triage set, named for what it is.
  if (cards.length < 3) cards = [...cards, ...['Top priority', 'Quick win', 'Waiting on someone', 'Someday'].filter((label) => !cards.includes(label))].slice(0, Math.max(4, cards.length))
  cards = cards.slice(0, 12)
  const laneIds = uniqueIds(lanes, 'lane')
  const cardIds = uniqueIds(cards, noun || 'piece')
  const set = { by, at: new Date(now).toISOString(), via: 'preset' }
  const rules = Object.entries(limits).filter(([index]) => Number(index) < lanes.length && Number(index) > 0)
    .map(([index, max]) => ({ id: `${laneIds[index]}-holds`.slice(0, 60), kind: 'capacity', where: laneIds[index], max, on: true, severity: 'refuse', set }))
  if (ordered && lanes.length >= 3) rules.push({ id: 'one-step', kind: 'path', from: 'any', noSkip: true, on: true, severity: 'refuse', set })
  return {
    version: 1,
    title: builderTitle(message),
    lanes: lanes.map((label, index) => ({ id: laneIds[index], label: label.slice(0, 80) })),
    cards: cards.map((label, index) => ({ id: cardIds[index], label: label.slice(0, 80), laneId: laneIds[0] })),
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
