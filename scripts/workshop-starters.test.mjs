import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createBudgetWorkshop, createInterviewWorkshop, createLaneWorkshop, createWorkshopMap, industrialWorkshop, nightTransfer, validateWorkshop,
} from 'slateboxjs/workshops/model'
import { proposeLaneEdit } from '../web/app/imports/api/common/lane-conversation.mjs'
import { proposeDirectMapEdit } from '../web/app/imports/api/common/map-direct-edits.mjs'
import { workshopStarters } from '../web/app/imports/api/common/workshop-starters.mjs'

const releasePlan = validateWorkshop({
  version: 1, kind: 'release-plan', title: 'Release plan',
  lanes: [{ id: 'now', label: 'This week', capacity: 8 }, { id: 'next', label: 'Next week', capacity: 8 }, { id: 'later', label: 'Later' }],
  cards: [{ id: 'a', label: 'Sign-in', laneId: 'now', points: 3 }, { id: 'b', label: 'Invites', laneId: 'next', points: 5, dependsOn: ['a'] }],
})
const lanes = { 'a new lane workshop': createLaneWorkshop(), 'the industrial workshop': industrialWorkshop, 'the $600 budget': createBudgetWorkshop(),
  'the interview board': createInterviewWorkshop(), 'a release plan': releasePlan }
const maps = { 'a new map': createWorkshopMap(), 'the night transfer map': nightTransfer }

// Every selection a person can make on the canvas: nothing, each lane, each card.
const selections = model => [null, ...model.lanes.map(({ id }) => ({ kind: 'lane', id })), ...model.cards.map(({ id }) => ({ kind: 'card', id }))]

for (const [name, model] of Object.entries(lanes)) {
  test('every starter offered on ' + name + ' produces a proposal as it stands', () => {
    let offered = 0
    for (const selection of selections(model)) {
      for (const { text, select } of workshopStarters(model, selection)) {
        offered++
        const proposal = proposeLaneEdit(model, text, selection)
        assert.ok(proposal.lanes.length >= 2, text)
        if (select) assert.ok(select[0] >= 0 && select[1] <= text.length && select[0] < select[1], 'the part to replace is inside "' + text + '"')
      }
    }
    assert.ok(offered > 0, 'something is offered')
    assert.ok(workshopStarters(model).length >= 2, 'with nothing selected')
  })
}

for (const [name, model] of Object.entries(maps)) {
  test('every starter offered on ' + name + ' produces a proposal as it stands', () => {
    for (const selection of selections(model)) {
      const starters = workshopStarters(model, selection)
      assert.ok(starters.length > 0, 'something is offered with ' + JSON.stringify(selection))
      for (const { text } of starters) {
        const proposal = proposeDirectMapEdit(model, text, selection ?? undefined)
        assert.ok(proposal.workshop && proposal.reply, text)
      }
    }
  })
}

test('a starter that would not work is not offered', () => {
  // The interview board keeps its two fixed lanes: a starter that adds a lane would break the layout.
  const interview = workshopStarters(createInterviewWorkshop()).map(item => item.text)
  assert.equal(interview.some(text => /^Add a lane/.test(text)), false)
  assert.equal(workshopStarters(createLaneWorkshop()).some(item => /^Add a lane/.test(item.text)), true, 'it is offered where it works')
  assert.throws(() => proposeLaneEdit(createInterviewWorkshop(), 'Add a lane called Later', null))
  // A map already at its five stations has no room for a follow-up.
  let full = nightTransfer
  while (full.lanes.length < 5) full = proposeDirectMapEdit(full, 'Add Stop ' + full.lanes.length + ' after ' + full.lanes[0].label).workshop
  assert.equal(workshopStarters(full).some(item => /^Add Follow-up/.test(item.text)), false)
  // With a station selected, the starters are whole messages about that station.
  const selected = workshopStarters(nightTransfer, { kind: 'lane', id: nightTransfer.lanes[0].id }).map(item => item.text)
  assert.deepEqual(selected, ['Rename it to New name', 'On arrival, say what happens here'])
})

test('lane starters are things a person would say, about the lanes and cards that are there', () => {
  assert.deepEqual(workshopStarters(createBudgetWorkshop()).map(item => item.text),
    ['Move Third $200 to Customer calls', 'Let Unallocated hold two cards', 'Add a card called New idea to Unallocated'])
  assert.deepEqual(workshopStarters(createLaneWorkshop()).map(item => item.text),
    ['Add a lane called Later', 'Let Lane 1 hold two cards', 'Add a card called New idea to Lane 1'])
  assert.deepEqual(workshopStarters(createBudgetWorkshop(), { kind: 'card', id: 'fund-2' }).map(item => item.text),
    ['Move this to Customer calls', 'Rename this card to Review notes', 'Remove this card'])
  assert.deepEqual(workshopStarters(createLaneWorkshop(), { kind: 'lane', id: 'lane-2' }).map(item => item.text),
    ['Add a card called New idea here', 'Rename this lane to Ready', 'Let this lane hold two cards'])
  for (const model of [...Object.values(lanes), ...Object.values(maps)]) {
    for (const selection of selections(model)) {
      const offered = workshopStarters(model, selection)
      assert.ok(offered.length <= 3, 'three at most')
      for (const { text } of offered) assert.equal(/\bcommand\b|@|\|/.test(text), false, 'no form to learn in “' + text + '”')
    }
  }
})

// (Removed 2026-11-19 with workshopHelp: a message the workshop's sentences do not cover now goes
// to the slate's own conversation instead of a reply that lists what can be said. See
// app-workshop-plain-words.spec.ts.)
