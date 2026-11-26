// About you: the facts a person keeps about themselves, so Slatebox can suggest boards and slates
// made for their work. The person owns every fact: each says where it came from, and they can
// edit, hide or remove it, switch personalization off, download it all, or delete it all.
//
// Pure rules only (no Meteor, no database): kinds, sources, bounds, how text is tidied, which
// facts count as the same fact, the cap, the first-slate fact read from profile.start, the
// compact lines a later model call reads, and the download. The store (server/profile/store.mjs)
// and the actions (server/actions/profile.mjs) use these; so does the About you tab.
import { jobOf } from './first-slate.mjs'

/**
 * What a fact is about. A fixed list: a later slice reads facts by kind, so a kind is never made up.
 *   role     what they do ("Product manager")
 *   team     who they work with ("A team of six designers")
 *   work     the kind of work they do day to day ("Customer go-lives")
 *   goal     what they want to get done ("Ship the new onboarding by March")
 *   project  something they are working on now ("Mobile app redesign")
 *   tool     a tool they use ("Linear", "Google Docs")
 *   topic    a subject they care about or know well ("Pricing", "Accessibility")
 *   style    how they like to work or see things ("Short lists over long documents")
 *   routine  a regular rhythm ("Weekly planning on Mondays")
 *   other    anything else
 */
export const FACT_KINDS = Object.freeze(['role', 'team', 'work', 'goal', 'project', 'tool', 'topic', 'style', 'routine', 'other'])

// The words the About you tab shows for each kind, in the order it groups them.
export const KIND_LABELS = Object.freeze({
  role: 'Your role',
  team: 'Your team',
  work: 'Your work',
  goal: 'Goals',
  project: 'Projects',
  tool: 'Tools you use',
  topic: 'Topics',
  style: 'How you like to work',
  routine: 'Routines',
  other: 'Other',
})

/**
 * Where a fact came from.
 *   typed        the person wrote it (in About you, or an agent they connected wrote it for them)
 *   interview    a talk with the agent (later)
 *   integration  a connected tool, read with that tool's own switch on (later)
 *   upload       a data export they uploaded (later)
 *   first-slate  their answer when they made their first slate (profile.start), read when listed
 */
export const SOURCE_TYPES = Object.freeze(['typed', 'interview', 'integration', 'upload', 'first-slate'])

export const LIMITS = Object.freeze({
  // one fact's words
  text: 280,
  // a source's label ("Linear", "LinkedIn export") and its reference (an integration id, a file name)
  label: 80,
  ref: 120,
  // facts kept per person (the derived first-slate fact is not stored, so it does not count)
  perPerson: 200,
  // facts one addFactsFrom call may bring
  perAdd: 50,
  // what factsForPrompt gives a model call at most
  promptFacts: 60,
  promptChars: 4000,
})

// The id of the fact read from profile.start (never stored, so never a database id).
export const FIRST_SLATE_FACT_ID = 'first-slate'
export const FACT_ID_PATTERN = '^[A-Za-z0-9_-]{1,64}$'

export class FactError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

/** Tidy words: one line, single spaces, no control characters, at most `max` characters. */
export function tidyText(value, max = LIMITS.text) {
  if (typeof value !== 'string') return ''
  const line = value
    .normalize('NFC')
    // control characters (newlines and tabs included) become spaces: a fact is one line
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return line.length > max ? line.slice(0, max).trim() : line
}

// Words that do not make two facts different: "I am a product manager" is "product manager".
const FILLER = new Set(['a', 'an', 'the', 'i', 'im', 'am', 'is', 'are', 'my', 'me', 'we', 'our', 'and', 'of', 'at', 'in', 'on', 'for', 'to', 'with', 'use', 'uses', 'using'])

/**
 * The same-fact key: lower case, accents and punctuation dropped, filler words dropped, the rest in
 * order. Two facts of one kind with the same key are one fact ("Uses Linear." and "use linear").
 */
