import assert from 'node:assert/strict'
import test from 'node:test'
import { releasePlanFromDraft } from '../web/app/server/methods/workshop-release-draft.mjs'

const sample = () => ({
  title: 'Member portal', windows: [{ name: 'Pilot', budget: 5 }],
  features: [{ name: 'Permissions', points: 2, prerequisites: [] },
    { name: 'Invitations', points: 3, prerequisites: ['Permissions'] }],
})

test('drafts a playable editable backlog with stable prerequisite identifiers', () => {
  const board = releasePlanFromDraft(sample())
  assert.equal(board.kind, 'release-plan')
  assert.deepEqual(board.cards.map(card => [card.laneId, card.points]), [['unscheduled', 2], ['unscheduled', 3]])
  assert.deepEqual(board.cards[1].dependsOn, [board.cards[0].id])
  assert.equal(board.lanes[0].capacity, 5)
})

test('rejects unknown or circular prerequisites and empty budgets', () => {
  const draft = sample()
  draft.features[0].prerequisites.push('Ghost')
  assert.throws(() => releasePlanFromDraft(draft), /existing feature/)
  draft.features[0].prerequisites = ['Invitations']
  assert.throws(() => releasePlanFromDraft(draft), /acyclic/)
  draft.features[0].prerequisites = []
  draft.windows[0].budget = 1
  assert.throws(() => releasePlanFromDraft(draft), /budget to fit/)
})
