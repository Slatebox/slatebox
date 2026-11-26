// The quality gate's hard cases and the usefulness judge's rubric, deterministic (CI-safe: no network, no keys, no
// model). The previous review (2026-11-25) showed the gate could be walked past with the obvious workarounds for
// "Piece 1" (Piece one, First piece, Block A1, 1 piece, Alpha/Beta/Gamma, Piece II), that a word shared by every card
// passed when the labels had two words (the owner's own run: Title square, Instruction square …), that the drafting
// example taught a capacity on the finished lane, and that a description matching no kit got its own words back as
// cards. And the quality rate could not fail on its own, so the live eval gained a judge: these are its fixtures.
//
//   node --test scripts/evals/smart-components/gate-and-judge.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import 'slateboxjs/workshops/behaviour'
import { rulebook, validateWorkshop } from 'slateboxjs/workshops/model'
import { builderBoard, componentQuality, componentStarter, finishedLaneCaps, flowLanes, labelMarker, listedItems, placeholderLabel, repairComponent, statedLimit } from '../../../web/app/imports/api/common/builder-freeform.mjs'
import { gridQuality, gridStarter } from '../../../web/app/imports/api/common/builder-grid.mjs'
import { boardText, CALIBRATION, calibrationCases, calibrationSummary, judgeBoard, judgeMessages, judgeRoute, judgeSummary, judgeSurface, parseJudgement, RUBRIC, runCalibration, sameModel } from './judge.mjs'
import { providerFromPreset } from '../../../web/app/server/ai-control/provider-presets.mjs'
import { PROMPTS } from './prompts.mjs'

const SET = { by: 'Slatebox agent', at: '2026-11-25T00:00:00.000Z', via: 'chat' }
const rule = (r) => ({ on: true, severity: 'refuse', set: SET, ...r })
/** A board of the reviewer's probe: lanes Tray / Build (6) / Done, the given card labels, all in Tray. */
const board = (labels, over = {}) => validateWorkshop({
  version: 1, title: 'Snappable kit',
  lanes: [{ id: 'tray', label: 'Tray' }, { id: 'build', label: 'Build', capacity: 6 }, { id: 'done', label: 'Done' }],
  cards: labels.map((label, i) => ({ id: 'c' + i, label, laneId: 'tray' })),
  ...over,
})
const gate = (labels, message = 'snappable pieces') => componentQuality(board(labels), { message })

test('placeholders: spelled-out numbers, ordinals, Roman numerals, number-first, letter+digit codes and Greek letters count off a card', () => {
  const placeholders = {
    'spelled-out numbers': ['Piece one', 'Piece two', 'Piece three', 'Piece four'],
    ordinals: ['First piece', 'Second piece', 'Third piece', 'Fourth piece'],
    'Roman numerals': ['Piece I', 'Piece II', 'Piece III', 'Piece IV'],
    'Roman numerals to twenty': ['Module XII', 'Module XVII', 'Module XX', 'Module IX'],
    'number first': ['1 piece', '2 piece', '3 piece', '4 piece'],
    'letter and digit codes': ['Block A1', 'Block A2', 'Block A3', 'Block B1'],
    'digit and letter codes': ['Tile 1A', 'Tile 1B', 'Tile 2A', 'Tile 2B'],
    'Greek letters alone': ['Alpha', 'Beta', 'Gamma', 'Delta'],
    'Greek letters on a shared stem': ['Team Alpha', 'Team Beta', 'Team Gamma', 'Team Delta'],
    'ordinal suffixes': ['1st part', '2nd part', '3rd part', '4th part'],
    'a sequence on a non-generic stem': ['Red brick one', 'Red brick two', 'Red brick three', 'Red brick four'],
  }
  for (const [kind, labels] of Object.entries(placeholders)) {
    const problems = gate(labels)
    assert.ok(problems.some((p) => /^Name every card as the real, specific thing it is: /.test(p)), `${kind}: ${problems.join(' ')}`)
    // Every one of them is named in the problem the agent is sent (at most three quoted).
    assert.match(problems.find((p) => p.startsWith('Name every card')), new RegExp(`“${labels[0]}”`), kind)
  }
  // One at a time, with nothing else to compare against: a generic noun with any marker, or a number or letter alone.
  for (const label of ['Piece one', 'First piece', 'Block A1', '1 piece', 'Piece II', 'Piece XX', 'Item #2', '7', 'Q'])
    assert.equal(placeholderLabel(label), true, label)
  assert.deepEqual(labelMarker('First piece'), { marker: 'first', stem: 'piece', at: 'start' })
  assert.deepEqual(labelMarker('Block A1'), { marker: 'a1', stem: 'block', at: 'end' })
})

