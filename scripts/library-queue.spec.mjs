// The library's review queue in a real browser (library spec §5.6), each person in a fresh context (no
// cookies, no storage), against a running app:
//   1. an author publishes a slate from Share; the reviewer opens it from /admin/library, refines it in the
//      review chat and keeps the change, moves a note on the review canvas, and approves it; signed out,
//      the public API answers it with the moved note, and /library/<slug> opens;
//   2. request changes: the reviewer sends a submission back with a message, the author reads it in the
//      bell and in My library, sends it again, and it is back in the queue;
//   3. a person who is not an administrator gets no queue (the page is not there; the API answers 403);
//   4. the queue page at 390.
//
//   cd scripts && SLATEBOX_ORIGIN=http://127.0.0.1:3620 SLATEBOX_PROMOTE=<cmd> npx playwright test library-queue.spec.mjs
// SLATEBOX_PROMOTE names a command, run as `<cmd> <userId> <first> <last> [reviewer]`, that turns a guest
// into a signed-in account on that local app (a local database only), an administrator with "reviewer".
// SLATEBOX_SHOTS is a folder for screenshots. SLATEBOX_CHROMIUM may name a Chromium executable.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3620'
const SHOTS = process.env.SLATEBOX_SHOTS || ''
const PROMOTE = process.env.SLATEBOX_PROMOTE || ''
test.skip(!PROMOTE, 'needs SLATEBOX_PROMOTE: publishing and reviewing need signed-in accounts')
test.setTimeout(480000)
test.describe.configure({ mode: 'serial' })
test.use({ screenshot: 'only-on-failure', ...(process.env.SLATEBOX_CHROMIUM && { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } }) })

const DESK = { width: 1440, height: 900 }
const RUN = Date.now().toString(36).slice(-5)
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }
const panel = page => page.locator('aside[aria-label="Ask Slatebox"]')
const review = page => page.getByTestId('review-panel')

/** A fresh person: a new context, a new guest on a new slate; promoted to a signed-in account. */
async function person(browser, { first, last, reviewer = false, viewport = DESK }) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(ORIGIN + '/new?empty=1')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
  // A fresh guest: nothing carried in from another session.
  expect(await page.evaluate(() => window.Meteor?.user()?.isAnonymous ?? true)).toBe(true)
  const id = await page.evaluate(() => window.Meteor.userId())
  execFileSync(PROMOTE, [id, first, last, ...(reviewer ? ['reviewer'] : [])], { stdio: 'inherit' })
  await page.reload()
  await expect.poll(() => page.evaluate(() => window.Meteor.user()?.isAnonymous === false), { timeout: 30000 }).toBe(true)
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {})
  return { context, page, errors, id, slate: page.url() }
}

/** A board on the author's slate, from the library by chat (notes the reviewer can move). */
async function addBoard(page) {
  if (!(await panel(page).isVisible().catch(() => false))) await page.locator('[data-conversation-toggle]').first().click()
  await expect(panel(page)).toBeVisible()
  const box = panel(page).getByRole('textbox', { name: 'Message Slatebox' })
  await box.fill('Add a launch plan')
  await box.press('Enter')
  await panel(page).getByRole('button', { name: 'Keep changes' }).click({ timeout: 90000 })
  await expect(page.locator('[data-node-id]').first()).toBeVisible({ timeout: 60000 })
  await page.waitForTimeout(1500)
}

/** Share › Library › Publish to the library, filled and sent. */
async function publishSlate(page, title, summary) {
  await page.locator('.sb-board-share').first().click()
  const share = page.getByRole('dialog', { name: 'Share this slate' })
  await expect(share.getByTestId('library-publish')).toBeVisible({ timeout: 30000 })
  await share.getByTestId('library-publish-open').click()
  const dialog = page.getByRole('dialog', { name: /Publish this slate to the library/ })
  await expect(dialog.getByText('CC BY 4.0')).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Title' }).fill(title)
  await dialog.getByRole('textbox', { name: 'One line about it' }).fill(summary)
  await dialog.getByRole('textbox', { name: 'Note for the reviewer (optional)' }).fill('Sent in a test run')
  return dialog
}

