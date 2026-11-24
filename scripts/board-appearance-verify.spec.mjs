// The owner's own case, end to end in a real browser, a fresh context per size (owner, 2026-11-24, on a builder slate
// branched from Impact × effort: "this kind of edit should be doable in the smart component that i'm building - and the
// AI top up offer should include the link right in the chat to upgrade to pro ... so it can be done right then").
//
// As a signed-in account without Pro on a metered app, at 1440 and at 390:
// 1. "can you make the columns in impact x effort more pronounced?" makes the quadrants visibly stronger with no AI
//    request (the local stub logs none); Undo takes it back, Redo makes it again.
// 2. "make it pop" offers looks to choose from; "color Do now green" colors one quadrant.
// 3. The look survives a reload, shows live for a second person (a fresh guest on the slate made public locally), is
//    carried into a library fork (Branch off the saved item) and drawn in the item's still picture (its library page).
// 4. A request only the agent can do is refused inside its own message with "Get Slatebox Pro — $5/month", which opens
//    the pay sheet on its Pro pane in place. Nothing is paid: the sheet is closed.
//
//   SLATEBOX_ORIGIN=http://127.0.0.1:3700 SLATEBOX_PROMOTE=<promote.sh> SLATEBOX_AI_LOG=<stub log> SLATEBOX_MONGO=<url> \
//     npx playwright test -c scripts/playwright.config.mjs board-appearance-verify.spec.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3700'
const SHOTS = process.env.SLATEBOX_SHOTS || ''
const PROMOTE = process.env.SLATEBOX_PROMOTE || ''
const AI_LOG = process.env.SLATEBOX_AI_LOG || ''
const MONGO = process.env.SLATEBOX_MONGO || ''
test.setTimeout(600000)
test.use({ ...(process.env.SLATEBOX_CHROMIUM && { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } }) })

const panel = page => page.locator('aside[aria-label="Ask Slatebox"]')
const bar = page => page.locator('[data-build-bar]')
const aiRequests = () => (AI_LOG && existsSync(AI_LOG) ? readFileSync(AI_LOG, 'utf8').split('\n').filter(line => line.includes('"POST"')).length : 0)
const mongo = script => execFileSync('mongosh', ['--quiet', MONGO, '--eval', script], { encoding: 'utf8' }).trim()
async function say(page, text) {
  const box = panel(page).getByRole('textbox', { name: 'Message Slatebox' })
  await box.fill(text)
  await box.press('Enter')
}
async function openPanel(page) {
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {})
  if (!(await panel(page).isVisible().catch(() => false))) await page.locator('[data-conversation-toggle]').first().click()
  await expect(panel(page)).toBeVisible()
}
async function closePanelOnPhone(page, phone) {
  if (!phone) return
  const close = panel(page).getByRole('button', { name: /Close|Hide/ }).first()
  if (await close.isVisible().catch(() => false)) await close.click()
}
async function signIn(page) {
  const id = await page.evaluate(() => window.Meteor.userId())
  expect(await page.evaluate(() => window.Meteor?.user()?.isAnonymous ?? true), 'a fresh guest, nothing carried in').toBe(true)
  execFileSync(PROMOTE, [id, 'Bea', 'Builder'], { stdio: 'pipe' })
  await page.reload()
  await page.waitForFunction(() => window.Meteor?.user()?.isAnonymous === false, null, { timeout: 60000 })
}
/** A board note's drawn outline width and fill, by the end of its name (column-q-plan). */
const drawn = (page, suffix) => page.evaluate(end => {
  const group = [...document.querySelectorAll('[data-node-id]')].find(g => g.getAttribute('data-node-id').endsWith(end))
  if (!group) return null
  const shapes = [...group.querySelectorAll('path, rect')]
  return { stroke: Math.max(0, ...shapes.map(el => Number(el.getAttribute('stroke-width') || 0))), fill: (shapes.find(el => el.getAttribute('fill') && el.getAttribute('fill') !== 'none')?.getAttribute('fill') || '').toLowerCase() }
}, suffix)
const strokeOf = async (page, suffix) => (await drawn(page, suffix))?.stroke ?? null
const fillOf = async (page, suffix) => (await drawn(page, suffix))?.fill ?? null

test.skip(!PROMOTE || !MONGO, 'needs SLATEBOX_PROMOTE and SLATEBOX_MONGO (local dev only)')

