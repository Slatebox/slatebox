import test from 'node:test'
import assert from 'node:assert/strict'
import { ARRIVAL_SETTLE_MS, toggledConversation, arrivalShown } from '../web/app/imports/api/common/conversation-toggle.mjs'

// "Ask Slatebox" works as soon as its button is in sight. A slate may open its conversation by itself
// as it loads, but the conversation's code arrives on its own: until it is in sight (and a moment
// after, the time a person takes to see it), a tap on the button opens it rather than closing it.
test('a closed conversation opens on a tap', () => {
  assert.equal(toggledConversation({ open: false, arrival: null, now: 0 }), true)
  assert.equal(toggledConversation({ open: false, arrival: { shownAt: null }, now: 0 }), true)
})

test('a conversation the slate opened by itself, still on its way, stays open on a tap', () => {
  assert.equal(toggledConversation({ open: true, arrival: { shownAt: null }, now: 5000 }), true)
})

test('just in sight, a tap is still the one meant to open it; settled, a tap closes it', () => {
  assert.equal(toggledConversation({ open: true, arrival: { shownAt: 1000 }, now: 1000 + ARRIVAL_SETTLE_MS - 1 }), true)
  assert.equal(toggledConversation({ open: true, arrival: { shownAt: 1000 }, now: 1000 + ARRIVAL_SETTLE_MS }), false)
})

test('opened by the person (no arrival), a tap closes it at once', () => {
  assert.equal(toggledConversation({ open: true, arrival: null, now: 0 }), false)
})

test('the arrival is marked in sight once, when the conversation first shows', () => {
  assert.deepEqual(arrivalShown({ shownAt: null }, 42), { shownAt: 42 })
  const shown = { shownAt: 7 }
  assert.equal(arrivalShown(shown, 42), shown)
  assert.equal(arrivalShown(null, 42), null)
})

test('the settle is under a second', () => {
  assert.ok(ARRIVAL_SETTLE_MS > 0 && ARRIVAL_SETTLE_MS < 1000)
})
