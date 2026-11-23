import { addMapToken, applyMapObjectEdit, proposeMapObjectEdit } from './map-object-edits.mjs'
import { addWorkshopBranch, createWorkshopMap, validateWorkshop, workshopCandidate, workshopPresentationLanes, workshopRefusal } from 'slateboxjs/workshops/model'
import { N, atMost, count, cuts, finder, named, plainRequest, pointing, said, things, unquoted, whole } from './plain-words.mjs'
import { cardColours } from './card-colours.mjs'

export function isStarterMap(model) {
  // Compare canonical data. A moved token, added rule, photo or edited outcome
  // makes this an authored map, even if the title is still “Untitled map”.
  return JSON.stringify(validateWorkshop(model)) === JSON.stringify(validateWorkshop(createWorkshopMap()))
}

function shortLabel(text, limit) {
  if (text.length <= limit) return text
  const cut = text.slice(0,limit - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > limit / 2 ? cut.slice(0,lastSpace) : cut.replace(/[\uD800-\uDBFF]$/, '')).trimEnd() + '…'
}

export function mapFromQuestion(question) {
  const board = createWorkshopMap()
  board.title = shortLabel(question, 120)
  board.lanes[0].label = shortLabel(question, 80)
  board.lanes[0].station.outcome = shortLabel(question, 160)
  board.lanes[1].id = 'brief-next'
  board.lanes[0].station.next = [board.lanes[1].id]
  board.lanes[1].label = 'Next decision'
  board.lanes[1].station.outcome = 'What should the team do next?'
  board.cards[0].label = 'Team'
  return validateWorkshop(board)
}

const stepWords = 'steps?|stations?|stops?|stages?|places?'
const tokenWords = 'tokens?|cards?|pieces?|markers?'
const steps = (model, selection) => finder(model.lanes, stepWords, 'step', selection?.kind === 'lane' ? selection.id : undefined, true)
// On a map with one token, “the token” is that one.
function tokens(model, selection) {
  const found = finder(model.cards, tokenWords, 'token', selection?.kind === 'card' ? selection.id : undefined)
  // Cards made from notes (free of the paths) are never "the token" (boards S2b).
  const only = model.cards.filter(card => !card.free)
  const lone = text => only.length === 1 && /^(?:(?:the|our|my)\s+)?(?:token|card|piece|marker)$/i.test(text.trim()) ? only[0] : null
  return { find: text => lone(text) ?? found.find(text), attempt: text => lone(text) ?? found.attempt(text), rank: text => lone(text) ? 0 : found.rank(text) }
}

function stationNamed(model, name) {
  return steps(model).find(name)
}

/** A message a map conversation cannot act on: the conversation takes it to the slate's own conversation. */
function notUnderstood(model) {
  const first = model.lanes[0].label
  const error = new Error('I did not follow that. I can add steps, connect them, rename them and move a token. Try “Add Follow-up after ' + first + '” or “' + first + ' then Review then Done”.')
  error.code = 'not-understood'
  return error
}

/** The map a message would make, with what to say back: `{ workshop, reply }`. */
export function proposeDirectMapEdit(workshop, input, selection) {
  const written = input.trim().replace(/[ \t]+/g, ' ')
  if (!written || input.trim().length > 1000) throw new Error('Use up to 1,000 characters.')
  const plain = plainRequest(written)
  if (plain === written) return read(workshop, written, selection)
  // A request with “please” is read without it, unless only the words as written make sense (a
  // step really called “Please hold”).
  try { return read(workshop, plain, selection) } catch (problem) {
    try { return read(workshop, written, selection) } catch { throw problem }
  }
}

