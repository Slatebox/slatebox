// Drafting a printable page from a description (workshops.draft, format 'grid'; builder-grid.mjs): the draft_grid tool
// (a page, a grid of cells, a tray of stamps, page 1 composed as a finished example, and the sheet's rules), its
// instructions (workshop.draft.grid, an administrator's to edit), and a check that holds a draft to the sheet's own gate
// (validateWorkshop) and to the quality gate (gridQuality): a page of numbered placeholders, or one with no rule, is
// asked again, naming what is wrong. Rows and columns are 1-based in the tool, as people say them; the board keeps them
// 0-based. A picture's address is never taken from the model: only one found in the person's words is kept.
import { validateWorkshop } from 'slateboxjs/workshops/model'
import 'slateboxjs/workshops/rules'
import { codePromptText, promptText } from '../ai-control/prompts/index.mjs'
import { gridQuality, repairGrid } from '../../imports/api/common/builder-grid.mjs'

const TYPES = ['heading', 'text', 'image', 'question', 'answer-lines', 'word-bank', 'diagram', 'qr', 'panel', 'speech', 'term', 'sticker']
const tile = {
  type: 'object', additionalProperties: false, required: ['type', 'label'], properties: {
    type: { $ref: '#/$defs/type' }, label: { type: 'string', minLength: 1, maxLength: 80 }, body: { type: 'string', maxLength: 600 },
    words: { type: 'array', minItems: 3, maxItems: 24, items: { type: 'string', maxLength: 40 } },
    alt: { type: 'string', maxLength: 120 }, link: { type: 'string', maxLength: 2048 },
    row: { type: 'integer', minimum: 1 }, col: { type: 'integer', minimum: 1 }, rows: { type: 'integer', minimum: 1 }, cols: { type: 'integer', minimum: 1 },
  },
}

/** The tool (spec §6): the page, its grid, the tray's stamps, the pages' tiles and the rules. */
export const gridAuthorTool = {
  name: 'draft_grid',
  description: codePromptText('tool.draft_grid'),
  parameters: {
    type: 'object', additionalProperties: false, required: ['title', 'page', 'grid', 'tray', 'pages', 'rules'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 120 },
      page: { type: 'object', additionalProperties: false, required: ['size', 'orientation'], properties: {
        size: { enum: ['letter', 'a4'] }, orientation: { enum: ['portrait', 'landscape'] }, margin: { type: 'number', minimum: 0.25, maximum: 1 } } },
      grid: { type: 'object', additionalProperties: false, required: ['rows', 'cols'], properties: {
        rows: { type: 'integer', minimum: 1, maximum: 12 }, cols: { type: 'integer', minimum: 1, maximum: 8 }, gutter: { type: 'number', minimum: 0, maximum: 0.5 } } },
      tray: { type: 'array', minItems: 2, maxItems: 12, items: { $ref: '#/$defs/tile' }, description: 'Stamps people drag onto the page; each drop makes a copy.' },
      pages: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['tiles'], properties: {
        label: { type: 'string', maxLength: 40 },
        tiles: { type: 'array', maxItems: 60, items: { allOf: [{ $ref: '#/$defs/tile' }], required: ['type', 'label', 'row', 'col'] } } } } },
      rules: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['kind'], properties: {
        kind: { enum: ['allow', 'max', 'needs', 'span'] }, types: { type: 'array', items: { $ref: '#/$defs/type' } },
        type: { $ref: '#/$defs/type' }, max: { type: 'integer', minimum: 1, maximum: 60 }, atLeast: { type: 'integer', minimum: 1, maximum: 12 },
        per: { enum: ['page', 'sheet'] }, rows: { type: 'integer', minimum: 1, maximum: 12 }, cols: { type: 'integer', minimum: 1, maximum: 8 } } } },
    },
    $defs: { type: { enum: TYPES }, tile },
  },
}
/** The tool as a request sends it: its description the published prompt (tool.draft_grid). */
export const gridTool = () => ({ ...gridAuthorTool, description: promptText('tool.draft_grid') })

const readJSON = (value) => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}
const list = (value) => { const read = readJSON(value); return Array.isArray(read) ? read.map(readJSON) : read }
const int = (value) => (typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value)
const num = (value) => (typeof value === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(value) ? Number(value) : value)
const RULES = { allow: 'tileTypes', max: 'tileMax', needs: 'tileNeeds', span: 'tileSpan' }

/** A tool tile as a tile (its words; a picture's words only, never its address; a QR code's address only from the person's words). */
function tileFrom(raw, { message, stamp }) {
  const item = readJSON(raw)
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('A tile is an object with a type and a label.')
  const out = { type: item.type }
  if (typeof item.body === 'string' && item.body.trim()) out.body = item.body
  const words = list(item.words)
  if (words !== undefined && words !== null) out.words = words
  if (['image', 'diagram', 'sticker', 'panel'].includes(item.type) && (item.alt || item.type === 'image' || item.type === 'diagram')) out.image = { alt: String(item.alt || item.label || 'A picture').slice(0, 120) }
  if (item.type === 'qr' && typeof item.link === 'string' && message.includes(item.link.trim())) out.link = item.link.trim()
  if (stamp) out.stamp = true
  return { label: typeof item.label === 'string' ? item.label.trim() : item.label, tile: out, at: item }
}

