// Library slice 2 in a real browser: Keep adds a board and keeps a rule change live (no reload), on
// this page and on a second page of the same slate; the board covers none of the slate's notes; the
// page's own saves still go through; Undo puts a rule back everywhere; the next drag obeys the rule.
//
// Against a running app (a fresh guest per run: no cookies, no storage):
//   cd scripts && SLATEBOX_ORIGIN=http://127.0.0.1:3911 npx playwright test library-live.spec.mjs
// SLATEBOX_CHROMIUM may name a Chromium executable when this Playwright's own is not installed.
import { expect, test } from '@playwright/test'

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3911'
test.use({
  viewport: { width: 1440, height: 900 },
  ...(process.env.SLATEBOX_CHROMIUM && { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } }),
})
test.setTimeout(360000)

const panel = page => page.locator('aside[aria-label="Ask Slatebox"]')
async function say(page, text) {
  const box = panel(page).getByRole('textbox', { name: 'Message Slatebox' })
  await box.fill(text)
  await box.press('Enter')
}
async function keep(page) {
  await panel(page).getByRole('button', { name: 'Keep changes' }).click()
}
// What the canvas says, from its own notes (SVG text).
const canvasText = page => page.evaluate(() => [...document.querySelectorAll('svg text')].map(t => t.textContent).join(' | '))
// Doing's limit, as its column says it to a screen reader ("Doing, 1 of 3"). Board polish: the rules are the board's
// chrome now, not a "How this board behaves" note on the canvas, so the limit is read from the column itself.
const doingHolds = (on, max) => expect(on.locator(`g[aria-label^="Doing, "][aria-label$=" of ${max}"]`).first()).toBeVisible({ timeout: 30000 })
const frames = page => page.evaluate(() => [...document.querySelectorAll('[data-node-id]')].map(g => {
  const r = g.getBoundingClientRect()
  return { id: g.getAttribute('data-node-id'), x: r.x, y: r.y, w: r.width, h: r.height }
}))
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const yOf = (page, id) => page.evaluate(id => window.slate?.nodes?.one?.(id)?.options?.yPos ?? null, id)

