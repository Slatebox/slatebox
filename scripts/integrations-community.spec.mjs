// Connect an integration's two tabs and a suggested integration's whole way, in a real browser, each
// person in a fresh context (no cookies, no storage), against a running app where enterprise code is
// unlocked (a licensed install, or Cloud with Pro):
//   1. Existing is the first tab: the gallery's chips, search and cards; Custom is a real tab with the
//      address field, an optional name and "Check it";
//   2. a person pastes a custom MCP address, checks it, connects it, and suggests it for the library;
//   3. an administrator finds it in /admin/library under Integrations, opens it (Slatebox reaches the
//      server again) and approves it;
//   4. the person sees it under Existing, marked Community;
//   5. Custom's problems (not an address, a private or plain-http one, unreachable, not an MCP server)
//      are said under the address field, and a server behind a key asks for it instead.
//
//   cd scripts && SLATEBOX_ORIGIN=http://127.0.0.1:3920 SLATEBOX_PROMOTE=<cmd> SLATEBOX_MCP=http://127.0.0.1:8796 \
//     npx playwright test integrations-community.spec.mjs
// SLATEBOX_PROMOTE names a command, run as `<cmd> <userId> <first> <last> [reviewer]`, that turns a guest into a
// signed-in account on that local app (a local database only). SLATEBOX_CLOUD_CARD names a Community card the app's
// Slatebox Cloud lists (a licensed install), checked when given. SLATEBOX_MCP is the origin of
// scripts/mcp-test-servers.mjs, listed in the app's connectors.devOrigins. SLATEBOX_SHOTS is a folder for screenshots.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3920'
const SHOTS = process.env.SLATEBOX_SHOTS || ''
const PROMOTE = process.env.SLATEBOX_PROMOTE || ''
const MCP = process.env.SLATEBOX_MCP || ''
test.skip(!PROMOTE || !MCP, 'needs SLATEBOX_PROMOTE (signed-in accounts) and SLATEBOX_MCP (a test MCP server the app may reach)')
test.setTimeout(300000)
test.describe.configure({ mode: 'serial' })
test.use({ screenshot: 'only-on-failure', ...(process.env.SLATEBOX_CHROMIUM && { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } }) })

const DESK = { width: 1440, height: 900 }
const RUN = Date.now().toString(36).slice(-4)
const NAME = `Research desk ${RUN}`
// After the dialog's and buttons' transitions settle, so a still never catches a half-faded frame.
const shot = async (target, name) => {
  if (!SHOTS) return
  await (typeof target.page === 'function' ? target.page() : target).waitForTimeout(800)
  await target.screenshot({ path: `${SHOTS}/${name}.png` })
}
let ada

async function person(browser, { first, last, reviewer = false, viewport = DESK }) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(ORIGIN + '/new?empty=1')
  // The first-run picker, where the app shows one: an empty slate is enough here.
  await page.getByRole('button', { name: 'Start with an empty slate' }).click({ timeout: 15000 }).catch(() => {})
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
  expect(await page.evaluate(() => window.Meteor?.user()?.isAnonymous ?? true)).toBe(true)
  expect(await page.evaluate(() => window.sessionStorage.getItem('slatebox.connectTab'))).toBe(null)
  const id = await page.evaluate(() => window.Meteor.userId())
  execFileSync(PROMOTE, [id, first, last, ...(reviewer ? ['reviewer'] : [])], { stdio: 'inherit' })
  await page.reload()
  await expect.poll(() => page.evaluate(() => window.Meteor.user()?.isAnonymous === false), { timeout: 30000 }).toBe(true)
  return { context, page, errors, id }
}

