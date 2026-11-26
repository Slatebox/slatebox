// The canvas "Custom shape" pane (the + menu's Custom Shape), at 1440, 1024 and 390 wide:
//   - the pane is wholly in the viewport (a side panel; a bottom sheet on a phone), its close button too;
//   - typing searches icons (a stand-in for The Noun Project here) and shows them as tiles, with the credit;
//   - clicking an icon puts it on a new note whose outline is stored normalised (a 0..100 box, never the
//     canvas coordinates of where the note landed);
//   - "Create a custom shape with AI" draws exactly one shape (a stand-in model answers), and Your shapes keeps it.
//   - every tile draws only its outline: no grey bar for the note's text (it read as a stray dash).
//
// The app must be started with settings that point the icon search and the shape model at the stand-in this
// spec serves on SLATEBOX_SHAPE_MOCK_PORT (3929 unless set):
//   "nounProject": { "key": "test-key", "secret": "test-secret", "apiOrigin": "http://127.0.0.1:3929" },
//   "ai": { "connections": { "mock": { "type": "openai-compatible", "baseUrl": "http://127.0.0.1:3929/v1", "model": "mock-shape" } },
//           "use": { "shape": "mock" } }
// then:
//   cd scripts && SLATEBOX_ORIGIN=http://127.0.0.1:3931 npx playwright test shape-pane.spec.mjs
// SLATEBOX_SHOTS=<dir> also saves a picture of the pane at each width.
import http from 'node:http'
import { expect, test } from '@playwright/test'

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3931'
const MOCK_PORT = Number(process.env.SLATEBOX_SHAPE_MOCK_PORT || 3929)
const SHOTS = process.env.SLATEBOX_SHOTS
// The server keeps search answers for hours: each run searches words of its own.
const RUN = Date.now().toString(36)
test.use(process.env.SLATEBOX_CHROMIUM ? { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } } : {})
test.setTimeout(180000)

// ---- the stand-in: Noun Project's v2 icon search, its SVG files, and an OpenAI-compatible model ----
const BIRD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M20 60 C20 35 45 20 65 30 L90 22 L78 40 C82 60 65 80 40 80 L15 92 L24 72 C21 68 20 64 20 60 Z"/></svg>'
const STAR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,2 61,38 98,38 68,60 79,96 50,74 21,96 32,60 2,38 39,38"/></svg>'
const BELL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240"><g transform="translate(20,10)"><path d="M80 0 C120 0 140 40 140 90 L140 150 L160 180 L0 180 L20 150 L20 90 C20 40 40 0 80 0 Z"/><circle cx="80" cy="200" r="20"/></g></svg>'
const SVGS = { 101: BIRD, 102: STAR, 103: BELL }
const ROCKET = 'M50,0 C64,10 72,28 72,50 L72,74 L88,90 L88,100 L70,92 L30,92 L12,100 L12,90 L28,74 L28,50 C28,28 36,10 50,0 Z'
const seen = { searches: [], signed: 0, models: [] }

function standIn() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`)
    if (url.pathname === '/v2/icon') {
      seen.searches.push(url.searchParams.get('query'))
      if (/^OAuth .*oauth_signature=/.test(req.headers.authorization || '')) seen.signed += 1
      const q = url.searchParams.get('query') || ''
      const icons = /zzz/.test(q) ? [] : [101, 102, 103].map((id, i) => ({
        id,
        term: [q, 'star', 'bell'][i],
        attribution: `${[q, 'star', 'bell'][i]} by Test Creator from Noun Project`,
        creator: { name: 'Test Creator', username: 'test' },
        license_description: 'creative-commons-attribution',
        permalink: `/icon/test-${id}/`,
        icon_url: `http://127.0.0.1:${MOCK_PORT}/svg/${id}.svg`,
      }))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ icons, total: icons.length }))
      return
    }
    const svg = url.pathname.match(/^\/svg\/(\d+)\.svg$/)
    if (svg && SVGS[svg[1]]) {
      res.writeHead(200, { 'content-type': 'image/svg+xml' })
      res.end(SVGS[svg[1]])
      return
    }
    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        const ask = JSON.parse(body || '{}')
        const system = (ask.messages || []).find((m) => m.role === 'system')?.content
        const count = Number(String(typeof system === 'string' ? system : JSON.stringify(system)).match(/exactly (\d+)/)?.[1] || 0)
        seen.models.push(count)
        const shapes = Array.from({ length: Math.max(1, count) }, (_, i) => ({ name: i ? `Rocket ${i + 1}` : 'Rocket', d: ROCKET, fillRule: 'nonzero' }))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          id: 'mock', object: 'chat.completion', model: ask.model,
          choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call1', type: 'function', function: { name: 'propose_shapes', arguments: JSON.stringify({ shapes }) } }] } }],
          usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
        }))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
}

let server
test.beforeAll(async () => {
  server = standIn()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(MOCK_PORT, '127.0.0.1', resolve) })
})
test.afterAll(async () => { await new Promise((resolve) => server?.close(resolve)) })

