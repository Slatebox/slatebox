import {
  addWorkshopCard, addWorkshopLane, businessKind, rulebook, startupExperienceKind, validateWorkshop,
  workshopCandidate, workshopCardAsNote, workshopCardAsNoteRefusal, workshopLineRefusal, workshopNewLine, workshopPresentationLanes, workshopRefusal,
  workshopNewCardName, workshopTakesLines, workshopWithLine,
} from 'slateboxjs/workshops/model'
import { N, atMost, count, cuts, finder, listed, named, plainRequest as plain, pointing, said, several, things, unquoted, whole } from './plain-words.mjs'
import { noteRequest, noteRequestProblem } from './note-requests.mjs'
import { cardColours } from './card-colours.mjs'
import { moveAnywayProposal } from './move-anyway.mjs'
import { proposeAppearance } from './board-appearance.mjs'
// The sentences about a board's rules and its business fields (board-chat.mjs): loaded on demand with
// the board's rulebook, and plugged in here when they load, so a plain slate never downloads them.
let boardChat = null
export function useBoardChat(chat) { boardChat = chat }


// The forms Canvas AI is asked to write its edits in. A person never needs them: `change` reads
// a message as a sentence, and these are only some of the sentences it reads.
export const laneEditFormats = [
  'Add lane NAME', 'Add card NAME to LANE', 'Rename board to NAME', 'Rename lane LANE to NAME',
  'Rename card CARD to NAME', 'Set capacity of LANE to N or unlimited', 'Move CARD to LANE',
  'Allow CARD in LANE, LANE', 'Allow CARD in any lane', 'Present LANE first', 'Present LANE after LANE',
  'Set outcome NAME for CARD in LANE: message when present | message when absent',
  'Remove outcome NAME from CARD', 'Set points of CARD to N', 'Set dependencies of CARD to CARD, CARD or none',
  'Remove card CARD', 'Remove lane LANE', 'Connect CARD to CARD', 'Disconnect CARD from CARD',
]

/** A message that is not one of the things a workshop conversation can do. */
function notUnderstood() {
  const error = Error('I did not follow that. I can add, rename, move and remove columns and cards, and set how many cards a column holds.')
  error.code = 'not-understood'
  return error
}

/**
 * A request for ordinary notes on the slate (“add two notes”). Notes and cards are the same thing
 * to a person: a note asked for in a lane is a card there, and one asked for on its own is drawn on
 * the slate beside the workshop. `notes` are their words.
 */
function drawingRequest(labels) {
  const error = Error(labels.length === 1 ? 'Adding a note to the slate.' : 'Adding ' + labels.length + ' notes to the slate.')
  error.code = 'drawing'
  error.notes = labels
  return error
}

// A number of days or weeks (“3 days”, “a week”, “two working days”), and the words for a task's days.
const timeAmount = new RegExp('^' + N + '\\s+(?:working\\s+|business\\s+|calendar\\s+)?(?:days?|weeks?|months?|hours?)(?:\\s+long)?$', 'i')
const timeField = /^(?:the\s+)?(?:duration|length|start(?:\s+date)?|end(?:\s+date)?|due\s+date|deadline)(?:\s+of\s+.+)?$/i

