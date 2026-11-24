// The plans in a real browser (dragology final.md D2 and D3), each added from the library by chat and
// kept, then driven by real mouse drags on the canvas and changed by chat:
//   - Launch plan: a slip pushes what waits on it and stops at the hard line; "Let things slip past launch
//     but show them in red" lets the same drag cross it, in red; "Stop me instead of pushing dependent
//     tasks" makes the same drag refuse at the dependency; a freeze is a band a dragged bar hops.
//   - Hiring plan: a drag moves runway while you hold it; "Never let runway drop below 15 months" makes a
//     drag that would take it under refuse; on a phone (390) the plan is read-only.
//
// Against a running app (a fresh guest per run: no cookies, no storage):
//   cd scripts && SLATEBOX_ORIGIN=http://127.0.0.1:3911 npx playwright test library-plans.spec.mjs
// SLATEBOX_CHROMIUM may name a Chromium executable when this Playwright's own is not installed.
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
/** Whether the page says `sentence` (a rule's words beside a bar wrap onto lines, so spaces are not compared). */
const says = (page, sentence) => expect.poll(async () => (await page.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('svg text')].map(t => t.textContent).join(' ')))
  .replace(/\s+/g, ''), { timeout: 10000 }).toMatch(new RegExp(sentence.source.replace(/\\s\+|\\s\*| /g, '')))

// The plan starts on the next Monday (UTC), as the server dates it; a day's name as the plan says it.
const DAY = 864e5
const origin = (() => { const now = new Date(); const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()); return today + ((8 - new Date(today).getUTCDay()) % 7) * DAY })()
const name = offset => { const at = new Date(origin + offset * DAY); return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][at.getUTCDay()] + ' ' + at.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][at.getUTCMonth()] }
const short = offset => name(offset).slice(4).replace(/^(\d+) (\w+)$/, '$2 $1')

/** A real mouse drag of a note by (dx, dy), in small steps, released there. */
async function drag(page, id, dx, dy = 0, steps = 14) {
  // Nothing selected first: a selected card's toolbar floats over the rows above it.
  await page.mouse.click(700, 760)
  await page.waitForTimeout(300)
  const b = await box(page, id)
  const x = b.x + Math.min(20, b.width / 2), y = b.y + b.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + dx * i / steps, y + dy * i / steps)
  await page.waitForTimeout(250)
  await page.mouse.up()
  await page.waitForTimeout(600)
}

async function freshSlate(browser, viewport) {
  const context = await browser.newContext(viewport ? { viewport } : {})
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(ORIGIN + '/new')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 90000 })
  // A fresh guest: no login carried in from anywhere else.
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

test('launch plan: a slip pushes and stops at the line; chat makes the line soft, then makes a slip stop at what waits on it; a freeze is hopped', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser)
  await addFromLibrary(page, 'Add a launch plan', 'Hard line')
  // Working days from the next Monday: QA's last day is the third Tuesday; launch is the third Friday.
  await expect.poll(() => canvasText(page)).toContain('Done ' + name(15) + ' · launch ' + name(18))
  const design = await box(page, 'card-design')
  const dayW = design.width / 4

  // 1. Drag Design five days later: Build and QA follow (push), and the bar stops at the hard line, saying why.
  await drag(page, 'card-design', dayW * 5)
  await says(page, new RegExp('QA would run until \\w{3}\\d+\\w{3}; launch is ' + name(18) + '\\.'))
  await expect.poll(() => canvasText(page)).toContain('Done ' + name(17) + ' · launch ' + name(18))
  expect((await box(page, 'card-build')).x).toBeGreaterThan(design.x + design.width + dayW * 1.5)

  // 2. "Let things slip past launch but show them in red": the same drag now crosses the line, in red.
  await say(page, 'Let things slip past launch but show them in red')
  await expect(panel(page).getByText(/Rules \(rev \d+ → \d+\)/)).toBeVisible()
  await keep(page)
  await expect.poll(() => canvasText(page)).toContain('Launch is a soft line: a task may slip past it, shown in red.')
  await drag(page, 'card-design', dayW * 3)
  await expect.poll(() => canvasText(page)).toContain('Done ' + name(22) + ' · launch ' + name(18))
  await expect.poll(() => page.evaluate(() => window.slate?.nodes?.one?.('card-qa')?.options?.backgroundColor)).toBe('#fde3d7')

  // 3. Undo the slip; "Stop me instead of pushing dependent tasks": the same drag now refuses at Build, in the rule's words.
  await page.getByRole('button', { name: 'Undo last change' }).click()
  await expect.poll(() => canvasText(page)).toContain('Done ' + name(17) + ' · launch ' + name(18))
  await say(page, 'Stop me instead of pushing dependent tasks')
  await expect(panel(page).getByText(/Rules \(rev \d+ → \d+\)/)).toBeVisible()
  await keep(page)
  await expect.poll(() => canvasText(page)).toContain('A slip stops at the tasks that wait on it.')
  const build = await box(page, 'card-build')
  const designNow = await box(page, 'card-design')
  // Design ends the day before Build starts: any later start is refused, and Build stays put.
  await drag(page, 'card-design', dayW * 2)
  await says(page, /Design would end after Build starts on \w{3}\d+\w{3}\. Build waits on it, and a slip stops at the tasks that wait on it\./)
  await page.waitForTimeout(1000)
  expect(Math.abs((await box(page, 'card-build')).x - build.x)).toBeLessThan(2)
  expect(Math.abs((await box(page, 'card-design')).x - designNow.x)).toBeLessThan(2)
  await expect.poll(() => canvasText(page)).toContain('Done ' + name(17) + ' · launch ' + name(18))

  // 4. Back to push by chat; then a freeze on Copy's way: the dropped bar lands on one side of the band, never in it.
  await say(page, 'Push dependent tasks when I slip something')
  await expect(panel(page).getByText(/Rules \(rev \d+ → \d+\)/)).toBeVisible()
  await keep(page)
  await expect.poll(() => canvasText(page)).toContain('A slip pushes the tasks that wait on it.')
  await say(page, 'Nothing ships in code freeze, ' + short(3) + ' to ' + short(4))
  await expect(panel(page).getByText(/Rules \(rev \d+ → \d+\)/)).toBeVisible()
  await keep(page)
  await expect.poll(() => canvasText(page)).toContain('Nothing ships in code freeze')
  const copy = await box(page, 'card-copy')
  // A day as drawn now (the canvas may have zoomed since): Copy is two days, Monday and Tuesday.
  const day = copy.width / 2
  // Dropped into the band (its third and fourth days), Copy lands on a legal side and the freeze says why.
  await drag(page, 'card-copy', day * 3.4)
  await says(page, /Copy would run into code freeze \(\d+\w{3}–\d+\w{3}\)\./)
  const dropped = await box(page, 'card-copy')
  // In calendar days: one working day later (Tue), or past the band to the next Monday (7).
  expect([1, 7]).toContain(Math.round((dropped.x - copy.x) / day))
  expect(errors).toEqual([])
  await context.close()
})