// ---- helpers ---------------------------------------------------------------------------------
async function freshSlate(browser, viewport, { register = false } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 600, isMobile: viewport.width < 600 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(ORIGIN + '/new?empty=1')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 90000 })
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1200)
  if (register) {
    // A registered account (drawing with AI and keeping shapes need one): sign up in the page.
    const email = `shape-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@probe.invalid`
    const result = await page.evaluate(async (address) => {
      const { Accounts } = Package['accounts-base']
      const { Meteor } = Package.meteor
      await new Promise((resolve) => Meteor.logout(resolve))
      return new Promise((resolve) => Accounts.createUser({ email: address, password: 'Shape-pane-1!' }, (e) => resolve(e ? e.reason || e.message : 'ok')))
    }, email)
    expect(result).toBe('ok')
    await page.goto(ORIGIN + '/new?empty=1')
    await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 90000 })
    await page.getByRole('button', { name: 'Got it' }).click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(1200)
    expect(await page.evaluate(() => Boolean(Package.meteor.Meteor.user() && !Package.meteor.Meteor.user().isAnonymous))).toBe(true)
  }
  return { context, page, errors }
}

async function openPane(page, phone) {
  if (phone) {
    await page.locator('button.sb-add').click()
    await page.locator('#sb-add-sheet').getByRole('button', { name: 'Custom shape' }).click()
  } else {
    await page.locator('.MuiSpeedDial-fab').hover()
    await page.locator('.MuiSpeedDial-root .MuiButtonGroup-root button', { hasText: 'Custom Shape' }).click({ timeout: 15000 })
  }
  const pane = page.locator('[data-shape-maker]')
  await expect(pane).toBeVisible()
  await page.waitForTimeout(400)
  return pane
}

async function inViewport(page, locator) {
  const box = await locator.boundingBox()
  const size = page.viewportSize()
  expect(box, 'is drawn').toBeTruthy()
  return box.x >= -0.5 && box.y >= -0.5 && box.x + box.width <= size.width + 0.5 && box.y + box.height <= size.height + 0.5
}

// The note's stored outline: its bounds sit in the 0..100 box (never the ~10000 canvas coordinates).
async function newestNoteOutline(page) {
  return page.evaluate(() => {
    const slate = window.slate
    const all = slate?.nodes?.allNodes || []
    const node = all[all.length - 1]
    if (!node) return null
    const d = node.options.vectorPath
    const nums = String(d).match(/-?\d*\.?\d+(e-?\d+)?/gi)?.map(Number) || []
    return { d, shape: node.options.shape, shapeRef: node.options.shapeRef, count: all.length, min: Math.min(...nums), max: Math.max(...nums) }
  })
}

// What each tile draws: only the shape's outline (one path), no grey stand-in bar for the note's text,
// which read as a small horizontal dash across the middle of every icon.
async function tileDrawings(scope) {
  return scope.locator('[data-shape-tile] svg').evaluateAll((svgs) => svgs.map((svg) => ({
    paths: svg.querySelectorAll('path').length,
    others: [...svg.children].filter((c) => c.tagName.toLowerCase() !== 'path').map((c) => c.tagName.toLowerCase()),
  })))
}
function expectOutlineOnly(drawings, where) {
  expect(drawings.length, `${where}: tiles are drawn`).toBeGreaterThan(0)
  for (const d of drawings) expect(d, `${where}: one outline and nothing else`).toEqual({ paths: 1, others: [] })
}

const SIZES = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'tablet', viewport: { width: 1024, height: 768 } },
  { name: 'phone', viewport: { width: 390, height: 844 } },
]