/**
 * A grid draft as a board: its tray stamps, its pages' tiles (1-based rows and columns made 0-based), its rules made the
 * sheet's rulebook (allow, max, needs and span are tileTypes, tileMax, tileNeeds and tileSpan, set by the agent from the
 * chat), its unambiguous slips repaired (repairGrid), then read by validateWorkshop. Throws what is wrong.
 */
export function parseGridDraft(args, { message = '', now = new Date() } = {}) {
  const draft = readJSON(args)
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('The draft_grid call came with no page: send the whole page in its arguments.')
  const page = readJSON(draft.page) ?? {}, grid = readJSON(draft.grid) ?? {}
  let n = 0
  const id = () => 'tile-' + (++n)
  const stamps = (list(draft.tray) ?? [])
  const pages = (list(draft.pages) ?? [])
  if (!Array.isArray(stamps) || !Array.isArray(pages) || !pages.length) throw new Error('Give the sheet a tray of tiles and at least one page.')
  const lanes = [{ id: 'tray', label: 'Tiles' }, ...pages.map((item, i) => ({ id: 'page-' + (i + 1), label: (readJSON(item)?.label || 'Page ' + (i + 1)).toString().slice(0, 40) }))]
  const cards = []
  for (const raw of stamps) { const { label, tile } = tileFrom(raw, { message, stamp: true }); cards.push({ id: id(), label, laneId: 'tray', tile }) }
  pages.forEach((item, i) => {
    for (const raw of list(readJSON(item)?.tiles) ?? []) {
      const { label, tile, at } = tileFrom(raw, { message })
      const row = int(at.row), col = int(at.col), rows = int(at.rows), cols = int(at.cols)
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 1 || col < 1) throw new Error(`Place ${label ? '“' + label + '”' : 'every tile'} at a row and a column, counted from 1.`)
      cards.push({ id: id(), label, laneId: 'page-' + (i + 1), tile, cell: { row: row - 1, col: col - 1, ...(rows > 1 && { rows }), ...(cols > 1 && { cols }) } })
    }
  })
  const set = { by: 'Slatebox agent', at: new Date(now).toISOString(), via: 'chat' }
  const rules = (list(draft.rules) ?? []).map((raw, i) => {
    const item = readJSON(raw) ?? {}
    const kind = RULES[item.kind]
    if (!kind) throw new Error('A rule is allow, max, needs or span.')
    const body = kind === 'tileTypes' ? { types: list(item.types) } : kind === 'tileMax' ? { type: item.type, max: int(item.max), per: item.per ?? 'page' }
      : kind === 'tileNeeds' ? { type: item.type, atLeast: int(item.atLeast ?? 1), per: 'page' } : { type: item.type, rows: int(item.rows), cols: int(item.cols) }
    return { id: 'rule-' + (i + 1), kind, on: true, severity: 'refuse', set, ...body }
  })
  // A margin or a gap a little off the page's steps (0.1 inch, 0.3 inch) is taken to the nearest step it allows.
  const stepped = (value, step, low, high) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value / step) * step)) : value)
  const board = {
    version: 1, kind: 'grid', title: typeof draft.title === 'string' ? draft.title.trim() : draft.title,
    grid: { page: { size: page.size, orientation: page.orientation, margin: stepped(num(page.margin ?? 0.5), 0.125, 0.25, 1) },
      cells: { rows: int(grid.rows), cols: int(grid.cols), gutter: stepped(num(grid.gutter ?? 0.125), 0.0625, 0, 0.5) } },
    lanes, cards, ...(rules.length && { behaviour: { version: 1, rev: 1, rules } }),
  }
  const { workshop } = repairGrid(board, { message })
  return validateWorkshop(workshop)
}

/**
 * The check a grid draft's answer gets (req's validateResponse): null when it is a sheet that passes the quality gate,
 * else what to ask again, naming the problem (invalidGridDraft: the sheet does not hold together; weakGridDraft: it does,
 * and would not be printed as it is).
 */
export function gridDraftCheck(toolCall, { tool = gridTool(), message = '' } = {}) {
  const ask = (code, problem) => ({ code, retryPrompt: promptText('workshop.draft.repair', { instructions: promptText('workshop.draft.grid'), problem: problem + ' Return a complete draft_grid tool call.' }) })
  let sheet
  try {
    if (toolCall?.name !== tool.name) throw new Error('Call the requested tool.')
    sheet = parseGridDraft(toolCall.arguments, { message })
  } catch (error) {
    return ask('invalidGridDraft', String(error.message))
  }
  const quality = gridQuality(sheet, { message })
  return quality.length ? ask('weakGridDraft', quality.join(' ')) : null
}
