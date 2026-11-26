#!/usr/bin/env node
// The owner's words as a printable page, end to end in a fresh browser on a running app (snap-grid spec §11, owner's
// choice 2026-11-25): "snappable congruent pieces to compose new printable materials" typed on /new#build is previewed
// as a grid sheet (a page of cells and a tray of tiles), kept, and then used:
//   - every tile is a note exactly at its cell's box on the page (measured on the page, as it is drawn);
//   - a stamp dragged onto a free cell leaves a copy there and stays in the tray; one dragged onto a taken cell, with no
//     free cell beside it, goes back, and nothing overlaps;
//   - "make it 3 columns" in chat, kept, reflows the page;
//   - Print: the print frame holds one SVG a page at 8.5in × 11in;
//   - Export PDF: the download reads back (pdf-lib) as Letter pages, 612 × 792 points.
// A fresh browser context for each run (no cookies, no stored login): a new account, made over DDP (the agent drafts),
// and a guest (the starter from the words). Screenshots of each step go to --shots. Exit 1 on any failed step.
//
//   node scripts/evals/smart-components/grid-e2e.mjs --origin http://127.0.0.1:3780 --shots <dir>
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
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
    const placed = []
    for (const card of onPage) {
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
      placed.push({ id: card.id, r, c, ...found })
    }
    out.tilesAtCells = placed.length
    out.steps.push('tiles at cells')
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

    // "make it 3 columns": the chat's proposal, kept, reflows the page.
    const ask = panel(page).getByRole('textbox', { name: 'Message Slatebox' })
    await ask.fill('make it 3 columns')
    await ask.press('Enter')
    await until('the reflow proposal', () => panel(page).getByRole('button', { name: 'Keep changes' }).isVisible(), 60000)
    await shot(page, `${name}-5-three-columns-preview`)
    await panel(page).getByRole('button', { name: 'Keep changes' }).click()
    await until('three columns', async () => /×\s*3\b/.test((await drawn(page)).caption), 30000)
    await page.waitForTimeout(1200)
    view = await drawn(page)
    grid = cellsOf(view)
    out.caption = view.caption
    out.steps.push('3 columns')
    await shot(page, `${name}-6-three-columns`)

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

const report = {}
if (!args.only || args.only === 'signed-in') {
  const ddp = await new DDP(args.origin).connect()
  const stamp = Date.now().toString(36)
  await ddp.createAccount(`grid-e2e-${stamp}@eval.example.test`, 'grid-e2e-' + stamp + Math.random().toString(36).slice(2), { firstName: 'Eval', lastName: 'Grid', name: 'Eval Grid' })
  report.signedIn = await run('signed-in', { token: ddp.token, userId: ddp.userId })
  ddp.close()
}
if (!args.only || args.only === 'guest') report.guest = await run('guest', null)
await browser.close()
console.log(JSON.stringify(report, null, 2))
process.exit(Object.values(report).every((item) => item.ok) ? 0 : 1)
