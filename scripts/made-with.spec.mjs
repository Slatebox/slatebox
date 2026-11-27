// The "Made with Slatebox" mark in a real browser, each person in a fresh context (no cookies, no storage, the
// guest state asserted first), against one running app (a local database: the slate is made public there):
//   1. a guest makes a slate: no mark on their own canvas;
//   2. another guest opens it from its link: the mark is in the canvas's bottom-left corner, inside the canvas,
//      reads "Made with Slatebox · free and open source" and links to slatebox.com (?ref=made-with&from=share)
//      in a new tab with rel noopener; light and dark both keep it readable (its own background);
//   3. on a self-hosted server its administrator hides it (madeWith.setHidden), a member cannot, and the second
//      guest no longer sees it; shown again, it is back;
//   4. a published library item shows it under the item.
//
//   SLATEBOX_ORIGIN=http://localhost:3977 SLATEBOX_MONGO=mongodb://127.0.0.1:3978/meteor \
//     npx playwright test -c scripts/playwright.config.mjs made-with.spec.mjs
// SLATEBOX_SHOTS is a folder for screenshots; SLATEBOX_CHROMIUM may name a Chromium executable.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://localhost:3977'
const MONGO = process.env.SLATEBOX_MONGO || ''
const SHOTS = process.env.SLATEBOX_SHOTS || ''
test.skip(!MONGO, 'needs SLATEBOX_MONGO: the slate is made public and an administrator named in the local database')
test.setTimeout(300000)
test.describe.configure({ mode: 'serial' })
test.use({ ...(process.env.SLATEBOX_CHROMIUM && { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } }) })

const mongo = (script) => execFileSync('mongosh', ['--quiet', MONGO, '--eval', script], { encoding: 'utf8' }).trim()
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }
const mark = (page) => page.locator('a[data-made-with]')
const freshGuest = async (browser, viewport = { width: 1440, height: 900 }) => {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  return { context, page }
}
const call = (page, name, ...args) => page.evaluate(([n, a]) => window.Meteor.callAsync(n, ...a).then((v) => ({ ok: v }), (e) => ({ error: e.error || String(e) })), [name, args])

const shared = {}

test('the owner\'s own canvas has no mark', async ({ browser }) => {
  const { context, page } = await freshGuest(browser)
  await page.goto(ORIGIN + '/new?empty=1')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
  expect(await page.evaluate(() => window.Meteor?.user()?.isAnonymous ?? true), 'a fresh guest').toBe(true)
  shared.shareId = page.url().split('/').pop()
  shared.ownerId = await page.evaluate(() => window.Meteor.userId())
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 5000 }).catch(() => {})
  await expect(page.locator('#slateCanvas svg').first()).toBeVisible({ timeout: 60000 })
  await page.waitForTimeout(3000)
  await expect(mark(page)).toHaveCount(0)
  await shot(page, 'made-with-01-owner')
  // Saved, so another person can open it; then made public in the local database.
  await expect.poll(() => mongo(`print(db.slates.countDocuments({ shareId: '${shared.shareId}' }))`), { timeout: 60000 }).toBe('1')
  expect(mongo(`print(db.slates.updateOne({ shareId: '${shared.shareId}' }, { $set: { 'options.isPublic': true } }).matchedCount)`)).toBe('1')
  await context.close()
})

for (const scheme of ['light', 'dark']) {
  test(`someone else opening the link sees the mark in the canvas's corner (${scheme})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })
    const page = await context.newPage()
    await page.goto(ORIGIN + '/canvas/' + shared.shareId)
    expect(await page.evaluate(() => window.Meteor?.userId() !== undefined)).toBe(true)
    const link = mark(page)
    await expect(link).toBeVisible({ timeout: 90000 })
    expect(await page.evaluate(() => window.Meteor.userId())).not.toBe(shared.ownerId)
    await expect(link).toHaveText('Made with Slatebox · free and open source')
    await expect(link).toHaveAttribute('href', 'https://slatebox.com/?ref=made-with&from=share')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener')
    await expect(link).toHaveAttribute('data-made-with', 'share')
    // Small, in the canvas's bottom-left corner, inside the canvas area.
    const box = await link.boundingBox()
    const area = await page.locator('#slateCanvas').boundingBox()
    expect(box.height).toBeLessThan(32)
    expect(box.width).toBeLessThan(360)
    expect(box.x - area.x).toBeLessThan(24)
    expect(area.y + area.height - (box.y + box.height)).toBeLessThan(24)
    expect(box.x >= area.x && box.y >= area.y && box.x + box.width <= area.x + area.width && box.y + box.height <= area.y + area.height).toBe(true)
    // Readable: its own background against its own ink.
    const colors = await link.evaluate((el) => { const s = getComputedStyle(el); return { ink: s.color, bg: s.backgroundColor } })
    expect(colors.ink).not.toBe(colors.bg)
    await shot(page, `made-with-02-visitor-${scheme}`)
    await context.close()
  })
}

test('a self-hosted administrator hides it and shows it again; a member cannot', async ({ browser }) => {
  const { context: adminContext, page: admin } = await freshGuest(browser)
  await admin.goto(ORIGIN + '/new?empty=1')
  await admin.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
  await admin.waitForFunction(() => Boolean(window.Meteor?.userId?.()), null, { timeout: 90000 })
  expect((await call(admin, 'madeWith.status')).ok, 'shown, and nothing more for a non-administrator').toEqual({ enabled: true })
  expect((await call(admin, 'madeWith.setHidden', true)).error, 'not an administrator: refused').toBe('forbidden')
  // This person becomes the local server's administrator (the uberMensch claim, no team) and hides it, through
  // the method the admin card calls.
  const adminId = await admin.evaluate(() => window.Meteor.userId())
  mongo(`db.permissions.insertOne({ _id: 'madewith-${Date.now()}', userId: '${adminId}', claimId: 'uberMensch' })`)
  expect((await call(admin, 'madeWith.status')).ok).toEqual({ enabled: true, canHide: true })
  expect((await call(admin, 'madeWith.setHidden', true)).ok).toEqual({ enabled: false, canHide: true })
  expect(mongo(`print(db.systemSettings.findOne({ _id: 'madeWithMark' }).hidden)`)).toBe('true')

  const { context, page } = await freshGuest(browser)
  await page.goto(ORIGIN + '/canvas/' + shared.shareId)
  await expect(page.locator('#slateCanvas svg').first()).toBeVisible({ timeout: 90000 })
  await page.waitForTimeout(4000)
  await expect(mark(page)).toHaveCount(0)
  await shot(page, 'made-with-04-hidden')

  expect((await call(admin, 'madeWith.setHidden', false)).ok).toEqual({ enabled: true, canHide: true })
  await page.reload()
  await expect(mark(page)).toBeVisible({ timeout: 90000 })
  mongo(`db.permissions.deleteMany({ userId: '${adminId}', claimId: 'uberMensch' })`)
  await context.close()
  await adminContext.close()
})

test('a published library item shows it under the item', async ({ browser }) => {
  const { context, page } = await freshGuest(browser)
  await page.goto(ORIGIN + '/library')
  const first = page.locator('a[href^="/library/"]').filter({ hasNotText: /^Library$/ }).first()
  await expect(first).toBeVisible({ timeout: 90000 })
  await first.click()
  await page.waitForURL(/\/library\/[^/]+$/)
  const link = mark(page)
  await expect(link).toBeVisible({ timeout: 60000 })
  await expect(link).toHaveAttribute('href', 'https://slatebox.com/?ref=made-with&from=library')
  await shot(page, 'made-with-03-library')
  await context.close()
})
