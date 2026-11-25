// The signed-out "Create slate" first run (/new with no hash): one question, eight jobs, a second
// one-click question for five of them, an own-words row, and Skip. Each answer names one plan: the
// board it opens (a business brief, a library preset or sample with its cards, typed steps or lanes),
// its title, the two lines of its "How this board works" note, three Ask Slatebox starters, and who
// Share invites. Pure data and reading: no engine import, so the page that asks loads nothing heavy.
// The server builds the board from the plan (server/first-slate-board.mjs) with no agent call.

export const FIRST_SLATE_VERSION = 1
export const FIRST_TEXT_LIMIT = 1200
export const STORAGE_KEY = 'slatebox.start'

/** The eight jobs, in the order the page shows them. `group` orders the library for this person. */
export const JOBS = Object.freeze([
  { id: 'ship', title: 'Ship something by a date', line: 'Tasks on real workdays, a launch line, slips push what’s waiting.', group: 'plan', label: 'shipping by a date' },
  { id: 'week', title: 'Run our week', line: 'A board where Doing holds 3 and nothing skips review.', group: 'track', label: 'running the week' },
  { id: 'deals', title: 'Track deals to a target', line: 'A pipeline with a live weighted forecast.', group: 'track', label: 'tracking deals' },
  { id: 'golive', title: 'Get a customer live', line: 'One plan for your steps and theirs, toward a go-live date.', group: 'plan', label: 'customer go-lives' },
  { id: 'feedback', title: 'Make sense of feedback', line: 'Customer quotes that re-rank as you sort them.', group: 'decide', label: 'customer feedback' },
  { id: 'lookback', title: 'Look back and improve', line: 'A retro, an incident review, or a 5 whys.', group: 'meetings', label: 'looking back and improving' },
  { id: 'money', title: 'Plan a budget or hires', line: 'A fixed total, or runway that moves as hires move.', group: 'plan', label: 'budgets and hiring' },
  { id: 'plan', title: 'Plan my week or term', line: 'Now, Next, Later, where Next holds 3.', group: 'plan', label: 'planning a week or term' },
])

const WHO = [{ id: 'team', label: 'My team' }, { id: 'me', label: 'Just me' }, { id: 'client', label: 'A client' }]
/** The second question, for the jobs that ask one. */
export const STEP_TWO = Object.freeze({
  ship: { question: 'Who’s it with?', chips: WHO },
  week: { question: 'Who’s it with?', chips: WHO },
  lookback: { question: 'Who’s it with?', chips: [{ id: 'team', label: 'My team, a sprint or project' }, { id: 'broke', label: 'Something broke' }, { id: 'me', label: 'Just me, a stubborn problem' }] },
  money: { question: 'Which one?', chips: [{ id: 'team', label: 'A team budget' }, { id: 'personal', label: 'A personal budget' }, { id: 'hires', label: 'Hires and runway' }] },
  plan: { question: 'Who’s it with?', chips: [{ id: 'school', label: 'School' }, { id: 'life', label: 'Work and life' }] },
})

export const jobOf = id => JOBS.find(job => job.id === id) ?? null
export const asksStepTwo = id => Object.hasOwn(STEP_TWO, id ?? '')
export const validWith = (job, value) => asksStepTwo(job) ? STEP_TWO[job].chips.some(chip => chip.id === value) : value === undefined || value === null
/** What the page says while it builds: "Building your launch plan…". */
export const buildingLine = title => 'Building your ' + String(title || 'board').toLowerCase() + '…'

// A starter is a whole message; `part` is what a person most likely replaces (selected when it fills
// the box). `kind` says how it is read: a change to the board ('edit'), a board brief ('brief'), a library
// add ('add') or typed steps ('steps').
const starter = (text, part, kind = 'edit') => {
  const from = part ? text.lastIndexOf(part) : -1
  return from < 0 ? { text, kind } : { text, kind, select: [from, from + part.length] }
}
const edit = (text, part) => starter(text, part, 'edit')
const add = text => starter(text, null, 'add')

