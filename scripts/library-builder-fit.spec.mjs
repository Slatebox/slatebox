// The build bar fits the canvas header at every desktop width (library spec §4.2), as a property over a sweep rather
// than a few hand-picked sizes: on a branched builder slate (the bar's longest words: "Branched from Retro (Meetings)"),
// for a guest (whose header also holds "Save your work") and for a signed-in person, with Ask Slatebox open and closed,
// with a slate name and an item name each 5, 18, 40 and 60 characters long, at every width from 1024 to 1920 in steps
// of 16. At each one: nothing overflows the header or lies outside it, no two of its items overlap, every button reads
// whole, the slate's name and both lines of the bar are whole or cut no narrower than 96px (never squeezed to nothing),
// the bar is never the one Builder button, and Save, Submit (and a guest's Save your work, by its name) are there.
//
// Against a running app, in a fresh session:
//   SLATEBOX_ORIGIN=http://127.0.0.1:3610 npx playwright test -c scripts/playwright.config.mjs library-builder-fit.spec.mjs
// SLATEBOX_PROMOTE names a command that turns the guest whose id it is given into a signed-in account on that local app
// (a local database only); without it the signed-in half is skipped. SLATEBOX_SHOTS is a folder for screenshots.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3610'
const SHOTS = process.env.SLATEBOX_SHOTS || ''
const PROMOTE = process.env.SLATEBOX_PROMOTE || ''
const MIN = 96
const WIDTHS = Array.from({ length: (1920 - 1024) / 16 + 1 }, (_, i) => 1024 + i * 16)
const LENGTHS = [5, 18, 40, 60]
test.setTimeout(1800000)
test.use({ ...(process.env.SLATEBOX_CHROMIUM && { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } }) })

const panel = page => page.locator('aside[aria-label="Ask Slatebox"]')
const bar = page => page.locator('[data-build-bar]')
const run = Math.random().toString(36).slice(2, 6)
// A name exactly `length` characters long, in words, ending in this run's mark (no trailing space).
const WORDS = 'Quarterly roadmap impact and effort review for the platform team with partners and customers'
const named = (length, kind) => {
  const tail = `${kind}${run}`
  if (length <= tail.length) return tail.slice(-length)
  return `${WORDS.slice(0, length - tail.length - 1).trimEnd().padEnd(length - tail.length - 1, 'x')} ${tail}`
}

async function setAsk(page, open) {
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 1000 }).catch(() => {})
  const now = await panel(page).isVisible().catch(() => false)
  if (open && !now) await page.locator('[data-conversation-toggle]').first().click()
  if (!open && now) await panel(page).getByRole('button', { name: 'Close conversation' }).click()
  await expect(panel(page)).toBeVisible({ visible: open })
}

async function rename(page, name) {
  await page.locator('.sb-board-title').click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const box = page.getByRole('textbox', { name: 'Slate name' })
  await box.fill(name)
  await box.press('Enter')
  await expect(page.locator('.sb-board-title strong')).toHaveText(name, { timeout: 30000 })
}

async function saveAs(page, name) {
  await bar(page).getByRole('button', { name: 'Save', exact: true }).click()
  const sheet = page.locator('[data-build-sheet="save"]')
  await expect(sheet).toBeVisible()
  await sheet.getByLabel('Name').fill(name)
  const line = sheet.getByLabel('What it does, in one line')
  if (!(await line.inputValue())) await line.fill('Went well, change, try, and a vote')
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(sheet).toBeHidden({ timeout: 30000 })
  await expect(bar(page).locator('[data-build-title]')).toHaveText(name, { timeout: 30000 })
}

