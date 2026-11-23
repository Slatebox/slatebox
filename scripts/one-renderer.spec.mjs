// One renderer (owner, 2026-11-23: "the preview should match the final view - for all of these smart components",
// and the slate's own picture "looks like the preview as well (not the actual)"). In a real browser, a fresh guest:
//   - adds a hiring plan, then a launch plan, from the library by chat: each preview (the dashed draft) and the
//     kept board have the same notes in the same arrangement and the same named parts (the month header, the bars,
//     the edges), the draft only see-through and framed; screenshots of each region are kept for review;
//   - Present and the exported picture carry the real board (its header row and bars), not generic columns;
//   - My slates: the slate's card draws both boards as the canvas does: the plan's month header and its bars.
//
// Against a running app (scripts/playwright.config.mjs: Playwright 1.57, its Chromium installed once with
// `npx playwright install chromium`):
//   cd scripts && SLATEBOX_ORIGIN=http://127.0.0.1:7660 npx playwright test one-renderer.spec.mjs
//   SLATEBOX_ORIGIN=http://127.0.0.1:7660 npx playwright test -c scripts/playwright.config.mjs one-renderer.spec.mjs
// SLATEBOX_SHOTS names a folder for the screenshots; SLATEBOX_CHROMIUM a Chromium executable.
import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3911'
const SHOTS = process.env.SLATEBOX_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
test.use({ ...(process.env.SLATEBOX_CHROMIUM && { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } }) })
test.setTimeout(300000)

const panel = page => page.locator('aside[aria-label="Ask Slatebox"]')
async function say(page, text) {
  const box = panel(page).getByRole('textbox', { name: 'Message Slatebox' })
  await box.fill(text)
  await box.press('Enter')
}

/** The parts a draft wears and an editable board's grips: left out of the comparison. */
const DRAFT_ONLY = /^(draft-|preview-)/
const EDIT_ONLY = /^(grip-|focus-|done-|handle-)/

/**
 * What a board on the canvas is made of, read from its svg: its notes (ids without their scope, each with its size
 * and its place relative to the board's first note), and its named parts and how many of each.
 */
function structureOf(page, scope, exclude = []) {
  return page.evaluate(({ scope, exclude, draftOnly, editOnly }) => {
    const draft = new RegExp(draftOnly), edit = new RegExp(editOnly)
    const svg = document.querySelector('#slateCanvas svg') ?? document.querySelector('svg')
    const engine = window.slate?.v2 ?? window.slate
    const all = [...svg.querySelectorAll('[data-node-id]')].map(g => g.getAttribute('data-node-id'))
    const mine = id => !exclude.includes(id) && (scope === '' ? !/^[a-z0-9]+:/.test(id) : id.startsWith(scope + ':'))
    const ids = [...new Set(all.filter(mine))]
    const notes = ids.map(id => ({ id: id.replace(/^[a-z0-9]+:/, ''), o: engine.nodes.one(id)?.options ?? {} }))
    const first = notes.map(n => n.o).reduce((a, o) => (a && (a.y < o.y || (a.y === o.y && a.x <= o.x)) ? a : o), null) ?? { x: 0, y: 0 }
    const places = notes.map(({ id, o }) => [id, Math.round(o.x - first.x), Math.round(o.y - first.y), Math.round(o.width), Math.round(o.height)].join(' ')).sort()
    // Every named part on the canvas (a kit's layer names no board): the caller takes away what was there before.
    const parts = {}
    for (const el of svg.querySelectorAll('[data-board-layer]')) {
      const role = el.getAttribute('data-board-layer')
      if (!role || draft.test(role) || edit.test(role)) continue
      parts[role] = (parts[role] ?? 0) + 1
    }
    return { ids: ids.map(id => id.replace(/^[a-z0-9]+:/, '')).sort(), places, parts }
  }, { scope, exclude, draftOnly: DRAFT_ONLY.source, editOnly: EDIT_ONLY.source })
}