test('Keep adds a board and keeps a rule live on every open page; Undo and the next drag follow the rules', async ({ browser }) => {
  const one = await browser.newContext()
  const page = await one.newPage()
  const errors = []
  page.on('pageerror', e => errors.push('A: ' + e.message))
  await page.goto(ORIGIN + '/new?empty=1')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 90000 })
  // A fresh guest: no login carried in from anywhere else.
  expect(await page.evaluate(() => window.Meteor?.user()?.isAnonymous ?? true)).toBe(true)
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 5000 }).catch(() => {})
  if (!(await panel(page).count())) await page.locator('[data-conversation-toggle]').first().click()
  await expect(panel(page)).toBeVisible()
  await page.waitForTimeout(1500)

  // A second page of the same slate (the same person on another device), opened before the board exists.
  const two = await browser.newContext({ storageState: await one.storageState() })
  const other = await two.newPage()
  other.on('pageerror', e => errors.push('B: ' + e.message))
  await other.goto(page.url())
  await other.waitForTimeout(3000)
  const navigations = { a: 0, b: 0 }
  page.on('framenavigated', f => { if (f === page.mainFrame()) navigations.a++ })
  other.on('framenavigated', f => { if (f === other.mainFrame()) navigations.b++ })

  // 1. Add a team board by chat, Keep: drawn here and there with no reload, beside the notes.
  await say(page, 'Add a team board')
  await expect(panel(page).getByRole('region', { name: 'Rules' })).toBeVisible({ timeout: 60000 })
  await keep(page)
  await expect(page.locator('[data-creative-revision]')).toBeVisible({ timeout: 60000 })
  await expect(other.locator('[data-creative-revision]')).toBeVisible({ timeout: 30000 })
  await doingHolds(other, 3)
  expect(navigations).toEqual({ a: 0, b: 0 })
  await expect(other.getByText('A teammate updated this drawing')).toHaveCount(0)
  // The board's own chat takes over the panel.
  await expect(panel(page).getByRole('button', { name: 'What can this do?' })).toBeVisible()
  const all = await frames(page)
  const notes = all.filter(f => !/^(lane|card|caption|column|rules|handle|gauge|preview)-/.test(f.id))
  const board = all.filter(f => /^(lane|rules)-/.test(f.id))
  expect(notes.length).toBeGreaterThan(0)
  expect(board.length).toBe(6)
  for (const note of notes) for (const part of board) expect(overlap(note, part), note.id + ' under ' + part.id).toBe(false)

  // 2. This page's own note saves still go through (the revision it saves on moved with the board).
  const welcome = notes[0]
  const before = await yOf(page, welcome.id)
  await page.mouse.move(welcome.x + welcome.w / 2, welcome.y + welcome.h / 2)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(welcome.x + welcome.w / 2, welcome.y + welcome.h / 2 + i * 12)
  await page.mouse.up()
  const moved = await yOf(page, welcome.id)
  expect(moved).toBeGreaterThan(before + 40)
  await page.waitForTimeout(3500)

  // 3. Cards by chat, then a rule: diff, Keep, and both pages show it without a reload.
  for (const [card, lane] of [['Search', 'Doing'], ['Billing', 'To do']]) {
    await say(page, `Add a card called ${card} to ${lane}`)
    await keep(page)
    await expect(panel(page).getByText('Saved to the board.').last()).toBeVisible()
  }
  await say(page, 'Let Doing hold 1')
  await expect(panel(page).getByText(/Rules \(rev \d+ → \d+\)/)).toBeVisible()
  await keep(page)
  await expect(panel(page).getByText('Saved to the board.').last()).toBeVisible()
  await doingHolds(page, 1)
  await doingHolds(other, 1)

  // 4. Undo puts the rule back on both pages.
  await page.getByRole('button', { name: 'Undo last change' }).click()
  await doingHolds(page, 3)
  await doingHolds(other, 3)

  // 5. The rule again; the next real drag of Billing onto Doing is refused with the rule's sentence.
  await say(page, 'Let Doing hold 1')
  await expect(panel(page).getByText(/Rules \(rev \d+ → \d+\)/)).toBeVisible()
  await keep(page)
  await doingHolds(other, 1)
  // The same real drag on either page: the rule kept on page A must hold on page B's own canvas too.
  const dragBillingToDoing = async (on) => {
    const card = await on.locator('g[aria-label^="Billing"]').first().boundingBox()
    const lane = await on.locator('g[aria-label^="Doing"]').first().boundingBox()
    await on.mouse.move(card.x + card.width / 2, card.y + card.height / 2)
    await on.mouse.down()
    for (let i = 1; i <= 12; i++) {
      await on.mouse.move(card.x + card.width / 2 + (lane.x + lane.width / 2 - card.x - card.width / 2) * i / 12,
        card.y + card.height / 2 + (lane.y + lane.height + 60 - card.y - card.height / 2) * i / 12)
    }
    await on.mouse.up()
    // Refused in the rule's words, and Billing is still in To do (the card says where it is).
    await expect(on.getByText("Billing can't move to Doing. Doing holds 1. It has 1.")).toBeVisible()
    await expect(on.locator('[aria-label="Billing, in To do"]')).toHaveCount(1)
    await expect(on.locator('[aria-label="Billing, in Doing"]')).toHaveCount(0)
    await expect(on.locator('[aria-label="Doing, 1 of 1"]')).toHaveCount(1)
  }
  await dragBillingToDoing(page)
  await dragBillingToDoing(other)
  expect(navigations).toEqual({ a: 0, b: 0 })

  // 6. A reload: the board is where it was put, the rule and the moved note are saved.
  await page.reload()
  await expect(page.locator('[data-creative-revision]')).toBeVisible({ timeout: 60000 })
  await doingHolds(page, 1)
  expect(await yOf(page, welcome.id)).toBeCloseTo(moved, 0)
  expect(errors).toEqual([])
  await two.close()
  await one.close()
})

