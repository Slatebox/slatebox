import test from 'node:test'
import assert from 'node:assert/strict'
import { createLaneWorkshop, createInterviewWorkshop, createBudgetWorkshop, releasePlan, startupExperienceKind, validateWorkshop } from 'slateboxjs/workshops/model'
import { proposeLaneEdit as edit, proposeLaneReply, laneObjectSelection } from '../web/app/imports/api/common/lane-conversation.mjs'
import { prepareLaneReply } from '../web/app/server/methods/lane-chat.mjs'

// A move the rules refuse is not made: it is offered as "Move anyway" (move-anyway.mjs), the reply the rule's own
// sentence and the question; the card it would move is marked with that rule; the board asked about is unchanged.
function offeredAnyway(board, message, selection, card, lane, sentence) {
  const before = JSON.stringify(board)
  const made = proposeLaneReply(board, message, selection)
  assert.equal(made.reply, '“' + card + '” can’t move to “' + lane + '” by this board’s rules. ' + sentence + ' Move it anyway?')
  assert.deepEqual({ card: made.override.card, lane: made.override.lane, sentence: made.override.sentence }, { card, lane, sentence })
  const moved = made.workshop.cards.find(item => item.label === card)
  assert.equal(made.workshop.lanes.find(item => item.id === moved.laneId).label, lane)
  assert.equal(moved.override.sentence, sentence)
  assert.equal(JSON.stringify(board), before)
  return made
}

test('lane commands preserve IDs, enforce capacities and allowed destinations, and preview without changing the source', () => {
  const base = createLaneWorkshop()
  let w = edit(base,'Add lane Review')
  w = edit(w,'Rename lane Lane 1 to Ideas')
  w = edit(w,'Add card Invoice to Ideas')
  w = edit(w,'Add card Contract to Ideas')
  w = edit(w,'Set capacity of Review to 1')
  w = edit(w,'Allow Invoice in Ideas, Review')
  const selected = laneObjectSelection(w,{kind:'card',id:w.cards[0].id})
  // A move the rules refuse is offered as "Move anyway", and the reply is the rule's own sentence.
  offeredAnyway(w,'Move this to Lane 2',selected,'Invoice','Lane 2',"This card can't go in Lane 2.")
  w = edit(w,'Move this to Review',selected)
  offeredAnyway(w,'Move Contract to Review',undefined,'Contract','Review','It already holds 1 of 1 card.')
  w = edit(w,'Present Review first')
  assert.deepEqual(w.presentationOrder,['lane-3','lane-1','lane-2'])
  assert.throws(()=>edit(w,'Present Review after Review'),/different/)
  w = edit(w,'Set outcome Ready for Invoice in Review: Send the file | Hold the file')
  assert.equal(w.signals[0].cardId,w.cards[0].id)
  w = edit(w,'Set outcome Ready for Invoice in Review: Send it | Keep reviewing')
  assert.equal(w.signals.length,1)
  w = edit(w,'Remove outcome Ready from Invoice')
  assert.equal(w.signals,undefined)
  assert.deepEqual(base,createLaneWorkshop())
})

test('card names and their destination lanes may both contain “to”', () => {
  const board = edit(createLaneWorkshop(),'Add lane Ready to review')
  const next = edit(board,'Add card Listen to the tide to Ready to review')
  assert.equal(next.cards[0].label,'Listen to the tide')
  assert.equal(next.cards[0].laneId,board.lanes[2].id)
})

