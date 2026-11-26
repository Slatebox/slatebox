#!/usr/bin/env node
// The owner's words as a printable page, end to end in a fresh browser on a running app (snap-grid spec §11, owner's
// choice 2026-11-25): "snappable congruent pieces to compose new printable materials" typed on /new#build is previewed
// as a grid sheet (a page of cells and a tray of tiles), kept, and then used:
//   - every tile is a note exactly at its cell's box on the page (measured on the page, as it is drawn);
//   - a stamp dragged onto a free cell leaves a copy there and stays in the tray; one dragged onto a taken cell, with no
//     free cell beside it, goes back, and nothing overlaps;
//   - each tile on the page shows its own words, never its name over them (the page as it prints);
//   - the board's title row is on screen, clear of the toolbar and of Print / Export PDF;
//   - "make it N columns" in chat, N a count the page does not have (the one the reply suggests), kept, reflows the
//     page: the caption and the cell guides say N columns, every tile moved to a cell of the new grid, none overlap;
//   - Print: the print frame holds one SVG a page at 8.5in × 11in, with no "Print anyway?" (an empty frame) asked;
//   - Export PDF: the download reads back (pdf-lib) as Letter pages, 612 × 792 points;
//   - Present: Print / Export PDF is not shown while the slate is presented.
// A fresh browser context for each run (no cookies, no stored login): a new account, made over DDP (the agent drafts),
// and a guest (the starter from the words). Then a phone (iPhone 13, touch): the sheet kept, Print docked under the
// canvas covering nothing, a stamp dragged onto a free cell by touch. And a board of lanes (a kanban) on the same
// build: its title on screen, no print control. Screenshots of each step go to --shots. Exit 1 on any failed step.
//
//   node scripts/evals/smart-components/grid-e2e.mjs --origin http://127.0.0.1:3780 --shots <dir>
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, devices } from 'playwright'
import { createRequire } from 'node:module'
import { DDP } from './ddp.mjs'

// pdf-lib is the app's (web/app), read the way the page reads it.
const { PDFDocument } = createRequire(new URL('../../../web/app/package.json', import.meta.url))('pdf-lib')

const { values: args } = parseArgs({ options: {
  origin: { type: 'string', default: process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3780' },
  shots: { type: 'string', default: '' },
  message: { type: 'string', default: 'snappable congruent pieces to compose new printable materials' },
  only: { type: 'string', default: '' },
} })
if (args.shots) mkdirSync(args.shots, { recursive: true })
const browser = await chromium.launch({ ...(process.env.SLATEBOX_CHROMIUM && { executablePath: process.env.SLATEBOX_CHROMIUM }) })
const panel = (page) => page.locator('aside[aria-label="Ask Slatebox"]')
const shot = async (page, name) => { if (args.shots) await page.screenshot({ path: join(args.shots, name + '.png') }) }
async function until(what, check, ms = 90000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check().catch(() => false)) return
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error('never arrived: ' + what)
}

// The page as it is drawn: the page note's box, the grid its caption names, the tiles on it and the tray's stamps.
const drawn = (page) => page.evaluate(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
  const node = (id) => document.querySelector(`#slateCanvas [data-node-id="${id}"]`)
  const pageNote = node('column-page-1')?.querySelector('path, rect') ?? node('column-page-1')
  const caption = [...document.querySelectorAll('#slateCanvas [data-node-id="caption-page-1"] text, #slateCanvas [data-node-id="caption-page-1"] tspan')].map((t) => t.textContent).join(' ')
  const tray = node('column-tray')
  // A note's box is its shape's (its words may run past it while they wrap).
  const shape = (el) => el.querySelector('path, rect') ?? el
  const cards = [...document.querySelectorAll('#slateCanvas [data-node-id^="card-"]')].map((el) => ({ id: el.getAttribute('data-node-id'), box: box(shape(el)), text: el.textContent }))
  const guides = [...document.querySelectorAll('[data-board-layer="grid-cell"]')].map(box)
  return { page: pageNote && box(pageNote), tray: tray && box(tray), caption, cards, guides }
})
const inside = (b, r) => b.x + b.width / 2 >= r.x && b.x + b.width / 2 <= r.x + r.width && b.y + b.height / 2 >= r.y && b.y + b.height / 2 <= r.y + r.height