test('a board given its first rule shows it live on a page that never loaded the rulebook', async ({ browser }) => {
  const one = await browser.newContext()
  const page = await one.newPage()
  const errors = []
  page.on('pageerror', e => errors.push('A: ' + e.message))
  await page.goto(ORIGIN + '/new?empty=1')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 90000 })
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 5000 }).catch(() => {})
  if (!(await panel(page).count())) await page.locator('[data-conversation-toggle]').first().click()
  // A sales pipeline starts with its kind's own rules and no rulebook.
  await say(page, 'Add a sales pipeline')
  await keep(page)
  await expect(page.locator('[data-creative-revision]')).toBeVisible({ timeout: 60000 })
  const two = await browser.newContext({ storageState: await one.storageState() })
  const other = await two.newPage()
  other.on('pageerror', e => errors.push('B: ' + e.message))
  await other.goto(page.url())
  await expect(other.locator('[data-creative-revision]')).toBeVisible({ timeout: 60000 })
  expect(await canvasText(other)).not.toContain('Proposal needs an amount')
  await say(page, 'Proposal needs an amount')
  await expect(panel(page).getByText(/Rules \(rev \d+ → \d+\)/)).toBeVisible()
  await keep(page)
  await expect.poll(() => canvasText(other), { timeout: 30000 }).toContain('Proposal needs an amount')
  await expect(other.locator('[data-creative-revision]')).toBeVisible()
  expect(errors).toEqual([])
  await two.close()
  await one.close()
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
  test('a board kept from the chat sheet takes the screen at once (no reload), and a card drags between lanes', async ({ page }) => {
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(ORIGIN + '/new?empty=1')
    await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 90000 })
    await page.getByRole('button', { name: 'Got it' }).click({ timeout: 5000 }).catch(() => {})
    if (!(await panel(page).count())) await page.locator('[data-conversation-toggle]').first().click()
    let navigations = 0
    page.on('framenavigated', f => { if (f === page.mainFrame()) navigations++ })
    await say(page, 'Add a team board')
    await keep(page)
    await expect(page.locator('[data-creative-revision]')).toBeVisible({ timeout: 60000 })
    // The sheet gives the screen to the board, as it does after a reload.
    await expect(panel(page)).toHaveCount(0)
    await page.locator('[data-conversation-toggle]').first().click()
    await say(page, 'Add a card called Search to Doing')
    await keep(page)
    await expect(panel(page).getByText('Saved to the board.').last()).toBeVisible()
    await panel(page).getByRole('button', { name: 'Close' }).first().click()
    await page.waitForTimeout(1500)
    // Board polish: a column's counter is "1 / 3" on the canvas; its words for a screen reader stay "1 of 3".
    await expect(page.locator('g[aria-label="Doing, 1 of 3"]').first()).toBeVisible()
    // The board was drawn on this page as it is, fitted to the phone: the card and To do are on screen.
    const card = await page.locator('g[aria-label^="Search"]').first().boundingBox()
    const lane = await page.locator('g[aria-label^="To do"]').first().boundingBox()
    expect(card.y + card.height).toBeLessThan(844 - 80)
    expect(lane.y).toBeGreaterThan(64)
    const drop = lane.y + lane.height / 2
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 14; i++) await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2 + (drop - card.y - card.height / 2) * i / 14)
    await page.mouse.up()
    await expect(page.locator('g[aria-label="Doing, 0 of 3"]').first()).toBeVisible()
    await expect(page.locator('g[aria-label="To do, 1 card"]').first()).toBeVisible()
    expect(navigations).toBe(0)
    expect(errors).toEqual([])
  })
})
