// The header's Move to Cloud on a self-hosted install, in a real browser against a real Meteor app
// and a stand-in Slatebox Cloud (scripts/fake-slatebox-cloud.mjs), each person in a fresh context
// (no cookies, no storage). Run by scripts/selfhost-options-e2e.mjs, which starts both and sets:
//   SLATEBOX_ORIGIN    the self-hosted app       SLATEBOX_CLOUD   the stand-in Cloud
//   SLATEBOX_PROMOTE   `<cmd> <userId> admin|member`: makes a guest a signed-in account in team Roscoe
//   SLATEBOX_HOST      the app's host name (roscoe.test), which this browser maps to this computer
//   SLATEBOX_PHASE     selfhost (everything below) or cloud (the same app told it is Slatebox Cloud)
//   SLATEBOX_SHOTS     a folder for screenshots
// Integrations are free on every install (owner, 2026-11-26), so the header button only moves the team.
// selfhost:
//   1. integrations run on this install with no key, for an administrator and a member alike:
//      Integrations is in the navigation and the gallery opens with the catalog;
//   2. a member sees no Move to Cloud (only an administrator can move a team);
//   3. on phones (360 and 390 wide) the header never overflows: Move to Cloud is an icon with its name;
//   4. an administrator sees Move to Cloud (keyboard: Enter opens, focus stays in the panel, Escape
//      closes and returns focus); the panel offers the move and says staying is free, and never a
//      trial, a license, an upgrade or a price;
//   5. the move: a sign-in cancelled, then signed in on Cloud, progress, the counts compared, Make it
//      live, the Cloud link; the team is on Cloud and still here; the banner can be switched on;
// cloud: a signed-in administrator on Slatebox Cloud never sees Move to Cloud.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://localhost:3730'
const CLOUD = process.env.SLATEBOX_CLOUD || 'http://127.0.0.1:3741'
const PROMOTE = process.env.SLATEBOX_PROMOTE || ''
const SHOTS = process.env.SLATEBOX_SHOTS || ''
const PHASE = process.env.SLATEBOX_PHASE || 'selfhost'
const HOST = process.env.SLATEBOX_HOST || 'roscoe.test'
test.skip(!PROMOTE, 'needs SLATEBOX_PROMOTE (run scripts/selfhost-options-e2e.mjs)')
test.setTimeout(300000)
test.describe.configure({ mode: 'serial' })
test.use({
  screenshot: 'only-on-failure',
  launchOptions: { args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`], ...(process.env.SLATEBOX_CHROMIUM && { executablePath: process.env.SLATEBOX_CHROMIUM }) },
})

// What the panel never says on a self-hosted install.
const NOT_SAID = /trial|licen[cs]e|unlock|upgrade|enterprise features|\bPro\b|\$\d|per month|per seat|price/i

const DESK = { width: 1440, height: 900 }
const PHONES = [{ width: 360, height: 740 }, { width: 390, height: 844 }]
/** Whether an element sits fully inside the window, without scrolling. */
const inView = (locator) => locator.evaluate((el) => {
  const r = el.getBoundingClientRect()
  return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth
})
// After the dialog's opening transition, so a picture never catches it half faded in.
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(450); await page.screenshot({ path: `${SHOTS}/${name}.png` }) } }
const panel = (page) => page.getByTestId('move-to-cloud-panel')

/** A fresh person: a new context, a new guest, made a signed-in admin or member of team Roscoe. */
async function person(browser, role, viewport = DESK) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  // An empty slate (past the first-run chooser): a guest is all that is needed here.
  await page.goto(ORIGIN + '/new?empty=1')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 180000 })
  expect(await page.evaluate(() => window.Meteor?.user()?.isAnonymous ?? true)).toBe(true)
  // A virgin session: no token carried in from anywhere.
  const id = await page.evaluate(() => window.Meteor.userId())
  execFileSync(PROMOTE, [id, role], { stdio: 'inherit' })
  await page.goto(ORIGIN + '/')
  await expect.poll(() => page.evaluate(() => window.Meteor.user()?.isAnonymous === false), { timeout: 30000 }).toBe(true)
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {})
  return { context, page, errors, id }
}

/** Approves the device sign-in on the stand-in Cloud's page, in the window the panel opened. */
async function approveOnCloud(context, page, opened) {
  const code = (await panel(page).getByTestId('cloud-user-code').first().textContent()).trim()
  const popup = await opened
  await popup.waitForURL(new RegExp(`^${CLOUD.replace(/[.:/]/g, '\\$&')}/device\\?code=`), { timeout: 30000 })
  await expect(popup.locator('[data-code]')).toHaveText(code)
  await popup.getByRole('button', { name: 'Approve' }).click()
  await expect(popup.locator('[data-decided="approved"]')).toBeVisible()
  await popup.close()
  return code
}

if (PHASE === 'selfhost') {
  test('integrations run here with no key: Integrations is in the navigation and the gallery opens, for anyone signed in', async ({ browser }) => {
    for (const role of ['member', 'admin']) {
      const { page, context, errors } = await person(browser, role)
      expect(await page.evaluate(() => window.Meteor.settings.public.enterprise)).toMatchObject({ unlocked: true, via: 'self-host', features: ['agents.invite'] })
      await expect(page.getByRole('link', { name: 'Integrations' }).first()).toBeVisible({ timeout: 30000 })
      await page.goto(ORIGIN + '/integrations')
      await expect(page.locator('[data-integrations-page]')).toBeVisible({ timeout: 30000 })
      await expect(page.locator('[data-integrations-page]')).not.toContainText(/Slatebox Pro|Business|licen[cs]e|plans/i)
      await page.locator('[data-integrations-connect]').click()
      await expect(page.getByRole('dialog')).toContainText('GitHub', { timeout: 30000 })
      await expect(page.getByRole('dialog')).toContainText('Linear')
      await expect(page.getByRole('dialog')).not.toContainText(/Needs Slatebox|Slatebox Pro/)
      await shot(page, `01-integrations-${role}`)
      expect(errors.filter((text) => !/ResizeObserver/.test(text))).toEqual([])
      await context.close()
    }
  })

  test('a member sees no Move to Cloud: only an administrator can move a team', async ({ browser }) => {
    const { page, context } = await person(browser, 'member')
    await expect(page.getByRole('link', { name: 'Integrations' }).first()).toBeVisible({ timeout: 30000 })
    await page.waitForTimeout(2000)
    await expect(page.getByTestId('header-move-to-cloud')).toHaveCount(0)
    await context.close()
  })

  test('on phones the header never overflows: Move to Cloud is an icon with its name', async ({ browser }) => {
    for (const viewport of PHONES) {
      const { page, context } = await person(browser, 'admin', viewport)
      const button = page.getByTestId('header-move-to-cloud')
      await expect(button).toBeVisible({ timeout: 30000 })
      await expect(button).toHaveAccessibleName('Move to Cloud')
      await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible()
      const fits = await page.evaluate(() => {
        const bar = document.querySelector('.MuiAppBar-root .MuiToolbar-root')
        return { page: document.documentElement.scrollWidth <= window.innerWidth, bar: bar.scrollWidth <= bar.clientWidth, right: [...bar.children].every((el) => el.getBoundingClientRect().right <= window.innerWidth) }
      })
      expect(fits, `admin at ${viewport.width}`).toEqual({ page: true, bar: true, right: true })
      if (viewport.width === 360) {
        await shot(page, '02-phone-header')
        await button.click()
        await expect(panel(page)).toBeVisible()
        await panel(page).getByTestId('start-move').scrollIntoViewIfNeeded()
        await expect(panel(page).getByTestId('start-move')).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await shot(page, '03-phone-panel')
      }
      await context.close()
    }
  })

  test('an admin: Move to Cloud, by keyboard too; the panel offers the move, says staying is free, and sells nothing', async ({ browser }) => {
    const { page, context, errors } = await person(browser, 'admin')
    const button = page.getByTestId('header-move-to-cloud')
    await expect(button).toBeVisible({ timeout: 30000 })
    await expect(button).toHaveText('Move to Cloud')
    await shot(page, '04-header-move-to-cloud')
    // The keyboard: Enter opens, focus moves in and stays in, Escape closes and gives focus back.
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(panel(page)).toBeVisible()
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expect(button).toBeFocused()
    await button.click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page)).toContainText('Move to Cloud')
    await expect(panel(page).getByTestId('start-move')).toHaveText('Move to Slatebox Cloud')
    await expect(panel(page).getByTestId('free-here')).toContainText('integrations')
    await expect(panel(page).getByTestId('move-what-you-get')).toContainText('no Daily account to set up')
    await expect(panel(page).getByTestId('compare-link')).toHaveAttribute('href', 'https://slatebox.com/plans/#compare')
    await expect(panel(page)).not.toContainText(NOT_SAID)
    for (const id of ['start-move', 'free-here']) expect(await inView(panel(page).getByTestId(id)), id).toBe(true)
    await shot(page, '05-panel-move')
    expect(errors.filter((text) => !/ResizeObserver/.test(text))).toEqual([])
    await context.close()
  })

  test('the move: sign in on Cloud, progress, counts compared, live on Make it live, the Cloud link', async ({ browser }) => {
    const { page, context, errors } = await person(browser, 'admin')
    await page.getByTestId('header-move-to-cloud').click()
    await expect(panel(page).getByTestId('move-team')).toContainText('Roscoe')
    // Signed in to the wrong account, say: Cancel, and Move is there again.
    await panel(page).getByTestId('start-move').click()
    await expect(panel(page).getByTestId('cloud-sign-in')).toBeVisible()
    await panel(page).getByTestId('cloud-cancel').click()
    await expect(panel(page).getByTestId('move-flow')).toHaveAttribute('data-state', 'cancelled')
    await expect(panel(page).getByTestId('start-move')).toBeVisible()
    for (const popup of context.pages().filter((p) => p !== page)) await popup.close()
    const opened = context.waitForEvent('page')
    await panel(page).getByTestId('start-move').click()
    await expect(panel(page).getByTestId('cloud-sign-in')).toBeVisible()
    await shot(page, '07-move-sign-in')
    await approveOnCloud(context, page, opened)
    const flow = panel(page).getByTestId('move-flow')
    await expect(flow).toHaveAttribute('data-state', /exporting|uploading|review/, { timeout: 30000 })
    if (['exporting', 'uploading'].includes(await flow.getAttribute('data-state'))) if (SHOTS) await page.screenshot({ path: `${SHOTS}/07b-move-progress.png` }).catch(() => {})
    await expect(panel(page).getByTestId('move-review')).toBeVisible({ timeout: 120000 })
    await expect(panel(page).getByTestId('move-verify')).toHaveAttribute('data-ok', 'true')
    await shot(page, '08-move-review-counts')
    const cloudBefore = await (await fetch(CLOUD + '/__state')).json()
    expect(cloudBefore.teams.every((team) => team.hidden)).toBe(true)
    await panel(page).getByTestId('move-confirm').click()
    await expect(panel(page).getByTestId('move-done')).toBeVisible({ timeout: 60000 })
    await expect(panel(page).getByTestId('open-cloud-team')).toHaveAttribute('href', `${CLOUD}/`)
    await panel(page).getByTestId('moved-banner-toggle').check()
    await expect(panel(page).getByTestId('card-move')).not.toContainText('for this move only')
    // The header now says where the team is, and still opens the panel (the banner switch).
    await expect(page.getByTestId('header-move-to-cloud')).toHaveText('On Slatebox Cloud', { timeout: 30000 })
    await shot(page, '09-move-success')
    const cloudAfter = await (await fetch(CLOUD + '/__state')).json()
    const team = cloudAfter.teams.find((row) => !row.hidden)
    expect(team.name).toBe('Roscoe')
    expect(cloudAfter.slates.filter((slate) => slate.orgId === team._id).length).toBeGreaterThan(0)
    // Everyone here sees where the team works now; nothing here was removed.
    const member = await person(browser, 'member')
    await expect(member.page.getByTestId('moved-banner')).toContainText('moved to Slatebox Cloud', { timeout: 30000 })
    await shot(member.page, '10-moved-banner')
    await member.context.close()
    expect(errors.filter((text) => !/ResizeObserver/.test(text))).toEqual([])
    await context.close()
  })

}

if (PHASE === 'cloud') {
  test('on Slatebox Cloud, nobody sees Move to Cloud', async ({ browser }) => {
    const { page, context } = await person(browser, 'admin')
    await expect(page.locator('header, .MuiAppBar-root').first()).toBeVisible()
    await page.waitForTimeout(3000)
    await expect(page.getByTestId('header-move-to-cloud')).toHaveCount(0)
    await shot(page, '11-cloud-no-move')
    await context.close()
  })
}
