// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// "Do exactly what is asked": the rules every ask to an invited agent follows, without a model.
//   budget     how many notes and lines the request asked for ("a 3 node diagram" is 3 notes, "a
//              couple notes" is 2), read from the request's own words; the answer is trimmed to it.
//   reference  tools that only explain how to call others ("call this before …", read_me) are
//              never offered to the planner, and never turned into notes.
//   recipes    a gallery agent's known asks ("my latest commits", "my PRs to review"): fixed steps
//              this code runs, where a later step's arguments come from an earlier result by typed
//              extraction (short ids and names only, never the server's words), so the planner
//              never reads what the server said; and a fixed way to turn the answer into notes.
//   dedupe     notes with the same words in one group are one note.
import { plainText } from './tools.mjs'
import { safeLink } from './results.mjs'

export const RECIPE_LIMITS = Object.freeze({ steps: 4, calls: 5, runCalls: 6, each: 3, rounds: 3, notes: 12, valueChars: 100, rawBytes: 400000, patternChars: 200, patternText: 20000 })
// Asks with no recipe: one planning round of two calls (a read-me tool never counts).
export const DEFAULT_PLAN = Object.freeze({ rounds: 1, calls: 2 })

const WORD_NUMBERS = { one: 1, single: 1, two: 2, pair: 2, couple: 2, three: 3, few: 3, four: 4, several: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, dozen: 12 }
const COUNT = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|a\\s+dozen|a\\s+couple(?:\\s+of)?|couple(?:\\s+of)?|a\\s+few|few|several|a\\s+pair\\s+of|a\\s+single)'
// A count names notes when its word is plural ("3 notes", "a couple ideas"), or singular before a
// word for the whole ("a 3 node diagram", "a 3-step process"), or is one ("1 note"). "React 18 card
// component", "2 step verification" and "node.js" are not counts of notes.
const NOTE_ONE = '(?:node|note|box|step|item|idea|card|point|shape|bubble|sticky|stage|block)'
const NOTE_MANY = '(?:nodes|notes|boxes|steps|items|ideas|cards|points|shapes|bubbles|stickies|stickys|stages|blocks)'
const WHOLE = '(?:diagram|flow|flowchart|chart|process|map|mind ?map|plan|board|layout|graph|tree|sequence|pipeline|list|outline|timeline|grid|cycle)'
const NOT_A_NAME = '(?![.-]?[a-z0-9])' // "node.js", "card-ui": a name, not a note
// "a" or "an" counts one only before a word that is always a note ("a card payment" is not one card).
const ONE_NOTE = new RegExp(`\\b(?:a|an|one)\\s+(?:new\\s+|short\\s+|single\\s+|sticky\\s+)?(?:note|node|sticky|box|bubble)\\b${NOT_A_NAME}`)
const LINE_ONE = '(?:line|arrow|connection|connector|link|edge)'
const LINE_MANY = '(?:lines|arrows|connections|connectors|links|edges)'
const countOf = (raw) => {
  const word = String(raw).toLowerCase().replace(/\s+of$/, '').replace(/^a\s+/, '').trim()
  if (/^\d+$/.test(word)) return Number(word)
  return WORD_NUMBERS[word.split(/\s+/).pop()] ?? null
}

/** How many notes and lines the request asks for, from its own words: { notes?, lines? }. */
export function requestBudget(request) {
  const text = String(request || '').toLowerCase()
  const budget = {}
  const counted = (one, many, adjective) => {
    const plural = new RegExp(`\\b${COUNT}[\\s-]+${adjective ? '(?:[a-z]+[\\s-]+)?' : ''}${many}\\b${NOT_A_NAME}`).exec(text)
    const whole = new RegExp(`\\b${COUNT}[\\s-]+${one}[\\s-]+${WHOLE}\\b`).exec(text)
    const single = new RegExp(`\\b(1|one|a\\s+single)[\\s-]+${one}\\b${NOT_A_NAME}`).exec(text)
    const found = [plural, whole, single].filter(Boolean).sort((a, b) => a.index - b.index)[0]
    return found ? countOf(found[1]) : null
  }
  const notes = counted(NOTE_ONE, NOTE_MANY, true)
  if (notes && notes <= 40) budget.notes = notes
  else if (!notes && ONE_NOTE.test(text)) budget.notes = 1
  const lines = counted(LINE_ONE, LINE_MANY, false)
  if (lines && lines <= 80) budget.lines = lines
  return budget
}