for (const size of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'phone', width: 390, height: 844 }]) {
  test(`the owner's sentence on a builder's Impact × effort, the look kept everywhere, and Pro in the refusing message (${size.name})`, async ({ browser }) => {
    const phone = size.name === 'phone'
    const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/verify-${size.name}-${name}.png` }) }
    const device = { viewport: { width: size.width, height: size.height }, ...(phone && { hasTouch: true, isMobile: true }) }
    const context = await browser.newContext(device)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))

    // A builder slate branched from Impact × effort, as the owner had it; a signed-in account without Pro.
    await page.goto(ORIGIN + '/new#build=builtin-impact-effort')
    await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
    const builder = page.url()
    const shareId = builder.split('/').pop()
    await signIn(page)
    expect(await page.evaluate(() => Boolean(window.Meteor.settings.public.metered))).toBe(true)
    await expect(bar(page)).toBeVisible({ timeout: 60000 })
    await expect.poll(() => strokeOf(page, 'column-q-plan'), { timeout: 60000 }).not.toBeNull()
    const square = await strokeOf(page, 'column-q-plan')
    const doNowBefore = await fillOf(page, 'column-q-do-now')
    await shot(page, '01-builder-before')

    // 1. The owner's sentence: no AI request, previewed, kept, visibly stronger; Undo takes it back, Redo again.
    const asked = aiRequests()
    await openPanel(page)
    await say(page, 'can you make the columns in impact x effort more pronounced?')
    await expect(panel(page).getByText('The board now has stronger column borders, bolder headers and deeper column colors.').first()).toBeVisible({ timeout: 30000 })
    await shot(page, '02-owner-sentence-preview')
    await panel(page).getByRole('button', { name: 'Keep changes' }).click()
    await expect(panel(page).getByText('Saved to the board.').last()).toBeVisible({ timeout: 30000 })
    await closePanelOnPhone(page, phone)
    await expect.poll(() => strokeOf(page, 'column-q-plan'), { timeout: 30000 }).toBeGreaterThan(square)
    expect(aiRequests(), 'no AI request for a look').toBe(asked)
    await shot(page, '03-owner-sentence-kept')
    const undoGroup = page.getByRole('group', { name: 'Undo and redo' })
    await expect(undoGroup.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled({ timeout: 30000 })
    await undoGroup.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(() => strokeOf(page, 'column-q-plan'), { timeout: 30000 }).toBe(square)
    await shot(page, '04-undone')
    await expect(undoGroup.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled({ timeout: 30000 })
    await undoGroup.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect.poll(() => strokeOf(page, 'column-q-plan'), { timeout: 30000 }).toBeGreaterThan(square)
    const strong = await strokeOf(page, 'column-q-plan')

    // 2. A vague look: choices to click. Then one quadrant's own color.
    await openPanel(page)
    await say(page, 'make it pop')
    await expect(panel(page).locator('[data-look-choice="Stronger borders"]')).toBeVisible({ timeout: 30000 })
    await expect(panel(page).locator('[data-look-choice="Bolder headers"]')).toBeVisible()
    await expect(panel(page).locator('[data-look-choice="Both"]')).toBeVisible()
    await expect(panel(page).locator('[data-look-choice="Both"]')).toBeInViewport({ ratio: 1, timeout: 10000 })
    await shot(page, '05-choices')
    await say(page, 'color Do now green')
    await expect(panel(page).getByText('The board now has Do now in green.').first()).toBeVisible({ timeout: 30000 })
    await panel(page).getByRole('button', { name: 'Keep changes' }).click()
    await expect(panel(page).getByText('Saved to the board.').last()).toBeVisible({ timeout: 30000 })
    await closePanelOnPhone(page, phone)
    await expect.poll(() => fillOf(page, 'column-q-do-now'), { timeout: 30000 }).not.toBe(doNowBefore)
    const green = await fillOf(page, 'column-q-do-now')
    expect(aiRequests(), 'still no AI request').toBe(asked)
    await shot(page, '06-do-now-green')

    // 3a. A reload draws it again.
    await page.reload()
    await expect.poll(() => strokeOf(page, 'column-q-plan'), { timeout: 60000 }).toBe(strong)
    await expect.poll(() => fillOf(page, 'column-q-do-now'), { timeout: 60000 }).toBe(green)
    await shot(page, '07-reloaded')

    // 3b. A second person, live: a fresh guest on the slate (made public in the local database).
    expect(mongo(`print(db.slates.updateOne({ shareId: '${shareId}' }, { $set: { 'options.isPublic': true } }).matchedCount)`)).toBe('1')
    const other = await browser.newContext(device)
    const second = await other.newPage()
    await second.goto(builder)
    expect(await second.evaluate(() => window.Meteor?.user()?.isAnonymous ?? true), 'the second person is someone else').toBe(true)
    await expect.poll(() => strokeOf(second, 'column-q-plan'), { timeout: 90000 }).toBe(strong)
    await expect.poll(() => fillOf(second, 'column-q-do-now'), { timeout: 30000 }).toBe(green)
    const planBefore = await fillOf(second, 'column-q-plan')
    await openPanel(page)
    await say(page, 'color Plan it blue')
    await panel(page).getByRole('button', { name: 'Keep changes' }).click({ timeout: 30000 })
    await expect(panel(page).getByText('Saved to the board.').last()).toBeVisible({ timeout: 30000 })
    await expect.poll(() => fillOf(second, 'column-q-plan'), { timeout: 30000 }).not.toBe(planBefore)
    const blue = await fillOf(second, 'column-q-plan')
    await expect.poll(() => fillOf(page, 'column-q-plan'), { timeout: 30000 }).toBe(blue)
    if (SHOTS) await second.screenshot({ path: `${SHOTS}/verify-${size.name}-08-second-person-live.png` })
    await other.close()

    // 3c. Saved to the library, the look is in a fork (Branch off the item) and in its still picture (My library).
    const name = 'Bold bets ' + size.name + ' ' + Date.now().toString(36)
    await bar(page).getByRole('button', { name: 'Save', exact: true }).click()
    const sheet = page.locator('[data-build-sheet="save"]')
    await sheet.getByLabel('Name').fill(name)
    await sheet.getByLabel('What it does, in one line').fill('Impact × effort with its quadrants made to stand out')
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(bar(page).locator('[data-build-status="draft"]')).toBeVisible({ timeout: 30000 })
    const itemId = mongo(`print(db.libraryItems.findOne({ title: '${name}' })._id)`)
    expect(itemId).toMatch(/^[A-Za-z0-9]+$/)
    await page.goto(ORIGIN + '/new#build=' + itemId)
    await page.waitForURL(url => /\/canvas\/[A-Za-z0-9]+$/.test(url.pathname) && !url.pathname.endsWith(shareId), { timeout: 120000 })
    await expect.poll(() => strokeOf(page, 'column-q-plan'), { timeout: 60000 }).toBe(strong)
    await expect.poll(() => fillOf(page, 'column-q-do-now'), { timeout: 30000 }).toBe(green)
    await expect.poll(() => fillOf(page, 'column-q-plan'), { timeout: 30000 }).toBe(blue)
    await shot(page, '09-fork')
    const fork = page.url()
    // The item's page, as its author sees the draft: its picture is the still renderer's (boards-still, the gallery's).
    await page.goto(ORIGIN + '/library/' + itemId)
    const still = page.locator(`[data-library-still="${itemId}"]`)
    await expect(still).toHaveAttribute('data-state', 'drawn', { timeout: 60000 })
    await still.scrollIntoViewIfNeeded({ timeout: 10000 })
    const fills = () => still.evaluate(el => [...el.querySelectorAll('[fill]')].map(node => node.getAttribute('fill').toLowerCase()))
    await expect.poll(async () => (await fills()).includes(green) && (await fills()).includes(blue), { timeout: 60000 }).toBe(true)
    await shot(page, '10-still-picture')

    // 4. A request only the agent can do: refused in its own message, Pro there, the pay sheet in place.
    await page.goto(fork)
    await expect(bar(page)).toBeVisible({ timeout: 60000 })
    await openPanel(page)
    await say(page, 'Write three cards about onboarding risks and score them')
    const refusal = panel(page).locator('[data-chat-turn="slatebox"] [data-inline-pay]').last()
    await expect(refusal).toBeVisible({ timeout: 60000 })
    const pro = refusal.getByRole('button', { name: 'Get Slatebox Pro — $5/month' })
    await expect(pro).toBeVisible()
    await expect(refusal.getByRole('button', { name: 'Add a balance' })).toBeVisible()
    // In sight without scrolling, on a phone too (the starters wait while it is the newest turn).
    await expect(pro).toBeInViewport({ ratio: 1, timeout: 10000 })
    await expect(refusal.getByRole('button', { name: 'Add a balance' })).toBeInViewport({ ratio: 1 })
    await expect(panel(page).locator('[aria-label="Starter messages"] [data-pay-action]')).toHaveCount(0)
    expect(aiRequests(), 'the meter refused before any AI request').toBe(asked)
    await shot(page, '11-refusal-in-message')
    await pro.click()
    await expect(page.locator('[data-pay-pane="pro"]')).toBeVisible({ timeout: 30000 })
    // The sheet's open transition, done, for the picture.
    await page.waitForTimeout(600)
    await shot(page, '12-pro-sheet-in-place')
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click()
    await expect(page.locator('[data-pay-pane="pro"]')).toHaveCount(0, { timeout: 30000 })
    expect(errors).toEqual([])
    await context.close()
  })
}