// The few things a person says about a map in a sentence, rather than by naming a path.
function sentence(model, message, selection) {
  const is = whole(message)
  const step = steps(model, selection), token = tokens(model, selection)
  const edit = (lane, change, reply) => ({ workshop: applyMapObjectEdit(model, { kind: 'lane', id: lane.id }, change), reply })
  let m
  if ((m = is('(?:rename|retitle)\\s+(?:(?:the|this|my|our)\\s+)?(?:map|board|slate)\\s+(?:to|as)\\s+(.+)')) ||
      (m = is('(?:call|name|title)\\s+(?:the|this|my|our)\\s+(?:map|board|slate)\\s+(.+)')) ||
      (m = is('(?:change|set)\\s+(?:the\\s+)?(?:title|name)(?:\\s+of\\s+(?:the|this)\\s+(?:map|board|slate))?\\s+to\\s+(.+)'))) {
    const title = named(m[1])
    return { workshop: validateWorkshop({ ...model, title }), reply: 'Renamed the map to ' + said(title) + '.' }
  }
  // “Add a token”, “Add another token at Review”: it is named for its place among the tokens.
  if ((m = is('(?:add|put|place)\\s+(?:a\\s+|another\\s+|a new\\s+|one more\\s+)?token(?:\\s+(?:at|to|in|on)\\s+(.+))?')) && (!m[1] || step.attempt(m[1]))) {
    const target = m[1] ? step.find(m[1]) : model.lanes[0]
    let number = model.cards.length + 1
    while (model.cards.some(card => card.label === 'Token ' + number)) number++
    return { workshop: addMapToken(model, target.id, 'Token ' + number), reply: 'Added ' + said('Token ' + number) + ' at ' + said(target.label) + '.' }
  }
  if ((m = is('(?:add|put|place)\\s+(?:a\\s+|another\\s+|a new\\s+)?token\\s+(?:(?:called|named)\\s+)?(.+?)\\s+(?:at|to|in|on)\\s+(.+)'))) {
    const target = step.find(m[2]), label = named(m[1])
    return { workshop: addMapToken(model, target.id, label), reply: 'Added ' + said(label) + ' at ' + said(target.label) + '.' }
  }
  if ((m = is('(?:add|put|place)\\s+(?:a\\s+|another\\s+|a new\\s+)?token\\s+(?:called|named)\\s+(.+)'))) {
    const target = model.lanes[0], label = named(m[1])
    return { workshop: addMapToken(model, target.id, label), reply: 'Added ' + said(label) + ' at ' + said(target.label) + '.' }
  }
  // “Move the token on”, “Advance Progress”, “Move Progress to the next step”: along the one route from where it is.
  if ((m = is('(?:move|send|push|take|bring|advance)\\s+(.+?)\\s+(?:forward|on|along|ahead|onward|onwards|(?:on\\s+)?to the next (?:step|station|stop|stage|one))')) ||
      (m = is('advance\\s+(.+)'))) {
    const moving = token.attempt(m[1])
    if (moving) {
      const here = model.lanes.find(lane => lane.id === moving.laneId)
      const onward = here.station.next.map(id => model.lanes.find(lane => lane.id === id)).filter(Boolean)
      if (!onward.length) throw new Error(said(moving.label) + ' is at ' + said(here.label) + ', and no path leads on from there.')
      if (onward.length > 1) throw new Error('From ' + said(here.label) + ' the path goes to ' + onward.map(lane => said(lane.label)).join(' or ') + '. Say which, such as “Move ' + moving.label + ' to ' + onward[0].label + '”.')
      const next = workshopCandidate(model, moving.id, onward[0].id)
      if (!next) throw new Error(said(moving.label) + ' can’t move to ' + said(onward[0].label) + '. ' + workshopRefusal(model, moving.id, onward[0].id))
      return { workshop: validateWorkshop(next), reply: 'Moved ' + said(moving.label) + ' to ' + said(onward[0].label) + '.' }
    }
  }
  // “Colour Ask legal blue”: a card made from a note (boards S2b) takes a colour, as it does on a board of lanes;
  // the token is a playing piece with its own.
  const colour = '(' + Object.keys(cardColours).join('|') + ')'
  if (((m = is('(?:make|colou?r|paint|turn|change)\\s+(.+?)\\s+(?:to\\s+|into\\s+)?' + colour)) ||
       (m = is('(?:change|set)\\s+(?:the\\s+)?colou?r\\s+(?:of\\s+)?(.+?)\\s+to\\s+' + colour))) && token.attempt(m[1])) {
    const chosen = token.attempt(m[1]), name = m[2].toLowerCase()
    if (!chosen.free) throw new Error('The token keeps its own colour.')
    const next = { ...model, cards: model.cards.map(item => item.id === chosen.id ? { ...item, look: { ...item.look, backgroundColor: cardColours[name] } } : item) }
    return { workshop: validateWorkshop(next), reply: 'Coloured ' + said(chosen.label) + ' ' + name + '.' }
  }
  // “Move Token to Review”, or “Move the token to Review” when the map has one.
  if ((m = is('(?:move|send|put|bring|take|advance)\\s+(.+?)\\s+(?:back\\s+)?(?:to|into|onto|on|at)\\s+(.+)')) ||
      (m = is('(.+?)\\s+(?:goes|moves|should go|should be|is now)\\s+(?:back\\s+)?(?:to|at|in)\\s+(.+)'))) {
    const subject = token.attempt(m[1])
    // A step is not moved by name, and a path is named with arrows or “then”: only a token moves.
    if (subject || /\b(?:token|card|piece|marker)\b/i.test(m[1]) || pointing.test(m[1].trim())) {
      const moving = subject ?? token.find(m[1]), target = step.find(m[2])
      if (moving.laneId === target.id) throw new Error(said(moving.label) + ' is already at ' + said(target.label) + '.')
      const next = workshopCandidate(model, moving.id, target.id)
      if (!next) throw new Error(said(moving.label) + ' can’t move to ' + said(target.label) + '. ' + workshopRefusal(model, moving.id, target.id))
      return { workshop: validateWorkshop(next), reply: 'Moved ' + said(moving.label) + ' to ' + said(target.label) + '.' }
    }
  }
  if ((m = is('(?:connect|link|join)\\s+(.+?)\\s+(?:to|with|and)\\s+(.+)'))) {
    const from = step.find(m[1]), to = step.find(m[2])
    if (from.id === to.id) throw new Error('Connect two different steps.')
    if (from.station.next.includes(to.id)) throw new Error(said(from.label) + ' already leads to ' + said(to.label) + '.')
    return edit(from, { type: 'connect', to: to.id }, 'Connected ' + said(from.label) + ' to ' + said(to.label) + '.')
  }
  if ((m = is('(?:disconnect|unlink)\\s+(.+?)\\s+(?:from|and)\\s+(.+)')) ||
      (m = is('(?:remove|delete|drop)\\s+(?:the\\s+)?(?:path|route|link|connection|arrow|line)\\s+(?:from|between)\\s+(.+?)\\s+(?:to|and)\\s+(.+)'))) {
    const a = step.find(m[1]), b = step.find(m[2])
    const [from, to] = a.station.next.includes(b.id) ? [a, b] : [b, a]
    if (!from.station.next.includes(to.id)) throw new Error('There is no path between ' + said(a.label) + ' and ' + said(b.label) + '.')
    return edit(from, { type: 'disconnect', to: to.id }, 'Removed the path from ' + said(from.label) + ' to ' + said(to.label) + '.')
  }
  // “Remove the path from Option A”, “remove the path to Decide”: the one path that leaves (or reaches) that step;
  // with more than one, the question says which (boards S2b: a map's paths changed in words, one change each).
  const pathWord = '(?:path|route|link|connection|arrow|line)'
  if ((m = is('(?:remove|delete|drop|take away)\\s+(?:the\\s+)?' + pathWord + '\\s+(from|out of|leaving|to|into|reaching)\\s+(.+)'))) {
    const leaving = /^(?:from|out of|leaving)$/i.test(m[1])
    const here = step.find(m[2])
    const ends = leaving ? here.station.next.map(id => model.lanes.find(lane => lane.id === id)).filter(Boolean)
      : model.lanes.filter(lane => lane.station.next.includes(here.id))
    if (!ends.length) throw new Error(leaving ? 'No path leads on from ' + said(here.label) + '.' : 'No path leads to ' + said(here.label) + '.')
    if (ends.length > 1) {
      const [first] = ends
      throw new Error((leaving ? 'From ' + said(here.label) + ' paths lead to ' : 'Paths lead to ' + said(here.label) + ' from ') + ends.map(lane => said(lane.label)).join(' and ') +
        '. Say which, such as “Remove the path from ' + (leaving ? here.label + ' to ' + first.label : first.label + ' to ' + here.label) + '”.')
    }
    const [from, to] = leaving ? [here, ends[0]] : [ends[0], here]
    return edit(from, { type: 'disconnect', to: to.id }, 'Removed the path from ' + said(from.label) + ' to ' + said(to.label) + '.')
  }
  // How many tokens a step holds.
  const limitWord = '(?:capacity|limit|maximum|max|cap)'
  if ((m = is('(?:remove|clear|drop|lift|delete)\\s+(?:the\\s+)?' + limitWord + '\\s+(?:on|of|for|from|in|at)\\s+(.+)')) || (m = is('no\\s+' + limitWord + '\\s+(?:on|for|in|at)\\s+(.+)'))) {
    const target = step.find(m[1])
    return edit(target, { type: 'clearCapacity' }, 'Removed the limit at ' + said(target.label) + '.')
  }
  if ((m = is('(?:only|just|max|maximum(?: of)?|at most|no more than|up to)\\s+' + N + things + '\\s+(?:in|for|on|at)\\s+(.+)')) && step.attempt(m[2])) {
    return capacity(step.find(m[2]), count(m[1]))
  }
  const holds = '(?:holds?|can hold|can only hold|should hold|takes?|can take|can only take|fits?|can fit|has room for)'
  if ((m = is('(?:set|change|make)\\s+(?:the\\s+)?' + limitWord + '\\s+(?:of|for|on|in|at)\\s+(.+?)\\s+(?:to|at)\\s+' + N + things)) ||
      (m = is('(?:let|allow|make|have)\\s+(.+?)\\s+(?:to\\s+)?(?:hold|take|have|fit)\\s+' + atMost + N + things + '(?:\\s+at (?:a|one) time|\\s+at once)?')) ||
      (m = is('(.+?)\\s+' + holds + '\\s+' + atMost + N + things + '(?:\\s+at (?:a|one) time|\\s+at once)?')) ||
      (m = is('(?:limit|cap)\\s+(.+?)\\s+(?:to|at)\\s+' + atMost + N + things))) {
    return capacity(step.find(m[1]), count(m[2]))
  }
  function capacity(target, amount) {
    const here = model.cards.filter(card => card.laneId === target.id).length
    if (amount < 1 || amount > 24) throw new Error('A step can hold from 1 to 24 tokens.')
    if (here > amount) throw new Error(said(target.label) + ' already holds ' + here + (here === 1 ? ' token' : ' tokens') + '. Move some on first, or choose a higher number.')
    return edit(target, { type: 'capacity', capacity: amount }, said(target.label) + ' now holds up to ' + amount + (amount === 1 ? ' token.' : ' tokens.'))
  }
  // What a step says when a token gets there.
  if ((m = is('(?:when|once|if)\\s+(?:(?:the|a|our)\\s+)?(?:token|team|card|piece|it|someone|they|we)\\s+(?:reaches|arrives at|arrives in|gets to|lands on|lands at|is at|is in|comes to)\\s+(.+?),?\\s+(?:say|show|write|it says|tell us|tell them)\\s*:?\\s*(.+)'))) {
    const target = step.find(m[1])
    return edit(target, { type: 'outcome', text: unquoted(m[2]) }, 'Changed what happens at ' + said(target.label) + '.')
  }
  // “At Review say Two people check it”, “On arrival at Review, show …”, “Review says …”.
  if ((m = is('(?:at|in|on arrival at|on arriving at|on reaching)\\s+(.+?),?\\s+(?:say|show|write|it says)\\s*:?\\s*(.+)')) && step.attempt(m[1]) ||
      (m = is('(.+?)\\s+(?:says|should say|shows|should show|reads|should read)\\s*:?\\s*(.+)')) && step.attempt(m[1])) {
    const target = step.find(m[1])
    return edit(target, { type: 'outcome', text: unquoted(m[2]) }, 'Changed what happens at ' + said(target.label) + '.')
  }
  // “Review should be called Check”, “Call Review Check”.
  if ((m = is('(.+?)\\s+(?:should|must|needs to|ought to)\\s+be\\s+(?:called|named|renamed|titled|labell?ed)\\s+(.+)'))) {
    return renamed(model, token.rank(m[1]) < step.rank(m[1]) ? token.find(m[1]) : step.find(m[1]), m[2])
  }
  if ((m = is('(?:call|name)\\s+(.+)'))) {
    const words = m[1].split(' ')
    const rank = name => { const best = Math.min(step.rank(name), token.rank(name)); return best <= 1 ? best : Infinity }
    const [, before, after] = words.slice(1).map((_, index) => [words.slice(0, index + 1).join(' '), words.slice(index + 1).join(' ')]).reverse()
      .map(([before, after]) => [rank(before), before, after]).filter(([best]) => best < Infinity).sort(([a], [b]) => a - b)[0] ?? []
    if (before) return renamed(model, token.rank(before) < step.rank(before) ? token.find(before) : step.find(before), after)
  }
  // Steps and tokens go.
  if ((m = is('(?:remove|delete|drop|discard|erase|take out|take away|get rid of)\\s+(?:the\\s+)?(?:(step|station|stop|stage|token|card|piece)\\s+)?(.+)'))) {
    const meant = m[1] ? /^(?:token|card|piece)$/i.test(m[1]) ? 'token' : 'step' : null
    // “Delete Step two” may be a step called just that, so the words as written are tried first.
    const whole = message.replace(/^\S+(?:\s+(?:out|away|rid of))?\s+/i, '')
    const pick = name => token.rank(name) < step.rank(name) ? token.attempt(name) : step.attempt(name) ?? token.attempt(name)
    const gone = pick(whole) ?? (meant === 'token' ? token.find(m[2]) : meant === 'step' ? step.find(m[2]) : pick(m[2]))
    if (gone) return model.cards.includes(gone) ? removeToken(model, gone) : removeStep(model, gone)
    if (m[2].trim().split(/\s+/).length <= 5) throw new Error('There is no step or token called ' + said(unquoted(m[2])) + ' on this map.')
  }
  return null
}

