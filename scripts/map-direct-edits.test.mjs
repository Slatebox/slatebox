import test from 'node:test'
import assert from 'node:assert/strict'
import { isStarterMap, proposeDirectMapEdit } from '../web/app/imports/api/common/map-direct-edits.mjs'
import { createRequire } from 'node:module'
const {createWorkshopMap, moveWorkshopCard} = createRequire(new URL('../web/app/package.json', import.meta.url))('slateboxjs/workshops/model')

test('an arrow path previews a real playable map without changing the source', () => {
  const source = createWorkshopMap()
  const { workshop } = proposeDirectMapEdit(source, 'First upload → Preview ten rows → Import clients')
  assert.equal(isStarterMap(source), true)
  assert.equal(isStarterMap(workshop), false)
  assert.deepEqual(workshop.lanes.map(lane => lane.label), ['First upload','Preview ten rows','Import clients'])
  const moved = moveWorkshopCard(workshop, workshop.cards[0].id, workshop.lanes[1].id)
  assert.equal(moved.cards[0].laneId, workshop.lanes[1].id)
})

test('free follow-ups extend named stations and preserve original identities, artwork and rules', () => {
  const initial = proposeDirectMapEdit(createWorkshopMap(), 'When the demo ends, book a pilot').workshop
  initial.lanes[0].station.image = {src:'https://slatebox.com/diagram.webp',alt:'Pilot flow'}
  const next = proposeDirectMapEdit(initial, 'Add Review risks after book a pilot').workshop
  const renamed = proposeDirectMapEdit(next, 'Rename Review risks to Resolve risk').workshop
  const final = proposeDirectMapEdit(renamed, 'At Resolve risk, Check the customer’s migration plan.').workshop
  assert.deepEqual(final.lanes[0], initial.lanes[0])
  assert.equal(final.lanes[2].id, next.lanes[2].id)
  assert.equal(final.lanes[2].station.outcome, 'Check the customer’s migration plan.')
  assert.deepEqual(final.lanes[1].station.next, [final.lanes[2].id])
  // A path starts from a step that is there: nobody's saved map is replaced. The reply names the steps.
  assert.throws(() => proposeDirectMapEdit(final, 'Fresh project → Overwrite all steps'), /There is no step called “Fresh project” here\. The steps are /)
  assert.throws(() => proposeDirectMapEdit(final, 'What do you think?'), error => error.code === 'not-understood' && /I can add steps, connect them, rename them and move a token\. Try “/.test(error.message))
})

// What a person would type about a map, without having been taught a form.
const built = ['Client CSV → Preview ten rows → Start a pilot', 'Add Keep originals after Preview ten rows']
  .reduce((map, message) => proposeDirectMapEdit(map, message).workshop, createWorkshopMap())
const nightStart = createWorkshopMap()
const station = (map, label) => map.lanes.find(lane => lane.label === label)
const said = (map, message, selection) => proposeDirectMapEdit(map, message, selection).workshop

