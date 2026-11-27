// On a phone a slate is for viewing: pan, zoom and live updates, nothing made or changed, and a banner that says
// the app is where Slatebox works best (web/app/imports/ui/common/phoneView.mjs). A desktop window still edits.
//
// One guest, made on a desktop window, owns the slate; the same guest (its storage) opens it on an iPhone 15:
//   - the banner: the coming-soon line and "Open on a computer to edit", no store link while none is set;
//   - no bar under the canvas, no Undo/Redo, no Ask Slatebox, no Share; the slate menu has no Rename, Slate
//     settings or Delete;
//   - a double tap on empty canvas adds no note; a finger on a note leaves it where it is and pans the canvas;
//   - a pinch, the zoom control's + and "Fit to screen" change the view;
//   - a note the desktop adds shows on the phone within 15 seconds;
//   - the banner, dismissed, stays gone after a reload;
//   - a fresh phone that opens /new gets the note about a bigger screen, and no guest is made;
//   - the desktop window still adds notes and shows Share.
//
// Against a running app (fresh contexts each run, every guest deleted after):
//   cd scripts && SLATEBOX_ORIGIN=https://test.slatebox.com SLATEBOX_CLEANUP_LOG=<file> npx playwright test phone-view.spec.mjs
// SLATEBOX_SHOTS=<dir> also saves pictures.
import { devices, expect, test } from '@playwright/test'
import { deleteDisposableAccounts } from './spec-cleanup.mjs'

deleteDisposableAccounts(test)

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3911'
const SHOTS = process.env.SLATEBOX_SHOTS
const { defaultBrowserType, ...iPhone } = devices['iPhone 15']
test.use(process.env.SLATEBOX_CHROMIUM ? { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } } : {})
test.setTimeout(300000)

const shot = (page, name) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : null)
const banner = page => page.getByTestId('phone-app-banner')
const canvas = page => page.locator('#slateCanvas svg[viewBox]').first()
const viewBox = page => canvas(page).getAttribute('viewBox')
const noteCount = page => page.evaluate(() => window.slate?.v2?.nodes?.allNodes?.length ?? -1)
const welcomeOk = page => page.getByRole('dialog', { name: /welcome/i }).getByRole('button', { name: 'OK' }).click({ timeout: 2500 }).catch(() => {})
const gotIt = page => page.locator('[data-cookie-notice] button').click({ timeout: 3000 }).catch(() => {})

/** A note the desktop types on empty canvas: double-click, type, click away. */
async function typeNote(page, text, at) {
  const box = await canvas(page).boundingBox()
  const before = await noteCount(page)
  await page.mouse.dblclick(box.x + box.width * at.x, box.y + box.height * at.y)
  await expect.poll(() => noteCount(page), { timeout: 15000 }).toBeGreaterThan(before)
  await page.keyboard.type(text)
  // A click on empty canvas ends the typing and keeps the words.
  await page.mouse.click(box.x + 20, box.y + box.height - 20)
}