test('placeholders, negatives: real names with numbers, quantities and fractions in them are names', () => {
  // Each of these boards is a tool someone would use; none is flagged.
  const named = [
    ['One half', 'One third', 'One quarter', 'One sixth', 'One eighth', 'Whole bar'],
    ['Square block', 'Hexagon tile', 'Triangle wedge', 'Long bar', 'Title banner'],
    ['MacBook Air 13', 'Dell XPS 13', 'ThinkPad X1 Carbon', 'Framework Laptop 13', 'Surface Laptop'],
    ['Red 2x4', 'Blue 1x2', 'Yellow 2x2', 'Green 1x1 round', 'Gray 1x6 plate'],
    ['First aid kit', 'Two bedrooms', 'Read 20 minutes', 'No screens after ten', 'Alpha Centauri', 'Vitamin B12'],
    ['Seven of hearts', 'Queen of spades', 'Ace of clubs', 'Two of diamonds', 'Joker'],
    ['Delta', 'United', 'Southwest', 'JetBlue', 'Alaska'],
  ]
  for (const labels of named) assert.deepEqual(gate(labels), [], labels.join(', '))
})

test('a word shared by most cards is flagged, two-word labels included; a varied mix passes', () => {
  // The owner's own run 1: every card ends in "square".
  const owner = gate(['Title square', 'Instruction square', 'Question square', 'Diagram square', 'Picture square'])
  assert.deepEqual(owner, ['Name each card for what makes it different: 5 of 5 cards end in the same word, “square”.'])
  assert.deepEqual(gate(['Red tile', 'Blue tile', 'Green tile', 'Yellow tile', 'Long bar']), ['Name each card for what makes it different: 4 of 5 cards end in the same word, “tile”.'])
  // Plurals count as the same word, and the shared words are quoted as written.
  assert.match(gate(['Big squares', 'Small squares', 'Tall squares', 'Wide square'])[0], /4 of 4 cards end in the same word, “square/)
  assert.deepEqual(gate(['Title square tile', 'Answer square tile', 'Picture square tile', 'Question square tile']), ['Name each card for what makes it different: 4 of 4 cards end in the same words, “square tile”.'])
  // A mix where some cards share an ending is varied enough: "Square block" beside "Hexagon tile" and others.
  assert.deepEqual(gate(['Square block', 'Triangle block', 'Hexagon tile', 'Half-width strip', 'Title banner', 'Text box']), [])
  assert.deepEqual(gate(['Speech bubble', 'Thought bubble', 'Shout bubble', 'Captain Comet', 'Robot sidekick']), [])
  // Three cards are too few to call a pattern.
  assert.deepEqual(gate(['Red tile', 'Blue tile', 'Green tile']), [])
})

test('a repeated card is quoted trimmed, once, however its case and spaces vary', () => {
  assert.deepEqual(gate(['Square ', 'SQUARE', 'square', 'Long bar']), ['Give each card its own name: “Square” appears more than once.'])
})

test('a capacity on the finished or archive lane is questioned, and dropped only when that is unambiguous', () => {
  const set = { by: 'x', at: SET.at, via: 'chat' }
  const flow = (lanes, rules, message = 'snap-together tiles for a printable worksheet') => {
    const workshop = validateWorkshop({ version: 1, title: 'Worksheet kit', lanes, cards: ['Title banner', 'Triangle tile', 'Answer box strip', 'Picture frame'].map((label, i) => ({ id: 'c' + i, label, laneId: lanes[0].id })), behaviour: { version: 1, rev: 1, rules: rules.map(rule) } })
    return { workshop, problems: componentQuality(workshop, { message }), repaired: repairComponent(workshop, { message }) }
  }
  const lanes = [{ id: 'tray', label: 'Tile tray' }, { id: 'layout', label: 'Page layout', capacity: 6 }, { id: 'print', label: 'Ready to print', capacity: 6 }]
  // The old worked example: one-step, the last lane "Ready to print" capped at 6. After six pieces nothing is ready.
  const example = flow(lanes, [{ id: 'one-step', kind: 'path', from: 'any', noSkip: true }])
  assert.deepEqual(example.problems, ['“Ready to print” is where finished cards go, so a capacity of 6 there stops the board once it fills: leave it without a capacity, and put the limit on the lane where the work happens.'])
  // The person said nothing about that lane's size: the cap is dropped and the rest kept as drafted.
  assert.deepEqual(example.repaired.repairs, ['dropped the capacity on “Ready to print”, where finished cards go'])
  assert.deepEqual(example.repaired.workshop.lanes.map((lane) => lane.capacity), [undefined, 6, undefined])
  assert.deepEqual(componentQuality(example.repaired.workshop), [])
  // An archive lane anywhere, capped by a lane capacity: questioned and dropped the same way.
  const archived = flow([lanes[0], lanes[1], { id: 'filed', label: 'Filed away', capacity: 4 }], [{ id: 'archive-filed', kind: 'bin', lane: 'filed' }])
  assert.equal(archived.problems.length, 1)
  assert.match(archived.problems[0], /^“Filed away” is where finished cards go/)
  assert.equal(archived.repaired.workshop.lanes[2].capacity, undefined)
  // The person gave that lane a number ("ready to print holds 6"): ambiguous, so not repaired; the agent is asked again.
  const theirs = flow(lanes, [{ id: 'one-step', kind: 'path', from: 'any', noSkip: true }], 'tiles for a worksheet, ready to print holds 6 sheets')
  assert.equal(finishedLaneCaps(theirs.workshop, { message: 'tiles for a worksheet, ready to print holds 6 sheets' })[0].ambiguous, true)
  assert.deepEqual(theirs.repaired.repairs, [])
  assert.equal(theirs.problems.length, 1)
  // Not a finished lane: a last lane that is a real limit ("Chosen (1)", a bracket's "Final (2)"), or a flow-less board.
  assert.deepEqual(flow([{ id: 'considering', label: 'Considering' }, { id: 'shortlist', label: 'Shortlist', capacity: 3 }, { id: 'chosen', label: 'Chosen', capacity: 1 }], [{ id: 'one-step', kind: 'path', from: 'any', noSkip: true }]).problems, [])
  assert.deepEqual(flow([{ id: 'r1', label: 'First round' }, { id: 'semi', label: 'Semifinals', capacity: 4 }, { id: 'final', label: 'Final', capacity: 2 }], [{ id: 'one-step', kind: 'path', from: 'any', noSkip: true }]).problems, [])
  // A last lane named as finished is questioned with no one-step rule too (the review's probe, 2026-11-25).
  assert.equal(flow(lanes, []).problems.length, 1, 'no flow: "Ready to print" is still where work ends')
  void set
})

