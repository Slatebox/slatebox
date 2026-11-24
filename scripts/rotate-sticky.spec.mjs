// Owner feedback, 2026-11-24 (test.slatebox.com):
//   (1) "the rotate icon should look like a rotate icon or something, and be a bit more prominent?"
//   (2) "the post it note svg object should be the shape of the default note that is added - not these square svgs
//       ... no border, ... a yellow sticky note color, and then also use the sticky note drop shadow effect right away"
// In the real app, on a fresh guest slate, at 1440 and on a 390 phone:
//   - the + menu's Sticky Note makes the default rounded note (160 x noteAt height), Lemon #fdeea6, dark text, no
//     border, the "Sticky note" effect (postItNote shadow) on; and it keeps all that through a reload, a copy and
//     paste, a sibling added from its plug, and the SVG export;
//   - the dock tile is drawn as that yellow note;
//   - the rotate knob (engine) is a screen-sized circle with a rotate icon outside the top-right corner, and a drag on
//     it (mouse, or a finger on the phone) turns the note, with Shift snapping to 15°.
//
// Against a running app (a fresh guest per run: no cookies, no storage):
//   cd scripts && SLATEBOX_ORIGIN=http://127.0.0.1:3911 npx playwright test rotate-sticky.spec.mjs
// SLATEBOX_SHOTS=<dir> also saves pictures (the menu open, the sticky made, the knob, mid-rotation).
import { expect, test } from '@playwright/test'

const ORIGIN = process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3911'
const SHOTS = process.env.SLATEBOX_SHOTS
test.use(process.env.SLATEBOX_CHROMIUM ? { launchOptions: { executablePath: process.env.SLATEBOX_CHROMIUM } } : {})
test.setTimeout(240000)

const LEMON = '#fdeea6'
const DARK_TEXT = '#1b1f1d'

async function freshSlate(browser, { viewport, colorScheme = 'light', touch = false }) {
  const context = await browser.newContext({ viewport, colorScheme, ...(touch && { hasTouch: true, isMobile: true }) })
  await context.addInitScript((mode) => localStorage.setItem('mui-mode', mode), colorScheme)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(ORIGIN + '/new')
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+$/, { timeout: 90000 })
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1500)
  return { context, page, errors }
}

const shot = (page, name) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : null)

/** Every note on the canvas, as stored and as drawn. */
function notes(page) {
  return page.evaluate(() => {
    const slate = window.__slateboxInstances.find((s) => s.element.id === 'slateCanvas')
    return slate.nodes.filter(() => true).map((n) => {
      const o = n.options
      const g = n.svgGroup.node
      const painted = g.querySelector('[filter]')
      return {
        id: n.id,
        shape: o.shape,
        vectorPath: typeof o.vectorPath === 'string' ? o.vectorPath.slice(0, 40) : o.vectorPath,
        width: Math.round(o.width),
        height: Math.round(o.height),
        backgroundColor: String(o.backgroundColor).toLowerCase(),
        fontColor: String(o.fontColor || o.foregroundColor).toLowerCase(),
        borderWidth: o.borderWidth,
        borderOpacity: o.borderOpacity,
        effect: o.filters?.vect ?? null,
        drawnFilter: painted?.getAttribute('filter') ?? null,
      }
    })
  })
}

function expectSticky(note, height = 68) {
  expect(note.shape).toBe('roundedrectangle')
  expect(note.width).toBe(160)
  expect(note.height).toBe(height)
  expect(note.backgroundColor).toBe(LEMON)
  expect(note.fontColor).toBe(DARK_TEXT)
  expect(Number(note.borderWidth || 0) === 0 || Number(note.borderOpacity) === 0).toBe(true)
  expect(note.effect).toBe('postItNote')
  expect(String(note.drawnFilter)).toContain('drop-shadow')
}

async function newest(page, before) {
  await expect.poll(async () => (await notes(page)).length, { timeout: 15000 }).toBeGreaterThan(before.length)
  const ids = new Set(before.map((n) => n.id))
  return (await notes(page)).filter((n) => !ids.has(n.id))
}

