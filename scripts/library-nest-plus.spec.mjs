// Impact × effort, the reorg & hiring sandbox and goals & owners in a real browser (dragology final.md D5–D7), each
// added from the library by chat and kept, then driven by real mouse drags on the canvas and reshaped by chat:
//   - Impact × effort: a fourth idea dragged into Do now is refused in the rule's words and goes back; "Do now holds 4"
//     is a rules diff, kept; the same drag lands; a reload keeps it.
//   - Reorg: someone dragged under an open role is refused; a manager dragged under another VP brings the team.
//   - Goals & owners: a key result dropped on another team lands, flagged cross-team; "bring its initiatives along" is
//     kept, and the next drop on a team carries what is under the card.
//   - "What can this do?" answers on each board with phrases that work there.
//
// Against a running app (a fresh guest per run: no cookies, no storage):
//   cd scripts && SLATEBOX_ORIGIN=http://127.0.0.1:3911 npx playwright test library-nest-plus.spec.mjs
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
const flat = text => text.replace(/\s+/g, '')
const says = (page, sentence) => expect.poll(async () => flat(await page.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('svg text')].map(t => t.textContent).join(' '))),
  { timeout: 15000 }).toContain(flat(sentence))
const inside = (b, area) => b.x + b.width / 2 > area.x && b.x + b.width / 2 < area.x + area.width && b.y + b.height / 2 > area.y && b.y + b.height / 2 < area.y + area.height

/** A real mouse drag: press a note near its top-left corner, move in small steps to `to` (a screen point), let go. */
async function dragTo(page, id, to, steps = 16) {
  await page.mouse.click(700, 880)
  await page.waitForTimeout(300)
  const b = await box(page, id)
  const x = b.x + Math.min(20, b.width / 2), y = b.y + Math.min(14, b.height / 2)
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + (to.x - x) * i / steps, y + (to.y - y) * i / steps)
  await page.waitForTimeout(250)
  await page.mouse.up()
  await page.waitForTimeout(900)
}

async function freshSlate(browser, viewport) {
  const context = await browser.newContext(viewport ? { viewport } : {})
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(ORIGIN + '/new')
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

/** "What can this do?": the board's phrases, one of them `phrase`. */
async function whatCanThisDo(page, phrase) {
  await panel(page).getByRole('button', { name: 'What can this do?' }).click()
  await expect(panel(page).getByText('Here is what this board can do.').last()).toBeVisible({ timeout: 15000 })
  await expect(panel(page).getByText(phrase).first()).toBeVisible()
}

test('impact × effort: a fourth idea into Do now is refused; "Do now holds 4" is kept; the same drag lands and stays after a reload', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser)
  await addFromLibrary(page, 'Add an impact × effort board', 'Impact × effort')
  await whatCanThisDo(page, 'Plan it holds 2')
  const billing = await box(page, 'card-billing')
  const square = await box(page, 'column-q-do-now')

  // 1. Rewrite billing into Do now (full): refused in the rule's words, and it goes back.
  await dragTo(page, 'card-billing', { x: square.x + square.width * 0.3, y: square.y + square.height * 0.35 })
  await says(page, 'Do now holds 3. Exports has the lowest impact there.')
  await expect.poll(async () => Math.abs((await box(page, 'card-billing')).x - billing.x)).toBeLessThan(3)

  // 2. "Do now holds 4": a rules diff, kept; nothing moved.
  await say(page, 'Do now holds 4')
  await expect(panel(page).getByText(/Rules \(rev \d+ → \d+\)/)).toBeVisible({ timeout: 30000 })
  await keep(page)
  await expect.poll(() => canvasText(page)).toContain('Do now holds 4.')

  // 3. The same drag lands: Rewrite billing is in Do now, and the square counts it.
  const squareNow = await box(page, 'column-q-do-now')
  await dragTo(page, 'card-billing', { x: squareNow.x + squareNow.width * 0.3, y: squareNow.y + squareNow.height * 0.35 })
  await expect.poll(async () => inside(await box(page, 'card-billing'), await box(page, 'column-q-do-now')), { timeout: 15000 }).toBe(true)
  await says(page, 'Do now · 4 of 4')
  await expect(page.getByText('Your change was not saved')).toHaveCount(0)

  // 4. Saved: a reload draws it there.
  await page.waitForTimeout(1500)
  await page.reload()
  await expect.poll(() => canvasText(page), { timeout: 60000 }).toContain('Do now holds 4.')
  expect(inside(await box(page, 'card-billing'), await box(page, 'column-q-do-now'))).toBe(true)
  expect(errors).toEqual([])
  await context.close()
})

