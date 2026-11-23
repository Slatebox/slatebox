import test from 'node:test'
import assert from 'node:assert/strict'
import { carried, sheetBackAfterDrop, watchNoteDrag } from '../web/app/imports/api/common/sheet-drag.mjs'

// fix/phone-sheet-canvas: on a phone, a note or card carried on the canvas minimises Ask Slatebox.

test('a note or a card is carried; a board’s own parts and grips are not', () => {
  for (const id of ['n4f8a21c0', 'card-token', 'card-design']) assert.equal(carried(id), true, id)
  for (const id of ['column-decide', 'lane-q', 'caption-q', 'handle-design', 'handle-_start-design', 'handle-_link-option-b', 'handle-launch', '', null, undefined])
    assert.equal(carried(id), false, String(id))
})

function canvas() {
  const root = new EventTarget()
  const node = id => ({ closest: () => (id ? { getAttribute: () => id } : null) })
  // A pointer event's fields, `target` included (an Event's own is a getter): what the listener reads.
  const fire = (type, props) => {
    const event = new Event(type)
    for (const [key, value] of Object.entries({ isPrimary: true, button: 0, pointerId: 1, ...props })) Object.defineProperty(event, key, { value })
    root.dispatchEvent(event)
  }
  return { root, node, fire }
}

test('a note pressed and moved past 8px minimises once; a press that stays put does not', () => {
  const { root, node, fire } = canvas()
  let carries = 0
  const stop = watchNoteDrag(root, () => { carries += 1 })
  fire('pointerdown', { target: node('n1'), clientX: 100, clientY: 100 })
  fire('pointermove', { clientX: 104, clientY: 103 })
  assert.equal(carries, 0, 'a tap that wobbles is not a drag')
  fire('pointermove', { clientX: 106, clientY: 108 })
  fire('pointermove', { clientX: 140, clientY: 160 })
  assert.equal(carries, 1, 'one drag, one minimise')
  fire('pointerup', {})
  fire('pointermove', { clientX: 300, clientY: 300 })
  assert.equal(carries, 1, 'after the drop, moving the pointer is nothing')
  stop()
  fire('pointerdown', { target: node('n1'), clientX: 0, clientY: 0 })
  fire('pointermove', { clientX: 50, clientY: 50 })
  assert.equal(carries, 1, 'stopped: nothing heard')
})

test('a pan of empty canvas, a step dragged, a grip, a second finger or a right button leave the sheet alone', () => {
  const { root, node, fire } = canvas()
  let carries = 0
  watchNoteDrag(root, () => { carries += 1 })
  const drag = (down, move = {}) => {
    fire('pointerdown', { clientX: 0, clientY: 0, ...down })
    fire('pointermove', { clientX: 60, clientY: 60, pointerId: down.pointerId ?? 1, ...move })
    fire('pointerup', {})
  }
  drag({ target: node(null) })
  drag({ target: node('column-decide') })
  drag({ target: node('handle-_link-option-b') })
  drag({ target: node('n1'), isPrimary: false })
  drag({ target: node('n1'), button: 2 })
  drag({ target: node('n1') }, { pointerId: 2 })
  assert.equal(carries, 0)
  drag({ target: node('card-token') })
  assert.equal(carries, 1)
})

test('a cancelled pointer (the browser took the touch) ends the drag', () => {
  const { root, node, fire } = canvas()
  let carries = 0
  watchNoteDrag(root, () => { carries += 1 })
  fire('pointerdown', { target: node('n1'), clientX: 0, clientY: 0 })
  fire('pointercancel', {})
  fire('pointermove', { clientX: 60, clientY: 60 })
  assert.equal(carries, 0)
})

test('the drop of a carried note is told where it was let go; a press that never became a drag is not', () => {
  const { root, node, fire } = canvas()
  const drops = []
  watchNoteDrag(root, () => {}, { onDrop: (at) => drops.push(at) })
  fire('pointerdown', { target: node('n1'), clientX: 10, clientY: 10 })
  fire('pointerup', { clientX: 12, clientY: 11 })
  assert.deepEqual(drops, [], 'a tap')
  fire('pointerdown', { target: node('n1'), clientX: 10, clientY: 10 })
  fire('pointermove', { clientX: 60, clientY: 300 })
  fire('pointermove', { clientX: 70, clientY: 520 })
  fire('pointerup', { clientX: 70, clientY: 520 })
  assert.deepEqual(drops, [{ x: 70, y: 520 }])
  fire('pointerdown', { target: node('card-a'), clientX: 10, clientY: 10 })
  fire('pointermove', { clientX: 60, clientY: 60 })
  fire('pointercancel', {})
  assert.equal(drops.length, 1, 'a cancelled drag drops nothing')
})

test('the sheet comes back after the drop when the note stays in sight above it', () => {
  // The sheet's top was at 455 when it went down; the note is let go with some of it below the pointer.
  assert.equal(sheetBackAfterDrop({ y: 300 }, 455), true)
  assert.equal(sheetBackAfterDrop({ y: 420 }, 455), false, 'too close: the sheet would cover the note')
  assert.equal(sheetBackAfterDrop({ y: 600 }, 455), false, 'dropped in the sheet’s room')
  assert.equal(sheetBackAfterDrop({ y: 300 }, null), false, 'no sheet top known')
})
