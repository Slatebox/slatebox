// The library gallery in a real browser (library spec §7.6), each test in a fresh context with no login token, the
// guest state asserted before anything is done (AGENTS.md: a reused session silently resumes a login):
//   - a visitor browses /library, filters by kind and category, opens "Pros and cons", adds it to a new slate: they
//     become a guest, the canvas opens with the board, and the item's add count goes up;
//   - the same guest opens a published slate and opens a copy: a private slate of theirs, its provenance kept;
//   - the guest adds a component beside the boards of a slate they already have (the slate picker);
//   - slatebox.com's deep link /library/<slug>?copy=1 opens a copy once and takes the flag out of the URL;
//   - a signed-in person (a new account) opens a copy of a presentation;
//   - an unknown item says so, with a way back.
//
// Against a running app with published items of every kind (a slate titled "Friday launch checklist", a presentation
// titled "Incident review walkthrough", a component titled "Weekly team retro"):
//   cd scripts && SLATEBOX_ORIGIN=http://127.0.0.1:7650 npx playwright test library-gallery.spec.mjs
// SLATEBOX_SHOTS names a folder for screenshots; SLATEBOX_CHROMIUM a Chromium executable.
import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3911'
const SHOTS = process.env.SLATEBOX_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
test.use({ ...(process.env.SLATEBOX_CHROMIUM ? { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } } : { channel: 'chrome' }) })
test.setTimeout(180000)

const shot = (page, name) => (SHOTS ? page.screenshot({ path: join(SHOTS, name + '.png') }) : null)
const api = async (path) => (await fetch(`${ORIGIN}/api/v1${path}`)).json()
const itemBySearch = async (q) => (await api(`/library?q=${encodeURIComponent(q)}`)).items.find(item => item.title === q)

/** No login token and no user: a true visitor (or fails the test before it starts). */
async function assertVisitor(page) {
  await page.evaluate(() => { localStorage.removeItem('Meteor.loginToken'); localStorage.removeItem('meteor_token') })
  await page.reload()
  await page.waitForFunction(() => window.Package?.meteor?.Meteor?.status?.().connected)
  expect(await page.evaluate(() => localStorage.getItem('Meteor.loginToken'))).toBeNull()
  expect(await page.evaluate(() => window.Package.meteor.Meteor.userId())).toBeNull()
}
const currentUser = page => page.evaluate(() => {
  const user = window.Package.meteor.Meteor.user()
  return user ? { id: user._id, guest: Boolean(user.isAnonymous) } : null
})
/** The slate a canvas shows, read through the app's own method as the person on the page. */
const slateOf = (page, shareId) => page.evaluate(async id => {
  const answer = await window.Package.meteor.Meteor.callAsync('slates.get', { shareId: id })
  const s = answer?.slateBase
  return s && { userId: s.userId, isPrivate: Boolean(s.options?.isPrivate), isPublic: Boolean(s.options?.isPublic), libraryOrigin: s.libraryOrigin ?? null,
    boards: (s.creative?.model?.workshop ? 1 : 0) + Object.keys(s.boards ?? {}).length, name: s.options?.name }
}, shareId)
const canvasId = page => new URL(page.url()).pathname.split('/')[2]
const boardDrawn = page => page.waitForSelector('[data-board-layer]', { timeout: 60000 })

