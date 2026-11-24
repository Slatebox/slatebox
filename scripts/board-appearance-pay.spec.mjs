// A board's look said in chat, and the meter's refusal with its ways on in the message itself, in a real browser, a fresh
// session each run (owner, 2026-11-24, on a builder slate: "this kind of edit should be doable in the smart component that
// i'm building - and the AI top up offer should include the link right in the chat to upgrade to pro ... so it can be done
// right then, really easily").
//
// 1. A builder slate, as a signed-in account without Pro on a metered app: "make the columns more pronounced" changes the
//    board with no AI call (the local stub AI logs no request), Keep, and the canvas's Undo takes it back; the board's own
//    Look chip makes the same edit. Impact × effort takes the owner's own sentence.
// 2. A request that needs AI is refused by the meter: the refusing message holds "Get Slatebox Pro — $5/month" and "Add a
//    balance"; the first opens the in-app pay sheet on its Pro pane. Nothing is submitted: the spec never presses pay.
//
// Against a running app (metering on, a payments test key or a local stand-in, AI pointed at a local stub):
//   SLATEBOX_ORIGIN=http://127.0.0.1:3700 SLATEBOX_PROMOTE=<promote.sh> SLATEBOX_AI_LOG=<stub log> \
//     npx playwright test -c scripts/playwright.config.mjs board-appearance-pay.spec.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3700'
const SHOTS = process.env.SLATEBOX_SHOTS || ''
const PROMOTE = process.env.SLATEBOX_PROMOTE || ''
const AI_LOG = process.env.SLATEBOX_AI_LOG || ''
test.setTimeout(420000)
test.use({ ...(process.env.SLATEBOX_CHROMIUM && { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } }) })

const panel = page => page.locator('aside[aria-label="Ask Slatebox"]')
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }
const aiRequests = () => (AI_LOG && existsSync(AI_LOG) ? readFileSync(AI_LOG, 'utf8').split('\n').filter(line => line.includes('"POST"')).length : 0)
const control = (page, id) => page.locator(`g[data-rule-control="${id}"]`).first()
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
/** A fresh guest made a signed-in account (no Pro) by the local app's promote command. */
async function signIn(page) {
  const id = await page.evaluate(() => window.Meteor.userId())
  expect(await page.evaluate(() => window.Meteor?.user()?.isAnonymous ?? true)).toBe(true)
  execFileSync(PROMOTE, [id, 'Bea', 'Builder'], { stdio: 'pipe' })
  await page.reload()
  await page.waitForFunction(() => window.Meteor?.user()?.isAnonymous === false, null, { timeout: 60000 })
}
/** The widest outline a board's note is drawn with (its column, by the end of its name). */
const strokeOf = (page, suffix) => page.evaluate(end => {
  const group = [...document.querySelectorAll('[data-node-id]')].find(g => g.getAttribute('data-node-id').endsWith(end))
  if (!group) return null
  return Math.max(0, ...[...group.querySelectorAll('path, rect')].map(el => Number(el.getAttribute('stroke-width') || 0)))
}, suffix)

test.skip(!PROMOTE, 'needs SLATEBOX_PROMOTE: the check is for a signed-in account without Pro')

