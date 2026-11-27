// Reading a data export (About you › "Learn from a data export", S3): a LinkedIn, Facebook or
// Instagram archive, as a zip in memory. Nothing here is kept: the caller passes the bytes, gets back
// a short plain-text sample of a few allowed fields, and drops the bytes.
//
// The zip is read by hand (no archive library), and only as far as it must be:
//   - the upload is capped before it gets here (IMPORT_LIMITS.bytes);
//   - only the central directory is walked, and at most ARCHIVE_LIMITS.entries entries of it;
//   - only files on an allowlist (by file name, per export) are ever inflated, at most
//     ARCHIVE_LIMITS.files of them; every other file (messages, photos, contacts) is never read;
//   - each allowed file inflates to at most ARCHIVE_LIMITS.entryBytes, all of them together to
//     ARCHIVE_LIMITS.totalBytes, with Node's own output cap (maxOutputLength), so a file that claims
//     to be small and is not stops at the cap; a file far more compressed than text ever is
//     (ARCHIVE_LIMITS.ratio) is a zip bomb and stops the read; two entries that share bytes (the
//     overlapping-file bomb) stop it too;
//   - encrypted entries, zip64, spanned archives and methods other than stored and deflate are refused.
// From what is read, only plain fields are taken (a headline, job titles and employers, skills,
// schools, topics, a bio), never names, contact details, addresses, birthdays, connections, messages
// or anything about the person's private life, and each value is scrubbed of email addresses, links
// and phone numbers. The sample is data the person and a site wrote: the prompt wraps it as data.
import { Buffer } from 'node:buffer'
import { inflateRawSync } from 'node:zlib'
import { IMPORT_LABELS, IMPORT_LIMITS, ImportError } from '../../imports/api/common/profile-import.mjs'
import { tidyText } from '../../imports/api/common/personal-facts.mjs'

export const ARCHIVE_LIMITS = Object.freeze({
  // entries of the central directory walked (a Facebook export lists thousands of photos)
  entries: 50_000,
  // allowed files inflated
  files: 12,
  // one allowed file, inflated, and all of them together
  entryBytes: 2 * 1024 * 1024,
  totalBytes: 6 * 1024 * 1024,
  // inflated bytes per compressed byte past which a file is a bomb (text compresses 3 to 20 times;
  // a run of one character, the bomb's trick, about 1,000 times)
  ratio: 200,
  // rows read from one CSV file
  rows: 400,
})

// The files each export is read from, by file name (lower case). Everything else is never inflated.
export const ALLOWED_FILES = Object.freeze({
  linkedin: Object.freeze(['profile.csv', 'positions.csv', 'skills.csv', 'education.csv', 'certifications.csv', 'languages.csv', 'projects.csv']),
  facebook: Object.freeze(['profile_information.json', 'your_topics.json']),
  instagram: Object.freeze(['personal_information.json', 'your_topics.json']),
})
const ALLOWED = new Set(Object.values(ALLOWED_FILES).flat())
// An export asked for in HTML: Facebook and Instagram offer HTML or JSON, and only JSON is read.
const HTML_ONLY = new Set(['profile_information.html', 'personal_information.html'])

const NOT_EXPORT = 'This does not look like a LinkedIn, Facebook or Instagram data export. Upload the .zip file they sent you, as it came.'
const DAMAGED = 'That file could not be read. Download your export again and upload the .zip file as it came.'

const baseName = (name) => name.split(/[\\/]/).pop().toLowerCase()

/**
 * The allowed files of a zip, inflated within the limits. → { files: [{ name, base, text }], html }
 * (html: the export was asked for in HTML). Throws ImportError for a file that is not a zip, is
 * damaged, or is built to exhaust the server.
 */
