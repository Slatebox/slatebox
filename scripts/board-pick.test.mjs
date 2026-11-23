// Which board a chat message is about on a slate of many boards (boards S4a, plan §2.4): the board in
// focus, the board of the selection, a board the message names, the only board; otherwise the chat asks.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { boardInMessage, boardNames, forTheSlate, pickBoard, whichBoard } from '../web/app/imports/api/common/board-pick.mjs'

const board = (boardId, title, extra = {}) => ({ boardId, model: { title, lanes: [{ id: 'a', label: 'A' }] }, focus: null, selection: null, preview: null, ...extra })
const retro = board('main', 'Retro')
const sprint = board('b2', 'Sprint board')
const launch = board('b3', 'Launch plan: Q3 launch')

test('a board is called by its title, or the part before a colon', () => {
  assert.deepEqual(boardNames(launch.model), ['launch plan q3 launch', 'launch plan'])
  assert.deepEqual(boardNames(retro.model), ['retro'])
})

test('1. the board in focus takes the message, whatever it names', () => {
  const focused = { ...sprint, focus: 'b2' }
  assert.equal(pickBoard([retro, focused], 'on the Retro board, add a column called Blocked').board, focused)
})

test('2. then the board of the card or lane selected on it', () => {
  const selected = { ...retro, selection: { kind: 'lane', id: 'a' } }
  assert.equal(pickBoard([selected, sprint], 'add a column called Blocked').board, selected)
  // A preview waiting on a board keeps the chat on it until Keep or Discard.
  const waiting = { ...sprint, preview: { workshop: {} } }
  assert.equal(pickBoard([selected, waiting], 'add a column called Blocked').board, waiting)
})

test('3. then a board the message names, at its start or end, and the naming is taken off', () => {
  assert.deepEqual(pickBoard([retro, sprint], 'On the Sprint board, add a column called Blocked'), { board: sprint, message: 'add a column called Blocked' })
  assert.deepEqual(pickBoard([retro, sprint], 'add a column called Blocked on the retro'), { board: retro, message: 'add a column called Blocked' })
  assert.deepEqual(pickBoard([retro, sprint, launch], 'in launch plan: move go-live to 23 Dec'), { board: launch, message: 'move go-live to 23 Dec' })
  // A name in the middle of a sentence is a card's words, not the board's.
  assert.equal(boardInMessage([retro, sprint], 'add a card called Sprint retro notes'), null)
})

test('4. the only board takes every message; 5. otherwise the chat asks which, one chip per board', () => {
  assert.equal(pickBoard([retro], 'add a column called Blocked').board, retro)
  const asked = pickBoard([retro, sprint], 'add a column called Blocked')
  assert.deepEqual(asked.ask, [retro, sprint])
  assert.equal(whichBoard(asked.ask), 'Which board, Retro or Sprint board?')
  assert.equal(whichBoard([retro, sprint, launch]), 'Which board, Retro, Sprint board or Launch plan: Q3 launch?')
  // The board picked from the chips takes the message as it was typed.
  assert.deepEqual(pickBoard([retro, sprint], 'add a column called Blocked', sprint), { board: sprint, message: 'add a column called Blocked' })
})

test('a message for the slate itself (notes, a drawing, a question) goes to the slate: no "Which board?"', () => {
  const launchPlan = board('main', 'Launch plan'), path = board('b2', 'Decision path')
  for (const said of ['add 3 notes about risks', 'Can you add a few sticky notes on hiring?', 'add two notes', 'add notes: Budget, Venue and Catering',
    'draw a flowchart of our onboarding', 'Idea -> Draft -> Ship', 'what should we focus on this quarter?']) {
    assert.deepEqual(pickBoard([launchPlan, path], said), { slate: true, message: said }, said)
  }
  // A change to a board still asks which; so does a question or notes put into what a board holds.
  for (const said of ['add a column called Blocked', 'add a note called Blocked to the Todo lane', 'how many cards are in Doing?', 'what can this board do?']) {
    assert.deepEqual(pickBoard([launchPlan, path], said).ask, [launchPlan, path], said)
  }
  // Only a plain drawing request can be the slate's: a new board, an interactive route or a library entry is read elsewhere.
  assert.equal(forTheSlate('add 3 notes about risks', 'play'), false)
  // A board in focus, selected or named still takes notes asked for there (its own chat sends them to the slate).
  assert.equal(pickBoard([{ ...launchPlan, focus: 'main' }, path], 'add 3 notes about risks').board.boardId, 'main')
  // The chat passes how the slate's conversation reads the message.
  const chat = readFileSync(new URL('../web/app/imports/ui/components/workshop/WorkshopConversation.jsx', import.meta.url), 'utf8')
  assert.match(chat, /pickBoard\(boards, said, chosen, nativeRequestKind\(said\)\)/)
  assert.match(chat, /onSlate \? await drawOnSlate\(said\)/)
})

test('the board chat adds a library entry beside the boards, and says "Add on a new slate" only at 8 boards', () => {
  const app = (path) => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')
  const chat = app('imports/ui/components/workshop/WorkshopConversation.jsx')
  assert.match(chat, /pickBoard\(boards, said, chosen, nativeRequestKind\(said\)\)/)
  assert.match(chat, /Add it beside this board/)
  assert.doesNotMatch(chat, /This slate has a board already/)
  const view = app('imports/ui/components/library/LibraryView.jsx')
  assert.match(view, /full \? 'Add on a new slate' : 'Add'/)
  assert.match(view, /hasBoard \? 'Add beside the board'/)
  assert.doesNotMatch(view, /This slate already has a board/)
})