export function factKey(text) {
  const words = tidyText(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter(Boolean)
  const kept = words.filter((word) => !FILLER.has(word))
  return (kept.length ? kept : words).join(' ')
}

/** Whether two facts say the same thing: one kind, one key. */
export const sameFact = (a, b) => a.kind === b.kind && factKey(a.text) === factKey(b.text)

/** A source as stored: a known type, and a ref and label only when given (bounded). */
export function normalizeSource(source) {
  const type = source?.type
  if (!SOURCE_TYPES.includes(type)) throw new FactError('invalid_source', `A source is one of ${SOURCE_TYPES.join(', ')}.`)
  const out = { type }
  const ref = tidyText(source.ref, LIMITS.ref)
  const label = tidyText(source.label, LIMITS.label)
  if (ref) out.ref = ref
  if (label) out.label = label
  if ((type === 'integration' || type === 'upload') && !out.ref)
    throw new FactError('invalid_source', `A fact from ${type === 'integration' ? 'a connected tool' : 'an upload'} names it (source.ref).`)
  return out
}

// A ref as a switch key: lower case ASCII letters, digits, "-" and "_" only, since the key is a
// field name in personalSettings.sources ("LinkedIn export.zip" is "linkedin-export-zip"). A ref
// with none of those characters gets a short stable code instead, so it still has a switch.
const REF_KEY_MAX = 64
function refKey(ref) {
  const raw = String(ref ?? '')
  const plain = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, REF_KEY_MAX)
    .replace(/[-_]+$/, '')
  if (plain) return plain
  // FNV-1a over the ref's characters
  let hash = 0x811c9dc5
  for (const char of raw) hash = Math.imul(hash ^ char.codePointAt(0), 0x01000193) >>> 0
  return `ref-${hash.toString(36)}`
}

/**
 * The switch a source answers to in personalSettings.sources: a connected tool or an upload by its
 * ref ("integration:notion", "upload:linkedin-zip"), the others by their type ("interview"). Always
 * matches SOURCE_KEY_PATTERN, so whatever source a later slice reads from can be switched on.
 */
export function sourceKey(source) {
  const type = source?.type
  if (type === 'integration' || type === 'upload') return `${type}:${refKey(source.ref)}`
  return type
}

// No "." (a dot in a field name is a nested path in MongoDB) and no "$".
export const SOURCE_KEY_PATTERN = '^(typed|interview|first-slate|(integration|upload):[a-z0-9][a-z0-9_-]{0,63})$'

// A person keeps at most this many source switches (a connected tool or an upload each).
export const MAX_SOURCE_SWITCHES = 100

// Connected tools and uploads are read only once their own switch is on; the others, which the
// person starts themselves, are on until switched off.
export function sourceOn(settings, source) {
  const key = sourceKey(source)
  const set = settings?.sources?.[key]
  if (typeof set === 'boolean') return set
  return !(key.startsWith('integration:') || key.startsWith('upload:'))
}

/** Personalization is on unless the person switched it off. */
export const personalizationOn = (settings) => settings?.on !== false

/**
 * A fact as it is stored, from what a person, an agent or a source sent: kind and words checked
 * and tidied, a confidence from 0 to 1 (a person's own words are 1), never hidden at first.
 */
export function normalizeFact(input, { source = { type: 'typed' }, now = Date.now() } = {}) {
  if (!input || typeof input !== 'object') throw new FactError('invalid_fact', 'A fact has a kind and some words.')
  if (!FACT_KINDS.includes(input.kind)) throw new FactError('invalid_kind', `kind is one of ${FACT_KINDS.join(', ')}.`)
  const text = tidyText(input.text)
  if (!text) throw new FactError('invalid_text', 'Write a few words.')
  if (typeof input.text === 'string' && tidyText(input.text, Infinity).length > LIMITS.text)
    throw new FactError('invalid_text', `Keep it to ${LIMITS.text} characters.`)
  const from = normalizeSource(input.source || source)
  let confidence = from.type === 'typed' ? 1 : input.confidence
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) confidence = 0.5
  confidence = Math.min(1, Math.max(0, Math.round(confidence * 100) / 100))
  const at = new Date(now)
  return { kind: input.kind, text, key: factKey(text), source: from, confidence, hidden: false, createdAt: at, updatedAt: at }
}

/**
 * Which incoming facts to keep, against what the person already has: a fact the same as one they
 * have (or one earlier in the same batch) is dropped, and nothing past the cap is kept. What they
 * already have is never changed: their words, and their choice to hide, win.
 * → { add: [fact], same: n, overCap: n }
 */
export function planAdditions(existing, incoming, { cap = LIMITS.perPerson } = {}) {
  const seen = new Set(existing.map((fact) => `${fact.kind}\u0000${fact.key ?? factKey(fact.text)}`))
  let room = Math.max(0, cap - existing.length)
  const add = []
  let same = 0
  let overCap = 0
  for (const fact of incoming) {
    const id = `${fact.kind}\u0000${fact.key ?? factKey(fact.text)}`
    if (seen.has(id)) {
      same += 1
      continue
    }
    if (room <= 0) {
      overCap += 1
      continue
    }
    seen.add(id)
    add.push(fact)
    room -= 1
  }
  return { add, same, overCap }
}