const ADD_RETRO = add('Add a retro')
const ADD_NNL = add('Add a now next later board')
const ADD_GOLIVE = add('Add a customer go-live')
const ADD_TEAM = add('Add a team board')

const launchNote = (first, rest) => ['Drag ' + first + ' later and ' + rest + ' move with it.', 'The red line is launch day; nothing may cross it.']
const shipStarter = starter('Plan a launch for day 18: Design 4 days, Build 6 days after Design, QA 2 days after Build',
  'Design 4 days, Build 6 days after Design, QA 2 days after Build', 'brief')
const cards = (lane, ...labels) => labels.map(label => ({ lane, label }))
const weekNote = ['Doing holds 3. Cards move one column at a time; Won’t do is the bin.', 'Drag a card across, or ask Slatebox to move one.']

/**
 * Every answer's plan, by "job.with" (or the job alone). Dates count from next Monday, in workdays.
 * Launch days leave a few workdays of slack past the critical path, so a first slip still lands.
 */
const PLANS = {
  'ship.team': { title: 'Launch plan', board: { kind: 'brief', dated: true,
    brief: 'Plan a launch for day 25: Scope 2 days on Product, Design 4 days after Scope on Product, Build 6 days after Design on Engineering, QA 2 days after Build on Engineering, Launch copy 2 days on Marketing, Announce 1 day after QA on Marketing' },
    note: launchNote('Build', 'QA and Announce'), starters: [shipStarter, edit('Make Build 8 days'), ADD_RETRO], share: 'team' },
  'ship.me': { title: 'My launch plan', board: { kind: 'brief', dated: true,
    brief: 'Plan a launch for day 18: Outline 2 days on Me, Draft 4 days after Outline on Me, Review 2 days after Draft on Reviewer, Polish 2 days after Review on Me, Publish 1 day after Polish on Me' },
    note: launchNote('Draft', 'Review, Polish and Publish'), starters: [shipStarter, edit('Make Draft 6 days'), ADD_NNL], share: null },
  'ship.client': { title: 'Client delivery plan', board: { kind: 'brief', dated: true,
    brief: 'Plan a launch for day 25: Kickoff 1 day on Us, Draft 5 days after Kickoff on Us, Client review 3 days after Draft on Client, Revisions 3 days after Client review on Us, Sign-off 1 day after Revisions on Client' },
    note: launchNote('Draft', 'Client review, Revisions and Sign-off'), starters: [shipStarter, edit('Make Client review 5 days'), ADD_GOLIVE], share: 'client' },

  'week.team': { title: 'Our week', board: { kind: 'preset', preset: 'team-board',
    cards: [...cards('todo', 'Write the weekly update', 'Review open requests', 'Fix the top customer issue', 'Prep the demo'), ...cards('doing', 'Plan next sprint')] },
    note: weekNote, starters: [edit('Add a card called your first task to To do', 'your first task'), edit('Move Prep the demo to Doing'), ADD_RETRO], share: 'team' },
  'week.me': { title: 'My week', board: { kind: 'preset', preset: 'team-board',
    lanes: [['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done']], capacity: { doing: 2 },
    cards: cards('todo', 'Inbox to zero', 'Finish the proposal', 'Book 1:1s', 'Plan next week') },
    note: ['Doing holds 2, so finish before you start.', 'Cards move one column at a time.'],
    starters: [edit('Add a card called your first task to To do', 'your first task'), edit('Move Plan next week to Doing'), ADD_NNL], share: null },
  'week.client': { title: 'Client work', board: { kind: 'preset', preset: 'team-board',
    lanes: [['todo', 'Requested'], ['doing', 'In progress'], ['review', 'With client'], ['done', 'Done']],
    cards: cards('todo', 'Homepage copy', 'Logo files', 'Launch checklist') },
    note: ['In progress holds 3. Work moves one column at a time, so nothing skips the client.', 'Share it with your client so both sides see where things are.'],
    starters: [edit('Add a card called your first request to Requested', 'your first request'), edit('Move Launch checklist to In progress'), ADD_GOLIVE], share: 'client' },

  deals: { title: 'Pipeline', board: { kind: 'brief', brief: 'Make a sales pipeline with Northwind 40k, Acme 25k, Globex 60k, Brightline 15k, target 250k' },
    note: ['These deals are examples. The forecast is each deal times its stage’s odds.', 'Proposal holds 3; deals move one stage at a time.'],
    starters: [starter('Make a sales pipeline with Northwind 40k, Acme 25k, Globex 60k, target 250k', 'Northwind 40k, Acme 25k, Globex 60k', 'brief'), edit('Move Acme to Qualified'), ADD_GOLIVE], share: null },

  golive: { title: 'Customer go-live', board: { kind: 'sample', sample: 'go-live' },
    note: ['Their steps and yours, on workdays.', 'Share it with your customer so both sides see the date.'],
    starters: [edit('Rename the workshop to Acme go-live', 'Acme go-live'), edit('Make Security review 5 days'), ADD_RETRO], share: 'client' },

  feedback: { title: 'Customer feedback', board: { kind: 'sample', sample: 'sort-evidence' },
    note: ['Piles re-rank by how many customers said it.', 'These quotes are examples; paste yours.'],
    starters: [edit('Add a card called paste a customer quote to Onboarding', 'paste a customer quote'), edit('Move I don’t trust the numbers to Reporting'), add('Add a discovery tree')], share: null },

  'lookback.team': { title: 'Retro', board: { kind: 'preset', preset: 'retro',
    cards: [...cards('well', 'Shipped on time'), ...cards('change', 'Too many meetings'), ...cards('try', 'Pair on reviews')] },
    note: ['Each column holds 3, so pick what matters.', 'Present walks the team through it.'],
    starters: [edit('Add a card called what went well to Went well', 'what went well'), edit('Move Too many meetings to Try'), ADD_TEAM], share: 'team' },
  'lookback.broke': { title: 'Incident review', board: { kind: 'sample', sample: 'incident-review',
    relabel: { outage: 'What broke and when', certificate: 'What we saw first', rollback: 'Why it reached customers', 'rota-alerts': 'Add an alert for it', 'script-rollback': 'Make the fix stick' },
    reparent: { 'rota-alerts': 'certificate' }, remove: ['alert-inbox', 'status-page'] },
    note: ['Causes sit under the problem, and fixes under their causes.', 'Write what happened first; ask Slatebox to add a cause or a fix.'],
    starters: [edit('Add a cause called Missing alert', 'Missing alert'), edit('Rename the workshop to Sign-in outage review', 'Sign-in outage review'), ADD_TEAM], share: 'team' },
  'lookback.me': { title: 'Break it down', board: { kind: 'sample', sample: 'break-down',
    relabel: { problem: 'The stubborn problem', 'drop-off': 'Why does it happen?', 'price-rise': 'What makes it worse?', 'needs-engineer': 'And why is that?', guided: 'One small thing to try', survey: 'Ask someone who solved it' },
    remove: ['free-tier'] },
    note: ['Ask why, then why again, until you reach something you can change.', 'Put a fix under the cause it answers.'],
    starters: [edit('Add a cause called Not enough time', 'Not enough time'), edit('Rename the workshop to Why I keep putting it off', 'Why I keep putting it off'), ADD_NNL], share: null },

  'money.team': { title: 'Budget', board: { kind: 'brief', brief: 'Split a 1.2M budget across Product, Sales, Marketing and Operations; Product at least 400k' },
    note: ['The total stays fixed: give one team more and the rest give way.', 'Product can’t drop below 400k.'],
    starters: [starter('Split a 1.2M budget across Product, Sales and Marketing', '1.2M', 'brief'), edit('Move $50k from Sales to Marketing'), add('Add a hiring plan')], share: null },
  'money.personal': { title: 'My budget', board: { kind: 'brief', brief: 'Split a 60k budget across Rent, Savings, Travel and Everyday; Savings at least 10k' },
    note: ['The total stays fixed: give one line more and the rest give way.', 'Savings can’t drop below 10k.'],
    starters: [starter('Split a 60k budget across Rent, Savings and Everyday', '60k', 'brief'), edit('Move $5k from Travel to Savings'), ADD_NNL], share: null },
  'money.hires': { title: 'Hiring plan and runway', board: { kind: 'sample', sample: 'hiring-plan' },
    note: ['These numbers are examples. Move a hire and runway updates.', 'Set your own cash and burn.'],
    starters: [edit('Rename the workshop to Our hiring plan', 'Our hiring plan'), edit('Make Designer 4 weeks'), starter('Split a 1.2M budget across Engineering, Product and Sales', 'Engineering, Product and Sales', 'brief')], share: null },

  'plan.school': { title: 'This term', board: { kind: 'preset', preset: 'now-next-later',
    cards: [...cards('now', 'Read chapters 4 and 5', 'Problem set 3'), ...cards('next', 'Essay outline', 'Lab report'), ...cards('later', 'Final review')] },
    note: ['Next holds 3, so the list stays honest.', 'Drag a card to Now when you start it.'],
    starters: [edit('Add a card called your next assignment to Now', 'your next assignment'), edit('Move Lab report to Now'), starter('Read chapter 5 → Make flash cards → Practice test', null, 'steps')], share: null },
  'plan.life': { title: 'This week', board: { kind: 'preset', preset: 'now-next-later',
    cards: [...cards('now', 'Finish the application', 'Plan the trip'), ...cards('next', 'Call the bank'), ...cards('later', 'Gym 3 times')] },
    note: ['Next holds 3, so the list stays honest.', 'Drag a card to Now when you start it.'],
    starters: [edit('Add a card called your next task to Now', 'your next task'), edit('Move Call the bank to Now'), add('Add a break down a problem board')], share: null },

  skip: { title: 'This week', board: { kind: 'preset', preset: 'team-board',
    lanes: [['todo', 'To do'], ['doing', 'Doing'], ['review', 'Review'], ['done', 'Done']],
    // Doing starts with 2: "Drag me to Doing" makes 3, and the next card dragged in is refused.
    cards: [...cards('todo', 'Write your first task here', 'Drag me to Doing'), ...cards('doing', 'Doing holds 3: try a 4th', 'Drop a note in to make a card')] },
    note: ['Doing holds 3. Cards move one column at a time.', 'Rename anything by typing on it, or ask Slatebox.'],
    starters: [edit('Add a card called your first task to To do', 'your first task'), edit('Move Drag me to Doing to Doing'), edit('Add a column called Blocked', 'Blocked')], share: 'team' },
}