/**
 * The grid a caption names ("Letter · 4 × 2 · 7 of 8 cells"): rows and columns; and each cell's box on the screen, as the
 * board's own cell guides are drawn (the first page's, row by row).
 */
function cellsOf(view) {
  const m = /(\d+)\s*×\s*(\d+)/.exec(view.caption)
  if (!m) throw new Error('no grid in the caption: ' + view.caption)
  const rows = Number(m[1]), cols = Number(m[2])
  const guides = view.guides.slice(0, rows * cols)
  if (guides.length !== rows * cols) throw new Error('the cell guides are not drawn')
  const cell = (row, col) => guides[row * cols + col]
  const gap = cols > 1 ? cell(0, 1).x - cell(0, 0).x - cell(0, 0).width : 0
  const gapY = rows > 1 ? cell(1, 0).y - cell(0, 0).y - cell(0, 0).height : 0
  const span = (row, col, rs, cs) => ({ x: cell(row, col).x, y: cell(row, col).y, width: cs * cell(0, 0).width + (cs - 1) * gap, height: rs * cell(0, 0).height + (rs - 1) * gapY })
  return { rows, cols, cell, span }
}

/** The tiles on page 1 as cells of the grid: each at a cell's corner and the size of a span of cells, or an error. */
function placedOf(view, grid, tol = 1.5) {
  const placed = []
  for (const card of view.cards.filter((item) => inside(item.box, view.page))) {
    const fit = []
    for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
      const a = grid.cell(r, c)
      if (Math.abs(a.x - card.box.x) <= tol && Math.abs(a.y - card.box.y) <= tol) fit.push([r, c])
    }
    if (!fit.length) throw new Error(`${card.id} is not at a cell's corner`)
    const [r, c] = fit[0]
    // The span whose box this tile is (1 by 1, or rows by columns with the gutters between them).
    let found = null
    for (let rows = 1; rows <= grid.rows - r && !found; rows++) for (let cols = 1; cols <= grid.cols - c && !found; cols++) {
      const want = grid.span(r, c, rows, cols)
      if (Math.abs(want.width - card.box.width) <= tol * 2 && Math.abs(want.height - card.box.height) <= tol * 2) found = { rows, cols }
    }
    if (!found) throw new Error(`${card.id} is not a cell's size`)
    placed.push({ id: card.id, box: card.box, r, c, ...found })
  }
  return placed
}
/** Two tiles over one cell, or two boxes that cross (more than a pixel): the first such pair, else null. */
function overlapOf(placed) {
  const seen = new Map()
  for (const t of placed) for (let r = t.r; r < t.r + t.rows; r++) for (let c = t.c; c < t.c + t.cols; c++) {
    const key = r + ':' + c
    if (seen.has(key)) return [seen.get(key), t.id]
    seen.set(key, t.id)
  }
  for (const a of placed) for (const b of placed) {
    if (a.id >= b.id) continue
    const w = Math.min(a.box.x + a.box.width, b.box.x + b.box.width) - Math.max(a.box.x, b.box.x)
    const h = Math.min(a.box.y + a.box.height, b.box.y + b.box.height) - Math.max(a.box.y, b.box.y)
    if (w > 1 && h > 1) return [a.id, b.id]
  }
  return null
}
const crosses = (a, b, pad = 0) => Boolean(a && b) && a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad

