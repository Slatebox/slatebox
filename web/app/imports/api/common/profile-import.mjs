// Learning from a data export the person uploads (About you › "Learn from a data export", S3,
// 2026-11-26): their LinkedIn "Get a copy of your data" archive (CSV files in a zip), or their
// Facebook or Instagram "Download your information" archive (JSON files in a zip). The server reads
// a few allowed files from it, bounded (server/profile/import-archive.mjs), keeps only a few plain
// fields (a headline, job titles, skills, topics), and the profile.import surface turns that short
// sample into a few proposed facts. The person keeps or skips each one; nothing from the file itself
// is ever kept, and nothing is saved without their Keep.
//
// Pure rules only (no Meteor, no database), shared by the server (server/profile/import-core.mjs)
// and the page (imports/ui/components/profile/ExportUpload.jsx): the exports it reads, the bounds,
// the source kept facts say they came from, the person's refusals, and what a proposal may be.
import { FACT_KINDS, LIMITS, factKey, personalizationOn, sourceKey, sourceOn, tidyText } from './personal-facts.mjs'
import { grounded, sensitive } from './interview.mjs'

// The exports Slatebox reads, each with the name the page and a kept fact show ("From your LinkedIn upload").
export const IMPORT_KINDS = Object.freeze(['linkedin', 'facebook', 'instagram'])
export const IMPORT_LABELS = Object.freeze({ linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram' })

// What an export can say something about: a role (a headline, a job title), the work they do, what they
// are on, the tools and skills they use, the teams they work with and their subjects. Never a goal, a
// routine or a style: an export holds what a site recorded, not the person's own plans.
export const IMPORT_FACT_KINDS = Object.freeze(['role', 'work', 'project', 'tool', 'team', 'topic'])

export const IMPORT_LIMITS = Object.freeze({
  // the uploaded file
  bytes: 15 * 1024 * 1024,
  // facts one upload may propose, and facts one Keep may save
  proposed: 8,
  keep: 8,
  // the sample the prompt reads, all of it
  sampleChars: 6000,
})

export class ImportError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/** The source an export's facts are kept under: an upload, by which export it was. */
export const uploadSource = (kind) => ({ type: 'upload', ref: String(kind || ''), label: IMPORT_LABELS[kind] || String(kind || '') })

/** The switch an export's facts answer to in personalSettings.sources ('upload:linkedin'). */
export const importSwitchKey = (kind) => sourceKey(uploadSource(kind))

/** Whether facts from that export are used: off until the person keeps one (keeping switches it on). */
export const importOn = (settings, kind) => sourceOn(settings, uploadSource(kind))

/** Why the person's own settings stop reading an upload, or null. Said before anything is read. */
export function importRefusal(settings) {
  if (!personalizationOn(settings))
    return { code: 'personalization-off', message: 'Personalization is off, so Slatebox reads nothing you upload. Turn it on in About you first.' }
  return null
}

/** The file as the method receives it: bytes, not empty and within the cap. → Uint8Array. Throws otherwise. */
export function checkUpload(data) {
  const bytes = data instanceof Uint8Array ? data : null
  if (!bytes || !bytes.length) throw new ImportError('no-file', 'Choose the .zip file of your data export.')
  if (bytes.length > IMPORT_LIMITS.bytes)
    throw new ImportError('too-large', `That file is larger than ${Math.round(IMPORT_LIMITS.bytes / (1024 * 1024))} MB. Ask for a smaller export: on LinkedIn the first, smaller file; on Facebook or Instagram only your profile information.`)
  return bytes
}

/**
 * The uploads About you lists, with each one's switch and how many facts it gave: an export the
 * person kept facts from, or switched on or off. → [{ ref, name, on, facts }]
 */
export function uploadRows(settings, facts = []) {
  const counts = {}
  for (const fact of Array.isArray(facts) ? facts : []) {
    if (fact?.source?.type === 'upload' && IMPORT_KINDS.includes(fact.source.ref)) counts[fact.source.ref] = (counts[fact.source.ref] || 0) + 1
  }
  return IMPORT_KINDS
    .filter((kind) => counts[kind] || typeof settings?.sources?.[importSwitchKey(kind)] === 'boolean')
    .map((kind) => ({ ref: kind, name: IMPORT_LABELS[kind], on: importOn(settings, kind), facts: counts[kind] || 0 }))
}

// grounded() reads at most one fact's length of text (personal-facts.mjs tidyText), so a sample is
// read in pieces of whole words, each within that.
function samplePieces(sample) {
  const pieces = []
  for (const line of String(sample || '').split('\n')) {
    let piece = ''
    for (const word of line.split(/\s+/)) {
      if (piece && piece.length + word.length + 1 > LIMITS.text) { pieces.push(piece); piece = '' }
      piece = piece ? `${piece} ${word}` : word
    }
    if (piece) pieces.push(piece)
  }
  return pieces
}

/** Whether a fact has a word of the sample's in it, anywhere in the sample. */
export const groundedInSample = (fact, sample) => samplePieces(sample).some((piece) => grounded(fact, piece))

/**
 * What an upload proposes, ready for the person to keep or skip: kinds from IMPORT_FACT_KINDS, words
 * tidied and bounded, nothing sensitive, nothing the sample does not say, nothing they already keep, no
 * repeats, at most IMPORT_LIMITS.proposed.
 * → { proposed: [{ kind, text }], dropped: { kind, sensitive, ungrounded, known, repeated, over } }
 */
export function proposedImportFacts(facts, { sample = '', known = [] } = {}) {
  const dropped = { kind: 0, sensitive: 0, ungrounded: 0, known: 0, repeated: 0, over: 0 }
  const have = new Set(known.map((item) => (typeof item === 'string' ? item : `${item.kind}\u0000${factKey(item.text)}`)))
  const seen = new Set()
  const proposed = []
  const pieces = samplePieces(sample)
  for (const item of Array.isArray(facts) ? facts : []) {
    const text = tidyText(item?.text, LIMITS.text)
    if (!IMPORT_FACT_KINDS.includes(item?.kind) || !text) { dropped.kind += 1; continue }
    if (sensitive(text)) { dropped.sensitive += 1; continue }
    if (!pieces.some((piece) => grounded({ text }, piece))) { dropped.ungrounded += 1; continue }
    const id = `${item.kind}\u0000${factKey(text)}`
    if (have.has(id)) { dropped.known += 1; continue }
    if (seen.has(id)) { dropped.repeated += 1; continue }
    if (proposed.length >= IMPORT_LIMITS.proposed) { dropped.over += 1; continue }
    seen.add(id)
    proposed.push({ kind: item.kind, text })
  }
  return { proposed, dropped }
}

/**
 * Facts the person chose to keep from an upload, as profile.import.keep receives them: a list of
 * { kind, text }, at most IMPORT_LIMITS.keep, any kind About you keeps (they may have edited the kind).
 * Sensitive ones are refused (never saved, counted). → { facts, refused }
 */
export function importFactsToKeep(facts) {
  if (!Array.isArray(facts) || !facts.length || facts.length > IMPORT_LIMITS.keep)
    throw new ImportError('invalid-keep', `Keep between 1 and ${IMPORT_LIMITS.keep} facts at once.`)
  const out = []
  let refused = 0
  for (const fact of facts) {
    if (!fact || typeof fact !== 'object' || !FACT_KINDS.includes(fact.kind) || typeof fact.text !== 'string' || !fact.text.trim() || fact.text.length > LIMITS.text)
      throw new ImportError('invalid-keep', `Each fact has a kind and up to ${LIMITS.text} characters.`)
    if (sensitive(fact.text)) refused += 1
    else out.push({ kind: fact.kind, text: tidyText(fact.text) })
  }
  return { facts: out, refused }
}