function change(board, message, selection) {
  const release = board.kind === 'release-plan'
  const unit = release ? 'point' : 'card'
  const lanes = finder(board.lanes, 'lanes?|columns?|lists?|stages?|windows?|releases?', 'lane', selection?.kind === 'lane' ? selection.id : undefined, true)
  const cards = finder(board.cards, 'cards?|features?|notes?|items?|tasks?', 'card', selection?.kind === 'card' ? selection.id : undefined)
  const lane = lanes.find, card = cards.find
  const done = (next, reply) => ({ board: next, reply })
  const is = whole(message)
  // The lane or card a name picks, whichever it names more exactly.
  const either = reference => {
    const asCard = cards.attempt(reference), asLane = lanes.attempt(reference)
    if (!asCard || !asLane) return asCard || asLane
    if (cards.rank(reference) !== lanes.rank(reference)) return cards.rank(reference) < lanes.rank(reference) ? asCard : asLane
    throw Error('A lane and a card both match ' + said(unquoted(reference)) + '. Say “the lane ' + asLane.label + '” or “the card ' + asCard.label + '”.')
  }
  // Of the ways to cut a sentence in two, the one whose halves name things most exactly: “Rename
  // Prototype to test to Build next” is about the lane “Prototype to test”, not one that starts “Prototype”.
  const closest = (options, score) => options.map(option => [score(option), option]).filter(([rank]) => rank < Infinity)
    .sort(([a], [b]) => a - b)[0]?.[1]
  const everyCard = '(?:everything|all|it all|all of it|all (?:of )?(?:the |my |our )?(?:cards|features|notes|items|tasks)|every (?:card|feature|note|item|task))'
  // A number of days is never a name, unless it is in quotes: “Change this to 3 days” is about time, not words.
  const daysAsked = to => !/^\s*["'“‘]/.test(to) && timeAmount.test(named(to))
  const plan = board.kind === 'launch-plan' || board.kind === 'hiring-plan'
  const daysRefused = to => Error(plan
    ? 'A task’s name can’t be a number of days. To make it ' + named(to) + ', say “Make this ' + named(to) + '”.'
    : 'Only a plan’s tasks take days. To make ' + said(named(to)) + ' a name, put it in quotes.')
  let m

  // Ordinary notes, unless the request puts them in a lane.
  const notes = noteRequest(message)
  if (notes) {
    const here = selection?.kind === 'lane' && /\s+(?:here|to it|in it)[.!]?$/i.test(message)
    const inLane = cuts(message.replace(/[.!?]+$/, ''), 'to|into|in|under|on').some(([, after]) => lanes.attempt(after))
    if (!here && !inLane) throw drawingRequest(notes.labels)
  }
  const problem = noteRequestProblem(message)
  if (problem) throw Error(problem)

  // A card back to an ordinary note on the canvas: “turn this into a note”, “move this to the canvas”.
  const asNote = '(?:an?\\s+)?(?:(?:regular|ordinary|plain|normal|simple|free|sticky)\\s+)?(?:note|sticky note|sticky|post-?it)(?:\\s+again)?(?:\\s+(?:on|onto)\\s+(?:the\\s+)?(?:canvas|slate))?'
  const offLanes = '(?:out of the lanes|off the lanes|off the board|onto the canvas|to the canvas|on the canvas|onto the slate|to the slate|on the slate)'
  if (((m = is('(?:turn|change|convert|make)\\s+(.+?)\\s+(?:back\\s+)?(?:into|to)\\s+' + asNote)) ||
       (m = is('make\\s+(.+?)\\s+' + asNote)) ||
       (m = is('(?:move|put|take|drag|send|drop)\\s+(.+?)\\s+' + offLanes))) && cards.attempt(m[1]) &&
      !(/off the board$/i.test(message.replace(/[.!]$/, '')) && !/^(?:move|put|drag|send|drop)/i.test(message))) {
    const chosen = cards.attempt(m[1])
    const next = workshopCardAsNote(board, chosen.id)
    if (!next) throw Error(workshopCardAsNoteRefusal(board, chosen.id) ?? 'This card stays on the board.')
    return { board: next, reply: 'Making ' + said(chosen.label) + ' an ordinary note beside the board.', toCanvas: chosen.id }
  }

  // A card's colour.
  const colour = '(' + Object.keys(cardColours).join('|') + ')'
  if (((m = is('(?:make|colou?r|paint|turn|change)\\s+(.+?)\\s+(?:to\\s+|into\\s+)?' + colour)) ||
       (m = is('(?:change|set)\\s+(?:the\\s+)?colou?r\\s+(?:of\\s+)?(.+?)\\s+to\\s+' + colour))) && cards.attempt(m[1])) {
    const chosen = cards.attempt(m[1]), name = m[2].toLowerCase()
    // A board of plain lanes and a business board colour their cards; a release plan's features and a startup
    // experience's cards keep theirs. (A map's chat is map-direct-edits: a card made from a note there takes a colour.)
    if (!((!board.kind || Boolean(businessKind(board))) && !startupExperienceKind(board))) throw Error('The cards of this workshop keep their own colour.')
    const next = { ...board, cards: board.cards.map(item => item.id === chosen.id ? { ...item, look: { ...item.look, backgroundColor: cardColours[name] } } : item) }
    return done(next, 'Coloured ' + said(chosen.label) + ' ' + name + '.')
  }

  // A line between two cards: “connect Alpha to Beta”, “draw a line from Alpha to Beta”, and away again.
  const lineWord = '(?:line|arrow|connector|link)'
  const joinCards = (from, to) => {
    if (!workshopTakesLines(board)) throw Error('Lines join the cards of a lane workshop to notes and to each other. This board keeps the cards it came with.')
    const first = card(from), second = card(to)
    if (first.id === second.id) throw Error('A line joins two different cards.')
    const line = workshopNewLine(board, first.id, second.id)
    const reason = workshopLineRefusal(board, line)
    if (reason) throw Error(reason)
    return done(workshopWithLine(board, line), 'Drew a line from ' + said(first.label) + ' to ' + said(second.label) + '.')
  }
  if (((m = is('(?:connect|join|link)\\s+(.+?)\\s+(?:to|and|with)\\s+(.+)')) ||
       (m = is('(?:draw|add|make)\\s+(?:an?\\s+)?' + lineWord + '\\s+from\\s+(.+?)\\s+to\\s+(.+)'))) && cards.attempt(m[1]) && cards.attempt(m[2])) {
    return joinCards(m[1], m[2])
  }
  if (((m = is('(?:disconnect|unlink|separate)\\s+(.+?)\\s+(?:from|and)\\s+(.+)')) ||
       (m = is('(?:remove|delete|take away|erase|drop)\\s+(?:the\\s+)?' + lineWord + 's?\\s+(?:between|from)\\s+(.+?)\\s+(?:and|to)\\s+(.+)'))) &&
      cards.attempt(m[1]) && cards.attempt(m[2]) && !(board.kind === 'release-plan' && /\blink\b/i.test(message))) {
    const first = card(m[1]), second = card(m[2])
    const between = line => (line.parentId === first.id && line.childId === second.id) || (line.parentId === second.id && line.childId === first.id)
    if (!(board.lines ?? []).some(between)) throw Error(said(first.label) + ' and ' + said(second.label) + ' are not joined by a line.')
    return done({ ...board, lines: board.lines.filter(line => !between(line)) }, 'Took away the line between ' + said(first.label) + ' and ' + said(second.label) + '.')
  }

  // Cards by number, in a lane named or the lane selected: “add three cards to Later”, “add two notes here”.
  const counted = '(?:add|create|make|put)\\s+' + N + '\\s+(?:more\\s+)?(?:new\\s+|blank\\s+|empty\\s+)?(?:cards?|notes?|sticky notes?|stickies|items?|ideas?|tasks?)'
  // “Here” is the lane selected, or the lane of the card selected.
  const hereLane = selection?.kind === 'lane' ? board.lanes.find(item => item.id === selection.id)
    : selection?.kind === 'card' ? board.lanes.find(item => item.id === board.cards.find(c => c.id === selection.id)?.laneId) : undefined
  if (!release && ((m = is(counted + '\\s+(?:to|into|in|under|on)\\s+(.+)')) && lanes.attempt(m[2]) ||
      hereLane && (m = is(counted + '\\s+(?:here|to it|in it)')))) {
    const target = m[2] ? lanes.attempt(m[2]) : hereLane
    const amount = count(m[1])
    // A card without words takes the board's name for a new item (“New card”), as an empty note dropped there does.
    if (amount === 1) {
      if (board.cards.length >= 24) throw Error('A workshop can have up to 24 cards. Remove one first.')
      if (target.capacity !== undefined && board.cards.filter(item => item.laneId === target.id).length >= target.capacity) {
        throw Error(said(target.label) + ' is full: it holds ' + target.capacity + (target.capacity === 1 ? ' card' : ' cards') + '. Add the card to another column, or raise the limit.')
      }
      const unnamed = workshopNewCardName(board)
      return done(addWorkshopCard(board, target.id, { label: unnamed }), 'Added ' + said(unnamed) + ' to ' + said(target.label) + '.')
    }
    if (!(amount >= 2)) throw Error('Say how many cards to add, such as “Add two cards to ' + target.label + '”.')
    if (board.cards.length + amount > 24) throw Error('A workshop can have up to 24 cards. Remove some first.')
    const held = board.cards.filter(item => item.laneId === target.id).length
    if (target.capacity !== undefined && held + amount > target.capacity) {
      throw Error(said(target.label) + ' holds up to ' + target.capacity + (target.capacity === 1 ? ' card' : ' cards') + ' and has ' + held + '. Add fewer, or raise the limit.')
    }
    let next = board
    for (let i = 0; i < amount; i++) next = addWorkshopCard(next, target.id, { label: workshopNewCardName(board) })
    return done(next, 'Added ' + amount + ' cards to ' + said(target.label) + '.')
  }

  // Lanes and cards come and go.
  const another = '(?:(?:a new|another|one more|a|an|new)\\s+)?'
  const cardNoun = '(?:card|note|feature|task|item|idea|ticket|sticky note|sticky|to-?do)'
  if (is('(?:add|create|make|start|new)\\s+' + another + '(?:lane|column|list)')) {
    if (release) throw Error('A release plan keeps the releases it came with. You can rename them and set how many points each holds.')
    throw Error('Give the column a name, such as “Add a column called Later”.')
  }
  if (is('(?:add|create|make|new)\\s+' + another + cardNoun)) {
    if (release) throw Error('A release plan keeps the features it came with. You can rename them, move them and set their points.')
    throw Error('Say which column the card goes in, such as “Add a card to ' + board.lanes[0].label + '”, or what it says: “Add a card called New idea”.')
  }
  if ((m = is('(?:add|create|make|start|new)\\s+(?:(?:a new|another|one more|a|an|new)\\s+)?(?:lane|column|list)(?:\\s+(?:called|named|titled|labell?ed|for))?\\s*[:,-]?\\s+(.+)'))) {
    const limited = new RegExp('^(.+?),?\\s+(?:(?:that|which)\\s+)?(?:holds?|can hold|takes?|with (?:room|space|a limit|a capacity) (?:for|of))\\s+' + atMost + N + things + '$', 'i').exec(m[1])
    const label = named(limited ? limited[1] : m[1])
    if (release) throw Error('A release plan keeps the releases it came with. You can rename them and set how many points each holds.')
    if (board.lanes.length >= 5) throw Error('A workshop can have up to five columns. Remove one first.')
    return done(addWorkshopLane(board, { label, ...(limited && { capacity: count(limited[2]) }) }), 'Added the column ' + said(label) + '.')
  }
  if ((m = is('(?:add|create|make|new|put|write)\\s+' + another + cardNoun + '(?:\\s+(?:(called|named|titled|labell?ed|saying)|for))?\\s*[:,-]?\\s+(.+)'))) {
    return addCard(m[2], Boolean(m[1]))
  }
  // “Add a Done lane”: the name comes first. (A name that holds “to” or “in” is read below, as a card for a lane.)
  if ((m = is('(?:add|create|make|start)\\s+(?:a new|another|one more|a|an|new)\\s+(.+?)\\s+(?:lane|column)')) && !/\b(?:to|in|into|under|on)\b/i.test(m[1])) {
    if (release) throw Error('A release plan keeps the releases it came with. You can rename them and set how many points each holds.')
    if (board.lanes.length >= 5) throw Error('A workshop can have up to five columns. Remove one first.')
    const label = named(m[1])
    return done(addWorkshopLane(board, { label }), 'Added the column ' + said(label) + '.')
  }

  // The workshop's own name.
  const boardWord = '(?:board|workshop|slate|plan|release plan)'
  if ((m = is('(?:rename|retitle)\\s+(?:(?:the|this|my|our)\\s+)?' + boardWord + '\\s+(?:to|as)\\s+(.+)')) ||
      (m = is('(?:call|name|title|rename|retitle)\\s+(?:the|this|my|our)\\s+' + boardWord + '\\s+(.+)')) ||
      (m = is('(?:the|this|my|our)\\s+' + boardWord + '\\s+(?:should|must|needs to)\\s+be\\s+(?:called|named|renamed|titled)\\s+(.+)')) ||
      (m = is('(?:change|set)\\s+(?:the\\s+)?(?:title|name)(?:\\s+of\\s+(?:the|this)\\s+' + boardWord + ')?\\s+to\\s+(.+)')) ||
      (m = is('(?:change|set)\\s+(?:the|this)\\s+' + boardWord + '(?:\'s|’s)?\\s+(?:title|name)\\s+to\\s+(.+)'))) {
    board.title = named(m[1])
    return done(board, 'Renamed the workshop to ' + said(board.title) + '.')
  }

  // How much a lane holds.
  const limitWord = '(?:capacity|limit|budget|maximum|max|cap)'
  const noLimit = '(?:unlimited|none|no limit|nothing|any number|infinite|infinity)'
  if ((m = is('(?:set|change|make|raise|lower)\\s+(?:the\\s+)?' + limitWord + '\\s+(?:of|for|on|in)\\s+(.+?)\\s+(?:to|at)\\s+(?:' + N + things + '|(' + noLimit + '))'))) {
    return setLimit(lane(m[1]), m[3] ? null : count(m[2]))
  }
  if ((m = is('(?:remove|clear|drop|lift|delete)\\s+(?:the\\s+)?' + limitWord + '\\s+(?:on|of|for|from|in)\\s+(.+)')) ||
      (m = is('no\\s+' + limitWord + '\\s+(?:on|for|in)\\s+(.+)')) ||
      (m = is('(?:let\\s+)?(.+?)\\s+(?:can\\s+|should\\s+|may\\s+)?(?:holds?|takes?|have|has)\\s+(?:any number|any amount|unlimited|no limit|as many(?:\\s+cards?)? as (?:you like|it likes|we like|we want|needed|it can))(?:\\s+of)?' + things))) {
    return setLimit(lane(m[1]), null)
  }
  // “A limit of 2 on Now”, “Give Now a limit of 2”, “Now has a limit of 2”, “Now max 2”, “Two cards max in Now”.
  const aLimit = '(?:an?\\s+|the\\s+)?(?:wip\\s+)?' + limitWord + '\\s+of\\s+' + atMost + N + things
  if ((m = is('(?:(?:set|put|add|make|give|have)\\s+)?' + aLimit + '\\s+(?:on|for|in|to)\\s+(.+)')) ||
      (m = is(N + things + '\\s+(?:max|maximum|at most|at the most|tops)\\s+(?:in|for|on)\\s+(.+)')) ||
      (m = is('(?:only\\s+)?allow\\s+' + atMost + N + '\\s+(?:cards?|points?|items?|things?|notes?)\\s+(?:in|on|for)\\s+(.+)'))) {
    return setLimit(lane(m[2]), count(m[1]))
  }
  if ((m = is('give\\s+(.+?)\\s+' + aLimit)) ||
      (m = is('(.+?)\\s+(?:has|gets|should have|needs)\\s+' + aLimit)) ||
      (m = is('(.+?)\\s*:?\\s+(?:max|maximum|limit|cap)\\s*:?\\s+' + N + things)) && lanes.attempt(m[1])) {
    return setLimit(lane(m[1]), count(m[2]))
  }
  const holds = '(?:holds?|can hold|can only hold|should hold|may hold|takes?|can take|can only take|should take|fits?|can fit|can have|can only have|has room for|has space for|is limited to)'
  const atOnce = '(?:\\s+at (?:a|one) time|\\s+at once|\\s+at most|\\s+max)?'
  if ((m = is('(?:let|allow|make|have)\\s+(.+?)\\s+(?:to\\s+)?(?:hold|take|have|fit)\\s+' + atMost + N + things + atOnce)) ||
      (m = is('(.+?)\\s+' + holds + '\\s+' + atMost + N + things + atOnce)) ||
      (m = is('(?:limit|cap)\\s+(.+?)\\s+(?:to|at)\\s+' + atMost + N + things)) ||
      (m = is('(?:increase|raise|lower|decrease|reduce|bump)\\s+(.+?)\\s+(?:to|at)\\s+' + atMost + N + things)) ||
      (m = is('(?:set|change)\\s+(.+?)\\s+(?:to|at)\\s+' + atMost + N + '\\s+(?:cards?|points?|items?)')) && (lanes.attempt(m[1]) || cards.attempt(m[1]))) {
    if (!release && /\bpoints?$/i.test(message.replace(/[.!]$/, '')) && cards.attempt(m[1]) && !lanes.attempt(m[1])) throw Error('This workshop counts cards, not points. You can set how many cards a column holds.')
    // On a release plan “Sign-in takes 3 points” is about a feature, not a release.
    const feature = release && !lanes.attempt(m[1]) && cards.attempt(m[1])
    return feature ? setPoints(feature, count(m[2])) : setLimit(lane(m[1]), count(m[2]))
  }
  if ((m = is('(?:only|just|max|maximum(?: of)?|at most|no more than|up to)\\s+' + N + things + '\\s+(?:in|for|on)\\s+(.+)'))) return setLimit(lane(m[2]), count(m[1]))

  // What a release plan knows about its features.
  const pointsWord = '(?:points?|effort|size|estimate)'
  if ((m = is('(?:set|change|make)\\s+(?:the\\s+)?' + pointsWord + '\\s+(?:of|for|on)\\s+(.+?)\\s+(?:to|at)\\s+' + N + '(?:\\s+points?)?')) ||
      (m = is('(.+?)\\s+(?:is|takes|costs|needs|is worth|should be|should take|weighs|has|gets)\\s+' + N + '\\s+points?')) ||
      (m = is('(.+?)\\s*:\\s*' + N + '\\s+points?')) ||
      (m = is('(?:make|give|estimate|size)\\s+(.+?)\\s+(?:at\\s+)?' + N + '\\s+points?')) ||
      // “Billing is a 5”, “Estimate Billing at 5”: only where features have points.
      release && ((m = is('(.+?)\\s+is\\s+an?\\s+(\\d+)')) || (m = is('(?:estimate|size|score)\\s+(.+?)\\s+(?:at|as)\\s+' + N))) && cards.attempt(m[1])) {
    if (!release) throw Error('This workshop counts cards, not points. You can set how many cards a column holds.')
    // “Give This week 12 points” is the release's budget.
    const budgeted = !cards.attempt(m[1]) && lanes.attempt(m[1])
    return budgeted ? setLimit(budgeted, count(m[2])) : setPoints(card(m[1]), count(m[2]))
  }
  if ((m = is('(.+?)\\s+(?:no longer|does not|doesn(?:\'|’)t|should not|shouldn(?:\'|’)t)\\s+(?:depends?|rel(?:y|ies)|waits?|needs?)\\s+(?:on\\s+)?(.+)')) ||
      (m = is('(?:remove|clear|drop|delete)\\s+(?:the\\s+)?dependency\\s+(?:of|from)\\s+(.+?)\\s+(?:on|to)\\s+(.+)')) ||
      (m = is('(?:remove|clear|drop|delete)\\s+(?:the\\s+)?(?:dependency|link)\\s+between\\s+(.+?)\\s+and\\s+(.+)'))) {
    return dropDependency(m[1], m[2])
  }
  if ((m = is('set\\s+(?:the\\s+)?dependenc(?:y|ies)\\s+(?:of|for)\\s+(.+?)\\s+to\\s+(.+)'))) return setDependencies(m[1], m[2], false)
  if ((m = is('(.+?)\\s+(also\\s+)?(?:depends|relies|waits)\\s+on\\s+(.+)'))) return setDependencies(m[1], m[3], Boolean(m[2]))
  if (release && (m = is('(.+?)\\s+(?:has|have|needs)\\s+no\\s+dependenc(?:y|ies)')) ||
      (m = is('(?:remove|clear|drop|delete)\\s+(?:the\\s+|all\\s+)?dependenc(?:y|ies)\\s+(?:from|of|for|on)\\s+(.+)'))) {
    return setDependencies(m[1], 'none', false)
  }
  if (release && (m = is('(.+?)\\s+(?:needs|requires|comes after|must follow|follows|is blocked by|is waiting on|is waiting for|waits for)\\s+(.+?)(?:\\s+first)?')) && cards.attempt(m[1])) {
    return setDependencies(m[1], m[2], false)
  }
  // “Sign-in blocks Billing” adds to what Billing waits on.
  if (release && (m = is('(.+?)\\s+(?:blocks|comes before|must come before|goes before)\\s+(.+)')) && cards.attempt(m[1]) && cards.attempt(m[2])) {
    return setDependencies(m[2], m[1], true)
  }

  // What a card's place says.
  if ((m = is('set outcome (.+?) for (.+?) in (.+?):\\s*(.+?)\\s*\\|\\s*(.+)'))) return setOutcome(card(m[2]), lane(m[3]), m[4], m[5], m[1])
  if ((m = is('(?:when|if|once|while)\\s+(.+?)\\s+(?:is|are|lands|sits|arrives|gets)\\s+(?:in|into|to|at|under)\\s+(.+?),?\\s+(?:say|show|write|it says|tell us)\\s*:?\\s*(.+?)\\s*(?:[.;,]|\\s)\\s*(?:otherwise|if not|else|or else|until then|before that)(?:,?\\s*(?:say|show|write))?\\s*:?\\s*(.+)'))) {
    return setOutcome(card(m[1]), lane(m[2]), unquoted(m[3]), unquoted(m[4]))
  }
  if ((m = is('(?:remove|delete|drop|clear)\\s+(?:the\\s+)?outcome\\s+(.+?)\\s+(?:from|of|for|on)\\s+(.+)'))) {
    const owner = card(m[2])
    const item = finder((board.signals ?? []).filter(signal => signal.cardId === owner.id), 'outcomes?', 'outcome').find(m[1])
    return removeOutcomes(owner, signal => signal.id === item.id)
  }
  if ((m = is('(?:remove|delete|drop|clear)\\s+(?:the\\s+|all\\s+|every\\s+)?outcomes?\\s+(?:from|of|for|on)\\s+(.+)'))) {
    const owner = card(m[1])
    if (!(board.signals ?? []).some(signal => signal.cardId === owner.id)) throw Error(said(owner.label) + ' has no outcome to remove.')
    return removeOutcomes(owner, signal => signal.cardId === owner.id)
  }

  // The order the lanes are presented in.
  if ((m = is('(?:present|show|play|open with|start with|begin with)\\s+(.+?)\\s+first')) ||
      (m = is('(?:start|open|begin)\\s+(?:the\\s+)?(?:presentation|show|deck|talk)\\s+(?:with|on|at|in)\\s+(.+)')) ||
      (m = is('(.+?)\\s+(?:comes|goes|is presented|should come|should go)\\s+first')) ||
      (m = is('(?:present|show|play)\\s+(.+?)\\s+(after|before)\\s+(.+)'))) {
    const target = lane(m[1]), other = m[3] && lane(m[3])
    if (target.id === other?.id) throw Error('Choose two different scenes.')
    const order = workshopPresentationLanes(board).filter(scene => scene.id !== target.id)
    order.splice(other ? order.findIndex(scene => scene.id === other.id) + (m[2].toLowerCase() === 'after' ? 1 : 0) : 0, 0, target)
    board.presentationOrder = order.map(scene => scene.id)
    return done(board, 'The presentation now runs ' + order.map(scene => said(scene.label)).join(', then ') + '.')
  }

  // Where a card may go.
  const anywhere = '(?:anywhere|everywhere|in any lane|to any lane|into any lane|in every lane|in all lanes|in any of the lanes)'
  if ((m = is('(?:allow|let|permit)\\s+(.+?)\\s+(?:(?:to\\s+)?(?:go|be|move|sit)\\s+)?' + anywhere)) ||
      (m = is('(.+?)\\s+(?:can|may|should be able to)\\s+(?:go|be|move|sit)\\s+' + anywhere))) {
    const target = card(m[1])
    delete target.allowedLaneIds
    return done(board, said(target.label) + ' can now go in any column.')
  }
  const rest = '(?:go|be|move|sit|stay)'
  if ((m = is('(?:only\\s+)?(?:allow|let|permit|keep|restrict|limit)\\s+(.+?)\\s+(?:(?:to\\s+)?' + rest + '\\s+)?(?:only\\s+)?(?:in|to|into)\\s+(.+)')) ||
      (m = is('(.+?)\\s+(?:can|may|should|must)\\s+only\\s+' + rest + '\\s+(?:in|to|into)\\s+(.+)')) ||
      (m = is('(.+?)\\s+(?:can|may|should|must)\\s+' + rest + '\\s+only\\s+(?:in|to|into)\\s+(.+)')) ||
      (m = is('(.+?)\\s+(?:can|may)\\s+' + rest + '\\s+(?:in|to|into)\\s+(.+)')) ||
      (m = is('(.+?)\\s+(?:belongs only|stays only|stays)\\s+in\\s+(.+)'))) {
    const target = card(m[1])
    const allowed = [...new Set(several(m[2], lane))]
    const home = board.lanes.find(item => item.id === target.laneId)
    if (!allowed.includes(home)) throw Error(said(target.label) + ' is in ' + said(home.label) + ' now. Include ' + said(home.label) + ', or move the card first.')
    target.allowedLaneIds = allowed.map(item => item.id)
    return done(board, said(target.label) + ' can now go only in ' + listed(allowed.map(item => said(item.label))) + '.')
  }

  // Names of lanes and cards. “Rename the lane Now to Today” says which; “Rename Now to Today” is
  // whichever is called Now.
  if ((m = is('(?:rename|relabel|retitle|change|call)\\s+(?:the\\s+|this\\s+|that\\s+)?(lane|column|list|card|feature|note)\\s+(.+)'))) {
    const meant = /^(?:lane|column|list)$/i.test(m[1]) ? lanes : cards
    const [before, after] = closest(cuts(m[2], 'to|as|into'), ([before]) => meant.rank(before)) ?? []
    if (before) return rename(meant.find(before), after)
    // “Rename this card to Review notes”, with the card selected.
    const pointed = /^(?:to|as)\s+(.+)$/i.exec(m[2])
    if (pointed) return rename(meant.find('this'), pointed[1])
  }
  if ((m = is('(.+?)\\s+(?:should|must|needs to|ought to)\\s+be\\s+(?:called|named|renamed|titled|labell?ed)\\s+(.+)'))) return rename(either(m[1]) ?? lane(m[1]), m[2])
  if ((m = is('(?:rename|relabel|retitle|change)\\s+(.+)'))) {
    const options = cuts(m[1].replace(/^the (?:name|title|label) of\s+/i, ''), 'to|as|into')
    const [before, after] = closest(options, ([before]) => Math.min(cards.rank(before), lanes.rank(before))) ?? []
    if (before) return rename(either(before), after)
    // “Change the duration to 3 days”: days, never a lane called “duration”.
    if (options.some(([name, to]) => daysAsked(to) || timeField.test(name.trim()))) throw daysRefused(options.find(([, to]) => daysAsked(to))?.[1] ?? '3 days')
    if (options.length) {
      // Nothing by that name: say so, with the names that are here.
      const [before] = options[0]
      if (pointing.test(unquoted(before))) throw Error('Select a column or a card on the canvas first, or use its name.')
      if (/^(?:the\s+)?(?:card|feature|note)\s/i.test(before)) card(before)
      lane(before)
    }
  }

  // Moves.
  const moveVerb = '(?:move|put|place|send|drag|shift|take|bring|drop|slide|pull|push|allocate|assign|return|defer|postpone|hand|give)'
  const toward = 'to|into|in|under|onto|on|over to'
  const goes = '(?:goes|should go|belongs|moves|should move|should be|is now|needs to go|needs to be|can go|go)'
  let journeys = (m = is(moveVerb + '\\s+(.+)')) ? cuts(m[1], toward)
    : (m = is('(?:schedule|plan|slot|book)\\s+(.+)')) ? cuts(m[1], toward + '|for')
    : (m = is('spend\\s+(.+)')) ? cuts(m[1], 'on|towards?|in|for')
    : (m = is('use\\s+(.+)')) ? cuts(m[1], 'for|on|in')
    : (m = is('(?:fund|pay for)\\s+(.+)')) ? cuts(m[1], 'with|from|using').map(([place, what]) => [what, place])
    : (m = is('([^→>]+?)\\s*(?:→|->)\\s*([^→>]+)')) ? [[m[1], m[2]]]
    : (m = is('(.+?)\\s+' + goes + '\\s+(?:back\\s+)?(?:' + toward + ')\\s+(.+)')) ? [[m[1], m[2]]] : []
  // “Move Call Sam from Now to Next” says where the card is as well.
  journeys = journeys.map(([before, after]) => {
    const from = !cards.attempt(before) && /^(.+?)\s+(?:from|out of)\s+(.+)$/i.exec(before)
    return from && lanes.attempt(from[2]) && cards.attempt(from[1]) ? [from[1], after] : [before, after]
  })
  if (journeys.length) {
    const journey = closest(journeys, ([before, after]) => cards.rank(before) + lanes.rank(after))
    if (journey) return move(card(journey[0]), lane(journey[1]))
    // “Move Call Sam and Write the brief to Later”, “Move everything in Now to Later”.
    for (const [before, after] of journeys) {
      const target = lanes.attempt(after)
      const group = target && cardsMeant(before, target)
      if (group) return moveAll(group, target)
    }
    const [before, after] = journeys.find(([before]) => cards.attempt(before)) ?? journeys.find(([, after]) => lanes.attempt(after)) ?? journeys.at(-1)
    return move(card(before), lane(after))
  }
  // “Call Now Today”, “Name the Now lane Today”: the words up to where a lane's or a card's whole name ends.
  if ((m = is('(?:call|name)\\s+(.+)'))) {
    const words = m[1].split(' ')
    // The longest run of words that is a name: “the Now lane”, not only “the Now”.
    const options = words.slice(1).map((_, index) => [words.slice(0, index + 1).join(' '), words.slice(index + 1).join(' ')]).reverse()
    const [before, after] = closest(options, ([before]) => { const rank = Math.min(cards.rank(before), lanes.rank(before)); return rank <= 1 ? rank : Infinity }) ?? []
    if (before) return rename(either(before), after)
  }
  // “Add Call Sam to Now” names one card. “Add three cards about onboarding to Now” asks for
  // cards to be thought up, which is not something read here.
  if ((m = is('add\\s+(.+)')) && !/^(?:\d+|two|three|four|five|six|seven|eight|nine|ten|some|several|a few|a couple|more|many|each|every|all)\b|\b(?:cards|lanes|notes|ideas|items)\b/i.test(m[1])) {
    const options = cuts(m[1], 'to|into|in|under')
    for (const [before, after] of options) {
      const target = lanes.attempt(after)
      if (target) return addTo(target, before)
    }
    if (options.length) lane(options.at(-1)[1])
  }

  // Removals come last: “remove the limit on Now” and “remove outcome …” are read above.
  if ((m = is('(?:clear|empty)\\s+(?:out\\s+)?(.+)')) && lanes.attempt(m[1]) ||
      (m = is('(?:remove|delete|clear|drop|discard)\\s+' + everyCard + '\\s+(?:from|in|out of|under)\\s+(.+)'))) {
    const place = lane(m[1])
    const held = board.cards.filter(item => item.laneId === place.id)
    if (!held.length) throw Error(said(place.label) + ' holds no cards.')
    return removeAll(held)
  }
  if (is('(?:remove|delete|clear|drop|discard)\\s+' + everyCard.replace('everything|all|it all|all of it|', 'everything|'))) {
    if (!board.cards.length) throw Error('There are no cards to remove.')
    return removeAll([...board.cards])
  }
  if ((m = is('take\\s+(.+?)\\s+(?:off|out of)(?:\\s+(?:the|this)\\s+(?:board|workshop|plan|slate))?')) && either(m[1])) {
    const gone = either(m[1])
    return board.lanes.includes(gone) ? removeLane(gone) : removeCard(gone)
  }
  if ((m = is('(?:remove|delete|drop|discard|erase|take out|take away|get rid of|bin)\\s+(?:the\\s+)?(?:(lane|column|list|card|feature|note)\\s+)?(.+)'))) {
    const kind = m[1] ? /^(?:lane|column|list)$/i.test(m[1]) ? 'lane' : 'card' : /\s(?:lane|column|list)$/i.test(m[2]) ? 'lane' : /\s(?:card|feature|note)$/i.test(m[2]) ? 'card' : null
    // “Remove Call Sam from Now” names the card and where it is.
    const names = [m[2], ...cuts(m[2], 'from|out of|in').map(([before]) => before)]
    // “Delete Lane 2” may be a lane called just that, so the words as written are tried first.
    const asWritten = m[1] && either(m[1] + ' ' + m[2])
    if (asWritten) return board.lanes.includes(asWritten) ? removeLane(asWritten) : removeCard(asWritten)
    for (const name of names) {
      const chosen = kind === 'lane' ? lanes.attempt(name) : kind === 'card' ? cards.attempt(name) : either(name)
      if (chosen) return board.lanes.includes(chosen) ? removeLane(chosen) : removeCard(chosen)
    }
    // “Delete Call Sam and Book the room”.
    const group = m[2].split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/).filter(Boolean)
    const chosen = group.length > 1 ? group.map(name => kind === 'lane' ? lanes.attempt(name) : kind === 'card' ? cards.attempt(name) : either(name)) : []
    if (chosen.length && chosen.every(Boolean)) return removeAll([...new Set(chosen)])
    if (kind === 'lane') lane(m[2])
    if (kind === 'card') card(m[2])
    if (pointing.test(unquoted(m[2]))) throw Error('Select a column or a card on the canvas first, or use its name.')
    if (m[2].trim().split(/\s+/).length <= 5) throw Error('There is no column or card called ' + said(unquoted(m[2])) + ' here.')
  }
  throw notUnderstood()

  function rename(item, to) {
    if (daysAsked(to)) throw daysRefused(to)
    const label = named(to), before = item.label
    item.label = label
    return done(board, 'Renamed ' + said(before) + ' to ' + said(label) + '.')
  }

  function setLimit(target, amount) {
    if (amount === null) {
      delete target.capacity
      return done(board, said(target.label) + ' now holds any number of ' + unit + 's.')
    }
    const most = release ? 576 : 24
    if (amount < 1 || amount > most) throw Error('A column can hold from 1 to ' + most + ' ' + unit + 's.')
    const held = release ? board.cards.reduce((sum, item) => sum + (item.laneId === target.id ? item.points ?? 1 : 0), 0)
      : board.cards.filter(item => item.laneId === target.id).length
    if (held > amount) throw Error(said(target.label) + ' already holds ' + held + ' ' + unit + (held === 1 ? '' : 's') + '. Move some out first, or choose a higher number.')
    target.capacity = amount
    return done(board, said(target.label) + ' now holds up to ' + amount + ' ' + unit + (amount === 1 ? '' : 's') + '.')
  }

  function addTo(target, name) {
    const label = named(name.replace(new RegExp('^(?:(?:a new|another|a|an|new)\\s+)?' + cardNoun + '\\s+(?:(?:called|named|titled|saying|for)\\s+)?', 'i'), ''))
    if (release) throw Error('A release plan keeps the features it came with. You can rename them, move them and set their points.')
    if (board.cards.length >= 24) throw Error('A workshop can have up to 24 cards. Remove one first.')
    const full = target.capacity !== undefined && board.cards.filter(item => item.laneId === target.id).length >= target.capacity
    if (full) throw Error(said(target.label) + ' is full: it holds ' + target.capacity + (target.capacity === 1 ? ' card' : ' cards') + '. Add the card to another column, or raise the limit.')
    // Without words it takes the board's name for a new item (“New card”), as an empty note dropped on the lane does.
    const words = label || workshopNewCardName(board)
    return done(addWorkshopCard(board, target.id, { label: words }), 'Added ' + said(words) + ' to ' + said(target.label) + '.')
  }

  // “Add a card called Listen to the tide to Ready to review”: either name may hold the word
  // “to”. A lane named in full is taken first, then the longest ending that names one loosely.
  function addCard(description, called) {
    const chosen = selection?.kind === 'lane' && board.lanes.find(item => item.id === selection.id)
    // “Add a card called Email Jo here”, with a lane selected.
    if (chosen && /(?:^|\s+)(?:here|to it|in it)$/i.test(description)) return addTo(chosen, description.replace(/(?:^|\s+)(?:here|to it|in it)$/i, ''))
    // “Add a card to Now called Email Jo”, “Add a card in Next: Email Jo”: the lane comes first.
    const first = /^(?:to|in|into|under|on|for)\s+(.+?)(?:\s+(?:called|named|titled|saying|that says)\s+|\s*[:,-]\s+)(.+)$/i.exec(description)
    if (first && lanes.attempt(first[1])) return addTo(lanes.attempt(first[1]), first[2])
    const only = !called && /^(?:to|in|into|under|on)\s+(.+)$/i.exec(description)
    if (only && lanes.attempt(only[1])) return addTo(lanes.attempt(only[1]), '')
    const options = cuts(description, 'to|into|in|under|on')
    for (const exact of [true, false]) {
      for (const [before, after] of options) {
        const target = lanes.attempt(after)
        if (target && (!exact || lanes.rank(after) === 0)) return addTo(target, before)
      }
    }
    // No lane was named. After “called” all of it is the name. Otherwise the last “to …” was
    // meant as a lane, and there is none by that name.
    if (options.length && !called) lane(options.at(-1)[1])
    return addTo(chosen || board.lanes[0], description)
  }

  function move(subject, target) {
    if (subject.laneId === target.id) throw Error(said(subject.label) + ' is already in ' + said(target.label) + '.')
    const next = workshopCandidate(board, subject.id, target.id)
    if (!next) {
      // A move the rules refuse: offered as "Move anyway", with the rule's sentence (move-anyway.mjs).
      const anyway = moveAnywayProposal(board, subject.id, target.id)
      if (anyway) return { board: anyway.workshop, reply: anyway.reply, override: anyway.override }
      throw Error(said(subject.label) + ' can’t move to ' + said(target.label) + '. ' + workshopRefusal(board, subject.id, target.id))
    }
    return done(next, 'Moved ' + said(subject.label) + ' to ' + said(target.label) + '.')
  }

  // The cards a few words pick out together: “Call Sam and Write the brief”, “everything in Now”, “all the cards”.
  function cardsMeant(text, target) {
    const all = new RegExp('^' + everyCard + '(?:\\s+(?:in|from|under|out of)\\s+(.+))?$', 'i').exec(named(text))
    if (all) {
      const place = all[1] && lane(all[1])
      return board.cards.filter(item => place ? item.laneId === place.id : item.laneId !== target.id)
    }
    const names = text.split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/).filter(Boolean)
    const chosen = names.length > 1 ? names.map(cards.attempt) : []
    return chosen.length && chosen.every(Boolean) ? [...new Set(chosen)] : null
  }

  function moveAll(group, target) {
    const moving = group.filter(item => item.laneId !== target.id)
    if (!moving.length) throw Error(group.length ? 'Those cards are already in ' + said(target.label) + '.' : 'There are no cards to move to ' + said(target.label) + '.')
    let next = board
    for (const subject of moving) {
      // An earlier move may have taken this card along (a feature and what depends on it).
      if (next.cards.find(item => item.id === subject.id).laneId === target.id) continue
      const moved = workshopCandidate(next, subject.id, target.id)
      if (!moved) throw Error(said(subject.label) + ' can’t move to ' + said(target.label) + '. ' + workshopRefusal(next, subject.id, target.id))
      next = moved
    }
    return done(next, 'Moved ' + listed(moving.map(item => said(item.label))) + ' to ' + said(target.label) + '.')
  }

  function removeAll(group) {
    const cardsFirst = [...group.filter(item => board.cards.includes(item)), ...group.filter(item => board.lanes.includes(item))]
    for (const item of cardsFirst) board.cards.includes(item) ? removeCard(item) : removeLane(item)
    return done(board, 'Removed ' + listed(cardsFirst.map(item => said(item.label))) + '.')
  }

  function dropDependency(subject, needs) {
    if (!release) throw Error('Only a release plan keeps track of what depends on what.')
    const feature = card(subject), needed = several(needs, card)
    const gone = needed.filter(item => feature.dependsOn?.includes(item.id))
    if (!gone.length) throw Error(said(feature.label) + ' does not depend on ' + listed(needed.map(item => said(item.label))) + '.')
    feature.dependsOn = feature.dependsOn.filter(id => !gone.some(item => item.id === id))
    if (!feature.dependsOn.length) delete feature.dependsOn
    return done(board, said(feature.label) + ' no longer depends on ' + listed(gone.map(item => said(item.label))) + '.')
  }

  function setPoints(feature, points) {
    if (points < 1 || points > 24) throw Error('A feature takes from 1 to 24 points.')
    feature.points = points
    return done(board, said(feature.label) + ' now takes ' + points + (points === 1 ? ' point.' : ' points.'))
  }

  function setDependencies(subject, needs, also) {
    if (!release) throw Error('Only a release plan keeps track of what depends on what.')
    const feature = card(subject)
    if (/^(?:none|nothing|no other feature|no features?|no one)$/i.test(needs.trim())) {
      delete feature.dependsOn
      return done(board, said(feature.label) + ' no longer depends on anything.')
    }
    const needed = several(needs, card)
    if (needed.includes(feature)) throw Error('A feature can’t depend on itself.')
    feature.dependsOn = [...new Set([...(also ? feature.dependsOn ?? [] : []), ...needed.map(item => item.id)])]
    return done(board, said(feature.label) + ' now depends on ' + listed(needed.map(item => said(item.label))) + '.')
  }

  function setOutcome(subject, place, whenPresent, whenAbsent, name) {
    const signals = board.signals ??= []
    const matching = name === undefined
      ? signals.filter(signal => signal.cardId === subject.id && signal.laneId === place.id)
      : signals.filter(signal => signal.cardId === subject.id && signal.label.toLowerCase() === name.toLowerCase())
    if (name !== undefined && matching.length > 1) throw Error('Two outcomes on this card have that name.')
    if (!matching.length && signals.length >= 24) throw Error('A workshop can have up to 24 outcomes. Remove one first.')
    let index = 1
    while (signals.some(signal => signal.id === 'signal-' + index)) index++
    const label = name ?? matching[0]?.label ?? (subject.label + ' in ' + place.label).slice(0, 80).trim()
    const values = { label, cardId: subject.id, laneId: place.id, whenPresent, whenAbsent }
    if (matching.length) Object.assign(matching[0], values)
    else signals.push({ id: 'signal-' + index, ...values })
    return done(board, 'When ' + said(subject.label) + ' is in ' + said(place.label) + ' the workshop says ' + said(whenPresent) + '. Otherwise it says ' + said(whenAbsent) + '.')
  }

  function removeOutcomes(owner, gone) {
    board.signals = board.signals.filter(signal => !gone(signal))
    if (!board.signals.length) delete board.signals
    return done(board, 'Removed the outcome from ' + said(owner.label) + '.')
  }

  function removeCard(gone) {
    if (release && board.cards.length === 1) throw Error('A release plan needs at least one feature.')
    board.cards = board.cards.filter(item => item !== gone)
    for (const item of board.cards) {
      if (!item.dependsOn?.includes(gone.id)) continue
      item.dependsOn = item.dependsOn.filter(id => id !== gone.id)
      if (!item.dependsOn.length) delete item.dependsOn
    }
    if (board.signals) {
      board.signals = board.signals.filter(signal => signal.cardId !== gone.id)
      if (!board.signals.length) delete board.signals
    }
    return done(board, 'Removed the card ' + said(gone.label) + '.')
  }

  function removeLane(gone) {
    const held = board.cards.filter(item => item.laneId === gone.id).length
    if (held) throw Error(said(gone.label) + ' holds ' + held + (held === 1 ? ' card' : ' cards') + '. Move or remove ' + (held === 1 ? 'it' : 'them') + ' first.')
    if (release) throw Error('A release plan keeps the releases it came with. You can rename them and set how many points each holds.')
    if (board.lanes.length <= 2) throw Error('A workshop needs at least two columns.')
    board.lanes = board.lanes.filter(item => item !== gone)
    if (board.presentationOrder) board.presentationOrder = board.presentationOrder.filter(id => id !== gone.id)
    for (const item of board.cards) if (item.allowedLaneIds) item.allowedLaneIds = item.allowedLaneIds.filter(id => id !== gone.id)
    if (board.signals) {
      board.signals = board.signals.filter(signal => signal.laneId !== gone.id)
      if (!board.signals.length) delete board.signals
    }
    // A lane removed takes the rules that named it (the reducer's remove_lane does the same).
    if (board.behaviour) board.behaviour = rulebook().dropLane(board.behaviour, gone.id)
    return done(board, 'Removed the column ' + said(gone.label) + '.')
  }
}