/** The board model the page holds (its subscription), with what each tile's note shows: the page as it prints. */
const modelAndWords = (page) => page.evaluate(() => {
  const store = window.Meteor?.connection?._stores?.creativeSlateStates
  const docs = store?._getCollection?.().find({}).fetch() ?? []
  const model = docs.map((doc) => doc.model?.workshop ?? doc.model).find((m) => m?.kind === 'grid') ?? null
  const words = {}
  for (const el of document.querySelectorAll('#slateCanvas [data-node-id^="card-"]')) words[el.getAttribute('data-node-id').slice(5)] = [...el.querySelectorAll('text, tspan')].filter((t) => !t.querySelector('tspan')).map((t) => t.textContent).join(' ').replace(/\s+/g, ' ').trim()
  return { model, words }
})
const plain = (text) => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** The board's title row and legend as drawn (the chrome layer), and the toolbar's foot, on screen. */
const chromeOf = (page) => page.evaluate(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
  const title = document.querySelector('[data-board-layer="board-title"]')
  const legend = [...document.querySelectorAll('[data-board-layer="legend"], [data-board-layer="legend-box"]')].map(box)
  const canvas = document.querySelector('#slateCanvas')?.getBoundingClientRect()
  const bar = document.querySelector('header, .MuiAppBar-root')?.getBoundingClientRect()
  const control = document.querySelector('[data-grid-print-control]')
  return { title: title && box(title), titleText: title?.textContent ?? null, legend, canvasTop: canvas?.top ?? 0, barBottom: bar?.bottom ?? 0, control: control && box(control) }
})

