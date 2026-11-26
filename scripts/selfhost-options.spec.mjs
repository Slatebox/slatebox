// The header's Upgrade on a self-hosted install, in a real browser against a real Meteor app and a
// stand-in Slatebox Cloud (scripts/fake-slatebox-cloud.mjs), each person in a fresh context (no
// cookies, no storage). Run by scripts/selfhost-options-e2e.mjs, which starts both and sets:
//   SLATEBOX_ORIGIN    the self-hosted app       SLATEBOX_CLOUD   the stand-in Cloud
//   SLATEBOX_PROMOTE   `<cmd> <userId> admin|member`: makes a guest a signed-in account in team Roscoe
//   SLATEBOX_KEYFILE   the stand-in Cloud's test signing key (to sign a "purchased" key)
//   SLATEBOX_HOST      the app's host name (roscoe.test), which this browser maps to this computer
//   SLATEBOX_PHASE     selfhost (everything below), expired (the same app with an ended trial key in
//                      its settings) or cloud (the same app told it is Slatebox Cloud)
//   SLATEBOX_SHOTS     a folder for screenshots
// selfhost:
//   1. a member sees a quiet Enterprise entry (not the gold Upgrade) and the same reasons, with Ask
//      your admin in place of every button, the Move card included;
//   2. on phones (360 and 390 wide) the header never overflows: each entry is an icon with its name;
//   3. an administrator sees Upgrade (keyboard: Enter opens, focus stays in the panel, Escape closes
//      and returns focus), the two choices and the live preview, all in view at 1440x900; an
//      unreachable Cloud and a Cloud without trials are explained, leading with Get a license and
//      no trial button; a bad or another server's key is refused in words; a blocked window is said
//      and the sign-in can be cancelled; the free trial (device sign-in approved on Cloud's page in
//      its own window, the host proven to Cloud) turns enterprise features on with no reload and
//      lands on Integrations with the catalog live; the header then shows a readable Enterprise
//      chip, and the panel confirms instead of selling, with Open Integrations;
//   4. a license key pasted in replaces the trial, on at once;
//   5. the move: a sign-in cancelled, then signed in on Cloud, progress, the counts compared, Make it
//      live, the Cloud link; the team is on Cloud and still here; the banner can be switched on;
//   6. a license in its grace days: the Renew chip, and the panel says when it ended and when
//      features turn off;
// expired: the admin's button says Renew; the panel says the trial ended, leads with Get a license
//   and the pasted key, and offers no trial again;
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
const HOST = process.env.SLATEBOX_HOST || 'roscoe.test'
test.skip(!PROMOTE, 'needs SLATEBOX_PROMOTE (run scripts/selfhost-options-e2e.mjs)')
test.setTimeout(300000)
test.describe.configure({ mode: 'serial' })
test.use({
  screenshot: 'only-on-failure',
  launchOptions: { args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`], ...(process.env.SLATEBOX_CHROMIUM && { executablePath: process.env.SLATEBOX_CHROMIUM }) },
})

const DESK = { width: 1440, height: 900 }
const PHONES = [{ width: 360, height: 740 }, { width: 390, height: 844 }]
const cloudMode = (mode) => fetch(CLOUD + '/__control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) })
const testKey = () => {
  const key = JSON.parse(readFileSync(process.env.SLATEBOX_KEYFILE, 'utf8'))
  return { kid: key.kid, privateKey: createPrivateKey(key.privateKey) }
}
const ymd = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
/** Whether an element sits fully inside the window, without scrolling. */
const inView = (locator) => locator.evaluate((el) => {
  const r = el.getBoundingClientRect()
  return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth
})
/** The text's contrast with its own background (WCAG). */
const contrast = (locator) => locator.evaluate((el) => {
  const rgb = (text) => text.match(/[\d.]+/g).slice(0, 3).map(Number)
  const lum = ([r, g, b]) => {
    const c = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const style = getComputedStyle(el)
  let node = el
  let bg = style.backgroundColor
  while (node && (/rgba\(.*, 0\)$/.test(bg) || bg === 'transparent')) { node = node.parentElement; bg = node ? getComputedStyle(node).backgroundColor : 'rgb(255,255,255)' }
  const [a, b] = [lum(rgb(style.color)), lum(rgb(bg))].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
})
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
  test('a member sees a quiet Enterprise entry and the reasons, and is asked to talk to their admin', async ({ browser }) => {
    const { page, context, errors } = await person(browser, 'member')
    const button = page.getByTestId('header-offer')
    await expect(button).toBeVisible({ timeout: 30000 })
    // Not the gold Upgrade: they cannot act on it.
    await expect(button).toHaveText('Enterprise')
    await expect(button).toHaveAttribute('data-role', 'member')
    expect(await button.evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
    await button.click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).getByTestId('card-unlock')).toContainText('Invite outside agents onto a slate')
    await expect(panel(page).getByTestId('card-move')).toContainText('What moves')
    await expect(panel(page).getByTestId('ask-admin')).toHaveCount(2)
    await expect(panel(page).getByTestId('card-move').getByTestId('ask-admin')).toContainText('move the team to Slatebox Cloud')
    await expect(panel(page).getByTestId('card-move').getByTestId('move-flow')).toHaveCount(0)
    await expect(panel(page).getByTestId('start-trial')).toHaveCount(0)
    await expect(panel(page).getByTestId('start-move')).toHaveCount(0)
    await expect(panel(page)).not.toContainText(/\$\d|per month|per seat/i)
    await shot(page, '02-member-ask-your-admin')
    expect(errors).toEqual([])
    await context.close()
  })

  test('on phones the header never overflows: each entry is an icon with its name', async ({ browser }) => {
    for (const role of ['member', 'admin']) {
      for (const viewport of PHONES) {
        const { page, context } = await person(browser, role, viewport)
        const button = page.getByTestId('header-offer')
        await expect(button).toBeVisible({ timeout: 30000 })
        await expect(button).toHaveAccessibleName(role === 'admin' ? 'Upgrade' : 'Enterprise features')
        await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible()
        const fits = await page.evaluate(() => {
          const bar = document.querySelector('.MuiAppBar-root .MuiToolbar-root')
          return { page: document.documentElement.scrollWidth <= window.innerWidth, bar: bar.scrollWidth <= bar.clientWidth, right: [...bar.children].every((el) => el.getBoundingClientRect().right <= window.innerWidth) }
        })
        expect(fits, `${role} at ${viewport.width}`).toEqual({ page: true, bar: true, right: true })
        if (role === 'admin' && viewport.width === 360) {
          await shot(page, '01b-phone-header')
          await button.click()
          await expect(panel(page)).toBeVisible()
          await expect(panel(page).getByTestId('start-trial')).toBeVisible({ timeout: 15000 })
          await panel(page).getByTestId('start-move').scrollIntoViewIfNeeded()
          await expect(panel(page).getByTestId('start-move')).toBeVisible()
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
          await shot(page, '01c-phone-panel')
        }
        await context.close()
      }
    }
  })

  test('an admin: Upgrade, the reasons, Cloud down or without trials explained, keys refused in words, then the free trial turns enterprise on live', async ({ browser }) => {
    const { page, context, errors } = await person(browser, 'admin')
    const button = page.getByTestId('header-offer')
    await expect(button).toBeVisible({ timeout: 30000 })
    await expect(button).toHaveAttribute('data-role', 'admin')
    await expect(button).toHaveText('Upgrade')
    // Locked: no Integrations in the navigation, and its address goes to Profile.
    await expect(page.getByRole('link', { name: 'Integrations' })).toHaveCount(0)
    await shot(page, '01-header-upgrade')
    // The keyboard: Enter opens, focus moves in and stays in, Escape closes and gives focus back.
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(panel(page)).toBeVisible()
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expect(button).toBeFocused()
    await button.click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).getByTestId('enterprise-preview')).toContainText('GitHub')
    // The length Cloud says (its trialDays), once Cloud has said it offers trials.
    await expect(panel(page).getByTestId('start-trial')).toHaveText('Start 30-day free trial', { timeout: 15000 })
    await expect(panel(page).getByTestId('start-move')).toHaveText('Move to Slatebox Cloud')
    await expect(panel(page).getByTestId('compare-plans')).toHaveAttribute('href', 'https://slatebox.com/plans/')
    await expect(panel(page)).toContainText('Single sign-on with Keycloak')
    // Everything to decide with is in view on a laptop, no scrolling.
    for (const id of ['start-trial', 'get-license', 'paste-key-toggle', 'free-everywhere', 'compare-plans', 'start-move']) expect(await inView(panel(page).getByTestId(id)), id).toBe(true)
    // The preview's proposal is not drawn as a button nobody can press.
    await expect(panel(page).getByTestId('enterprise-preview').getByRole('button')).toHaveCount(0)
    await shot(page, '03-panel-two-choices')

    // Slatebox Cloud unreachable from this server: said in words an admin can act on, no trial button.
    await page.keyboard.press('Escape')
    await cloudMode('down')
    await button.click()
    const note = panel(page).getByTestId('cloud-offer-note')
    await expect(note).toHaveAttribute('data-reason', 'unreachable', { timeout: 15000 })
    await expect(note).toContainText('outbound https')
    await expect(note).toContainText('I have a license key')
    await expect(note).not.toContainText(/ECONN|ENOTFOUND|UND_ERR/)
    await expect(panel(page).getByTestId('start-trial')).toHaveCount(0)
    await expect(panel(page).getByTestId('get-license-button')).toBeVisible()
    await expect(panel(page).getByTestId('paste-key-button')).toBeVisible()
    await shot(page, '03b-cloud-unreachable')
    // Cloud up but issuing no trials (no signing key yet, as today): Get a license leads.
    await cloudMode('no-trials')
    await panel(page).getByTestId('cloud-offer-retry').click()
    await expect(note).toHaveAttribute('data-reason', 'not_offered', { timeout: 15000 })
    await expect(panel(page).getByTestId('start-trial')).toHaveCount(0)
    await expect(panel(page).getByTestId('get-license-button')).toHaveAttribute('href', /slatebox\.com/)
    await cloudMode('up')
    await page.keyboard.press('Escape')
    await button.click()
    await expect(panel(page).getByTestId('start-trial')).toBeVisible({ timeout: 15000 })

    // A key that is not one, and a real key for another server: refused, in words.
    await panel(page).getByTestId('paste-key-toggle').click()
    await panel(page).getByTestId('license-key').fill('not-a-key')
    await panel(page).getByTestId('enter-key').click()
    await expect(panel(page).getByTestId('unlock-problem')).toContainText('could not be read')
    const elsewhere = await signLicense({ id: 'lic_other', licensee: 'Elsewhere Inc', issuedAt: '2026-01-01', expiresAt: '2099-12-31', hosts: ['boards.elsewhere.test'] }, testKey())
    await panel(page).getByTestId('license-key').fill(elsewhere)
    await panel(page).getByTestId('enter-key').click()
    await expect(panel(page).getByTestId('unlock-problem')).toContainText('for another install')

    // A browser that blocks the window: said so, with the link for here or another device; and a
    // sign-in nobody will finish is cancelled, with Start at hand again.
    await page.evaluate(() => { window.__open = window.open; window.open = () => null })
    await panel(page).getByTestId('start-trial').click()
    await expect(panel(page).getByTestId('popup-blocked')).toBeVisible()
    await expect(panel(page).getByTestId('cloud-link')).toHaveAttribute('href', new RegExp(`^${CLOUD}/device\\?code=`))
    await shot(page, '04a-popup-blocked')
    await panel(page).getByTestId('cloud-cancel').click()
    await expect(panel(page).getByTestId('cloud-sign-in')).toHaveCount(0)
    await expect(panel(page).getByTestId('start-trial')).toBeVisible()
    await page.evaluate(() => { window.open = window.__open })

    // The free trial: one click, approve on Cloud (which checks this server answers at its host), on at once.
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
    const chip = page.getByTestId('header-enterprise')
    await expect(chip).toBeVisible()
    await expect(page.getByTestId('header-offer')).toHaveCount(0)
    expect(await contrast(chip), 'the Enterprise chip reads at WCAG AA').toBeGreaterThanOrEqual(4.5)
    // The panel now confirms, and opens Integrations, instead of selling.
    await chip.click()
    const card = panel(page).getByTestId('card-unlock')
    await expect(card).toContainText('Enterprise features are on')
    await expect(card).not.toContainText('Unlock enterprise, stay on your servers')
    await expect(card.getByTestId('enterprise-preview')).toHaveCount(0)
    await expect(card.getByTestId('unlocked-state')).toContainText('free trial')
    await shot(page, '05b-unlocked-panel')
    await card.getByTestId('open-integrations').click()
    await expect(panel(page)).toHaveCount(0)
    await page.waitForURL(/\/integrations$/)
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
    const bought = await signLicense({ id: 'lic_roscoe', licensee: 'Roscoe LLC', issuedAt: '2026-01-01', expiresAt: '2027-12-31', hosts: [HOST] }, testKey())
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

  test('a license in its grace days: the Renew chip, and the panel says when it ended and when features turn off', async ({ browser }) => {
    const { page, context } = await person(browser, 'admin')
    await page.getByTestId('header-enterprise').click()
    const grace = await signLicense({ id: 'lic_grace', licensee: 'Roscoe LLC', issuedAt: '2026-01-01', expiresAt: ymd(-3), hosts: [HOST] }, testKey())
    await panel(page).getByTestId('paste-key-toggle').click()
    await panel(page).getByTestId('license-key').fill(grace)
    await panel(page).getByTestId('enter-key').click()
    await page.waitForURL(/\/integrations/, { timeout: 30000 })
    await page.keyboard.press('Escape')
    await page.goto(ORIGIN + '/')
    const chip = page.getByTestId('header-enterprise')
    await expect(chip).toHaveAttribute('data-chip', 'renew', { timeout: 30000 })
    await expect(chip).toHaveText('Renew')
    expect(await contrast(chip), 'the Renew chip reads at WCAG AA').toBeGreaterThanOrEqual(4.5)
    await chip.click()
    const notice = panel(page).getByTestId('license-notice')
    await expect(notice).toHaveAttribute('data-kind', 'grace')
    await expect(notice).toContainText(`Your license ended on ${ymd(-3)}.`)
    await expect(notice).toContainText(`stay on until ${ymd(11)}, then turn off`)
    await expect(panel(page).getByTestId('get-license-button')).toBeVisible()
    await shot(page, '12-grace-renew')
    await context.close()
  })
}

if (PHASE === 'expired') {
  test('an ended trial: Renew, the date it ended, Get a license first, and no second trial offered', async ({ browser }) => {
    const { page, context } = await person(browser, 'admin')
    const button = page.getByTestId('header-offer')
    await expect(button).toHaveText('Renew', { timeout: 30000 })
    await expect(page.getByTestId('header-enterprise')).toHaveCount(0)
    await button.click()
    const notice = panel(page).getByTestId('license-notice')
    await expect(notice).toHaveAttribute('data-kind', 'expired')
    await expect(notice).toContainText(`Your free trial ended on ${ymd(-31)}.`)
    expect(await inView(notice)).toBe(true)
    await expect(panel(page).getByTestId('get-license-button')).toBeVisible()
    await expect(panel(page).getByTestId('paste-key-button')).toBeVisible()
    await expect(panel(page).getByTestId('start-trial')).toHaveCount(0)
    await shot(page, '13-trial-ended')
    // A member sees no alarm, just the quiet entry.
    const member = await person(browser, 'member')
    await expect(member.page.getByTestId('header-offer')).toHaveText('Enterprise', { timeout: 30000 })
    await member.context.close()
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