test('hiring plan: a drag moves runway; a runway floor refuses a hire that takes it under; on a phone it is read-only', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser)
  await addFromLibrary(page, 'Add a hiring plan', 'Runway with these hires: 15.1 months')
  const runway = async on => Number((await canvasText(on)).match(/Runway with these hires: ([\d.]+) months/)[1])
  const designer = await box(page, 'card-designer')
  const weekW = designer.width / 6

  // 1. "Never let runway drop below 15 months".
  await say(page, 'Never let runway drop below 15 months')
  await expect(panel(page).getByText(/Rules \(rev \d+ → \d+\)/)).toBeVisible()
  await keep(page)
  await expect.poll(() => canvasText(page)).toContain('Runway stays above 15 months.')

  // 2. Drag AE #2 to the plan's start: it stops where runway would go under the floor, and says so.
  const ae = await box(page, 'card-ae-2')
  await drag(page, 'card-ae-2', -weekW * 24)
  await says(page, /That takes runway to 14\.\d months\. Runway stays above 15 months\./)
  await expect.poll(() => runway(page)).toBeGreaterThanOrEqual(15)
  const stopped = await box(page, 'card-ae-2')
  expect(stopped.x).toBeLessThan(ae.x - weekW)
  expect(stopped.x).toBeGreaterThan(ae.x - weekW * 18)
  // The same move said in chat is refused in the rule's words.
  await say(page, 'Push AE #2 to ' + short(14))
  await expect(page.getByText(/That takes runway to 14\.\d months\. Runway stays above 15 months\./).first()).toBeVisible({ timeout: 15000 })

  // 3. Drag the designer two months later: they cost nothing until they start, so runway grows while the floor holds.
  const before = await runway(page)
  await drag(page, 'card-designer', weekW * 9)
  await expect.poll(() => runway(page)).toBeGreaterThan(before)
  expect((await box(page, 'card-designer')).x).toBeGreaterThan(designer.x + weekW * 6)

  // 3. On a phone the plan is read-only: no grip moves a hire, and the plan says so.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await context.storageState() })
  const small = await phone.newPage()
  small.on('pageerror', e => errors.push('phone: ' + e.message))
  await small.goto(page.url())
  await expect.poll(() => canvasText(small), { timeout: 60000 }).toContain('Read-only here: say a change in the chat.')
  const shown = await runway(small)
  const row = await box(small, 'card-designer')
  await drag(small, 'card-designer', 120)
  expect(Math.abs((await box(small, 'card-designer')).x - row.x)).toBeLessThan(2)
  expect(await runway(small)).toBe(shown)
  expect(await small.locator('[data-node-id^="handle-"]').count()).toBe(0)
  expect(errors).toEqual([])
  await phone.close()
  await context.close()
})
