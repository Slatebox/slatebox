// What a person says to a plan (dragology final.md §3.2–3.3, D2 and D3): a launch plan's or a go-live's
// line, freezes, overlap, snap, working days, push or stop, locks and dates; a hiring plan's runway floor,
// band costs, the funding round, moving and adding hires. Every sentence becomes the engine's edits and is
// made by its one reducer (applyWorkshopEdits), so a sentence, a drag and an agent's exec are decided by
// the same rules in the same words. Dates are read by the plan's own words (the rules hook), so the chat
// loads nothing the plan has not loaded already.
import { applyWorkshopEdits, workshopReferences, workshopRules, workshopRulesLoaded } from 'slateboxjs/workshops/model'

const N = '(\\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve)'
const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const number = text => /^\d+$/.test(text) ? Number(text) : /^an?$/i.test(text) ? 1 : words.indexOf(text.toLowerCase())
const isPlan = board => board.kind === 'launch-plan' || board.kind === 'hiring-plan'
const quarters = { q1: 'Jan', q2: 'Apr', q3: 'Jul', q4: 'Oct' }

function refused(reason) {
  const error = Error(reason)
  error.code = 'refused'
  return error
}

const planWords = board => workshopRulesLoaded(board.kind) ? workshopRules(board.kind).words : null
const ruleOf = (board, kind, test = () => true) => (board.behaviour?.rules ?? []).find(rule => rule.kind === kind && test(rule))
/** A rule's change: set it when the plan has one of this kind, or add it. */
const setOrAdd = (board, kind, change, body) => {
  const rule = ruleOf(board, kind)
  return rule ? [{ kind: 'set_rule', rule: rule.id, on: true, ...change }] : [{ kind: 'add_rule', rule: { kind, ...body } }]
}

/** The day a person names on this plan ("Dec 20", "May", "Q3", "Thu 14", "day 20"), as an offset; null when it is not a date. */
function dayOf(board, text, after = 0) {
  const said = String(text).trim().replace(/^(?:on|in|by|early|the)\s+/i, '').replace(/\?$/, '')
  if (/^day\s+\d{1,3}$/i.test(said)) return Number(said.replace(/\D/g, ''))
  const quarter = quarters[said.toLowerCase()]
  return planWords(board)?.day(board, quarter ?? said, after) ?? null
}