test('release windows preserve dependencies and budgets and typed layouts retain their native experience', () => {
  assert.throws(()=>edit(releasePlan,'Set points of Invoice download to 25'),/A feature takes from 1 to 24 points\./)
  assert.throws(()=>edit(releasePlan,'Set dependencies of Permission checks to Team invitations'),/would end up waiting on each other|can only depend on one planned in the same release or an earlier one/)
  const plan = edit(releasePlan,'Set points of Invoice download to 4')
  assert.equal(plan.cards.find(c=>c.id==='billing').points,4)
  assert.deepEqual(plan.cards.find(c=>c.id==='invite').dependsOn,['guardrails'])
  for (const seed of [createInterviewWorkshop(), createBudgetWorkshop()]) {
    const renamed=edit(seed,'Rename board to Our pilot')
    assert.deepEqual(renamed.experience,seed.experience)
    assert.equal(startupExperienceKind(renamed),startupExperienceKind(seed))
    assert.throws(()=>edit(seed,'Add lane Unplanned'))
  }
  const seed = createBudgetWorkshop()
  const changed = edit(seed,'Move @'+seed.cards[0].id+' to @pilot')
  assert.equal(changed.cards[0].laneId,'pilot')
  assert.equal(changed.experience.kind,'experiment-budget')
})

test('provider edit batch accepts only supported commands with a valid revision-independent workshop proposal', () => {
  const original = createLaneWorkshop()
  const proposal = prepareLaneReply({reply:'Ready for review.',commands:['Add card First take to @lane-1','Move First take to @lane-2']},original)
  assert.equal(proposal.workshop.cards[0].laneId,'lane-2')
  assert.equal(original.cards.length,0)
  assert.throws(()=>prepareLaneReply({reply:'Try this.',commands:['Add card First take to Lane 1','Move First take to Missing']},original))
  assert.throws(()=>laneObjectSelection(original,{kind:'card',id:'missing'}))
  assert.throws(()=>edit(original,'Email everyone a copy'),e=>e.code==='not-understood')
})

// What a person would type, without having been taught a form. Each list is one change said several ways.
const week = ['Rename lane Lane 1 to Now','Rename lane Lane 2 to Next','Add lane Later','Add card Call Sam to Now','Add card Write the brief to Now','Add card Book the room to Next']
  .reduce((board,message)=>edit(board,message),createLaneWorkshop())
const lane = (board,label)=>board.lanes.find(item=>item.label===label)
const card = (board,label)=>board.cards.find(item=>item.label===label)
const each = (messages,check,board=week,selection=null)=>{ for (const message of messages) check(edit(board,message,selection),message) }