/** Notes with the same words in one group become one (lines follow the note that stays). */
export function dedupeGroups(groups) {
  return groups.map((group) => {
    const keep = new Map()
    const rename = new Map()
    const notes = []
    for (const note of group.notes) {
      const words = String(note.text).trim().toLowerCase()
      if (words && words !== ' ' && keep.has(words)) {
        rename.set(note.key, keep.get(words))
        continue
      }
      if (words) keep.set(words, note.key)
      notes.push(note)
    }
    const seen = new Set()
    const lines = []
    for (const line of group.lines || []) {
      const from = rename.get(line.from) ?? line.from
      const to = rename.get(line.to) ?? line.to
      if (from === to || seen.has(from + '>' + to)) continue
      seen.add(from + '>' + to)
      lines.push({ ...line, from, to })
    }
    return { ...group, notes, lines }
  })
}

/**
 * The answer trimmed to the budget: the first `notes` notes across groups, the lines between notes
 * that stayed (or to notes on the slate), at most `lines` of them. → { groups, cut: { notes, lines } }
 */
export function trimToBudget(groups, budget = {}) {
  const cut = { notes: 0, lines: 0 }
  let notesLeft = Number.isInteger(budget.notes) ? budget.notes : Infinity
  let linesLeft = Number.isInteger(budget.lines) ? budget.lines : Infinity
  const out = []
  for (const group of groups) {
    const kept = []
    for (const note of group.notes) {
      if (notesLeft > 0) {
        kept.push(note)
        notesLeft--
      } else cut.notes++
    }
    const keys = new Set(kept.map((note) => note.key))
    const lines = []
    for (const line of group.lines || []) {
      const ends = [line.from, line.to]
      // An end that is not one of this group's notes is a note already on the slate (a ref).
      const allNotes = new Set(group.notes.map((note) => note.key))
      if (ends.some((end) => allNotes.has(end) && !keys.has(end))) {
        cut.lines++
        continue
      }
      if (linesLeft <= 0) {
        cut.lines++
        continue
      }
      lines.push(line)
      linesLeft--
    }
    if (kept.length) out.push({ ...group, notes: kept, lines })
  }
  return { groups: out, cut }
}

/** What trimming left out, in a sentence ('' when nothing was). */
export function cutWords(cut, budget) {
  if (!cut?.notes && !cut?.lines) return ''
  const asked = Number.isInteger(budget?.notes) ? `the ${budget.notes} ${budget.notes === 1 ? 'note' : 'notes'} you asked for` : 'what you asked for'
  const left = [cut.notes && `${cut.notes} more ${cut.notes === 1 ? 'note' : 'notes'}`, cut.lines && `${cut.lines} ${cut.lines === 1 ? 'line' : 'lines'}`].filter(Boolean).join(' and ')
  return `Kept ${asked}; ${left} left out.`
}

// A tool that only explains how to call the others: never offered, never laid out.
const REFERENCE_WORDS = /\b(call|use|read) (this|me) (before|first)\b|\bbefore (using|calling) (any|the other|other)\b|\bmust be called before\b/i
export function isReferenceTool(tool, recipe = null) {
  if (recipe?.referenceTools?.includes(tool?.name)) return true
  if (/^read_?me$/i.test(tool?.name || '')) return true
  return REFERENCE_WORDS.test(String(tool?.description || ''))
}

/** The planning limits for an ask: a recipe's own, within the ceiling; else one round of two calls. */
export function planLimits(recipe, ceiling) {
  const rounds = Math.min(RECIPE_LIMITS.rounds, Math.max(1, Number(recipe?.rounds) || DEFAULT_PLAN.rounds))
  const calls = Math.min(ceiling, Math.max(1, Number(recipe?.calls) || DEFAULT_PLAN.calls))
  return { rounds, calls }
}

// ---- recipes ----------------------------------------------------------------------------------

/**
 * The intent of a recipe the request names (its keywords are patterns, any one matching), or null.
 * An intent that `needs` values the request does not name (owner/repo, an org) is passed over, so
 * "my commits this week/last week" is not read as the repository week/last.
 */
export function matchIntent(recipe, request, values = requestValues(request)) {
  const text = String(request || '').slice(0, 1000)
  for (const intent of Array.isArray(recipe?.intents) ? recipe.intents : []) {
    const patterns = Array.isArray(intent?.keywords) ? intent.keywords : []
    const ok = patterns.some((pattern) => {
      if (!safePattern(pattern)) return false
      try {
        return new RegExp(pattern, 'i').test(text)
      } catch {
        return false
      }
    })
    if (ok && Array.isArray(intent.needs) && intent.needs.some((name) => values?.[name] === undefined)) continue
    if (ok && Array.isArray(intent.steps) && intent.steps.length) return intent
  }
  return null
}