test('a token moves by name along the routes that are there, and a refusal says which route is missing', () => {
  for (const message of ['Move Progress to Preview ten rows', 'Move the token to Preview ten rows', 'Please move the token to Preview.', 'Progress goes to Preview ten rows', 'Can you move Progress to Preview ten rows?']) {
    assert.equal(said(built, message).cards[0].laneId, station(built, 'Preview ten rows').id, message)
  }
  assert.throws(() => said(built, 'Move Progress to Start a pilot'), /“Progress” can’t move to “Start a pilot”\. Start a pilot can't be reached from Client CSV\./)
  assert.throws(() => said(built, 'Move Progress to Client CSV'), /already at “Client CSV”/)
  // A sentence that only looks like a move is still a path.
  assert.deepEqual(said(createWorkshopMap(), 'Send the file to review → Done').lanes.map(lane => lane.label), ['Send the file to review', 'Done'])
})

test('steps are added, connected, limited and removed in ordinary sentences', () => {
  assert.equal(said(built, 'Add a step called Archive after Keep originals').lanes.at(-1).label, 'Archive')
  // Two paths end here, so the reply asks which, with one of the ends as its example.
  assert.throws(() => said(built, 'Add a step called Archive'), /Say where it goes, such as “Add Archive after Start a pilot”\./)
  assert.equal(said(createWorkshopMap(), 'Add a step called Follow-up.').lanes.at(-1).label, 'Follow-up', 'one end: the new step goes after it')
  assert.ok(station(said(built, 'Connect Keep originals to Start a pilot'), 'Keep originals').station.next.includes(station(built, 'Start a pilot').id))
  assert.throws(() => said(built, 'Connect Client CSV to Preview ten rows'), /already leads to/)
  assert.deepEqual(station(said(built, 'Remove the path from Preview ten rows to Keep originals'), 'Preview ten rows').station.next, [station(built, 'Start a pilot').id])
  for (const message of ['Let Keep originals hold two tokens', 'Keep originals holds 2', 'Limit Keep originals to 2 tokens', 'Set the limit of Keep originals to 2']) {
    assert.equal(station(said(built, message), 'Keep originals').capacity, 2, message)
  }
  const limited = said(built, 'Keep originals holds 1')
  assert.equal(station(said(limited, 'Remove the limit on Keep originals'), 'Keep originals').capacity, undefined)
  const removed = said(built, 'Delete Keep originals')
  assert.deepEqual(removed.lanes.map(lane => lane.label), ['Client CSV', 'Preview ten rows', 'Start a pilot'])
  assert.deepEqual(station(removed, 'Preview ten rows').station.next, [station(built, 'Start a pilot').id], 'no route is left pointing at it')
  assert.throws(() => said(built, 'Delete Client CSV'), /“Progress” is at “Client CSV”\. Move it to another step first\./)
  assert.throws(() => said(createWorkshopMap(), 'Delete Next step'), /at least two steps/)
  assert.throws(() => said(built, 'Remove the token'), /at least one token/)
  // A step whose name starts with one of these words is still a step on a path.
  assert.deepEqual(said(nightStart, 'Remove duplicates → Connect the bank').lanes.map(lane => lane.label), ['Remove duplicates', 'Connect the bank'])
})

test('names are read as people write them, and what a step says keeps its full stop', () => {
  assert.equal(said(built, 'Rename the step Client CSV to Upload.').lanes[0].label, 'Upload')
  assert.equal(said(built, 'Rename Progress to Courier').cards[0].label, 'Courier')
  assert.equal(said(built, 'Rename the token to Courier').cards[0].label, 'Courier')
  assert.equal(said(built, 'Call this map “Client import”').title, 'Client import')
  assert.equal(said(built, 'Add a token called Courier at Preview').cards.at(-1).laneId, station(built, 'Preview ten rows').id)
  assert.equal(station(said(built, 'When the token reaches Preview ten rows, say The first ten rows are shown.'), 'Preview ten rows').station.outcome, 'The first ten rows are shown.')
  assert.equal(station(said(built, 'At Preview ten rows, The first ten rows are shown.'), 'Preview ten rows').station.outcome, 'The first ten rows are shown.')
  assert.equal(said(built, 'Start the presentation with Start a pilot').presentationOrder[0], station(built, 'Start a pilot').id)
  assert.deepEqual(said(createWorkshopMap(), 'Draw Intake → Review').lanes.map(lane => lane.label), ['Intake', 'Review'])
  assert.throws(() => said(built, 'For Nowhere, set capacity to 2'), /There is no step or token called “Nowhere” on this map\./)
  // With a step selected, “this” is that step.
  const selected = { kind: 'lane', id: station(built, 'Keep originals').id }
  assert.equal(station(said(built, 'Let this hold two tokens', selected), 'Keep originals').capacity, 2)
  assert.equal(said(built, 'Delete this step', selected).lanes.length, 3)
})

test('the same things said other ways: a list of steps, a step put in before another, a token moved on', () => {
  const fresh = createWorkshopMap()
  for (const message of ['Intake, Review, Done', 'Steps: Intake, Review and Done', 'Make a map with Intake, Review and Done', 'Intake > Review > Done', '1. Intake 2. Review 3. Done', 'First Intake, then Review, then Done']) {
    assert.deepEqual(said(fresh, message).lanes.map(lane => lane.label), ['Intake', 'Review', 'Done'], message)
  }
  // A sentence with commas in it is still the question a new map starts from, not a list of steps.
  assert.equal(said(fresh, 'We need to onboard, train and support new clients').lanes[0].label, 'We need to onboard, train and support new clients')
  assert.equal(said(fresh, 'How do we onboard, train and support a client?').lanes.length, 2)
  assert.equal(said(fresh, 'The pier is closed, the generator is down, and the band is late').lanes.length, 2)
  assert.deepEqual(said(fresh, 'Client CSV, Preview ten rows, Start a pilot').lanes.map(lane => lane.label), ['Client CSV', 'Preview ten rows', 'Start a pilot'])
  // On a map somebody has built, a bare list is not read as a path.
  assert.throws(() => said(built, 'Intake, Review, Done'), error => error.code === 'not-understood')

  // A path said in words is the path an arrow would draw.
  for (const message of ['Keep originals leads to Start a pilot', 'Keep originals goes to Start a pilot', 'Draw a line from Keep originals to Start a pilot', 'Add a path from Keep originals to Start a pilot', 'From Keep originals go to Start a pilot']) {
    assert.ok(station(said(built, message), 'Keep originals').station.next.includes(station(built, 'Start a pilot').id), message)
  }
  assert.equal(said(built, 'After Keep originals add Archive').lanes.at(-1).label, 'Archive')
  assert.equal(said(built, 'Add a step after Keep originals called Archive').lanes.at(-1).label, 'Archive')
  assert.equal(said(createWorkshopMap(), 'Add Follow-up at the end').lanes.at(-1).label, 'Follow-up')

  // A step put in front of another takes over the routes that led there.
  for (const message of ['Add Review before Start a pilot', 'Insert Review before Start a pilot', 'Add a step before Start a pilot called Review', 'Add Review between Preview ten rows and Start a pilot']) {
    const next = said(built, message), review = station(next, 'Review')
    assert.ok(review, message)
    assert.deepEqual(review.station.next, [station(built, 'Start a pilot').id], message)
    assert.deepEqual(station(next, 'Preview ten rows').station.next.sort(), [review.id, station(built, 'Keep originals').id].sort(), message)
    assert.equal(next.lanes.length, built.lanes.length + 1, message)
  }
  assert.throws(() => said(built, 'Add Review before Client CSV'), /Nothing leads to “Client CSV” yet\. Try “Add Review after Client CSV”\./)
  assert.throws(() => said(built, 'Add Review between Client CSV and Start a pilot'), /There is no path from “Client CSV” to “Start a pilot”\./)

  // A token moves on along the one route from where it is.
  for (const message of ['Move the token forward', 'Advance the token', 'Move Progress to the next step', 'Move Progress on']) {
    assert.equal(said(built, message).cards[0].laneId, station(built, 'Preview ten rows').id, message)
  }
  const atFork = said(built, 'Advance the token')
  assert.throws(() => said(atFork, 'Advance the token'), /From “Preview ten rows” the path goes to “Start a pilot” or “Keep originals”\. Say which, such as “Move Progress to Start a pilot”\./)
  assert.throws(() => said(said(atFork, 'Move Progress to Start a pilot'), 'Move the token on'), /“Progress” is at “Start a pilot”, and no path leads on from there\./)
  assert.deepEqual(said(built, 'Add a token').cards.map(card => [card.label, card.laneId]), [['Progress', 'start'], ['Token 2', 'start']])
  assert.equal(said(built, 'Add another token at Preview ten rows').cards.at(-1).laneId, station(built, 'Preview ten rows').id)

  // Names, limits and what a step says.
  for (const message of ['Change Client CSV to Upload', 'Call Client CSV Upload', 'Client CSV should be called Upload', 'Rename the first step to Upload', 'Change the name of Client CSV to Upload']) {
    assert.equal(said(built, message).lanes[0].label, 'Upload', message)
  }
  assert.equal(station(said(built, 'Only one token at Keep originals'), 'Keep originals').capacity, 1)
  for (const message of ['At Preview ten rows say The first ten rows are shown.', 'Preview ten rows says The first ten rows are shown.', 'On arrival at Preview ten rows, show The first ten rows are shown.']) {
    assert.equal(station(said(built, message), 'Preview ten rows').station.outcome, 'The first ten rows are shown.', message)
  }
})

test('a team brief becomes a private-map payload with its exact authored question and editable alternatives', async () => {
  const { readTeamMapBrief } = await import('../web/app/imports/api/common/team-map-brief.mjs')
  const { decodeWorkshopFragment } = createRequire(new URL('../web/app/package.json', import.meta.url))('slateboxjs/workshops/model')
  const brief = 'Which equipment should the crew pack if the gallery loses power during the evening installation?'
  const parse = words => decodeWorkshopFragment(readTeamMapBrief('#' + new URLSearchParams({brief:words})).fragment)
  const source = parse(brief)
  assert.equal(source.lanes[0].station.outcome, brief)
  assert.equal(source.title, brief)
  assert.ok(source.lanes[0].label.length <= 80)
  const result = proposeDirectMapEdit(source,'Borrow work lights or bring battery lanterns').workshop
  assert.deepEqual(result.lanes.slice(1).map(l => l.label), ['Borrow work lights','bring battery lanterns'])
  assert.deepEqual(result.lanes[0].station.next, result.lanes.slice(1).map(l=>l.id))
  assert.equal(source.lanes[1].label, 'Next decision')
  assert.equal(result.lanes[0].station.outcome,brief)
  assert.deepEqual(parse('Load dock → Check lights → Hang work').lanes.map(l=>l.label), ['Load dock','Check lights','Hang work'])
  for (const words of ['Approve → Approve','Where should this go →','A → B → C → D → E → F']) {
    assert.equal(parse(words).lanes[0].station.outcome,words)
    assert.equal(parse(words).lanes[1].label,'Next decision')
  }
  assert.equal(parse('x'.repeat(160)).lanes[0].station.outcome.length,160)
  for (const hash of ['#brief=', '#brief=test&brief=other', '#secret=test', '#brief='+'a'.repeat(161), '#brief=%3Cb%3Etag', '#brief=path%0Anext']) {
    assert.throws(() => readTeamMapBrief(hash))
  }
})

test('a branch and its arrival instruction can be previewed together on an existing route', () => {
  const map = proposeDirectMapEdit(createWorkshopMap(), 'Backfill review → Compare row counts → Approve cutover').workshop
  const result = proposeDirectMapEdit(map, 'After Compare row counts, add Repair missing rows. On arrival, reconcile the missing IDs and run the comparison again.')
  const source = result.workshop.lanes.find(lane => lane.label === 'Compare row counts')
  const repair = result.workshop.lanes.find(lane => lane.label === 'Repair missing rows')
  assert.deepEqual(source.station.next, [map.lanes[2].id, repair.id])
  assert.equal(repair.station.outcome, 'reconcile the missing IDs and run the comparison again.')
  assert.equal(map.lanes.length, 3)
  assert.deepEqual(result.workshop.cards, map.cards)
})

test('presentation edits preserve routes and use the current playback order for the remaining scenes', () => {
  const original = proposeDirectMapEdit(createWorkshopMap(), 'Migration review → Compare counts → Approve cutover').workshop
  const first = proposeDirectMapEdit(original, 'Present Approve cutover first').workshop
  const [review, counts, cutover] = original.lanes.map(lane => lane.id)
  assert.deepEqual(first.presentationOrder, [cutover, review, counts])
  assert.deepEqual(proposeDirectMapEdit(first, 'Present Compare counts first').workshop.presentationOrder, [counts, cutover, review])
  const explicit = proposeDirectMapEdit(first, 'Present in this order: Migration review → Approve cutover → Compare counts').workshop
  assert.deepEqual(proposeDirectMapEdit(first, 'Present Migration review after Compare counts').workshop.presentationOrder, [cutover, counts, review])
  assert.throws(() => proposeDirectMapEdit(first, 'Present Migration review after Migration review'), /different scenes/)
  assert.deepEqual(explicit, {...original, presentationOrder: [review, cutover, counts]})
  assert.equal(original.presentationOrder, undefined)
  for (const order of ['Migration review → Approve cutover', 'Migration review → Migration review → Compare counts', 'Unknown → Approve cutover → Compare counts']) {
    assert.throws(() => proposeDirectMapEdit(first, 'Present in this order: ' + order))
  }
})

test('selected-object instructions preview only the exact station, using its native rules', () => {
  const source = createWorkshopMap()
  source.presentationOrder = ['next', 'start']
  const selected = {kind:'lane',id:'next'}
  const preview = (text, board=source) => proposeDirectMapEdit(board,text,selected).workshop
  const renamed = preview('Rename it to Review')
  assert.equal(renamed.lanes[1].label,'Review')
  assert.equal(source.lanes[1].label,'Next step')
  const arrived = preview('On arrival, Check the manifest.',renamed)
  assert.equal(arrived.lanes[1].station.outcome,'Check the manifest.')
  const branched = preview('Add a branch to Support',arrived)
  assert.deepEqual(branched.lanes[1].station.next,['station-1'])
  assert.deepEqual(branched.presentationOrder,['next','start','station-1'])
  assert.deepEqual(preview('Connect to Start',branched).lanes[1].station.next,['station-1','start'])
  assert.deepEqual(preview('Disconnect from Support',branched).lanes[1].station.next,[])
  const positioned = preview('Move to column 2, row 3')
  assert.deepEqual([positioned.lanes[1].station.column,positioned.lanes[1].station.row],[1,2])
  assert.throws(()=>preview('Move to column 1, row 1'),/position/)
  const limited = preview('Set capacity to 2')
  assert.equal(limited.lanes[1].capacity,2)
  assert.equal(preview('Remove capacity',limited).lanes[1].capacity,undefined)
  const illustrated = preview('Set image https://example.org/map.jpg with description Docks at dawn')
  const described = preview('Change image description to North dock',illustrated)
  assert.deepEqual(described.lanes[1].station.image,{src:'https://example.org/map.jpg',alt:'North dock'})
  assert.equal(preview('Remove image',described).lanes[1].station.image,undefined)
  for(const bad of ['Set image http://example.org/file with description Test','Set capacity to 25','Connect to Next step','Disconnect from Start']) {
    assert.throws(()=>preview(bad))
  }
  assert.deepEqual(arrived.lanes[0], source.lanes[0])
  assert.deepEqual(arrived.cards,source.cards)
  assert.deepEqual(preview('Present Next step first').presentationOrder,['next','start'])
  assert.throws(()=>proposeDirectMapEdit(source,'Rename it to Review',{kind:'lane',id:'missing'}),/still on this map/)
  assert.throws(()=>proposeDirectMapEdit(source,'Rename it to Review',{kind:'lane',id:'next',label:'forged'}),/still on this map/)
})

test('selected tokens retain ordinary movement constraints and never rename their station', () => {
  const original=createWorkshopMap(),selection={kind:'card',id:'token'}
  const named=proposeDirectMapEdit(original,'Rename it to Patient',selection).workshop
  const moved=proposeDirectMapEdit(named,'Move to Next step',selection).workshop
  assert.equal(moved.cards[0].label,'Patient')
  assert.equal(moved.cards[0].laneId,'next')
  assert.throws(()=>proposeDirectMapEdit(moved,'Move to Start',selection),/unavailable/)
  assert.throws(()=>proposeDirectMapEdit(moved,'On arrival, Wait.',selection),/Select a station/)
  assert.deepEqual(moved.lanes,original.lanes)
})

test('a blank map can be built and refined entirely through the conversation', () => {
  const original = createWorkshopMap()
  const question = 'A buyer requests an order. What happens when it exceeds their approval limit?'
  const brief = proposeDirectMapEdit(original, question).workshop
  const paths = proposeDirectMapEdit(brief, 'Approve the order or Request finance review').workshop
  const revised = proposeDirectMapEdit(paths, 'For Request finance review, on arrival, Ask the controller.').workshop
  const finance = revised.lanes.find(lane => lane.label === 'Request finance review')
  assert.equal(finance.station.outcome, 'Ask the controller.')
  assert.ok(revised.lanes[0].station.next.includes(finance.id))
  assert.ok(isStarterMap(original))
})

test('preview a new map title and additional token at an existing station', () => {
  const original = createWorkshopMap()
  const renamed = proposeDirectMapEdit(original,'Rename this map to Night transfer').workshop
  assert.equal(original.title,'Untitled map')
  assert.equal(renamed.title,'Night transfer')
  const withToken = proposeDirectMapEdit(renamed,'Add token Dispatcher at Next step').workshop
  assert.deepEqual(withToken.cards[1],{id:'token-1',label:'Dispatcher',laneId:'next'})
  assert.equal(renamed.cards.length,1)
  assert.throws(()=>proposeDirectMapEdit(renamed,'Add token Dispatcher at Missing'))
  withToken.lanes[1].capacity=1
  assert.throws(()=>proposeDirectMapEdit(withToken,'Add token Conductor at Next step'),/capacity/)
})
