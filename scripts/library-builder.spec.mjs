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
const header = page => page.locator('.sb-board-toolbar')
// The build bar lives in the canvas header: all of it from 1000px wide; below that one Builder button, whose sheet
// holds the item's name, where it stands, and Save and Submit. `builderControls(page)` is where those are found now (the
// sheet opened first on a narrow screen); `doneWithBuilder` closes that sheet again.
const details = page => page.locator('[data-build-details]')
async function builderControls(page) {
  const folded = bar(page).getByRole('button', { name: 'Builder', exact: true })
  if (!(await folded.isVisible().catch(() => false))) return bar(page)
  if (!(await details(page).isVisible().catch(() => false))) await folded.click()
  await expect(details(page)).toBeVisible()
  return details(page)
}
async function doneWithBuilder(page) {
  if (await details(page).isVisible().catch(() => false)) {
    await details(page).getByRole('button', { name: 'Close', exact: true }).click()
    await expect(details(page)).toBeHidden()
  }
}
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
// Nothing of the builder is over the canvas: the bar's box lies inside the header's, and a selected note's toolbar
// (Edit, Move to, Ask Slatebox, delete) is clear of every part of the builder still on screen.
async function builderInHeader(page) {
  const head = await header(page).boundingBox(), box = await bar(page).boundingBox()
  expect(box, 'the build bar is drawn').toBeTruthy()
  expect(box.x >= head.x - 0.5 && box.y >= head.y - 0.5 && box.x + box.width <= head.x + head.width + 0.5 && box.y + box.height <= head.y + head.height + 0.5,
    `the build bar ${JSON.stringify(box)} lies inside the header ${JSON.stringify(head)}`).toBe(true)
  for (const button of await bar(page).getByRole('button').all()) {
    const b = await button.boundingBox()
    expect(b.y >= head.y - 0.5 && b.y + b.height <= head.y + head.height + 0.5, 'each builder button sits inside the header').toBe(true)
  }
}
// At 1440 the header reads in full: the slate's name, the bar's buttons and (`lines`) both lines of the bar (where it
// stands, the item's name), with Ask Slatebox open or closed; and from 1024px the bar is never the one Builder button.
// (A long slate name, such as a new builder slate's "Untitled smart component", keeps its room first and the bar gives way
// in its fixed order, never below a readable width: library-builder-fit.spec.mjs sweeps every width and name length. The
// Retro branch below, like the owner's Impact × effort, reads in full.)
async function headerReadsInFull(page, { lines = true } = {}) {
  await expect(bar(page).getByRole('button', { name: 'Builder', exact: true }), 'the whole bar on a desktop').toHaveCount(0)
  const cut = await page.evaluate((lines) => [document.querySelector('.sb-board-title strong'), ...document.querySelectorAll(lines ? '[data-build-line], [data-build-bar] button' : '[data-build-bar] button')]
    .filter(e => !e || e.scrollWidth > e.clientWidth + 1).map(e => e ? e.innerText : 'no slate name'), lines)
  expect(cut, 'nothing in the header is cut short').toEqual([])
}
async function noteToolbarClear(page, label) {
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {})
  await page.locator(`g[data-node-id][aria-label^="${label}"]`).first().click()
  const toolbar = page.locator('.sb-style-bar[role="toolbar"]').first()
  await expect(toolbar).toBeVisible({ timeout: 30000 })
  const tb = await toolbar.boundingBox()
  const parts = page.locator('[data-build-bar], [data-build-bar] *, [data-build-greeting], [data-build-sheet], [data-build-details]')
  for (const part of await parts.all()) {
    if (!(await part.isVisible().catch(() => false))) continue
    const b = await part.boundingBox()
    if (b && b.width && b.height) expect(overlaps(b, tb), `a part of the builder ${JSON.stringify(b)} covers the note's toolbar ${JSON.stringify(tb)}`).toBe(false)
  }
  return toolbar
}
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
    // A touch phone views slates and builds none (phone-view.spec.mjs): the phone width is a narrow window with a mouse.
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(ORIGIN + '/new#build')
    await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
    const builder = page.url()
    // A fresh guest: nothing carried in from another session.
    expect(await page.evaluate(() => window.Meteor?.user()?.isAnonymous ?? true)).toBe(true)
    await expect(bar(page)).toBeVisible({ timeout: 60000 })
    await expect(bar(page)).toContainText(size.name === 'phone' ? 'Builder' : 'Building a smart component')
    await builderInHeader(page)
    if (size.name === 'desktop') await headerReadsInFull(page, { lines: false })
    await openPanel(page)
    if (size.name === 'desktop') await headerReadsInFull(page, { lines: false })
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
    // The change was saved as one step of the canvas's Undo (the board's one-step pill is gone on prod): Undo takes the
    // limit back, Redo makes it again.
    const undo = page.getByRole('group', { name: 'Undo and redo' }).getByRole('button', { name: 'Undo', exact: true })
    const redo = page.getByRole('group', { name: 'Undo and redo' }).getByRole('button', { name: 'Redo', exact: true })
    await expect(undo).toBeEnabled({ timeout: 30000 })
    await undo.click()
    await expect.poll(async () => (await line.getAttribute('aria-label'))?.match(/Doing holds (\d+)/)?.[1] ?? 'none', { timeout: 30000 }).not.toBe(held)
    await expect(redo).toBeEnabled({ timeout: 30000 })
    await redo.click()
    await expect(line).toHaveAttribute('aria-label', new RegExp(`Doing holds ${held}\\b`), { timeout: 30000 })
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
    await builderInHeader(page)
    await (await builderControls(page)).getByRole('button', { name: 'Save', exact: true }).click()
    const sheet = page.locator('[data-build-sheet="save"]')
    await sheet.getByLabel('Name').fill('Doing then done ' + size.name)
    await sheet.getByLabel('What it does, in one line').fill('Three columns; Doing holds a few, Done holds four')
    await sheet.getByRole('button', { name: 'Decide' }).click()
    await shot(page, `${size.name}-06-save-sheet`)
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(sheet).toBeHidden({ timeout: 30000 })
    await expect((await builderControls(page)).locator('[data-build-status="draft"]')).toBeVisible({ timeout: 30000 })
    await doneWithBuilder(page)
    // A guest who has saved keeps the whole bar on a desktop (never the phone's Builder button), all of it readable.
    if (size.name === 'desktop') {
      await headerReadsInFull(page, { lines: false })
      await builderInHeader(page)
    }

    // 5. On another slate: Add to this slate › Yours › Add, then Keep.
    await page.goto(ORIGIN + '/new?empty=1')
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
      // With a name on the account (as library-journey's PROMOTE takes it): someone with none is asked how to credit them first.
      execFileSync(PROMOTE, [id, 'Bea', 'Builder'], { stdio: 'inherit' })
      await page.reload()
      await expect(bar(page)).toBeVisible({ timeout: 60000 })
    }
    await (await builderControls(page)).getByRole('button', { name: /Submit/ }).click()
    const submit = page.locator('[data-build-sheet="submit"]')
    await expect(submit.getByText('Shared under CC BY 4.0')).toBeVisible()
    await submit.getByLabel('Note for the reviewer (optional)').fill('Built in a test run')
    await shot(page, `${size.name}-09-submit-sheet`)
    await submit.getByRole('button', { name: 'Submit for review' }).click()
    if (PROMOTE) {
      await expect(submit).toBeHidden({ timeout: 30000 })
      await expect(await builderControls(page)).toContainText('Submitted for review', { timeout: 30000 })
      await doneWithBuilder(page)
      if (size.name === 'desktop') await headerReadsInFull(page, { lines: false })
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
  // Its first words are in Ask Slatebox, not over the board; the bar is in the header.
  await expect(panel(page).locator('[data-build-greeting]')).toHaveCount(1)
  await builderInHeader(page)
  await headerReadsInFull(page)
  // What the header has no room for (where it came from) is a click away, in full.
  await page.locator('[data-build-summary]').click()
  await expect(page.locator('[data-build-about]')).toContainText('Branched from Retro (Meetings)')
  await page.locator('[data-build-about]').getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('[data-build-about]')).toBeHidden()
  await expect(page.locator('g[data-rule-controls]')).toHaveCount(1, { timeout: 60000 })
  // A selected card's toolbar (Edit, Move to, Ask Slatebox, delete) is clear of every part of the builder.
  await expect(await noteToolbarClear(page, 'Shipped on time')).toContainText('Move to')
  await shot(page, 'branch-00-card-toolbar')
  await page.keyboard.press('Escape')
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