async function run(name, login) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  if (login) await context.addInitScript(({ token, userId }) => {
    localStorage.setItem('Meteor.loginToken', token)
    localStorage.setItem('Meteor.loginTokenExpires', new Date(Date.now() + 864e5).toString())
    localStorage.setItem('Meteor.userId', userId)
  }, login)
  const page = await context.newPage()
  const errors = []
  const dialogs = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.accept() })
  const out = { steps: [] }
  try {
    await page.goto(args.origin + '/new#build', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
    out.shareId = page.url().split('/').pop()
    out.anonymous = await page.evaluate(() => window.Meteor?.user()?.isAnonymous ?? null)
    out.token = await page.evaluate(() => Boolean(localStorage.getItem('Meteor.loginToken')))
    await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {})
    if (!(await panel(page).isVisible().catch(() => false))) await page.locator('[data-conversation-toggle]').first().click()
    await until('the Ask Slatebox panel', () => panel(page).isVisible())
    const box = panel(page).getByRole('textbox', { name: 'Message Slatebox' })
    await box.fill(args.message)
    const asked = Date.now()
    await box.press('Enter')
    await until('the preview (Keep changes)', () => panel(page).getByRole('button', { name: 'Keep changes' }).isVisible(), 150000)
    out.previewMs = Date.now() - asked
    await page.waitForTimeout(1500)
    const lines = (await panel(page).innerText()).split('\n')
    out.heading = lines.find((line) => /preview · /i.test(line)) ?? null
    out.said = lines.find((line) => /^(Drafted|Started) “/.test(line)) ?? null
    if (!/Smart component/.test(out.heading ?? '')) throw new Error('the preview heading is ' + JSON.stringify(out.heading))
    if (!/page, \d+ by \d+ cells/.test(out.said ?? '')) throw new Error('the preview does not say it made a page: ' + JSON.stringify(out.said))
    out.steps.push('preview')
    await shot(page, `${name}-1-preview`)
    await panel(page).getByRole('button', { name: 'Keep changes' }).click()
    await until('the kept sheet', async () => (await page.locator('#slateCanvas [data-board-layer="draft-tag"]').count()) === 0 && Boolean((await drawn(page)).page), 60000)
    await page.waitForTimeout(1500)
    // Fit the whole sheet in view.
    await page.keyboard.press('Escape').catch(() => {})
    out.steps.push('kept')
    await shot(page, `${name}-2-kept`)

    // Every tile on page 1 is exactly at a cell's box (or a span of them), measured on the page as drawn.
    let view = await drawn(page)
    let grid = cellsOf(view)
    const tol = 1.5
    const onPage = view.cards.filter((card) => inside(card.box, view.page))
    const placed = placedOf(view, grid, tol)
    out.tilesAtCells = placed.length
    out.steps.push('tiles at cells')
    // The page as it prints: each tile's note shows its own words; a name over them ("B Column Number Square" above
    // "7") is not printed. Read against the board the page holds.
    const { model, words } = await modelAndWords(page)
    if (!model) throw new Error('the page holds no grid model to read the tiles against')
    const named = model.cards.filter((card) => card.laneId !== model.lanes[0].id && card.tile?.body?.trim() && !['answer-lines', 'qr'].includes(card.tile.type)
      && !plain(card.tile.body).includes(plain(card.label)) && plain(words[card.id]).includes(plain(card.label)))
    out.namesPrinted = named.map((card) => card.label)
    if (named.length) throw new Error('tiles show their names over their words: ' + out.namesPrinted.slice(0, 3).join(', '))
    out.steps.push('tiles show their own words')
    // The title row on screen: below the toolbar, inside the canvas, clear of Print / Export PDF and of its own chips.
    const chrome = await chromeOf(page)
    out.title = chrome.title
    if (!chrome.title) throw new Error('no board title drawn')
    if (chrome.title.y < Math.max(chrome.canvasTop, chrome.barBottom) - 1) throw new Error(`the board title is cut off under the toolbar (title top ${chrome.title.y}, canvas top ${chrome.canvasTop})`)
    if (crosses(chrome.title, chrome.control)) throw new Error('Print / Export PDF covers the board title')
    const chipOver = chrome.legend.find((chip) => crosses(chip, chrome.title, -1))
    if (chipOver) throw new Error('a rule chip sits over the board title')
    if (chrome.legend.some((chip) => crosses(chip, chrome.control))) throw new Error('Print / Export PDF covers a rule chip')
    out.steps.push('title on screen and clear')
    const taken = (list) => { const set = new Set(); for (const t of list) for (let r = t.r; r < t.r + t.rows; r++) for (let c = t.c; c < t.c + t.cols; c++) set.add(r + ':' + c); return set }
    let held = taken(placed)
    const free = []
    for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) if (!held.has(r + ':' + c)) free.push([r, c])
    out.freeBefore = free.length
    if (!free.length) throw new Error('page 1 has no free cell to drop on')

    // A stamp (a 1 by 1 kind, not a heading) dragged onto the first free cell: a copy snaps there, the stamp stays.
    const stamps = view.cards.filter((card) => inside(card.box, view.tray))
    const drag = async (from, to) => {
      const grab = { x: from.width / 2, y: from.height / 2 }
      await page.mouse.move(from.x + grab.x, from.y + grab.y)
      await page.mouse.down()
      const target = { x: to.x + grab.x * (to.width / from.width) * 0 + Math.min(grab.x, to.width / 2), y: to.y + Math.min(grab.y, to.height / 2) }
      await page.mouse.move(target.x, target.y, { steps: 24 })
      await page.waitForTimeout(300)
      await page.mouse.up()
      await page.waitForTimeout(1500)
    }
    const before = view.cards.length
    const [fr, fc] = free[0]
    // The first stamp the sheet's rules let onto that cell (a heading spans a row; a kind may be at its limit): a refused
    // one goes back, saying why, and the next is tried.
    let stamp = null, copy = null
    for (const tried of stamps) {
      await drag(tried.box, grid.cell(fr, fc))
      view = await drawn(page)
      copy = view.cards.find((card) => !onPage.some((was) => was.id === card.id) && inside(card.box, view.page))
      if (copy) { stamp = tried; break }
      out.refusedStamps = (out.refusedStamps ?? 0) + 1
    }
    if (view.cards.length !== before + 1 || !copy) throw new Error('no copy landed on the page (' + before + ' → ' + view.cards.length + ')')
    const at = grid.cell(fr, fc)
    if (Math.abs(copy.box.x - at.x) > tol || Math.abs(copy.box.y - at.y) > tol) throw new Error('the copy did not snap to the free cell')
    if (!view.cards.some((card) => card.id === stamp.id && inside(card.box, view.tray))) throw new Error('the stamp left the tray')
    out.steps.push('stamp copied into a free cell')
    await shot(page, `${name}-3-dropped`)

    // Onto a taken cell with no free cell beside it: it goes back, and nothing overlaps.
    held = taken([...placed, { r: fr, c: fc, rows: 1, cols: 1 }])
    const full = []
    for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
      if (!held.has(r + ':' + c)) continue
      let near = false
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < grid.rows && cc < grid.cols && !held.has(rr + ':' + cc)) near = true }
      if (!near) full.push([r, c])
    }
    if (full.length) {
      const count = view.cards.length
      const [tr, tc] = full.at(-1)
      await drag(stamp.box, grid.cell(tr, tc))
      const after = await drawn(page)
      out.refusedOnTaken = after.cards.length === count
      if (!out.refusedOnTaken) throw new Error('a stamp dropped on a taken cell landed')
      out.steps.push('taken cell refused')
    }
    await shot(page, `${name}-4-refused`)

    // "make it N columns", N a count the page does not have (the one the reply suggested): the chat's proposal, kept,
    // reflows the page. The caption and the cell guides say N; every tile moved to a cell of the new grid; none overlap.
    const fromCols = grid.cols
    const suggested = /make it (\d+) columns/.exec(out.said ?? '')
    const toCols = suggested ? Number(suggested[1]) : (fromCols === 3 ? 2 : 3)
    if (toCols === fromCols) throw new Error(`the reply suggests ${toCols} columns, which the page already has`)
    const beforeReflow = Object.fromEntries((await drawn(page)).cards.map((card) => [card.id, card.box]))
    const tilesBefore = Object.keys(beforeReflow).length
    const ask = panel(page).getByRole('textbox', { name: 'Message Slatebox' })
    await ask.fill(`make it ${toCols} columns`)
    await ask.press('Enter')
    await until('the reflow proposal', () => panel(page).getByRole('button', { name: 'Keep changes' }).isVisible(), 60000)
    await shot(page, `${name}-5-columns-preview`)
    await panel(page).getByRole('button', { name: 'Keep changes' }).click()
    await until(`${toCols} columns`, async () => cellsOf(await drawn(page)).cols === toCols, 30000)
    await page.waitForTimeout(1200)
    view = await drawn(page)
    grid = cellsOf(view)
    out.caption = view.caption
    out.reflow = { from: fromCols, to: grid.cols }
    if (grid.cols !== toCols || grid.cols === fromCols) throw new Error(`the page has ${grid.cols} columns after "make it ${toCols} columns" (was ${fromCols})`)
    // The guides are the new grid: N to a row, each row's first guide at the same x.
    if (Math.abs(grid.cell(0, toCols - 1).y - grid.cell(0, 0).y) > tol || (grid.rows > 1 && Math.abs(grid.cell(1, 0).x - grid.cell(0, 0).x) > tol)) throw new Error('the cell guides are not drawn as the new grid')
    const reflowed = placedOf(view, grid, tol)
    const clash = overlapOf(reflowed)
    if (clash) throw new Error('tiles overlap after the reflow: ' + clash.join(' and '))
    if (view.cards.length !== tilesBefore) throw new Error(`the reflow lost or made tiles (${tilesBefore} → ${view.cards.length})`)
    out.movedTiles = reflowed.filter((t) => { const was = beforeReflow[t.id]; return !was || Math.abs(was.x - t.box.x) > tol || Math.abs(was.width - t.box.width) > tol }).length
    if (!out.movedTiles) throw new Error('no tile moved: the page did not reflow')
    out.steps.push(`${fromCols} → ${toCols} columns`)
    await shot(page, `${name}-6-columns`)

    // Print: one SVG a page at 8.5in × 11in in the print frame.
    await page.locator('[data-grid-print-control] [data-grid-print]').click()
    await until('the print frame', () => page.locator('iframe[data-grid-print]').count().then((n) => n > 0), 30000)
    out.print = await page.evaluate(() => {
      const frame = document.querySelector('iframe[data-grid-print]')
      // One page box a page, each holding the page's SVG (a note's own nested SVG is inside it).
      const svgs = [...frame.contentDocument.querySelectorAll('.page > svg')]
      return { pages: frame.contentDocument.querySelectorAll('.page').length, width: svgs[0]?.getAttribute('width'), height: svgs[0]?.getAttribute('height'), viewBox: svgs[0]?.getAttribute('viewBox'),
        css: frame.contentDocument.querySelector('style')?.textContent.match(/@page\{[^}]*\}/)?.[0],
        guides: frame.contentDocument.querySelectorAll('[data-export-never]').length, notes: svgs[0]?.querySelectorAll('[data-node-id]').length }
    })
    out.dialogs = [...dialogs]
    // The page the words made prints as it is: no "has no picture yet … Print anyway?" (an empty gray frame) to answer.
    if (dialogs.some((text) => /no picture yet|prints as an empty frame/.test(text))) throw new Error('printing asks about an empty picture frame: ' + dialogs.find((text) => /no picture/.test(text)))
    if (out.print.width !== '8.5in' || out.print.height !== '11in') throw new Error('the printed page is ' + out.print.width + ' × ' + out.print.height)
    if (out.print.guides) throw new Error('the cell guides were printed')
    out.steps.push('print 8.5in × 11in')
    await shot(page, `${name}-7-printed`)

    // Export PDF: the download reads back as Letter pages.
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.locator('[data-grid-print-control] [data-grid-pdf]').click()])
    const file = join(args.shots || '/tmp', `${name}-sheet.pdf`)
    await download.saveAs(file)
    const pdf = await PDFDocument.load(readFileSync(file))
    out.pdf = { file, name: download.suggestedFilename(), pages: pdf.getPageCount(), size: pdf.getPage(0).getSize() }
    if (Math.round(out.pdf.size.width) !== 612 || Math.round(out.pdf.size.height) !== 792) throw new Error('the PDF page is ' + JSON.stringify(out.pdf.size))
    out.steps.push('PDF 612 × 792')
    await shot(page, `${name}-8-pdf`)
    // Present: the presenter covers the canvas; Print / Export PDF is not shown in it. Back on the canvas, it is.
    await page.getByRole('button', { name: 'Present', exact: true }).first().click()
    await until('the presenter', () => page.getByRole('button', { name: 'Exit presentation' }).first().isVisible(), 30000)
    await page.waitForTimeout(800)
    out.printInPresent = await page.locator('[data-grid-print-control]').isVisible().catch(() => false)
    await shot(page, `${name}-9-present`)
    if (out.printInPresent) throw new Error('Print / Export PDF shows while the slate is presented')
    await page.keyboard.press('Escape')
    await until('the canvas again', async () => !(await page.getByRole('button', { name: 'Exit presentation' }).first().isVisible().catch(() => false)), 15000)
    await until('Print / Export PDF back on the canvas', () => page.locator('[data-grid-print-control]').isVisible(), 15000)
    out.steps.push('no print control in Present')
    if (errors.length) throw new Error('page errors: ' + errors.slice(0, 2).join(' | '))
    out.ok = true
  } catch (error) {
    out.ok = false
    out.error = error.message
    await shot(page, `${name}-x-failed`).catch(() => {})
  } finally {
    out.errors = errors.slice(0, 5)
    await context.close()
  }
  return out
}