test('a finished lane is known by its name and place, with or without a one-step rule', () => {
  const kanban = (lanes, rules = []) => validateWorkshop({ version: 1, title: 'Team kanban', lanes,
    cards: ['Write the brief', 'Design review', 'Fix the login bug', 'Update the docs'].map((label, i) => ({ id: 'c' + i, label, laneId: lanes[0].id })),
    behaviour: { version: 1, rev: 1, rules: rules.map(rule) } })
  const capped = (workshop) => finishedLaneCaps(workshop).map(({ lane, capacity }) => `${lane.label} ${capacity}`)
  const backlog = { id: 'backlog', label: 'Backlog' }, doing = { id: 'doing', label: 'In progress', capacity: 3 }
  // The review's probe: Backlog / In progress (3) / Done (5), no path rule; then the cap as a capacity rule on Done.
  assert.deepEqual(capped(kanban([backlog, doing, { id: 'done', label: 'Done', capacity: 5 }])), ['Done 5'])
  assert.match(componentQuality(kanban([backlog, doing, { id: 'done', label: 'Done', capacity: 5 }]))[0], /^“Done” is where finished cards go, so a capacity of 5/)
  assert.deepEqual(capped(kanban([backlog, doing, { id: 'done', label: 'Done' }], [{ id: 'done-holds', kind: 'capacity', where: 'done', max: 5 }])), ['Done 5'])
  // Named only as finished, anywhere: a Done lane before a Blocked lane, an Archive lane, Shipped, Complete.
  assert.deepEqual(capped(kanban([backlog, { id: 'done', label: 'Done', capacity: 5 }, { id: 'blocked', label: 'Blocked', capacity: 2 }])), ['Done 5'])
  for (const label of ['Shipped', 'Complete', 'Completed', 'Archive', 'Archived', 'Finished', 'Closed', 'Resolved', 'Published', 'Erledigt', '完了'])
    assert.deepEqual(capped(kanban([backlog, { id: 'last', label, capacity: 4 }, doing])), [`${label} 4`], `${label} anywhere`)
  // The last lane, named as finished: Ready to print, Ready to ship, Done this week, Fixed, Harvested.
  for (const label of ['Ready to print', 'Ready to ship', 'Done this week', 'Fixed', 'Harvested', 'Printed', 'Delivered to the client'])
    assert.deepEqual(capped(kanban([backlog, doing, { id: 'last', label, capacity: 6 }])), [`${label} 6`], `${label} last`)
  // Negatives: a last lane that is a real limit (Chosen, a bracket's Final, Shortlist, Encore, Favorites), a lane that
  // only mentions printing before it is finished ("Print queue" in the middle), and a working lane named Ready.
  for (const label of ['Chosen', 'Final', 'Shortlist', 'Encore', 'Favorites', 'Line three', 'Thursday', 'Printable pieces'])
    assert.deepEqual(capped(kanban([backlog, doing, { id: 'last', label, capacity: 2 }])), [], `${label} last`)
  assert.deepEqual(capped(kanban([backlog, { id: 'queue', label: 'Print queue', capacity: 4 }, { id: 'ready', label: 'Ready for review', capacity: 2 }, { id: 'out', label: 'Out the door' }])), [])
  // Repaired the same way: the person's words give Done no number, so its cap goes and the work lane's stays.
  const repaired = repairComponent(kanban([backlog, doing, { id: 'done', label: 'Done', capacity: 5 }]), { message: 'a kanban board for my team' })
  assert.deepEqual(repaired.workshop.lanes.map((lane) => lane.capacity), [undefined, 3, undefined])
  assert.deepEqual(componentQuality(repaired.workshop, { message: 'a kanban board for my team' }), [])
  // "done holds 5": the person's number, so the agent is asked instead.
  assert.equal(finishedLaneCaps(kanban([backlog, doing, { id: 'done', label: 'Done', capacity: 5 }]), { message: 'kanban where done holds 5 cards' })[0].ambiguous, true)
})

