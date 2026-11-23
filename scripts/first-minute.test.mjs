// Polish slice 3, "First minute" (work-polish/audit.md #6, #14, #15, #17): a new slate opens on a
// designed welcome instead of a lone "Welcome!" note, with a calm loading moment and the phone's Ask
// sheet at its top; the library finds maps and plans by the words people search with; there is one
// way to browse at a time; and Ask Slatebox reads as a conversation, anchored at its foot, with
// replies in sentences.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { catalog } from 'slateboxjs/catalog'
import { searchEntries, inGroup } from '../web/app/imports/api/common/library.mjs'
import { keptReply, asSentence, listWords } from '../web/app/imports/api/common/chat-words.mjs'

const app = (path) => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')
const ui = (path) => app('imports/ui/' + path)
const ids = (query, group = 'all') => searchEntries(query, group).map((entry) => entry.id)
const addSay = (id) => catalog.find((entry) => entry.id === id).addSay[0]

test('#14 "map" finds the maps, the map itself first', () => {
  const found = ids('map')
  assert.equal(found[0], 'decision-path', found.join())
  // A tree is a map of a problem: they come after the map, never before it.
  assert.ok(found.includes('discovery-tree'), found.join())
  assert.ok(found.indexOf('decision-path') < found.indexOf('discovery-tree'))
  // The plural and a flow find it too.
  assert.equal(ids('maps')[0], 'decision-path')
  assert.equal(ids('flow')[0], 'decision-path')
  assert.equal(ids('Flowchart')[0], 'decision-path')
})

test('#14 "plan" ranks the plans by name, then the Plan group, then a synonym', () => {
  const found = ids('plan')
  assert.deepEqual(found.slice(0, 2).sort(), ['hiring-plan', 'launch-plan'], found.join())
  for (const id of ['customer-go-live', 'budget', 'goals-owners', 'now-next-later']) assert.ok(found.includes(id), id)
  assert.ok(found.indexOf('budget') > found.indexOf('launch-plan'))
  assert.deepEqual(ids('plans').slice(0, 2).sort(), ['hiring-plan', 'launch-plan'])
  // Words people use for a plan or a map that are no entry's name.
  assert.equal(ids('roadmap')[0], 'now-next-later')
  assert.ok(ids('timeline').includes('launch-plan'))
  assert.equal(ids('org chart')[0], 'reorg-sandbox')
  // Every word must match, and a word that matches nothing finds nothing.
  assert.deepEqual(ids('retro meeting').slice(0, 1), ['retro'])
  assert.deepEqual(ids('zebra'), [])
  // No words: the whole library in its own order.
  assert.deepEqual(ids(''), catalog.map((entry) => entry.id))
})