/** A fresh guest context on /new#build: the words typed in Ask Slatebox, the preview kept, the panel closed. */
async function keptAsGuest(context, message, name) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto(args.origin + '/new#build', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {})
  if (!(await panel(page).isVisible().catch(() => false))) await page.locator('[data-conversation-toggle]').first().click()
  await until('the Ask Slatebox panel', () => panel(page).isVisible())
  const box = panel(page).getByRole('textbox', { name: 'Message Slatebox' })
  await box.fill(message)
  await box.press('Enter')
  await until('the preview (Keep changes)', () => panel(page).getByRole('button', { name: 'Keep changes' }).isVisible(), 150000)
  await panel(page).getByRole('button', { name: 'Keep changes' }).click()
  await until('the kept board', async () => (await page.locator('#slateCanvas [data-board-layer="draft-tag"]').count()) === 0 && (await page.locator('[data-board-layer="board-title"]').count()) > 0, 60000)
  // The panel closed (on a phone it lies over the canvas), and the board fitted again.
  const close = panel(page).getByRole('button', { name: /close/i }).first()
  if (await close.isVisible().catch(() => false)) await close.click()
  await page.waitForTimeout(2500)
  await shot(page, `${name}-1-kept`)
  return { page, errors }
}

/** Every visible control on the page that is not inside `within`, with its box. */
const controlsOf = (page, within) => page.evaluate((selector) => [...document.querySelectorAll('button, [role=button], a[href], input, textarea')]
  .filter((el) => !el.closest(selector) && !el.closest('#slateCanvas'))
  .map((el) => { const r = el.getBoundingClientRect(); return { label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40), x: r.x, y: r.y, width: r.width, height: r.height, shown: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' } })
  .filter((item) => item.shown), within)

/**
 * A phone (iPhone 13, touch): the owner's words kept as a sheet; Print / Export PDF in a row of its own under the
 * canvas, covering no control and no part of the canvas; the board's title on screen; a tile moved to a free cell by a
 * touch drag, snapped there, nothing overlapping.
 */
async function phone() {
  const context = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true })
  const out = { steps: [] }
  let page = null, errors = []
  try {
    ;({ page, errors } = await keptAsGuest(context, args.message, 'phone'))
    const control = page.locator('[data-grid-print-control]')
    await until('Print / Export PDF', () => control.isVisible(), 15000)
    out.docked = await control.getAttribute('data-docked') !== null
    const box = await control.boundingBox()
    const canvas = await page.locator('#slateCanvas').boundingBox()
    out.control = box
    if (!out.docked) throw new Error('Print / Export PDF floats over the canvas on a phone')
    if (box.y < canvas.y + canvas.height - 1) throw new Error('Print / Export PDF lies over the canvas')
    const covered = (await controlsOf(page, '[data-grid-print-control]')).filter((item) => crosses(item, box, -1))
    if (covered.length) throw new Error('Print / Export PDF covers ' + covered.map((item) => item.label).join(', '))
    if (box.x < 0 || box.x + box.width > page.viewportSize().width + 1) throw new Error('Print / Export PDF runs off the screen')
    out.steps.push('print control docked, covering nothing')
    const chrome = await chromeOf(page)
    if (!chrome.title || chrome.title.y < Math.max(chrome.canvasTop, chrome.barBottom) - 1) throw new Error('the board title is cut off on a phone')
    out.steps.push('title on screen')
    // A touch drag: a 1 by 1 tile on the page moved onto a free cell (Chrome's touch events, as a finger sends them).
    // The page is shown at the screen's width; a finger on empty canvas (left of the page) pans down to the free cell.
    const cdp = await context.newCDPSession(page)
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }] })
    const swipe = async (a, b, steps = 16) => {
      await touch('touchStart', a.x, a.y)
      for (let i = 1; i <= steps; i++) { await touch('touchMove', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps); await page.waitForTimeout(16) }
      await page.waitForTimeout(150)
      await touch('touchEnd', b.x, b.y)
      await page.waitForTimeout(1500)
    }
    let view = await drawn(page)
    let grid = cellsOf(view)
    const freeOf = (list) => {
      const held = new Set(list.flatMap((t) => { const keys = []; for (let r = t.r; r < t.r + t.rows; r++) for (let c = t.c; c < t.c + t.cols; c++) keys.push(r + ':' + c); return keys }))
      const out = []
      for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) if (!held.has(r + ':' + c)) out.push([r, c])
      return out
    }
    let placed = placedOf(view, grid)
    let spot = freeOf(placed)[0]
    if (!spot) throw new Error('page 1 has no free cell to drag to')
    for (let i = 0; i < 4 && grid.cell(spot[0], spot[1]).y + grid.cell(spot[0], spot[1]).height > canvas.y + canvas.height - 8; i++) {
      const need = Math.min(220, grid.cell(spot[0], spot[1]).y + grid.cell(spot[0], spot[1]).height - (canvas.y + canvas.height) + 24)
      const x = Math.max(6, view.page.x / 2)
      await swipe({ x, y: canvas.y + 120 + need }, { x, y: canvas.y + 120 })
      view = await drawn(page)
      grid = cellsOf(view)
    }
    await shot(page, 'phone-2-panned')
    placed = placedOf(view, grid)
    const screen = page.viewportSize()
    const seen = (b) => b.y > canvas.y && b.y + b.height < Math.min(screen.height, canvas.y + canvas.height)
    if (!seen(grid.cell(spot[0], spot[1]))) throw new Error('a touch pan did not bring the free cell on screen')
    out.touchPan = true
    const mover = placed.filter((t) => t.rows === 1 && t.cols === 1 && seen(t.box)).sort((a, b) => Math.hypot(a.r - spot[0], a.c - spot[1]) - Math.hypot(b.r - spot[0], b.c - spot[1]))[0]
    if (!mover) throw new Error('no 1 by 1 tile on screen to drag')
    const from = { x: mover.box.x + mover.box.width / 2, y: mover.box.y + mover.box.height / 2 }
    const target = grid.cell(spot[0], spot[1])
    await swipe(from, { x: target.x + target.width / 2, y: target.y + target.height / 2 }, 20)
    view = await drawn(page)
    const after = placedOf(view, cellsOf(view))
    const moved = after.find((t) => t.id === mover.id)
    out.touchDrag = { tile: mover.id, from: [mover.r, mover.c], to: moved && [moved.r, moved.c], want: spot }
    if (!moved || moved.r !== spot[0] || moved.c !== spot[1]) throw new Error('the touch drag did not move the tile to the free cell: ' + JSON.stringify(out.touchDrag))
    const clash = overlapOf(after)
    if (clash) throw new Error('tiles overlap after the touch drag: ' + clash.join(' and '))
    out.steps.push('touch drag snapped to a free cell')
    await shot(page, 'phone-3-touch-dragged')
    if (errors.length) throw new Error('page errors: ' + errors.slice(0, 2).join(' | '))
    out.ok = true
  } catch (error) {
    out.ok = false
    out.error = error.message
    if (page) await shot(page, 'phone-x-failed').catch(() => {})
  } finally {
    out.errors = errors.slice(0, 5)
    await context.close()
  }
  return out
}