/** The box of a board's notes on screen (with a margin), for a screenshot of its region. */
async function regionOf(page, scope, exclude = []) {
  const box = await page.evaluate(({ scope, exclude }) => {
    const mine = id => !exclude.includes(id) && (scope === '' ? !/^[a-z0-9]+:/.test(id) : id.startsWith(scope + ':'))
    const boxes = [...document.querySelectorAll('[data-node-id]')].filter(g => mine(g.getAttribute('data-node-id'))).map(g => g.getBoundingClientRect()).filter(r => r.width > 0)
    if (!boxes.length) return null
    const x = Math.min(...boxes.map(r => r.left)), y = Math.min(...boxes.map(r => r.top))
    return { x, y, width: Math.max(...boxes.map(r => r.right)) - x, height: Math.max(...boxes.map(r => r.bottom)) - y }
  }, { scope, exclude })
  if (!box) return undefined
  const view = page.viewportSize()
  const x = Math.max(0, box.x - 60), y = Math.max(0, box.y - 80)
  return { x, y, width: Math.min(view.width - x, box.width + 120), height: Math.min(view.height - y, box.height + 140) }
}
async function shot(page, name, scope, exclude) {
  if (!SHOTS) return
  // The board's region, or the whole screen where the board runs off it (a phone).
  const clip = scope !== undefined ? await regionOf(page, scope, exclude) : undefined
  await page.screenshot({ path: join(SHOTS, name + '.png'), ...(clip && clip.width > 40 && clip.height > 40 && { clip }) })
}

/** The notes on the canvas now that are not a draft's. */
const keptIds = page => page.evaluate(() => [...new Set([...document.querySelectorAll('#slateCanvas [data-node-id]')].map(g => g.getAttribute('data-node-id')).filter(id => !id.startsWith('pv:')))])

async function previewAndKeep(page, { message, kind, width }) {
  const before = await keptIds(page)
  const baseline = (await structureOf(page, 'none')).parts
  const less = parts => Object.fromEntries(Object.entries(parts).map(([k, n]) => [k, n - (baseline[k] ?? 0)]).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b)))
  await say(page, message)
  // The draft: drawn by the board renderer in the scope pv, dashed and see-through, tagged as a preview.
  await expect(page.locator('#slateCanvas [data-board-layer="draft-tag"]')).toBeAttached({ timeout: 60000 })
  await expect.poll(() => page.locator('#slateCanvas [data-node-id^="pv:"]').count(), { timeout: 30000 }).toBeGreaterThan(3)
  await page.waitForTimeout(800)
  const draft = await structureOf(page, 'pv')
  draft.parts = less(draft.parts)
  // The draft is brought into view (a board kept a moment ago does not take the view back): its tag is on screen.
  const tag = await page.locator('#slateCanvas [data-board-layer="draft-tag"]').boundingBox()
  expect(tag.x).toBeGreaterThanOrEqual(-1)
  expect(tag.x + tag.width).toBeLessThanOrEqual(width + 1)
  expect(await page.locator('#slateCanvas [data-node-id^="pv:"]:not([data-workshop-draft])').count()).toBe(0)
  await shot(page, kind + '-preview-' + width, 'pv')
  await panel(page).getByRole('button', { name: 'Keep changes' }).click()
  await expect(page.locator('#slateCanvas [data-board-layer="draft-tag"]')).toHaveCount(0, { timeout: 60000 })
  // The kept board's notes: the ones that were not there before, in one scope ('' for a slate's first board, b2… after).
  await expect.poll(async () => (await keptIds(page)).filter(id => !before.includes(id)).length, { timeout: 60000 }).toBe(draft.ids.length)
  const added = (await keptIds(page)).filter(id => !before.includes(id))
  const scopes = [...new Set(added.map(id => (id.match(/^([a-z0-9]+):/) ?? [])[1] ?? ''))]
  expect(scopes.length).toBe(1)
  const scope = scopes[0]
  await page.waitForTimeout(800)
  const kept = await structureOf(page, scope, before)
  kept.parts = less(kept.parts)
  await shot(page, kind + '-kept-' + width, scope, before)
  return { draft, kept, scope, before, less }
}