test('reorg sandbox: a drag under an open role is refused; a manager dragged under another VP brings the whole team', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser)
  await addFromLibrary(page, 'Add a reorg & hiring sandbox', 'Open roles don’t manage')
  await whatCanThisDo(page, 'Engineers don’t manage')
  const tom = await box(page, 'card-tom')

  // 1. Tom onto VP Sales (an open role): refused, and Tom goes back.
  const open = await box(page, 'card-vp-sales')
  await dragTo(page, 'card-tom', { x: open.x + open.width / 2, y: open.y + open.height / 2 })
  await says(page, 'Open roles don’t manage. VP Sales is an open role.')
  await expect.poll(async () => Math.abs((await box(page, 'card-tom')).y - tom.y)).toBeLessThan(3)

  // 2. Jo onto Priya: Jo now sits on Kai's row (under a VP), and Ravi, Lena and Sam come along, one row below Jo.
  const ravi = await box(page, 'card-ravi')
  const priya = await box(page, 'card-priya')
  await dragTo(page, 'card-jo', { x: priya.x + priya.width / 2, y: priya.y + priya.height / 2 })
  await expect.poll(async () => (await box(page, 'card-ravi')).x !== ravi.x, { timeout: 15000 }).toBe(true)
  const [jo, kai, raviNow, lena] = await Promise.all(['card-jo', 'card-kai', 'card-ravi', 'card-lena'].map(id => box(page, id)))
  expect(Math.abs(jo.y - kai.y)).toBeLessThan(4)
  expect(Math.abs(raviNow.y - lena.y)).toBeLessThan(4)
  expect(raviNow.y).toBeGreaterThan(jo.y)
  await says(page, 'Priya Rao, VP Eng manager · 2 reports')
  await expect(page.getByText('Your change was not saved')).toHaveCount(0)

  // 3. "Engineers don’t manage": kept, and on the note.
  await say(page, 'Engineers don’t manage')
  await keep(page)
  await expect.poll(() => canvasText(page)).toContain('Engineers don’t manage.')

  // 4. "Stop me when a manager has no designer": Lena (Jo's only designer) dragged under Kai is refused, and goes back.
  await say(page, 'Stop me when a manager has no designer')
  await keep(page)
  await expect.poll(() => canvasText(page)).toContain('Every manager has a designer under them.')
  const lenaAt = await box(page, 'card-lena')
  const kaiAt = await box(page, 'card-kai')
  await dragTo(page, 'card-lena', { x: kaiAt.x + kaiAt.width / 2, y: kaiAt.y + kaiAt.height / 2 })
  await says(page, 'Every manager has a designer under them. Jo Park, Growth would have none.')
  await expect.poll(async () => Math.abs((await box(page, 'card-lena')).x - lenaAt.x)).toBeLessThan(3)

  // 5. A pasted pod under Kai, whose team has no designer: the new manager first, then their designer and
  // an engineer. It lands as one change, kept by the server, and survives a reload.
  await say(page, ['name, role, manager', 'Noor Ali, manager, Kai Wong, Platform', 'Mia Holt, designer, Noor Ali', 'Eli Ford, engineer, Noor Ali'].join('\n'))
  await keep(page)
  await says(page, 'Noor Ali manager · 2 reports')
  await page.waitForTimeout(1500)
  await page.reload()
  await expect.poll(() => canvasText(page), { timeout: 60000 }).toContain('Mia Holt')
  await says(page, 'Noor Ali manager · 2 reports')
  expect(errors).toEqual([])
  await context.close()
})

