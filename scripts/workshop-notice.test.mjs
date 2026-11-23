import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { standingLines, noticeAfter, noticeKeeper } from '../web/app/imports/api/common/workshop-notice.mjs'

const map = (cardLane, outcomes = {}) => ({
  lanes: [
    { id: 'welcome', label: 'Welcome!', station: { outcome: outcomes.welcome ?? 'Welcome!' } },
    { id: 'next', label: 'Next step', station: { outcome: outcomes.next ?? 'Next step' } },
  ],
  cards: [{ id: 'c', label: 'asdfasdfasdfasdfasdfaasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdf', laneId: cardLane }],
})

test('a move that only says where a card now is shows nothing: the board already shows it', () => {
  const before = standingLines(map('welcome'), [])
  const after = standingLines(map('next'), [])
  assert.equal(noticeAfter(before, after), null)
})

test('a move into a stop that says what happens there shows that, once, without the card\'s own text', () => {
  const outcomes = { next: 'The customer sent 50 rows. Three are missing an owner.' }
  const notice = noticeAfter(standingLines(map('welcome', outcomes), []), standingLines(map('next', outcomes), []))
  assert.deepEqual(notice, { place: 'Next step', text: 'The customer sent 50 rows. Three are missing an owner.' })
  // Nothing new: nothing to show.
  assert.equal(noticeAfter(standingLines(map('next', outcomes), []), standingLines(map('next', outcomes), [])), null)
})

test('a placement outcome that changes is shown; one that stays is not', () => {
  const board = { lanes: [{ id: 'a', label: 'A' }], cards: [] }
  const before = standingLines(board, [{ id: 's', label: 'Owner', text: 'Still in the interview notes.' }])
  const after = standingLines(board, [{ id: 's', label: 'Owner', text: 'Mara will test whether Jo can import a list.' }])
  assert.deepEqual(noticeAfter(before, after), { place: 'Owner', text: 'Mara will test whether Jo can import a list.' })
})

test('the canvas no longer echoes the last moved card in a line under the board; the words stay for screen readers', () => {
  const chrome = readFileSync(new URL('../web/app/imports/ui/components/workshop/WorkshopChrome.jsx', import.meta.url), 'utf8')
  // The regions a screen reader follows are kept, inside a visually hidden box.
  assert.match(chrome, /aria-label="Where things stand" aria-live="polite"/)
  assert.match(chrome, /aria-label="Placement outcomes" aria-live="polite"/)
  assert.match(chrome, /visuallyHidden/)
  // A long card name or reason never stretches a bar: words break and the notice holds two lines.
  assert.match(chrome, /WebkitLineClamp: 2/)
  // A refusal shows whole when tapped or focused: it can take focus, and focus lifts the clamp.
  assert.match(chrome, /'&:focus': \{ display: 'block', overflow: 'visible', WebkitLineClamp: 'none' \}/)
  assert.equal((chrome.match(/role="alert" tabIndex=\{0\}/g) || []).length, 2)
  // Placement outcomes, drawn nowhere on the board, are listed from a button at its corner.
  assert.match(chrome, /aria-expanded=\{listed\}/)
})

test('a notice goes when the card leaves the stop it names, even before its time is up', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const outcomes = { next: '47 records are ready' }
  const shown = []
  const keeper = noticeKeeper((notice) => shown.push(notice), 6000)
  const atWelcome = standingLines(map('welcome', outcomes), [])
  const atNext = standingLines(map('next', outcomes), [])
  keeper.change(atWelcome, atNext)
  assert.deepEqual(shown.at(-1), { place: 'Next step', text: '47 records are ready' })
  // Undone two seconds later: the card is back at Welcome!, which adds nothing, and the notice goes now.
  t.mock.timers.tick(2000)
  keeper.change(atNext, atWelcome)
  assert.equal(shown.at(-1), null)
  // Nothing comes back later either.
  const count = shown.length
  t.mock.timers.tick(10000)
  assert.equal(shown.length, count)
})

test('a notice left alone goes after its time; a newer one restarts the time; leaving the board stops it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const board = { lanes: [{ id: 'a', label: 'A' }], cards: [] }
  const say = (text) => standingLines(board, [{ id: 's', label: 'Owner', text }])
  const shown = []
  const keeper = noticeKeeper((notice) => shown.push(notice), 6000)
  keeper.change(say('one'), say('two'))
  t.mock.timers.tick(5000)
  keeper.change(say('two'), say('three'))
  t.mock.timers.tick(5000)
  assert.deepEqual(shown.at(-1), { place: 'Owner', text: 'three' })
  t.mock.timers.tick(1000)
  assert.equal(shown.at(-1), null)
  keeper.change(say('three'), say('four'))
  keeper.stop()
  const count = shown.length
  t.mock.timers.tick(10000)
  assert.equal(shown.length, count)
})