async function openFromQueue(page, title) {
  await page.goto(ORIGIN + '/admin/library')
  const row = page.getByTestId('queue-row').filter({ hasText: title })
  await expect(row).toBeVisible({ timeout: 30000 })
  await row.getByTestId('queue-open').click()
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 60000 })
  await expect(review(page)).toBeVisible({ timeout: 60000 })
  await expect(review(page).getByTestId('review-state')).toHaveText('In review', { timeout: 30000 })
}

const api = (request, path) => request.get(ORIGIN + '/api/v1' + path).then(async r => ({ status: r.status(), headers: r.headers(), body: await r.json().catch(() => null) }))

test('a slate is published from Share, refined and moved on the review canvas, approved, and public', async ({ browser, playwright }) => {
  const title = `Sprint board ${RUN}`
  const author = await person(browser, { first: 'Ada', last: 'Author' })
  await addBoard(author.page)
  const dialog = await publishSlate(author.page, title, 'Three columns for a two-week sprint')
  await shot(author.page, '01-publish-dialog')
  await dialog.getByTestId('publish-submit').click()
  await expect(author.page.getByTestId('publish-done')).toBeVisible({ timeout: 30000 })
  await expect(dialog).toBeHidden()
  await shot(author.page, '02-publish-sent')
  await expect(author.page.getByTestId('library-status')).toHaveText('Submitted for review', { timeout: 30000 })
  await shot(author.page, '03-share-status')

  const reviewer = await person(browser, { first: 'Rae', last: 'Reviewer', reviewer: true })
  await reviewer.page.goto(ORIGIN + '/admin/library')
  const row = reviewer.page.getByTestId('queue-row').filter({ hasText: title })
  await expect(row).toBeVisible({ timeout: 30000 })
  await expect(row).toContainText('Ada Author')
  await shot(reviewer.page, '04-queue-desktop')
  await openFromQueue(reviewer.page, title)
  const page = reviewer.page
  await shot(page, '05-review-canvas')

  // Owner rule: nothing covers a note or a note's toolbar. The review panel is docked beside the canvas (the canvas
  // resizes around it, as for Ask Slatebox), so no visible note is under it, and the leftmost card's toolbar is whole and clickable.
  await page.waitForTimeout(1500)
  const dock = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="review-panel"]'), pr = p.getBoundingClientRect()
    const cr = document.querySelector('.sb-canvas-page [id]').getBoundingClientRect()
    const under = [...document.querySelectorAll('g[data-node-id]')].map(g => g.getBoundingClientRect())
      .map(r => ({ l: Math.max(r.left, cr.left), r: Math.min(r.right, cr.right), t: Math.max(r.top, cr.top), b: Math.min(r.bottom, cr.bottom) }))
      .filter(r => r.r > r.l && r.b > r.t && r.l < pr.right && r.r > pr.left && r.t < pr.bottom && r.b > pr.top).length
    const leftmost = [...document.querySelectorAll('g[data-node-id]:not([aria-hidden="true"]):not([data-governed="decoration"])')]
      .map(g => ({ id: g.getAttribute('data-node-id'), label: g.getAttribute('aria-label') || '', r: g.getBoundingClientRect() }))
      .filter(n => / in /.test(n.label) && n.r.width > 20 && n.r.left >= cr.left && n.r.right <= cr.right && n.r.top > cr.top + 60 && n.r.bottom < cr.bottom)
      .sort((a, b) => a.r.left - b.r.left)[0]?.id ?? null
    return { position: getComputedStyle(p).position, panelRight: pr.right, canvasLeft: cr.left, under, leftmost }
  })
  expect(dock.position, 'the review panel is not fixed over the canvas').not.toBe('fixed')
  expect(dock.canvasLeft, 'the canvas starts where the review panel ends').toBeGreaterThanOrEqual(dock.panelRight - 1)
  expect(dock.under, 'no note is under the review panel').toBe(0)
  expect(dock.leftmost, 'a card to select').toBeTruthy()
  await page.locator(`g[data-node-id="${dock.leftmost}"]`).first().click()
  const cardBar = page.locator('.sb-style-bar[role="toolbar"]').first()
  await expect(cardBar).toBeVisible({ timeout: 30000 })
  const barBox = await cardBar.boundingBox(), panelBox = await review(page).boundingBox()
  expect(barBox.x >= panelBox.x + panelBox.width - 0.5 || barBox.y >= panelBox.y + panelBox.height, 'the card\'s toolbar is clear of the review panel').toBe(true)
  const topmost = await cardBar.evaluate(t => [...t.querySelectorAll('button')].filter(b => b.offsetWidth)
    .map(b => { const r = b.getBoundingClientRect(); return t.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) }))
  expect(topmost.length > 0 && topmost.every(Boolean), 'every button of the card\'s toolbar can be clicked').toBe(true)
  await shot(page, '05b-review-card-toolbar')
  await page.keyboard.press('Escape')

  // The review chat: a starter; with no AI connected locally, the local grammar ("rename it to …") instead.
  await review(page).getByTestId('refine-starter').filter({ hasText: 'Write a clearer one-line summary' }).click()
  const keepButton = review(page).getByTestId('refine-keep')
  const proposed = await keepButton.first().waitFor({ timeout: 90000 }).then(() => true, () => false)
  let kept = 'ai'
  if (!proposed) {
    kept = 'local'
    const box = review(page).getByRole('textbox', { name: 'Ask for a change' })
    await box.fill(`rename it to ${title} reviewed`)
    await box.press('Enter')
    await keepButton.first().waitFor({ timeout: 60000 })
  }
  await expect(review(page).getByTestId('refine-diff').last()).toBeVisible()
  await shot(page, '06-refine-diff')
  await keepButton.last().click()
  await expect(review(page).getByTestId('refine-kept').last()).toBeVisible({ timeout: 60000 })
  await shot(page, '07-refine-kept')
  test.info().annotations.push({ type: 'refine', description: kept })

  // Move a note on the review canvas: a real pointer drag.
  // A note clear of the review panel (docked left) and of Ask Slatebox (right): a bar on the plan.
  const noteId = await page.evaluate(() => {
    const fits = [...document.querySelectorAll('[data-node-id]')].map(el => ({ id: el.getAttribute('data-node-id'), r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.left > 420 && r.right < 1050 && r.top > 120 && r.bottom < 820 && r.width > 30 && r.width < 400 && r.height < 120)
    return fits.length ? fits[fits.length - 1].id : null
  })
  expect(noteId, 'a note to move').toBeTruthy()
  const note = page.locator(`[data-node-id="${noteId}"]`).first()
  // What the author sent: the submitted version, as the reviewer reads it. The plan is a board: its
  // bars are the board's cards, kept with the slate's boards (slate.creative), not loose notes.
  const submitted = await page.evaluate(async ({ title }) => {
    const queue = await window.Meteor.callAsync('library.review.queue', { status: 'in_review' })
    const item = queue.items.find(row => [row.title, row.pendingMeta?.title].some(t => t?.startsWith(title)))
    const read = await window.Meteor.callAsync('library.get', { itemId: item.id, version: item.pendingVersion })
    return JSON.stringify(read.version.content.slate.creative ?? null)
  }, { title })
  expect(submitted, 'the submitted version has the board').toContain('Launch plan')
  const before = await note.boundingBox()
  await page.mouse.click(1300, 860)
  await page.mouse.move(before.x + Math.min(20, before.width / 2), before.y + before.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 14; i++) await page.mouse.move(before.x + Math.min(20, before.width / 2) + i * 12, before.y + before.height / 2 + i * 8)
  await page.mouse.up()
  await expect.poll(async () => (await page.locator(`[data-node-id="${noteId}"]`).first().boundingBox()).x, { timeout: 15000 }).toBeGreaterThan(before.x + 60)
  await page.waitForTimeout(2500) // the slate saves
  await shot(page, '08-note-moved')

  // Approve and publish.
  await review(page).getByTestId('review-approve').click()
  // Approve publishes the version the author sent, as the review canvas stands: the number said is the stored publishedVersion.
  const confirmDialog = page.getByRole('dialog', { name: /Publish version \d+ for everyone\?/ })
  await expect(confirmDialog).toBeVisible()
  const n = (await confirmDialog.getByRole('heading').innerText()).match(/version (\d+)/)[1]
  await page.getByTestId('decision-confirm').click()
  await expect(review(page).getByTestId('review-done')).toContainText(`Published as version ${n}`, { timeout: 60000 })
  await expect(confirmDialog).toBeHidden()
  await shot(page, '09-approved')

  // Signed out: the public API lists it and answers it with the moved note; the page opens.
  const visitor = await playwright.request.newContext()
  const listed = await api(visitor, `/library?q=${encodeURIComponent(title)}`)
  expect(listed.status).toBe(200)
  expect(listed.headers['cache-control']).toMatch(/public/)
  const found = (listed.body.items || []).find(item => item.title.startsWith(title))
  expect(found, 'the approved slate is in the public list').toBeTruthy()
  const one = await api(visitor, `/library/${found.id}`)
  expect(one.status).toBe(200)
  expect(Number(n)).toBe(1)
  expect(one.body.item.publishedVersion).toBe(Number(n))
  // What is served is that version, as approve left it.
  expect(one.body.version.n).toBe(one.body.item.publishedVersion)
  expect(one.body.thread).toBeUndefined()
  // The bar moved on the review canvas is published as the reviewer left it, not as the author sent it.
  const published = JSON.stringify(one.body.version.content.slate.creative ?? null)
  expect(published).toContain('Launch plan')
  expect(published, 'the published version has the reviewer\'s move').not.toBe(submitted)
  if (kept === 'local') expect(one.body.item.title).toBe(`${title} reviewed`)
  await visitor.dispose()
  const outsider = await browser.newContext({ viewport: DESK })
  const out = await outsider.newPage()
  await out.goto(ORIGIN + `/library/${found.slug}`)
  // The page is public (no sign-in, no Not Found). What it shows is the gallery's (GALLERY slice); on
  // this branch alone it is the foundation's placeholder, so the title is asserted only when it is drawn.
  await expect(out).toHaveURL(new RegExp(`/library/${found.slug}$`), { timeout: 60000 })
  await expect(out.getByText('This page isn’t here')).toHaveCount(0)
  await out.waitForTimeout(3000)
  if (!(await out.getByText('Coming in this release.').count())) await expect(out.locator('body')).toContainText(found.title, { timeout: 60000 })
  await shot(out, '10-public-item')
  await outsider.close()

  // The author hears about it: the share dialog's chip, and My library.
  await author.page.goto(ORIGIN + '/library/mine')
  await expect(author.page.getByTestId('mine-group-published')).toContainText(found.title, { timeout: 30000 })
  await shot(author.page, '11-mine-published')
  expect(author.errors.concat(reviewer.errors)).toEqual([])
  await author.context.close()
  await reviewer.context.close()
})

