// The canvas "+" menu reads (WCAG 2.2 AA): every word in it at 4.5:1 or more against what is really behind it, and
// every control's edge and icon at 3:1, in the light and the dark canvas and on a phone.
//   - Desktop: the dock that opens from the round + button: "Boards and starters", "See all ›", the
//     Custom Shape / Add Text / Comment buttons (words and outlines), the shapes' outlines, the close (×) button,
//     and the zoom pill beside it.
//   - Phone: the "Add to the slate" sheet: its labels, its buttons' words and edges, and its shapes.
// Colours are measured as drawn: each layer's background and opacity composited over what is under the panel.
//
// Against a running app (a fresh guest per run: no cookies, no storage):
//   cd scripts && SLATEBOX_ORIGIN=http://127.0.0.1:3911 npx playwright test plus-menu-contrast.spec.mjs
// SLATEBOX_SHOTS=<dir> also saves a picture of each menu, open.
import { expect, test } from '@playwright/test'
import { deleteDisposableAccounts } from './spec-cleanup.mjs'

// Every guest this spec makes is deleted before its page closes, here or on staging.
deleteDisposableAccounts(test)

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3911'
const SHOTS = process.env.SLATEBOX_SHOTS
test.use(process.env.SLATEBOX_CHROMIUM ? { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } } : {})
test.setTimeout(180000)

const TEXT = 4.5
const UI = 3

/**
 * In the page: the contrast of each `[name, element, kind]`, as drawn. kind is 'text' (its colour on what is behind
 * it), 'border' (its border on what is outside it), 'stroke' (an svg path's stroke on what is behind the svg) or
 * 'icon' (its colour, as an icon, on what is behind it).
 */
function measure(items) {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/)
    if (!m) {
      const hex = String(c).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
      if (!hex) return null
      const h = hex[1].length === 3 ? hex[1].split('').map((x) => x + x).join('') : hex[1]
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1]
    }
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]
  }
  const over = (top, under, a = top[3]) => [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1)
  const lum = (c) => {
    const [r, g, b] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const chainOf = (el) => { const out = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) out.unshift(e); return out }
  // What is drawn under the element's outermost positioned layer: the first thing at that point outside it.
  const backdrop = (el, chain) => {
    const r = el.getBoundingClientRect()
    const root = chain.find((e) => e !== document.documentElement && e !== document.body && ['fixed', 'absolute'].includes(getComputedStyle(e).position)) || document.body
    for (const e of document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)) {
      if (root.contains(e)) continue
      let c = [255, 255, 255, 1]
      for (const a of chainOf(e)) { const bg = parse(getComputedStyle(a).backgroundColor); if (bg && bg[3] > 0) c = over(bg, c) }
      return { root, color: c }
    }
    return { root, color: [255, 255, 255, 1] }
  }
  // The colour at the element's pixel with `leaf` drawn on top of it (group opacity honoured), from the root down.
  const drawn = (chain, from, under, leaf, skipOwnBg) => {
    const paint = (i, below) => {
      if (i >= chain.length) return leaf ? over(leaf, below) : below
      const st = getComputedStyle(chain[i])
      const bg = parse(st.backgroundColor)
      const own = bg && bg[3] > 0 && !(skipOwnBg && i === chain.length - 1) ? over(bg, below) : below
      const inner = paint(i + 1, own)
      const o = Number(st.opacity)
      return o < 1 ? over(inner, below, o) : inner
    }
    return paint(from, under)
  }
  return items.map(([name, el, kind]) => {
    if (!el) return { name, missing: true }
    const box = el.getBoundingClientRect()
    if (getComputedStyle(el).visibility === 'hidden' || !box.width || !box.height) return { name, hidden: true }
    // Something drawn over it (not itself, not inside it, not a box it sits in) hides it: that is a failure too.
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    if (top && !el.contains(top) && !top.contains(el)) return { name, covered: (top.className?.baseVal ?? top.className ?? top.tagName).toString().slice(0, 60) }
    const chain = chainOf(el)
    const { root, color } = backdrop(el, chain)
    const from = chain.indexOf(root)
    const st = getComputedStyle(el)
    if (kind === 'stroke') {
      const leaf = parse(el.getAttribute('stroke') || st.stroke)
      const fg = drawn(chain, from, color, leaf, true)
      const bg = drawn(chain.slice(0, -1), from, color, null)
      return { name, ratio: ratio(fg, bg), fg, bg }
    }
    const leaf = parse(kind === 'border' ? st.borderTopColor : st.color)
    const fg = drawn(chain, from, color, leaf, kind === 'border')
    const bg = drawn(chain, from, color, null, kind === 'border')
    return { name, ratio: ratio(fg, bg), fg, bg }
  })
}

async function freshSlate(browser, { viewport, colorScheme }) {
  const context = await browser.newContext({ viewport, colorScheme })
  // The app's own mode (the account menu's Dark mode), set before the page loads: the canvas follows it.
  await context.addInitScript((mode) => localStorage.setItem('mui-mode', mode), colorScheme)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(ORIGIN + '/new?empty=1')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 90000 })
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => document.querySelector('#slateCanvas')?.getAttribute('data-sb-canvas') ?? 'light')).toBe(colorScheme)
  return { context, page, errors }
}