test('a head noun the domain itself repeats is natural; a generic piece noun or an unasked word is not', () => {
  const site = { version: 1, title: 'Website QA before launch',
    lanes: [{ id: 'to-test', label: 'To test' }, { id: 'testing', label: 'Testing', capacity: 2 }, { id: 'passed', label: 'Passed' }],
    cards: ['Login page', 'Pricing page', 'Settings page', 'Checkout page', 'Search results'].map((label, i) => ({ id: 'c' + i, label, laneId: 'to-test' })),
    behaviour: { version: 1, rev: 1, rules: [rule({ id: 'one-step', kind: 'path', from: 'any', noSkip: true })] } }
  // The review's probe: the drafted QA board is kept, not replaced by the printable-pieces kit.
  const qa = 'QA the pages of our website before launch'
  assert.deepEqual(componentQuality(validateWorkshop(site), { message: qa }), [])
  assert.equal(builderBoard(site, qa).drafted, true)
  const soup = { version: 1, title: 'Soup of the day rotation',
    lanes: [{ id: 'ideas', label: 'Soup ideas' }, { id: 'week', label: 'This week', capacity: 5 }, { id: 'served', label: 'Served' }],
    cards: ['Tomato soup', 'Lentil soup', 'Chicken noodle soup', 'Minestrone soup', 'Gazpacho'].map((label, i) => ({ id: 'c' + i, label, laneId: 'ideas' })),
    behaviour: { version: 1, rev: 1, rules: [rule({ id: 'one-step', kind: 'path', from: 'any', noSkip: true })] } }
  assert.deepEqual(componentQuality(validateWorkshop(soup), { message: 'soup of the day rotation' }), [])
  assert.equal(builderBoard(soup, 'soup of the day rotation').drafted, true)
  // The person's words name it ("bugs"): natural. A lane or title the draft names itself does not count, or any
  // shared word would pass by naming a lane after it ("Bug inbox", "Square tray").
  assert.deepEqual(gate(['Login bug', 'Export bug', 'Sync bug', 'Upload bug'], 'a board to triage the bugs users report'), [])
  assert.deepEqual(gate(['Login bug', 'Export bug', 'Sync bug', 'Upload bug'], 'triage what users report'), ['Name each card for what makes it different: 4 of 4 cards end in the same word, “bug”.'])
  assert.equal(componentQuality(board(['Login bug', 'Export bug', 'Sync bug', 'Upload bug'], { title: 'Bug board', lanes: [{ id: 'tray', label: 'Bug inbox' }, { id: 'build', label: 'Fixing', capacity: 2 }, { id: 'done', label: 'Fixed' }] }), { message: 'triage what users report' }).length, 1)
  // Still flagged: the owner's squares (the words never say square), and a generic piece noun even when asked for.
  assert.equal(gate(['Title square', 'Instruction square', 'Question square', 'Diagram square', 'Picture square'], 'snappable congruent pieces to compose new printable materials').length, 1)
  assert.equal(gate(['Red tile', 'Blue tile', 'Green tile', 'Yellow tile'], 'snap-together tiles for a worksheet').length, 1)
  assert.equal(gate(['Big piece', 'Small piece', 'Tall piece', 'Wide piece'], 'snappable pieces').length, 1)
})

test('a drafted board with a capped archive lane is repaired, not thrown away for the starter', () => {
  const draft = {
    version: 1, title: 'Printable worksheet kit',
    lanes: [{ id: 'tile-tray', label: 'Tile tray' }, { id: 'layout', label: 'Page layout', capacity: 6 }, { id: 'print', label: 'Ready to print', capacity: 6 }],
    cards: ['Title banner', 'Name and date line', 'Two-column text block', 'Triangle tile', 'Hexagon tile', 'Answer box strip'].map((label, i) => ({ id: 'c' + i, label, laneId: 'tile-tray' })),
    behaviour: { version: 1, rev: 1, rules: [rule({ id: 'one-step', kind: 'path', from: 'any', noSkip: true }), rule({ id: 'archive-print', kind: 'bin', lane: 'print' })] },
  }
  const made = builderBoard(draft, 'snappable congruent pieces to compose new printable materials')
  assert.equal(made.drafted, true)
  assert.equal(made.workshop.lanes[2].capacity, undefined)
  assert.ok(!rulebook().lines(made.workshop).some((line) => /Ready to print holds/.test(line)))
})