/**
 * The board in focus (the gear's "Change this board", selection { kind: 'board' }): "this board" is the
 * board the grammar already reads. "On this board, …" and "… to this board" are said of it; "rename this
 * to X" and "call it X" name it. Nothing else changes: it is the same grammar, not a second one.
 */
function aboutTheBoard(message, selection) {
  if (selection?.kind !== 'board') return message
  const text = message.trim().replace(/\s+/g, ' ')
    .replace(/^(?:on|in|for|to)\s+(?:this|the)\s+board\s*[,:]?\s+/i, '')
    .replace(/\s+(?:to|on|in|for|of)\s+(?:this|the)\s+board(?=[.!]?$)/i, '')
  // "call this lane Doing" and "name this card Foo" are about a lane or a card, not the board: they
  // still ask for one to be selected. "call it a day" names nothing.
  const m = /^(?:rename|retitle)\s+(?:this|it)\s+(?:to|as)\s+(.+)$/i.exec(text) ||
    /^(?:call|name|title)\s+(?:this|it)(?!\s+(?:board|lanes?|columns?|lists?|stages?|cards?|notes?|items?|tasks?|features?|steps?|tokens?|stations?|rows?)\b)(?!\s+a\s+day\b)\s+(.+)$/i.exec(text)
  if (m) return 'Rename this board to ' + m[1]
  // Said of a lane or a card while the board is in focus: read as "Rename this lane to …", which asks
  // for the lane (or card) to be selected, as it does without the board in focus.
  const part = /^(?:call|name|title)\s+this\s+(?:(lanes?|columns?|lists?|stages?|stations?|rows?)|(cards?|notes?|items?|tasks?|features?|steps?|tokens?))\s+(.+)$/i.exec(text)
  return part ? 'Rename this ' + (part[1] ? 'column' : 'card') + ' to ' + part[3] : text
}

