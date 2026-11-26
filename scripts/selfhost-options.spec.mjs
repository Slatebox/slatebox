// The header's Upgrade on a self-hosted install, in a real browser against a real Meteor app and a
// stand-in Slatebox Cloud (scripts/fake-slatebox-cloud.mjs), each person in a fresh context (no
// cookies, no storage). Run by scripts/selfhost-options-e2e.mjs, which starts both and sets:
//   SLATEBOX_ORIGIN    the self-hosted app       SLATEBOX_CLOUD   the stand-in Cloud
//   SLATEBOX_PROMOTE   `<cmd> <userId> admin|member`: makes a guest a signed-in account in team Roscoe
//   SLATEBOX_KEYFILE   the stand-in Cloud's test signing key (to sign a "purchased" key)
//   SLATEBOX_PHASE     selfhost (everything below) or cloud (the same app told it is Slatebox Cloud)
//   SLATEBOX_SHOTS     a folder for screenshots
// selfhost:
//   1. a member sees Upgrade and the same reasons, with Ask your admin in place of every button;
//   2. an administrator sees Upgrade, the two choices and the live preview; a bad or another
//      server's key is refused in words; the free trial (device sign-in approved on Cloud's page in
//      its own window) turns enterprise features on with no reload and lands on Integrations with
//      the catalog live; the header then shows the Enterprise chip;
//   3. a license key pasted in replaces the trial, on at once;
//   4. the move: sign in on Cloud, progress, the counts compared, Make it live, the Cloud link; the
//      team is on Cloud and still here; the banner can be switched on for everyone;
// cloud: a signed-in administrator on Slatebox Cloud never sees Upgrade.
import { execFileSync } from 'node:child_process'
import { createPrivateKey } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { signLicense } from '../web/app/server/enterprise-license.mjs'

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://localhost:3730'
const CLOUD = process.env.SLATEBOX_CLOUD || 'http://127.0.0.1:3741'
const PROMOTE = process.env.SLATEBOX_PROMOTE || ''
const SHOTS = process.env.SLATEBOX_SHOTS || ''
const PHASE = process.env.SLATEBOX_PHASE || 'selfhost'
test.skip(!PROMOTE, 'needs SLATEBOX_PROMOTE (run scripts/selfhost-options-e2e.mjs)')
test.setTimeout(300000)
test.describe.configure({ mode: 'serial' })
test.use({ screenshot: 'only-on-failure', ...(process.env.SLATEBOX_CHROMIUM && { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } }) })

