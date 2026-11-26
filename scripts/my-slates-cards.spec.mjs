// My slates cards (369b11fe: a card is drawn on the background its canvas opens on; 540fb413: a slate's
// thumbnail is one picture named after the slate). In a real browser, a fresh guest at 1440 and at 390:
//   - a signed-in person's slate wearing a dark style (Neon) shows its card on the canvas's own dark background, sampled as
//     pixels from the card's corner, never white;
//   - after a rename the card's one picture (role img) and its Open button carry the new name, and the
//     card holds exactly one picture;
//   - a later edit (a second rename) is on the card after a reload of My slates.
// A slate style is for an account (a guest who opens Slate style is asked to save their work first), so
// the spec signs up a throwaway account on the reserved .invalid domain. It and its slate are deleted
// when the page closes (spec-cleanup.mjs), so it is safe on staging:
//   SLATEBOX_ORIGIN=https://test.slatebox.com npx playwright test -c scripts/playwright.config.mjs my-slates-cards.spec.mjs
import { expect, test } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { deleteDisposableAccounts } from './spec-cleanup.mjs'

deleteDisposableAccounts(test)

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3911'
const sharp = createRequire(new URL('../web/app/package.json', import.meta.url))('sharp')
test.use({ ...(process.env.SLATEBOX_CHROMIUM && { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } }) })
test.setTimeout(180000)

const header = page => page.locator('.sb-board-toolbar')
const shareIdOf = page => new URL(page.url()).pathname.split('/').pop()

/** The color of one pixel of a box: `inset` px in from its left edge, `down` of the way down (0 to 1), as [r, g, b]. */
async function cornerPixel(page, box, inset = 6, down = 0) {
  const png = await page.screenshot({ clip: { x: box.x + inset, y: box.y + Math.max(inset, box.height * down), width: 1, height: 1 } })
  const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  return [data[0], data[1], data[2]]
}
const near = (a, b, tolerance = 12) => a.every((value, i) => Math.abs(value - b[i]) <= tolerance)
const hex = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16))

async function addNote(page, text, at = { x: 0.5, y: 0.5 }) {
  await page.evaluate(({ text, at }) => {
    const v2 = window.slate.v2
    const box = document.getElementById('slateCanvas').getBoundingClientRect()
    const p = v2.canvas.point(box.left + box.width * at.x, box.top + box.height * at.y)
    v2.addNode({ x: Math.round(p.x - 80), y: Math.round(p.y - 34), width: 160, height: 68, text, shape: 'roundedrectangle' })
  }, { text, at })
  const shareId = shareIdOf(page)
  await expect.poll(() => page.evaluate(async ([shareId, text]) => {
    const found = await window.Meteor.callAsync('slates.get', { shareId }).catch(() => null)
    return Boolean(found?.slateBase?.nodes?.some(n => n.options?.text === text))
  }, [shareId, text]), { timeout: 30000 }).toBe(true)
}

