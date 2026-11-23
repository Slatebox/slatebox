import assert from 'node:assert/strict'
import test from 'node:test'
import { placeBar, barMode, NOTE_BAR_WIDTH } from '../web/app/imports/api/common/note-style.mjs'
import { cardBar } from '../web/app/imports/api/common/note-style.mjs'

const canvas = (left, width, top = 64, height = 836) => ({ left, top, right: left + width, bottom: top + height, width, height })
const frame = (left, top, width = 220, height = 120, topClearance = 52) =>
  ({ kind: 'node', rect: { left, top, width, height, right: left + width, bottom: top + height }, topClearance, moving: false })

test('the bar sits 12px above the top connect dot, centred on the note', () => {
  const f = frame(560, 460)
  const at = placeBar({ frame: f, bar: { width: 714, height: 48 }, canvas: canvas(0, 1440) })
  assert.equal(at.below, false)
  assert.equal(at.top + 48, 460 - 52 - 12)
  assert.equal(at.left, 560 + 110 - 714 / 2)
})

test('with no room above it flips below the note, clear of the bottom dot', () => {
  const f = frame(560, 90)
  const at = placeBar({ frame: f, bar: { width: 714, height: 48 }, canvas: canvas(0, 1440) })
  assert.equal(at.below, true)
  assert.ok(at.top >= 90 + 120 + 12)
})

test('the bar stays inside the visible canvas, never under the panel beside it', () => {
  for (const [width, panel] of [[1440, 0], [1280, 0], [1024, 0], [1024, 344], [1280, 375], [1440, 375]]) {
    const c = canvas(0, width - panel)
    for (const x of [-100, 0, 300, c.right - 80, c.right + 50]) {
      const mode = barMode({ kind: 'note', canvasWidth: c.width })
      const barWidth = NOTE_BAR_WIDTH[mode]
      const at = placeBar({ frame: frame(x, 400), bar: { width: barWidth, height: 48 }, canvas: c })
      // A note wholly off the canvas (behind the panel) has no bar at all.
      if (!at) { assert.ok(x > c.right, `${width}/${panel} at ${x}: hidden while on the canvas`); continue }
      assert.ok(at.left >= c.left + 8, `${width}/${panel} at ${x}: ${at.left}`)
      assert.ok(at.left + barWidth <= c.right - 8, `${width}/${panel} at ${x}: ${at.left + barWidth} > ${c.right}`)
    }
  }
})

test('compact when the full bar is wider than the canvas less 32px; phone under 600px', () => {
  assert.equal(barMode({ kind: 'note', canvasWidth: 1440 }), 'full')
  // The full note bar is 786 wide since it carries the Line button (owner, 2026-11-21; it was 714).
  assert.equal(barMode({ kind: 'note', canvasWidth: 786 + 32 }), 'full')
  assert.equal(barMode({ kind: 'note', canvasWidth: 786 + 31 }), 'compact')
  assert.equal(barMode({ kind: 'note', canvasWidth: 680 }), 'compact')
  assert.equal(barMode({ kind: 'note', canvasWidth: 390, phone: true }), 'phone')
  assert.ok(NOTE_BAR_WIDTH.compact <= 680 - 32)
})

test('a frame that is moving hides the bar; a note scrolled off the canvas hides it', () => {
  assert.equal(placeBar({ frame: { ...frame(560, 460), moving: true }, bar: { width: 714, height: 48 }, canvas: canvas(0, 1440) }), null)
  assert.equal(placeBar({ frame: frame(2000, 460), bar: { width: 714, height: 48 }, canvas: canvas(0, 1440) }), null)
  assert.equal(placeBar({ frame: { kind: 'none', rect: null }, bar: { width: 714, height: 48 }, canvas: canvas(0, 1440) }), null)
})

test('a workshop card: only lanes it may go to, a move per lane, no colour or shape, a reader sees only Ask', () => {
  const workshop = {
    lanes: [{ id: 'ask', label: 'To ask' }, { id: 'int', label: 'Interviewing' }, { id: 'done', label: 'Done' }],
    cards: [{ id: 'c1', label: 'Initech', laneId: 'int' }],
  }
  const destinations = () => [workshop.lanes[0], workshop.lanes[1]]
  const bar = cardBar({ workshop, cardId: 'c1', destinations, editable: true, canEdit: true, author: false, conversation: true })
  assert.deepEqual(bar.lanes.map(l => [l.id, l.here]), [['ask', false], ['int', true]])
  assert.equal(bar.moveLabel, 'Move to: Interviewing')
  assert.deepEqual(bar.controls, ['edit', 'move', 'ask'])
  assert.equal(bar.controls.includes('colour'), false)
  const author = cardBar({ workshop, cardId: 'c1', destinations, editable: true, canEdit: true, author: true, conversation: true })
  assert.deepEqual(author.controls, ['edit', 'move', 'ask', 'remove'])
  const reader = cardBar({ workshop, cardId: 'c1', destinations, editable: false, canEdit: false, author: false, conversation: true })
  assert.deepEqual(reader.controls, ['ask'])
  const noAsk = cardBar({ workshop, cardId: 'c1', destinations, editable: false, canEdit: false, author: false, conversation: false })
  assert.deepEqual(noAsk.controls, [])
})

test('a card bar sits above its lane; with no room there, above the card itself, never below it', () => {
  const card = frame(560, 300, 220, 60, 44)
  const above = placeBar({ frame: card, bar: { width: 438, height: 44 }, canvas: canvas(0, 1440), anchorTop: 200 })
  assert.equal(above.top, 200 - 44 - 12 - 44)
  // No room above the lane: as high as the canvas allows (over as little of the lane title as it can).
  const high = placeBar({ frame: card, bar: { width: 438, height: 44 }, canvas: canvas(0, 1440), anchorTop: 80 })
  assert.equal(high.below, false)
  assert.equal(high.top, 64 + 8)
  // A card right at the top: placed for the card itself.
  const top = placeBar({ frame: frame(560, 90, 220, 60, 44), bar: { width: 438, height: 44 }, canvas: canvas(0, 1440), anchorTop: 70 })
  assert.equal(top.below, true)
})

const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height })

test('a line\'s bar covers neither the line nor the notes at its ends', () => {
  // The attack's case: Welcome! at the default spot, Beta to its lower right, the line between them.
  const welcome = rect(658, 447, 123, 69)
  const beta = rect(940, 615, 120, 70)
  const line = { kind: 'line', rect: rect(775, 510, 165, 105), topClearance: 10, moving: false, avoid: [welcome, beta] }
  for (const width of [549, 360]) {
    const at = placeBar({ frame: line, bar: { width, height: 44 }, canvas: canvas(0, 1440) })
    const box = rect(at.left, at.top, width, 44)
    for (const r of [line.rect, welcome, beta]) assert.ok(!overlaps(box, r), `bar ${JSON.stringify(box)} covers ${JSON.stringify(r)}`)
  }
  // The start note at the top edge: no room above anything, so the bar goes below all of it.
  const top = rect(400, 70, 160, 80)
  const end = rect(700, 300, 160, 80)
  const steep = { kind: 'line', rect: rect(560, 110, 140, 230), topClearance: 10, moving: false, avoid: [top, end] }
  const at = placeBar({ frame: steep, bar: { width: 549, height: 44 }, canvas: canvas(0, 1440) })
  const box = rect(at.left, at.top, 549, 44)
  for (const r of [steep.rect, top, end]) assert.ok(!overlaps(box, r), `bar ${JSON.stringify(box)} covers ${JSON.stringify(r)}`)
})