test('request changes goes to the author with its message, and the resubmission comes back to the queue', async ({ browser }) => {
  const title = `Retro notes ${RUN}`
  const author = await person(browser, { first: 'Ben', last: 'Author' })
  await addBoard(author.page)
  const dialog = await publishSlate(author.page, title, 'What went well, what did not, what to try')
  await dialog.getByTestId('publish-submit').click()
  await expect(author.page.getByTestId('publish-done')).toBeVisible({ timeout: 30000 })

  const reviewer = await person(browser, { first: 'Rae', last: 'Second', reviewer: true })
  await openFromQueue(reviewer.page, title)
  await review(reviewer.page).getByTestId('review-changes').click()
  const confirm = reviewer.page.getByTestId('decision-confirm')
  await expect(confirm).toBeDisabled() // a message is needed
  await reviewer.page.getByTestId('decision-message').fill('Name the columns after your own process, please.')
  await shot(reviewer.page, '12-request-changes')
  await confirm.click()
  await expect(review(reviewer.page).getByTestId('review-done')).toContainText('Sent back to the author', { timeout: 30000 })

  // The author: the bell says it, and My library shows the message and Send again.
  await author.page.goto(ORIGIN + '/library/mine')
  const row = author.page.getByTestId('mine-row').filter({ hasText: title })
  await expect(row.getByTestId('mine-status')).toHaveText('Needs changes', { timeout: 30000 })
  await expect(row.getByTestId('mine-last-message')).toContainText('Name the columns after your own process')
  // Its still, drawn by the one renderer, for the author too.
  await expect(row.getByTestId('library-preview').locator('svg').first()).toBeVisible({ timeout: 30000 })
  await shot(author.page, '13-mine-needs-changes')
  await author.page.goto(author.slate)
  const bell = author.page.getByRole('button', { name: /notification|message/i }).first()
  if (await bell.isVisible().catch(() => false)) {
    await bell.click()
    await expect(author.page.getByText(new RegExp(`${title}.*needs changes|needs changes.*${title}`, 'i')).first()).toBeVisible({ timeout: 30000 })
    await author.page.waitForTimeout(600)
    await shot(author.page, '14-bell')
    await author.page.keyboard.press('Escape')
  }
  await author.page.goto(ORIGIN + '/library/mine')
  await author.page.getByTestId('mine-row').filter({ hasText: title }).getByTestId('mine-submit').click()
  await expect(author.page.getByTestId('mine-row').filter({ hasText: title }).getByTestId('mine-status')).toHaveText('Submitted for review', { timeout: 30000 })

  await reviewer.page.goto(ORIGIN + '/admin/library')
  await expect(reviewer.page.getByTestId('queue-row').filter({ hasText: title })).toBeVisible({ timeout: 30000 })
  expect(author.errors.concat(reviewer.errors)).toEqual([])
  await author.context.close()
  await reviewer.context.close()
})