/** A board of lanes on the same build (the fit, the chrome and the note drop it shares): its title on screen, no print control. */
async function lanes() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const out = { steps: [] }
  let page = null, errors = []
  try {
    ;({ page, errors } = await keptAsGuest(context, "a kanban board for my team's weekly work", 'lanes'))
    const chrome = await chromeOf(page)
    out.title = chrome.titleText
    if (!chrome.title || chrome.title.y < Math.max(chrome.canvasTop, chrome.barBottom) - 1) throw new Error('the lanes board title is cut off')
    if (chrome.legend.some((chip) => crosses(chip, chrome.title, -1))) throw new Error('a rule chip sits over the lanes board title')
    if (await page.locator('[data-grid-print-control]').count()) throw new Error('a lanes board shows Print / Export PDF')
    const lanesDrawn = await page.locator('#slateCanvas [data-node-id^="lane-"]').count()
    out.lanes = lanesDrawn
    if (lanesDrawn < 2) throw new Error('the lanes are not drawn')
    out.steps.push('lanes board drawn, title on screen, no print control')
    if (errors.length) throw new Error('page errors: ' + errors.slice(0, 2).join(' | '))
    out.ok = true
  } catch (error) {
    out.ok = false
    out.error = error.message
    if (page) await shot(page, 'lanes-x-failed').catch(() => {})
  } finally {
    out.errors = errors.slice(0, 5)
    await context.close()
  }
  return out
}

const report = {}
if (!args.only || args.only === 'signed-in') {
  const ddp = await new DDP(args.origin).connect()
  const stamp = Date.now().toString(36)
  await ddp.createAccount(`grid-e2e-${stamp}@eval.example.test`, 'grid-e2e-' + stamp + Math.random().toString(36).slice(2), { firstName: 'Eval', lastName: 'Grid', name: 'Eval Grid' })
  report.signedIn = await run('signed-in', { token: ddp.token, userId: ddp.userId })
  ddp.close()
}
if (!args.only || args.only === 'guest') report.guest = await run('guest', null)
if (!args.only || args.only === 'phone') report.phone = await phone()
if (!args.only || args.only === 'lanes') report.lanes = await lanes()
await browser.close()
console.log(JSON.stringify(report, null, 2))
process.exit(Object.values(report).every((item) => item.ok) ? 0 : 1)
