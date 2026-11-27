// The cookie notice on a phone (owner report 2026-11-23: "Cookies keep you signed in / Got it" could stay over the
// bottom of the screen after dismissal attempts). On a 390 by 844 touch phone, a fresh guest's slate (made on a
// computer: a phone views slates and makes none, phone-view.spec.mjs), opened on the phone:
//   - the notice never lies over a control at the canvas's foot (the zoom controls; the page keeps a strip for it);
//   - one tap on Got it takes it away, and the tap lands on nothing under it (no ghost tap);
//   - the canvas gets its room back; a reload, and a page opened later, never show it again;
//   - a browser that keeps no cookies (the answer kept in localStorage) does not ask again either.
// In a narrow window that edits (390 by 844, a mouse), the notice lies above the canvas's bar, never over a
// control of it, and Got it gives the bar its room back.
//
// Against a running app (a fresh guest per run: no cookies, no storage):
//   cd scripts && SLATEBOX_ORIGIN=http://127.0.0.1:3911 npx playwright test cookie-notice-phone.spec.mjs
import { expect, test } from '@playwright/test'
import { deleteDisposableAccounts } from './spec-cleanup.mjs'

// Every guest this spec makes is deleted before its page closes, here or on staging.
deleteDisposableAccounts(test)

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3911'
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }
test.use({ ...(process.env.SLATEBOX_CHROMIUM && { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } }) })
test.setTimeout(240000)

const notice = page => page.locator('[data-cookie-notice]')

// A guest and a new slate, made in a desktop window (nothing answered yet), then opened in `device`: the same
// guest (its storage), still unanswered.
async function freshSlate(browser, device = phone) {
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const made = await desk.newPage()
  await made.goto(ORIGIN + '/new?empty=1')
  await made.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 90000 })
  await expect(notice(made)).toBeVisible({ timeout: 30000 })
  const url = made.url()
  const storageState = await desk.storageState()
  const context = await browser.newContext({ ...device, storageState })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await expect(page.locator('#slateCanvas svg[viewBox]').first()).toBeVisible({ timeout: 90000 })
  expect(await page.evaluate(() => window.Meteor?.user()?.isAnonymous ?? true)).toBe(true)
  await expect(notice(page)).toBeVisible({ timeout: 30000 })
  await page.waitForTimeout(1200)
  // One guest on two pages: the device page leaves the app first, then the desktop's closing deletes the guest
  // once (spec-cleanup.mjs); a page whose account went from under it would wait.
  const done = async () => { await page.goto('about:blank'); await desk.close(); await context.close() }
  return { context, page, errors, done }
}

/** Every control at the canvas's foot (its bar, the zoom controls), and whether the notice's box overlaps any. */
const coversBar = page => page.evaluate(() => {
  const box = document.querySelector('[data-cookie-notice]')?.getBoundingClientRect()
  if (!box) return []
  return [...document.querySelectorAll('.sb-canvas-bar button, .sb-canvas-bar [role="switch"], .sb-canvas-bar input, .slatebox-zoom-slider button, .slatebox-zoom-slider input')]
    .map(el => ({ name: el.textContent?.trim() || el.getAttribute('aria-label') || el.tagName, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width && r.height && r.left < box.right && box.left < r.right && r.top < box.bottom && box.top < r.bottom)
    .map(({ name }) => name)
})

const canvasRoom = page => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.sb-canvas-page')).paddingBottom))

test('phone: Got it takes the notice away with one tap, gives the canvas its room back, and never comes back', async ({ browser }) => {
  const { context, page, errors, done } = await freshSlate(browser)
  // Never over a control at the canvas's foot; and it is what a tap on Got it reaches (nothing lies over it).
  expect(await coversBar(page)).toEqual([])
  expect(await page.locator('.slatebox-zoom-slider button').count()).toBeGreaterThan(0)
  const button = notice(page).getByRole('button', { name: 'Got it' })
  const at = await button.boundingBox()
  expect(at.y + at.height).toBeLessThanOrEqual(844)
  const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-cookie-notice]') !== null, { x: at.x + at.width / 2, y: at.y + at.height / 2 })
  expect(top).toBe(true)
  const roomBefore = await canvasRoom(page)
  // Whatever lies under Got it once the notice is gone must not hear the tap.
  await page.evaluate(({ x, y }) => {
    window.__ghost = []
    document.addEventListener('click', event => { if (!event.target.closest?.('[data-cookie-notice]')) window.__ghost.push(event.target.tagName) }, true)
  }, {})
  await page.touchscreen.tap(at.x + at.width / 2, at.y + at.height / 2)
  await expect(notice(page)).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => window.__ghost)).toEqual([])
  // The room the page kept for it is given back: the canvas reaches the foot again.
  expect(await canvasRoom(page)).toBeLessThan(roomBefore)
  expect(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--sb-cookie-strip').trim())).toBe('')
  // Kept twice: the cookie and localStorage.
  expect((await context.cookies()).some(cookie => cookie.name === 'CookieConsent' && cookie.value === 'true')).toBe(true)
  expect(await page.evaluate(() => localStorage.getItem('sb-cookie-notice'))).toBe('answered')
  // A reload and another page never ask again.
  await page.reload()
  await page.waitForTimeout(3000)
  await expect(notice(page)).toHaveCount(0)
  await page.goto(ORIGIN + '/library')
  await expect(page.getByRole('heading', { name: 'Library' }).first()).toBeVisible({ timeout: 60000 })
  await page.waitForTimeout(3000)
  await expect(notice(page)).toHaveCount(0)
  expect(errors).toEqual([])
  await done()
})

test('phone: a browser that drops cookies still remembers the answer (localStorage)', async ({ browser }) => {
  const { context, page, done } = await freshSlate(browser)
  await notice(page).getByRole('button', { name: 'Got it' }).tap()
  await expect(notice(page)).toHaveCount(0)
  // As an in-app browser that keeps no cookies between pages: the login cookie stays, the notice's goes.
  const kept = (await context.cookies()).filter(cookie => cookie.name !== 'CookieConsent')
  await context.clearCookies()
  await context.addCookies(kept)
  await page.reload()
  await page.waitForTimeout(3000)
  await expect(notice(page)).toHaveCount(0)
  await done()
})

test('narrow window: the notice lies above the canvas bar, never over its controls, and Got it gives the bar its room back', async ({ browser }) => {
  // 390 by 844 with a mouse: the narrow layout that edits, with the bar under the canvas.
  const { context, page, errors, done } = await freshSlate(browser, { viewport: { width: 390, height: 844 } })
  await expect(page.locator('.sb-canvas-bar')).toBeVisible()
  expect(await coversBar(page)).toEqual([])
  const barBefore = await page.locator('.sb-canvas-bar').boundingBox()
  await notice(page).getByRole('button', { name: 'Got it' }).click()
  await expect(notice(page)).toHaveCount(0)
  await page.waitForTimeout(500)
  const barAfter = await page.locator('.sb-canvas-bar').boundingBox()
  expect(barAfter.y).toBeGreaterThan(barBefore.y)
  expect(errors).toEqual([])
  await done()
})

test('keyboard: Got it is a real button, reached and pressed from the keyboard', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  await page.goto(ORIGIN + '/new?empty=1')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 90000 })
  await expect(notice(page)).toBeVisible({ timeout: 30000 })
  await notice(page).getByRole('button', { name: 'Got it' }).focus()
  await page.keyboard.press('Enter')
  await expect(notice(page)).toHaveCount(0)
  await context.close()
})