test('a lane workshop is changed in ordinary sentences', () => {
  each(['Add a lane called Blocked','add a new lane named Blocked','New lane: Blocked','Create a column called Blocked','Please add another lane for Blocked.','Can you add a lane called Blocked?'],
    (next,message)=>assert.equal(next.lanes.at(-1).label,'Blocked',message))
  assert.equal(edit(week,'Add a lane called Review that holds 2 cards').lanes.at(-1).capacity,2)
  each(['Add a card called Email Jo to Next','Add Email Jo to Next','Put a new card called Email Jo in Next','New card: Email Jo in Next','Add a card called "Email Jo" to the Next lane.'],
    (next,message)=>assert.deepEqual([next.cards.at(-1).label,next.cards.at(-1).laneId],['Email Jo',lane(week,'Next').id],message))
  assert.equal(edit(week,'Add a card called Email Jo').cards.at(-1).laneId,lane(week,'Now').id,'with no lane named, the first lane')
  assert.equal(edit(week,'Add a card called Reply to Sam to Later').cards.at(-1).label,'Reply to Sam')
  each(['Rename the board to Team week','Call this workshop Team week','Change the title to Team week','Name the board "Team week"','Rename the workshop to Team week.'],
    (next,message)=>assert.equal(next.title,'Team week',message))
  each(['Rename Now to Today','Rename the Now lane to Today','Rename the lane Now to Today','Change Now to Today'],(next,message)=>assert.equal(next.lanes[0].label,'Today',message))
  each(['Rename Call Sam to Call Samira','Change Call Sam to Call Samira','rename "Call Sam" to "Call Samira"','Rename the card Call Sam to Call Samira'],
    (next,message)=>assert.equal(next.cards[0].label,'Call Samira',message))
  each(['Let Now hold two cards','Now holds 2','Now can hold up to two cards','Limit Now to 2 cards','Only 2 cards in Now','Set the limit of Now to 2','Max 2 in Now','Now should hold at most 2 cards at a time','Set capacity of Now to 2'],
    (next,message)=>assert.equal(lane(next,'Now').capacity,2,message))
  const limited = edit(week,'Let Now hold two cards')
  each(['Remove the limit on Now','No limit on Now','Now can hold any number of cards','Set capacity of Now to unlimited'],(next,message)=>assert.equal(lane(next,'Now').capacity,undefined,message),limited)
  each(['Move Call Sam to Later','Put Call Sam in Later','Move the Call Sam card to the Later lane','Call Sam goes to Later','Send Call Sam to Later please','Can you move Call Sam to Later?','move call sam into later'],
    (next,message)=>assert.equal(card(next,'Call Sam').laneId,lane(week,'Later').id,message))
  each(['Call Sam can only go in Now and Next','Keep Call Sam in Now and Next','Allow Call Sam in Now, Next'],
    (next,message)=>assert.deepEqual(card(next,'Call Sam').allowedLaneIds,[lane(week,'Now').id,lane(week,'Next').id],message))
  const kept = edit(week,'Keep Call Sam in Now and Next')
  each(['Call Sam can go anywhere','Let Call Sam go in any lane','Allow Call Sam in any lane'],(next,message)=>assert.equal(card(next,'Call Sam').allowedLaneIds,undefined,message),kept)
  each(['Present Later first','Start the presentation with Later','Show Later first','Show Later before Now'],(next,message)=>assert.equal(next.presentationOrder[0],lane(week,'Later').id,message))
  const outcome = edit(week,'When Call Sam is in Later, say Sam has been called. Otherwise say Still to call.')
  assert.deepEqual(outcome.signals.map(({label,cardId,laneId,whenPresent,whenAbsent})=>({label,cardId,laneId,whenPresent,whenAbsent})),
    [{label:'Call Sam in Later',cardId:card(week,'Call Sam').id,laneId:lane(week,'Later').id,whenPresent:'Sam has been called',whenAbsent:'Still to call.'}])
  assert.equal(edit(outcome,'Remove the outcome from Call Sam').signals,undefined)
})

test('cards and empty lanes can be removed, with everything that pointed at them', () => {
  let board = edit(week,'Keep Call Sam in Now and Later')
  board = edit(board,'When Call Sam is in Later, say Called. Otherwise say Not yet.')
  board = edit(board,'Present Later first')
  each(['Remove Call Sam','Delete the card Call Sam','Get rid of Call Sam','Remove Call Sam from Now'],(next,message)=>{
    assert.deepEqual(next.cards.map(item=>item.label),['Write the brief','Book the room'],message)
    assert.equal(next.signals,undefined,message)
  },board)
  each(['Delete the Later lane','Remove the lane Later','Delete Later'],(next,message)=>{
    assert.deepEqual(next.lanes.map(item=>item.label),['Now','Next'],message)
    assert.deepEqual(card(next,'Call Sam').allowedLaneIds,[lane(week,'Now').id],message)
    assert.equal(next.signals,undefined,message)
    assert.deepEqual(next.presentationOrder,[lane(week,'Now').id,lane(week,'Next').id],message)
  },board)
  assert.throws(()=>edit(week,'Remove the lane Now'),/“Now” holds 2 cards\. Move or remove them first\./)
  assert.throws(()=>edit(createLaneWorkshop(),'Delete Lane 2'),/at least two columns/)
  assert.deepEqual(week.cards.map(item=>item.label),['Call Sam','Write the brief','Book the room'],'the source is untouched')
})

