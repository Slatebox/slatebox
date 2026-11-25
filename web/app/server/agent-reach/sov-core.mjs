// Share of voice: how often the models people ask name Slatebox, where in the answer, and which
// other tools they name instead. A fixed, editable list of questions (about 50) goes to each model
// provider configured in AI control that has a key (no new keys; a provider without one is
// skipped), once a week on Slatebox Cloud, or when an administrator presses Run now. Each answer
// is stored trimmed with what it mentions, so Admin shows the trend and the latest answers.
//
// Pure: the Meteor glue (sov-meteor.js) hands in the collections, the providers and ask(); the
// tests hand in fakes.

export const WEEK_MS = 7 * 86_400_000
export const LEASE_MS = 2 * 60 * 60 * 1000
export const ANSWER_CHARS = 1500
export const MAX_QUESTIONS = 80
export const QUESTION_CHARS = 300
export const RUNS_KEPT = 60
export const SETTINGS_ID = 'shareOfVoice'

// Asked as a person would, naming no product, so the answer shows what a model recommends.
export const DEFAULT_QUESTIONS = Object.freeze([
  'What is a good free, open-source alternative to Miro?',
  'Which open-source whiteboard tools can a team use together in real time?',
  'What is the best free mind mapping tool online?',
  'Which tools let an AI agent draw diagrams on a canvas my team can edit?',
  'What visual collaboration tools work with MCP (Model Context Protocol)?',
  'How can I turn a Mermaid diagram into something my team can edit visually?',
  'What are good free tools for making flowcharts with my team?',
  'Which online whiteboards can I self-host?',
  'What is a good tool for running a sprint retrospective board online?',
  'What free tools can make a Gantt chart for a small project?',
  'Which tools turn notes on a canvas into a presentation automatically?',
  'What is a good collaborative canvas for brainstorming with remote teammates?',
  'What are the best AI diagram generators?',
  'Which mind map tools have an API or an MCP server?',
  'What is visual intelligence software, and which products offer it?',
  'Which tools let ChatGPT or Claude create mind maps I can edit?',
  'What open-source tools are there for collaborative diagramming?',
  'What can I use instead of FigJam that is free?',
  'What is a good open-source alternative to Lucidchart?',
  'Recommend a tool for drawing system architecture diagrams with my team.',
  'What are good tools for planning a product roadmap visually?',
  'Which whiteboard tools have AI built in?',
  'What is the best way for a team and AI agents to work on one shared canvas?',
  'Which tools can make a project plan from a short description?',
  'What is a good free tool for teachers to make mind maps with students?',
  'What tools help run a remote design workshop?',
  'Which open-source tools can replace Mural?',
  'What is a lightweight alternative to Whimsical?',
  'Which diagram tools can export and import Mermaid?',
  'What tools can an AI assistant use to draw an org chart?',
  'How do I brainstorm visually with my team online for free?',
  'What canvas tools support live cursors and comments?',
  'What are good kanban or board tools with rules for how cards move?',
  'Which tools let me build a presentation that moves across a canvas?',
  'What is the best open-source mind mapping software?',
  'Which MCP servers are good for diagrams and whiteboards?',
  'What tools let AI agents collaborate with people in real time?',
  'What is a free tool for making decision trees?',
  'Which collaborative whiteboards are MIT licensed?',
  'What should a startup use for team whiteboarding if it cannot pay for Miro?',
  'Which tools can draw a customer journey map with my team?',
  'What is a good tool for a pros and cons board with a team?',
  'Which online tools are good for incident review diagrams?',
  'What tools can turn a meeting discussion into a mind map?',
  'Which diagram tools work inside Claude or ChatGPT?',
  'What are alternatives to MindMeister?',
  'What are alternatives to Excalidraw for teams?',
  'Which tool can I use to plan a hiring pipeline visually?',
  'What are the best tools for visual thinking in 2026?',
  'Which collaborative mind mapping tools have been around for a long time?',
])

