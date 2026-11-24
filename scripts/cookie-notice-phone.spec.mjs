// The cookie notice on a phone (owner report 2026-11-23: "Cookies keep you signed in / Got it" could stay over the
// bottom of the screen after dismissal attempts). On a 390 by 844 touch phone, a fresh guest on a new slate:
//   - the notice lies above the canvas's bar and never over a control of it (the page keeps a strip for it);
//   - one tap on Got it takes it away, and the tap lands on nothing under it (no ghost tap on the bar);
//   - the bar gets its room back; a reload, and a page opened later, never show it again;
//   - a browser that keeps no cookies (the answer kept in localStorage) does not ask again either.
//
// Against a running app (a fresh guest per run: no cookies, no storage):
//   cd scripts && SLATEBOX_ORIGIN=http://127.0.0.1:3911 npx playwright test cookie-notice-phone.spec.mjs
import { expect, test } from '@playwright/test'

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3911'
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }
test.use({ ...(process.env.SLATEBOX_CHROMIUM && { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } }) })
test.setTimeout(240000)

const notice = page => page.locator('[data-cookie-notice]')

async function freshSlate(browser, extra = {}) {
  const context = await browser.newContext({ ...phone, ...extra })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(ORIGIN + '/new')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 90000 })
  expect(await page.evaluate(() => window.Meteor?.user()?.isAnonymous ?? true)).toBe(true)
  await expect(notice(page)).toBeVisible({ timeout: 30000 })
  await page.waitForTimeout(1200)
  return { context, page, errors }
}

/** Every control of the canvas's bar, and whether the notice's box overlaps any of them. */
const coversBar = page => page.evaluate(() => {
  const box = document.querySelector('[data-cookie-notice]')?.getBoundingClientRect()
  if (!box) return []
  return [...document.querySelectorAll('.sb-canvas-bar button, .sb-canvas-bar [role="switch"], .sb-canvas-bar input')]
    .map(el => ({ name: el.textContent?.trim() || el.getAttribute('aria-label') || el.tagName, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width && r.height && r.left < box.right && box.left < r.right && r.top < box.bottom && box.top < r.bottom)
    .map(({ name }) => name)
})

test('phone: Got it takes the notice away with one tap, gives the bar its room back, and never comes back', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser)
  // Above the bar, never over one of its controls; and it is what a tap on Got it reaches (nothing lies over it).
  expect(await coversBar(page)).toEqual([])
  const button = notice(page).getByRole('button', { name: 'Got it' })
  const at = await button.boundingBox()
  expect(at.y + at.height).toBeLessThanOrEqual(844)
  const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-cookie-notice]') !== null, { x: at.x + at.width / 2, y: at.y + at.height / 2 })
  expect(top).toBe(true)
  const barBefore = await page.locator('.sb-canvas-bar').boundingBox()
  // Whatever lies under Got it once the notice is gone must not hear the tap.
  await page.evaluate(({ x, y }) => {
    window.__ghost = []
    document.addEventListener('click', event => { if (!event.target.closest?.('[data-cookie-notice]')) window.__ghost.push(event.target.tagName) }, true)
  }, {})
  await page.touchscreen.tap(at.x + at.width / 2, at.y + at.height / 2)
  await expect(notice(page)).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => window.__ghost)).toEqual([])
  // The room the page kept for it is given back: the bar sits lower (at the foot again).
  const barAfter = await page.locator('.sb-canvas-bar').boundingBox()
  expect(barAfter.y).toBeGreaterThan(barBefore.y)
  expect(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--sb-cookie-strip').trim())).toBe('')
  // Kept twice: the cookie and localStorage.
  expect((await context.cookies()).some(cookie => cookie.name === 'CookieConsent' && cookie.value === 'true')).toBe(true)
  expect(await page.evaluate(() => localStorage.getItem('sb-cookie-notice'))).toBe('answered')
  // A reload and a new slate never ask again.
  await page.reload()
  await page.waitForTimeout(3000)
  await expect(notice(page)).toHaveCount(0)
  await page.goto(ORIGIN + '/new')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 90000 })
  await page.waitForTimeout(3000)
  await expect(notice(page)).toHaveCount(0)
  expect(errors).toEqual([])
  await context.close()
})

test('phone: a browser that drops cookies still remembers the answer (localStorage)', async ({ browser }) => {
  const { context, page } = await freshSlate(browser)
  await notice(page).getByRole('button', { name: 'Got it' }).tap()
  await expect(notice(page)).toHaveCount(0)
  // As an in-app browser that keeps no cookies between pages: the login cookie stays, the notice's goes.
  const kept = (await context.cookies()).filter(cookie => cookie.name !== 'CookieConsent')
  await context.clearCookies()
  await context.addCookies(kept)
  await page.reload()
  await page.waitForTimeout(3000)
  await expect(notice(page)).toHaveCount(0)
  await context.close()
})

test('keyboard: Got it is a real button, reached and pressed from the keyboard', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  await page.goto(ORIGIN + '/new')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 90000 })
  await expect(notice(page)).toBeVisible({ timeout: 30000 })
  await notice(page).getByRole('button', { name: 'Got it' }).focus()
  await page.keyboard.press('Enter')
  await expect(notice(page)).toHaveCount(0)
  await context.close()
})
