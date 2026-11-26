// The sentences that change how a board behaves (its rulebook: dragology final.md §4, D1), the
// business boards' own sentences (launch plan, pipeline, budget), and the two questions about
// behaviour ("How does this board behave?", "Why can't I move X?"). Every change is made by the
// engine's one edit reducer (applyWorkshopEdits), so a sentence, a drag, an agent's exec and a
// whole-board save are decided by the same rules, in the same words.
//
// The rulebook itself (slateboxjs/workshops/behaviour) is reached through the model's hook, so this
// module adds nothing to what a plain slate downloads: a workshop slate loads the rulebook first.
import { applyWorkshopEdits, businessKind, rulebook, rulebookLoaded, workshopReferences } from 'slateboxjs/workshops/model'
import { said } from './plain-words.mjs'
import { useBoardChat } from './lane-conversation.mjs'
import { planChat } from './plan-chat.mjs'
import { nestChat } from './nest-chat.mjs'
import { gridChat } from './grid-chat.mjs'

const N = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve)'
const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const number = text => /^\d+$/.test(text) ? Number(text) : words.indexOf(text.toLowerCase())
const money = '\\$?\\s?(\\d+(?:[.,]\\d+)?)\\s*(k|m|thousand|million)?'
const amountOf = (digits, scale) => Math.round(Number(digits.replace(',', '.')) * ({ k: 1e3, thousand: 1e3, m: 1e6, million: 1e6 }[scale?.toLowerCase()] ?? 1))
const listOf = text => text.split(/\s*(?:,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+)\s*/).filter(Boolean)
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// The day a rule was set, in the reader's own time.
const day = iso => { const at = new Date(iso); return Number.isNaN(at.getTime()) ? null : at.getDate() + ' ' + months[at.getMonth()] }

/** The lane boards and the pipeline take rules. */
const takesRules = board => (!board.kind && !board.experience && !board.lanes.some(lane => lane.station)) || board.kind === 'pipeline'

function refused(reason) {
  const error = Error(reason)
  error.code = 'refused'
  return error
}

/** Make edits through the one door; the reply is what each edit said, and a rule edit comes with its diff. */
function make(board, edits, actor) {
  const result = applyWorkshopEdits(board, edits, { actor: { by: actor?.by || 'Someone', via: 'chat' } })
  if ('refused' in result) throw refused(result.refused.reason)
  const reply = result.report.edits.map(edit => edit.said).join(' ')
  const rulesChanged = JSON.stringify(board.behaviour ?? null) !== JSON.stringify(result.workshop.behaviour ?? null)
  return { workshop: result.workshop, reply, ...(rulesChanged && { diff: rulebook().diff(board, result.workshop) }) }
}

const rulesOn = (board, laneId, kind) => (board.behaviour?.rules ?? []).filter(rule =>
  (!kind || rule.kind === kind) && [rule.where, rule.into, rule.lane, rule.from].includes(laneId))