async function knobOf(page) {
  return page.evaluate(() => {
    const g = document.querySelector('#slateCanvas g.svg_select_handle_rot')
    if (!g) return null
    const c = g.querySelector('circle').getBoundingClientRect()
    const poly = document.querySelector('#slateCanvas .svg_select_shape')
    const pt = (i) => poly.points.getItem(i).matrixTransform(poly.getScreenCTM())
    const lt = pt(0), rt = pt(2), rb = pt(4)
    return {
      x: c.x + c.width / 2, y: c.y + c.height / 2, size: c.width,
      icon: !!g.querySelector('path'),
      corner: { x: rt.x, y: rt.y },
      centre: { x: (lt.x + rb.x) / 2, y: (lt.y + rb.y) / 2 },
    }
  })
}

const around = (c, p, deg) => {
  const a = (deg * Math.PI) / 180, dx = p.x - c.x, dy = p.y - c.y
  return { x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) }
}

async function angleOf(page, id) {
  return page.evaluate((key) => {
    const slate = window.__slateboxInstances.find((s) => s.element.id === 'slateCanvas')
    return slate.nodes.one(key).options.rotate?.rotationAngle ?? 0
  }, id)
}

async function selectNote(page, id) {
  await page.evaluate((key) => {
    const slate = window.__slateboxInstances.find((s) => s.element.id === 'slateCanvas')
    slate.selectNodes([])
    slate.selectNodes([slate.nodes.one(key)])
  }, id)
  await expect(page.locator('#slateCanvas g.svg_select_handle_rot circle')).toBeVisible({ timeout: 10000 })
}

test('desktop 1440: the + menu Sticky Note is the default note in sticky yellow, and stays one', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser, { viewport: { width: 1440, height: 900 } })
  await page.locator('.MuiSpeedDial-fab').hover()
  const tile = page.locator('.MuiSpeedDial-root [aria-label="stickyNote"]')
  await expect(tile).toBeVisible({ timeout: 15000 })
  // The tile is drawn as the note it makes: filled sticky yellow, filling its 24 box like the other tiles.
  expect(await tile.locator('path').getAttribute('fill')).toBe(LEMON)
  const box = await tile.locator('path').evaluate((p) => { const b = p.getBBox(); return { w: b.width, h: b.height } })
  expect(box.w).toBeGreaterThanOrEqual(20)
  expect(box.h).toBeGreaterThanOrEqual(14)
  await page.waitForTimeout(500)
  await shot(page, 'after-plus-menu-1440')
  const before = await notes(page)
  await tile.click()
  const [sticky] = await newest(page, before)
  expectSticky(sticky)
  await page.mouse.move(40, 450)
  await page.waitForTimeout(800)
  await shot(page, 'after-sticky-added-1440')

  // Survives a reload (the save and the load).
  const url = page.url()
  await page.waitForTimeout(2500)
  await page.goto(url)
  await page.waitForFunction((id) => !!window.__slateboxInstances?.find((s) => s.element.id === 'slateCanvas')?.nodes.one(id), sticky.id, { timeout: 60000 })
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {})
  expectSticky((await notes(page)).find((n) => n.id === sticky.id))

  // A copy and paste is a sticky too.
  await selectNote(page, sticky.id)
  let had = await notes(page)
  await page.locator('#slateCanvas').focus().catch(() => {})
  await page.keyboard.press('ControlOrMeta+c')
  await page.keyboard.press('ControlOrMeta+v')
  const [pasted] = await newest(page, had)
  expectSticky(pasted)

  // A sibling added from its right plug takes after it.
  await selectNote(page, sticky.id)
  had = await notes(page)
  await page.evaluate((key) => {
    const slate = window.__slateboxInstances.find((s) => s.element.id === 'slateCanvas')
    slate.nodes.one(key).svgGroup.node.dispatchEvent(new MouseEvent('mouseenter'))
  }, sticky.id)
  const plug = page.locator('#slateCanvas .connection-handle-right').filter({ visible: true }).first()
  await expect(plug).toBeVisible({ timeout: 10000 })
  // (the pasted copy sits over the plug, so the click goes to the plug itself)
  await plug.dispatchEvent('click')
  const [sibling] = await newest(page, had)
  expect(sibling.shape).toBe('roundedrectangle')
  expect(sibling.backgroundColor).toBe(LEMON)
  expect(sibling.effect).toBe('postItNote')

  // The SVG export draws it yellow, rounded and with the shadow, and without the editor's knob.
  const svg = await page.evaluate(() => window.__slateboxInstances.find((s) => s.element.id === 'slateCanvas').svg())
  expect(svg.toLowerCase()).toContain(LEMON)
  expect(svg).toContain('drop-shadow')
  expect(svg).not.toContain('svg_select_handle_rot')

  expect(errors).toEqual([])
  await context.close()
})