export function readArchive(input, { allowed = ALLOWED, limits = ARCHIVE_LIMITS } = {}) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  if (buf.length < 22) throw new ImportError('not-an-export', NOT_EXPORT)
  // the end of the central directory: its last 22 bytes, or before a comment of up to 65,535
  let eocd = -1
  for (let at = buf.length - 22; at >= Math.max(0, buf.length - 22 - 0xffff); at -= 1) {
    if (buf.readUInt32LE(at) === 0x06054b50) { eocd = at; break }
  }
  if (eocd < 0) throw new ImportError('not-an-export', NOT_EXPORT)
  const disk = buf.readUInt16LE(eocd + 4)
  const cdDisk = buf.readUInt16LE(eocd + 6)
  const count = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdStart = buf.readUInt32LE(eocd + 16)
  if (disk !== 0 || cdDisk !== 0) throw new ImportError('damaged', DAMAGED)
  // zip64 (more than 65,535 entries or 4 GB): never an export this small
  if (count === 0xffff || cdSize === 0xffffffff || cdStart === 0xffffffff) throw new ImportError('too-large', 'That export is too large to read here. Ask for a smaller one.')
  if (count > limits.entries) throw new ImportError('too-large', 'That export holds too many files to read here. Ask for a smaller one.')
  const cdEnd = cdStart + cdSize
  if (cdEnd > eocd) throw new ImportError('damaged', DAMAGED)

  const files = []
  const used = []
  let total = 0
  let html = false
  let at = cdStart
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > cdEnd || buf.readUInt32LE(at) !== 0x02014b50) throw new ImportError('damaged', DAMAGED)
    const flags = buf.readUInt16LE(at + 8)
    const method = buf.readUInt16LE(at + 10)
    const packed = buf.readUInt32LE(at + 20)
    const size = buf.readUInt32LE(at + 24)
    const nameLength = buf.readUInt16LE(at + 28)
    const extraLength = buf.readUInt16LE(at + 30)
    const commentLength = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    if (at + 46 + nameLength > cdEnd) throw new ImportError('damaged', DAMAGED)
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', at + 46, at + 46 + nameLength)
    at += 46 + nameLength + extraLength + commentLength
    const base = baseName(name)
    if (HTML_ONLY.has(base)) html = true
    if (name.endsWith('/') || !allowed.has(base)) continue
    // encrypted, or packed in a way an export never is: left alone
    if (flags & 0x1 || (method !== 0 && method !== 8)) continue
    if (files.length >= limits.files) break
    // more than one file may hold: a large one is skipped, not read in part
    if (size > limits.entryBytes || total + size > limits.totalBytes) continue
    if (size > 64 * 1024 && size > packed * limits.ratio) throw new ImportError('bomb', NOT_EXPORT)
    if (local + 30 > cdStart || buf.readUInt32LE(local) !== 0x04034b50) throw new ImportError('damaged', DAMAGED)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const end = start + packed
    if (end > cdStart) throw new ImportError('damaged', DAMAGED)
    // two entries pointing into the same bytes: the overlapping-file bomb
    if (used.some(([from, to]) => local < to && end > from)) throw new ImportError('bomb', NOT_EXPORT)
    used.push([local, end])
    let body
    try {
      body = method === 0 ? buf.subarray(start, end) : inflateRawSync(buf.subarray(start, end), { maxOutputLength: Math.max(1, size) })
    } catch {
      // more than it claimed (Node stopped at the cap), or not deflate at all
      throw new ImportError('damaged', DAMAGED)
    }
    if (body.length !== size) throw new ImportError('damaged', DAMAGED)
    total += size
    files.push({ name, base, text: body.toString('utf8').replace(/^\uFEFF/, '') })
  }
  return { files, html }
}

// ---- the fields taken --------------------------------------------------------------------------

const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi
const LINK = /\b(?:https?:\/\/|www\.)\S+/gi
// a phone number: a run of digits, spaces and dashes with at least nine digits (a year range is not one)
const PHONE = /\+?\d[\d\s().-]{7,}\d/g
const phoneless = (value) => value.replace(PHONE, (run) => ((run.match(/\d/g) || []).length >= 9 ? ' ' : run))

/** A value as the sample takes it: one line, no email addresses, links or phone numbers, capped. */
export function scrub(value, max = 200) {
  if (typeof value !== 'string') return ''
  return tidyText(phoneless(fixMojibake(value).replace(EMAIL, ' ').replace(LINK, ' ')).replace(/\s+/g, ' '), max)
}

// Facebook and Instagram write UTF-8 text as if each byte were a character ("CafÃ©" for "Café"):
// read back as bytes, it is the text they meant.
export function fixMojibake(value) {
  if (!/[\u00c2-\u00f4][\u0080-\u00bf]/.test(value) || /[^\u0000-\u00ff]/.test(value)) return value
  const fixed = Buffer.from(value, 'latin1').toString('utf8')
  return fixed.includes('\ufffd') ? value : fixed
}