/** A sentence about a plan's rules or its fields: the edits it makes, or null when it is not one. */
function planEdits(board, text) {
  const refs = workshopReferences(board)
  const card = name => refs.cards.attempt(name)
  const hiring = board.kind === 'hiring-plan'
  const line = board.launch?.name ?? 'launch'
  let m
  // How far a slip reaches.
  if (/^(?:stop\s+(?:me|us)(?:\s+instead)?(?:\s+of\s+pushing(?:\s+(?:the\s+)?(?:dependent\s+)?(?:tasks|hires))?)?|(?:don(?:'|’)?t|never)\s+push\s+(?:the\s+)?(?:dependent\s+)?(?:tasks|hires)|a\s+slip\s+stops\s+at\s+.+)$/i.test(text)) {
    return setOrAdd(board, 'cascade', { onConflict: 'stop' }, { onConflict: 'stop' })
  }
  if (/^(?:push\s+(?:the\s+)?dependent\s+(?:tasks|hires)(?:\s+when\s+(?:i|we)\s+slip\s+(?:something|a\s+task))?|a\s+slip\s+pushes\s+.+)$/i.test(text)) {
    return setOrAdd(board, 'cascade', { onConflict: 'push' }, { onConflict: 'push' })
  }
  // Locks, by the task: "Lock QA, the agency booked it" (the reason is the person's, not the rule's).
  if ((m = /^lock\s+(.+?)(?:\s*[,;:–—-]\s+.*)?$/i.exec(text)) && card(m[1])) return [{ kind: 'add_rule', rule: { kind: 'locked', cards: [{ id: card(m[1]).id }] } }]
  if ((m = /^unlock\s+(.+)$/i.exec(text)) && card(m[1])) {
    const rule = ruleOf(board, 'locked', item => item.cards.includes(card(m[1]).id))
    if (!rule) throw refused(card(m[1]).label + ' is not locked.')
    // A lock on several tasks (an agent's): the others stay locked.
    const rest = rule.cards.filter(id => id !== card(m[1]).id)
    return [{ kind: 'remove_rule', rule: rule.id }, ...(rest.length ? [{ kind: 'add_rule', rule: { kind: 'locked', ...(rule.severity === 'warn' && { severity: 'warn' }), cards: rest.map(id => ({ id })) } }] : [])]
  }
  if ((m = /^snap\s+(?:to\s+)?(?:whole\s+)?(weeks?|days?)$/i.exec(text))) {
    const unit = /^w/i.test(m[1]) ? 'week' : 'day'
    return setOrAdd(board, 'snap', { unit }, { unit })
  }
  if (!hiring) {
    if (/^(?:let\s+(?:things|tasks)\s+slip\s+past\s+(?:launch|go-live|the\s+line)(?:\s+but\s+show\s+them\s+in\s+red)?|make\s+(?:launch|go-live|the\s+line)\s+a\s+soft\s+line)$/i.test(text)) {
      return setOrAdd(board, 'deadline', { severity: 'warn' }, { at: 'launch', severity: 'warn' })
    }
    if (/^(?:nothing\s+slips\s+past\s+(?:launch|go-live)|make\s+(?:launch|go-live|the\s+line)\s+a\s+hard\s+line)$/i.test(text)) {
      return setOrAdd(board, 'deadline', { severity: 'refuse' }, { at: 'launch' })
    }
    if ((m = /^nothing\s+(?:ships|moves|happens|lands)\s+(?:in|during)\s+(?:the\s+)?(.+?)\s*[,:]\s*(?:from\s+)?(.+?)\s*(?:\bto\b|\buntil\b|\bthrough\b|–|—|-)\s*(.+)$/i.exec(text))) {
      const start = dayOf(board, m[2]), end = start === null ? null : dayOf(board, m[3], start)
      if (start === null || end === null) throw refused('Say the freeze’s dates, such as “Nothing ships in code freeze, Dec 20 to Jan 3”.')
      const iso = planWords(board).iso
      return [{ kind: 'add_rule', rule: { kind: 'blackout', start: iso(board, start), end: iso(board, end), label: m[1].trim().toLowerCase() } }]
    }
    if ((m = /^(?:(.+?)(?:'|’)s\s+tasks|tasks\s+in\s+(.+?))\s+(?:can(?:'|’)?t|cannot|may\s+not)\s+overlap$/i.exec(text))) {
      const lane = refs.lanes.attempt(m[1] ?? m[2])
      if (lane) return [{ kind: 'add_rule', rule: { kind: 'overlap', lane: { id: lane.id } } }]
    }
    if (/^(?:a\s+team(?:'|’)s\s+)?tasks(?:\s+in\s+a\s+team)?\s+(?:can(?:'|’)?t|cannot)\s+overlap$/i.test(text)) return [{ kind: 'add_rule', rule: { kind: 'overlap' } }]
    if (/^(?:count\s+(?:only\s+)?working\s+days(?:\s+only)?|weekends\s+don(?:'|’)?t\s+count|skip\s+weekends)$/i.test(text)) {
      return setOrAdd(board, 'workdays', {}, {})
    }
    if (/^(?:weekends\s+count|count\s+every\s+day)$/i.test(text)) {
      const rule = ruleOf(board, 'workdays')
      if (rule) return [{ kind: 'set_rule', rule: rule.id, on: false }]
    }
    // "Move launch to Thu 14", "Move go-live to Dec 18", "push go-live to 23 Dec" (a day number is the business grammar's).
    // A weekend, where weekends don't count, lands on the working day toward where it was going (the reducer's).
    if ((m = /^(?:move|set|change|push|pull|bring|shift)\s+(?:the\s+)?(?:launch|go-live)(?:\s+day)?\s+(?:back\s+|forward\s+)?to\s+(.+)$/i.exec(text)) && !/^(?:day\s+)?\d{1,3}$/i.test(m[1])) {
      const day = dayOf(board, m[1])
      if (day !== null) return [{ kind: 'set_launch_day', day }]
    }
    return null
  }
  // A hiring plan.
  if ((m = /^(?:never\s+let\s+runway\s+(?:drop|fall|go)\s+(?:below|under)|keep\s+runway\s+(?:above|over|at\s+least)|runway\s+stays\s+above)\s+(\d{1,2}(?:\.\d)?)\s+months?$/i.exec(text))) {
    const floor = Number(m[1])
    return setOrAdd(board, 'deadline', { floor }, { at: 'runway', floor })
  }
  if (/^(?:just\s+)?warn\s+(?:me|us)\s+(?:about|on)\s+(?:the\s+)?runway(?:\s+floor)?$/i.test(text) && ruleOf(board, 'deadline')) {
    return [{ kind: 'set_rule', rule: ruleOf(board, 'deadline').id, severity: 'warn' }]
  }
  if ((m = /^(?:(?:a|an|the|our)\s+)?(.+?)\s+(?:costs?|is)\s+\$?\s?(\d+(?:[.,]\d+)?)\s*(k|m|thousand)?\s+(?:a|per|each)\s+month(?:\s+loaded)?$/i.exec(text))) {
    const band = planWords(board).band(board, m[1])
    if (band) return [{ kind: 'set_band_cost', band: band.id, monthly: Math.round(Number(m[2].replace(',', '.')) * ({ k: 1e3, thousand: 1e3, m: 1e6 }[m[3]?.toLowerCase()] ?? 1)) }]
  }
  if ((m = /^(?:what\s+if\s+)?(?:the\s+)?(?:funding\s+)?round\s+(?:closes|slips|lands|moves|comes)\s+(?:in|to|on|by)\s+(.+)$|^move\s+the\s+(?:funding\s+)?round\s+to\s+(.+)$/i.exec(text))) {
    const day = dayOf(board, m[1] ?? m[2])
    if (day !== null) return [{ kind: 'set_funding', day }]
  }
  if ((m = new RegExp('^(?:make\\s+)?(?:recruiting\\s+for\\s+)?(.+?)\\s+(?:takes?\\s+)?' + N + '\\s+weeks?(?:\\s+to\\s+(?:hire|recruit))?$', 'i').exec(text)) && card(m[1])) {
    return [{ kind: 'set_task', card: { id: card(m[1]).id }, duration: number(m[2]) * 7 }]
  }
  // "Push the designer to May", "Hire AE #2 in Q3": the hire starts on (or just after) that day.
  if ((m = /^(?:push|move|pull|hire|bring)\s+(?:the\s+)?(.+?)\s+(?:back\s+|forward\s+)?(?:to|in|for|into|by)\s+(.+)$/i.exec(text)) && card(m[1])) {
    const day = refs.lanes.attempt(m[2]) ? null : dayOf(board, m[2])
    if (day !== null) return [{ kind: 'set_task', card: { id: card(m[1]).id }, lag: planWords(board).startLag(board, card(m[1]).id, day) }]
  }
  // "Add a Sales AE in Q3", "Add a Designer to Product": the band from the words, its team unless one is named.
  if ((m = /^add\s+(?:an?\s+|another\s+)?(.+?)(?:\s+to\s+(.+?))?(?:\s+in\s+(.+))?$/i.exec(text))) {
    const band = planWords(board).band(board, m[1])
    const lane = m[2] ? refs.lanes.attempt(m[2]) : band && board.lanes.find(item => item.id === band.lane)
    const day = m[3] ? dayOf(board, m[3]) : null
    if (band && lane && (!m[3] || day !== null)) {
      const lag = day === null ? 0 : Math.ceil(Math.max(0, day - 42) / 7) * 7
      return [{ kind: 'add_card', lane: { id: lane.id }, label: m[1].trim(), band: band.id, ...(lag && { lag }) }]
    }
  }
  return null
}

// A task's days (its length and its start), said with the task selected ("make it 3 days", "3 days", "start it
// on Monday") or named ("shorten Configure to 3 days", "extend Kick-off by 2 days"). A number of days is never
// a name, and "the duration" is never a lane: these are read before the lane conversation sees them.
const amount = N + '\\s+(?:working\\s+|business\\s+|calendar\\s+)?(days?|weeks?)'
const pointingTask = /^(?:this|it|that|this one|that one|(?:this|that|the selected|the current) (?:task|card|bar|hire|one))$/i
const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const squash = text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** The plan's days in a number and unit: a week is five working days where weekends don't count, else seven. */
const daysOf = (board, count, unit) => number(count) * (/^w/i.test(unit) ? (ruleOf(board, 'workdays', rule => rule.on) ? 5 : 7) : 1)

/** The plan's line in words: "launch", "go-live", "the deadline", "the launch day", or its own name. */
function lineReference(board, reference) {
  if (board.kind !== 'launch-plan') return false
  const said = squash(String(reference ?? '').trim().replace(/^the\s+/i, '').replace(/\s+(?:day|date|line)$/i, ''))
  return !!said && ['launch', 'golive', 'line', 'deadline', squash(board.launch?.name ?? 'launch')].includes(said)
}

/**
 * The plan's line moved by an amount: a week is seven calendar days (Friday to Friday); days are working days where
 * weekends don't count, else calendar days. One set_launch_day, decided by the reducer (a weekend lands on a working day).
 */
function lineBy(board, count, unit, sign) {
  const from = board.launch?.day ?? 0, n = number(count)
  if (/^w/i.test(unit)) return [{ kind: 'set_launch_day', day: from + sign * 7 * n }]
  if (!board.clock || !ruleOf(board, 'workdays', rule => rule.on)) return [{ kind: 'set_launch_day', day: from + sign * n }]
  const weekend = day => [0, 6].includes(new Date(planWords(board).iso(board, day) + 'T00:00:00Z').getUTCDay())
  let day = from
  for (let left = n; left > 0;) { day += sign; if (!weekend(day)) left-- }
  return [{ kind: 'set_launch_day', day }]
}

/** The task a line word could also mean ("launch" for "Launch post"), or null. */
const taskLike = (board, reference) => workshopReferences(board).cards.attempt(String(reference).trim().replace(/^the\s+/i, '')) ?? null

/**
 * A line word where a task was expected: ask which is meant when a task shares the word, else say how to move the
 * line. Never a guess (moving the line, or the task, the person did not mean).
 */
function lineQuestion(board, reference) {
  const word = board.launch?.name ?? 'launch'
  const move = '“Move ' + word + ' to ' + planWords(board).name(board, (board.launch?.day ?? 0) + 7) + '”'
  const card = taskLike(board, reference)
  if (card) return refused('Do you mean the ' + word + ' line or the task “' + card.label + '”? To move the line, say ' + move + '; for the task, name it: “Move ' + card.label + ' 2 days later”.')
  return refused('To move ' + word + ', say its day: ' + move + '.')
}

/** The task the words mean: the selected one for "this" or "it", else by its name (“Kick-off” for Kickoff). Asks when it can't tell. */
function taskOf(board, reference, selection) {
  // The example names a task that can be made 3 days shorter than it is.
  const example = (board.cards.find(card => (card.duration ?? 1) > 3) ?? board.cards[0]).label
  const which = () => refused('Which task? Select it on the canvas, or name it: “Make ' + example + ' 3 days”.')
  const name = (reference ?? '').trim().replace(/^(?:the\s+)?(?:(?:task|card|bar|hire)\s+(?:called\s+|named\s+)?|recruiting\s+for\s+(?:the\s+)?)/i, '')
  // "The launch" or "go-live" is the plan's line, never a task that happens to share a word with it.
  if (lineReference(board, name)) throw lineQuestion(board, name)
  if (!name || pointingTask.test(name)) {
    const chosen = selection?.kind === 'card' && board.cards.find(card => card.id === selection.id)
    if (!chosen) throw which()
    return chosen
  }
  const refs = workshopReferences(board)
  const found = refs.cards.attempt(name) ?? board.cards.filter(card => squash(card.label) === squash(name)).at(0) ?? null
  if (found) return found
  const labels = board.cards.map(card => '“' + card.label + '”')
  throw refused('There is no task called “' + name.replace(/^the\s+/i, '') + '” here. The tasks are ' + (labels.length > 1 ? labels.slice(0, -1).join(', ') + ' and ' + labels.at(-1) : labels[0]) + '.')
}

/** The calendar day a task starts on now: the first day from where it can first start that its lag reaches. */
function currentStart(board, card) {
  const plan = planWords(board), ready = plan.readyDay(board, card.id), lag = card.lag ?? 0
  for (let day = ready; day <= ready + 3 * lag + 60; day++) if (plan.lagAt(board, card.id, day) >= lag) return day
  return ready
}

/**
 * The first `weekday` (0 Sunday … 6 Saturday) on or after the day the task starts now, as a calendar day: "start it
 * on Monday" moves a task to the coming Monday, never weeks back to the first day it could start.
 */
function weekdayFrom(board, card, weekday) {
  const plan = planWords(board), first = currentStart(board, card)
  for (let day = first; day < first + 7; day++) if (new Date(plan.iso(board, day) + 'T00:00:00Z').getUTCDay() === weekday) return day
  return first
}
const mondayFrom = (board, card) => board.clock ? weekdayFrom(board, card, 1) : 0

/** The calendar day a task is asked to start on: a weekday (the first one it can start on), a date, or "day 20". */
function startDay(board, card, phrase) {
  const said = phrase.trim().replace(/^(?:on|the)\s+/i, '').replace(/\?$/, '').toLowerCase()
  const weekday = weekdayNames.findIndex(name => name === said || name.slice(0, 3) === said)
  if (weekday >= 0 && board.clock) return weekdayFrom(board, card, weekday)
  return dayOf(board, said)
}

/** A sentence about one task's days: its edits, or null when it is not one. Throws a short question when the task (or the day) is unclear. */
function taskDayEdits(board, text, selection) {
  const is = pattern => new RegExp('^' + pattern + '$', 'i').exec(text)
  const T = '(.+?)'
  const set = (ref, count, unit) => { const card = taskOf(board, ref, selection); return [{ kind: 'set_task', card: { id: card.id }, duration: daysOf(board, count, unit) }] }
  const by = (ref, count, unit, sign) => { const card = taskOf(board, ref, selection); return [{ kind: 'set_task', card: { id: card.id }, duration: (card.duration ?? 1) + sign * daysOf(board, count, unit) }] }
  const shift = (ref, count, unit, sign) => { const card = taskOf(board, ref, selection); return [{ kind: 'set_task', card: { id: card.id }, lag: (card.lag ?? 0) + sign * daysOf(board, count, unit) }] }
  let m
  // Its length: "change this to 3 days", "make it 3 days", "3 days", "change the duration (of Configure) to 3 days", "it takes 2 days".
  if ((m = is('(?:make\\s+(?:it|this)\\s+)?' + amount + '(?:\\s+long)?'))) return set(null, m[1], m[2])
  if ((m = is('(?:change|set|make|turn|update|adjust)\\s+(?:the\\s+)?(?:duration|length|days)(?:\\s+(?:of|for|on)\\s+' + T + ')?\\s+(?:to|at|into)\\s+' + amount))) return set(m[1], m[2], m[3])
  if ((m = is('(?:change|set|make|turn|update|adjust)\\s+' + T + '(?:\'s|’s)\\s+(?:duration|length)\\s+(?:to|at)\\s+' + amount))) return set(m[1], m[2], m[3])
  if ((m = is('(?:change|set|make|turn|update|adjust)\\s+' + T + '\\s+(?:to\\s+|into\\s+)?(?:be\\s+|take\\s+|last\\s+)?' + amount + '(?:\\s+long)?'))) return set(m[1], m[2], m[3])
  if ((m = is(T + '\\s+(?:takes|should\\s+take|will\\s+take|needs|lasts|should\\s+last|is)\\s+(?:only\\s+)?' + amount + '(?:\\s+long)?'))) return set(m[1], m[2], m[3])
  if ((m = is('(?:shorten|cut|trim|reduce|lengthen|extend|stretch|grow)\\s+' + T + '\\s+to\\s+' + amount))) return set(m[1], m[2], m[3])
  if ((m = is('(?:shorten|cut|trim|reduce)\\s+' + T + '\\s+by\\s+' + amount))) return by(m[1], m[2], m[3], -1)
  if ((m = is('(?:extend|lengthen|stretch|grow)\\s+' + T + '\\s+(?:by\\s+)?' + amount))) return by(m[1], m[2], m[3], 1)
  if ((m = is('(?:add)\\s+' + amount + '\\s+to\\s+' + T))) return by(m[3], m[1], m[2], 1)
  // Its start: "move it 2 days later", "push Configure back a day", "start it on Monday". The plan's line by an
  // amount ("push go-live back a week") moves the line, where no task shares its word (one that does is asked about).
  const moved = (ref, count, unit, sign) => lineReference(board, ref) && !taskLike(board, ref) ? lineBy(board, count, unit, sign) : shift(ref, count, unit, sign)
  if ((m = is('(?:move|push|shift|slide|delay|start|pull|bring)\\s+' + T + '\\s+(?:by\\s+)?' + amount + '\\s+(later|back|earlier|sooner|forward|out|in)'))) {
    return moved(m[1], m[2], m[3], /^(?:later|back|out)$/i.test(m[4]) ? 1 : -1)
  }
  if ((m = is('(?:move|push|shift|slide|delay|pull|bring)\\s+' + T + '\\s+(later|back|out|earlier|forward|sooner|in)\\s+(?:by\\s+)?' + amount))) {
    return moved(m[1], m[3], m[4], /^(?:later|back|out)$/i.test(m[2]) ? 1 : -1)
  }
  // ("Push the designer to May" on a hiring plan is when the hire starts: planEdits reads it.)
  // "Move launch to Fri, Dec 18" moves the line, and "Move Configure to Customer" the task to a team: not these.
  m = is('(?:start|begin)\\s+' + T + '\\s+(?:on|from)\\s+(.+)') ?? (board.kind === 'launch-plan' ? is('(?:move|push|pull|bring)\\s+' + T + '\\s+to\\s+(?:start\\s+on\\s+)?(.+)') : null)
  if (m && lineReference(board, m[1])) {
    // "Move launch to Fri, Dec 18" is the line's (planEdits); "start the launch on Friday" asks which is meant.
    if (/^move\s/i.test(text) || (/^(?:push|pull|bring)\s/i.test(text) && !taskLike(board, m[1]))) return null
    throw lineQuestion(board, m[1])
  }
  if (m && !workshopReferences(board).lanes.attempt(m[2])) {
    const card = taskOf(board, m[1], selection)
    const day = startDay(board, card, m[2])
    if (day === null) {
      // "Move Configure to Customer" is a move to a team, read by the lane conversation; anything else here is a day we could not read.
      if (/^(?:move|push|pull|bring)\s/i.test(text)) return null
      throw refused('Which day? Say a date, such as “start it on ' + planWords(board).name(board, mondayFrom(board, card)) + '”.')
    }
    return [{ kind: 'set_task', card: { id: card.id }, lag: planWords(board).lagAt(board, card.id, day) }]
  }
  return null
}

/** A question about a plan, answered from it with no change: "What breaks if Auth slips a week?". `{ reply }` or null. */
function planQuestion(board, text, actor) {
  const m = new RegExp('^what\\s+(?:breaks|happens)\\s+if\\s+(.+?)\\s+slips\\s+(?:by\\s+)?' + N + '\\s+(days?|weeks?)\\??$', 'i').exec(text)
  const refs = workshopReferences(board)
  const card = m && refs.cards.attempt(m[1])
  if (!card) return null
  const by = number(m[2]) * (/^w/i.test(m[3]) ? (ruleOf(board, 'workdays') ? 5 : 7) : 1)
  const result = applyWorkshopEdits(board, [{ kind: 'set_task', card: { id: card.id }, lag: (card.lag ?? 0) + by }], { actor: { by: actor?.by || 'Someone', via: 'chat' } })
  if ('refused' in result) return { reply: 'That breaks a rule: ' + result.refused.reason }
  return { reply: 'Nothing breaks. ' + result.report.edits.map(edit => edit.said).join(' ') }
}

/**
 * The plan's ends in words: its first day ("start the plan on Nov 30", "move the start a week earlier", "start the
 * plan 3 days later"), every task keeping its dates (set_plan_start), and how long a hiring plan runs ("run the plan
 * 60 weeks", "extend the plan by 4 weeks"; set_plan_weeks). Null for any other sentence.
 */
function planEndEdits(board, text, selection = null) {
  if (!board.clock) return null
  const plan = '(?:the\\s+)?(?:plan|timeline|schedule|chart)'
  const start = '(?:(?:the\\s+)?(?:plan(?:\'|’)s\\s+)?(?:start(?:\\s+(?:date|day))?|first\\s+day))'
  const iso = day => planWords(board).iso(board, day)
  let m
  // "Start on 1 Dec" (the plan in focus, or nothing selected) is the plan's first day; with a task selected it is not read here.
  const bare = selection?.kind === 'card' ? null : /^(?:start|begin)\s+(?:on|from)\s+(.+)$/i.exec(text)
  if ((m = bare ?? new RegExp('^(?:start|begin)\\s+' + plan + '\\s+(?:on|from)\\s+(.+)$', 'i').exec(text) ?? new RegExp('^(?:move|set|change|push|pull|bring)\\s+' + start + '\\s+(?:back\\s+|forward\\s+)?to\\s+(.+)$', 'i').exec(text))) {
    // The nearest such date: a first day may move half a year either way, so "Nov 16" before the start is this November.
    const day = dayOf(board, m[1], -183)
    if (day === null) throw refused('Which day? Say a date, such as “Start the plan on ' + planWords(board).name(board, 7) + '”.')
    return [{ kind: 'set_plan_start', start: iso(day) }]
  }
  const by = (count, unit, word) => {
    const n = number(count) * (/^w/i.test(unit) ? 7 : 1)
    return [{ kind: 'set_plan_start', start: iso(/^(?:later|back|out)$/i.test(word) ? n : -n) }]
  }
  // "Start a week earlier" (no task named) is the plan's; "start it a week earlier" stays a task's.
  if ((m = new RegExp('^(?:(?:start|begin)(?:\\s+' + plan + ')?|(?:move|push|pull|bring|shift)\\s+' + start + ')\\s+(?:by\\s+)?' + amount + '\\s+(later|back|earlier|sooner|forward|out)$', 'i').exec(text))) return by(m[1], m[2], m[3])
  // "Make this a 3-week plan", "make the plan 3 weeks long": the span from the first day (boards S2b). A launch
  // plan goes live on the last working day of that week; a hiring plan runs that many weeks.
  // ("Make this 4 weeks" with a hire selected is that hire's recruiting: the plan is named, or it is "a N-week plan".)
  const span = '(\\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)'
  if ((m = new RegExp('^(?:make|turn)\\s+(?:this|it)\\s+(?:into\\s+)?an?\\s+' + span + '[-\\s]weeks?\\s+(?:plan|timeline|schedule|project)$', 'i').exec(text) ??
      new RegExp('^(?:make|set)\\s+(?:the|this)\\s+(?:plan|timeline|schedule)\\s+' + span + '\\s+weeks?(?:\\s+long)?$', 'i').exec(text))) {
    const weeks = /^\d+$/.test(m[1]) ? Number(m[1]) : /^an?$/i.test(m[1]) ? 1 : ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'].indexOf(m[1].toLowerCase()) + 1
    if (weeks < 1) return null
    if (board.kind === 'hiring-plan') return [{ kind: 'set_plan_weeks', weeks }]
    const weekend = day => [0, 6].includes(new Date(planWords(board).iso(board, day) + 'T00:00:00Z').getUTCDay())
    let day = weeks * 7 - 1
    if (ruleOf(board, 'workdays', rule => rule.on)) while (day > 0 && weekend(day)) day--
    return [{ kind: 'set_launch_day', day }]
  }
  if (board.kind === 'hiring-plan') {
    if ((m = new RegExp('^(?:run|make|set)\\s+' + plan + '\\s+(?:for\\s+|to\\s+)?(\\d{1,3})\\s+weeks?(?:\\s+long)?$', 'i').exec(text))) return [{ kind: 'set_plan_weeks', weeks: Number(m[1]) }]
    if ((m = new RegExp('^(extend|lengthen|shorten|cut)\\s+' + plan + '\\s+by\\s+' + N + '\\s+weeks?$', 'i').exec(text))) {
      return [{ kind: 'set_plan_weeks', weeks: board.hiring.weeks + (/^(?:extend|lengthen)$/i.test(m[1]) ? 1 : -1) * number(m[2]) }]
    }
  }
  return null
}

/** The plan conversation: `{ edits }`, `{ reply }` (a question answered), or null for any other sentence. */
export function planChat(board, text, actor, selection = null) {
  if (!isPlan(board)) return null
  const answer = planQuestion(board, text, actor)
  if (answer) return answer
  // The plan's own ends (its first day, a hiring plan's weeks), before a task's days could read "the plan" as a task.
  const ends = planEndEdits(board, text.replace(/\?$/, ''), selection)
  if (ends) return { edits: ends }
  // A task's days, before anything that would read them as a name or a lane.
  const days = taskDayEdits(board, text.replace(/\?$/, ''), selection)
  if (days) return { edits: days }
  // "What if the round closes in June?" is a change to preview, not a question to answer.
  const edits = planEdits(board, text.replace(/\?$/, ''))
  return edits ? { edits } : null
}