test('“this” is the lane or card selected on the canvas, and asks for a selection when there is none', () => {
  const sam = {kind:'card',id:card(week,'Call Sam').id}, later = {kind:'lane',id:lane(week,'Later').id}
  each(['Move this to Later','Move it to Later','Put it in Later','Move this card to Later'],(next,message)=>assert.equal(card(next,'Call Sam').laneId,later.id,message),week,sam)
  each(['Rename this to Call Samira','Rename this card to Call Samira','Rename it to Call Samira'],(next,message)=>assert.equal(next.cards[0].label,'Call Samira',message),week,sam)
  each(['Remove this','Delete this card'],(next,message)=>assert.equal(next.cards.length,2,message),week,sam)
  each(['Add a card called Email Jo here','Add a card called Email Jo','Add a card called Email Jo to this lane','Add Email Jo to this'],
    (next,message)=>assert.deepEqual([next.cards.at(-1).label,next.cards.at(-1).laneId],['Email Jo',later.id],message),week,later)
  each(['Let this lane hold two cards','This holds 2'],(next,message)=>assert.equal(lane(next,'Later').capacity,2,message),week,later)
  assert.equal(edit(week,'Remove this lane',later).lanes.length,2)
  assert.throws(()=>edit(week,'Move this to Next'),/Select a card on the canvas first, or use its name\./)
  assert.throws(()=>edit(week,'Remove this'),/Select a column or a card on the canvas first, or use its name\./)
})

test('a name is read as a person would say it, and a reply says what is there when it picks nothing or too much', () => {
  const budget = createBudgetWorkshop()
  // “Customer calls” for “Customer calls · $50 per call”, any case, with or without “the”.
  each(['Move Third $200 to Customer calls','Put Third $200 in Customer calls','move third $200 to customer calls','Third $200 goes to Customer calls','Move Third to calls','Move the third $200 to the Customer calls lane.'],
    (next,message)=>assert.equal(next.cards[2].laneId,'calls',message),budget)
  assert.equal(edit(budget,'Send Second $200 to the newsletter').cards[1].laneId,'newsletter')
  assert.equal(edit(budget,'Put First $200 back in Unallocated').cards[0].laneId,'reserve')
  assert.throws(()=>edit(budget,'Move $200 to Customer calls'),/More than one card matches “\$200”: First \$200, Second \$200 and Third \$200\. Use the whole name\./)
  assert.throws(()=>edit(week,'Move Call Bob to Next'),/There is no card called “Call Bob” here\. The cards are Call Sam, Write the brief and Book the room\./)
  assert.throws(()=>edit(week,'Move Call Sam to Done'),/There is no lane called “Done” here\. The lanes are Now, Next and Later\./)
  assert.throws(()=>edit(week,'Move Call Sam to Now'),/“Call Sam” is already in “Now”\./)
  // The whole name wins over one that only starts the same way.
  const interviews = createInterviewWorkshop()
  assert.equal(edit(interviews,'Rename Prototype to test to Build next').lanes[1].label,'Build next')
  assert.equal(edit(interviews,'Move Bea to Prototype to test').cards.find(item=>item.id==='duplicate').laneId,'prototype')
  assert.equal(edit(interviews,'Put Sam in the prototype').cards.find(item=>item.id==='undo').laneId,'prototype')
  assert.equal(edit(interviews,'Move Jo back to the interviews').cards.find(item=>item.id==='preview').laneId,'interviews')
  // A lane and a card with one name: the sentence has to say which.
  const twins = edit(edit(week,'Add lane Review'),'Add card Review to Now')
  assert.throws(()=>edit(twins,'Rename Review to Check'),/A lane and a card both match “Review”/)
  assert.equal(edit(twins,'Rename the lane Review to Check').lanes.at(-1).label,'Check')
  assert.equal(edit(twins,'Rename the card Review to Check').cards.at(-1).label,'Check')
})