test('someone who is not an administrator has no queue: no page, and 403 from the API', async ({ browser }) => {
  const someone = await person(browser, { first: 'Cy', last: 'Visitor' })
  await someone.page.goto(ORIGIN + '/admin/library')
  await expect(someone.page.getByTestId('queue-list')).toHaveCount(0)
  // The same refusal over DDP (what the pages call) and over HTTP (what agents call), before anything is read.
  const refused = await someone.page.evaluate(async () => {
    const ddp = await window.Meteor.callAsync('library.review.queue', {}).then(() => 'answered', (error) => String(error.error))
    const http = await fetch('/api/v1/library/review', { headers: { 'x-meteor-token': '' } }).then(r => r.status)
    return { ddp, http }
  })
  expect(refused.ddp).toBe('reviewer_required')
  expect([401, 403]).toContain(refused.http)
  await shot(someone.page, '15-not-admin')
  await someone.context.close()
})

test('the queue page at 390', async ({ browser }) => {
  const reviewer = await person(browser, { first: 'Rae', last: 'Phone', reviewer: true, viewport: { width: 390, height: 844 } })
  await reviewer.page.goto(ORIGIN + '/admin/library')
  await expect(reviewer.page.getByTestId('queue-list')).toBeVisible({ timeout: 30000 })
  const overflow = await reviewer.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await shot(reviewer.page, '16-queue-phone')
  await reviewer.page.getByTestId('queue-tab-published').click()
  await expect(reviewer.page.getByTestId('queue-row').first()).toBeVisible({ timeout: 30000 })
  await shot(reviewer.page, '17-queue-phone-published')
  await reviewer.context.close()
})