/**
 * The fact read from the first-slate answer (profile.start, written by firstSlate.create), or null.
 * It is not stored: it is read again each time the profile is listed. `state` is what the person
 * chose for it (personalSettings.derived['first-slate']): hidden, or removed. A choice belongs to
 * the answer it was made on (its job), so a different answer later shows again.
 */
export function firstSlateFact(profileStart, state = null) {
  const job = jobOf(profileStart?.job)
  if (!job) return null
  const chosen = state && state.job === job.id ? state.state : null
  if (chosen === 'removed') return null
  const at = profileStart.at ? new Date(profileStart.at) : null
  return {
    id: FIRST_SLATE_FACT_ID,
    kind: 'work',
    text: `Works on ${job.label}`,
    source: { type: 'first-slate', ref: job.id, label: 'Your first slate' },
    confidence: 1,
    hidden: chosen === 'hidden',
    derived: true,
    createdAt: at,
    updatedAt: at,
  }
}

const iso = (value) => (value ? new Date(value).toISOString() : null)

/** A fact as the actions and the tab show it: no database fields beyond its id. */
export function publicFact(fact) {
  return {
    id: fact.id ?? fact._id,
    kind: fact.kind,
    text: fact.text,
    source: { ...fact.source },
    confidence: fact.confidence,
    hidden: Boolean(fact.hidden),
    derived: Boolean(fact.derived),
    createdAt: iso(fact.createdAt),
    updatedAt: iso(fact.updatedAt),
  }
}

/** Facts in the tab's order: by kind (FACT_KINDS), then the newest first. */
export function sortFacts(facts) {
  const rank = (kind) => FACT_KINDS.indexOf(kind)
  return [...facts].sort((a, b) =>
    rank(a.kind) - rank(b.kind) || (new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)) || String(a.id ?? a._id).localeCompare(String(b.id ?? b._id)))
}

/** Facts grouped by kind for the tab: [{ kind, label, facts }], kinds with none left out. */
export function groupFacts(facts) {
  const sorted = sortFacts(facts)
  return FACT_KINDS.map((kind) => ({ kind, label: KIND_LABELS[kind], facts: sorted.filter((fact) => fact.kind === kind) })).filter((group) => group.facts.length)
}

/** The words under a fact that say where it came from. */
export function sourceLine(source) {
  switch (source?.type) {
    case 'typed': return source.label ? `Added by ${source.label}` : 'You added this'
    case 'interview': return 'From your talk with the agent'
    case 'integration': return `From ${source.label || source.ref}`
    case 'upload': return `From your ${source.label || source.ref} upload`
    case 'first-slate': return 'From your first slate'
    default: return ''
  }
}

/**
 * What a later model call reads: visible facts from sources that are on, most sure first within a
 * kind, one short line each, bounded by count and characters. '' when personalization is off. The
 * caller wraps this as data, never as instructions.
 */
export function promptLines(facts, settings, { maxFacts = LIMITS.promptFacts, maxChars = LIMITS.promptChars } = {}) {
  if (!personalizationOn(settings)) return ''
  const rank = (kind) => FACT_KINDS.indexOf(kind)
  const usable = facts
    .filter((fact) => !fact.hidden && FACT_KINDS.includes(fact.kind) && sourceOn(settings, fact.source))
    .sort((a, b) => rank(a.kind) - rank(b.kind) || (b.confidence ?? 0) - (a.confidence ?? 0) || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
  const lines = []
  let used = 0
  for (const fact of usable) {
    if (lines.length >= maxFacts) break
    const line = `- ${fact.kind}: ${tidyText(fact.text)}`
    if (used + line.length + 1 > maxChars) break
    lines.push(line)
    used += line.length + 1
  }
  return lines.join('\n')
}

/** Settings as the actions show them. */
export function publicSettings(doc) {
  return {
    on: personalizationOn(doc),
    sources: { ...(doc?.sources || {}) },
    updatedAt: iso(doc?.updatedAt),
  }
}

/** The Download: everything About you holds, as one JSON document of the person's own. */
export function profileDownload({ facts, settings, now = Date.now() }) {
  return {
    format: 'slatebox-about-you',
    version: 1,
    exportedAt: new Date(now).toISOString(),
    personalization: publicSettings(settings),
    facts: sortFacts(facts).map(publicFact),
  }
}