test('limits, layouts and rules are refused in plain words', () => {
  assert.throws(()=>edit(week,'Let Now hold one card'),/“Now” already holds 2 cards\. Move some out first, or choose a higher number\./)
  assert.throws(()=>edit(week,'Let Now hold zero cards'),/A column can hold from 1 to 24 cards\./)
  assert.throws(()=>edit(week,'Call Sam can only go in Later'),/“Call Sam” is in “Now” now\. Include “Now”, or move the card first\./)
  const full = edit(week,'Next holds 1')
  assert.throws(()=>edit(full,'Add a card called Email Jo to Next'),/“Next” is full: it holds 1 card\./)
  offeredAnyway(full,'Move Call Sam to Next',undefined,'Call Sam','Next','It already holds 1 of 1 card.')
  assert.throws(()=>edit(createBudgetWorkshop(),'Add a lane called Later'),/This workshop keeps the lanes it came with\./)
  assert.throws(()=>edit(createInterviewWorkshop(),'Add a card called Kim to Customer interviews'),/This workshop keeps the cards it came with\./)
  assert.throws(()=>edit(week,'Call Sam is 3 points'),/This workshop counts cards, not points\./)
  assert.throws(()=>edit(week,'Call Sam depends on Book the room'),/Only a release plan keeps track of what depends on what\./)
  // Not read here: something else entirely, a question (even one that names a lane), and a
  // request to think cards up. With Canvas AI these go to it; without, the reply says what can be done.
  for (const message of ['Email everyone a copy','What is this workshop for?','Make it blue','Undo that','Add Review','How much is left?',
    'What goes in Later?','Which lane is Call Sam in?','Is Now full?','Add three cards about onboarding to Now','Add some ideas to Later','Add cards for each teammate to Now']) {
    assert.throws(()=>edit(week,message),error=>error.code==='not-understood'&&/^I did not follow that\. I can /.test(error.message),message)
  }
})

test('a release plan takes points, budgets and dependencies in ordinary sentences', () => {
  const plan = validateWorkshop({version:1,kind:'release-plan',title:'Release plan',
    lanes:[{id:'now',label:'This week',capacity:8},{id:'next',label:'Next week',capacity:8},{id:'later',label:'Later'}],
    cards:[{id:'a',label:'Sign-in',laneId:'now',points:3},{id:'b',label:'Invites',laneId:'next',points:5,dependsOn:['a']},{id:'c',label:'Billing',laneId:'later',points:2}]})
  each(['Sign-in is 5 points','Set points of Sign-in to 5','Make Sign-in 5 points','Sign-in takes 5 points','Give Sign-in five points'],(next,message)=>assert.equal(next.cards[0].points,5,message),plan)
  each(['Give This week 12 points','This week holds 12 points','Set the budget of This week to 12','Limit This week to 12 points'],(next,message)=>assert.equal(next.lanes[0].capacity,12,message),plan)
  each(['Billing depends on Sign-in','Billing needs Sign-in first','Set dependencies of Billing to Sign-in'],(next,message)=>assert.deepEqual(next.cards[2].dependsOn,['a'],message),plan)
  each(['Invites depends on nothing','Invites has no dependencies','Set dependencies of Invites to none','Remove the dependencies from Invites'],(next,message)=>assert.equal(next.cards[1].dependsOn,undefined,message),plan)
  each(['Move Billing to This week','Put Billing in This week','Billing goes to This week'],(next,message)=>assert.equal(next.cards[2].laneId,'now',message),plan)
  // Pulling a feature forward brings what it needs, as a drag does.
  assert.deepEqual(edit(plan,'Move Sign-in to Later').cards.map(item=>item.laneId),['later','later','later'])
  assert.throws(()=>edit(plan,'Sign-in is 30 points'),/A feature takes from 1 to 24 points\./)
  assert.throws(()=>edit(plan,'Limit This week to 2 points'),/“This week” already holds 3 points\./)
  assert.throws(()=>edit(plan,'Sign-in depends on Invites'),/can only depend on one planned in the same release or an earlier one/)
  assert.throws(()=>edit(plan,'Add a lane called Someday'),/A release plan keeps the releases it came with\./)
  assert.throws(()=>edit(plan,'Add a card called Search to Later'),/A release plan keeps the features it came with\./)
  assert.equal(edit(plan,'Rename the plan to Spring release').title,'Spring release')
})