function renamed(model, item, to) {
  const old = item.label
  item.label = named(to)
  return { workshop: validateWorkshop(model), reply: 'Renamed ' + said(old) + ' to ' + said(item.label) + '.' }
}

function removeToken(model, gone) {
  if (model.cards.length === 1) throw new Error('A map needs at least one token.')
  const next = { ...model, cards: model.cards.filter(card => card !== gone), signals: model.signals?.filter(signal => signal.cardId !== gone.id) }
  if (!next.signals?.length) delete next.signals
  return { workshop: validateWorkshop(next), reply: 'Removed the token ' + said(gone.label) + '.' }
}

function removeStep(model, gone) {
  const here = model.cards.filter(card => card.laneId === gone.id)
  if (here.length) throw new Error(said(here[0].label) + ' is at ' + said(gone.label) + '. Move it to another step first.')
  if (model.lanes.length <= 2) throw new Error('A map needs at least two steps.')
  const next = { ...model,
    lanes: model.lanes.filter(lane => lane !== gone).map(lane => ({ ...lane, station: { ...lane.station, next: lane.station.next.filter(id => id !== gone.id) } })),
    cards: model.cards.map(card => card.allowedLaneIds ? { ...card, allowedLaneIds: card.allowedLaneIds.filter(id => id !== gone.id) } : card),
    signals: model.signals?.filter(signal => signal.laneId !== gone.id),
    presentationOrder: model.presentationOrder?.filter(id => id !== gone.id) }
  if (!next.signals?.length) delete next.signals
  if (!next.presentationOrder) delete next.presentationOrder
  return { workshop: validateWorkshop(next), reply: 'Removed the step ' + said(gone.label) + '.' }
}