test('a phone views the slate a desktop edits: no editing, pan and zoom, live updates and the app banner', async ({ browser }) => {
  // 1. The desktop: a guest, a slate, a note.
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const editor = await desk.newPage()
  await editor.goto(ORIGIN + '/new?empty=1')
  await editor.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
  await editor.waitForFunction(() => Boolean(window.slate?.v2?.canvas), null, { timeout: 60000 })
  await gotIt(editor)
  await welcomeOk(editor)
  await expect(banner(editor)).toHaveCount(0)
  // Ask Slatebox opens beside a new slate: closed, the canvas has the window.
  const chat = editor.locator('aside[aria-label="Ask Slatebox"]')
  if (await chat.isVisible().catch(() => false)) await editor.locator('[data-conversation-toggle]').first().click()
  await expect(chat).toBeHidden()
  await typeNote(editor, 'A note to view', { x: 0.2, y: 0.25 })
  await expect.poll(() => editor.evaluate(async (shareId) => {
    const found = await window.Meteor.callAsync('slates.get', { shareId }).catch(() => null)
    return found?.slateBase?.nodes?.some(n => n.options?.text === 'A note to view') ?? false
  }, editor.url().split('/').pop()), { timeout: 30000 }).toBe(true)
  const url = editor.url()
  const storageState = await desk.storageState()

  // 2. The same guest on a phone.
  const phoneContext = await browser.newContext({ ...iPhone, storageState })
  const phone = await phoneContext.newPage()
  const errors = []
  phone.on('pageerror', e => errors.push(e.message))
  await phone.goto(url)
  await expect(canvas(phone)).toBeVisible({ timeout: 90000 })
  await phone.waitForFunction(() => (window.slate?.v2?.nodes?.allNodes?.length ?? 0) > 0, null, { timeout: 60000 })
  expect(await phone.evaluate(() => window.slate.v2.isReadOnly())).toBe(true)
  await expect(banner(phone)).toBeVisible({ timeout: 30000 })
  await expect(banner(phone)).toContainText('Open on a computer to edit.')
  await expect(banner(phone)).toContainText('The iPhone and Android app is coming soon.')
  await expect(banner(phone).getByRole('link')).toHaveCount(0)
  await shot(phone, 'phone-view-390')
  await expect(phone.locator('.sb-canvas-bar')).toHaveCount(0)
  await expect(phone.getByRole('group', { name: 'Undo and redo' })).toHaveCount(0)
  await expect(phone.getByRole('button', { name: 'Ask Slatebox' })).toHaveCount(0)
  await expect(phone.locator('.sb-board-share')).toHaveCount(0)
  await phone.getByRole('button', { name: 'Slate settings and actions' }).first().tap()
  const menu = phone.getByRole('dialog').or(phone.getByRole('menu')).last()
  await expect(menu.getByText('Copy link', { exact: true })).toBeVisible({ timeout: 10000 })
  for (const name of ['Rename', 'Slate settings', 'Delete slate…', 'Make a copy']) await expect(menu.getByText(name, { exact: true })).toHaveCount(0)
  await phone.keyboard.press('Escape')
  await phone.waitForTimeout(500)

  // Nothing is added by a double tap on empty canvas.
  const box = await canvas(phone).boundingBox()
  const notes = await noteCount(phone)
  const empty = { x: box.x + 30, y: box.y + box.height - 160 }
  await phone.touchscreen.tap(empty.x, empty.y)
  await phone.waitForTimeout(80)
  await phone.touchscreen.tap(empty.x, empty.y)
  await phone.waitForTimeout(1500)
  expect(await noteCount(phone)).toBe(notes)

  // A finger on a note leaves it in place and pans the canvas.
  const note = await phone.evaluate(() => {
    const n = window.slate.v2.nodes.allNodes[0]
    const r = n.svgGroup.node.getBoundingClientRect()
    return { id: n.id, x: n.options.x, y: n.options.y, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }
  })
  const cdp = await phoneContext.newCDPSession(phone)
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x: Math.round(x), y: Math.round(y), id })) })
  const panBefore = await viewBox(phone)
  await touch('touchStart', [[note.cx, note.cy]])
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[note.cx + 8 * i, note.cy + 10 * i]])
  await touch('touchEnd', [])
  await phone.waitForTimeout(600)
  const moved = await phone.evaluate((id) => { const n = window.slate.v2.getNode(id); return { x: n.options.x, y: n.options.y } }, note.id)
  expect(moved).toEqual({ x: note.x, y: note.y })
  expect(await viewBox(phone)).not.toBe(panBefore)

  // Two fingers pinch the zoom; the zoom control's + and Fit to screen change the view.
  const scale = async () => Number((await viewBox(phone)).split(/\s+/)[2])
  const wide = await scale()
  const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await touch('touchStart', [[mid.x - 40, mid.y], [mid.x + 40, mid.y]])
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[mid.x - 40 - 10 * i, mid.y], [mid.x + 40 + 10 * i, mid.y]])
  await touch('touchEnd', [])
  await phone.waitForTimeout(600)
  expect(await scale()).not.toBe(wide)
  const zoomed = await viewBox(phone)
  await phone.locator('.slatebox-zoom-slider').getByRole('button', { name: 'Zoom in' }).tap()
  await phone.waitForTimeout(800)
  expect(await viewBox(phone)).not.toBe(zoomed)
  const beforeFit = await viewBox(phone)
  await phone.locator('.slatebox-zoom-slider').getByRole('button', { name: 'Fit to screen' }).tap()
  await phone.waitForTimeout(1200)
  expect(await viewBox(phone)).not.toBe(beforeFit)

  // 3. Live: what the desktop adds shows on the phone.
  const words = 'from desktop ' + Math.random().toString(36).slice(2, 8)
  await typeNote(editor, words, { x: 0.2, y: 0.7 })
  await expect.poll(() => phone.evaluate((w) => window.slate.v2.nodes.allNodes.some(n => n.options?.text === w), words), { timeout: 15000 }).toBe(true)
  await shot(phone, 'phone-view-live')

  // 4. Dismissed, the banner stays gone after a reload.
  await banner(phone).getByRole('button', { name: 'Dismiss' }).tap()
  await expect(banner(phone)).toHaveCount(0)
  await phone.reload()
  await expect(canvas(phone)).toBeVisible({ timeout: 90000 })
  await phone.waitForTimeout(2000)
  await expect(banner(phone)).toHaveCount(0)
  expect(errors).toEqual([])

  // 5. A fresh phone that opens /new: the note about a bigger screen, and no guest.
  const fresh = await browser.newContext({ ...iPhone })
  const visitor = await fresh.newPage()
  await visitor.goto(ORIGIN + '/new')
  await expect(visitor.getByTestId('phone-view-gate')).toBeVisible({ timeout: 60000 })
  await expect(visitor.getByTestId('phone-view-gate')).toContainText('Creating slates needs a bigger screen.')
  await expect(visitor.getByRole('link', { name: 'Browse the library' })).toBeVisible()
  await visitor.waitForTimeout(3000)
  expect(visitor.url()).not.toMatch(/\/canvas\//)
  expect(await visitor.evaluate(() => window.Meteor?.userId?.() ?? null)).toBeNull()
  await shot(visitor, 'phone-view-gate')
  await fresh.close()

  // 6. The desktop still edits.
  const deskNotes = await noteCount(editor)
  await typeNote(editor, 'Still editing', { x: 0.8, y: 0.25 })
  expect(await noteCount(editor)).toBeGreaterThan(deskNotes)
  await expect(editor.locator('.sb-board-share')).toBeVisible()

  // One guest on two pages: the phone leaves the app first, so the guest is deleted once, from the desktop
  // (spec-cleanup.mjs deletes it as the context closes); a page whose account went from under it would wait.
  await phone.goto('about:blank')
  await desk.close()
  await phoneContext.close()
})