async function openConnect(page) {
  await page.goto(ORIGIN + '/integrations')
  await page.locator('[data-integrations-connect]').click()
  const dialog = page.getByRole('dialog', { name: 'Connect an integration' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('Existing and Custom are real tabs; a custom address is checked, connected and suggested for the library', async ({ browser }) => {
  ada = await person(browser, { first: 'Ada', last: 'Byron' })
  const { page } = ada
  const dialog = await openConnect(page)
  const tabs = dialog.getByRole('tablist', { name: 'How to connect' })
  await expect(tabs.getByRole('tab', { name: 'Existing' })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByRole('tabpanel', { name: 'Existing' })).toBeVisible()
  await expect(dialog.locator('[data-gallery-card]').first()).toBeVisible({ timeout: 30000 })
  await expect(dialog.locator('[data-invite-address]')).toHaveCount(0)
  await shot(dialog, '01-existing-tab')
  // A licensed install's Community cards from Slatebox Cloud sit among them (when its Cloud lists any).
  if (process.env.SLATEBOX_CLOUD_CARD) {
    await dialog.locator('[data-gallery-search]').fill(process.env.SLATEBOX_CLOUD_CARD)
    const cloudCard = dialog.locator('[data-gallery-card]').filter({ hasText: process.env.SLATEBOX_CLOUD_CARD })
    await expect(cloudCard.locator('[data-gallery-community]')).toHaveText('Community')
    await shot(dialog, '01b-existing-community-from-cloud')
    await dialog.locator('[data-gallery-search]').fill('')
  }
  // Keyboard: the arrow key moves to Custom.
  await tabs.getByRole('tab', { name: 'Existing' }).focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(tabs.getByRole('tab', { name: 'Custom' })).toHaveAttribute('aria-selected', 'true')
  const custom = dialog.getByRole('tabpanel', { name: 'Custom' })
  await expect(custom.getByLabel('Paste an MCP address')).toBeVisible()
  await custom.getByLabel('Paste an MCP address').fill(`${MCP}/open/mcp?run=${RUN}`)
  await custom.getByLabel('Name on your slates (optional)').fill(NAME)
  await shot(dialog, '02-custom-tab')
  await custom.getByRole('button', { name: 'Check it' }).click()
  await expect(dialog.locator('[data-invite-consent]')).toBeVisible({ timeout: 60000 })
  await expect(dialog.locator('[data-invite-name]')).toHaveValue(NAME)
  await dialog.locator('[data-invite-go]').click()
  const done = dialog.locator('[data-invite-done]')
  await expect(done).toBeVisible({ timeout: 60000 })
  await shot(dialog, '03-custom-connected')
  await done.locator('[data-invite-suggest-open]').click()
  const form = page.getByRole('dialog', { name: /Suggest .* for the Slatebox library/ })
  await expect(form).toBeVisible()
  await form.getByLabel(/^Name/).fill(NAME)
  await form.getByLabel(/One line about what it does/).fill('Searches open research notes and adds what it finds as notes.')
  await form.getByLabel(/Category/).click()
  await page.getByRole('option', { name: 'Research' }).click()
  await form.getByLabel(/Homepage or docs/).fill('https://example.com/research-desk')
  await expect(form.locator('[data-suggest-send]')).toBeDisabled()
  await form.locator('[data-suggest-consent] input').check()
  await shot(form, '04-suggest-form')
  await form.locator('[data-suggest-send]').click()
  await expect(form.locator('[data-suggest-sent]')).toBeVisible({ timeout: 30000 })
  // The tab is remembered for this session only.
  expect(await page.evaluate(() => window.sessionStorage.getItem('slatebox.connectTab'))).toBe('custom')
  expect(ada.errors).toEqual([])
})

test('an administrator finds it in the same queue, Slatebox checks the server again, and approving lists it under Existing as Community', async ({ browser }) => {
  const root = await person(browser, { first: 'Root', last: 'Admin', reviewer: true })
  const { page } = root
  await page.goto(ORIGIN + '/admin/library')
  await page.getByRole('group', { name: 'Kind' }).getByRole('button', { name: 'Integrations' }).click()
  const row = page.getByTestId('queue-row').filter({ hasText: NAME })
  await expect(row).toBeVisible({ timeout: 30000 })
  await expect(row.getByTestId('queue-integration')).toBeVisible()
  await shot(page, '05-admin-queue')
  await row.getByTestId('queue-open').click()
  await page.waitForURL(/\/admin\/library\/review\/[A-Za-z0-9]+$/)
  const check = page.getByTestId('integration-probe')
  await expect(check).toContainText('Reached', { timeout: 60000 })
  await expect(check).toContainText('Its tools are the ones the author connected')
  await shot(page, '06-admin-review')
  await page.getByTestId('review-approve').click()
  await page.getByTestId('decision-confirm').click()
  await expect(page.getByTestId('review-done')).toContainText('marked Community', { timeout: 30000 })
  await page.getByTestId('review-done').scrollIntoViewIfNeeded()
  await shot(page, '07-admin-approved')
  expect(root.errors).toEqual([])
  await root.context.close()

  // The author, in a fresh page of their own session: the card is there, marked Community.
  const { page: mine } = ada
  const dialog = await openConnect(mine)
  await dialog.getByRole('tab', { name: 'Existing' }).click()
  await dialog.locator('[data-gallery-search]').fill('research desk')
  const card = dialog.locator('[data-gallery-card]').filter({ hasText: NAME })
  await expect(card).toBeVisible({ timeout: 30000 })
  await expect(card.locator('[data-gallery-community]')).toHaveText('Community')
  await shot(dialog, '08-approved-community-card')
  await ada.context.close()
})

test('Custom says what went wrong under the address field, in plain words, and a server behind a sign-in asks for it', async ({ browser }) => {
  const sam = await person(browser, { first: 'Sam', last: 'Custom' })
  const dialog = await openConnect(sam.page)
  await dialog.getByRole('tab', { name: 'Custom' }).click()
  const custom = dialog.getByRole('tabpanel', { name: 'Custom' })
  const field = custom.getByLabel('Paste an MCP address')
  const problem = custom.locator('[data-invite-address-problem]')
  const check = async (address, words, name) => {
    await field.fill(address)
    await custom.getByRole('button', { name: 'Check it' }).click()
    await expect(problem).toContainText(words, { timeout: 60000 })
    // On the field itself: its error state, and the message is what describes it.
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveAttribute('aria-describedby', /invite-address-problem/)
    // Said once, there: not also in a callout above the tabs.
    await expect(dialog.getByRole('alert')).toHaveCount(1)
    if (name) await shot(dialog, name)
  }
  await check('not a web address', 'Paste the full address, starting with https://', '10a-custom-bad-address')
  await check('https://10.0.0.1/mcp', 'only connects public servers', '10b-custom-private-address')
  await check('http://example.com/mcp', 'https://', null)
  await check('https://unreachable.invalid/mcp', "Couldn't reach unreachable.invalid", '10c-custom-unreachable')
  await check(`${MCP}/nothing/mcp`, "didn't answer like an MCP server", null)
  // Typing again clears it.
  await field.fill(`${MCP}/key/mcp`)
  await expect(problem).toHaveCount(0)
  await expect(field).not.toHaveAttribute('aria-invalid', 'true')
  // Behind a key: not an error, the sign-in step, saying what it needs.
  await custom.getByRole('button', { name: 'Check it' }).click()
  await expect(dialog.locator('[data-invite-signin]')).toBeVisible({ timeout: 60000 })
  await expect(dialog.locator('[data-invite-signin]')).toContainText('Sign-in needed')
  await expect(dialog.locator('[data-invite-key]')).toBeVisible()
  await shot(dialog, '10d-custom-needs-key')
  expect(sam.errors).toEqual([])
  await sam.context.close()
})

test('on a phone the tabs stay in reach and the dialog fills the screen', async ({ browser }) => {
  const phone = await person(browser, { first: 'Pat', last: 'Phone', viewport: { width: 390, height: 844 } })
  const dialog = await openConnect(phone.page)
  await expect(dialog.getByRole('tab', { name: 'Custom' })).toBeInViewport()
  await dialog.getByRole('tab', { name: 'Custom' }).click()
  await expect(dialog.getByLabel('Paste an MCP address')).toBeInViewport()
  await shot(phone.page, '09-phone-custom-tab')
  await phone.context.close()
})