async function report(page, items, label) {
  const results = await page.evaluate(([fn, list]) => {
    // eslint-disable-next-line no-new-func
    const m = new Function('return ' + fn)()
    const pick = (q) => (typeof q === 'string' ? document.querySelector(q) : null)
    return m(list.map(([n, q, k, nth]) => [n, nth != null ? document.querySelectorAll(q)[nth] : pick(q), k]))
  }, [measure.toString(), items])
  results.forEach((r, i) => {
    const min = /border|stroke|icon|edge|outline/.test(r.name) ? UI : TEXT
    const mayHide = items[i][4] === 'may hide'
    const shown = r.missing ? 'missing' : r.hidden ? 'hidden' : r.covered ? `covered by ${r.covered}` : r.ratio.toFixed(2)
    console.log(`${label} | ${r.name} | ${shown} (min ${min})`)
    expect.soft(r.missing, `${label}: ${r.name} is on the page`).toBeFalsy()
    expect.soft(r.covered, `${label}: ${r.name} is not drawn over`).toBeFalsy()
    if (r.hidden) { expect.soft(mayHide, `${label}: ${r.name} is shown`).toBe(true); return }
    if (r.missing || r.covered) return
    expect.soft(r.ratio, `${label}: ${r.name} reads at ${r.ratio?.toFixed(2)}:1`).toBeGreaterThanOrEqual(min)
  })
}

for (const colorScheme of ['light', 'dark']) {
  test(`the desktop + menu reads in the ${colorScheme} canvas`, async ({ browser }) => {
    const { context, page, errors } = await freshSlate(browser, { viewport: { width: 1440, height: 900 }, colorScheme })
    const dial = page.locator('.MuiSpeedDial-root')
    await page.locator('.MuiSpeedDial-fab').hover()
    await expect(page.getByRole('group', { name: 'Boards and starters' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('See all ›')).toBeVisible({ timeout: 15000 })
    await page.waitForTimeout(600)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/desktop-1440-${colorScheme}.png` })
    const buttons = await dial.locator('.MuiButtonGroup-root button').count()
    expect(buttons).toBeGreaterThanOrEqual(2)
    const items = [
      ['"Boards and starters" words', '[aria-label="Boards and starters"] .MuiTypography-caption', 'text'],
      ['"See all ›" words', '[aria-label="Boards and starters"] button:last-of-type', 'text'],
      ['close (×) icon', '.MuiSpeedDial-fab .MuiSpeedDialIcon-root', 'icon'],
      // Under the open dock the zoom pill is either readable on top or out of the way, never a dim ghost.
      ['zoom pill words', '.slatebox-zoom-slider span', 'text', null, 'may hide'],
      ['zoom pill fit icon', '.slatebox-zoom-slider button', 'icon', 0, 'may hide'],
      // (the first shape is the line: no height)
      ['shape outline stroke', '.MuiSpeedDial-actions svg path', 'stroke', 1],
    ]
    for (let i = 0; i < buttons; i++) {
      items.push([`action button ${i + 1} words`, '.MuiSpeedDial-root .MuiButtonGroup-root button', 'text', i])
      items.push([`action button ${i + 1} border`, '.MuiSpeedDial-root .MuiButtonGroup-root button', 'border', i])
    }
    await report(page, items, `desktop ${colorScheme}`)

    // Closed: the + button and the zoom pill beside it, on the canvas.
    await page.mouse.move(200, 300)
    await expect(page.getByRole('group', { name: 'Boards and starters' })).toBeHidden({ timeout: 10000 })
    await page.waitForTimeout(400)
    await report(page, [
      ['+ button icon', '.MuiSpeedDial-fab .MuiSpeedDialIcon-root', 'icon'],
      ['zoom pill words', '.slatebox-zoom-slider span', 'text'],
      ['zoom pill fit icon', '.slatebox-zoom-slider button', 'icon', 0],
      ['zoom pill edge border', '.slatebox-zoom-slider', 'border'],
    ], `desktop ${colorScheme} closed`)
    expect(errors).toEqual([])
    await context.close()
  })

  test(`the phone add sheet reads in the ${colorScheme} canvas`, async ({ browser }) => {
    const { context, page, errors } = await freshSlate(browser, { viewport: { width: 390, height: 844 }, colorScheme })
    await page.locator('button.sb-add').click()
    const sheet = page.locator('#sb-add-sheet')
    await expect(sheet).toBeVisible({ timeout: 15000 })
    await expect(sheet.getByText('See all ›')).toBeVisible({ timeout: 15000 })
    await page.waitForTimeout(600)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-390-${colorScheme}.png` })
    const items = [
      ['"Boards and starters" label', '#sb-add-sheet [aria-label="Boards and starters"] .sb-label', 'text'],
      ['"See all ›" words', '#sb-add-sheet [aria-label="Boards and starters"] button:last-of-type', 'text'],
      ['"Shapes" label', '#sb-add-sheet .sb-label', 'text', 1],
      ['first add button words', '#sb-add-sheet .sb-add-grid .sb-btn span', 'text', 0],
      ['first add button border', '#sb-add-sheet .sb-add-grid .sb-btn', 'border', 0],
      ['shape outline stroke', '#sb-add-sheet .sb-shapes .sb-btn', 'icon', 0],
      ['shape tile border', '#sb-add-sheet .sb-shapes .sb-btn', 'border', 0],
    ]
    await report(page, items, `phone ${colorScheme}`)
    expect(errors).toEqual([])
    await context.close()
  })
}