test('the guest starter: a description that matches no shape gets domain cards, never its own words handed back', () => {
  const starter = (message) => validateWorkshop(componentStarter(message))
  const labels = (message) => starter(message).cards.map((card) => card.label)
  const lanes = (message) => starter(message).lanes.map((lane) => lane.label)
  // The reviewer's probes.
  assert.deepEqual(lanes('a tool for my band setlist'), ['Song bank', 'First set', 'Second set', 'Encore'])
  assert.ok(labels('a tool for my band setlist').includes('Brown Eyed Girl'))
  assert.deepEqual(lanes('vocabulary flashcards for spanish class'), ['New words', 'Learning', 'Review', 'Known'])
  assert.ok(labels('vocabulary flashcards for spanish class').includes('gracias · thank you'))
  assert.ok(labels('french flashcards').includes('merci · thank you'))
  assert.deepEqual(lanes('track my investment portfolio rebalancing'), ['Holdings', 'Over target', 'Under target', 'Rebalanced'])
  assert.ok(labels('track my investment portfolio rebalancing').includes('Bond index fund'))
  // More domains, by their nouns.
  assert.ok(labels('pieces of a haiku, five seven five, drag the words into lines').includes('Old pond'), 'a haiku is words, not printable pieces')
  assert.ok(labels('🍕🍔🌮 lunch order board for the office, max 6 per order run').includes('Pad thai'))
  assert.ok(labels('a dragon sorting its hoard by shininess, cursed items cannot go in the bedroom pile').includes('Cursed amulet'))
  assert.ok(labels('pick a laptop: options move from considering to shortlist (max 3) to chosen (just one)').includes('ThinkPad X1 Carbon'))
  // Word prefixes never pick a kit (the review's probes, 2026-11-25): each phrase gets its own kit or the triage set.
  const triage = ['Top priority', 'Quick win', 'Waiting on someone', 'Needs a decision', 'Nice to have', 'Someday']
  const kitOf = {
    'investigate customer complaints': null,
    'pitch deck outline for investors': ['Slide ideas', 'Draft order', 'Final deck'],
    'help desk ticket queue': ['New', 'Triaged', 'Fixed'],
    'desktop app release tasks': ['Backlog', 'In progress', 'In review', 'Done'],
    'Seattle trip packing list': ['To pack', 'Packed', 'In the car'],
    'resistance band workout plan': ['Exercise bank', 'Today', 'Done'],
    'lessons learned from the outage': ['Went well', 'To improve', 'Action items'],
    'event storming for our checkout domain': ['Event pile', 'Timeline', 'Hot spots'],
    'onboarding checklist for new hires': ['To do', 'This week', 'Done'],
    'soup of the day rotation': null,
  }
  const wrong = { Holdings: 'investments', Unassigned: 'seating', 'Song bank': 'setlist', 'Activity bank': 'lesson plan', Ideas: 'party', Applied: 'hiring', Pieces: 'printable pieces' }
  for (const [message, want] of Object.entries(kitOf)) {
    const got = lanes(message)
    assert.ok(!wrong[got[0]], `${message}: the ${wrong[got[0]]} kit`)
    if (want) assert.deepEqual(got, want, message)
    else assert.deepEqual(labels(message), triage, message)
    assert.deepEqual(componentQuality(starter(message), { message }), [], message)
  }
  // And the specific kit still wins where it is meant: a seating chart for a wedding is seats, not wedding tasks.
  assert.deepEqual(lanes('seating chart for the wedding'), ['Unassigned', 'Table one', 'Table two'])
  assert.deepEqual(lanes('a seating chart where students snap to desks'), ['Unassigned', 'Table one', 'Table two'])
  assert.deepEqual(lanes('a lesson plan for Tuesday'), ['Activity bank', 'Warm-up', 'Main activity', 'Practice', 'Exit ticket'])
  assert.deepEqual(lanes('our band needs a set list for friday'), ['Song bank', 'First set', 'Second set', 'Encore'])
  assert.deepEqual(lanes('hiring pipeline for two designers'), ['Applied', 'Interviewing', 'Offer'])
  // Nothing to go on: a triage set, still never the words.
  assert.deepEqual(labels('help me organize stuff better'), ['Top priority', 'Quick win', 'Waiting on someone', 'Needs a decision', 'Nice to have', 'Someday'])
  // The hoard's cursed amulet may never go in the bedroom pile; the rule holds.
  const hoard = starter('a dragon sorting its hoard by shininess, cursed items cannot go in the bedroom pile')
  const amulet = hoard.cards.find((card) => card.label === 'Cursed amulet')
  assert.deepEqual(amulet.allowedLaneIds, ['unsorted', 'cursed-vault'])
  // For every prompt of the eval set and others: no card is one of the description's own content words, unless the
  // description listed it ("kitchen, two bedrooms, bath").
  const own = (message) => new Set(message.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3))
  // A printable page gets a grid sheet (builder-grid.mjs), never this starter: its own kit, held to its own gate, none
  // of its tiles the description's own words.
  for (const { prompt: message } of PROMPTS.filter((p) => p.expect?.kind === 'grid')) {
    const sheet = validateWorkshop(gridStarter(message))
    const words = own(message)
    // (A bingo card's Free square is the one the words ask for: "a free space in the middle".)
    const asked = (label) => label === 'free' && /\bfree space\b/i.test(message)
    assert.deepEqual(sheet.cards.filter((card) => words.has(card.label.toLowerCase()) && !asked(card.label.toLowerCase())).map((card) => card.label), [], message)
    assert.deepEqual(gridQuality(sheet, { message }), [], message)
  }
  for (const message of [...PROMPTS.filter((p) => p.expect?.kind !== 'grid').map((p) => p.prompt), 'a tool for my band setlist', 'vocabulary flashcards for spanish class', 'track my investment portfolio rebalancing', 'wine tasting notes', 'garden planting schedule', 'sales leads pipeline', 'my monthly budget']) {
    const listed = new Set(listedItems(message).map((item) => item.toLowerCase()))
    const words = own(message)
    const echoed = labels(message).filter((label) => !listed.has(label.toLowerCase()) && words.has(label.toLowerCase()))
    assert.deepEqual(echoed, [], message)
    assert.deepEqual(componentQuality(starter(message), { message }), [], message)
  }
})