test('the same things said other ways: names first, lanes by their place, several cards at once', () => {
  each(['Add a Blocked lane','Add a new Blocked column'],(next,message)=>assert.equal(next.lanes.at(-1).label,'Blocked',message))
  each(['Add a card to Next called Email Jo','Add a card in Next: Email Jo','Create a card for Email Jo in Next','Add a task called Email Jo to Next','Add an item called Email Jo to Next'],
    (next,message)=>assert.deepEqual([next.cards.at(-1).label,next.cards.at(-1).laneId],['Email Jo',lane(week,'Next').id],message))
  // Half a request is answered with the other half to give, not with a card called “to Next”.
  assert.throws(()=>edit(week,'Add a lane'),/Give the column a name, such as “Add a column called Later”\./)
  // (Restated 2026-11-23, owner decision: a card asked for without words takes the board's name for a
  // new item. "Add a card to Next" adds “New card”; "Add a card" asks only which lane.)
  assert.throws(()=>edit(week,'Add a card'),/Say which column the card goes in/)
  assert.deepEqual([edit(week,'Add a card to Next').cards.at(-1).label, edit(week,'Add a card to Next').cards.at(-1).laneId], ['New card', lane(week,'Next').id])
  each(['Now should be called Today','Call Now Today','Call the Now lane Today','Name the Now lane Today','Change the name of Now to Today','Change the name of the Now lane to Today','Rename the first lane to Today','Rename lane 1 to Today'],
    (next,message)=>assert.equal(next.lanes[0].label,'Today',message))
  assert.equal(edit(week,'Rename the last lane to Someday').lanes.at(-1).label,'Someday')
  // A lane really called “Lane 1” is that lane, wherever it stands.
  assert.equal(edit(edit(createLaneWorkshop(),'Rename Lane 1 to Lane 2a'),'Rename Lane 2 to Second').lanes[1].label,'Second')
  each(['Rename the workshop Team week','This workshop should be called Team week'],(next,message)=>assert.equal(next.title,'Team week',message))
  each(['Move Call Sam from Now to Later','Move Call Sam over to Later','Call Sam → Later','Assign Call Sam to Later','Call Sam should be in Later'],
    (next,message)=>assert.equal(card(next,'Call Sam').laneId,lane(week,'Later').id,message))
  each(['Move Call Sam and Write the brief to Later','Move Call Sam, Write the brief to Later','Move everything in Now to Later','Move all the cards from Now to Later'],
    (next,message)=>assert.deepEqual(next.cards.map(item=>item.laneId),[lane(week,'Later').id,lane(week,'Later').id,lane(week,'Next').id],message))
  assert.deepEqual(edit(week,'Move all cards to Later').cards.map(item=>item.laneId),Array(3).fill(lane(week,'Later').id))
  assert.equal(proposeLaneReply(week,'Move Call Sam and Write the brief to Later').reply,'Moved “Call Sam” and “Write the brief” to “Later”.')
  // Together or not at all: a lane with room for one does not take two.
  assert.throws(()=>edit(edit(week,'Later holds 1'),'Move Call Sam and Write the brief to Later'),/“Write the brief” can’t move to “Later”\. /)
  each(['Delete Call Sam and Write the brief','Clear Now','Empty the Now lane','Remove everything from Now','Remove all the cards in Now'],
    (next,message)=>assert.deepEqual(next.cards.map(item=>item.label),['Book the room'],message))
  assert.equal(edit(week,'Take Call Sam off the board').cards.length,2)
  assert.throws(()=>edit(week,'Clear Later'),/“Later” holds no cards\./)
  each(['Now max 2','Set Now to 2 cards','WIP limit of 2 on Now','A limit of 2 for Now','Set a limit of 2 on Now','Give Now a limit of 2','Now has a limit of 2','Now can only have 2 cards','Only allow 2 cards in Now','Two cards max in Now','Raise Now to 2'],
    (next,message)=>assert.equal(lane(next,'Now').capacity,2,message))
})