/** Every plan's key, for the tests and the server's check. */
export const PLAN_KEYS = Object.freeze(Object.keys(PLANS))

const clone = value => JSON.parse(JSON.stringify(value))
const keyOf = (job, withId) => asksStepTwo(job) ? job + '.' + withId : job

/**
 * The plan for a one-click answer: `{ key, job, with, title, board, note, starters, share }`. An unknown
 * job, or a step-two answer that is not one of its chips, opens the Skip board.
 */
export function firstSlatePlan({ job, with: withId } = {}) {
  const key = jobOf(job) && validWith(job, withId) ? keyOf(job, withId) : 'skip'
  const plan = clone(PLANS[key])
  const skip = key === 'skip'
  return { key, job: skip ? null : job, with: skip || !asksStepTwo(job) ? null : withId, ...plan }
}

// Their own words. The openers the server's brief readers take (business-board-brief.mjs and
// native-lane-brief.mjs), kept here as patterns so the page that asks loads no board rules; the tests
// check they agree with the readers.
export const BRIEF_OPENER = /^(?:plan\s+a\s+launch|make\s+a\s+launch\s+plan|make\s+a\s+(?:sales\s+)?pipeline|make\s+a\s+budget|split\s+(?:a\s+|the\s+)?\S+\s+budget)\b/i
const LANES_OPENER = /^(?:make|create|build|start|add) (?:an? )?(?:interactive )?(?:lane )?workshop (?:with|using) /i
const COLUMNS = /^(?:(?:make|create|build|start|add)\s+(?:an?\s+)?(?:board\s+)?)?(?:with\s+)?columns?\s*(?:with\s+)?:?\s*(.+)$/i
const KEYWORDS = [
  [/\b(?:feedback|interviews?|research)\b/i, 'feedback'],
  [/\b(?:outages?|incidents?|broke|broken|postmortem|post-mortem)\b/i, 'lookback.broke'],
  [/\b(?:retros?|retrospective|sprint review)\b/i, 'lookback.team'],
  [/\b(?:hires?|hiring|runway|headcount)\b/i, 'money.hires'],
  [/\bbudgets?\b/i, 'money.team'],
  [/\b(?:customers?|onboarding|go-live|go live)\b/i, 'golive'],
  [/\b(?:study|studying|exams?|essays?|homework|class(?:es)?|term)\b/i, 'plan.school'],
]