function propose(input, asked, selection, actor) {
  const original = validateWorkshop(input)
  if (original.lanes.some(l => l.station)) throw Error('This slate holds a map. Describe a path or a step instead.')
  if (typeof asked !== 'string' || !asked.trim() || asked.length > 1000) throw Error('Use up to 1,000 characters.')
  const message = aboutTheBoard(asked, selection)
  // How the board looks ("make the columns more pronounced", "color Do now green"): every kind of board, no AI call.
  const look = proposeAppearance(original, message, selection)
  if (look) return { ...look, workshop: validateWorkshop(look.workshop) }
  // How the board behaves (its rules), a business board's own fields, and the questions about them.
  const own = boardChat?.proposeBoardChange(original, message, selection, actor)
  if (own) return own.workshop ? { ...own, workshop: validateWorkshop(own.workshop) } : own
  const experience = startupExperienceKind(original)
  // A question is for Canvas AI, or for the reply that says what can be done here. (“Can you
  // move this to Later?” is a request: `plain` reads it without its question mark.)
  if (/\?$/.test(plain(message)) || /^(?:what|which|who|whose|why|how|where)\b/i.test(plain(message))) throw notUnderstood()
  // The message as written is read first, so a name that starts with “please” is still that name.
  let result
  try { result = change(validateWorkshop(input), message.trim().replace(/\s+/g, ' '), selection) } catch (problem) {
    const text = plain(message)
    if (text === message.trim().replace(/\s+/g, ' ')) throw problem
    try { result = change(validateWorkshop(input), text, selection) } catch (second) {
      throw second.code === 'not-understood' && problem.code !== 'not-understood' ? problem : second
    }
  }
  let next
  try { next = validateWorkshop(result.board) } catch (problem) {
    throw Error(inPlainWords(problem.message))
  }
  // A board with rules keeps them whatever the sentence: the card that would break one is refused, in the rule's words.
  const broken = original.behaviour && boardChat?.ruleProblem(original, next)
  if (broken) throw Error(broken)
  if (experience && startupExperienceKind(next) !== experience) {
    throw Error(next.lanes.length !== original.lanes.length
      ? 'This workshop keeps the lanes it came with. You can rename them, and rename and move its cards.'
      : 'This workshop keeps the cards it came with. You can rename them and move them between its lanes.')
  }
  // A change that took rules with it (a lane removed) is previewed with its rules diff.
  const rulesChanged = original.behaviour && JSON.stringify(original.behaviour) !== JSON.stringify(next.behaviour)
  return { workshop: next, reply: result.reply, ...(result.toCanvas ? { toCanvas: result.toCanvas } : {}), ...(result.override && { override: result.override }),
    ...(rulesChanged && { diff: rulebook().diff(original, next) }) }
}