// A row of steps written as a list: “Intake, Review, Done”, “Steps: Intake, Review and Done”,
// “1. Intake 2. Review 3. Done”, “Intake > Review > Done”. A bare list with commas is read this
// way only on a map nobody has started, where it cannot be anything else.
function stepsListed(message, untouched) {
  const told = /^(?:(?:the\s+)?(?:steps?|stages?|path|flow|route)(?:\s+are)?\s*:\s*|(?:make|draw|create|build|start|sketch|map out)\s+(?:me\s+)?(?:a|the)\s+(?:map|path|flow|route)\s+(?:with|of|from|for|through|that goes)\s*:?\s*(?:the steps\s+)?)(.+)$/i.exec(message)
  const text = (told ? told[1] : message).replace(/[.!]$/, '').replace(/^first,?\s+(?=.*\bthen\b)/i, '')
  if (/→|->|\?$/.test(text)) return null
  const tidy = names => names.map(name => name.trim()).filter(Boolean)
  if (/^\d+[.)]\s/.test(text)) {
    const names = tidy(text.split(/(?:^|\s+)\d+[.)]\s+/))
    return names.length >= 2 ? names : null
  }
  if (/\s>\s/.test(text)) return tidy(text.split(/\s+>\s+/))
  if (!told && !untouched) return null
  const names = tidy(text.split(/\s*,\s*(?:and\s+|then\s+)?|\s+and\s+then\s+/))
  const last = names.at(-1)?.split(/\s+and\s+/) ?? []
  if (names.length >= 2 && last.length === 2) names.splice(-1, 1, ...tidy(last))
  // A sentence has commas too (“We need to onboard, train and support clients”). Only short
  // names make a bare list; words alone never decide a team's route for it.
  const longest = told ? 8 : 3
  return names.length >= (told ? 2 : 3) && names.every(name => name.split(/\s+/).length <= longest) ? names : null
}