test('a builder says how the board looks, with no AI call; Undo takes it back; a refused request opens Pro in place', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(ORIGIN + '/new#build')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
  await signIn(page)
  expect(await page.evaluate(() => Boolean(window.Meteor.settings.public.metered))).toBe(true)
  await openPanel(page)
  await panel(page).locator('[data-shape="columns"]').click()
  await expect(panel(page).getByRole('button', { name: 'Keep changes' })).toBeVisible({ timeout: 60000 })
  await panel(page).getByRole('button', { name: 'Keep changes' }).click()
  await expect(control(page, 'look:emphasis')).toHaveAttribute('aria-label', /They look standard now/, { timeout: 60000 })
  const before = await strokeOf(page, 'column-lane-2')

  // 1. Said in chat: read here, no AI call; previewed, kept; the board draws it and its chip says so.
  const asked = aiRequests()
  await say(page, 'make the columns more pronounced')
  await expect(panel(page).getByText('The board now has stronger column borders, bolder headers and deeper column colors.').first()).toBeVisible({ timeout: 30000 })
  await shot(page, 'appearance-01-preview')
  await panel(page).getByRole('button', { name: 'Keep changes' }).click()
  await expect(panel(page).getByText('Saved to the board.').last()).toBeVisible({ timeout: 30000 })
  await expect(control(page, 'look:emphasis')).toHaveAttribute('aria-label', /They look strong now/, { timeout: 60000 })
  await expect.poll(() => strokeOf(page, 'column-lane-2'), { timeout: 30000 }).toBeGreaterThan(before)
  expect(aiRequests(), 'no AI request for a look').toBe(asked)
  await shot(page, 'appearance-02-kept')

  // One step of the canvas's Undo: the look goes back.
  const undo = page.getByRole('group', { name: 'Undo and redo' }).getByRole('button', { name: 'Undo', exact: true })
  await expect(undo).toBeEnabled({ timeout: 30000 })
  await undo.click()
  await expect(control(page, 'look:emphasis')).toHaveAttribute('aria-label', /They look standard now/, { timeout: 30000 })
  await expect.poll(() => strokeOf(page, 'column-lane-2'), { timeout: 30000 }).toBe(before)

  // The board's own chip makes the same edit, saved at once.
  await control(page, 'look:density').click()
  await expect(control(page, 'look:density')).toHaveAttribute('aria-label', /They are compact now/, { timeout: 30000 })
  // A sentence that could mean more than one look: looks to choose from, never a refusal.
  await say(page, 'make it pop')
  await expect(panel(page).locator('[data-look-choice="Stronger borders"]')).toBeVisible({ timeout: 30000 })
  await panel(page).locator('[data-look-choice="Bolder headers"]').click()
  await expect(panel(page).getByText('The board now has bolder headers.').first()).toBeVisible({ timeout: 30000 })
  await panel(page).getByRole('button', { name: 'Discard preview' }).click()
  expect(aiRequests(), 'still no AI request').toBe(asked)
  await shot(page, 'appearance-03-chip-and-choices')

  // 2. A request only AI can do: the meter refuses (no Pro, no balance), and the message carries both ways on.
  await say(page, 'Write three cards about onboarding risks and put them in Doing')
  const refusal = panel(page).locator('[data-chat-turn="slatebox"] [data-inline-pay]').last()
  await expect(refusal).toBeVisible({ timeout: 60000 })
  const pro = refusal.getByRole('button', { name: 'Get Slatebox Pro — $5/month' })
  await expect(pro).toBeVisible()
  await expect(refusal.getByRole('button', { name: 'Add a balance' })).toBeVisible()
  await expect(refusal).toContainText('This needs Slatebox Pro or a balance.')
  // In the message itself, not a separate chip under the starters.
  await expect(panel(page).locator('[aria-label="Starter messages"] [data-pay-action]')).toHaveCount(0)
  expect(aiRequests(), 'the meter refused before any AI request').toBe(asked)
  await shot(page, 'pay-01-refusal-in-message')
  await pro.click()
  const sheet = page.locator('[data-pay-pane="pro"]')
  await expect(sheet).toBeVisible({ timeout: 30000 })
  await shot(page, 'pay-02-pro-sheet')
  // Nothing is submitted: the sheet is closed without paying.
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click()

  // The owner's own sentence, on a component whose board is Impact × effort (its only board, as in the builder).
  await page.goto(ORIGIN + '/new')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
  await openPanel(page)
  await say(page, 'Add an impact × effort board')
  await panel(page).getByRole('button', { name: /^Keep/ }).first().click({ timeout: 60000 })
  await expect.poll(() => strokeOf(page, 'column-q-plan'), { timeout: 60000 }).not.toBeNull()
  const square = await strokeOf(page, 'column-q-plan')
  await shot(page, 'appearance-03b-impact-effort-before')
  await openPanel(page)
  await say(page, 'can you make the columns in impact x effort more pronounced?')
  await expect(panel(page).getByRole('button', { name: 'Keep changes' })).toBeVisible({ timeout: 30000 })
  await shot(page, 'appearance-04-impact-effort-preview')
  await panel(page).getByRole('button', { name: 'Keep changes' }).click()
  await expect(panel(page).getByText('Saved to the board.').last()).toBeVisible({ timeout: 30000 })
  await expect.poll(() => strokeOf(page, 'column-q-plan'), { timeout: 30000 }).toBeGreaterThan(square)
  // Saved with the board: a reload draws it again.
  await page.reload()
  await expect.poll(() => strokeOf(page, 'column-q-plan'), { timeout: 60000 }).toBeGreaterThan(square)
  expect(aiRequests(), 'no AI request on Impact × effort either').toBe(asked)
  await shot(page, 'appearance-05-impact-effort-kept')
  expect(errors).toEqual([])
  await context.close()
})