test('the starter reads the lanes a description walks cards through, and the one limit it states', () => {
  assert.deepEqual(flowLanes('pick a laptop: options move from considering to shortlist (max 3) to chosen (just one)'), [{ label: 'Considering' }, { label: 'Shortlist', limit: 3 }, { label: 'Chosen', limit: 1 }])
  assert.deepEqual(flowLanes('a Gantt-style plan with dependencies: design before build, build before test, test before launch').map((l) => l.label), ['Design', 'Build', 'Test', 'Launch'])
  assert.deepEqual(flowLanes('a floor plan with rooms'), [])
  assert.equal(statedLimit('🍕🍔🌮 lunch order board for the office, max 6 per order run'), 6)
  assert.equal(statedLimit('conference schedule builder: drag talks into morning, afternoon and evening slots, three talks per slot'), 3)
  assert.equal(statedLimit('un menu de restaurant à composer: entrées, plats et desserts, trois choix maximum par section'), 3)
  assert.equal(statedLimit('a kanban board with WIP limits: no more than 3 in progress and 2 in review'), null, 'two limits are not one')
  assert.equal(statedLimit('an 8 team tournament bracket'), null)
  const conference = validateWorkshop(componentStarter('conference schedule builder: drag talks into morning, afternoon and evening slots, three talks per slot'))
  assert.deepEqual(conference.lanes.map((l) => l.label), ['Talk pool', 'Morning', 'Afternoon', 'Evening'])
  assert.deepEqual(rulebook().lines(conference).slice(0, 3), ['Morning holds 3.', 'Afternoon holds 3.', 'Evening holds 3.'])
  // A flow's last lane named as where work is finished never gets a limit.
  for (const { prompt } of PROMPTS) assert.deepEqual(finishedLaneCaps(validateWorkshop(componentStarter(prompt))), [], prompt)
})