// The model's own checks, for the few a sentence can still run into.
function inPlainWords(message) {
  if (/acyclic/.test(message)) return 'Those features would end up waiting on each other. Choose a dependency that does not lead back.'
  if (/same window as its feature or earlier/.test(message)) return 'A feature can only depend on one planned in the same release or an earlier one. Move one of them first.'
  if (/exceeds its (?:capacity|point budget)/.test(message)) return message.replace(/^(?:Lane|Release) "(.+)" exceeds its (?:capacity|point budget)\.$/, '“$1” would hold more than its limit. Raise the limit or move something out first.')
  if (/Labels must contain/.test(message)) return message.replace('Labels must contain', 'A name needs') + ' Try a shorter one.'
  if (/2 to 5 lanes/.test(message)) return 'A workshop has from two to five lanes.'
  if (/effort points/.test(message)) return 'A feature takes from 1 to 24 points.'
  return message
}

/** The workshop a message would make. Throws a sentence for the person when it cannot be done. */
export function proposeLaneEdit(input, message, selection, actor) {
  return propose(input, message, selection, actor).workshop
}

/** The same, with what to say back: `{ workshop, reply }`. */
export function proposeLaneReply(input, message, selection, actor) {
  return propose(input, message, selection, actor)
}

export function laneObjectSelection(board, selected) {
  if (selected == null) return null
  // The whole board in focus (the gear). One board per slate for now: it is board "main".
  if (selected.kind === 'board') {
    if (selected.id !== 'main') throw Error('Select an existing board.')
    return { kind: 'board', id: 'main', label: board.title }
  }
  const items = selected.kind === 'lane' ? board.lanes : selected.kind === 'card' ? board.cards : []
  const match = items.find(item => item.id === selected.id)
  if (!match) throw Error('Select an existing workshop lane or card.')
  return {kind:selected.kind, id:match.id, label:match.label}
}
