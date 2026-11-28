// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// One run of the sheet board: the file's name and kind (1 call), the tab's values (1 call; 2 when the
// tab is not named), the board. No model call, except once at setup when a needed column has no
// header that matches by name. (Drive's watch and the poll trigger a run only on a new version.)
//
// Write-back: with the owner's google.write_sheet permission (one column of this sheet) and a
// board a person changed (a card moved to another lane, while the sheet kept its value), the new
// lane is proposed as a write to that one cell. The runtime performs it only within the grant.
import { diffSeen } from '../_shared/changes.mjs'
import { count, hashOf, plain } from '../_shared/text.mjs'
import { guessColumns, itemsOf, missingColumns, proposeColumns } from './map.mjs'
import { boardSlates, laneKey } from './render.mjs'
import { SHEET_TEMPLATES } from './manifest.mjs'

const a1 = (tab, cell) => `'${String(tab).replace(/'/g, "''")}'!${cell}`
function columnLetter(index) {
  let n = index + 1
  let out = ''
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

export class SheetSetupNeeded extends Error {
  constructor(message, details) {
    super(message)
    this.name = 'SheetSetupNeeded'
    this.code = 'invalid_config'
    this.status = 400
    this.details = details
  }
}

export default async function run(ctx) {
  const config = ctx.instance.config
  const google = ctx.vendor.google
  const cursor = ctx.instance.cursor || {}
  const meta = await google.fileMeta(config.fileId)
  if (meta.mimeType && meta.mimeType !== 'application/vnd.google-apps.spreadsheet') throw new SheetSetupNeeded('That file is not a Google Sheet. Pick a sheet.')
  const tabs = config.tab ? null : await google.sheetTabs(config.fileId)
  const tab = config.tab || tabs?.[0]?.title
  if (!tab) throw new SheetSetupNeeded('That sheet has no tabs.')
  const headerRow = config.headerRow || 1
  const values = await google.sheetValues(config.fileId, a1(tab, `A${headerRow}:Z${headerRow + 2000}`))
  const header = (values[0] || []).map((h) => plain(h, 100))
  const rows = values.slice(1)
  if (!header.some(Boolean)) throw new SheetSetupNeeded(`Row ${headerRow} of ${tab} is empty. Set the header row.`)

  // Columns: the person's, else matched by name, else (once) the model's proposal.
  let columns = config.columns || cursor.columns || guessColumns(header, config.template)
  let missing = missingColumns(columns, config.template)
  if (missing.length && !config.columns && !cursor.proposed) {
    const proposed = await proposeColumns(ctx.ai, header, rows, config.template, columns)
    ctx.setCursor({ proposed: true })
    if (proposed) columns = proposed
    missing = missingColumns(columns, config.template)
  }
  if (missing.length) throw new SheetSetupNeeded(`Say which column holds ${missing.join(' and ')} (${SHEET_TEMPLATES[config.template].label}).`, { missing, header })
  if (config.groupBy && header.includes(config.groupBy)) columns = { ...columns, group: config.groupBy }

  const { items, index } = itemsOf(header, rows, columns, { headerRow })
  const name = `${meta.name} — ${tab}`
  const legend = `Synced from the sheet ${meta.name}, tab ${tab}. Edit the sheet to change the board${config.winner === 'board' ? '; moves on the board stay' : ''}.`

  // What changed in the sheet since the last run (a row's values), for "changed in sheet" and the event.
  const signature = new Map(items.map((i) => [i.key, hashOf(i.cells, 12)]))
  const diff = diffSeen(cursor.rows, signature)
  const changed = new Set(diff.changed.map((c) => c.key))
  const slates = boardSlates(items, { template: config.template, base: { fileId: config.fileId, tab, name, legend }, groupBy: config.groupBy && columns.group ? config.groupBy : null, changedKeys: changed, winner: config.winner || 'sheet' })

  // Board → sheet: a card a person moved, while its row kept the value the board last showed.
  const writes = []
  const laneColumn = { kanban: 'status', 'hiring-plan': 'stage', pipeline: 'stage' }[config.template]
  if (laneColumn && index[laneColumn] !== undefined && typeof ctx.slates.boardState === 'function') {
    const letter = columnLetter(index[laneColumn])
    for (const slate of slates) {
      const state = await ctx.slates.boardState(slate.role, slate.key)
      for (const board of state || []) for (const card of board.cards || []) {
        if (card.owner !== 'person' || !card.key?.startsWith('r:')) continue
        const item = items.find((i) => 'r:' + i.key === card.key)
        const lanes = slate.boards.find((b) => b.key === board.key)?.lanes || []
        const to = lanes.find((l) => l.key === card.lane)
        if (!item || !to || laneKey(item.cells[laneColumn]) === card.lane || changed.has(item.key)) continue
        writes.push({ kind: 'google.write_sheet', target: { fileId: config.fileId, range: a1(tab, `${letter}${item.row}`) }, body: { values: [[to.label]] }, key: `cell:${config.fileId}:${item.key}:${card.lane}` })
      }
    }
  }

  ctx.setCursor({ rows: diff.seen, version: meta.version, ...(!config.columns && { columns }) })
  if (diff.added.length || diff.changed.length || diff.removed.length) ctx.emit('sheet.synced', { fileId: config.fileId, tab, added: diff.added.length, changed: diff.changed.length, removed: diff.removed.length })
  return {
    desired: { slates },
    writes,
    summary: `${count(items.length, 'row', 'rows')} from ${tab}: ${diff.added.length} added, ${diff.changed.length} changed, ${diff.removed.length} removed`,
    stats: { rows: items.length, columns: Object.keys(columns).length },
  }
}