test('#14 the Map chip lists the map; every other chip is the catalogue group', () => {
  assert.ok(ids('', 'map').includes('decision-path'))
  assert.ok(inGroup(catalog.find((entry) => entry.id === 'decision-path'), 'decide'))
  assert.deepEqual(ids('', 'meetings'), catalog.filter((entry) => entry.group === 'meetings').map((entry) => entry.id))
  assert.deepEqual(ids('retro', 'plan'), [])
  // The chip row wraps: nothing is cut off at the panel's edge.
  const view = ui('components/library/LibraryView.jsx')
  assert.match(view, /aria-label="Groups" sx=\{\{[^}]*flexWrap: 'wrap'/)
  assert.doesNotMatch(view, /aria-label="Groups" sx=\{\{[^}]*overflowX/)
  assert.match(view, /searchEntries\(query, group\)/)
})

test('#17 a kept board is said in a sentence, not a log line', () => {
  const retro = { component: 'retro', title: 'Retro', format: 'lanes', labels: ['Went well', 'Change', 'Try'],
    rules: ['Went well holds 3.', 'Change holds 3.', 'Try holds 3.'], capacities: [] }
  assert.equal(keptReply(retro, { addSay: addSay('retro') }), 'Added a retro: Went well, Change and Try, up to three cards each.')
  // Without the catalogue to hand, the title says it.
  assert.equal(keptReply(retro), 'Added a retro: Went well, Change and Try, up to three cards each.')
  const pros = { component: 'pros-cons', title: 'Pros and cons', format: 'lanes', labels: ['Pros', 'Cons', 'Questions'],
    rules: [], capacities: [] }
  assert.equal(keptReply(pros, { addSay: addSay('pros-cons') }), 'Added pros and cons: Pros, Cons and Questions.')
  // The canvas's "No rules" line, if a board sends it, is said plainly.
  assert.equal(keptReply({ ...pros, rules: ['No rules: any card goes in any lane.'] }, { addSay: addSay('pros-cons') }),
    'Added pros and cons: Pros, Cons and Questions. Any card goes in any lane.')
  const team = { component: 'team-board', title: 'Team board', format: 'lanes', labels: ['To do', 'Doing', 'Review', 'Done', "Won't do"],
    rules: ['Cards move one lane at a time.', 'Doing holds 3.', "Won't do archives cards: they stay on the board, never deleted."], capacities: [] }
  assert.equal(keptReply(team, { addSay: addSay('team-board') }),
    "Added a team board: To do, Doing, Review, Done and Won't do. Cards move one lane at a time. Doing holds 3. Won't do archives cards: they stay on the board, never deleted.")
  const nnl = { component: 'now-next-later', title: 'Now, next, later', format: 'lanes', labels: ['Now', 'Next', 'Later'], rules: ['Next holds 3.'], capacities: [] }
  assert.equal(keptReply(nnl, { addSay: addSay('now-next-later') }), 'Added a Now / Next / Later board: Now, Next and Later. Next holds 3.')
  const path = { component: 'decision-path', title: 'Decision path', format: 'map', mode: 'play', labels: ['Question', 'Option A', 'Option B'], rules: [], links: 2 }
  assert.equal(keptReply(path, { addSay: addSay('decision-path') }), 'Added a decision path: Question → Option A → Option B.')
})

test('#17 drawings, routes, workshops and business boards read as sentences too', () => {
  assert.equal(keptReply({ format: 'map', mode: 'play', labels: ['Intake', 'Review', 'Send'], links: 2 }), 'Added a playable route: Intake → Review → Send.')
  assert.equal(keptReply({ format: 'map', labels: ['Intake', 'Review'], links: 1 }), 'Drew Intake → Review, with 1 connection.')
  assert.equal(keptReply({ format: 'map', labels: ['Idea'], links: 0 }), 'Drew Idea.')
  assert.equal(keptReply({ format: 'lanes', labels: ['To do', 'Doing', 'Done'], capacities: [{ label: 'Doing', capacity: 2 }] }),
    'Added a workshop: To do, Doing and Done. Doing holds up to 2 cards.')
  // A board read from a person's own words keeps the server's words, made a sentence.
  const said = 'Added a launch plan · Product → Engineering · launch day 14'
  assert.equal(keptReply({ format: 'launch-plan', said, labels: [] }), 'Added a launch plan: Product → Engineering, launch day 14.')
  assert.equal(asSentence('Added a budget · Product → Sales → Design · $1.2M · balanced'), 'Added a budget: Product → Sales → Design, $1.2M, balanced.')
  assert.equal(asSentence('Moved “Alpha” to “Done”.'), 'Moved “Alpha” to “Done”.')
  assert.equal(listWords(['A']), 'A')
  assert.equal(listWords(['A', 'B']), 'A and B')
  // A long route is counted, not listed.
  const long = keptReply({ format: 'map', mode: 'play', labels: ['1', '2', '3', '4', '5', '6', '7'], links: 6 })
  assert.equal(long, 'Added a playable route with 7 steps, from 1 to 7.')
})

test('#17 the conversation is anchored at its foot; the first turn and the library open at their top', () => {
  const panel = ui('components/ConversationPanel.jsx')
  assert.match(panel, /anchor = 'bottom'/)
  // The conversation grows up from the message box, as chat does, and scrolls there only when anchored at the foot.
  assert.match(panel, /mt: anchor === 'bottom' \? 'auto' : 0/)
  assert.match(panel, /if \(anchor !== 'bottom'\)/)
  const native = ui('components/NativeCanvasConversation.jsx')
  assert.match(native, /anchor=\{firstTurn \? 'top' : 'bottom'\}/)
  assert.match(native, /<ConversationPanel anchor="top"/)
  assert.match(native, /keptReply\(draft/)
  assert.doesNotMatch(native, /'Added ' \+ draft\.title/)
  const workshop = ui('components/workshop/WorkshopConversation.jsx')
  assert.match(workshop, /<ConversationPanel anchor="top"/)
  // Turns are bubbles: one component, used by both conversations, with who said it for a screen reader.
  const turn = ui('components/ChatTurn.jsx')
  assert.match(turn, /visuallyHidden/)
  assert.match(turn, /prefers-reduced-motion/)
  for (const source of [native, workshop]) {
    assert.match(source, /<ChatTurn who="you"/)
    assert.match(source, /<ChatTurn who="slatebox"/)
    assert.match(source, /<ChatThinking/)
  }
})

test('#15 one way to browse at a time: no strip under the library or under the first turn\'s cards', () => {
  const native = ui('components/NativeCanvasConversation.jsx')
  assert.match(native, /\{!view && !firstTurn && <AddStrip/)
  const workshop = ui('components/workshop/WorkshopConversation.jsx')
  assert.match(workshop, /\{!hold && !view && <AddStrip/)
})

test('#6 a new slate starts with no note; a designed welcome invites the first action', () => {
  const create = app('imports/api/client/createSlate.js')
  assert.doesNotMatch(create, /'Welcome!'/)
  // A theme still styles a first note (it is what the theme is applied to); a plain slate starts empty.
  assert.match(create, /if \(createWithTheme\) \{/)
  const welcome = ui('components/SlateWelcome.jsx')
  assert.match(welcome, /Your slate is ready/)
  assert.match(welcome, /Add a note/)
  assert.match(welcome, /Pick a board/)
  assert.match(welcome, /aria-labelledby/)
  // The tile mark arrives, its tiles settling in once; on a short canvas (a phone's, above the sheet) the card is compact.
  assert.match(welcome, /<TileLoader once/)
  assert.match(welcome, /@container \(max-height/)
  // It goes as soon as the slate holds anything, and it never covers the canvas around it.
  assert.match(welcome, /MutationObserver/)
  assert.match(welcome, /pointerEvents: 'none'/)
  // Plain, warm words: no all-caps placeholders.
  assert.doesNotMatch(welcome, /\b[A-Z]{4,}\b(?![a-z])/)
  const canvas = ui('pages/Canvas.jsx')
  assert.match(canvas, /<SlateWelcome /)
  // The note it adds is the shared default: AA text in both modes.
  assert.match(welcome, /DEFAULT_NOTE/)
})

test('#6 the minimap shows only when the slate is bigger than the screen', () => {
  const hook = ui('common/useMinimapWhenNeeded.js')
  assert.match(hook, /data-whole-in-view/)
  assert.match(hook, /viewBox/)
  assert.match(ui('pages/Canvas.jsx'), /useMinimapWhenNeeded\(/)
})

test('#6 a calm loading moment: the tile mark, centred, still for reduced motion', () => {
  const loading = ui('components/SlateLoading.jsx')
  assert.match(loading, /role="status"/)
  assert.match(loading, /Opening your slate…/)
  assert.match(loading, /prefers-reduced-motion/)
  assert.match(ui('pages/GetStarted.jsx'), /<SlateLoading/)
  assert.doesNotMatch(ui('pages/GetStarted.jsx'), /<Typography role="status">Opening your slate…<\/Typography>/)
})
