// The nested boards in a real browser (dragology final.md D4), each added from the library by chat and kept,
// then driven by real mouse drags on the canvas and reshaped by chat:
//   - Discovery tree: CSV import dragged onto the outcome is refused in the rule's words; "Let solutions sit
//     under the outcome for now" is previewed as a rules diff and kept; the same drag lands; a reload keeps it.
//   - Sort the evidence: a note dragged onto another pile goes there and the piles' counts change; a note let
//     go in empty space starts a new pile; "Weight by ARR" re-ranks the piles; on a phone it is an outline.
//
// Against a running app (a fresh guest per run: no cookies, no storage):
//   cd scripts && SLATEBOX_ORIGIN=http://127.0.0.1:3911 npx playwright test library-nest.spec.mjs
import { expect, test } from '@playwright/test'

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3911'
test.use({
  viewport: { width: 1440, height: 900 },
  ...(process.env.SLATEBOX_CHROMIUM && { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } }),
})
test.setTimeout(420000)

const panel = page => page.locator('aside[aria-label="Ask Slatebox"]')
async function say(page, text) {
  const box = panel(page).getByRole('textbox', { name: 'Message Slatebox' })
  await box.fill(text)
  await box.press('Enter')
}
async function keep(page) {
  await panel(page).getByRole('button', { name: 'Keep changes' }).click()
  await expect(panel(page).getByText('Saved to the board.').last()).toBeVisible({ timeout: 30000 })
}
const canvasText = page => page.evaluate(() => [...document.querySelectorAll('svg text')].map(t => t.textContent).join(' | '))
const box = (page, id) => page.locator(`[data-node-id="${id}"]`).first().boundingBox()
const says = (page, sentence) => expect.poll(async () => (await page.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('svg text')].map(t => t.textContent).join(' ')))
  .replace(/\s+/g, ''), { timeout: 10000 }).toContain(sentence.replace(/\s+/g, ''))

/** A real mouse drag: press a note near its top-left corner, move in small steps to `to` (a screen point), let go. */
async function dragTo(page, id, to, steps = 16) {
  await page.mouse.click(700, 860)
  await page.waitForTimeout(300)
  const b = await box(page, id)
  const x = b.x + Math.min(20, b.width / 2), y = b.y + Math.min(14, b.height / 2)
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + (to.x - x) * i / steps, y + (to.y - y) * i / steps)
  await page.waitForTimeout(250)
  await page.mouse.up()
  await page.waitForTimeout(800)
}

async function freshSlate(browser, viewport) {
  const context = await browser.newContext(viewport ? { viewport } : {})
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(ORIGIN + '/new?empty=1')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 90000 })
  expect(await page.evaluate(() => window.Meteor?.user()?.isAnonymous ?? true)).toBe(true)
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 5000 }).catch(() => {})
  if (!(await panel(page).count())) await page.locator('[data-conversation-toggle]').first().click()
  await expect(panel(page)).toBeVisible()
  await page.waitForTimeout(1500)
  return { context, page, errors }
}

// Board polish: `line` is read from the board's chrome (its title or a rule's chip), not a rules note.
async function addFromLibrary(page, message, line) {
  await say(page, message)
  await expect(panel(page).getByRole('region', { name: 'Rules' }).first()).toBeVisible({ timeout: 60000 })
  await panel(page).getByRole('button', { name: 'Keep changes' }).click()
  await expect(page.locator('[data-creative-revision]')).toBeVisible({ timeout: 60000 })
  await expect.poll(() => canvasText(page), { timeout: 30000 }).toContain(line)
}

test('discovery tree: a solution dragged onto the outcome is refused; chat changes the rule (diff, Keep); the same drag lands, and stays after a reload', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser)
  await addFromLibrary(page, 'Add a discovery tree', 'Solutions sit under an opportunity')
  const csv = await box(page, 'card-csv-import')
  const outcome = await box(page, 'card-outcome')
  const opportunity = await box(page, 'card-slow-onboarding')

  // 1. Onto the outcome: refused, in the rule's words, and CSV import goes back where it was.
  await dragTo(page, 'card-csv-import', { x: outcome.x + outcome.width / 2, y: outcome.y + outcome.height / 2 })
  await says(page, 'Solutions sit under an opportunity')
  await expect.poll(async () => Math.abs((await box(page, 'card-csv-import')).y - csv.y)).toBeLessThan(3)

  // 2. "Let solutions sit under the outcome for now": a rules diff, kept; nothing moved.
  await say(page, 'Let solutions sit under the outcome for now')
  await expect(panel(page).getByText(/Rules \(rev \d+ → \d+\)/)).toBeVisible({ timeout: 30000 })
  await keep(page)
  await expect.poll(() => canvasText(page)).toContain('Solutions sit under an opportunity or an outcome.')
  expect(Math.abs((await box(page, 'card-csv-import')).y - csv.y)).toBeLessThan(3)

  // 3. The same drag lands: CSV import now sits under the outcome, on the opportunities' row.
  const outcomeNow = await box(page, 'card-outcome')
  await dragTo(page, 'card-csv-import', { x: outcomeNow.x + outcomeNow.width / 2, y: outcomeNow.y + outcomeNow.height / 2 })
  await expect.poll(async () => Math.abs((await box(page, 'card-csv-import')).y - opportunity.y), { timeout: 15000 }).toBeLessThan(4)
  await expect(page.getByText('Your change was not saved')).toHaveCount(0)

  // 4. Saved: a reload draws it there, under the kept rule.
  await page.waitForTimeout(1500)
  await page.reload()
  await expect.poll(() => canvasText(page), { timeout: 60000 }).toContain('Solutions sit under an opportunity or an outcome.')
  const after = await box(page, 'card-csv-import'), row = await box(page, 'card-slow-onboarding')
  expect(Math.abs(after.y - row.y)).toBeLessThan(4)
  expect(errors).toEqual([])
  await context.close()
})

