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

export const RECIPE_LIMITS = Object.freeze({ steps: 3, calls: 5, each: 3, rounds: 3, notes: 12, valueChars: 100, rawBytes: 400000 })
// Asks with no recipe: one planning round of two calls (a read-me tool never counts).
export const DEFAULT_PLAN = Object.freeze({ rounds: 1, calls: 2 })

const WORD_NUMBERS = { one: 1, single: 1, two: 2, pair: 2, couple: 2, three: 3, few: 3, four: 4, several: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, dozen: 12 }
const COUNT = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|a\\s+dozen|a\\s+couple(?:\\s+of)?|couple(?:\\s+of)?|a\\s+few|few|several|a\\s+pair\\s+of|a\\s+single)'
const NOTE_WORDS = '(?:node|note|box|boxe|step|item|idea|card|point|shape|bubble|sticky|stickie|stage|block)s?'
// "a" or "an" counts one only before a word that is always a note ("a card payment" is not one card).
const ONE_NOTE = /\b(?:a|an|one)\s+(?:new\s+|short\s+|single\s+|sticky\s+)?(?:note|node|sticky|box|bubble)\b/
const LINE_WORDS = '(?:line|arrow|connection|connector|link|edge)s?'
const countOf = (raw) => {
  const word = String(raw).toLowerCase().replace(/\s+of$/, '').replace(/^a\s+/, '').trim()
  if (/^\d+$/.test(word)) return Number(word)
  return WORD_NUMBERS[word.split(/\s+/).pop()] ?? null
}

/** How many notes and lines the request asks for, from its own words: { notes?, lines? }. */
export function requestBudget(request) {
  const text = String(request || '').toLowerCase()
  const budget = {}
  const notes = new RegExp(`\\b${COUNT}[\\s-]+(?:[a-z]+[\\s-]+)?${NOTE_WORDS}\\b`).exec(text)
  if (notes) {
    const n = countOf(notes[1])
    if (n && n <= 40) budget.notes = n
  } else if (ONE_NOTE.test(text)) budget.notes = 1
  const lines = new RegExp(`\\b${COUNT}[\\s-]+${LINE_WORDS}\\b`).exec(text)
  if (lines) {
    const n = countOf(lines[1])
    if (n && n <= 80) budget.lines = n
  }
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

/** The intent of a recipe the request names (its keywords are patterns, any one matching), or null. */
export function matchIntent(recipe, request) {
  const text = String(request || '')
  for (const intent of Array.isArray(recipe?.intents) ? recipe.intents : []) {
    const patterns = Array.isArray(intent?.keywords) ? intent.keywords : []
    const ok = patterns.some((pattern) => {
      try {
        return new RegExp(pattern, 'i').test(text)
      } catch {
        return false
      }
    })
    if (ok && Array.isArray(intent.steps) && intent.steps.length) return intent
  }
  return null
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
      try {
        found = [...String(text).matchAll(new RegExp(path.slice(3), 'g'))].map((m) => m[1]).slice(0, 10)
      } catch {
        found = []
      }
    } else found = pick(data, path)
    out[name] = found.map(safeValue).filter(Boolean).slice(0, RECIPE_LIMITS.each)
  }
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
  const repo = /\b([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})\b/.exec(text)
  if (repo && !/^https?:$/i.test(repo[1])) Object.assign(out, { owner: repo[1], repo: repo[2], fullName: `${repo[1]}/${repo[2]}` })
  const topic = /\b(?:touch(?:es|ing)?|about|on|mention(?:s|ing)?)\s+["“]?([A-Za-z0-9][\w .-]{1,40}?)["”]?(?:[?.!,]|\s+(?:in|on|for)\b|$)/i.exec(text)
  if (topic) {
    const words = topic[1].trim().replace(/\s+/g, ' ')
    if (/^[\w .-]{2,40}$/.test(words) && !/\//.test(words)) out.topic = words
  }
  const org = /\b(?:in|on|for|from) (?:the )?([A-Za-z0-9][A-Za-z0-9-]{0,38}) (?:org|organi[sz]ation)\b/i.exec(text)
  if (org) out.org = org[1]
  return out
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
  for (const entry of entries) {
    for (const item of pick(entry.data, output.list)) {
      if (notes.length >= max) break
      if (!item || typeof item !== 'object') continue
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
    const keywords = (Array.isArray(intent?.keywords) ? intent.keywords : []).filter((k) => {
      if (typeof k !== 'string' || !k || k.length > 200) return false
      try { new RegExp(k, 'i'); return true } catch { return false }
    })
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
        ...(Array.isArray(step.optional) && { optional: step.optional.filter((k) => typeof k === 'string') }),
      })),
      ...(intent.output && typeof intent.output === 'object' && { output: { ...intent.output, maxNotes: Math.min(RECIPE_LIMITS.notes, Number(intent.output.maxNotes) || 5) } }),
      ...(typeof intent.label === 'string' && { label: plainText(intent.label, 60) }),
    })
  }
  return {
    rounds: Math.min(RECIPE_LIMITS.rounds, Math.max(1, Number(raw.rounds) || DEFAULT_PLAN.rounds)),
    calls: Math.min(RECIPE_LIMITS.calls, Math.max(1, Number(raw.calls) || DEFAULT_PLAN.calls)),
    referenceTools: (Array.isArray(raw.referenceTools) ? raw.referenceTools : []).filter((t) => typeof t === 'string').slice(0, 20),
    intents,
  }
}