test('the judge: one fixed rubric, the board as it reads, a score from 1 to 5 with a reason', () => {
  for (const criterion of ['Domain fit', 'Variety', 'Sensible behavior', 'Use today', 'JSON only']) assert.ok(RUBRIC.includes(criterion), criterion)
  const workshop = validateWorkshop(componentStarter('a tool for my band setlist'))
  const text = boardText(workshop, rulebook().lines(workshop))
  assert.match(text, /^Title: A tool for my band setlist\nLanes, in order: Song bank → First set → Second set → Encore \(holds 2\)\nCards \(8\): Johnny B\. Goode \[starts in Song bank\];/)
  assert.match(text, /\nRules: Encore holds 2\./)
  const messages = judgeMessages('a tool for my band setlist', workshop, [])
  assert.equal(messages[0].content, RUBRIC)
  assert.match(messages[1].content, /^The person's request:\na tool for my band setlist\n\nThe board they were given:\nTitle:/)
  // Its answer: JSON, alone or wrapped in words; anything else is refused.
  assert.deepEqual(parseJudgement('{"score": 4, "reason": "Real songs, sensible sets."}'), { score: 4, reason: 'Real songs, sensible sets.' })
  assert.deepEqual(parseJudgement('Here you go:\n```json\n{"score":"5","reason":"  Ready  to use. "}\n```'), { score: 5, reason: 'Ready to use.' })
  for (const bad of ['', 'Four out of five', '{"score": 6}', '{"score": 0, "reason": "x"}', '{"score": 3.5}', '{score: 4}']) assert.throws(() => parseJudgement(bad), undefined, bad)
})

test('the judge fails a run on a mean under 4, more than 10% at 2 or less, or boards it could not judge', () => {
  const of = (scores) => scores.map((score) => (typeof score === 'number' ? { score } : { error: 'x' }))
  const good = judgeSummary(of([5, 5, 4, 4, 4, 5, 4, 3, 5, 4]))
  assert.deepEqual(good, { judged: 10, unjudged: 0, mean: 4.3, distribution: { 1: 0, 2: 0, 3: 1, 4: 5, 5: 4 }, lowShare: 0, pass: true, problems: [] })
  assert.deepEqual(judgeSummary(of([4, 4, 3, 3, 4, 4, 3, 4, 4, 4])).problems, ['the mean judge score is 3.70, under 4'])
  // Mean 4.1 but two of ten at 2 or less: 20%, over 10%.
  assert.deepEqual(judgeSummary(of([5, 5, 5, 5, 5, 5, 5, 5, 2, 1])).problems, ['2 of 10 boards (20.0%) score 2 or less, over 10%'])
  assert.equal(judgeSummary(of([5, 5, 5, 5, 5, 5, 5, 5, 5, 2])).pass, true, 'one in ten is not over 10%')
  assert.deepEqual(judgeSummary(of([5, 5, 5, 5, 5, 5, 5, 5, 'error', 'error'])).problems, ['2 of 10 boards could not be judged'])
  assert.deepEqual(judgeSummary([]).problems, ['no board was judged'])
})

test('the judge asks the configured route, by its protocol, and never names a model of its own', async () => {
  assert.equal(judgeSurface(), 'eval', 'the catalogue\'s judge part, an administrator\'s binding')
  assert.equal(judgeSurface('chat'), 'chat')
  const workshop = validateWorkshop(componentStarter('a tool for my band setlist'))
  const calls = []
  const fake = (answer) => async (url, init) => { calls.push({ url, init: { ...init, body: JSON.parse(init.body) } }); return { ok: true, status: 200, json: async () => answer } }
  const openai = { route: { protocol: 'openai-chat', baseUrl: 'https://models.example.test/v1/', model: 'configured-model', auth: { style: 'bearer' }, extraHeaders: {} }, apiKey: 'k1' }
  assert.deepEqual(await judgeBoard(openai, 'a tool for my band setlist', workshop, [], { fetchImpl: fake({ choices: [{ message: { content: '{"score":4,"reason":"Good."}' } }] }) }), { score: 4, reason: 'Good.' })
  assert.equal(calls[0].url, 'https://models.example.test/v1/chat/completions')
  assert.equal(calls[0].init.headers.authorization, 'Bearer k1')
  assert.equal(calls[0].init.body.model, 'configured-model')
  assert.equal(calls[0].init.body.temperature, 0)
  assert.equal(calls[0].init.body.messages[0].content, RUBRIC)
  const anthropic = { route: { protocol: 'anthropic-messages', baseUrl: 'https://anthropic.example.test/v1', model: 'configured-model-2', extraHeaders: {} }, apiKey: 'k2' }
  assert.deepEqual(await judgeBoard(anthropic, 'x y z', workshop, [], { fetchImpl: fake({ content: [{ type: 'text', text: '{"score":2,"reason":"Generic."}' }] }) }), { score: 2, reason: 'Generic.' })
  assert.equal(calls[1].url, 'https://anthropic.example.test/v1/messages')
  assert.equal(calls[1].init.headers['x-api-key'], 'k2')
  assert.equal(calls[1].init.body.system, RUBRIC)
  // An answer that does not read is asked once more, then refused.
  calls.length = 0
  await assert.rejects(judgeBoard(openai, 'x y z', workshop, [], { fetchImpl: fake({ choices: [{ message: { content: 'great board!' } }] }) }), /without JSON/)
  assert.equal(calls.length, 2)
})

test('the judge is calibrated on every run: known-bad control boards, each expected at 2 or less', async () => {
  const cases = calibrationCases()
  assert.deepEqual(cases.map((item) => item.id), ['counted-pieces', 'one-word', 'wrong-domain', 'capped-done', 'echoed-words', 'grid-numbered-questions'])
  for (const item of cases) {
    assert.equal(item.max, 2, item.id)
    assert.ok(item.workshop.cards.length >= 5, item.id)
    assert.ok(item.rules.length >= 1, item.id)
  }
  // Two the gate refuses too; the others are what only the judge can catch (the wrong domain, words handed back) or a
  // rule that gets in the way (Done holds 1).
  // A grid sheet is held to its own gate (gridQuality): numbered questions with no words are refused there too.
  const gated = Object.fromEntries(cases.map((item) => [item.id, (item.workshop.kind === 'grid' ? gridQuality : componentQuality)(item.workshop, { message: item.prompt }).length > 0]))
  assert.deepEqual(gated, { 'counted-pieces': true, 'one-word': true, 'wrong-domain': false, 'capped-done': true, 'echoed-words': false, 'grid-numbered-questions': true })
  assert.match(boardText(cases[5].workshop, cases[5].rules), /^Title: Worksheet\nA grid sheet: Letter portrait, 6 rows by 2 columns of cells\n/)
  assert.match(boardText(cases[3].workshop, cases[3].rules), /Done \(holds 1\)/)
  // Every control scored 2 or less: calibrated. One at 3, or one the judge could not score: the run fails.
  const fake = (scores) => async (judge, prompt, workshop) => {
    const id = cases.find((item) => item.workshop === workshop)?.id ?? CALIBRATION.find((item) => item.prompt === prompt)?.id
    if (scores[id] === 'error') throw new Error('the judge model answered 503')
    return { score: scores[id] ?? 1, reason: 'A toy.' }
  }
  assert.deepEqual((await runCalibration({}, { judgeImpl: fake({}) })).problems, [])
  const loose = await runCalibration({}, { judgeImpl: fake({ 'wrong-domain': 4 }) })
  assert.equal(loose.pass, false)
  assert.deepEqual(loose.problems, ['the judge scored the known-bad control board wrong-domain 4 (at most 2 expected): it does not tell toys from tools'])
  const lost = await runCalibration({}, { judgeImpl: fake({ 'capped-done': 'error' }) })
  assert.deepEqual(lost.problems, ['the judge could not score the control board capped-done: the judge model answered 503'])
  assert.deepEqual(calibrationSummary([]).problems, ['no control board was judged'])
})

test('the judge names when it would grade its own boards: unbound, eval falls to the drafter\'s model', () => {
  const meta = providerFromPreset('meta'), deepinfra = providerFromPreset('deepinfra')
  const model = (provider, id) => ({ _id: `${provider}:${id}`, provider, model: id, label: id, capabilities: { tools: true }, status: 'enabled' })
  const key = (provider) => ({ _id: 'k-' + provider, provider, ownerType: 'server', ownerId: 'server', kind: 'key', status: 'active' })
  const db = (bindings) => (script) => {
    const name = script.match(/getCollection\("([^"]+)"\)/)[1]
    return { aiProviders: [meta, deepinfra], aiModels: [model('meta', 'muse-ember-1.0'), model('deepinfra', 'google/gemini-3.5-flash')], aiBindings: bindings, aiControlState: [], providerKeys: [key('meta'), key('deepinfra')] }[name] ?? []
  }
  const env = { JUDGE_KEY: 'placeholder-key' }
  const self = judgeRoute({ mongoJSON: db([]), env, keyEnv: 'JUDGE_KEY' })
  assert.equal(self.surface, 'eval')
  assert.equal(self.selfGraded, true, 'nothing bound: the judge is the drafter')
  assert.equal(self.drafter.model, 'muse-ember-1.0')
  const bound = judgeRoute({ mongoJSON: db([{ _id: 'eval', surface: 'eval', use: 'model', model: 'deepinfra:google/gemini-3.5-flash' }]), env, keyEnv: 'JUDGE_KEY' })
  assert.equal(bound.selfGraded, false)
  assert.equal(bound.source, 'part')
  assert.equal(bound.route.model, 'google/gemini-3.5-flash')
  // Bound to the drafter's own model, or asked to judge with the drafting part: self-graded all the same.
  assert.equal(judgeRoute({ mongoJSON: db([{ _id: 'eval', surface: 'eval', use: 'model', model: 'meta:muse-ember-1.0' }]), env, keyEnv: 'JUDGE_KEY' }).selfGraded, true)
  assert.equal(judgeRoute({ mongoJSON: db([{ _id: 'eval', surface: 'eval', use: 'model', model: 'deepinfra:google/gemini-3.5-flash' }]), env, keyEnv: 'JUDGE_KEY', surface: 'workshop.draft' }).selfGraded, true)
  assert.equal(sameModel({ provider: 'a', model: 'm' }, { provider: 'b', model: 'm' }), false)
})
