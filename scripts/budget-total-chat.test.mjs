// A budget's total in words (the owner, 2026-11-22: "change the total too"): one set_budget_total, made by the
// engine's reducer at the envelope's end edge (its last team gains or gives first), the same edit a drag of that
// edge and exec make. Too small is refused with the smallest total that fits.
import assert from 'node:assert/strict'
import test from 'node:test'
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { sampleBudget } from 'slateboxjs/workshops/rules'
import { proposeLaneReply } from '../web/app/imports/api/common/lane-conversation.mjs'
import '../web/app/imports/api/common/board-chat.mjs'

const budget = () => validateWorkshop(sampleBudget()) // $1.2M; Marketing (last) $250k, cap $300k; the teams keep $890k
const say = (board, message) => proposeLaneReply(board, message, null, { by: 'Tim' })
const lanes = board => Object.fromEntries(board.lanes.map(lane => [lane.id, lane.allocation]))

test('“make the budget $650k”, “add $50k to the budget”, “cut the budget by 10%”: one set_budget_total each', () => {
  const cases = [
    ['add $50k to the budget', 1250000, { marketing: 300000 }],
    ['make the budget $1.3M', 1300000, { marketing: 300000, design: 200000 }],
    ['set the budget total to 1.1m', 1100000, { marketing: 150000 }],
    ['cut the budget by 10%', 1080000, { marketing: 150000, design: 130000 }],
    ['raise the budget by 5%', 1260000, { marketing: 300000, design: 160000 }],
    ['reduce the budget by $20k', 1180000, { marketing: 230000 }],
  ]
  for (const [phrase, total, changed] of cases) {
    const result = say(budget(), phrase)
    assert.equal(result.workshop.budget.total, total, phrase)
    for (const [id, amount] of Object.entries(changed)) assert.equal(lanes(result.workshop)[id], amount, phrase + ' ' + id)
    assert.match(result.reply, /^The budget is now \$/, phrase)
  }
  assert.equal(say(budget(), 'add $50k to the budget').reply, 'The budget is now $1.25M: Marketing $300k.')
})

test('too small: refused with the smallest total that fits; money between teams still moves as before', () => {
  assert.throws(() => say(budget(), 'make the budget $650k'), /^Error: The teams keep \$890k between them: their floors and what they commit\. The smallest total that fits is \$890k\.$/)
  const moved = say(budget(), 'move $50k from Sales to Design')
  assert.equal(moved.workshop.budget.total, 1200000)
  assert.equal(lanes(moved.workshop).design, 200000)
})
