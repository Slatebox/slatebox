// Adding an already-connected agent to a slate in one click, in a real browser (owner, 2026-11-25: "it
// should be quicker to invite an already connected mcp to the slate - they can just connect here without
// 'asking' first"). A fresh person (no cookies, no storage) connects a test MCP server on the
// Integrations page, opens a new slate, and:
//   1. "+ Invite agent" opens the quick panel (no dialog) with the connected agent at the top and Add;
//   2. one click on Add puts it on the slate: its named cursor greets, its chip opens, no dialog ever
//      opened on the way, and its changes outside Slatebox still say Ask first;
//   3. the panel then says ✓ On this slate, and More agents still opens the full walkthrough.
//
//   cd scripts && SLATEBOX_ORIGIN=http://127.0.0.1:3920 SLATEBOX_PROMOTE=<cmd> SLATEBOX_MCP=http://127.0.0.1:8796 \
//     npx playwright test invite-connected.spec.mjs
// Against a running app where enterprise code is unlocked (a licensed install, or Cloud with Pro).
// SLATEBOX_PROMOTE names a command, run as `<cmd> <userId> <first> <last>`, that turns a guest into a
// signed-in account on that local app (a local database only). SLATEBOX_MCP is the origin of
// scripts/mcp-test-servers.mjs, listed in the app's connectors.devOrigins. SLATEBOX_SHOTS is a folder for screenshots.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3920'
const SHOTS = process.env.SLATEBOX_SHOTS || ''
const PROMOTE = process.env.SLATEBOX_PROMOTE || ''
const MCP = process.env.SLATEBOX_MCP || ''
test.skip(!PROMOTE || !MCP, 'needs SLATEBOX_PROMOTE (signed-in accounts) and SLATEBOX_MCP (a test MCP server the app may reach)')
test.setTimeout(300000)
test.use({ screenshot: 'only-on-failure', ...(process.env.SLATEBOX_CHROMIUM && { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } }) })

const RUN = Date.now().toString(36).slice(-4)
const NAME = `Research ${RUN}`
const shot = async (page, name) => {
  if (!SHOTS) return
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

test('a connected agent is added to a slate with one click on Add: cursor and chip, no dialog, Ask first kept', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(ORIGIN + '/new?empty=1')
  await page.getByRole('button', { name: 'Start with an empty slate' }).click({ timeout: 15000 }).catch(() => {})
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
  expect(await page.evaluate(() => window.Meteor?.user()?.isAnonymous ?? true)).toBe(true)
  const id = await page.evaluate(() => window.Meteor.userId())
  execFileSync(PROMOTE, [id, 'Ada', 'Byron'], { stdio: 'inherit' })
  await page.reload()
  await expect.poll(() => page.evaluate(() => window.Meteor.user()?.isAnonymous === false), { timeout: 30000 }).toBe(true)

  // Connect it once, on the Integrations page.
  await page.goto(ORIGIN + '/integrations')
  await page.locator('[data-integrations-connect]').click()
  const connect = page.getByRole('dialog', { name: 'Connect an integration' })
  await connect.getByRole('tab', { name: 'Custom' }).click()
  await connect.getByLabel('Paste an MCP address').fill(`${MCP}/open/mcp?run=${RUN}`)
  await connect.getByLabel('Name on your slates (optional)').fill(NAME)
  await connect.getByRole('button', { name: 'Check it' }).click()
  await expect(connect.locator('[data-invite-consent]')).toBeVisible({ timeout: 60000 })
  await connect.locator('[data-invite-go]').click()
  await expect(connect.locator('[data-invite-done]')).toBeVisible({ timeout: 60000 })
  await connect.locator('[data-invite-close]').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await shot(page, '01-connected-on-integrations')

  // A new slate of their own.
  await page.goto(ORIGIN + '/new?empty=1')
  await page.getByRole('button', { name: 'Start with an empty slate' }).click({ timeout: 15000 }).catch(() => {})
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 120000 })
  const open = page.locator('[data-invite-agent-open]')
  await expect(open).toBeVisible({ timeout: 60000 })
  // Count every dialog that opens from here on.
  await page.evaluate(() => {
    window.__dialogs = 0
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) {
        if (n.nodeType === 1 && (n.matches?.('[role="dialog"], [role="alertdialog"], .MuiDialog-root') || n.querySelector?.('[role="dialog"], [role="alertdialog"], .MuiDialog-root'))) window.__dialogs++
      }
    }).observe(document.body, { childList: true, subtree: true })
  })

  // 1. The quick panel, not a dialog: the connected agent first, with Add.
  await open.click()
  await shot(page, '02-invite-agent-opened')
  const panel = page.getByRole('region', { name: 'Add an agent to this slate' })
  await expect(panel).toBeVisible({ timeout: 15000 })
  const row = panel.locator(`[data-invite-quick="${NAME}"]`)
  await expect(row).toHaveAttribute('data-invite-quick-act', 'add', { timeout: 15000 })
  await expect(row.getByRole('button', { name: `Add ${NAME} to this slate` })).toBeVisible()
  await expect(row.locator('[data-invite-quick-every]')).toHaveText('Add to every slate I own')
  await expect(panel).toContainText('still wait for your approval')
  expect(await page.evaluate(() => window.__dialogs)).toBe(0)

  // 2. One click on Add.
  await row.getByRole('button', { name: `Add ${NAME} to this slate` }).click()
  // Its named cursor joins the canvas, inside the part of the slate the person is looking at.
  const cursor = page.locator('[data-agent-presence] [data-agent]').filter({ hasText: NAME }).first()
  await expect(cursor).toBeAttached({ timeout: 30000 })
  const box = await cursor.boundingBox()
  expect(box && box.x >= 0 && box.y >= 0 && box.x < 1440 && box.y < 900).toBe(true)
  await expect(panel).toHaveCount(0)
  const chipPanel = page.locator('[data-agent-panel]')
  await expect(chipPanel).toBeVisible({ timeout: 15000 })
  await expect(chipPanel.locator(`[data-agent-invited-controls="${NAME}"]`)).toBeVisible()
  await expect(chipPanel.locator('[data-agent-acting]')).toHaveValue('off', { timeout: 15000 })
  await expect(chipPanel).toContainText('Ask first: each waits on a card')
  await shot(page, '03-added-one-click')
  expect(await page.evaluate(() => window.__dialogs)).toBe(0)
  await page.keyboard.press('Escape')
  await shot(page, '03b-cursor-on-canvas')

  // 3. Open again: ✓ On this slate; More agents still opens the full walkthrough.
  await open.click()
  await expect(panel.locator(`[data-invite-quick="${NAME}"] [data-invite-quick-here]`)).toHaveText('✓ On this slate', { timeout: 15000 })
  await shot(page, '04-panel-on-this-slate')
  await panel.locator('[data-invite-quick-more]').click()
  await expect(page.getByRole('dialog', { name: /Invite an agent to/ })).toBeVisible()
  expect(errors).toEqual([])
  await context.close()
})
