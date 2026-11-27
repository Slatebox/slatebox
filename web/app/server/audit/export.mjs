// The activity log as a file: CSV for a spreadsheet, JSON for a script or a SIEM. Streams, so an
// export of up to 100,000 entries never sits in memory whole. Pure: rows in, text out.
import { describeEntry } from './events.mjs'

export const CSV_COLUMNS = Object.freeze([
  'seq', 'time', 'action', 'summary', 'actor', 'actorKind', 'actorId', 'tokenId', 'targetType', 'targetId', 'targetName',
  'slate', 'via', 'addressHash', 'details', 'entryHash', 'chain',
])

// A cell a spreadsheet would run as a formula (= + - @, and a leading tab or carriage return,
// which some spreadsheets strip before looking) starts with a ' so it stays text.
export function csvCell(value) {
  if (value === undefined || value === null) return ''
  let text = String(value)
  if (value instanceof Date) text = value.toISOString()
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const csvLine = (cells) => `${cells.map(csvCell).join(',')}\r\n`

export function csvRow(event) {
  return csvLine([
    event.seq,
    event.at instanceof Date ? event.at.toISOString() : event.at,
    event.action,
    `${event.actor?.label || ''} ${describeEntry(event)}`.trim(),
    event.actor?.label,
    event.actor?.kind,
    event.actor?.userId,
    event.actor?.tokenId,
    event.target?.type,
    event.target?.id,
    event.target?.name,
    event.slateId,
    event.via,
    event.ipHash,
    event.details ? JSON.stringify(event.details) : '',
    event.entryHash,
    event.chain,
  ])
}

// The JSON form of one entry: what the API answers (audit.list) and the JSON export holds.
export function publicEvent(event) {
  const out = {
    seq: event.seq,
    at: event.at instanceof Date ? event.at.toISOString() : event.at,
    action: event.action,
    summary: describeEntry(event),
    actor: event.actor,
    via: event.via,
  }
  if (event.target) out.target = event.target
  if (event.slateId) out.slateId = event.slateId
  if (event.ipHash) out.addressHash = event.ipHash
  if (event.details) out.details = event.details
  if (event.expiresAt) out.expiresAt = event.expiresAt instanceof Date ? event.expiresAt.toISOString() : event.expiresAt
  out.entryHash = event.entryHash
  if (event.chain) out.chain = event.chain
  return out
}

/**
 * Writes rows (an async iterable) to write(text) as CSV or JSON. → the number of rows written.
 * JSON is one array, written an entry at a time.
 */
export async function writeExport(rows, format, write) {
  let count = 0
  if (format === 'csv') {
    await write(csvLine(CSV_COLUMNS))
    for await (const row of rows) {
      await write(csvRow(row))
      count += 1
    }
    return count
  }
  await write('[')
  for await (const row of rows) {
    await write(`${count ? ',' : ''}\n${JSON.stringify(publicEvent(row))}`)
    count += 1
  }
  await write(count ? '\n]\n' : ']\n')
  return count
}