/** A question about how the board behaves, answered from the board: `{ reply }`, or null. */
function question(board, text) {
  if (/^(?:how\s+does\s+(?:this|the|our)\s+(?:board|workshop|pipeline|plan|launch\s+plan|hiring\s+plan)\s+(?:behave|work)|what\s+are\s+(?:the|this\s+board(?:'|’)s|our)\s+rules)\??$/i.test(text)) {
    const lines = rulebookLoaded() ? rulebook().lines(board) : []
    if (!lines.length) return { reply: 'This board has no rules yet. Say “Let ' + board.lanes[1]?.label + ' hold 2” to add one.' }
    return { reply: 'How this board behaves:\n' + lines.map(line => '• ' + line).join('\n') }
  }
  const m = /^why\s+(?:can(?:'|’|no)?t|won(?:'|’)t|doesn(?:'|’)t)\s+(?:i|we|it)\s+(?:move|drag|put)\s+(.+?)(?:\s+(?:to|into|in)\s+(.+?))?\??$/i.exec(text)
  if (!m || !rulebookLoaded()) return null
  const refs = workshopReferences(board)
  const card = refs.cards.attempt(m[1])
  if (!card) return null
  const lanes = m[2] ? [refs.lanes.attempt(m[2])].filter(Boolean) : board.lanes.filter(lane => lane.id !== card.laneId)
  if (!lanes.length) return null
  const answers = lanes.map(lane => {
    const verdict = rulebook().move(board, { id: card.id }, { id: lane.id })
    if (!('refused' in verdict)) return m[2] ? card.label + ' can move to ' + lane.label + '.' : null
    const { sentence, set, nearest } = verdict.refused
    const who = set ? (set.via === 'preset' ? ' That rule came with the board.' : ' ' + set.by + ' set that rule' + (day(set.at) ? ' on ' + day(set.at) : '') + '.') : ''
    return sentence + who + (nearest && m[2] ? ' ' + card.label + ' can go to ' + nearest + ' instead.' : '')
  }).filter(Boolean)
  return { reply: answers.length ? answers.join('\n') : card.label + ' can move to any column.' }
}

/** A sentence about the rules: the edits it makes, or null when it is not one. */
function ruleEdits(board, text, selection) {
  const refs = workshopReferences(board, selection)
  const lane = name => refs.lanes.attempt(name)
  let m
  // "Make that a rule: Review holds 2" — the words after the colon (or the selected card's words) are the rule.
  const asked = /^(?:make\s+(?:that|this|it)\s+(?:into\s+)?a\s+rule|add\s+a\s+rule|new\s+rule)\s*(?:[:,–-]\s*(.*))?$/i.exec(text)
  if (asked) {
    const rest = asked[1]?.trim() || (selection?.kind === 'card' ? board.cards.find(card => card.id === selection.id)?.label : '')
    if (!rest) throw refused('Say the rule, such as “Make that a rule: ' + (board.lanes[1]?.label ?? 'Review') + ' holds 2”.')
    text = rest.replace(/[.!]+$/, '')
  }
  const explicit = Boolean(asked)
  const ruled = explicit || Boolean(board.behaviour)
  // A lane's limit, as a rule (on a board with a rulebook, or when asked for as a rule).
  if (ruled) {
    const shapes = [
      new RegExp('^(?:let|allow|make|have)\\s+(.+?)\\s+(?:to\\s+)?hold\\s+(?:up\\s+to\\s+|at\\s+most\\s+)?' + N + '(?:\\s+(?:cards?|deals?|items?))?$', 'i'),
      new RegExp('^(?:limit|cap)\\s+(.+?)\\s+(?:to|at)\\s+' + N + '(?:\\s+(?:cards?|deals?|items?))?$', 'i'),
      new RegExp('^(.+?)\\s+(?:holds?|can hold|takes?|should hold)\\s+(?:up\\s+to\\s+|at\\s+most\\s+|only\\s+)?' + N + '(?:\\s+(?:cards?|deals?|items?))?$', 'i'),
    ]
    for (const shape of shapes) {
      if (!(m = shape.exec(text))) continue
      const target = lane(m[1])
      if (!target) continue
      const max = number(m[2])
      const rule = rulesOn(board, target.id, 'capacity')[0]
      if (rule) return [{ kind: 'set_rule', rule: rule.id, max, on: true }]
      if (target.capacity !== undefined) return [{ kind: 'set_lane_capacity', lane: { id: target.id }, capacity: max }]
      return [{ kind: 'add_rule', rule: { kind: 'capacity', where: { id: target.id }, max } }]
    }
  }
  if (/^(?:cards?|deals?|items?|everything)\s+(?:move|moves|go|goes|step|steps)\s+one\s+(?:lane|stage|column|step)\s+at\s+a\s+time$|^no\s+skipping(?:\s+(?:lanes|stages))?$/i.test(text)) {
    return [{ kind: 'add_rule', rule: { kind: 'path', from: 'any', noSkip: true } }]
  }
  if ((m = /^(?:from\s+(.+?),?\s+(?:cards?|deals?|items?)\s+(?:can\s+|may\s+)?(?:only\s+)?(?:go|move)\s+(?:only\s+)?to\s+(.+)|(?:cards?|deals?|items?)\s+(?:in|from)\s+(.+?)\s+(?:can\s+|may\s+)?(?:only\s+)?(?:go|move)\s+(?:only\s+)?to\s+(.+))$/i.exec(text))) {
    const from = lane(m[1] ?? m[3]), to = listOf(m[2] ?? m[4]).map(lane)
    if (from && to.length && to.every(Boolean)) return [{ kind: 'add_rule', rule: { kind: 'path', from: { id: from.id }, to: to.map(item => ({ id: item.id })) } }]
  }
  if ((m = /^(?:make\s+(.+?)\s+(?:a|the)\s+bin|(.+?)\s+(?:archives|bins)\s+(?:cards|deals|everything))$/i.exec(text))) {
    const target = lane(m[1] ?? m[2])
    if (target) return [{ kind: 'add_rule', rule: { kind: 'bin', lane: { id: target.id } } }]
  }
  if ((m = /^(.+?)\s+(?:needs|requires|asks\s+for)\s+an?\s+(amount|value|price)$/i.exec(text))) {
    const target = lane(m[1])
    if (target) return [{ kind: 'add_rule', rule: { kind: 'gate', into: { id: target.id }, needs: ['amount'] } }]
  }
  if (!board.behaviour) return explicit ? boundary(board) : null
  // Changing the rules a board has.
  const findRule = name => { const target = lane(name); return target && (rulesOn(board, target.id, 'capacity')[0] ?? rulesOn(board, target.id)[0]) }
  if ((m = /^(?:just\s+|only\s+)?warn\s+(?:me|us)\s+(?:when|if)\s+(.+?)\s+is\s+full$|^(?:just\s+|only\s+)?warn\s+(?:me|us\s+)?(?:about|on)\s+(?:the\s+)?(.+?)\s+(?:limit|rule)$/i.exec(text))) {
    const rule = findRule(m[1] ?? m[2])
    if (rule) return [{ kind: 'set_rule', rule: rule.id, severity: 'warn' }]
  }
  if ((m = /^(?:make\s+)?(?:the\s+)?(.+?)\s+(?:limit|rule)\s+(?:refuse|strict|block)(?:\s+again)?$|^stop\s+(?:me|us)\s+(?:when|if)\s+(.+?)\s+is\s+full$/i.exec(text))) {
    const rule = findRule(m[1] ?? m[2])
    if (rule) return [{ kind: 'set_rule', rule: rule.id, severity: 'refuse' }]
  }
  if ((m = /^turn\s+(?:off\s+)?(?:the\s+)?(.+?)\s+(?:limit|rule)(?:\s+off)?$/i.exec(text)) && !/\bon$/i.test(text)) {
    const rule = findRule(m[1])
    if (rule) return [{ kind: 'set_rule', rule: rule.id, on: false }]
  }
  if ((m = /^turn\s+(?:on\s+)?(?:the\s+)?(.+?)\s+(?:limit|rule)\s+(?:back\s+)?on$/i.exec(text))) {
    const rule = findRule(m[1])
    if (rule) return [{ kind: 'set_rule', rule: rule.id, on: true }]
  }
  // "Remove the Doing limit" takes its limit only; "Remove the Doing rules" every rule that names Doing.
  if ((m = /^(?:remove|drop|delete|clear)\s+(?:the\s+)?(.+?)\s+(limit|rules?)$/i.exec(text))) {
    const target = lane(m[1])
    const rules = target ? rulesOn(board, target.id, /^limit$/i.test(m[2]) ? 'capacity' : null) : []
    if (rules.length) return rules.map(rule => ({ kind: 'remove_rule', rule: rule.id }))
  }
  if (/\b(?:can|may)\s+skip\b|\bcan(?:'|’)?t\s+(?:go|move)\b|\bonly\s+(?:\w+\s+)?can\s+(?:move|go)\b/i.test(text) || explicit) return boundary(board)
  return null
}

/** A rule the vocabulary can't say yet: the honest answer, with the nearest rule it can make. */
function boundary(board) {
  const [from, to] = [board.lanes[1] ?? board.lanes[0], board.lanes[2] ?? board.lanes[1]]
  throw refused('I can’t make that a rule yet. I can make a path, such as “From ' + from.label + ', cards go only to ' + to.label + '”.')
}

/** The business boards' own sentences, each one of the engine's edits. */
function businessEdits(board, text) {
  const kind = businessKind(board)
  if (!kind) return null
  const refs = workshopReferences(board)
  let m
  if (kind === 'launch-plan') {
    if ((m = new RegExp('^(?:make|set)\\s+(.+?)\\s+(?:to\\s+)?' + N + '\\s+days?(?:\\s+long)?$', 'i').exec(text)) && refs.cards.attempt(m[1])) {
      return [{ kind: 'set_task', card: m[1], duration: number(m[2]) }]
    }
    if ((m = /^(?:move|set|change)\s+(?:the\s+)?launch(?:\s+day)?\s+to\s+(?:day\s+)?(\d{1,3})$/i.exec(text))) return [{ kind: 'set_launch_day', day: Number(m[1]) }]
    if ((m = new RegExp('^start\\s+(.+?)\\s+' + N + '\\s+days?\\s+later$', 'i').exec(text)) && refs.cards.attempt(m[1])) {
      const card = refs.cards.attempt(m[1])
      return [{ kind: 'set_task', card: { id: card.id }, lag: (card.lag ?? 0) + number(m[2]) }]
    }
    if ((m = /^(.+?)\s+no\s+longer\s+waits\s+(?:on|for)\s+(.+)$/i.exec(text))) return [{ kind: 'unlink_tasks', card: m[1], waitsOn: m[2] }]
    if ((m = /^(.+?)\s+(?:waits|depends)\s+(?:on|for)\s+(.+)$/i.exec(text)) && refs.cards.attempt(m[1])) return [{ kind: 'link_tasks', card: m[1], waitsOn: m[2] }]
    if ((m = new RegExp('^add\\s+(?:a\\s+)?task\\s+(?:called\\s+|named\\s+)?(.+?)(?:,\\s*' + N + '\\s+days?)?\\s+to\\s+(.+)$', 'i').exec(text)) && refs.lanes.attempt(m[3])) {
      return [{ kind: 'add_card', lane: m[3], label: m[1], ...(m[2] && { duration: number(m[2]) }) }]
    }
    return null
  }
  if ((m = new RegExp('^(?:make|set|price)\\s+(.+?)\\s+(?:to\\s+|at\\s+)?' + money + '$', 'i').exec(text)) && refs.cards.attempt(m[1])) {
    return [{ kind: 'set_amount', card: m[1], amount: amountOf(m[2], m[3]) }]
  }
  if (kind === 'pipeline' && (m = new RegExp('^(?:set|change|make)\\s+(?:the\\s+)?(?:forecast\\s+)?target\\s+(?:to\\s+)?' + money + '$', 'i').exec(text))) {
    return [{ kind: 'set_target', amount: amountOf(m[1], m[2]) }]
  }
  if (kind === 'budget') {
    // The total, at the envelope's end edge (its last team gains or gives first): "make the budget $650k",
    // "add $50k to the budget", "cut the budget by 10%". A share is rounded to the board's step.
    const total = board.budget.total, step = board.budget.step || 1
    const BUDGET = '(?:the\\s+)?(?:total\\s+)?budget(?:(?:\'|’)s\\s+total|\\s+total)?'
    const set = amount => [{ kind: 'set_budget_total', amount: Math.max(1, Math.round(amount)) }]
    if ((m = new RegExp('^(?:make|set|change)\\s+' + BUDGET + '\\s+(?:to\\s+)?' + money + '$', 'i').exec(text))) return set(amountOf(m[1], m[2]))
    if ((m = new RegExp('^(?:add|put)\\s+' + money + '\\s+(?:to|into)\\s+' + BUDGET + '$', 'i').exec(text))) return set(total + amountOf(m[1], m[2]))
    if ((m = new RegExp('^(grow|raise|increase|cut|reduce|trim|shrink|lower)\\s+' + BUDGET + '\\s+by\\s+(?:' + money + '|(\\d+(?:\\.\\d+)?)\\s*(?:%|percent))$', 'i').exec(text))) {
      const by = m[4] !== undefined ? Math.round(total * Number(m[4]) / 100 / step) * step : amountOf(m[2], m[3])
      return set(total + (/^(?:grow|raise|increase)$/i.test(m[1]) ? by : -by))
    }
  }
  if (kind === 'budget' && (m = new RegExp('^(?:move|shift|give)\\s+' + money + '\\s+from\\s+(.+?)\\s+to\\s+(.+)$', 'i').exec(text))) {
    return [{ kind: 'shift_budget', amount: amountOf(m[1], m[2]), from: m[3], to: m[4] }]
  }
  if ((m = new RegExp('^add\\s+(?:a\\s+|an\\s+)?(?:deal|line item|item|card)\\s+(?:called\\s+|named\\s+)?(.+?)(?:\\s+(?:for|of|at)\\s+' + money + ')?\\s+to\\s+(.+)$', 'i').exec(text)) && refs.lanes.attempt(m[4])) {
    return [{ kind: 'add_card', lane: m[4], label: m[1], ...(m[2] && { amount: amountOf(m[2], m[3]) }) }]
  }
  return null
}

/**
 * What a board's conversation makes of a sentence about its rules or its business fields: a
 * proposal `{ workshop, reply, diff? }`, an answer `{ reply }`, or null when the sentence is for
 * the lane conversation. Throws the sentence a person is given when it can't be done.
 */
export function proposeBoardChange(board, message, selection = null, actor = null) {
  const text = String(message ?? '').trim().replace(/\s+/g, ' ').replace(/^(?:please\s+|ok(?:ay)?,?\s+)/i, '').replace(/[.!]+$/, '')
  if (!text || board.lanes.some(lane => lane.station)) return null
  // A plan's own sentences (plan-chat.mjs): its rules, dates, bands and round, or a what-if answered without a change.
  const plan = planChat(board, text, actor, selection)
  if (plan?.reply) return { reply: plan.reply }
  if (plan?.edits) return make(board, plan.edits, actor)
  // A nested board's own sentences (nest-chat.mjs): its rules, its piles and trees, and its questions.
  const nest = nestChat(board, text, actor, String(message ?? ''))
  if (nest?.reply) return { reply: nest.reply }
  if (nest?.edits) return make(board, nest.edits, actor)
  // A grid sheet's own sentences (grid-chat.mjs): its page and grid, tiles, pages, rules, and print (an action the page runs).
  const grid = gridChat(board, text, selection)
  if (grid?.reply) return { reply: grid.reply, ...(grid.action && { action: grid.action }) }
  if (grid?.edits) return make(board, grid.edits, actor)
  const answer = takesRules(board) || businessKind(board) ? question(board, text) : null
  if (answer) return answer
  if (/\?$/.test(text)) return null
  const edits = businessEdits(board, text) ?? (takesRules(board) ? ruleEdits(board, text, selection) : null)
  return edits ? make(board, edits, actor) : null
}

/** Whether a proposal keeps the board's rules, as the server will check it: the sentence when it does not. */
export function ruleProblem(before, after) {
  if (!after.behaviour || !rulebookLoaded()) return null
  const verdict = rulebook().check(before, after)
  return 'refused' in verdict ? verdict.refused.sentence : null
}

export { said }

// Plugged into the lane conversation as this module loads.
useBoardChat({ proposeBoardChange, ruleProblem })