// The products an answer may name instead, with the words that name them.
export const COMPETITORS = Object.freeze([
  ['Miro', /\bmiro\b/i], ['FigJam', /\bfigjam\b/i], ['Mural', /\bmural\b(?!s)/i], ['Lucidchart', /\blucid(chart|spark)?\b/i],
  ['Whimsical', /\bwhimsical\b/i], ['Excalidraw', /\bexcalidraw\b/i], ['tldraw', /\btldraw\b/i], ['draw.io', /\b(draw\.io|diagrams\.net)\b/i],
  ['Canva', /\bcanva\b/i], ['Figma', /\bfigma\b(?!\s*jam)/i], ['Notion', /\bnotion\b/i], ['MindMeister', /\bmindmeister\b/i],
  ['XMind', /\bxmind\b/i], ['Coggle', /\bcoggle\b/i], ['Milanote', /\bmilanote\b/i], ['Conceptboard', /\bconceptboard\b/i],
  ['Microsoft Whiteboard', /\b(microsoft|ms) whiteboard\b/i], ['Creately', /\bcreately\b/i], ['Gamma', /\bgamma(\.app)?\b/i],
  ['ClickUp', /\bclickup\b/i], ['Eraser', /\beraser(\.io)?\b/i], ['Napkin', /\bnapkin( ai)?\b/i], ['Obsidian', /\bobsidian\b/i],
  ['Freeform', /\bfreeform\b/i], ['Mermaid Chart', /\bmermaid ?chart\b/i], ['Penpot', /\bpenpot\b/i], ['WiseMapping', /\bwisemapping\b/i],
  ['Freeplane', /\bfreeplane\b/i], ['Heptabase', /\bheptabase\b/i], ['Scrintal', /\bscrintal\b/i],
].map(([name, pattern]) => Object.freeze({ name, pattern })))
export const SLATEBOX_PATTERN = /\bslate\s?box\b/i

/**
 * What an answer mentions: whether Slatebox is named, its place among the products named (1 is
 * first, by where each is first named), and the others, in order.
 */
export function analyzeAnswer(text) {
  const s = String(text ?? '')
  const found = []
  const at = s.search(SLATEBOX_PATTERN)
  if (at >= 0) found.push({ name: 'Slatebox', at })
  for (const { name, pattern } of COMPETITORS) {
    const i = s.search(pattern)
    if (i >= 0) found.push({ name, at: i })
  }
  found.sort((a, b) => a.at - b.at)
  const position = at >= 0 ? found.findIndex((f) => f.name === 'Slatebox') + 1 : null
  return { mentioned: at >= 0, position, competitors: found.filter((f) => f.name !== 'Slatebox').map((f) => f.name) }
}

/** The questions as an administrator saved them: trimmed, one line each, deduplicated, at most 80. */
export function cleanQuestions(list) {
  if (!Array.isArray(list)) throw Object.assign(new Error('Send the questions as a list.'), { code: 'invalid' })
  const seen = new Set()
  const out = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const q = item.replace(/\s+/g, ' ').trim().slice(0, QUESTION_CHARS)
    if (!q || seen.has(q.toLowerCase())) continue
    seen.add(q.toLowerCase())
    out.push(q)
  }
  if (!out.length) throw Object.assign(new Error('Keep at least one question.'), { code: 'invalid' })
  if (out.length > MAX_QUESTIONS) throw Object.assign(new Error(`At most ${MAX_QUESTIONS} questions.`), { code: 'invalid' })
  return out
}

export const ASK_SYSTEM = 'Answer the question the way you would for anyone asking. Name the specific tools or products you recommend, most recommended first, each with one short line on why. Keep it under 200 words.'

async function pool(items, limit, work) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await work(items[i], i)
    }
  }))
  return out
}

