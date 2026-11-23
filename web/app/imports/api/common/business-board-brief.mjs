import { launchPlanFromBrief, launchPlanOpener } from './launch-plan-brief.mjs'
import { pipelineFromBrief, pipelineOpener } from './pipeline-brief.mjs'
import { budgetFromBrief, budgetOpener } from './budget-brief.mjs'
import { money } from 'slateboxjs/workshops/rules'

// The chat phrases that make a launch plan, a sales pipeline or a budget, and what the kept line
// says about the board made. Server only: these bring the boards' rules. The browser tells the
// phrases apart by their openers alone (native-canvas-conversation.mjs, boardRequest).
const briefs = [
  [launchPlanOpener, launchPlanFromBrief],
  [pipelineOpener, pipelineFromBrief],
  [budgetOpener, budgetFromBrief],
]

/** The board a chat phrase makes, or null when the phrase opens no board. Throws the sentence that says how to write it. */
export function businessBoardFromBrief(text) {
  const words = String(text ?? '').trim()
  const brief = briefs.find(([opener]) => opener.test(words))
  return brief ? brief[1](words) : null
}

/** What the kept line says: “Added a launch plan · Product → Engineering · launch day 14”. */
export function businessBoardSaid(board) {
  const what = { 'launch-plan': 'Added a launch plan', 'hiring-plan': 'Added a hiring plan', pipeline: 'Added a sales pipeline', budget: 'Added a budget', nest: 'Added ' + board.title }[board.kind]
  const detail = board.kind === 'nest' ? board.cards.filter(card => card.laneId === board.lanes[0].id).length + ' cards' + (board.nest.layout === 'tree' ? ' in a tree' : ' in piles')
    : board.kind === 'launch-plan' ? 'launch day ' + board.launch.day
    : board.kind === 'hiring-plan' ? 'cash ' + money(board.hiring.cash, board.hiring.currency) + ', burn ' + money(board.hiring.burn, board.hiring.currency) + ' a month'
    : board.kind === 'pipeline' ? 'target ' + money(board.forecast.target, board.forecast.currency)
    : money(board.budget.total, board.budget.currency) + ' · balanced'
  return what + ' · ' + board.lanes.map(lane => lane.label).join(' → ') + ' · ' + detail
}