test('a visitor browses, filters and adds a smart component to a new slate, as a guest', async ({ page }) => {
  await page.goto(ORIGIN + '/library')
  await assertVisitor(page)
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible()
  await expect(page.locator('[data-library-count-line]')).toHaveText(/\d+ smart components?, \d+ slates?, \d+ presentations?/)
  // Pictures are drawn by the one renderer.
  await expect(page.locator('[data-library-still][data-state="drawn"]').first()).toBeVisible({ timeout: 60000 })
  await shot(page, 'app-library-1440')

  // Filter by kind and category: the URL keeps them.
  await page.getByRole('tab', { name: 'Slates' }).click()
  await expect(page).toHaveURL(/kind=slate/)
  await expect(page.locator('[data-library-card]').first()).toBeVisible()
  for (const card of await page.locator('[data-library-card]').all()) await expect(card.getByText('Slate', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Smart components' }).click()
  await page.getByRole('group', { name: 'Category' }).getByText('Decide', { exact: true }).click()
  await expect(page).toHaveURL(/kind=component/)
  await expect(page).toHaveURL(/category=decide/)
  await expect(page.locator('[data-library-card="pros-cons"]')).toBeVisible()
  await expect(page.locator('[data-library-card="retro"]')).toHaveCount(0)

  const before = (await api('/library/pros-cons')).item.counts.adds
  await page.locator('[data-library-card="pros-cons"]').click()
  await expect(page).toHaveURL(/\/library\/pros-cons$/)
  await expect(page.getByRole('heading', { name: 'Pros and cons', level: 1 })).toBeVisible()
  await expect(page.locator('[data-library-license]')).toContainText('CC BY 4.0')
  await expect(page.locator('[data-library-still="builtin-pros-cons"][data-state="drawn"]')).toBeVisible({ timeout: 60000 })
  await shot(page, 'app-item-pros-cons-1440')

  await page.locator('[data-library-use]').click()
  await page.locator('[data-add-target="new"]').click()
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+/, { timeout: 60000 })
  await boardDrawn(page)
  const shareId = canvasId(page)
  expect(await currentUser(page)).toMatchObject({ guest: true })
  const made = await slateOf(page, shareId)
  expect(made).toMatchObject({ isPrivate: true, isPublic: false, boards: 1 })
  expect(made.libraryOrigin).toMatchObject({ itemId: 'builtin-pros-cons', kind: 'component' })
  expect((await api('/library/pros-cons')).item.counts.adds).toBe(before + 1)
  await shot(page, 'app-canvas-after-add-1440')

  // The same guest opens a published slate and opens a copy: private, with where it came from.
  const slate = await itemBySearch('Friday launch checklist')
  test.skip(!slate, 'no published slate titled "Friday launch checklist" on this app')
  await page.goto(`${ORIGIN}/library/${slate.slug}`)
  await expect(page.locator(`[data-library-still="${slate.id}"][data-state="drawn"]`)).toBeVisible({ timeout: 60000 })
  await shot(page, 'app-item-slate-1440')
  await page.locator('[data-library-use]').click()
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+/, { timeout: 60000 })
  const copyId = canvasId(page)
  expect(copyId).not.toBe(shareId)
  const copy = await slateOf(page, copyId)
  expect(copy).toMatchObject({ isPrivate: true, isPublic: false })
  expect(copy.libraryOrigin).toMatchObject({ itemId: slate.id, kind: 'slate', title: 'Friday launch checklist' })
  expect(copy.userId).toBe((await currentUser(page)).id)

  // Add a component beside the board of the first slate (the picker lists the guest's slates).
  const retro = await itemBySearch('Weekly team retro')
  if (retro) {
    await page.goto(`${ORIGIN}/library/${retro.slug}`)
    await expect(page.locator('[data-provenance]')).toHaveText('Retro')
    await page.locator('[data-library-use]').click()
    await page.locator(`[data-add-target="${shareId}"]`).click()
    await page.waitForURL(new RegExp(`/canvas/${shareId}`), { timeout: 60000 })
    expect((await slateOf(page, shareId)).boards).toBe(2)
  }
})

test('the deep link from slatebox.com opens a copy once and leaves the URL clean', async ({ page }) => {
  const slate = await itemBySearch('Friday launch checklist')
  test.skip(!slate, 'no published slate titled "Friday launch checklist" on this app')
  await page.goto(ORIGIN + '/library')
  await assertVisitor(page)
  const before = (await api(`/library/${slate.id}`)).item.counts.copies
  await page.goto(`${ORIGIN}/library/${slate.slug}?copy=1`)
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+/, { timeout: 60000 })
  const shareId = canvasId(page)
  expect(await currentUser(page)).toMatchObject({ guest: true })
  // Back lands on the item page without the flag, and does not copy again.
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/library/${slate.slug}$`))
  await expect(page.getByRole('heading', { name: 'Friday launch checklist', level: 1 })).toBeVisible()
  await page.waitForTimeout(2000)
  expect(new URL(page.url()).search).toBe('')
  expect((await api(`/library/${slate.id}`)).item.counts.copies).toBe(before + 1)
  expect(shareId).toBeTruthy()
})

test('a signed-in person opens a copy of a presentation', async ({ page }) => {
  const deck = await itemBySearch('Incident review walkthrough')
  test.skip(!deck, 'no published presentation titled "Incident review walkthrough" on this app')
  await page.goto(ORIGIN + '/library')
  await assertVisitor(page)
  const email = `gallery-${Date.now()}@example.com`
  await page.evaluate(({ email }) => new Promise((resolve, reject) => window.Package['accounts-base'].Accounts.createUser(
    { email, password: 'gallery-test-password-1', profile: { firstName: 'Gallery', lastName: 'Tester' } }, err => (err ? reject(err) : resolve()))), { email })
  await page.waitForFunction(() => Boolean(window.Package.meteor.Meteor.userId()))
  expect(await currentUser(page)).toMatchObject({ guest: false })
  await page.goto(`${ORIGIN}/library/${deck.slug}`)
  await expect(page.getByText('Open a copy to play it')).toBeVisible()
  await expect(page.locator('[data-provenance]')).toHaveText('Friday launch checklist')
  await page.locator('[data-library-use]').click()
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+/, { timeout: 60000 })
  const copy = await slateOf(page, canvasId(page))
  expect(copy).toMatchObject({ isPrivate: true })
  expect(copy.libraryOrigin).toMatchObject({ itemId: deck.id, kind: 'presentation' })
})

test('a phone shows the list and an item in one column', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await page.goto(ORIGIN + '/library')
  await assertVisitor(page)
  await expect(page.locator('[data-library-still][data-state="drawn"]').first()).toBeVisible({ timeout: 60000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await shot(page, 'app-library-390')
  await page.goto(ORIGIN + '/library/hiring-plan')
  await expect(page.locator('[data-library-still="builtin-hiring-plan"][data-state="drawn"]')).toBeVisible({ timeout: 60000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await shot(page, 'app-item-hiring-plan-390')
  await context.close()
})

test('an item that is not in the library says so', async ({ page }) => {
  await page.goto(ORIGIN + '/library/not-a-real-item')
  await expect(page.getByText('isn’t in the library')).toBeVisible({ timeout: 30000 })
  await expect(page.getByRole('link', { name: 'Back to the library' })).toBeVisible()
})