test('money and features are moved in the words people use for them', () => {
  const budget = createBudgetWorkshop()
  each(['Spend the third $200 on customer calls','Spend Third $200 on calls','Allocate Third $200 to Customer calls','Assign Third $200 to Customer calls','Fund customer calls with the Third $200','Use Third $200 for customer calls','Third $200 → Customer calls','Move Third $200 from Unallocated to Customer calls'],
    (next,message)=>assert.equal(next.cards[2].laneId,'calls',message),budget)
  assert.equal(edit(budget,'Return First $200 to Unallocated').cards[0].laneId,'reserve')
  assert.deepEqual(edit(budget,'Spend it all on calls').cards.map(item=>item.laneId),['calls','calls','calls'])
  assert.deepEqual(edit(budget,'Move Second $200 and Third $200 to the newsletter').cards.map(item=>item.laneId),['calls','newsletter','newsletter'])
  const plan = validateWorkshop({version:1,kind:'release-plan',title:'Release plan',
    lanes:[{id:'now',label:'This week',capacity:8},{id:'next',label:'Next week',capacity:8},{id:'later',label:'Later'}],
    cards:[{id:'a',label:'Sign-in',laneId:'now',points:3},{id:'b',label:'Invites',laneId:'next',points:5,dependsOn:['a']},{id:'c',label:'Billing',laneId:'later',points:2}]})
  each(['Move Billing up to This week','Pull Billing into This week','Schedule Billing for This week','Plan Billing for This week'],(next,message)=>assert.equal(next.cards[2].laneId,'now',message),plan)
  assert.equal(edit(plan,'Defer Sign-in to Next week').cards[0].laneId,'next')
  // “Change Billing to 5 points” sets its points. It does not rename the feature “5 points”.
  each(['Change Billing to 5 points','Billing is a 5','Estimate Billing at 5','Billing: 5 points','Billing has 5 points'],
    (next,message)=>assert.deepEqual([next.cards[2].label,next.cards[2].points],['Billing',5],message),plan)
  each(['Increase This week to 12 points','This week has 12 points','Raise the budget for This week to 12'],(next,message)=>assert.equal(next.lanes[0].capacity,12,message),plan)
  each(['Billing is blocked by Sign-in','Billing is waiting on Sign-in','Sign-in blocks Billing'],(next,message)=>assert.deepEqual(next.cards[2].dependsOn,['a'],message),plan)
  each(['Invites no longer depends on Sign-in','Invites does not depend on Sign-in','Remove the dependency between Invites and Sign-in'],(next,message)=>assert.equal(next.cards[1].dependsOn,undefined,message),plan)
  assert.throws(()=>edit(plan,'Billing no longer depends on Sign-in'),/“Billing” does not depend on “Sign-in”\./)
  assert.throws(()=>edit(week,'Set Call Sam to 3 points'),/This workshop counts cards, not points\./)
})

test('a proposal comes with what to say back', () => {
  assert.equal(proposeLaneReply(createBudgetWorkshop(),'Move Third $200 to Customer calls').reply,'Moved “Third $200” to “Customer calls · $50 per call”.')
  assert.equal(proposeLaneReply(week,'Let Now hold two cards').reply,'“Now” now holds up to 2 cards.')
  assert.equal(proposeLaneReply(week,'Add a lane called Blocked').reply,'Added the column “Blocked”.')
})

test('a request for ordinary notes is understood and handed to the drawing; a note for a lane is a card there', () => {
  const base = validateWorkshop({ version: 1, title: 'Plan', lanes: [{ id: 'now', label: 'Now' }, { id: 'next', label: 'Next' }], cards: [{ id: 'idea', label: 'New idea', laneId: 'now' }] })
  const card = laneObjectSelection(base, { kind: 'card', id: 'idea' })
  for (const [message, labels] of [['can you add a couple more regular notes', ['New note', 'New note']], ['Add a note called Call the printer', ['Call the printer']], ['add two notes', ['New note', 'New note']]]) {
    assert.throws(() => edit(base, message, card), error => error.code === 'drawing' && JSON.stringify(error.notes) === JSON.stringify(labels), message)
    assert.throws(() => edit(base, message), error => error.code === 'drawing', message)
  }
  // Named for a lane, or "here" with a lane selected, a note is a card in that lane.
  assert.deepEqual(edit(base, 'Add a note called Call Sam to Next').cards.at(-1), { id: 'card-1', label: 'Call Sam', laneId: 'next' })
  const lane = laneObjectSelection(base, { kind: 'lane', id: 'next' })
  assert.equal(edit(base, 'Add a note called Call Sam here', lane).cards.at(-1).laneId, 'next')
  // A card is still a card.
  assert.equal(edit(base, 'Add a card called Call Sam').cards.at(-1).laneId, 'now')
})