// A team board without Won't do: room for a column of their own ("Add a column called Blocked").
const FOUR_LANES = [['todo', 'To do'], ['doing', 'Doing'], ['review', 'Review'], ['done', 'Done']]
const tidy = text => String(text ?? '').replace(/\r\n?/g, '\n').trim()
const titled = text => {
  const line = tidy(text).replace(/\s+/g, ' ')
  return line.length > 60 ? line.slice(0, 59).replace(/\s+\S*$/, '') + '…' : line
}
const itemsOf = text => {
  const lines = tidy(text).split('\n').map(line => line.trim().replace(/^[-*•]\s+|^\d+[.)]\s+/, '')).filter(Boolean)
  const parts = lines.length > 1 ? lines : lines[0]?.split(/\s*,\s*/).filter(Boolean) ?? []
  return parts.map(part => part.slice(0, 80))
}

/**
 * Their own words, read with no agent call (first match wins): a launch, pipeline or budget brief; lanes
 * ("Make a workshop with Ideas, Pilot and Done" or "columns: …"); typed steps (→ or ->); a keyword that
 * names a job, titled with their words; else a team board, its To do the lines or comma items they wrote,
 * or the one phrase as its title and first card. `route` names which.
 */
export function resolveFirstText(input) {
  const text = tidy(input)
  if (!text || text.length > FIRST_TEXT_LIMIT) throw new Error('Say it in up to 1,200 characters.')
  const brief = text.replace(/\s*\n\s*/g, ' ')
  if (BRIEF_OPENER.test(brief)) return { route: 'brief', key: 'text.brief', title: null, board: { kind: 'brief', brief, dated: /^(?:plan\s+a\s+launch|make\s+a\s+launch\s+plan)/i.test(brief) } }
  if (LANES_OPENER.test(brief)) return { route: 'lanes', key: 'text.lanes', title: null, board: { kind: 'lanes', brief } }
  const columns = COLUMNS.exec(brief)
  if (columns && /,|\band\b/i.test(columns[1])) return { route: 'lanes', key: 'text.lanes', title: null, board: { kind: 'lanes', brief: 'Make a workshop with ' + columns[1].replace(/\.$/, '') } }
  if (/→|->/.test(text)) return { route: 'steps', key: 'text.steps', title: null, board: { kind: 'steps', brief: text } }
  const found = KEYWORDS.find(([pattern]) => pattern.test(text))
  if (found) {
    const [job, withId] = found[1].split('.')
    return { route: 'keyword', key: 'text.' + found[1], job, with: withId ?? null, title: titled(text) }
  }
  const items = itemsOf(text)
  if (items.length > 1) return { route: 'list', key: 'text.list', title: 'Our board', board: { kind: 'preset', preset: 'team-board', lanes: FOUR_LANES, cards: cards('todo', ...items.slice(0, 12)) } }
  return { route: 'phrase', key: 'text.phrase', title: titled(text), board: { kind: 'preset', preset: 'team-board', lanes: FOUR_LANES, cards: cards('todo', titled(text)) } }
}