/**
 * Whether an administrator's pattern is safe to run on text an outside server controls: short, no
 * back-references or lookarounds, and no quantified group that itself repeats ("(a+)+", "(a|aa)*"),
 * the shapes that can take exponential time. Patterns run on capped text only (RECIPE_LIMITS.patternText).
 */
export function safePattern(pattern) {
  if (typeof pattern !== 'string' || !pattern || pattern.length > RECIPE_LIMITS.patternChars) return false
  if (/\\[1-9]|\\k<|\(\?<?[=!]/.test(pattern)) return false
  try {
    new RegExp(pattern)
  } catch {
    return false
  }
  // A group with a quantifier inside (or an alternation), followed by a quantifier.
  const plain = pattern.replace(/\\./g, 'x').replace(/\[[^\]]*\]/g, 'x')
  const stack = []
  for (let i = 0; i < plain.length; i++) {
    const c = plain[i]
    if (c === '(') stack.push({ repeats: false })
    else if (c === ')') {
      const group = stack.pop()
      if (!group) return false
      const after = plain.slice(i + 1)
      const quantified = /^(?:[*+]|\{\d*,\d*\}|\{\d{2,}\})/.test(after)
      if (quantified && group.repeats) return false
      if (stack.length && (group.repeats || quantified)) stack[stack.length - 1].repeats = true
    } else if (stack.length && (c === '*' || c === '+' || c === '|' || (c === '{' && /^\{\d*,/.test(plain.slice(i))))) stack[stack.length - 1].repeats = true
  }
  return stack.length === 0
}

// A value a step may pass on: a short id, login, owner/repo name or number. Nothing else ever
// travels from one result into the next call.
const SAFE_VALUE = /^[A-Za-z0-9._/-]{1,100}$/
const safeValue = (value) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' && SAFE_VALUE.test(value) ? value : null)

/** The parsed body of a raw tool result: its structured content, else its first text block as JSON. */
export function rawData(raw) {
  if (raw?.structuredContent && typeof raw.structuredContent === 'object') return raw.structuredContent
  for (const block of Array.isArray(raw?.content) ? raw.content : []) {
    if (block?.type !== 'text' || typeof block.text !== 'string' || block.text.length > RECIPE_LIMITS.rawBytes) continue
    try {
      return JSON.parse(block.text)
    } catch {
      /* not JSON */
    }
  }
  return null
}

/**
 * Values at a path: "login", "items[0..2].full_name", "[*].sha", "commit.message". Arrays are
 * walked with [n], [a..b] or [*]. → array of the values found (never more than 50).
 */
export function pick(data, path) {
  let current = [data]
  const parts = String(path || '').match(/[^.[\]]+|\[[^\]]*\]/g) || []
  for (const part of parts) {
    const next = []
    for (const value of current) {
      if (part.startsWith('[')) {
        if (!Array.isArray(value)) continue
        const inner = part.slice(1, -1)
        if (inner === '*') next.push(...value)
        else if (/^\d+\.\.\d+$/.test(inner)) {
          const [a, b] = inner.split('..').map(Number)
          next.push(...value.slice(a, b + 1))
        } else if (/^\d+$/.test(inner)) value[Number(inner)] !== undefined && next.push(value[Number(inner)])
      } else if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, part)) next.push(value[part])
    }
    current = next.slice(0, 50)
  }
  return current
}

/** A raw result's text blocks, joined (for 're:' extraction). */
export function rawText(raw) {
  return (Array.isArray(raw?.content) ? raw.content : []).filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n').slice(0, RECIPE_LIMITS.rawBytes)
}

/**
 * A step's extraction: { name: path } → { name: [safe values] }. A path is a JSON path into the
 * parsed result, or 're:<pattern>' whose first group is read from its text. Unsafe values are dropped.
 */
export function extract(data, spec = {}, text = '') {
  const out = {}
  for (const [name, path] of Object.entries(spec || {})) {
    let found = []
    if (typeof path === 'string' && path.startsWith('re:')) {
      // Run on capped text only, and only a pattern that cannot take exponential time.
      if (!safePattern(path.slice(3))) found = []
      else try {
        found = [...String(text).slice(0, RECIPE_LIMITS.patternText).matchAll(new RegExp(path.slice(3), 'g'))].map((m) => m[1]).slice(0, 10)
      } catch {
        found = []
      }
    } else found = pick(data, path)
    out[name] = found.map(safeValue).filter(Boolean).slice(0, RECIPE_LIMITS.each)
  }
  return out
}

