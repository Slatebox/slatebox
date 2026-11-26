#!/usr/bin/env node
// The owner's exact words, end to end in a fresh browser on a running app (owner report 2026-11-25, test.slatebox.com:
// "snappable congruent pieces to compose new printable materials" typed into Ask Slatebox on /new#build answered
// "Slatebox couldn't make that change: Operation 1 count must be an integer from 1 to 20. ..." with an empty canvas).
//
// Twice, each in a fresh browser context (no cookies, no stored login):
//   signed-in  a new account (made over DDP, its login handed to the page as Meteor resumes one): /new#build, the
//              words typed, the agent's draft previewed, Keep, then Save: the component is in Add to this slate › Yours;
//   guest      a visitor: /new#build makes a guest, the same words start the board from the words, Keep.
// Screenshots of each step go to --shots. Fails (exit 1) on any "Operation N" text, a page error, or a step that
// does not arrive.
//
//   node scripts/evals/smart-components/owner-e2e.mjs --origin http://127.0.0.1:3660 --shots <dir> [--mongo <url>]
// SLATEBOX_CHROMIUM names a Chromium executable. --mongo removes the account and its slates afterwards.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { DDP } from './ddp.mjs'

const { values: args } = parseArgs({ options: {
  origin: { type: 'string', default: process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3660' },
  shots: { type: 'string', default: '' },
  mongo: { type: 'string', default: process.env.SLATEBOX_MONGO || '' },
  message: { type: 'string', default: 'snappable congruent pieces to compose new printable materials' },
} })
if (args.shots) mkdirSync(args.shots, { recursive: true })
const OWNER = args.message
const browser = await chromium.launch({ ...(process.env.SLATEBOX_CHROMIUM && { executablePath: process.env.SLATEBOX_CHROMIUM }) })
const report = {}
const made = []

const panel = (page) => page.locator('aside[aria-label="Ask Slatebox"]')
const shot = async (page, name) => { if (args.shots) await page.screenshot({ path: join(args.shots, name + '.png') }) }
async function until(what, check, ms = 90000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check().catch(() => false)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('never arrived: ' + what)
}

async function run(name, login) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  if (login) await context.addInitScript(({ token, userId }) => {
    localStorage.setItem('Meteor.loginToken', token)
    localStorage.setItem('Meteor.loginTokenExpires', new Date(Date.now() + 864e5).toString())
    localStorage.setItem('Meteor.userId', userId)
  }, login)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const out = { steps: [] }
  try {
    await page.goto(args.origin + '/new#build', { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
    out.shareId = page.url().split('/').pop()
    out.anonymous = await page.evaluate(() => window.Meteor?.user()?.isAnonymous ?? null)
    await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {})
    if (!(await panel(page).isVisible().catch(() => false))) await page.locator('[data-conversation-toggle]').first().click()
    await until('the Ask Slatebox panel', () => panel(page).isVisible())
    await shot(page, `${name}-1-builder`)
    const box = panel(page).getByRole('textbox', { name: 'Message Slatebox' })
    await box.fill(OWNER)
    const asked = Date.now()
    await box.press('Enter')
    await until('the preview (Keep changes)', () => panel(page).getByRole('button', { name: 'Keep changes' }).isVisible(), 120000)
    out.previewMs = Date.now() - asked
    await page.waitForTimeout(1200)
    out.said = (await panel(page).innerText()).split('\n').find((line) => /from your description/.test(line)) ?? null
    out.steps.push('preview')
    await shot(page, `${name}-2-preview`)
    await panel(page).getByRole('button', { name: 'Keep changes' }).click()
    await until('the kept board', async () => (await page.locator('#slateCanvas [data-board-layer="draft-tag"]').count()) === 0 && (await page.locator('#slateCanvas [data-node-id]').count()) > 4, 60000)
    await page.waitForTimeout(1500)
    out.notes = await page.locator('#slateCanvas [data-node-id]').count()
    out.steps.push('kept')
    await shot(page, `${name}-3-kept`)
    if (login) {
      // Save it as a smart component; then it is in Add to this slate › Yours.
      const bar = page.locator('[data-build-bar]')
      const folded = bar.getByRole('button', { name: 'Builder', exact: true })
      if (await folded.isVisible().catch(() => false)) await folded.click()
      const controls = (await page.locator('[data-build-details]').isVisible().catch(() => false)) ? page.locator('[data-build-details]') : bar
      await controls.getByRole('button', { name: 'Save', exact: true }).click()
      const sheet = page.locator('[data-build-sheet="save"]')
      await until('the save sheet', () => sheet.isVisible())
      await sheet.getByLabel('Name').fill('Printable piece kit')
      await sheet.getByLabel('What it does, in one line').fill('Snap congruent pieces together to compose printable materials')
      await shot(page, `${name}-4-save-sheet`)
      await sheet.getByRole('button', { name: 'Save', exact: true }).click()
      await until('saved', async () => !(await sheet.isVisible()), 30000)
      out.steps.push('saved')
      await page.waitForTimeout(800)
      await shot(page, `${name}-5-saved`)
      await page.goto(args.origin + '/new', { waitUntil: 'domcontentloaded', timeout: 90000 })
      await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
      await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {})
      if (!(await panel(page).isVisible().catch(() => false))) await page.locator('[data-conversation-toggle]').first().click()
      await until('the panel', () => panel(page).isVisible())
      await panel(page).getByRole('button', { name: /See all|Browse/ }).first().click()
      const yours = panel(page).locator('section[aria-label="Yours"]')
      await until('Yours lists the saved component', async () => (await yours.innerText()).includes('Printable piece kit'), 30000)
      out.steps.push('in Yours')
      await shot(page, `${name}-6-yours`)
    }
    const text = await page.locator('body').innerText()
    if (/Operation \d+/.test(text)) throw new Error('an "Operation N" list reached the page')
    if (errors.length) throw new Error('page errors: ' + errors.slice(0, 2).join(' | '))
    out.ok = true
  } catch (error) {
    out.ok = false
    out.error = error.message
    await shot(page, `${name}-x-failed`).catch(() => {})
  } finally {
    await context.close()
  }
  return out
}

const ddp = await new DDP(args.origin).connect()
const stamp = Date.now().toString(36)
await ddp.createAccount(`owner-e2e-${stamp}@eval.example.test`, 'owner-e2e-' + stamp + Math.random().toString(36).slice(2), { firstName: 'Eval', lastName: 'Owner', name: 'Eval Owner' })
made.push(ddp.userId)
report.signedIn = await run('signed-in', { token: ddp.token, userId: ddp.userId })
ddp.close()
report.guest = await run('guest', null)
await browser.close()
if (args.mongo) {
  const ids = [...made]
  try {
    if (report.guest.shareId) {
      const owner = execFileSync('mongosh', ['--quiet', args.mongo, '--eval', `print(db.slates.findOne({shareId:${JSON.stringify(report.guest.shareId)}})?.userId ?? '')`], { encoding: 'utf8' }).trim()
      if (owner) ids.push(owner)
    }
    execFileSync('mongosh', ['--quiet', args.mongo, '--eval', `const ids=${JSON.stringify(ids)}; db.slates.deleteMany({userId:{$in:ids}}); db.libraryItems.deleteMany({authorId:{$in:ids},origin:"user"}); db.users.deleteMany({_id:{$in:ids}})`])
  } catch (error) { console.warn('could not remove the e2e accounts:', error.message) }
}
console.log(JSON.stringify(report, null, 2))
process.exit(report.signedIn.ok && report.guest.ok ? 0 : 1)