test('sort the evidence: a note carried to another pile, a far drop starts a pile, "Weight by ARR" re-ranks', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser)
  await addFromLibrary(page, 'Add a board to sort the evidence', 'Piles rank by number of customers')
  await expect.poll(() => canvasText(page)).toContain('Onboarding')
  const onboarding = await box(page, 'card-onboarding')

  // 1. "Couldn't find CSV export" from Reporting onto the foot of Onboarding: it joins Onboarding's column.
  const invites = await box(page, 'card-invites')
  await dragTo(page, 'card-csv-export', { x: invites.x + invites.width / 2, y: invites.y + invites.height - 8 })
  await expect.poll(async () => Math.abs((await box(page, 'card-csv-export')).x - invites.x), { timeout: 15000 }).toBeLessThan(4)
  await expect.poll(() => canvasText(page)).toContain('4 notes')
  await expect(page.getByText('Your change was not saved')).toHaveCount(0)

  // 2. "Mobile app please" from Unsorted, let go in empty space on the piles: a new pile.
  const piles = await box(page, 'column-piles')
  await dragTo(page, 'card-mobile', { x: piles.x + piles.width - 40, y: piles.y + piles.height - 30 })
  await expect.poll(() => canvasText(page), { timeout: 15000 }).toContain('New pile')
  await expect.poll(async () => (await box(page, 'card-mobile')).x).toBeGreaterThan(onboarding.x)

  // 3. "Weight by ARR": the rule is previewed, kept, and the piles re-rank by what their customers pay.
  await say(page, 'Weight by ARR')
  await expect(panel(page).getByText(/Rules \(rev \d+ → \d+\)/)).toBeVisible({ timeout: 30000 })
  await keep(page)
  await expect.poll(() => canvasText(page)).toContain('Piles rank by ARR.')
  await expect.poll(() => canvasText(page)).toContain('ARR')
  expect(errors).toEqual([])
  await context.close()
})

// Review s3-nest finding 1: a kept chat change is a whole save the server makes again as the board's own edits.
// A sentence that changes a rule and the cards at once, and a merge, are kept, drawn, and still there after a reload.
test('sort the evidence by chat: "Group … into Money" and a merge are kept, drawn, and survive a reload', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser)
  await addFromLibrary(page, 'Add a board to sort the evidence', 'Piles rank by number of customers')
  await expect.poll(() => canvasText(page)).toContain('Onboarding')

  // 1. A rule and the cards in one sentence: the depth rule is raised, a Money card is made, Pricing and Reporting go under it.
  await say(page, 'Group Pricing and Reporting into Money')
  await expect(panel(page).getByText(/Rules \(rev \d+ → \d+\)/)).toBeVisible({ timeout: 30000 })
  await keep(page)
  await expect(page.getByText('Your change was not saved')).toHaveCount(0)
  await expect.poll(() => canvasText(page)).toContain('Cards nest up to 2 levels deep.')
  await expect.poll(async () => (await box(page, 'card-pricing'))?.x - (await box(page, 'card-card-1'))?.x, { timeout: 15000 }).toBeGreaterThan(4)
  await expect.poll(async () => Math.abs((await box(page, 'card-pricing')).x - (await box(page, 'card-reporting')).x), { timeout: 15000 }).toBeLessThan(2)

  // 2. A merge: what was in Onboarding goes into Money's first pile; Onboarding is gone.
  await say(page, 'Merge Onboarding into Pricing')
  await keep(page)
  await expect(page.getByText('Your change was not saved')).toHaveCount(0)
  await expect.poll(async () => page.locator('[data-node-id="card-onboarding"]').count(), { timeout: 15000 }).toBe(0)
  await expect.poll(async () => (await box(page, 'card-invites'))?.x - (await box(page, 'card-pricing'))?.x, { timeout: 15000 }).toBeGreaterThan(4)

  // 3. Saved: a reload draws the same board.
  await page.waitForTimeout(1500)
  await page.reload()
  await expect.poll(() => canvasText(page), { timeout: 60000 }).toContain('Cards nest up to 2 levels deep.')
  expect(await page.locator('[data-node-id="card-onboarding"]').count()).toBe(0)
  expect((await box(page, 'card-pricing')).x).toBeGreaterThan((await box(page, 'card-card-1')).x + 4)
  expect((await box(page, 'card-invites')).x).toBeGreaterThan((await box(page, 'card-pricing')).x + 4)
  expect(errors).toEqual([])
  await context.close()
})

test('on a phone (390) a nested board is an outline: rows one under another, a note indented under its pile', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser, { width: 390, height: 844 })
  await addFromLibrary(page, 'Add a board to sort the evidence', 'Piles rank by number of customers')
  await page.waitForTimeout(1500)
  const rows = await Promise.all(['card-onboarding', 'card-setup-days', 'card-where-start', 'card-reporting'].map(id => box(page, id)))
  expect(rows.every(Boolean)).toBe(true)
  expect(rows[1].x).toBeGreaterThan(rows[0].x + 4) // a note is indented under its pile
  expect(Math.abs(rows[1].x - rows[2].x)).toBeLessThan(2) // its sibling at the same depth
  expect(rows[2].y).toBeGreaterThan(rows[1].y) // one under another
  expect(rows[3].y).toBeGreaterThan(rows[2].y)
  expect(Math.abs(rows[1].height - rows[2].height)).toBeLessThan(1) // the same row height
  expect(errors).toEqual([])
  await context.close()
})