for (const width of [1440, 390]) {
  test(`at ${width}: a hiring plan and a launch plan preview as they are kept; Present, the export and My slates draw the real boards`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: width > 600 ? 900 : 844 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(ORIGIN + '/new')
    await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 90000 })
    expect(await page.evaluate(() => window.Meteor?.user()?.isAnonymous ?? true)).toBe(true)
    const shareId = page.url().split('/').pop()
    await page.getByRole('button', { name: 'Got it' }).click({ timeout: 5000 }).catch(() => {})
    if (!(await panel(page).count()) || !(await panel(page).isVisible())) await page.locator('[data-conversation-toggle]').first().click()
    await expect(panel(page)).toBeVisible()
    await page.waitForTimeout(1500)

    // 1. A hiring plan: the preview is the plan itself, months, bars and runway, then kept exactly so.
    const hiring = await previewAndKeep(page, { message: 'Add a hiring plan', kind: 'hiring-plan', width })
    expect(hiring.draft.ids).toEqual(hiring.kept.ids)
    expect(hiring.draft.places).toEqual(hiring.kept.places)
    expect(hiring.draft.parts).toEqual(hiring.kept.parts)
    expect(hiring.kept.parts.header).toBe(1)
    expect(hiring.kept.ids.some(id => id.startsWith('card-'))).toBe(true)

    // 2. A launch plan beside it: the same.
    if (width < 600 && await panel(page).isHidden()) await page.locator('[data-conversation-toggle]').first().click()
    const launch = await previewAndKeep(page, { message: 'Add a launch plan', kind: 'launch-plan', width })
    expect(launch.draft.ids).toEqual(launch.kept.ids)
    expect(launch.draft.places).toEqual(launch.kept.places)
    expect(launch.draft.parts).toEqual(launch.kept.parts)
    expect(launch.kept.parts.header).toBe(1)

    // 3. The exported picture carries both boards' parts (a plan's header row), from the live canvas.
    // As Export → SVG asks for it (Canvas.jsx: the engine's svg()).
    const exported = await page.evaluate(() => new Promise(resolve => { const s = window.slate; (s.v2 ?? s).svg({}, svg => resolve(typeof svg === 'string' ? svg : svg?.svg ?? '')) }))
    expect(exported).toContain('data-board-layer="header"')
    expect(exported).toContain('card-')

    // 4. Present: the presentation shows the boards as the canvas draws them (a plan's header row and bars).
    await page.getByRole('button', { name: 'Present', exact: true }).first().click()
    const here = page.getByText('Present on this screen', { exact: true })
    if (await here.isVisible({ timeout: 1500 }).catch(() => false)) await here.click()
    const stage = page.getByRole('region', { name: 'Decision presentation' }).or(page.getByRole('dialog')).first()
    await expect(stage).toBeVisible({ timeout: 30000 })
    await page.waitForTimeout(1500)
    const presented = page.locator('svg [data-board-layer="header"]')
    await expect.poll(() => presented.evaluateAll(els => els.filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth }).length), { timeout: 20000 }).toBeGreaterThan(0)
    await shot(page, 'present-' + width)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)

    // 5. My slates: the card draws the boards as the canvas does, not generic columns.
    if (width > 600) {
      await page.goto(ORIGIN + '/')
      const card = page.locator('#slate_' + shareId)
      await expect(card).toBeVisible({ timeout: 60000 })
      await expect.poll(() => card.locator('[data-board-layer="header"]').count(), { timeout: 30000 }).toBeGreaterThanOrEqual(2)
      const cardIds = await card.locator('[data-node-id]').evaluateAll(gs => gs.map(g => g.getAttribute('data-node-id')))
      // The hiring plan's hires and the launch plan's tasks are bars on a timeline, drawn by their kits.
      for (const id of hiring.kept.ids.filter(id => id.startsWith('card-'))) expect(cardIds.map(i => i.replace(/^[a-z0-9]+:/, ''))).toContain(id)
      const cardText = (await card.locator('svg text').allTextContents()).join(' | ')
      expect(cardText).toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/)
      // The bars sit on the plan's rows, as on the canvas: a hire's bar is wider than it is tall.
      const bar = await card.locator('[data-node-id$="' + hiring.kept.ids.find(id => id.startsWith('card-')) + '"]').first().boundingBox()
      expect(bar.width).toBeGreaterThan(bar.height)
      await shot(page, 'my-slates-' + width)
      await card.screenshot({ path: SHOTS ? join(SHOTS, 'thumbnail-' + width + '.png') : undefined })
    }
    expect(errors).toEqual([])
    await context.close()
  })
}