const DESK = { width: 1440, height: 900 }
// After the dialog's opening transition, so a picture never catches it half faded in.
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(450); await page.screenshot({ path: `${SHOTS}/${name}.png` }) } }
const panel = (page) => page.getByTestId('enterprise-options-panel')

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
  test('a member sees Upgrade and the reasons, and is asked to talk to their admin', async ({ browser }) => {
    const { page, context, errors } = await person(browser, 'member')
    const button = page.getByTestId('header-offer')
    await expect(button).toBeVisible({ timeout: 30000 })
    await expect(button).toHaveText('Upgrade')
    await expect(button).toHaveAttribute('data-role', 'member')
    await button.click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).getByTestId('card-unlock')).toContainText('Invite outside agents onto a slate')
    await expect(panel(page).getByTestId('card-move')).toContainText('What moves')
    await expect(panel(page).getByTestId('ask-admin')).toHaveCount(2)
    await expect(panel(page).getByTestId('start-trial')).toHaveCount(0)
    await expect(panel(page).getByTestId('start-move')).toHaveCount(0)
    await expect(panel(page)).not.toContainText(/\$\d|per month|per seat/i)
    await shot(page, '02-member-ask-your-admin')
    expect(errors).toEqual([])
    await context.close()
  })

  test('an admin: Upgrade, the reasons, keys refused in words, then the free trial turns enterprise on live', async ({ browser }) => {
    const { page, context, errors } = await person(browser, 'admin')
    const button = page.getByTestId('header-offer')
    await expect(button).toBeVisible({ timeout: 30000 })
    await expect(button).toHaveAttribute('data-role', 'admin')
    // Locked: no Integrations in the navigation, and its address goes to Profile.
    await expect(page.getByRole('link', { name: 'Integrations' })).toHaveCount(0)
    await shot(page, '01-header-upgrade')
    await button.click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).getByTestId('enterprise-preview')).toContainText('GitHub')
    await expect(panel(page).getByTestId('start-trial')).toHaveText(/Start 30-day free trial/)
    await expect(panel(page).getByTestId('start-move')).toHaveText('Move to Slatebox Cloud')
    await expect(panel(page).getByTestId('compare-plans')).toHaveAttribute('href', 'https://slatebox.com/plans/')
    await expect(panel(page)).toContainText('Single sign-on with Keycloak')
    await shot(page, '03-panel-two-choices')

    // A key that is not one, and a real key for another server: refused, in words.
    await panel(page).getByTestId('paste-key-toggle').click()
    await panel(page).getByTestId('license-key').fill('not-a-key')
    await panel(page).getByTestId('enter-key').click()
    await expect(panel(page).getByTestId('unlock-problem')).toContainText('could not be read')
    const key = JSON.parse(readFileSync(process.env.SLATEBOX_KEYFILE, 'utf8'))
    const elsewhere = await signLicense({ id: 'lic_other', licensee: 'Elsewhere Inc', issuedAt: '2026-01-01', expiresAt: '2099-12-31', hosts: ['boards.elsewhere.test'] }, { kid: key.kid, privateKey: createPrivateKey(key.privateKey) })
    await panel(page).getByTestId('license-key').fill(elsewhere)
    await panel(page).getByTestId('enter-key').click()
    await expect(panel(page).getByTestId('unlock-problem')).toContainText('for another install')

    // The free trial: one click, approve on Cloud, on at once.
    const opened = context.waitForEvent('page')
    await panel(page).getByTestId('start-trial').click()
    await expect(panel(page).getByTestId('cloud-sign-in')).toBeVisible()
    await expect(panel(page).getByTestId('cloud-link')).toHaveAttribute('href', new RegExp(`^${CLOUD}/device\\?code=`))
    await shot(page, '04-trial-sign-in-code')
    await approveOnCloud(context, page, opened)
    // No reload: the page lands on Integrations with the catalog live.
    await page.waitForURL(/\/integrations/, { timeout: 60000 })
    await expect(page.locator('[data-integrations-route]')).toBeVisible()
    // The gallery opens on arrival: the catalog, live.
    await expect(page.getByRole('dialog')).toContainText('GitHub', { timeout: 30000 })
    await expect(page.getByRole('dialog')).toContainText('Linear')
    expect(await page.evaluate(() => window.Meteor.settings.public.enterprise)).toMatchObject({ unlocked: true, via: 'license' })
    await shot(page, '05-trial-unlocked-integrations')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Integrations' }).first()).toBeVisible()
    await expect(page.getByTestId('header-enterprise')).toBeVisible()
    await expect(page.getByTestId('header-offer')).toHaveCount(0)
    // A fresh page load (a new context) is told by the server it is unlocked.
    const fresh = await browser.newContext({ viewport: DESK })
    const freshPage = await fresh.newPage()
    await freshPage.goto(ORIGIN + '/')
    expect(await freshPage.evaluate(() => window.Meteor.settings.public.enterprise?.unlocked)).toBe(true)
    await fresh.close()
    expect(errors.filter((text) => !/ResizeObserver/.test(text))).toEqual([])
    await context.close()
  })

  test('a license key pasted in replaces the trial and is on at once', async ({ browser }) => {
    const { page, context } = await person(browser, 'admin')
    await page.getByTestId('header-enterprise').click()
    await expect(panel(page).getByTestId('unlocked-state')).toContainText('free trial')
    const key = JSON.parse(readFileSync(process.env.SLATEBOX_KEYFILE, 'utf8'))
    const bought = await signLicense({ id: 'lic_roscoe', licensee: 'Roscoe LLC', issuedAt: '2026-01-01', expiresAt: '2027-12-31', hosts: ['localhost'] }, { kid: key.kid, privateKey: createPrivateKey(key.privateKey) })
    await panel(page).getByTestId('paste-key-toggle').click()
    await panel(page).getByTestId('license-key').fill(bought)
    await panel(page).getByTestId('enter-key').click()
    await page.waitForURL(/\/integrations/, { timeout: 30000 })
    await expect(page.getByRole('dialog')).toContainText('GitHub', { timeout: 30000 })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByTestId('header-enterprise').click()
    await expect(panel(page).getByTestId('unlocked-state')).toContainText('licensed to Roscoe LLC until 2027-12-31')
    await shot(page, '06-license-key-entered')
    await context.close()
  })

  test('the move: sign in on Cloud, progress, counts compared, live on Make it live, the Cloud link', async ({ browser }) => {
    const { page, context, errors } = await person(browser, 'admin')
    await page.getByTestId('header-enterprise').click()
    await expect(panel(page).getByTestId('move-team')).toContainText('Roscoe')
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
  test('on Slatebox Cloud, nobody sees Upgrade', async ({ browser }) => {
    const { page, context } = await person(browser, 'admin')
    await expect(page.locator('header, .MuiAppBar-root').first()).toBeVisible()
    await page.waitForTimeout(3000)
    await expect(page.getByTestId('header-offer')).toHaveCount(0)
    await expect(page.getByTestId('header-enterprise')).toHaveCount(0)
    await shot(page, '11-cloud-no-upgrade')
    await context.close()
  })
}