test('on a phone the build bar is one Builder button in the header; its sheet holds the rest; a card\'s toolbar is clear of it', async ({ browser }) => {
  // A narrow window with a mouse: a touch phone views slates and builds none (phone-view.spec.mjs).
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(ORIGIN + '/new#build=builtin-retro')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
  await expect(bar(page).getByRole('button', { name: 'Builder', exact: true })).toBeVisible({ timeout: 60000 })
  await builderInHeader(page)
  // The header never overflows at 390, and the slate's name keeps a readable width beside the Builder button (all of a short one).
  expect(await header(page).evaluate(h => h.scrollWidth <= h.clientWidth + 1), 'the header fits').toBe(true)
  const name = await page.locator('.sb-board-title strong').evaluate(e => ({ text: e.textContent, width: e.clientWidth, whole: e.scrollWidth <= e.clientWidth + 1 }))
  expect(name.whole || name.width >= 96, `the slate name is whole or at least 96px wide: ${JSON.stringify(name)}`).toBe(true)
  if (await panel(page).isVisible().catch(() => false)) {
    await expect(panel(page).locator('[data-build-greeting]')).toContainText('This is your copy of Retro.')
    await panel(page).getByRole('button', { name: 'Close conversation' }).click()
  }
  await noteToolbarClear(page, 'Shipped on time')
  await shot(page, 'phone-branch-card-toolbar')
  const sheet = await builderControls(page)
  await expect(sheet).toContainText('Building a smart component')
  await expect(sheet).toContainText('Branched from Retro (Meetings)')
  await expect(sheet).toContainText('This is your copy of Retro.')
  await expect(sheet.getByRole('button', { name: 'Submit to the library', exact: true })).toBeVisible()
  await shot(page, 'phone-branch-builder-sheet')
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(details(page)).toBeHidden()
  await expect(page.locator('[data-build-sheet="save"]')).toBeVisible()
  expect(errors).toEqual([])
  await context.close()
})