for (const { name, viewport } of SIZES) {
  test(`${name} ${viewport.width}: the pane fits, searches icons by default, and an icon goes on a note normalised`, async ({ browser }) => {
    const phone = viewport.width < 600
    const { context, page, errors } = await freshSlate(browser, viewport)
    const pane = await openPane(page, phone)
    expect(await inViewport(page, pane), 'the pane is wholly in the viewport').toBe(true)
    const close = pane.getByRole('button', { name: 'Close' })
    await expect(close).toBeVisible()
    expect(await inViewport(page, close), 'the close button is in the viewport').toBe(true)
    // Nothing inside the pane runs wider than it (no clipped buttons).
    const overflow = await pane.evaluate((el) => [...el.querySelectorAll('*')].filter((c) => { const r = c.getBoundingClientRect(); const p = el.getBoundingClientRect(); return r.width && (r.right > p.right + 1 || r.left < p.left - 1) }).map((c) => c.tagName + '.' + String(c.className).slice(0, 40)))
    expect(overflow, 'no element is wider than the pane').toEqual([])

    // Words of its own for each size: the server keeps answers, so the same words make no second API call.
    const words = `songbird ${viewport.width} ${RUN}`
    const before = seen.searches.length
    await pane.getByRole('searchbox', { name: 'Search icons' }).fill(words)
    const tiles = pane.locator('[data-shape-tile^="icon-"]')
    await expect(pane.getByRole('button', { name: `Use ${words}` })).toBeVisible({ timeout: 20000 })
    expect(await tiles.count()).toBe(3)
    expectOutlineOnly(await tileDrawings(pane), 'icon results')
    expect(seen.searches.length).toBe(before + 1)
    expect(seen.signed, 'the API request is signed (OAuth 1.0a)').toBeGreaterThan(0)
    await expect(pane.getByRole('link', { name: 'Icons from Noun Project' })).toBeVisible()
    await expect(pane.getByRole('button', { name: 'Create a custom shape with AI' })).toBeEnabled()
    expect(await inViewport(page, tiles.last()) || phone, 'the results are in view').toBe(true)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-${name}-${viewport.width}-search.png` })

    // Keyboard: arrow down from the field goes to the first icon, right to the next.
    await pane.getByRole('searchbox', { name: 'Search icons' }).press('ArrowDown')
    await expect(tiles.nth(0)).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(tiles.nth(1)).toBeFocused()

    // An empty answer says so.
    await pane.getByRole('searchbox', { name: 'Search icons' }).fill(`zzzz ${viewport.width} ${RUN}`)
    await expect(pane.getByText(`No icons for “zzzz ${viewport.width} ${RUN}”`, { exact: false })).toBeVisible({ timeout: 20000 })
    await pane.getByRole('searchbox', { name: 'Search icons' }).fill(words)
    await expect(pane.getByRole('button', { name: `Use ${words}` })).toBeVisible({ timeout: 20000 })
    expect(seen.searches.length, 'the same words again come from the kept answer').toBe(before + 2)

    const count = (await newestNoteOutline(page))?.count ?? 0
    // The bell icon's SVG is drawn at 200x240 with a transform: stored, it is still a 0..100 outline.
    await tiles.nth(2).click()
    await expect(pane).toBeHidden()
    const note = await newestNoteOutline(page)
    expect(note.count).toBe(count + 1)
    expect(note.shape).toBe('custom')
    expect(note.min, `normalised outline: ${note.d.slice(0, 60)}`).toBeGreaterThanOrEqual(0)
    expect(note.max, `normalised outline: ${note.d.slice(0, 60)}`).toBeLessThanOrEqual(100.5)
    expect(errors).toEqual([])
    await context.close()
  })
}

test('AI create draws exactly one shape, and Your shapes keeps it and the icon picked', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser, { width: 1440, height: 900 }, { register: true })
  let pane = await openPane(page, false)
  await pane.getByRole('searchbox', { name: 'Search icons' }).fill('a rocket')
  // Icons first (the default), then the AI as the second choice, side by side.
  await expect(pane.getByRole('button', { name: 'Use a rocket' })).toBeVisible({ timeout: 20000 })
  const models = seen.models.length
  await pane.getByRole('button', { name: 'Create a custom shape with AI' }).click()
  const drawn = pane.getByRole('group', { name: 'Shape drawn' })
  await expect(drawn.getByRole('button', { name: 'Use this shape' })).toBeVisible({ timeout: 30000 })
  expect(seen.models.slice(models), 'one model call, asking for exactly one shape').toEqual([1])
  expect(await drawn.locator('[data-shape-tile]').count(), 'one shape, not three candidates').toBe(1)
  expectOutlineOnly(await tileDrawings(drawn), 'the drawn shape')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-desktop-1440-ai-one-shape.png` })
  const count = (await newestNoteOutline(page))?.count ?? 0
  await drawn.getByRole('button', { name: 'Use this shape' }).click()
  await expect(pane).toBeHidden()
  const note = await newestNoteOutline(page)
  expect(note.count).toBe(count + 1)
  expect(note.shapeRef?.name).toBe('Rocket')
  expect(note.shapeRef?.id, 'kept in the library').toBeTruthy()
  expect(note.min).toBeGreaterThanOrEqual(0)
  expect(note.max).toBeLessThanOrEqual(100.5)

  // An icon picked while signed in is kept too.
  pane = await openPane(page, false)
  await pane.getByRole('searchbox', { name: 'Search icons' }).fill('songbird')
  await pane.getByRole('group', { name: 'Icons for songbird' }).getByRole('button', { name: 'Use songbird' }).click({ timeout: 20000 })
  await expect(pane).toBeHidden()

  pane = await openPane(page, false)
  const kept = pane.getByRole('group', { name: 'Your shapes' })
  await expect(kept).toBeVisible({ timeout: 10000 })
  await expect(kept.getByRole('button', { name: 'Use Rocket' })).toBeVisible()
  await expect(kept.getByRole('button', { name: 'Use songbird' })).toBeVisible()
  expectOutlineOnly(await tileDrawings(kept), 'Your shapes')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-desktop-1440-your-shapes.png` })
  expect(errors).toEqual([])
  await context.close()
})