/** CSV rows (quotes, doubled quotes, commas and line breaks inside quotes), at most `max` rows. */
export function csvRows(text, max = ARCHIVE_LIMITS.rows) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1 } else quoted = false
      } else cell += c
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      if (rows.length >= max) return rows
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

/**
 * A LinkedIn CSV as records, by its header row: the first row that names `needs` (LinkedIn puts
 * notes above the header of some files). Only the columns named in `take` are kept.
 */
function csvRecords(text, needs, take) {
  const rows = csvRows(text)
  const head = rows.findIndex((row) => row.some((cell) => cell.trim().toLowerCase() === needs.toLowerCase()))
  if (head < 0) return []
  const columns = rows[head].map((cell) => cell.trim().toLowerCase())
  return rows.slice(head + 1).map((row) => {
    const out = {}
    for (const name of take) {
      const index = columns.indexOf(name.toLowerCase())
      if (index >= 0) out[name] = row[index] ?? ''
    }
    return out
  }).filter((record) => Object.values(record).some((value) => String(value).trim()))
}

const listLine = (label, values, max = 30) => {
  const seen = new Set()
  const kept = []
  for (const value of values) {
    const text = scrub(value, 80)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    kept.push(text)
    if (kept.length >= max) break
  }
  return kept.length ? `${label}: ${kept.join(', ')}` : ''
}

const dated = (from, to) => {
  const a = scrub(from, 20)
  const b = scrub(to, 20)
  if (!a && !b) return ''
  return ` (${a || '?'} to ${b || 'now'})`
}

function linkedinSample(byBase) {
  const lines = []
  const profile = byBase['profile.csv'] && csvRecords(byBase['profile.csv'], 'Headline', ['Headline', 'Summary', 'Industry'])[0]
  if (profile) {
    if (scrub(profile.Headline)) lines.push(`Headline: ${scrub(profile.Headline)}`)
    if (scrub(profile.Industry)) lines.push(`Industry: ${scrub(profile.Industry)}`)
    if (scrub(profile.Summary)) lines.push(`About: ${scrub(profile.Summary, 600)}`)
  }
  const positions = byBase['positions.csv'] ? csvRecords(byBase['positions.csv'], 'Company Name', ['Company Name', 'Title', 'Description', 'Started On', 'Finished On']) : []
  const jobs = positions.slice(0, 8).map((job) => {
    const title = scrub(job.Title, 100)
    const company = scrub(job['Company Name'], 100)
    if (!title && !company) return ''
    const about = scrub(job.Description, 300)
    return `- ${[title, company].filter(Boolean).join(' at ')}${dated(job['Started On'], job['Finished On'])}${about ? `: ${about}` : ''}`
  }).filter(Boolean)
  if (jobs.length) lines.push('Positions:', ...jobs)
  if (byBase['skills.csv']) lines.push(listLine('Skills', csvRecords(byBase['skills.csv'], 'Name', ['Name']).map((r) => r.Name), 40))
  if (byBase['education.csv']) {
    const schools = csvRecords(byBase['education.csv'], 'School Name', ['School Name', 'Degree Name'])
      .map((r) => [scrub(r['Degree Name'], 100), scrub(r['School Name'], 100)].filter(Boolean).join(' at '))
    lines.push(listLine('Education', schools, 6))
  }
  if (byBase['certifications.csv']) {
    const certs = csvRecords(byBase['certifications.csv'], 'Name', ['Name', 'Authority'])
      .map((r) => (scrub(r.Authority, 80) ? `${scrub(r.Name, 100)} (${scrub(r.Authority, 80)})` : scrub(r.Name, 100)))
    lines.push(listLine('Certifications', certs, 10))
  }
  if (byBase['languages.csv']) lines.push(listLine('Languages', csvRecords(byBase['languages.csv'], 'Name', ['Name']).map((r) => r.Name), 10))
  if (byBase['projects.csv']) {
    const projects = csvRecords(byBase['projects.csv'], 'Title', ['Title', 'Description']).slice(0, 6)
      .map((r) => { const about = scrub(r.Description, 200); return scrub(r.Title, 100) ? `- ${scrub(r.Title, 100)}${about ? `: ${about}` : ''}` : '' })
      .filter(Boolean)
    if (projects.length) lines.push('Projects:', ...projects)
  }
  return lines.filter(Boolean)
}