test('desktop 1440: the rotate knob is a visible rotate control; drag turns the note, Shift snaps to 15°', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser, { viewport: { width: 1440, height: 900 } })
  await page.locator('.MuiSpeedDial-fab').hover()
  const before = await notes(page)
  await page.locator('.MuiSpeedDial-root [aria-label="stickyNote"]').click()
  const [note] = await newest(page, before)
  await page.mouse.move(40, 450)
  for (const zoom of [0.5, 1, 2]) {
    await page.evaluate((z) => window.__slateboxInstances.find((s) => s.element.id === 'slateCanvas').zoom(z), zoom)
    await page.evaluate(() => window.__slateboxInstances.find((s) => s.element.id === 'slateCanvas').centerContent())
    await page.waitForTimeout(400)
    await selectNote(page, note.id)
    const k = await knobOf(page)
    expect(k.icon).toBe(true)
    // A 68-tall note is 34px on screen at 50%: it gets the small knob (20px), so the knob never dwarfs it.
    expect(Math.abs(k.size - (zoom === 0.5 ? 20 : 28))).toBeLessThan(2)
    expect(k.x).toBeGreaterThan(k.corner.x)
    expect(k.y).toBeLessThan(k.corner.y)
    if (zoom === 1) await shot(page, 'after-knob-1440')
    const start = await angleOf(page, note.id)
    await page.mouse.move(k.x, k.y)
    await page.mouse.down()
    for (const deg of [10, 20, 30]) {
      const p = around(k.centre, k, deg)
      await page.mouse.move(p.x, p.y, { steps: 3 })
    }
    expect(Math.abs((await angleOf(page, note.id)) - start - 30)).toBeLessThanOrEqual(1)
    await expect(page.locator('.slatebox-rotate-readout')).toBeVisible()
    if (zoom === 1) await shot(page, 'after-rotating-1440')
    await page.mouse.up()
    await expect(page.locator('.slatebox-rotate-readout')).toHaveCount(0)
    // Back to 0 for the next zoom.
    await page.evaluate((key) => {
      const slate = window.__slateboxInstances.find((s) => s.element.id === 'slateCanvas')
      slate.nodes.one(key).resizeRotate.rotateTo(0)
    }, note.id)
  }
  await page.evaluate(() => window.__slateboxInstances.find((s) => s.element.id === 'slateCanvas').zoom(1))
  await selectNote(page, note.id)
  const k = await knobOf(page)
  await page.mouse.move(k.x, k.y)
  await page.mouse.down()
  await page.keyboard.down('Shift')
  const p = around(k.centre, k, 37)
  await page.mouse.move(p.x, p.y, { steps: 5 })
  expect(await angleOf(page, note.id)).toBe(30)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  expect(errors).toEqual([])
  await context.close()
})

test('phone 390: the add sheet Sticky Note is the yellow default note; a finger on the knob turns it', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser, { viewport: { width: 390, height: 844 }, touch: true })
  await page.locator('button.sb-add').click()
  const sheet = page.locator('#sb-add-sheet')
  await expect(sheet).toBeVisible({ timeout: 15000 })
  const tile = sheet.getByRole('button', { name: 'Sticky Note' })
  await tile.scrollIntoViewIfNeeded()
  expect(await tile.locator('path').getAttribute('fill')).toBe(LEMON)
  await page.waitForTimeout(500)
  await shot(page, 'after-plus-menu-390')
  const before = await notes(page)
  await tile.click()
  const [sticky] = await newest(page, before)
  expectSticky(sticky)
  await page.waitForTimeout(800)
  await selectNote(page, sticky.id)
  await page.waitForTimeout(400)
  await shot(page, 'after-knob-390')
  const k = await knobOf(page)
  expect(Math.abs(k.size - 28)).toBeLessThan(2)
  const cdp = await context.newCDPSession(page)
  const touch = (type, pt) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pt ? [{ x: Math.round(pt.x), y: Math.round(pt.y) }] : [] })
  await touch('touchStart', k)
  for (const deg of [20, 45, 70, 88]) await touch('touchMove', around(k.centre, k, deg))
  expect(await angleOf(page, sticky.id)).toBe(90)
  await shot(page, 'after-rotating-390')
  await touch('touchEnd')
  await expect(page.locator('.slatebox-rotate-readout')).toHaveCount(0)
  expect(errors).toEqual([])
  await context.close()
})