// Every board in the library, at a laptop's width and a phone's: the preview is the kept board, and the slate's card in
// My slates draws it as the canvas does (its notes, and a kit's named parts). Shots of each (SLATEBOX_SHOTS/kinds).
const KINDS = [
  ['now-next-later', 'Add a Now / Next / Later board'], ['pros-cons', 'Add pros and cons'], ['must-should-could', 'Add a Must / Should / Could board'],
  ['decision-path', 'Add a decision path'], ['retro', 'Add a retro'], ['triage', 'Add a triage board'], ['team-board', 'Add a team board'],
  ['launch-plan', 'Add a launch plan'], ['customer-go-live', 'Add a customer go-live'], ['hiring-plan', 'Add a hiring plan'],
  ['sort-evidence', 'Add a board to sort the evidence'], ['discovery-tree', 'Add a discovery tree'], ['break-down-problem', 'Add a board to break down a problem'],
  ['incident-review', 'Add an incident review'], ['impact-effort', 'Add an impact × effort board'], ['reorg-sandbox', 'Add a reorg & hiring sandbox'],
  ['goals-owners', 'Add a goals & owners board'], ['sales-pipeline', 'Add a sales pipeline'], ['budget', 'Add a budget'],
]
const KIND_SHOTS = SHOTS ? join(SHOTS, 'kinds') : ''
if (KIND_SHOTS) mkdirSync(KIND_SHOTS, { recursive: true })
for (const width of [1440, 390]) {
  for (const [id, message] of KINDS) {
    test(`${id} at ${width}: the preview is the kept board, and the slate's card draws it`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: width > 600 ? 900 : 844 } })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', e => errors.push(e.message))
      await page.goto(ORIGIN + '/new')
      await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 90000 })
      const shareId = page.url().split('/').pop()
      await page.getByRole('button', { name: 'Got it' }).click({ timeout: 5000 }).catch(() => {})
      if (!(await panel(page).count()) || !(await panel(page).isVisible())) await page.locator('[data-conversation-toggle]').first().click()
      await expect(panel(page)).toBeVisible()
      await page.waitForTimeout(1200)
      const { draft, kept, scope, before, less } = await previewAndKeep(page, { message, kind: 'kinds/' + id, width })
      expect(draft.ids).toEqual(kept.ids)
      expect(draft.places).toEqual(kept.places)
      expect(draft.parts).toEqual(kept.parts)
      // A cold load of the slate (nothing fetched by the chat yet) draws the same board.
      await page.reload()
      await expect.poll(async () => (await structureOf(page, scope, before)).ids.length, { timeout: 60000 }).toBe(kept.ids.length)
      await page.waitForTimeout(1500)
      const cold = await structureOf(page, scope, before)
      cold.parts = less(cold.parts)
      expect(cold.places).toEqual(kept.places)
      expect(cold.parts).toEqual(kept.parts)
      await page.goto(ORIGIN + '/')
      const card = page.locator('#slate_' + shareId)
      await expect(card).toBeVisible({ timeout: 60000 })
      // The card holds the board's notes (by their ids) and the parts its kit or chrome names, at the board's own size.
      await expect.poll(() => card.locator('[data-node-id]').count(), { timeout: 30000 }).toBeGreaterThanOrEqual(kept.ids.length)
      const cardIds = (await card.locator('[data-node-id]').evaluateAll(gs => gs.map(g => g.getAttribute('data-node-id')))).map(i => i.replace(/^[a-z0-9]+:/, ''))
      for (const note of kept.ids) expect(cardIds).toContain(note)
      const cardParts = await card.locator('[data-board-layer]').evaluateAll(els => els.map(el => el.getAttribute('data-board-layer')).filter(Boolean))
      // A card draws the board as a laptop's canvas does whatever the screen (boardRender: width 1440), so a phone's
      // words beside a plan's bars (words-…) are the phone canvas's own.
      for (const part of Object.keys(kept.parts).filter(part => width > 600 || !/^words-/.test(part))) expect(cardParts).toContain(part)
      await page.waitForTimeout(600)
      if (KIND_SHOTS) await card.screenshot({ path: join(KIND_SHOTS, id + '-thumbnail-' + width + '.png') })
      expect(errors).toEqual([])
      await context.close()
    })
  }
}