/** Two lists taken in turn (a, b, a, b …), each value once: repositories from two searches. */
export function interleave(a = [], b = []) {
  const out = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) for (const value of [a[i], b[i]]) if (value !== undefined && !out.includes(value)) out.push(value)
  return out
}

/** The tool a step calls: its own, or the first of its alternatives this agent may use. Null: none. */
export function stepTool(step, allowedNames) {
  const options = [].concat(step?.tool || [])
  return options.find((name) => allowedNames.has(name)) || null
}

/** Values the request itself names: owner/repo, and the topic after "touch" or "about". */
export function requestValues(request) {
  const text = String(request || '')
  const out = {}
  const repo = repoIn(text)
  if (repo) Object.assign(out, { owner: repo.owner, repo: repo.repo, fullName: `${repo.owner}/${repo.repo}` })
  const topic = /\b(?:touch(?:es|ing)?|about|on|mention(?:s|ing)?)\s+["“]?([A-Za-z0-9][\w .-]{1,40}?)["”]?(?:[?.!,]|\s+(?:in|on|for)\b|$)/i.exec(text)
  if (topic) {
    const words = topic[1].trim().replace(/\s+/g, ' ')
    if (/^[\w .-]{2,40}$/.test(words) && !/\//.test(words)) out.topic = words
  }
  const org = /\b(?:in|on|for|from) (?:the )?([A-Za-z0-9][A-Za-z0-9-]{0,38}) (?:org|organi[sz]ation)\b/i.exec(text)
  if (org) out.org = org[1]
  return out
}

// Words people write with a slash that are not owner/repo ("and/or", "this week/last week").
const SLASH_WORDS = new Set(['and', 'or', 'nor', 'either', 'neither', 'this', 'that', 'last', 'next', 'week', 'weeks', 'month', 'months', 'day', 'days', 'year', 'years', 'today', 'yesterday', 'tomorrow',
  'yes', 'no', 'on', 'off', 'in', 'out', 'up', 'down', 'he', 'she', 'him', 'her', 'his', 'hers', 'they', 'them', 'we', 'us', 'i', 'me', 'you', 'it', 'a', 'an', 'the', 'to', 'from', 'for', 'with', 'without',
  'input', 'output', 'read', 'write', 'pros', 'cons', 'pro', 'con', 'true', 'false', 'before', 'after', 'now', 'then', 'am', 'pm', 'w', 'n', 'na', 'etc', 'more', 'less', 'plus', 'minus', 'min', 'max'])

/** The first owner/repo the text names (a GitHub address counts), never "and/or" or a date like 11/24. */
export function repoIn(text) {
  for (const m of String(text || '').matchAll(/(?:^|[^\w/.:-])(?:https?:\/\/github\.com\/)?([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})(?![\w/])/g)) {
    const [owner, repo] = [m[1], m[2].replace(/\.git$/, '').replace(/[.]+$/, '')]
    if (!repo || /^\d+$/.test(owner) || /^\d+$/.test(repo)) continue
    if (SLASH_WORDS.has(owner.toLowerCase()) || SLASH_WORDS.has(repo.toLowerCase())) continue
    return { owner, repo }
  }
  return null
}

// "{login}" in a step's argument, from the values so far (a missing value leaves the step unready).
function fill(template, values) {
  if (typeof template === 'number' || typeof template === 'boolean') return template
  if (typeof template !== 'string') return template
  let missing = false
  const filled = template.replace(/\{([A-Za-z]+)\}/g, (_, name) => {
    const value = Array.isArray(values[name]) ? values[name][0] : values[name]
    if (value === undefined || value === null || value === '') {
      missing = true
      return ''
    }
    return String(value)
  })
  if (missing) return undefined
  return filled.replace(/\s+/g, ' ').trim()
}

/**
 * The calls one step makes, given the values so far: its arguments filled in, once per value of
 * `each` (a list from an earlier step, owner/repo split into owner and repo), at most `each` times.
 * → [{ tool, args }] ([] when a value it needs is missing)
 */
export function stepCalls(step, values) {
  const runs = step.each ? (values[step.each] || []).slice(0, RECIPE_LIMITS.each).map((value) => {
    const [owner, repo] = String(value).split('/')
    return { ...values, item: value, ...(repo ? { owner, repo, fullName: value } : {}) }
  }) : [values]
  const calls = []
  for (const run of runs) {
    const args = {}
    let ready = true
    for (const [key, template] of Object.entries(step.args || {})) {
      const value = fill(template, run)
      if (value === undefined) {
        // An optional part ("{org}") may be left out; a required one stops the step.
        if (step.optional?.includes(key)) continue
        ready = false
        break
      }
      args[key] = value
    }
    if (ready) calls.push({ tool: step.tool, args, run })
  }
  return calls
}

/**
 * Notes from a recipe step's raw answer by its output rule, with no model:
 *   { list: path to the items, text: "{repo} · {sha7} · {commit.message}", link: path, maxNotes }
 * {sha7} is the first 7 characters of sha; other {a.b} are paths into the item; {repo} is the
 * repository the call was about. Words are plain text; links only https.
 */
export function outputNotes(entries, output) {
  if (!output?.list || !output?.text) return []
  const notes = []
  const max = Math.min(RECIPE_LIMITS.notes, Number(output.maxNotes) || RECIPE_LIMITS.notes)
  // Every call's items together; with `newest` (a date path), newest first across all of them.
  let found = entries.flatMap((entry) => pick(entry.data, output.list).map((item) => ({ entry, item })))
  if (typeof output.newest === 'string') {
    const when = ({ item }) => Date.parse(pick(item, output.newest)[0]) || 0
    found = found.map((pair, index) => ({ ...pair, index })).sort((a, b) => when(b) - when(a) || a.index - b.index)
  }
  const seen = new Set()
  for (const { entry, item } of found) {
    {
      if (notes.length >= max) break
      if (!item || typeof item !== 'object') continue
      // The same commit or item twice (two calls found it) is one note.
      const id = item.sha || item.html_url || item.id
      if (id && seen.has(id)) continue
      if (id) seen.add(id)
      const text = plainText(String(output.text).replace(/\{([A-Za-z0-9_.]+)\}/g, (_, path) => {
        if (path === 'sha7') return String(item.sha || '').slice(0, 7)
        if (path === 'repo') return entry.run?.fullName || entry.run?.repo || pick(item, 'repository.full_name')[0] || repoFromUrl(item.repository_url) || ''
        const value = pick(item, path)[0]
        return typeof value === 'string' || typeof value === 'number' ? String(value).split('\n')[0] : ''
      }).replace(/(?:\s·\s)+$/, '').replace(/^(?:\s*·\s)+/, ''), 400)
      if (!text) continue
      const link = output.link ? safeLink(pick(item, output.link)[0]) : null
      notes.push({ key: 'r' + (notes.length + 1), text, ...(link && { link: link.url }) })
    }
  }
  return notes
}

const repoFromUrl = (url) => {
  const match = /\/repos\/([^/]+\/[^/]+)$/.exec(String(url || ''))
  return match ? match[1] : ''
}

/** A recipe (from the gallery or an administrator's edit), checked: anything malformed is dropped. */
export function checkRecipe(raw) {
  if (!raw || typeof raw !== 'object') return null
  const intents = []
  for (const intent of Array.isArray(raw.intents) ? raw.intents.slice(0, 12) : []) {
    const key = typeof intent?.key === 'string' && /^[a-z0-9-]{1,40}$/.test(intent.key) ? intent.key : null
    const keywords = (Array.isArray(intent?.keywords) ? intent.keywords : []).filter(safePattern)
    const toolName = (name) => typeof name === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(name)
    const steps = (Array.isArray(intent?.steps) ? intent.steps.slice(0, RECIPE_LIMITS.steps) : [])
      .filter((step) => (Array.isArray(step?.tool) ? step.tool.length > 0 && step.tool.length <= 4 && step.tool.every(toolName) : toolName(step?.tool)))
    if (!key || !keywords.length || !steps.length) continue
    intents.push({
      key,
      keywords,
      steps: steps.map((step) => ({
        tool: step.tool,
        args: step.args === 'plan' ? 'plan' : step.args && typeof step.args === 'object' && !Array.isArray(step.args) ? step.args : {},
        ...(step.extract && typeof step.extract === 'object' && { extract: step.extract }),
        ...(typeof step.each === 'string' && { each: step.each }),
        ...(step.merge === true && { merge: true }),
        ...(Array.isArray(step.optional) && { optional: step.optional.filter((k) => typeof k === 'string') }),
      })),
      ...(intent.output && typeof intent.output === 'object' && { output: { ...intent.output, maxNotes: Math.min(RECIPE_LIMITS.notes, Number(intent.output.maxNotes) || 5) } }),
      ...(typeof intent.label === 'string' && { label: plainText(intent.label, 60) }),
      ...(Array.isArray(intent.needs) && { needs: intent.needs.filter((n) => typeof n === 'string' && /^[A-Za-z]{1,20}$/.test(n)).slice(0, 4) }),
      // What to say when a step finds nothing it needs ("Try naming the repository (owner/name).").
      ...(typeof intent.missing === 'string' && { missing: plainText(intent.missing, 160) }),
    })
  }
  return {
    rounds: Math.min(RECIPE_LIMITS.rounds, Math.max(1, Number(raw.rounds) || DEFAULT_PLAN.rounds)),
    calls: Math.min(RECIPE_LIMITS.calls, Math.max(1, Number(raw.calls) || DEFAULT_PLAN.calls)),
    referenceTools: (Array.isArray(raw.referenceTools) ? raw.referenceTools : []).filter((t) => typeof t === 'string').slice(0, 20),
    intents,
    ...checkWriteParts(raw),
  }
}

const TOOL_KINDS = ['lookup', 'change', 'destructive']
const FIELD_KEYS = ['title', 'body', 'target', 'item']
const toolNameOk = (name) => typeof name === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(name)

/**
 * The write half of a recipe (owner, 2026-11-24: agents read and write):
 *   tools   { toolName: 'lookup' | 'change' | 'destructive' }: an administrator's word for what a
 *           tool does, over its annotations and name (enterprise/server/tools.mjs classifyTool).
 *   writes  the changes the agent is known for, each { key, label, tool (or alternatives), keywords,
 *           fields }: when the request's words match, the change planner is offered only that tool,
 *           and its action card says label ("Create Linear issue") and shows the arguments named in
 *           fields (title, body, target, item) first.
 */
export function checkWriteParts(raw) {
  const out = {}
  if (raw?.tools && typeof raw.tools === 'object' && !Array.isArray(raw.tools)) {
    const tools = Object.fromEntries(Object.entries(raw.tools).filter(([name, kind]) => toolNameOk(name) && TOOL_KINDS.includes(kind)).slice(0, 64))
    if (Object.keys(tools).length) out.tools = tools
  }
  const writes = []
  for (const write of Array.isArray(raw?.writes) ? raw.writes.slice(0, 12) : []) {
    const key = typeof write?.key === 'string' && /^[a-z0-9-]{1,40}$/.test(write.key) ? write.key : null
    const tool = Array.isArray(write?.tool) ? (write.tool.length && write.tool.length <= 4 && write.tool.every(toolNameOk) ? write.tool : null) : toolNameOk(write?.tool) ? write.tool : null
    const keywords = (Array.isArray(write?.keywords) ? write.keywords : []).filter(safePattern)
    if (!key || !tool || !keywords.length) continue
    const fields = {}
    for (const field of FIELD_KEYS) {
      const names = [].concat(write.fields?.[field] || []).filter((n) => typeof n === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(n)).slice(0, 6)
      if (names.length) fields[field] = names
    }
    // Fixed values (strings, numbers, booleans) the planner's arguments never override.
    const args = write.args && typeof write.args === 'object' && !Array.isArray(write.args)
      ? Object.fromEntries(Object.entries(write.args).filter(([k, v]) => /^[A-Za-z0-9_.-]{1,40}$/.test(k) && (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= RECIPE_LIMITS.valueChars))).slice(0, 8))
      : {}
    writes.push({ key, tool, keywords, label: plainText(write.label || '', 60) || null, ...(Object.keys(fields).length && { fields }), ...(Object.keys(args).length && { args }) })
  }
  if (writes.length) out.writes = writes
  return out
}

/** The known change a request asks for (its keywords, any one matching), whose tool the agent may use: { write, tool } or null. */
export function matchWrite(recipe, request, writableNames) {
  const text = String(request || '').slice(0, 1000)
  for (const write of Array.isArray(recipe?.writes) ? recipe.writes : []) {
    const ok = write.keywords.some((pattern) => {
      try {
        return new RegExp(pattern, 'i').test(text)
      } catch {
        return false
      }
    })
    if (!ok) continue
    const tool = stepTool(write, writableNames)
    if (tool) return { write, tool }
  }
  return null
}