test('desktop 1440: after a note with big words, the Sticky Note is as tall as the default note for them', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser, { viewport: { width: 1440, height: 900 } })
  await page.locator('.MuiSpeedDial-fab').hover()
  const tile = page.locator('.MuiSpeedDial-root [aria-label="stickyNote"]')
  let before = await notes(page)
  await tile.click()
  const [first] = await newest(page, before)
  expectSticky(first)
  // The last note now has 36px words (the dock copies the last note's font).
  await page.evaluate((key) => {
    const slate = window.__slateboxInstances.find((s) => s.element.id === 'slateCanvas')
    slate.nodes.one(key).options.fontSize = 36
  }, first.id)
  before = await notes(page)
  await page.locator('.MuiSpeedDial-fab').hover()
  await tile.click()
  const [second] = await newest(page, before)
  // The default note at 36px: max(68, 36 * 1.4 + 40) = 90.
  expectSticky(second, 90)
  expect(errors).toEqual([])
  await context.close()
})

test('desktop 1440: a multi-note selection has the same rotate knob; it turns both, Escape puts them back', async ({ browser }) => {
  const { context, page, errors } = await freshSlate(browser, { viewport: { width: 1440, height: 900 } })
  const tile = page.locator('.MuiSpeedDial-root [aria-label="stickyNote"]')
  const ids = []
  for (let i = 0; i < 2; i++) {
    const before = await notes(page)
    await page.locator('.MuiSpeedDial-fab').hover()
    await tile.click()
    const [n] = await newest(page, before)
    ids.push(n.id)
  }
  await page.mouse.move(40, 450)
  // Side by side, then both selected.
  await page.evaluate((keys) => {
    const slate = window.__slateboxInstances.find((s) => s.element.id === 'slateCanvas')
    const [a, b] = keys.map((k) => slate.nodes.one(k))
    b.position((a.options.x || 0) + 240, (a.options.y || 0) + 60)
    slate.selectNodes([])
    slate.selectNodes([a, b])
  }, ids)
  const knob = page.locator('#slateCanvas g.slatebox-group-rotate')
  await expect(knob.locator('circle')).toBeVisible({ timeout: 10000 })
  const k = await knob.evaluate((g) => {
    const c = g.querySelector('circle').getBoundingClientRect()
    const f = g.parentNode.querySelector('rect').getBoundingClientRect()
    return { x: c.x + c.width / 2, y: c.y + c.height / 2, size: c.width, icon: !!g.querySelector('path'), frame: { l: f.left, r: f.right, t: f.top, b: f.bottom } }
  })
  expect(k.icon).toBe(true)
  expect(Math.abs(k.size - 28)).toBeLessThan(2)
  expect(k.x).toBeGreaterThan(k.frame.r)
  expect(k.y).toBeLessThan(k.frame.t)
  await shot(page, 'after-group-knob-1440')
  const centre = { x: (k.frame.l + k.frame.r) / 2, y: (k.frame.t + k.frame.b) / 2 }
  await page.mouse.move(k.x, k.y)
  await page.mouse.down()
  let p = around(centre, k, 30)
  await page.mouse.move(p.x, p.y, { steps: 5 })
  await expect(page.locator('.slatebox-rotate-readout')).toBeVisible()
  await shot(page, 'after-group-rotating-1440')
  for (const id of ids) expect(Math.abs((await angleOf(page, id)) - 30)).toBeLessThanOrEqual(1)
  await page.keyboard.press('Escape')
  for (const id of ids) expect(await angleOf(page, id)).toBe(0)
  await page.mouse.up()
  await expect(page.locator('.slatebox-rotate-readout')).toHaveCount(0)
  // A real turn sticks. (The release redraws the selection: wait for the knob to be drawn again.)
  await expect(knob.locator('circle')).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(300)
  const k2 = await knob.evaluate((g) => { const c = g.querySelector('circle').getBoundingClientRect(); return { x: c.x + c.width / 2, y: c.y + c.height / 2 } })
  await page.mouse.move(k2.x, k2.y)
  await page.mouse.down()
  p = around(centre, k2, 45)
  await page.mouse.move(p.x, p.y, { steps: 5 })
  await page.mouse.up()
  for (const id of ids) expect(Math.abs((await angleOf(page, id)) - 45)).toBeLessThanOrEqual(1)
  expect(errors).toEqual([])
  await context.close()
})
