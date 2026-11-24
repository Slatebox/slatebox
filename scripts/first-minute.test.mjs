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
import { presetNoteStyle, dockNoteStyle } from '../web/app/imports/ui/common/noteStyle.mjs'
import { addNoteAt, addNoteInView } from '../web/app/imports/ui/common/newNote.mjs'
import { DEFAULT_NOTE } from '../web/app/imports/ui/common/canvasTheme.mjs'
import { newestTop } from '../web/app/imports/ui/common/newestTurn.mjs'
import { sizeChoice } from '../web/app/imports/api/common/note-style.mjs'

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

test('#14 review: a singular finds its group, everyday words find a board, and the Map chip agrees with a "map" search', () => {
  // "meeting" finds both boards in the Meetings group, as "meetings" does.
  for (const q of ['meeting', 'meetings']) {
    const found = ids(q)
    assert.ok(found.includes('retro') && found.includes('incident-review'), `${q}: ${found.join()}`)
  }
  assert.equal(ids('todo')[0], 'team-board')
  assert.equal(ids('to-do')[0], 'team-board')
  assert.equal(ids('standup')[0], 'team-board')
  assert.ok(ids('brainstorm').includes('discovery-tree'))
  assert.ok(ids('risk').includes('pros-cons'))
  assert.ok(ids('swot').includes('pros-cons'))
  // A "map" search leads with what the Map chip lists, map first (a part of a word, "roadmap", comes after).
  const chip = ids('', 'map')
  assert.deepEqual(ids('map').slice(0, chip.length).sort(), [...chip].sort())
  assert.equal(ids('', 'map')[0], 'decision-path')
  assert.ok(!ids('map').includes('reorg-sandbox'))
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
    'Added a board: To do, Doing and Done. Doing holds up to 2 cards.')
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

/** A stand-in for the conversation's scrolling area: turns at given tops and heights (px). */
function history(clientHeight, turns) {
  const els = turns.map(([who, top]) => ({ dataset: { chatTurn: who }, getBoundingClientRect: () => ({ top }) }))
  const [, lastTop, lastHeight] = turns[turns.length - 1]
  return { clientHeight, scrollTop: 0, scrollHeight: lastTop + lastHeight, querySelectorAll: () => els, getBoundingClientRect: () => ({ top: 0 }) }
}

test('#17 review: a reply taller than a phone\'s conversation opens at the question it answers, not its foot', () => {
  const panel = ui('components/ConversationPanel.jsx')
  assert.match(panel, /el\.scrollTop = newestTop\(el\) \?\? el\.scrollHeight/)
  assert.match(ui('components/ChatTurn.jsx'), /data-chat-turn=\{who\}/)
  // 200px of history: "Add a retro" at 300, a 400px preview reply under it: scroll to the question.
  assert.equal(newestTop(history(200, [['slatebox', 0, 280], ['you', 300, 40], ['slatebox', 350, 400]])), 292)
  // A short reply: the foot, as before.
  assert.equal(newestTop(history(200, [['you', 300, 40], ['slatebox', 350, 60]])), null)
  // Just sent: the foot.
  assert.equal(newestTop(history(200, [['slatebox', 0, 280], ['you', 300, 40]])), null)
})

test('#17 review: in dark mode your bubble is the chrome\'s selected green, not amber over green', () => {
  const turn = ui('components/ChatTurn.jsx')
  assert.match(turn, /theme\.palette\.mode === 'dark' \? theme\.palette\.shell\.selected/)
  assert.doesNotMatch(turn, /'dark' \? \.22/)
})

test('#6 review: one spacing scale, theme type, and the loading moment wherever a slate opens', () => {
  const welcome = ui('components/SlateWelcome.jsx')
  const turn = ui('components/ChatTurn.jsx')
  // No hand-set steps off the scale (1.75, 2.25, 3.5, 2.75; 1.25, 4.25, 1.4) and no hand-set type.
  for (const src of [welcome, turn]) assert.doesNotMatch(src, /\b(?:m|mt|mb|my|p|px|py|pl|gap): (?:1\.75|2\.25|3\.5|2\.75|1\.25|4\.25|1\.4|\.25)\b/)
  assert.doesNotMatch(welcome, /fontWeight: 750|fontSize: (?:28|22|20|14\.5)\b/)
  assert.match(welcome, /variant=\{phone \? 'h6' : 'h5'\}/)
  // Opening a saved workshop, and reopening any slate, show the same calm moment as /new.
  assert.match(ui('pages/DecisionWorkshopPage.jsx'), /if \(loggingIn\) return <SlateLoading \/>/)
  assert.match(ui('pages/Canvas.jsx'), /\{!boardLoaded && !asEmbed && <SlateLoading fill=\{false\} \/>\}/)
  // The loop starts part way in, so its first frame already shows a placed tile.
  assert.match(ui('components/SlateLoading.jsx'), /\(i \* \.18 - \.55\)\.toFixed\(2\)/)
})

test('#6 review: Ask Slatebox\'s first turn follows the slate as it is now: the first note brings the starters, no reload', () => {
  const native = ui('components/NativeCanvasConversation.jsx')
  // A new slate starts empty; the loaded snapshot is only the answer until the drawing is watched.
  assert.match(native, /const drawnEmpty = useDrawnEmpty\(liveNodes\)/)
  assert.match(native, /const empty = \(drawnEmpty \?\? !\(board\.nodes\|\|\[\]\)/)
  assert.match(native, /new MutationObserver\(check\)/)
  // The notes are read only when a note's drawing comes or goes.
  assert.match(native, /if \(now===drawn\) return/)
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
  // A new slate starts empty: nothing makes a first note for it.
  assert.doesNotMatch(create, /new Slatebox\.node\(/)
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
  // The note it adds is the slate's new note (common/newNote.mjs), the one a double-click makes.
  assert.match(welcome, /addNoteInView\(slate, canvasId\)/)
})

test('#6 a new note takes the organisation\'s default preset: colours, font and size', () => {
  const preset = {
    categoryStyles: [{ backgroundColor: '#ffd23f', foregroundColor: null }, { backgroundColor: '#123456', foregroundColor: '#ffffff' }],
    categoryFont: 'House', categoryFontSize: 18,
  }
  const style = presetNoteStyle(preset, { House: 'Lora, serif' })
  // The first category style; no foreground chosen, so whichever of black and white reads on it.
  assert.deepEqual(style, { backgroundColor: '#ffd23f', foregroundColor: '#000000', fontFamily: 'Lora, serif', fontSize: 18 })
  assert.equal(presetNoteStyle({ categoryStyles: [{ backgroundColor: '#1d2b2a' }] }).foregroundColor, '#ffffff')
  // A font name with no typography setting is used as it is.
  assert.equal(presetNoteStyle({ categoryFont: 'Georgia' }).fontFamily, 'Georgia')
  // Without a preset: the default note, white on a calm blue, Manrope at the style bar's M (18px).
  assert.deepEqual(presetNoteStyle(null), { ...DEFAULT_NOTE, fontFamily: 'Manrope', fontSize: 18 })
  assert.deepEqual(sizeChoice(presetNoteStyle(null).fontSize), { key: 'M' })
  assert.equal(dockNoteStyle(null).fontSize, 18)
  // The tool dock's first note on an empty slate is the same look.
  assert.deepEqual(dockNoteStyle(style), { backgroundColor: '#ffd23f', foregroundColor: '#000000', fontFamily: 'Lora, serif', fontSize: 18, lineColor: '#333', lineWidth: 3 })
  const addNote = ui('components/node/addNote.js')
  assert.match(addNote, /noteBase\(ownNotes, slate\?\.noteStyle\)/)
  assert.doesNotMatch(addNote, /#23aad6/)
  // createSlate resolves it once, from the preset it loads, onto the slate the canvas holds.
  const create = app('imports/api/client/createSlate.js')
  assert.match(create, /slate\.noteStyle = presetNoteStyle\(defaultPreset\?\.value, fonts\)/)
  assert.match(create, /type: 'typography'/)
})

/** A stand-in for the engine's slate: records the notes it is asked for. */
function fakeSlate(noteStyle) {
  const added = []
  const v2 = {
    addNode: (opts) => { const node = { opts, ready: Promise.resolve(), editor: { startInline() { node.typing = true } } }; added.push(node); return node },
    selectNodes: (nodes) => { v2.selected = nodes },
    canvas: { point: (x, y) => ({ x: x * 2, y: y * 2 }), node: { tagName: 'svg', contains: () => false } },
    isReadOnly: () => false,
  }
  return { slate: { v2, noteStyle }, added, v2 }
}

test('#6 a preset\'s style reaches the welcome\'s note, which opens for typing', async () => {
  const style = presetNoteStyle({ categoryStyles: [{ backgroundColor: '#ffd23f' }], categoryFont: 'Lora', categoryFontSize: 18 })
  const { slate, added, v2 } = fakeSlate(style)
  globalThis.document = { getElementById: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 200 }) }) }
  try {
    addNoteInView(slate, 'slateCanvas')
  } finally {
    delete globalThis.document
  }
  assert.equal(added.length, 1)
  const { opts } = added[0]
  assert.equal(opts.backgroundColor, '#ffd23f')
  assert.equal(opts.fontColor, '#000000')
  assert.equal(opts.fontFamily, 'Lora')
  // A pixel number: the engine wraps and grows words only for a pixel size (a "14pt" string runs past the edge).
  assert.equal(opts.fontSize, 18)
  assert.equal(opts.shape, 'roundedrectangle')
  // Centred on the middle of the view (400 by 200 on screen is 400, 200 on the slate here).
  assert.equal(opts.x + opts.width / 2, 400)
  assert.equal(opts.y + opts.height / 2, 200)
  await new Promise((resolve) => setTimeout(resolve))
  assert.deepEqual(v2.selected, [added[0]])
  assert.equal(added[0].typing, true)
  // Without a preset it is the default note at 18px (the bar's M), 160 by 68.
  const plain = fakeSlate(undefined)
  addNoteAt(plain.slate, { x: 100, y: 100 })
  assert.deepEqual(plain.added[0].opts, { x: 20, y: 66, width: 160, height: 68, text: '', shape: 'roundedrectangle',
    backgroundColor: DEFAULT_NOTE.backgroundColor, fontColor: DEFAULT_NOTE.foregroundColor, fontFamily: 'Manrope', fontSize: 18, borderWidth: 0 })
})

test('#6 a double-click on empty canvas makes the welcome\'s note, where it landed, before the engine\'s grey one', () => {
  const src = ui('common/newNote.mjs')
  // Taken in the capture phase and stopped, so the engine's own double-click note is not made too.
  assert.match(src, /addEventListener\('dblclick', onDoubleClick, true\)/)
  assert.match(src, /event\.stopPropagation\(\)/)
  assert.match(src, /isReadOnly\?\.\(\)/)
  assert.match(src, /addNoteAt\(slate, v2\.canvas\.point\(event\.clientX, event\.clientY\)\)/)
  assert.match(ui('pages/Canvas.jsx'), /useNoteOnDoubleClick\(/)
  // The welcome may promise it: both ways make the same note.
  assert.match(ui('components/SlateWelcome.jsx'), /Or double-click anywhere on the canvas\./)
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