// cards-fix (2026-11-19): typed requests a Free conversation was offering to upgrade for. They are
// done here, on every plan, with no drafting.
test('with a card selected, plain words take it off the lanes as an ordinary note, or say why it stays', () => {
  const base = validateWorkshop({ version: 1, title: 'Plan', lanes: [{ id: 'now', label: 'Now' }, { id: 'later', label: 'Later' }],
    cards: [{ id: 'idea', label: 'New idea', laneId: 'now' }, { id: 'kept', label: 'Kept', laneId: 'now', allowedLaneIds: ['now'] }] })
  const card = laneObjectSelection(base, { kind: 'card', id: 'idea' })
  for (const message of ['turn this card into a note', 'make this a regular note', 'Make this an ordinary note again', 'turn it into a sticky note',
    'move this to the canvas', 'take this off the lanes', 'turn New idea into a note']) {
    const proposal = proposeLaneReply(base, message, card)
    assert.equal(proposal.toCanvas, 'idea', message)
    assert.deepEqual(proposal.workshop.cards.map(item => item.id), ['kept'], message)
    assert.equal(proposal.reply, 'Making “New idea” an ordinary note beside the board.', message)
  }
  assert.throws(() => proposeLaneReply(base, 'turn this into a note', laneObjectSelection(base, { kind: 'card', id: 'kept' })), /Kept may only be in Now, so it stays a card/)
})

test('cards by number go in the lane named or selected, and a card takes a colour', () => {
  const base = validateWorkshop({ version: 1, title: 'Plan', lanes: [{ id: 'now', label: 'Now' }, { id: 'later', label: 'Later' }], cards: [{ id: 'idea', label: 'New idea', laneId: 'now' }] })
  const three = proposeLaneReply(base, 'add three cards to Later', laneObjectSelection(base, { kind: 'card', id: 'idea' }))
  assert.deepEqual(three.workshop.cards.slice(1).map(item => item.label + '@' + item.laneId), ['New card@later', 'New card@later', 'New card@later'])
  assert.equal(three.reply, 'Added 3 cards to “Later”.')
  const lane = laneObjectSelection(base, { kind: 'lane', id: 'later' })
  assert.deepEqual(proposeLaneReply(base, 'add two notes here', lane).workshop.cards.slice(1).map(item => item.laneId), ['later', 'later'])
  // With a card selected, “here” is the card's lane.
  assert.deepEqual(proposeLaneReply(base, 'add two notes here', laneObjectSelection(base, { kind: 'card', id: 'idea' })).workshop.cards.slice(1).map(item => item.laneId), ['now', 'now'])
  // (Restated 2026-11-23: one card asked for without words is “New card” in that lane, not one called “here”.)
  const blank = proposeLaneReply(base, 'add a note here', lane)
  assert.deepEqual([blank.workshop.cards.at(-1).label, blank.workshop.cards.at(-1).laneId, blank.reply], ['New card', 'later', 'Added “New card” to “Later”.'])
  const red = proposeLaneReply(base, 'make this card red', laneObjectSelection(base, { kind: 'card', id: 'idea' }))
  assert.match(red.workshop.cards[0].look.backgroundColor, /^#[0-9a-f]{6}$/)
  assert.equal(red.reply, 'Coloured “New idea” red.')
  assert.equal(proposeLaneReply(base, 'color this blue', laneObjectSelection(base, { kind: 'card', id: 'idea' })).reply, 'Coloured “New idea” blue.')
  assert.throws(() => proposeLaneReply(base, 'add 13 notes', laneObjectSelection(base, { kind: 'card', id: 'idea' })), /up to 12 notes at a time/)
})