test('goals & owners: a key result dropped on another team is flagged cross-team; after "bring its initiatives along" the next drop carries them', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser)
  await addFromLibrary(page, 'Add a goals & owners board', 'Initiatives sit under a key result')
  await whatCanThisDo(page, 'When I move a key result, bring its initiatives along')
  await says(page, 'Platform 3 cards')

  // 1. Self-serve upgrades onto Platform: it lands, Platform's, flagged cross-team; its initiative stays Growth's.
  const platform = await box(page, 'caption-owner-platform')
  await dragTo(page, 'card-self-serve', { x: platform.x + platform.width / 2, y: platform.y + platform.height / 2 })
  await says(page, 'Platform · cross-team')
  await says(page, 'Platform 4 cards')
  await expect(page.getByText('Your change was not saved')).toHaveCount(0)

  // 2. "When I move a key result, bring its initiatives along": a rules diff, kept.
  await say(page, 'When I move a key result, bring its initiatives along')
  await expect(panel(page).getByText(/Rules \(rev \d+ → \d+\)/)).toBeVisible({ timeout: 30000 })
  await keep(page)
  await expect.poll(() => canvasText(page)).toContain('brings what is under it along')

  // 3. Onboarding under 10 min onto Platform: it and its two initiatives go.
  const tile = await box(page, 'caption-owner-platform')
  await dragTo(page, 'card-fast-onboarding', { x: tile.x + tile.width / 2, y: tile.y + tile.height / 2 })
  await says(page, 'Platform 7 cards')
  await expect(page.getByText('Your change was not saved')).toHaveCount(0)

  // 4. Saved: a reload draws the same teams.
  await page.waitForTimeout(1500)
  await page.reload()
  await expect.poll(() => canvasText(page), { timeout: 60000 }).toContain('brings what is under it along')
  await says(page, 'Platform 7 cards')
  expect(errors).toEqual([])
  await context.close()
})

test('the library in Ask Slatebox lists all three, each with its looping picture and phrases that work', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser)
  await panel(page).getByRole('button', { name: /^See all \d+$/ }).click()
  const library = panel(page).getByRole('region', { name: 'Add to this slate' })
  await expect(library).toBeVisible()
  for (const [name, phrase] of [['Impact × effort', 'Plan it holds 2'], ['Reorg & hiring sandbox', 'Engineers don’t manage'], ['Goals & owners', 'When I move a key result, bring its initiatives along']]) {
    const card = library.getByRole('button', { name: new RegExp('^' + name.replace(/[&×]/g, '.') + ': ') })
    await expect(card).toBeVisible()
    await card.click()
    const detail = library.getByRole('region', { name })
    await expect(detail.getByRole('img').first()).toHaveAttribute('aria-label', new RegExp('^' + name.replace(/[&×]/g, '.') + ': '))
    await expect(detail.getByRole('region', { name: 'Say it like this' }).getByText(phrase)).toBeVisible({ timeout: 15000 })
    await library.getByRole('button', { name: 'Back to the library' }).click()
  }
  expect(errors).toEqual([])
  await context.close()
})

test('on a phone (390) Impact × effort is a square that fits, with every scored idea inside it', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser, { width: 390, height: 844 })
  await addFromLibrary(page, 'Add an impact × effort board', 'Impact × effort')
  await page.waitForTimeout(1500)
  const squares = await Promise.all(['do-now', 'plan', 'later', 'skip'].map(id => box(page, 'column-q-' + id)))
  const left = Math.min(...squares.map(b => b.x)), right = Math.max(...squares.map(b => b.x + b.width))
  const top = Math.min(...squares.map(b => b.y)), bottom = Math.max(...squares.map(b => b.y + b.height))
  expect(Math.abs((right - left) - (bottom - top))).toBeLessThan(2)
  for (const id of ['search', 'sso', 'exports', 'mobile', 'summaries', 'dark-mode', 'billing']) {
    const b = await box(page, 'card-' + id)
    expect(b.x >= left - 1 && b.x + b.width <= right + 1 && b.y >= top - 1 && b.y + b.height <= bottom + 1, id).toBe(true)
  }
  expect(errors).toEqual([])
  await context.close()
})