const readJSON = (text) => {
  try { return JSON.parse(text) } catch { return null }
}
const asList = (value) => (Array.isArray(value) ? value : [])
const str = (value) => (typeof value === 'string' ? value : '')

// The topics an export lists, however that export spells them: plain strings, { name }, or
// Instagram's { string_map_data: { Name: { value } } }, under any key with "topics" in its name.
function topicsOf(json) {
  const out = []
  for (const [key, value] of Object.entries(json && typeof json === 'object' ? json : {})) {
    if (!/topics/i.test(key)) continue
    for (const item of asList(value)) {
      if (typeof item === 'string') out.push(item)
      else if (str(item?.name)) out.push(item.name)
      else if (str(item?.string_map_data?.Name?.value)) out.push(item.string_map_data.Name.value)
    }
  }
  return out
}

function facebookSample(byBase) {
  const lines = []
  const json = readJSON(byBase['profile_information.json'] || '')
  const profile = json?.profile_v2 || json?.profile || null
  if (profile && typeof profile === 'object') {
    const bio = scrub(str(profile.intro_bio) || str(profile.about_me), 400)
    if (bio) lines.push(`About: ${bio}`)
    const work = asList(profile.work_experiences || profile.work).slice(0, 8).map((job) => {
      const title = scrub(str(job?.title), 100)
      const employer = scrub(str(job?.employer), 100)
      if (!title && !employer) return ''
      const about = scrub(str(job?.description), 300)
      return `- ${[title, employer].filter(Boolean).join(' at ')}${about ? `: ${about}` : ''}`
    }).filter(Boolean)
    if (work.length) lines.push('Work:', ...work)
    const schools = asList(profile.education_experiences).map((school) => {
      const name = scrub(str(school?.name), 100)
      const subjects = asList(school?.concentrations).map((c) => scrub(str(c), 60)).filter(Boolean)
      return [subjects.join(' and '), name].filter(Boolean).join(' at ')
    })
    lines.push(listLine('Education', schools, 6))
    lines.push(listLine('Languages', asList(profile.languages).map((l) => str(l?.name) || str(l)), 10))
  }
  const topics = readJSON(byBase['your_topics.json'] || '')
  if (topics) lines.push(listLine('Topics', topicsOf(topics), 30))
  return lines.filter(Boolean)
}

function instagramSample(byBase) {
  const lines = []
  const json = readJSON(byBase['personal_information.json'] || '')
  for (const user of asList(json?.profile_user).slice(0, 1)) {
    const bio = scrub(str(user?.string_map_data?.Bio?.value), 400)
    if (bio) lines.push(`Bio: ${bio}`)
  }
  const topics = readJSON(byBase['your_topics.json'] || '')
  if (topics) lines.push(listLine('Topics', topicsOf(topics), 30))
  return lines.filter(Boolean)
}

const SAMPLERS = { linkedin: linkedinSample, facebook: facebookSample, instagram: instagramSample }

/** Which export the files are: by the files only that export has. → 'linkedin' | 'facebook' | 'instagram' | null */
export function exportKind(bases) {
  const has = (name) => bases.includes(name)
  if (ALLOWED_FILES.linkedin.some(has)) return 'linkedin'
  if (has('profile_information.json')) return 'facebook'
  if (has('personal_information.json')) return 'instagram'
  return null
}

/**
 * A data export, read: which export it is, its name, and the sample the prompt reads (plain lines,
 * capped at IMPORT_LIMITS.sampleChars; '' when the allowed files say nothing).
 * → { kind, label, sample, files: n }. Throws ImportError when it is not an export Slatebox reads.
 */
export function parseExport(bytes, { limits = ARCHIVE_LIMITS } = {}) {
  const { files, html } = readArchive(bytes, { limits })
  const byBase = {}
  for (const file of files) if (!(file.base in byBase)) byBase[file.base] = file.text
  const kind = exportKind(Object.keys(byBase))
  if (!kind) {
    if (html) throw new ImportError('html-export', 'This export was made as web pages. Ask Facebook or Instagram for it again in the format other services can import, then upload that .zip file.')
    throw new ImportError('not-an-export', NOT_EXPORT)
  }
  let sample = ''
  for (const line of SAMPLERS[kind](byBase)) {
    const next = sample ? `${sample}\n${line}` : line
    if (next.length > IMPORT_LIMITS.sampleChars) break
    sample = next
  }
  return { kind, label: IMPORT_LABELS[kind], sample, files: files.length }
}