// The first lane a lanes brief names ("Make a workshop with Ideas, Pilot and Done" → Ideas).
const firstLaneOf = brief => (/\b(?:with|using)\s+(?:lanes?[: ]+)?(.+)$/i.exec(brief)?.[1] ?? 'To do').split(/\s*(?:,|\band\b)\s*/i)[0].trim()

/**
 * The plan for their own words: a job's plan (keywords) with their title, or a plan of its own.
 * `creationBrief` is what Ask Slatebox says they asked for.
 */
export function firstTextPlan(input) {
  const read = resolveFirstText(input)
  const creationBrief = tidy(input).slice(0, FIRST_TEXT_LIMIT)
  if (read.route === 'keyword') {
    const plan = firstSlatePlan({ job: read.job, with: read.with ?? undefined })
    return { ...plan, key: read.key, route: read.route, title: read.title, creationBrief }
  }
  const lanes = read.board.kind === 'preset'
  return {
    key: read.key, route: read.route, job: null, with: null, title: read.title, board: read.board, creationBrief,
    note: read.board.kind === 'steps' ? ['Each step is a note you can drag, rename or delete.', 'Type more steps with arrows in Ask Slatebox to add to it.']
      : read.board.kind === 'lanes' ? ['Each column is yours: drag cards across, rename anything.', 'Ask Slatebox to add a card or set a limit.']
      : read.board.kind === 'brief' ? ['Built from your words. Change a number in Ask Slatebox and the board follows.', 'Every rule is listed under the board.']
      : ['Doing holds 3. Cards move one column at a time.', 'Drag a card across, or ask Slatebox to move one.'],
    starters: read.board.kind === 'steps' ? [starter('Add Review after ' + read.board.brief.split(/→|->/)[0].trim(), 'Review', 'steps'), ADD_TEAM, ADD_NNL]
      : lanes ? [edit('Add a card called your next task to To do', 'your next task'), edit('Add a column called Blocked', 'Blocked'), ADD_RETRO]
      : read.board.kind === 'lanes' ? [edit('Add a card called your first card to ' + firstLaneOf(read.board.brief), 'your first card'), edit('Rename the workshop to Our board', 'Our board'), ADD_RETRO]
      : [edit('Rename the workshop to Our plan', 'Our plan'), ADD_RETRO, ADD_TEAM],
    share: null,
  }
}

/** What the browser remembers (localStorage 'slatebox.start'), and what the server stores on the guest. */
export function startRecord({ job = null, with: withId = null, via }) {
  return { job: job ?? null, with: withId ?? null, via, v: FIRST_SLATE_VERSION }
}

/** Whether this browser or account has answered (or skipped) the first run. */
export function hasStarted(profileStart, stored) {
  if (profileStart && typeof profileStart === 'object') return true
  if (!stored) return false
  try { const read = JSON.parse(stored); return Boolean(read && typeof read === 'object' && read.v) } catch { return false }
}

/** The one line an agent hears about this person, after sign-in: "Works on: shipping by a date". */
export function worksOnLine(profileStart) {
  const job = jobOf(profileStart?.job)
  return job ? 'Works on: ' + job.label : null
}

/** The library group to show first for this person, or null. */
export const startGroup = profileStart => jobOf(profileStart?.job)?.group ?? null

/** The Share button's words on a first-run slate until Share is first opened: who the board is for. */
export function firstShareLabel(firstRun) {
  if (!firstRun || firstRun.shareSeen) return 'Share'
  return firstRun.share === 'team' ? 'Invite your team' : firstRun.share === 'client' ? 'Share with your customer' : 'Share'
}