// One step put into a path in front of another: whatever led to that one now leads to the new step.
function insertBefore(model, label, target, from) {
  const before = (from ? [from] : model.lanes.filter(lane => lane.station.next.includes(target.id)))
  if (from && !from.station.next.includes(target.id)) throw new Error('There is no path from ' + said(from.label) + ' to ' + said(target.label) + '. Try “Add ' + label + ' after ' + from.label + '”.')
  if (!before.length) throw new Error('Nothing leads to ' + said(target.label) + ' yet. Try “Add ' + label + ' after ' + target.label + '”.')
  const grown = addWorkshopBranch(model, before[0].id, { label, outcome: label })
  const added = grown.lanes.at(-1)
  for (const lane of grown.lanes) {
    if (!before.some(item => item.id === lane.id)) continue
    lane.station.next = [...new Set(lane.station.next.map(id => id === target.id ? added.id : id))]
  }
  added.station.next = [target.id]
  return { workshop: validateWorkshop(grown), reply: 'Added ' + said(label) + ' before ' + said(target.label) + '.' }
}

function read(workshop, written, selection) {
  const model = validateWorkshop(workshop)
  const step = steps(model, selection), token = tokens(model, selection)
  let message = written
  // “Review leads to Done”, “Draw a line from Review to Done”, “From Review go to Done”: a path, said in words.
  const led = whole(message)('(?:draw|add|make|put)\\s+(?:an?|the)\\s+(?:path|route|link|connection|arrow|line)\\s+(?:from|between)\\s+(.+?)\\s+(?:to|and)\\s+(.+)') ||
    whole(message)('from\\s+(.+?),?\\s+(?:go|goes|going|continue|move|it goes)\\s+(?:on\\s+)?to\\s+(.+)') ||
    whole(message)('(.+?)\\s+(?:leads|goes|points|flows|connects|continues|links)\\s+(?:on\\s+)?to\\s+(.+)')
  if (led && step.attempt(led[1]) && !token.attempt(led[1]) && !/→|->/.test(message)) message = step.find(led[1]).label + ' → ' + named(led[2])
  const list = stepsListed(message, isStarterMap(model))
  if (list) message = list.join(' → ')
  const is = whole(message)
  // “For Review, set capacity to 2”: a step or a token by name, then what should change there.
  const about = /^(?:for|at) (.+?),\s*(.+)$/is.exec(message)
  const subject = about && (token.rank(about[1]) < step.rank(about[1]) ? token.attempt(about[1]) : step.attempt(about[1]) ?? token.attempt(about[1]))
  if (about && /^for /i.test(message) && !subject) throw new Error('There is no step or token called ' + said(unquoted(about[1])) + ' on this map.')
  let objectProposal = subject ? proposeMapObjectEdit(model, about[2].trim(), { kind: model.cards.includes(subject) ? 'card' : 'lane', id: subject.id }) : null
  if (!objectProposal && subject && /^for /i.test(message)) throw new Error('Say what should change, such as “For ' + subject.label + ', set capacity to 2”.')
  objectProposal ??= proposeMapObjectEdit(model, message, selection)
  if (objectProposal) return objectProposal
  // A path is named with arrows or “then”; anything else may be a sentence about the map.
  const path = /→|->|\s+then\s+/.test(message)
  const spoken = path ? null : sentence(model, message, selection)
  if (spoken) return spoken
  const sequence = /^present in this order\s*:\s*(.*)$/i.exec(message)
  const opening = !sequence && (is('(?:present|show|play|open with|start with|begin with)\\s+(.+?)\\s+first') ||
    is('(?:start|open|begin)\\s+(?:the\\s+)?(?:presentation|show|deck|talk)\\s+(?:with|on|at|in)\\s+(.+)'))
  const after = !sequence && !opening && is('(?:present|show|play)\\s+(.+?)\\s+after\\s+(.+)')
  if (sequence || opening || after) {
    let order
    if (sequence) {
      order = sequence[1].split(/\s*(?:→|->)\s*/).map(name => stationNamed(model, name))
    } else {
      const scene = stationNamed(model, (opening || after)[1])
      order = workshopPresentationLanes(model).filter(item => item.id !== scene.id)
      let index = 0
      if (after) {
        const previous = stationNamed(model, after[2])
        if (scene.id === previous.id) throw new Error('Choose two different scenes.')
        index = order.findIndex(item => item.id === previous.id) + 1
      }
      order.splice(index, 0, scene)
    }
    if (order.length !== model.lanes.length || new Set(order).size !== model.lanes.length) {
      throw new Error('Include each scene once in the presentation order.')
    }
    model.presentationOrder = order.map(scene => scene.id)
    return { workshop: validateWorkshop(model), reply: 'The presentation opens with “' + order[0].label + '”.' }
  }
  const rename = !path && is('(rename|relabel|retitle|change)\\s+(?:the (?:name|title|label) of\\s+)?(.+)')
  // Either name may hold the word “to”: the one that names a step or token most exactly decides.
  const renames = rename ? cuts(rename[2], 'to|as').map(([before, after]) => [Math.min(step.rank(before), token.rank(before)), before, after])
    .filter(([rank]) => rank < Infinity).sort(([a], [b]) => a - b) : []
  // “Change …” is only a rename when it names something that is here.
  if (rename && (renames.length || !/^change$/i.test(rename[1]))) {
    const [, before, after] = renames[0] ?? []
    if (!before) {
      const [first] = cuts(rename[2], 'to|as')[0] ?? []
      if (first && /\b(?:token|card|piece|marker)\b/i.test(first)) token.find(first)
      if (first) step.find(first)
      throw notUnderstood(model)
    }
    const item = token.rank(before) < step.rank(before) ? token.find(before) : step.find(before)
    const old = item.label
    item.label = named(after)
    return { workshop: validateWorkshop(model), reply: 'Renamed ' + said(old) + ' to ' + said(item.label) + '.' }
  }
  const stepName = text => named(text.replace(/^(?:(?:a new|another|a|an|new)\s+)?(?:step|station|stop|stage)\s+(?:(?:called|named|for)\s+)?/i, ''))
  const aStep = '(?:(?:a new|another|a|an|new)\\s+)?(?:step|station|stop|stage)'
  // “Add Review before Done”, “Insert Review between Draft and Done”, “Add a step before Done called Review”.
  const between = !path && (is('(?:add|insert|put|place)\\s+(.+?)\\s+between\\s+(.+?)\\s+and\\s+(.+)'))
  if (between && step.attempt(between[2]) && step.attempt(between[3])) {
    const first = step.find(between[2]), second = step.find(between[3])
    return first.station.next.includes(second.id) || !second.station.next.includes(first.id)
      ? insertBefore(model, stepName(between[1]), second, first) : insertBefore(model, stepName(between[1]), first, second)
  }
  const ahead = !path && (is('(?:add|insert|put|place)\\s+' + aStep + '\\s+(?:before|ahead of|in front of)\\s+(.+?)\\s+(?:called|named)\\s+(.+)'))
  if (ahead && step.attempt(ahead[1])) return insertBefore(model, named(ahead[2]), step.find(ahead[1]))
  const front = !path && !ahead && (is('(?:add|insert|put|place)\\s+(.+?)\\s+(?:before|ahead of|in front of)\\s+(.+)'))
  if (front && step.attempt(front[2])) return insertBefore(model, stepName(front[1]), step.find(front[2]))
  // “Add Archive at the end”, “Add a step at the end called Archive”.
  const last = !path && (is('(?:add|put|place)\\s+' + aStep + '\\s+(?:at|to|on)\\s+the\\s+end(?:\\s+of\\s+the\\s+(?:path|map|route))?\\s+(?:called|named)\\s+(.+)') ||
    is('(?:add|put|place)\\s+(.+?)\\s+(?:at|to|on)\\s+the\\s+end(?:\\s+of\\s+the\\s+(?:path|map|route))?'))
  const atEnd = label => {
    const ends = model.lanes.filter(lane => !lane.station.next.length)
    if (ends.length !== 1) throw new Error('Say where it goes, such as “Add ' + label + ' after ' + (ends[0] ?? model.lanes[0]).label + '”.')
    return { workshop: addWorkshopBranch(model, ends[0].id, { label, outcome: label }),
      reply: 'Added a path from ' + said(ends[0].label) + ' to ' + said(label) + '.' }
  }
  if (last) return atEnd(stepName(last[1]))
  const branch = /^add (?:(?:a new|another|a|an|new) )?(?:step|station|stop|stage) (?:after|from|following) (?<source>.+?) (?:called|named) (?<label>.+)$/i.exec(message)
    || /^add (?<label>.+?) (?:after|from|following) (?<source>.+)$/i.exec(message)
    || /^after (?<source>.+?),\s*add (?<label>.+?)\.\s+on arrival,\s*(?<arrival>.+)$/i.exec(message)
    || /^after (?<source>.+?),?\s+add (?<label>.+)$/i.exec(message)
  if (branch) {
    const from = stationNamed(model, branch.groups.source)
    const label = stepName(branch.groups.label)
    const outcomeText = branch.groups.arrival?.trim() || label
    return { workshop: addWorkshopBranch(model, from.id, {label, outcome: outcomeText}),
      reply: 'Added a path from “' + from.label + '” to “' + label + '”.' }
  }
  // “Add a step called Review”, with nowhere named, goes on the end of the path when there is one end.
  const loose = !path && is('(?:add|create|make|new)\\s+(?:(?:a new|another|a|an|new)\\s+)?(?:step|station|stop|stage)(?:\\s+(?:called|named))?\\s*[:,-]?\\s+(.+)')
  if (loose) return atEnd(named(loose[1]))
  if (about && /^at /i.test(message)) {
    const lane = stationNamed(model, about[1])
    lane.station.outcome = about[2].trim()
    return { workshop: validateWorkshop(model), reply: 'Changed what happens at “' + lane.label + '”.' }
  }
  // In the free editor the user's literal alternatives become two real
  // destinations from the current station. Never guess an unstated alternative.
  const choices = /^(?:branch to )?(.+?)\s+or\s+(.+)$/i.exec(message)
  if (choices && !/^(?:if|when) /i.test(message) && !message.includes('→') && !message.includes('->')) {
    const names = choices.slice(1).map(s => s.trim())
    const current = model.lanes.find(l => l.id === model.cards[0]?.laneId)
    if (!current?.station || new Set(names.map(s=>s.toLowerCase())).size !== 2 ||
        names.some(s=>s.toLowerCase() === current.label.toLowerCase())) {
      throw new Error('Name two distinct destinations for this step.')
    }
    let result = model
    const untouched = current.id === 'start' && model.cards.length === 1 && model.cards[0].label === 'Team' &&
      model.lanes.length === 2 && model.lanes[1].id === 'brief-next' && !model.lanes[1].capacity &&
      !model.presentationOrder && !model.cards[0].allowedLaneIds && model.lanes[1].station?.next.length === 0 &&
      model.lanes[1].label === 'Next decision' && model.lanes[1].station?.outcome === 'What should the team do next?' &&
      !model.lanes[1].station.image && !model.signals?.length && current.station.next.length === 1 &&
      current.station.next[0] === model.lanes[1].id
    if (untouched) {
      model.lanes[1].label = names[0]
      model.lanes[1].station.outcome = names[0]
    }
    for (const name of names) {
      const source = result.lanes.find(l => l.id === current.id)
      const existing = result.lanes.find(l => l.label.toLowerCase() === name.toLowerCase())
      if (existing) {
        if (!source.station.next.includes(existing.id)) source.station.next.push(existing.id)
      } else result = addWorkshopBranch(result, source.id, {label:name, outcome:name})
    }
    return { workshop: validateWorkshop(result), reply: 'Added the choices “' + names[0] + '” and “' + names[1] + '”.' }
  }
  const when = /^(?:when|if) (.+?)(?:,\s*(?:then\s+)?|\s+then\s+)(.+)$/i.exec(message)
  // “Draw Intake → Review” asks for the path; the steps are Intake and Review.
  const route = path ? message.replace(/^(?:draw|sketch|map out)\s+(?:(?:a|the)\s+(?:map|path|flow|route)\s*(?:from|of|for|with|through|:)?\s+)?/i, '')
    .replace(/^first,?\s+(?=.*\bthen\b)/i, '') : message
  const names = when ? when.slice(1).map(s => s.trim()) : route.split(/\s*(?:→|->|,\s*then\s+|\s+then\s+)\s*/i).map(s => s.trim())
  if (names.length === 1 && isStarterMap(model)) {
    return {workshop:mapFromQuestion(message), reply:'What are the two possible next steps? You can write “Approve the request or ask for a review”.'}
  }
  if (names.length < 2 || names.some(name => !name)) throw notUnderstood(model)
  if (new Set(names.map(name => name.toLowerCase())).size !== names.length) throw new Error('Give each step in the path a distinct name.')
  let result = model
  if (isStarterMap(model)) {
    model.title = names[0]
    model.cards[0].label = 'Progress'
    model.lanes.slice(0, 2).forEach((lane, i) => { lane.label = names[i]; lane.station.outcome = names[i] })
    for (const name of names.slice(2)) result = addWorkshopBranch(result, result.lanes.at(-1).id, {label:name, outcome:name})
  } else {
    // Extend a chosen existing route; never replace someone’s saved content.
    let from = stationNamed(result, names[0])
    for (const name of names.slice(1)) {
      const next = result.lanes.find(lane => lane.label.toLowerCase() === name.toLowerCase())
      if (next) {
        if (!from.station.next.includes(next.id)) from.station.next.push(next.id)
        from = next
      } else {
        result = addWorkshopBranch(result, from.id, {label:name, outcome:name})
        from = result.lanes.at(-1)
      }
    }
  }
  return { workshop: validateWorkshop(result), reply: 'Connected ' + names.join(' → ') + '.' }
}