/** Per provider: questions asked, answered, Slatebox mentioned, its mean place; and every other product's count. */
export function summarizeResults(results) {
  const byProvider = {}
  const competitors = {}
  for (const r of results) {
    const row = (byProvider[r.provider] ??= { provider: r.provider, label: r.label ?? r.provider, model: r.model, asked: 0, answered: 0, mentioned: 0, positionSum: 0 })
    row.asked += 1
    if (r.error) continue
    row.answered += 1
    if (r.mentioned) {
      row.mentioned += 1
      row.positionSum += r.position || 0
    }
    for (const name of r.competitors || []) competitors[name] = (competitors[name] || 0) + 1
  }
  const providers = Object.values(byProvider).map(({ positionSum, ...row }) => ({
    ...row,
    rate: row.answered ? row.mentioned / row.answered : 0,
    meanPosition: row.mentioned ? Math.round((positionSum / row.mentioned) * 10) / 10 : null,
  }))
  const asked = results.length
  const answered = results.filter((r) => !r.error).length
  const mentioned = results.filter((r) => !r.error && r.mentioned).length
  return {
    asked, answered, mentioned, rate: answered ? mentioned / answered : 0, providers,
    competitors: Object.entries(competitors).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })),
  }
}

/**
 * The job. deps:
 *   runs, settings: raw collections (settings holds { _id: SETTINGS_ID, questions, nextRunAt, leaseUntil })
 *   providers() -> [{ provider, label, model }] (only those with a key and a chat model)
 *   ask({ provider, model, question, system }) -> { text } (throws on failure)
 *   enabled() -> boolean (Slatebox Cloud, or the operator's switch)
 */
