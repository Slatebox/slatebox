// Building a smart component in a real browser (library spec §4.6), in a fresh session each run (no cookies,
// no storage): /new#build, the Columns shape, Keep; a rule control on the board gives Doing a limit and its
// line is dragged (a pointer drag, then a key), and the rule is still there after a reload; "Let Done hold 4"
// in chat, Keep; Save as Decide; on another slate, Add to this slate › Yours › Add, Keep; Submit, and the build
// bar says "Submitted for review". A branch off Retro keeps Meetings, locked. At 1440 and at 390.
//
// Against a running app:
//   SLATEBOX_ORIGIN=http://127.0.0.1:3610 npx playwright test scripts/library-builder.spec.mjs
// Submitting needs a signed-in person: SLATEBOX_PROMOTE names a command that turns the guest whose id it is
// given into a signed-in account on that local app (a local database only); without it the guest's sign-up
// prompt is asserted instead. SLATEBOX_SHOTS is a folder for screenshots.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3610'
const SHOTS = process.env.SLATEBOX_SHOTS || ''
const PROMOTE = process.env.SLATEBOX_PROMOTE || ''
test.setTimeout(420000)
test.use({ ...(process.env.SLATEBOX_CHROMIUM && { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } }) })

const panel = page => page.locator('aside[aria-label="Ask Slatebox"]')
const bar = page => page.locator('[data-build-bar]')
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }
async function say(page, text) {
  const box = panel(page).getByRole('textbox', { name: 'Message Slatebox' })
  await box.fill(text)
  await box.press('Enter')
}
const keep = page => panel(page).getByRole('button', { name: 'Keep changes' }).click()
const control = (page, id) => page.locator(`g[data-rule-control="${id}"]`).first()
async function openPanel(page) {
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {})
  if (!(await panel(page).isVisible().catch(() => false))) await page.locator('[data-conversation-toggle]').first().click()
  await expect(panel(page)).toBeVisible()
}

