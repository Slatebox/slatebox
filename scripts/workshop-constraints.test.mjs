import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { acceptConstraintProposal, prepareConstraintProposal } from '../web/app/imports/api/common/workshop-constraints.mjs'

const { nightTransfer, releasePlan } = createRequire(new URL('../web/app/package.json', import.meta.url))('slateboxjs/workshops/model')

test('proposes a route constraint without changing the draft, then retains unrelated manual edits on accept', () => {
  const original = structuredClone(nightTransfer)
  const before = structuredClone(original)
  const proposal = prepareConstraintProposal(original, { changes: [{ rule: 'close-path', subject: 'platform', value: 'stairs' }] })
  assert.deepEqual(original, before)
  assert.deepEqual(proposal.rows, [{ title: 'Last train → East stairs', from: 'Open', to: 'Closed' }])
  original.title = 'Our late train'
  original.lanes[0].station.outcome = 'This is a manually revised arrival.'
  const revised = acceptConstraintProposal(original, proposal)
  assert.deepEqual(revised.lanes[0].station.next, ['lift'])
  assert.equal(revised.title, original.title)
  assert.equal(revised.lanes[0].station.outcome, original.lanes[0].station.outcome)
  assert.deepEqual(original.lanes[0].station.next, before.lanes[0].station.next)
})

test('accepts a grouped change atomically and preserves later feature placement', () => {
  const input = structuredClone(releasePlan)
  const proposal = prepareConstraintProposal(input, { changes: [
    { rule: 'point-budget', subject: 'friday', value: '12' },
    { rule: 'effort', subject: 'invite', value: '4' },
  ] })
  input.cards.find(card => card.id === 'export').laneId = 'backlog'
  const revised = acceptConstraintProposal(input, proposal)
  assert.equal(revised.lanes[0].capacity, 12)
  assert.equal(revised.cards.find(card => card.id === 'invite').points, 4)
  assert.equal(revised.cards.find(card => card.id === 'export').laneId, 'backlog')
})

test('refuses a conflicting manual change, illegal budget, unknown id, no-op or dependency cycle', () => {
  const input = structuredClone(releasePlan)
  const change = (rule, subject, value) => ({ changes: [{ rule, subject, value }] })
  const proposal = prepareConstraintProposal(input, change('point-budget', 'friday', '12'))
  input.lanes[0].capacity = 10
  assert.throws(() => acceptConstraintProposal(input, proposal), /edited/)
  assert.throws(() => prepareConstraintProposal(input, change('point-budget', 'friday', '1')), /budget/)
  assert.throws(() => prepareConstraintProposal(input, change('effort', 'missing', '2')), /existing/)
  assert.throws(() => prepareConstraintProposal(input, change('point-budget', 'friday', '10')), /current value/)
  assert.throws(() => prepareConstraintProposal(input, change('require-feature', 'guardrails', 'invite')))
})

test('rejects duplicates, arbitrary properties, unknown rules and oversized rulesets', () => {
  const base = structuredClone(nightTransfer)
  const op = { rule: 'arrival-outcome', subject: 'stairs', value: 'Use the lift.' }
  assert.throws(() => prepareConstraintProposal(base, { changes: [{ ...op, title: 'Replace title' }] }), /existing subject/)
  assert.throws(() => prepareConstraintProposal(base, { changes: [op, op] }), /only once/)
  assert.throws(() => prepareConstraintProposal(base, { changes: [{ ...op, rule: '__proto__' }] }), /rule/)
  assert.throws(() => prepareConstraintProposal(base, { changes: [{ ...op, value: '<html>' }] }), /plain-text/)
  assert.throws(() => prepareConstraintProposal(base, { changes: Array(9).fill(op) }), /one to eight/)
})
