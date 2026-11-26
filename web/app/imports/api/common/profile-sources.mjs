// Learning from the tools a person connected (About you › "Use <tool> to personalize", S3,
// 2026-11-26). A person switches a tool on (personalSettings.sources['integration:<ref>'], off until
// they do), then asks Slatebox to look around in it: a small, bounded, read-only sample (the tool's
// gallery card says which lookups; the integrations code runs them and quarantines what comes back),
// which the profile.sources surface turns into a few proposed facts. The person keeps or skips each
// one, as with the interview's chips; nothing is saved without their Keep.
//
// Pure rules only (no Meteor, no database), shared by the server (server/profile/sources-core.mjs)
// and the page (imports/ui/components/profile/ToolSources.jsx): the bounds, the source a tool's facts
// are kept under, the person's refusals, the sample as the prompt reads it, and what a proposal may be.
import { FACT_KINDS, LIMITS, factKey, personalizationOn, sourceKey, sourceOn, tidyText } from './personal-facts.mjs'
import { grounded, sensitive } from './interview.mjs'

// The kinds a tool's sample can say something about: what they work on, with what, with whom, how
// and on which subjects. Never a role or a goal (a tool's items are not the person's own words about
// themselves).
export const SOURCE_FACT_KINDS = Object.freeze(['project', 'tool', 'team', 'work', 'topic'])

export const SOURCES_LIMITS = Object.freeze({
  // facts one look may propose, and facts one Keep may save
  proposed: 6,
  keep: 6,
  // the sample the prompt reads: a few entries, each capped, all of it capped
  entries: 3,
  entryChars: 1200,
  sampleChars: 3600,
  // a tool's name as shown and as the prompt reads it
  name: 60,
  // tools listed for switches
  tools: 40,
})

export class SourcesError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/** The source a tool's facts are kept under: a connected tool by its gallery card, with its name. */
export const integrationSource = (tool) => ({ type: 'integration', ref: String(tool?.ref || ''), label: tidyText(tool?.name, LIMITS.label) || String(tool?.ref || '') })

/** The switch a tool answers to in personalSettings.sources ('integration:notion'). */
export const toolSwitchKey = (tool) => sourceKey(integrationSource(tool))

/** Whether a tool's switch is on: off until the person switches it on (personal-facts.mjs sourceOn). */
export const toolOn = (settings, tool) => sourceOn(settings, integrationSource(tool))

/**
 * Why the person's own settings stop a look around a tool, or null: personalization off, or that
 * tool's switch off. Said before anything is read. → null | { code, message }
 */
export function sourceRefusal(settings, tool) {
  const name = tidyText(tool?.name, SOURCES_LIMITS.name) || 'this tool'
  if (!personalizationOn(settings))
    return { code: 'personalization-off', message: 'Personalization is off, so Slatebox reads nothing from your tools. Turn it on in About you first.' }
  if (!toolOn(settings, tool))
    return { code: 'source-off', message: `Switch on “Use ${name} to personalize” first. Slatebox reads nothing from ${name} until you do.` }
  return null
}

/** The tools as About you lists them: name, ref and whether each switch is on, each tool once. */
export function toolRows(tools, settings) {
  const seen = new Set()
  const rows = []
  for (const tool of Array.isArray(tools) ? tools : []) {
    const ref = typeof tool?.ref === 'string' ? tool.ref : ''
    if (!/^[a-z0-9]{1,40}$/.test(ref) || seen.has(ref) || rows.length >= SOURCES_LIMITS.tools) continue
    seen.add(ref)
    const name = tidyText(tool.name, SOURCES_LIMITS.name) || ref
    rows.push({ ref, name, on: toolOn(settings, { ref, name }) })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The look-around's sample as the prompt reads it: each entry's text (already quarantined by the
 * integrations code: plain text, no links followed), capped, joined. '' for nothing. The caller wraps
 * it as data: it is what an outside service said, never instructions.
 */
export function sampleText(sample) {
  const parts = []
  let total = 0
  for (const entry of (Array.isArray(sample) ? sample : []).slice(0, SOURCES_LIMITS.entries)) {
    const text = typeof entry?.text === 'string' ? entry.text.replace(/\s+/g, ' ').trim().slice(0, SOURCES_LIMITS.entryChars) : ''
    if (!text) continue
    const room = SOURCES_LIMITS.sampleChars - total
    if (room <= 0) break
    const piece = text.slice(0, room)
    parts.push(piece)
    total += piece.length
  }
  return parts.join('\n\n')
}

/**
 * What a look proposes, ready for the person to keep or skip: kinds from SOURCE_FACT_KINDS, words
 * tidied and bounded, nothing sensitive, nothing the sample (or the tool's own name) does not say,
 * nothing they already keep, no repeats, at most SOURCES_LIMITS.proposed.
 * → { proposed: [{ kind, text }], dropped: { kind, sensitive, ungrounded, known, repeated, over } }
 */
export function proposedSourceFacts(facts, { sample = '', toolName = '', known = [] } = {}) {
  const dropped = { kind: 0, sensitive: 0, ungrounded: 0, known: 0, repeated: 0, over: 0 }
  const have = new Set(known.map((item) => (typeof item === 'string' ? item : `${item.kind}\u0000${factKey(item.text)}`)))
  const seen = new Set()
  const proposed = []
  const evidence = `${sample}\n${toolName}`
  for (const item of Array.isArray(facts) ? facts : []) {
    const text = tidyText(item?.text, LIMITS.text)
    if (!SOURCE_FACT_KINDS.includes(item?.kind) || !text) { dropped.kind += 1; continue }
    if (sensitive(text)) { dropped.sensitive += 1; continue }
    if (!grounded({ text }, evidence)) { dropped.ungrounded += 1; continue }
    const id = `${item.kind}\u0000${factKey(text)}`
    if (have.has(id)) { dropped.known += 1; continue }
    if (seen.has(id)) { dropped.repeated += 1; continue }
    if (proposed.length >= SOURCES_LIMITS.proposed) { dropped.over += 1; continue }
    seen.add(id)
    proposed.push({ kind: item.kind, text })
  }
  return { proposed, dropped }
}

/**
 * Facts the person chose to keep from a look, as profile.sources.keep receives them: a list of
 * { kind, text }, at most SOURCES_LIMITS.keep, any kind About you keeps (they may have edited the
 * kind). Sensitive ones are refused (never saved, counted). → { facts, refused }
 */
export function sourceFactsToKeep(facts) {
  if (!Array.isArray(facts) || !facts.length || facts.length > SOURCES_LIMITS.keep)
    throw new SourcesError('invalid-keep', `Keep between 1 and ${SOURCES_LIMITS.keep} facts at once.`)
  const out = []
  let refused = 0
  for (const fact of facts) {
    if (!fact || typeof fact !== 'object' || !FACT_KINDS.includes(fact.kind) || typeof fact.text !== 'string' || !fact.text.trim() || fact.text.length > LIMITS.text)
      throw new SourcesError('invalid-keep', `Each fact has a kind and up to ${LIMITS.text} characters.`)
    if (sensitive(fact.text)) refused += 1
    else out.push({ kind: fact.kind, text: tidyText(fact.text) })
  }
  return { facts: out, refused }
}