export function createShareOfVoice({ runs, settings, providers, ask, enabled = () => true, now = () => Date.now(), newId, concurrency = 3, log = console }) {
  async function questions() {
    const doc = await settings.findOne({ _id: SETTINGS_ID })
    return Array.isArray(doc?.questions) && doc.questions.length ? doc.questions : [...DEFAULT_QUESTIONS]
  }

  async function setQuestions(list, actor) {
    const clean = cleanQuestions(list)
    await settings.updateOne({ _id: SETTINGS_ID }, { $set: { questions: clean, questionsChangedAt: new Date(now()), questionsChangedBy: actor ?? null } }, { upsert: true })
    return clean
  }

  async function resetQuestions(actor) {
    await settings.updateOne({ _id: SETTINGS_ID }, { $unset: { questions: '' }, $set: { questionsChangedAt: new Date(now()), questionsChangedBy: actor ?? null } }, { upsert: true })
    return [...DEFAULT_QUESTIONS]
  }

  // One run at a time across every server process: whoever moves the lease runs. A scheduled
  // claim also needs the week to be up; Run now does not.
  async function claim({ scheduled }) {
    const at = now()
    const free = { $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: null }, { leaseUntil: { $lt: new Date(at) } }] }
    const due = { $or: [{ nextRunAt: { $exists: false } }, { nextRunAt: null }, { nextRunAt: { $lte: new Date(at) } }] }
    const filter = { _id: SETTINGS_ID, $and: scheduled ? [free, due] : [free] }
    try {
      const result = await settings.updateOne(filter, { $set: { leaseUntil: new Date(at + LEASE_MS) } }, { upsert: true })
      return result.modifiedCount === 1 || result.upsertedCount === 1
    } catch (error) {
      if (error?.code === 11000) return false // another process holds it
      throw error
    }
  }

  async function release({ scheduled }) {
    await settings.updateOne({ _id: SETTINGS_ID }, { $set: { leaseUntil: null, ...(scheduled && { nextRunAt: new Date(now() + WEEK_MS) }) } })
  }

  async function execute({ trigger, actor }) {
    const list = await questions()
    const targets = await providers()
    const id = newId()
    const startedAt = new Date(now())
    await runs.insertOne({ _id: id, trigger, by: actor ?? null, startedAt, status: 'running', questions: list.length, providers: targets.map(({ provider, label, model }) => ({ provider, label, model })) })
    const jobs = targets.flatMap((target) => list.map((question) => ({ ...target, question })))
    const results = await pool(jobs, concurrency, async (job) => {
      const base = { provider: job.provider, label: job.label, model: job.model, question: job.question }
      try {
        const { text } = await ask({ provider: job.provider, model: job.model, question: job.question, system: ASK_SYSTEM })
        return { ...base, ...analyzeAnswer(text), answer: String(text ?? '').slice(0, ANSWER_CHARS) }
      } catch (error) {
        return { ...base, mentioned: false, position: null, competitors: [], error: String(error?.message || 'failed').slice(0, 200) }
      }
    })
    const summary = summarizeResults(results)
    await runs.updateOne({ _id: id }, { $set: { status: 'done', finishedAt: new Date(now()), results, summary } })
    // keep the newest runs only
    const old = await runs.find({}, { projection: { _id: 1 } }).sort({ startedAt: -1 }).skip(RUNS_KEPT).toArray()
    if (old.length) await runs.deleteMany({ _id: { $in: old.map((r) => r._id) } })
    return { id, summary }
  }

  /** The weekly tick: runs only where enabled, when the week is up, in one process. */
  async function tick() {
    if (!enabled()) return { ran: false, why: 'off' }
    if (!(await claim({ scheduled: true }))) return { ran: false, why: 'not due' }
    try {
      return { ran: true, ...(await execute({ trigger: 'schedule' })) }
    } catch (error) {
      log.warn?.(`share-of-voice: the weekly run failed (${error?.message})`)
      return { ran: false, why: 'failed' }
    } finally {
      await release({ scheduled: true })
    }
  }

  /** Run now: starts at once and answers without waiting; refused while a run is going. */
  async function runNow(actor) {
    if (!enabled()) throw Object.assign(new Error('Share of voice runs on Slatebox Cloud only.'), { code: 'off' })
    if (!(await providers()).length) throw Object.assign(new Error('No model provider in AI control has a key. Add one there first.'), { code: 'no-providers' })
    if (!(await claim({ scheduled: false }))) throw Object.assign(new Error('A run is already going. Wait for it to finish.'), { code: 'busy' })
    const done = execute({ trigger: 'manual', actor })
      .catch((error) => log.warn?.(`share-of-voice: the run failed (${error?.message})`))
      .finally(() => release({ scheduled: false }).catch(() => {}))
    return { started: true, done }
  }

  /** What the admin page shows: settings, the trend (oldest first) and the latest run in full. */
  async function view({ trend = 12 } = {}) {
    const [doc, recent, latest] = await Promise.all([
      settings.findOne({ _id: SETTINGS_ID }),
      runs.find({ status: 'done' }, { projection: { results: 0 } }).sort({ startedAt: -1 }).limit(trend).toArray(),
      runs.find({}).sort({ startedAt: -1 }).limit(1).toArray(),
    ])
    const at = now()
    return {
      enabled: enabled(),
      providers: await providers().then((list) => list.map(({ provider, label, model }) => ({ provider, label, model }))).catch(() => []),
      questions: Array.isArray(doc?.questions) && doc.questions.length ? doc.questions : [...DEFAULT_QUESTIONS],
      customQuestions: Array.isArray(doc?.questions) && doc.questions.length > 0,
      nextRunAt: doc?.nextRunAt ?? null,
      running: Boolean(doc?.leaseUntil && new Date(doc.leaseUntil).getTime() > at),
      trend: recent.reverse().map((r) => ({ id: r._id, startedAt: r.startedAt, trigger: r.trigger, summary: r.summary })),
      latest: latest[0] ?? null,
    }
  }

  return { questions, setQuestions, resetQuestions, tick, runNow, view, claim, release }
}

export async function ensureShareOfVoiceIndexes(runs) {
  await runs.createIndex({ startedAt: -1 })
}