// Everything wrong with the header as it stands now (an empty list when it fits).
function headerFaults({ min, guest }) {
  const faults = []
  const t = document.querySelector('.sb-board-toolbar')
  const tr = t.getBoundingClientRect()
  if (t.scrollWidth > t.clientWidth + 1) faults.push(`header overflows (${t.scrollWidth} > ${t.clientWidth})`)
  const said = e => (e.getAttribute('aria-label') || e.innerText || e.className || e.tagName).toString().replace(/\s+/g, ' ').slice(0, 40)
  const items = [...t.querySelectorAll(':scope > *, :scope > .sb-board-builder > *, .sb-board-name > *')]
    .filter(e => getComputedStyle(e).display !== 'contents' && !['absolute', 'fixed'].includes(getComputedStyle(e).position))
    .map(e => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width > 0 && r.height > 0)
  for (const { e, r } of items) if (r.left < tr.left - 0.5 || r.right > tr.right + 0.5) faults.push(`${said(e)} lies outside the header [${Math.round(r.left)}, ${Math.round(r.right)}]`)
  const row = items.filter(({ e }) => e.parentElement === t || e.parentElement?.classList.contains('sb-board-builder')).sort((a, b) => a.r.left - b.r.left)
  for (let i = 1; i < row.length; i++) if (row[i].r.left < row[i - 1].r.right - 0.5) faults.push(`${said(row[i].e)} overlaps ${said(row[i - 1].e)}`)
  const cut = e => e.scrollWidth > e.clientWidth + 1
  const name = t.querySelector('.sb-board-title strong')
  if (!name) faults.push('no slate name')
  else if (cut(name) && name.clientWidth < min) faults.push(`slate name cut to ${name.clientWidth}px`)
  const stands = t.querySelector('[data-build-line="stands"]'), item = t.querySelector('[data-build-line="name"]')
  if (!stands || !item) faults.push('the bar has no lines')
  else {
    if (cut(stands)) faults.push(`where it stands is cut ("${stands.innerText}", ${stands.clientWidth}px)`)
    if (cut(item) && item.clientWidth < min) faults.push(`item name cut to ${item.clientWidth}px`)
  }
  const buttons = [...t.querySelectorAll('button, a[role="button"]')].filter(b => b.offsetWidth && !b.hasAttribute('data-build-summary'))
  for (const b of buttons) if (cut(b) || b.clientWidth < 24) faults.push(`button ${said(b)} is cut (${b.clientWidth}px)`)
  const named = label => buttons.find(b => (b.getAttribute('aria-label') || b.innerText.trim()) === label)
  if (named('Builder')) faults.push('the bar folded to the Builder button')
  if (!named('Save')) faults.push('no Save')
  if (!buttons.some(b => /^Submit to the library$/.test(b.getAttribute('aria-label') || b.innerText.trim()))) faults.push('no Submit to the library')
  if (guest && !named('Save your work')) faults.push('no Save your work')
  return faults
}

async function sweep(page, who, faults) {
  for (const length of LENGTHS) {
    await rename(page, named(length, 's'))
    await saveAs(page, named(length, 'i'))
    for (const open of [false, true]) {
      await page.setViewportSize({ width: 1440, height: 900 })
      await setAsk(page, open)
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        // A resize is measured on the next frames: two frames, then a short settle for the header's observers.
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
        await page.waitForTimeout(120)
        const found = await page.evaluate(headerFaults, { min: MIN, guest: who === 'guest' })
        if (found.length) {
          faults.push(`${who} ask ${open ? 'open' : 'closed'} names ${length} at ${width}: ${found.join('; ')}`)
          console.log(faults.at(-1))
          if (SHOTS) await page.screenshot({ path: `${SHOTS}/fit-${who}-${open ? 'ask' : 'noask'}-${length}-${width}.png`, clip: { x: 0, y: 0, width, height: 64 } })
        }
      }
    }
  }
}

test('the build bar fits the header from 1024 to 1920 wide, guest and signed in, Ask open and closed, names of 5 to 60 characters', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(ORIGIN + '/new#build=builtin-retro')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
  expect(await page.evaluate(() => window.Meteor?.user()?.isAnonymous ?? true), 'a fresh guest').toBe(true)
  await expect(bar(page)).toContainText('Branched from Retro (Meetings)', { timeout: 60000 })
  const faults = []
  await sweep(page, 'guest', faults)
  if (PROMOTE) {
    execFileSync(PROMOTE, [await page.evaluate(() => Meteor.userId()), 'Fay', 'Fitter'])
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.reload()
    await expect(bar(page)).toBeVisible({ timeout: 60000 })
    await expect(page.getByRole('button', { name: 'Save your work' })).toHaveCount(0, { timeout: 30000 })
    await sweep(page, 'signed-in', faults)
  }
  expect(faults, `${faults.length} header faults`).toEqual([])
  expect(errors).toEqual([])
  await context.close()
})
