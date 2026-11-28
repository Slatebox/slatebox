// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// A sheet's rows as items: which header is which (matched by name, so most sheets need no model
// call; the model proposes a mapping only when a needed column has no match), the rows keyed so the
// same row lands on the same card every run, and dates read the way sheets write them.
import { normalKey, plain } from '../_shared/text.mjs'
import { SHEET_TEMPLATES } from './manifest.mjs'

const NAMES = {
  name: ['name', 'full name', 'person', 'employee', 'member'],
  title: ['title', 'job title', 'position', 'task', 'item', 'card', 'summary', 'name'],
  manager: ['manager', 'reports to', 'supervisor', 'lead', 'manager name'],
  department: ['department', 'dept', 'team', 'org', 'group', 'function'],
  id: ['id', 'key', 'employee id', 'ticket', 'ref'],
  email: ['email', 'e mail', 'work email'],
  status: ['status', 'state', 'stage', 'column', 'lane'],
  owner: ['owner', 'assignee', 'assigned to', 'dri', 'responsible', 'recruiter', 'rep'],
  due: ['due', 'due date', 'deadline', 'target date', 'eta', 'date'],
  role: ['role', 'position', 'job', 'opening', 'title'],
  stage: ['stage', 'status', 'step', 'pipeline stage'],
  count: ['count', 'headcount', 'openings', 'number', 'hires'],
  start: ['start', 'start date', 'begins', 'from', 'target start'],
  deal: ['deal', 'opportunity', 'account', 'company', 'customer', 'name'],
  amount: ['amount', 'value', 'arr', 'acv', 'deal size', 'size'],
  close: ['close date', 'close', 'expected close'],
  task: ['task', 'milestone', 'item', 'name', 'title', 'work'],
  end: ['end', 'end date', 'due', 'due date', 'finish', 'deadline'],
  dependsOn: ['depends on', 'dependencies', 'dependency', 'after', 'blocked by', 'predecessor'],
}

/** Header → column name, by name (exact, then contained), each header used once. */
export function guessColumns(header, template) {
  const spec = SHEET_TEMPLATES[template]
  const wanted = [...spec.required, ...spec.optional]
  const keys = header.map((h) => normalKey(h))
  const used = new Set()
  const out = {}
  for (const pass of ['exact', 'contains']) {
    for (const column of wanted) {
      if (out[column]) continue
      for (const synonym of NAMES[column] || []) {
        const at = keys.findIndex((k, i) => !used.has(i) && k && (pass === 'exact' ? k === synonym : (synonym.length >= 3 && k.includes(synonym)) || (k.length >= 4 && synonym.includes(k))))
        if (at >= 0) {
          out[column] = header[at]
          used.add(at)
          break
        }
      }
    }
  }
  return out
}

export const missingColumns = (columns, template) => SHEET_TEMPLATES[template].required.filter((c) => !columns[c])

export const MAPPING_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false, required: ['columns'], properties: { columns: { type: 'object', additionalProperties: { type: 'string' } } } })

/** The model's mapping from the header and five rows (≤ 2k tokens), kept only where it names a real header. */
export async function proposeColumns(ai, header, rows, template, guessed) {
  const spec = SHEET_TEMPLATES[template]
  const prompt = [
    `A Google Sheet will become a ${spec.label.toLowerCase()}. Say which header holds each of: ${[...spec.required, ...spec.optional].join(', ')}. Use the headers exactly as written; leave out any with no match.`,
    `Headers: ${header.map((h) => JSON.stringify(h)).join(', ')}`,
    'First rows:',
    ...rows.slice(0, 5).map((r) => '- ' + r.map((c) => plain(c, 40)).join(' | ')),
  ].join('\n').slice(0, 8000)
  const answer = await ai.json({ prompt, schema: MAPPING_SCHEMA, maxIn: 2000, maxOut: 300, purpose: 'columns' })
  if (!answer?.columns) return null
  const out = { ...guessed }
  for (const [column, name] of Object.entries(answer.columns)) if ([...spec.required, ...spec.optional].includes(column) && header.includes(name) && !Object.values(out).includes(name)) out[column] = name
  return out
}

/**
 * Rows as items: { key, row (sheet row number), cells { column: value } }. Keyed by the id column,
 * else the first column's value and which time it appears (Ana#1, Ana#2), so inserting a row above
 * moves no card. Blank rows are skipped.
 */
export function itemsOf(header, rows, columns, { headerRow = 1 } = {}) {
  const index = Object.fromEntries(Object.entries(columns).map(([column, name]) => [column, header.indexOf(name)]).filter(([, i]) => i >= 0))
  const seen = new Map()
  const items = []
  rows.forEach((row, i) => {
    if (!row.some((cell) => String(cell).trim())) return
    const cells = Object.fromEntries(Object.entries(index).map(([column, at]) => [column, plain(row[at] ?? '', 200)]))
    let key
    if (index.id !== undefined && cells.id) key = 'id:' + normalKey(cells.id)
    else {
      const first = normalKey(row[0] ?? '') || 'row'
      const n = (seen.get(first) || 0) + 1
      seen.set(first, n)
      key = `${first}#${n}`
    }
    items.push({ key, row: headerRow + 1 + i, cells })
  })
  return { items, index }
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
/** A sheet's date as an ISO day (2026-12-05, 12/5/2026, Dec 5, 2026, 5 Dec 2026), or null. */
export function sheetDay(raw) {
  const t = String(raw || '').trim()
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return iso(+m[1], +m[2] - 1, +m[3])
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2])
  m = t.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/)
  if (m && MONTHS[m[1].toLowerCase()] !== undefined) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2])
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/)
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1])
  return null
}
function iso(y, mo, d) {
  const date = new Date(Date.UTC(y, mo, d))
  if (date.getUTCMonth() !== ((mo % 12) + 12) % 12 || date.getUTCDate() !== d) return null
  return date.toISOString().slice(0, 10)
}