for (const width of [1440, 390]) {
  test(`at ${width}: a signed-in person's dark slate: its card is dark, named after the slate, one picture, and follows edits`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: width > 600 ? 900 : 844 }, ...(width < 600 && { isMobile: true, hasTouch: true }) })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    // A virgin context, then a throwaway account (no login carried over from another session).
    await page.goto(ORIGIN + '/login')
    await page.waitForFunction(() => window.Accounts && window.Meteor.status().connected, null, { timeout: 60000 })
    expect(await page.evaluate(() => localStorage.getItem('Meteor.loginToken'))).toBeNull()
    await page.evaluate(credentials => new Promise((resolve, reject) => window.Accounts.createUser(credentials, error => (error ? reject(error) : resolve()))),
      { email: 'cards-' + randomBytes(8).toString('hex') + '@slatebox.invalid', password: randomBytes(20).toString('hex'), profile: { firstName: 'Card', lastName: 'Proof' } })
    await page.waitForFunction(() => Boolean(window.Meteor.userId()))
    await page.goto(ORIGIN + '/new?empty=1')
    await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 90000 })
    await page.waitForFunction(() => Boolean(window.slate?.v2?.canvas), null, { timeout: 60000 })
    const shareId = shareIdOf(page)
    await page.locator('[data-cookie-notice] button').click({ timeout: 5000 }).catch(() => {})
    await page.getByRole('dialog', { name: /welcome/i }).getByRole('button', { name: 'OK' }).click({ timeout: 2500 }).catch(() => {})
    await addNote(page, 'First note')

    // Wear Neon (a near-black background) from the slate menu.
    // The chat shares the right side with the style panel: close it first.
    const chat = page.locator('aside[aria-label="Ask Slatebox"]')
    if (await chat.isVisible().catch(() => false)) await page.locator('[data-conversation-toggle]').first().click()
    await expect(chat).toBeHidden()
    await header(page).getByRole('button', { name: 'Slate settings and actions', exact: true }).click()
    await page.getByRole('menu', { name: 'Slate' }).getByRole('menuitem', { name: 'Slate style', exact: true }).click()
    await expect(page.locator('[data-slate-style-panel]')).toBeVisible()
    await page.locator('[data-slate-style-chip="neon"]').click()
    await expect(page.locator('[data-slate-style-chip="neon"]')).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => page.evaluate(async shareId => (await window.Meteor.callAsync('slates.get', { shareId }))?.slateBase?.options?.style?.id, shareId), { timeout: 30000 }).toBe('neon')
    await page.keyboard.press('Escape')

    // Rename it.
    const name = 'Card proof ' + width
    await header(page).getByRole('button', { name: 'Slate settings and actions', exact: true }).click()
    await page.getByRole('menu', { name: 'Slate' }).getByRole('menuitem', { name: 'Rename', exact: true }).click()
    const field = header(page).getByRole('textbox', { name: 'Slate name', exact: true })
    await field.fill(name)
    await field.press('Enter')
    await expect.poll(() => page.evaluate(async shareId => (await window.Meteor.callAsync('slates.get', { shareId }))?.slateBase?.options?.name, shareId), { timeout: 30000 }).toBe(name)
    const canvasBox = await page.locator('#slateCanvas').boundingBox()
    // Halfway down the left edge: open canvas at every width (the header, minimap and phone bars are elsewhere).
    const canvasCorner = await cornerPixel(page, canvasBox, 8, 0.5)
    expect(near(canvasCorner, hex('#0b0016'), 24), `the canvas wears Neon's background (${canvasCorner})`).toBe(true)

    // My slates: the card.
    await page.goto(ORIGIN + '/')
    const card = page.locator('li').filter({ has: page.locator('#slate_' + shareId) })
    await expect(card).toHaveCount(1, { timeout: 60000 })
    // One picture (540fb413): the card's role img, named after the slate; nothing inside it has a role.
    const picture = card.locator('[role="img"]')
    await expect(picture).toHaveCount(1)
    await expect(picture).toHaveAttribute('aria-label', name)
    await expect(card.getByRole('button', { name: 'Open ' + name, exact: true })).toBeVisible()
    // Its parts say nothing: no other role, label or focusable control inside the picture.
    expect(await picture.locator('[role], [aria-label], [tabindex], title').count()).toBe(0)
    await expect.poll(() => card.locator('[data-node-id]').count(), { timeout: 30000 }).toBeGreaterThanOrEqual(1)
    await page.waitForTimeout(800)
    const cardCorner = await cornerPixel(page, await card.locator('#slate_' + shareId).boundingBox())
    expect(near(cardCorner, canvasCorner, 24), `the card is drawn on the canvas's background: card ${cardCorner}, canvas ${canvasCorner}`).toBe(true)
    expect(near(cardCorner, [255, 255, 255], 40), 'not on white').toBe(false)

    // A later edit (a second rename) is on the card after a reload of My slates.
    await page.goto(ORIGIN + '/canvas/' + shareId)
    await page.locator('#slateCanvas [data-node-id]').filter({ hasText: 'First note' }).first().waitFor({ timeout: 60000 })
    const renamed = name + ' again'
    await header(page).getByRole('button', { name: 'Slate settings and actions', exact: true }).click()
    await page.getByRole('menu', { name: 'Slate' }).getByRole('menuitem', { name: 'Rename', exact: true }).click()
    await header(page).getByRole('textbox', { name: 'Slate name', exact: true }).fill(renamed)
    await header(page).getByRole('textbox', { name: 'Slate name', exact: true }).press('Enter')
    await expect.poll(() => page.evaluate(async shareId => (await window.Meteor.callAsync('slates.get', { shareId }))?.slateBase?.options?.name, shareId), { timeout: 30000 }).toBe(renamed)
    await page.goto(ORIGIN + '/')
    await page.reload()
    const after = page.locator('li').filter({ has: page.locator('#slate_' + shareId) })
    await expect(after.locator('[role="img"]')).toHaveAttribute('aria-label', renamed, { timeout: 60000 })
    await expect(after.locator('[role="img"]')).toHaveCount(1)
    await expect.poll(() => after.locator('[data-node-id]').count(), { timeout: 60000 }).toBeGreaterThanOrEqual(1)
    expect(errors).toEqual([])
    await context.close()
  })
}
