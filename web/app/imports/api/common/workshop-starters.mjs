import { workshopCandidate, workshopPresentationLanes } from 'slateboxjs/workshops/model'
import { proposeLaneEdit } from './lane-conversation.mjs'
import { finder } from './plain-words.mjs'
import { isStarterMap, proposeDirectMapEdit } from './map-direct-edits.mjs'

// A starter is a whole message. `select` is the part a person is most likely to replace.
const starter = (text, part) => {
  const from = part ? text.lastIndexOf(part) : -1
  return from < 0 ? { text } : { text, select: [from, from + part.length] }
}

// How a person would say a lane's or a card's name: “Customer calls” for “Customer calls · $50 per
// call”, when that still picks it out.
function spoken(items, item, noun, what) {
  const head = item.label.split(' · ')[0]
  return head !== item.label && finder(items, noun, what).attempt(head) === item ? head : item.label
}

/**
 * On a board where a card's width is time (a launch plan, a go-live, a hiring plan), a selected task's length
 * in words: “Make this 3 days” (shorter where it can be, so the line is never in the way), a hire's in weeks.
 */
function timeStarters(model, card) {
  if (model.kind !== 'launch-plan' && model.kind !== 'hiring-plan') return []
  const weeks = model.kind === 'hiring-plan', now = weeks ? Math.round((card.duration ?? 7) / 7) : card.duration ?? 1
  const to = now > (weeks ? 4 : 3) ? (weeks ? 4 : 3) : now > 1 ? now - 1 : 2
  return [starter('Make this ' + to + (weeks ? (to === 1 ? ' week' : ' weeks') : to === 1 ? ' day' : ' days'))]
}

function laneStarters(model, selection) {
  const selected = (selection?.kind === 'lane' ? model.lanes : selection?.kind === 'card' ? model.cards : []).find(item => item.id === selection.id)
  const release = model.kind === 'release-plan'
  const laneName = lane => spoken(model.lanes, lane, 'lanes?', 'lane')
  const cardName = card => spoken(model.cards, card, 'cards?', 'card')
  const held = lane => model.cards.filter(card => card.laneId === lane.id)
  // A move this workshop allows as it stands: the card and the lane it would go to.
  const moveOf = card => { const to = card && model.lanes.find(lane => lane.id !== card.laneId && workshopCandidate(model, card.id, lane.id)); return to && [card, to] }
  if (selected && selection.kind === 'card') {
    const [, to] = moveOf(selected) ?? []
    return [
      ...timeStarters(model, selected),
      ...(to ? [starter('Move this to ' + laneName(to))] : []),
      starter('Rename this card to Review notes', 'Review notes'),
      ...(release ? [starter('Make this ' + (selected.points === 3 ? 5 : 3) + ' points')] : [starter('Remove this card')]),
    ]
  }
  if (selected) {
    return [
      starter('Add a card called New idea here', 'New idea'),
      starter('Rename this column to ' + (release ? 'Next release' : 'Ready'), release ? 'Next release' : 'Ready'),
      starter(release ? 'Give this column 12 points' : 'Let this column hold two cards'),
      starter('Present this column first'),
    ]
  }
  const fresh = ['Later', 'Review', 'Done', 'Next'].find(name => !model.lanes.some(lane => lane.label.toLowerCase() === name.toLowerCase()))
  // The last card of the first lane is the one a person would move next.
  const [card, to] = [...held(model.lanes[0]).reverse(), ...model.cards].map(moveOf).find(Boolean) ?? []
  const roomy = model.lanes.find(lane => lane.capacity === undefined && held(lane).length <= 2) ?? model.lanes[0]
  return [
    ...(fresh ? [starter('Add a column called ' + fresh, fresh)] : []),
    ...(card ? [starter('Move ' + cardName(card) + ' to ' + laneName(to))] : []),
    starter(release ? 'Give ' + laneName(model.lanes[0]) + ' 12 points' : 'Let ' + laneName(roomy) + ' hold two cards'),
    starter('Add a card called New idea to ' + laneName(model.lanes[0]), 'New idea'),
    starter('Rename the workshop to Team review', 'Team review'),
  ]
}

function mapStarters(model, selection) {
  const selected = selection && (selection.kind === 'lane' ? model.lanes : model.cards).find(item => item.id === selection.id)
  if (selected) {
    const here = selection.kind === 'card' ? model.lanes.find(lane => lane.id === selected.laneId) : null
    const onward = here?.station?.next.map(id => model.lanes.find(lane => lane.id === id)).find(Boolean)
    return [
      starter('Rename it to New name', 'New name'),
      ...(selection.kind === 'lane' ? [starter('On arrival, say what happens here', 'say what happens here')] : []),
      ...(onward ? [starter('Move to ' + onward.label)] : []),
    ]
  }
  if (isStarterMap(model)) return [starter('First upload → Preview 10 rows → Import clients'), starter('When the demo ends, book a pilot')]
  const scenes = workshopPresentationLanes(model)
  return [starter('Add Follow-up after ' + model.lanes[0].label, 'Follow-up'), ...(scenes[1] ? [starter('Present ' + scenes[1].label + ' first')] : [])]
}

/**
 * The messages a workshop's conversation offers to start from: things a person would say, about
 * the lanes and cards that are there. Each one is tried against the workshop as it stands, and
 * only those that produce a proposal are offered, three at most: as many as any slate's conversation offers.
 */
export function workshopStarters(model, selection = null) {
  const map = Boolean(model.lanes[0].station)
  const works = ({ text }) => {
    try {
      if (map) proposeDirectMapEdit(model, text, selection ?? undefined)
      else proposeLaneEdit(model, text, selection)
      return true
    } catch { return false }
  }
  return (map ? mapStarters(model, selection) : laneStarters(model, selection)).filter(works).slice(0, 3)
}