for (const size of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'phone', width: 390, height: 844 }]) {
  test(`build a smart component from scratch, by chat and by the board's controls, save, add and submit (${size.name})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, ...(size.name === 'phone' && { hasTouch: true, isMobile: true }) })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(ORIGIN + '/new#build')
    await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
    const builder = page.url()
    // A fresh guest: nothing carried in from another session.
    expect(await page.evaluate(() => window.Meteor?.user()?.isAnonymous ?? true)).toBe(true)
    await expect(bar(page)).toBeVisible({ timeout: 60000 })
    await expect(bar(page)).toContainText(size.name === 'phone' ? 'Building' : 'Building a smart component')
    await openPanel(page)
    await expect(panel(page).getByText('What should this board do?')).toBeVisible({ timeout: 30000 })
    await shot(page, `${size.name}-01-first-turn`)

    // 1. The Columns shape: a plain chat message, previewed, then kept.
    await panel(page).locator('[data-shape="columns"]').click()
    await expect(panel(page).getByRole('button', { name: 'Keep changes' })).toBeVisible({ timeout: 60000 })
    await shot(page, `${size.name}-02-columns-preview`)
    await keep(page)
    await expect(page.locator('g[aria-label^="Doing"]').first()).toBeVisible({ timeout: 60000 })

    // 2. The board's rule controls are drawn on it (native shapes in the canvas's SVG, never HTML).
    await expect(page.locator('g[data-rule-controls]')).toHaveCount(1, { timeout: 30000 })
    expect(await page.locator('g[data-rule-controls]').evaluate(g => g.ownerSVGElement !== null)).toBe(true)
    // On a phone the sheet gives the screen to the board just kept; closed by hand if it is still open.
    if (size.name === 'phone' && await panel(page).isVisible().catch(() => false)) await panel(page).getByRole('button', { name: 'Close conversation' }).click()
    await shot(page, `${size.name}-03-controls`)
    const line = control(page, 'capacity:lane-2')
    if (size.name === 'desktop') {
      // + gives Doing a limit; the limit line appears; a pointer drag on it, then a key, change it.
      await control(page, 'capacity-plus:lane-2').click()
      await expect(line).toHaveAttribute('aria-label', /Doing holds \d+/, { timeout: 30000 })
      const before = await line.getAttribute('aria-label')
      const hit = await line.locator('[data-rule-hit]').boundingBox()
      await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2)
      await page.mouse.down()
      for (let i = 1; i <= 8; i++) await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2 + i * 14)
      await page.mouse.up()
      await expect.poll(() => line.getAttribute('aria-label'), { timeout: 30000 }).not.toBe(before)
      const dragged = await line.getAttribute('aria-label')
      await line.focus()
      await page.keyboard.press('ArrowUp')
      await expect.poll(() => line.getAttribute('aria-label'), { timeout: 30000 }).not.toBe(dragged)
    } else {
      // On a phone (Doing wraps under To do), the same controls by the keyboard: Enter on +, then an arrow on the line.
      await control(page, 'capacity-plus:lane-2').focus()
      await page.keyboard.press('Enter')
      await expect(line).toHaveAttribute('aria-label', /Doing holds \d+/, { timeout: 30000 })
      const before = await line.getAttribute('aria-label')
      await line.focus()
      await page.keyboard.press('ArrowDown')
      await expect.poll(() => line.getAttribute('aria-label'), { timeout: 30000 }).not.toBe(before)
    }
    await expect.poll(async () => (await line.getAttribute('aria-label'))?.match(/Doing holds (\d+)/)?.[1], { timeout: 30000 }).toBeTruthy()
    const held = (await line.getAttribute('aria-label')).match(/Doing holds (\d+)/)[1]
    // The change was saved with Undo, and the board says it.
    await expect(page.getByRole('button', { name: 'Undo last change' }).first()).toBeVisible({ timeout: 30000 })
    await shot(page, `${size.name}-04-limit-dragged`)
    // Reloaded, the rule is still there.
    await page.reload()
    await expect(control(page, 'capacity:lane-2')).toHaveAttribute('aria-label', new RegExp(`Doing holds ${held}\\b`), { timeout: 60000 })

    // 3. Chat grows it too: a rule said in chat, previewed, kept.
    await openPanel(page)
    await say(page, 'Let Done hold 4')
    await expect(panel(page).getByRole('button', { name: 'Keep changes' })).toBeVisible({ timeout: 60000 })
    await shot(page, `${size.name}-05-chat-rule`)
    await keep(page)
    await expect(control(page, 'capacity:lane-3')).toHaveAttribute('aria-label', /Done holds 4\b/, { timeout: 60000 })

    // 4. Save as Decide.
    await bar(page).getByRole('button', { name: 'Save', exact: true }).click()
    const sheet = page.locator('[data-build-sheet="save"]')
    await sheet.getByLabel('Name').fill('Doing then done ' + size.name)
    await sheet.getByLabel('What it does, in one line').fill('Three columns; Doing holds a few, Done holds four')
    await sheet.getByRole('button', { name: 'Decide' }).click()
    await shot(page, `${size.name}-06-save-sheet`)
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(bar(page).locator('[data-build-status="draft"]')).toBeVisible({ timeout: 30000 })

    // 5. On another slate: Add to this slate › Yours › Add, then Keep.
    await page.goto(ORIGIN + '/new')
    await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
    await openPanel(page)
    await panel(page).getByRole('button', { name: /See all|Browse/ }).first().click()
    const yours = panel(page).locator('section[aria-label="Yours"]')
    await expect(yours).toContainText('Doing then done ' + size.name, { timeout: 30000 })
    await shot(page, `${size.name}-07-yours`)
    await yours.getByRole('button', { name: 'Add Doing then done ' + size.name }).click()
    await panel(page).getByRole('button', { name: 'Keep', exact: true }).click({ timeout: 30000 })
    // The board is drawn on this slate (the conversation then becomes the board's own).
    await expect(page.locator('g[aria-label^="Doing"]').first()).toBeVisible({ timeout: 60000 })
    await shot(page, `${size.name}-08-added`)

    // 6. Submit: a guest is asked to sign up; a signed-in person's goes to the queue.
    await page.goto(builder)
    await expect(bar(page)).toBeVisible({ timeout: 60000 })
    if (PROMOTE) {
      const id = await page.evaluate(() => window.Meteor.userId())
      execFileSync(PROMOTE, [id], { stdio: 'inherit' })
      await page.reload()
      await expect(bar(page)).toBeVisible({ timeout: 60000 })
    }
    await bar(page).getByRole('button', { name: /Submit/ }).click()
    const submit = page.locator('[data-build-sheet="submit"]')
    await expect(submit.getByText('Shared under CC BY 4.0')).toBeVisible()
    await submit.getByLabel('Note for the reviewer (optional)').fill('Built in a test run')
    await shot(page, `${size.name}-09-submit-sheet`)
    await submit.getByRole('button', { name: 'Submit for review' }).click()
    if (PROMOTE) {
      await expect(bar(page)).toContainText('Submitted for review', { timeout: 30000 })
    } else {
      await expect(submit.getByRole('alert')).toContainText('Sign up to publish', { timeout: 30000 })
    }
    await shot(page, `${size.name}-10-submitted`)
    expect(errors).toEqual([])
    await context.close()
  })
}

test('a branch off Retro keeps Meetings, locked; its controls are on the board from the start', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto(ORIGIN + '/new#build=builtin-retro')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
  await expect(bar(page)).toContainText('Branched from Retro (Meetings)', { timeout: 60000 })
  await expect(page.locator('[data-build-greeting]')).toContainText('This is your copy of Retro.')
  await expect(page.locator('g[data-rule-controls]')).toHaveCount(1, { timeout: 60000 })
  await bar(page).getByRole('button', { name: 'Save', exact: true }).click()
  const sheet = page.locator('[data-build-sheet="save"]')
  await expect(sheet.locator('[data-category-locked="meetings"]')).toContainText('Meetings (from Retro)')
  await expect(sheet.getByRole('button', { name: 'Decide' })).toHaveCount(0)
  await shot(page, 'branch-01-locked-category')
  await sheet.getByLabel('What it does, in one line').fill('Went well, change, try, and a vote')
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(bar(page).locator('[data-build-status="draft"]')).toBeVisible({ timeout: 30000 })
  await context.close()
})
