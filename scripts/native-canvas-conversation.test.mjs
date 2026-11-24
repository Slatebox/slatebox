import assert from 'node:assert/strict'
import test from 'node:test'
import {nativeCanvasDraft, mapFromDrawing} from '../web/app/imports/api/common/native-canvas-conversation.mjs'
import {nativeSlateFromBrief} from '../web/app/imports/api/common/native-diagram-brief.mjs'
import {draftToPlan} from '../web/app/imports/api/common/canvas-draft-plan.mjs'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'

// Restated for exec: Keep saves a draft as one canvas plan through slates.applyOperations, so
// the kept board is what the engine makes of that plan (it was applyNativeCanvasDraft).
const {applyPlanToJSON}=createRequire(new URL('../web/app/package.json',import.meta.url))('slateboxjs/operations')
const keep=(nodes,draft)=>applyPlanToJSON({nodes:structuredClone(nodes)},draftToPlan(draft).plan,{requireMatches:true}).slate.nodes
const fields=o=>[o.id,o.text,o.xPos,o.yPos,o.width,o.height]
const req='nATivE12345678901'
test('native drawing additions are independent editable connected nodes positioned past existing content',()=>{
  const base=nativeSlateFromBrief('A → B');const original=structuredClone(base)
  const {nodes}=nativeCanvasDraft(base,'Inspect → Approve',req)
  assert.deepEqual(nodes.map(n=>n.options.text),['Inspect','Approve'])
  assert.ok(nodes[0].options.xPos>base.nodes[1].options.xPos+base.nodes[1].options.width)
  assert.equal(nodes[0].relationships.associations[0].childId,nodes[1].options.id)
  assert.deepEqual(base,original)
})
test('native play attaches the current directed topology, including returns, without rewriting drawing geometry or copy',()=>{
  const base=nativeSlateFromBrief('Intake → Review → Send\nReview → Intake')
  const original=structuredClone(base)
  const {workshop}=nativeCanvasDraft(base,'Make this drawing interactive',req)
  const lanes=workshop.lanes
  assert.deepEqual(lanes.map(l=>l.label),['Intake','Review','Send'])
  assert.deepEqual(lanes[1].station.next,[lanes[2].id,lanes[0].id])
  assert.deepEqual(base,original)
  assert.throws(()=>mapFromDrawing([base.nodes[0]],'test'),/two to five/)
  const plain=nativeCanvasDraft({nodes:[]},'Make this interactive: Intake → Review',req)
  assert.deepEqual(plain.workshop.lanes.map(l=>l.label),['Intake','Review'])

})
test('a native drawing can gain a limited workshop on the same slate without changing its contents',()=>{
  const base=nativeSlateFromBrief('Customer → Pilot');const original=structuredClone(base)
  const {workshop,mode,format}=nativeCanvasDraft(base,'Make a workshop with Ideas and Pilot, limit Pilot to two cards.',req)
  assert.equal(mode,'play');assert.equal(format,'lanes')
  assert.deepEqual(workshop.lanes,[{id:'lane-1',label:'Ideas'},{id:'lane-2',label:'Pilot',capacity:2}])
  assert.deepEqual(workshop.cards,[]);assert.deepEqual(base,original)
  assert.throws(()=>nativeCanvasDraft(base,'Make a workshop with Ideas and Pilot, limit Missing to 2 cards',req))
  assert.throws(()=>nativeCanvasDraft(base,'Make a workshop with Ideas and Ideas',req))
  assert.deepEqual(nativeCanvasDraft(base,'Create a workshop for our editorial meeting.',req,workshop).workshop,workshop)
})
test('provider sees relevant source note text and real links, with bounded disclosure',async()=>{
  const {nativeDrawingContext}=await import('../web/app/imports/api/common/native-graph-draft.mjs')
  const source=nativeSlateFromBrief('Beacon → Ingest → Archive')
  source.nodes[0].options.image='https://private.invalid/asset'
  const context=nativeDrawingContext(source,'show the Ingest dependencies')
  assert.equal(context.notes[0].text,'Ingest')
  assert.deepEqual(context.connections,[{from:'note-1',to:'note-2'},{from:'note-2',to:'note-3'}])
  assert.ok(!JSON.stringify(context).includes('private.invalid'))
})
const friday=()=>nativeSlateFromBrief('What can still ship on Friday?','friday-launch')
const note=(board,id)=>board.nodes.find(n=>n.options.id===id)
test('a step named after an existing note extends that note beside it, in any letter case',()=>{
  const base=friday();const original=structuredClone(base)
  const draft=nativeCanvasDraft(base,'ships MONDAY → Email the pilot customers',req)
  assert.equal(draft.mode,'draw')
  assert.deepEqual(draft.labels,['Ships Monday','Email the pilot customers'])
  assert.equal(draft.nodes.length,1)
  const [added]=draft.nodes, monday=note(base,'monday').options
  assert.equal(added.options.text,'Email the pilot customers')
  assert.equal(added.options.id,'chat-'+req+'-1')
  assert.deepEqual([added.options.xPos,added.options.yPos],[monday.xPos+monday.width+96,monday.yPos])
  assert.deepEqual(added.relationships.associations,[])
  assert.equal(draft.links.length,1)
  assert.equal(draft.links[0].parentId,'monday')
  assert.deepEqual(draft.links[0].association,{id:'chat-'+req+'-step-1-step-2',parentId:'monday',childId:added.options.id,
    lineType:'straight',lineColor:'#516b60',lineWidth:3,showChildArrow:true})
  assert.deepEqual(base,original)

  const kept=keep(base.nodes,draft)
  assert.deepEqual(base,original)
  assert.equal(kept.length,8)
  assert.deepEqual(kept.filter(n=>n.options.text.toLowerCase()==='ships monday').map(n=>n.options.id),['monday'])
  assert.deepEqual(note({nodes:kept},'monday').relationships.associations.map(a=>a.childId),['tell',added.options.id])
  // Restated: the stored notes are unchanged but for monday's new arrow; the new note is the
  // draft's (the engine adds its own defaults to a new note, so it is compared by what the draft set).
  assert.deepEqual(kept.slice(0,7).map((n,i)=>i===5 ? n.options : n),original.nodes.map((n,i)=>i===5 ? n.options : n))
  assert.deepEqual(fields(kept[7].options),fields(added.options))
  assert.deepEqual(kept[7].relationships.associations,[])
})
test('a multi-line note is named by its words and a longer row continues to the right',()=>{
  const base=friday();const original=structuredClone(base)
  const draft=nativeCanvasDraft(base,'  second engineer   reads it first → Pair on the rollback plan → Sign off',req)
  assert.deepEqual(draft.labels,['Second engineer reads it first','Pair on the rollback plan','Sign off'])
  const [pair,sign]=draft.nodes, reader=note(base,'reader').options
  assert.equal(draft.nodes.length,2)
  assert.deepEqual([pair.options.xPos,pair.options.yPos],[reader.xPos+reader.width+96,reader.yPos])
  assert.deepEqual([sign.options.xPos,sign.options.yPos],[pair.options.xPos+pair.options.width+96,reader.yPos])
  assert.deepEqual(draft.links.map(l=>[l.parentId,l.association.parentId,l.association.childId]),[['reader','reader',pair.options.id]])
  assert.deepEqual(pair.relationships.associations.map(a=>[a.parentId,a.childId]),[[pair.options.id,sign.options.id]])
  assert.ok(draft.links.concat(pair.relationships.associations).every(l=>(l.association||l).id.startsWith('chat-'+req+'-')))
  assert.deepEqual(base,original)
})
test('a note placed beside its parent moves down until it clears existing and new notes by 24px',()=>{
  const base=nativeSlateFromBrief('A → B');const original=structuredClone(base)
  const [a,b]=base.nodes.map(n=>n.options)
  assert.equal(a.xPos+a.width+96,b.xPos)
  const request='a → C\nA → D\nElsewhere → b → E'
  const draft=nativeCanvasDraft(base,request,req)
  assert.deepEqual(draft.labels,['A','C','D','Elsewhere','B','E'])
  const [c,d,elsewhere,e]=draft.nodes.map(n=>n.options)
  assert.deepEqual(draft.nodes.map(n=>n.options.text),['C','D','Elsewhere','E'])
  assert.deepEqual([c.xPos,c.yPos],[b.xPos,a.yPos+c.height+48])
  assert.deepEqual([d.xPos,d.yPos],[b.xPos,a.yPos+2*(d.height+48)])
  // A new note ahead of every existing note in its row keeps the placement past the drawing.
  const alone=nativeSlateFromBrief(request).nodes.find(n=>n.options.text==='Elsewhere').options
  assert.deepEqual([elsewhere.xPos,elsewhere.yPos],[alone.xPos+b.xPos+b.width+72,alone.yPos+a.yPos])
  assert.equal(e.xPos,b.xPos+b.width+96)
  assert.equal((e.yPos-b.yPos)%(e.height+48),0)
  const boxes=[...base.nodes,...draft.nodes].map(n=>n.options)
  for(const [i,p] of boxes.entries()) for(const q of boxes.slice(i+1)) {
    assert.ok(p.xPos+p.width+24<=q.xPos || q.xPos+q.width+24<=p.xPos || p.yPos+p.height+24<=q.yPos || q.yPos+q.height+24<=p.yPos,p.text+' crowds '+q.text)
  }
  assert.deepEqual(draft.links.map(l=>[l.parentId,l.association.childId]),[[a.id,c.id],[a.id,d.id],[b.id,e.id]])
  assert.deepEqual(draft.nodes.map(n=>n.relationships.associations.map(x=>x.childId)),[[],[],[b.id],[]])
  assert.deepEqual(base,original)

  const shifted=nativeCanvasDraft({nodes:[...base.nodes,{options:{id:'wall',text:'',xPos:b.xPos+b.width+96+218+23,yPos:b.yPos,width:40,height:76}}]},'B → F',req).nodes[0].options
  assert.deepEqual([shifted.xPos,shifted.yPos],[b.xPos+b.width+96,b.yPos+shifted.height+48])
  const clear=nativeCanvasDraft({nodes:[...base.nodes,{options:{id:'wall',text:'',xPos:b.xPos+b.width+96+218+24,yPos:b.yPos,width:40,height:76}}]},'B → F',req).nodes[0].options
  assert.deepEqual([clear.xPos,clear.yPos],[b.xPos+b.width+96,b.yPos])
})
test('a stored note of any height is passed in one move, on the same rows as a short one',()=>{
  const base=nativeSlateFromBrief('A → B')
  const b=base.nodes[1].options, x=b.xPos+b.width+96
  const beside=height=>{
    const board={nodes:[...base.nodes,{options:{id:'wall',text:'',xPos:x,yPos:b.yPos,width:40,height}}]}
    const original=structuredClone(board), began=Date.now()
    const {options}=nativeCanvasDraft(board,'B → F',req).nodes[0]
    assert.ok(Date.now()-began<1000,'placing beside a note '+height+' high took '+(Date.now()-began)+'ms')
    assert.deepEqual(board,original)
    assert.equal(options.xPos,x)
    return options
  }
  const row=beside(76).height+48
  assert.equal(beside(76).yPos,b.yPos+row)
  // 76 + 24 clear the short note inside one row. Each taller note needs the next whole row.
  assert.equal(beside(row-24).yPos,b.yPos+row)
  assert.equal(beside(row-23).yPos,b.yPos+2*row)
  assert.equal(beside(10*row).yPos,b.yPos+11*row)
  for(const height of [3e10,1e15]) {
    const y=beside(height).yPos
    assert.equal((y-b.yPos)%row,0)
    assert.ok(y>=b.yPos+height+24 && y<b.yPos+height+24+row)
  }
  assert.ok(beside(1e300).yPos>=1e300)
  // Sizes that are not numbers count as zero, as a missing size does.
  for(const height of [Infinity,'Infinity',-Infinity,NaN,'tall',null]) assert.equal(beside(height).yPos,b.yPos+row)
  // Two tall notes in the way are each passed once.
  const stacked={nodes:[...base.nodes,{options:{id:'one',text:'',xPos:x,yPos:b.yPos,width:40,height:1e9}},
    {options:{id:'two',text:'',xPos:x,yPos:b.yPos+1e9+24,width:40,height:1e9}}]}
  const under=nativeCanvasDraft(stacked,'B → F',req).nodes[0].options
  assert.equal((under.yPos-b.yPos)%row,0)
  assert.ok(under.yPos>=b.yPos+2e9+48 && under.yPos<b.yPos+2e9+48+row)
})
test('a request can connect two existing notes without drawing another note',()=>{
  const base=friday();const original=structuredClone(base)
  const draft=nativeCanvasDraft(base,'New checkout page → Ships Monday',req)
  assert.deepEqual(draft.nodes,[])
  assert.deepEqual(draft.labels,['New checkout page','Ships Monday'])
  assert.deepEqual(draft.links.map(l=>[l.parentId,l.association.parentId,l.association.childId]),[['checkout','checkout','monday']])
  const kept=keep(base.nodes,draft)
  assert.equal(kept.length,7)
  assert.deepEqual(note({nodes:kept},'checkout').relationships.associations.map(a=>a.childId),['friday','monday'])
  assert.equal(kept.flatMap(n=>n.relationships.associations).length,8)
  // The return direction of an existing arrow is a new connection.
  assert.deepEqual(nativeCanvasDraft(base,'Ships Friday → New checkout page',req).links.map(l=>[l.parentId,l.association.childId]),[['friday','checkout']])
  // One request names the same pair twice.
  const twice=nativeCanvasDraft(base,'Ships Friday → Ships  Monday\nships friday → Ships Monday → Ships Friday',req)
  assert.deepEqual(twice.links.map(l=>[l.parentId,l.association.childId]),[['friday','monday'],['monday','friday']])
  assert.deepEqual(twice.labels,['Ships Friday','Ships Monday'])
  assert.deepEqual(base,original)
})
test('a request that draws nothing new is refused',()=>{
  const base=friday();const original=structuredClone(base)
  const connected=/^Everything in that request is already on this slate\. Name a new step or a new connection\.$/
  assert.throws(()=>nativeCanvasDraft(base,'New checkout page → Ships Friday',req),{message:connected})
  assert.throws(()=>nativeCanvasDraft(base,'NEW CHECKOUT PAGE -> ships friday\nSecond engineer reads it first → Ships Monday',req),{message:connected})
  assert.throws(()=>nativeCanvasDraft(base,'Ships Monday',req),{message:connected})
  // Two spellings of one existing note are one note, not an arrow to itself.
  assert.throws(()=>nativeCanvasDraft(base,'Ships  Monday → ships monday',req),{message:connected})
  assert.deepEqual(base,original)
})
test('the first note with a name is the one extended, and unnamed notes are never matched',()=>{
  const base={nodes:[
    {options:{id:'blank',text:'  ',xPos:0,yPos:0,width:100,height:60},relationships:{associations:[]}},
    {options:{id:'bare',xPos:0,yPos:200,width:100,height:60}},
    {options:{id:'first',text:'Review',xPos:0,yPos:400,width:100,height:60}},
    {options:{id:'second',text:'review',xPos:0,yPos:600,width:100,height:60},relationships:{associations:[]}},
  ]}
  const original=structuredClone(base)
  const draft=nativeCanvasDraft(base,'REVIEW → Publish',req)
  assert.deepEqual(draft.links.map(l=>l.parentId),['first'])
  assert.deepEqual([draft.nodes[0].options.xPos,draft.nodes[0].options.yPos],[196,400])
  const kept=keep(base.nodes,draft)
  const {id,parentId,childId,lineType,lineColor,lineWidth,showChildArrow}=kept[2].relationships.associations[0]
  assert.equal(kept[2].relationships.associations.length,1)
  assert.deepEqual({id,parentId,childId,lineType,lineColor,lineWidth,showChildArrow},draft.links[0].association)
  // Restated: the other notes keep their options (the engine gives a note without arrows an empty list).
  assert.deepEqual([kept[0],kept[1],kept[3]].map(n=>n.options),[base.nodes[0],base.nodes[1],base.nodes[3]].map(n=>n.options))
  assert.deepEqual(base,original)
})
// Restated for exec: Keep now saves the draft as one plan through slates.applyOperations, so
// "keeping appends its notes" and "a link whose parent has gone is refused" are asserted on
// that save path in scripts/canvas-conversation-exec.test.mjs. The provider-graph drawing is
// gone: a drawing request with a model writes an exec program instead.
test('a draft names its new notes and its links to existing notes, and changes neither the board nor itself',()=>{
  const base=nativeSlateFromBrief('A → B');const original=structuredClone(base)
  const plain=nativeCanvasDraft(base,'Inspect → Approve',req)
  assert.deepEqual(plain.links,[])
  assert.deepEqual(plain.labels,['Inspect','Approve'])
  assert.deepEqual(plain.nodes.map(n=>n.options.text),['Inspect','Approve'])
  const linked=nativeCanvasDraft(base,'B → Inspect',req)
  const frozen=structuredClone(linked)
  const b=base.nodes.find(n=>n.options.text==='B').options.id
  assert.deepEqual(linked.links.map(l=>[l.parentId,l.association.childId]),[[b,linked.nodes[0].options.id]])
  assert.deepEqual(linked,frozen)
  assert.deepEqual(base,original)
})

test('a request for ordinary notes is drawn as it stands, with no drafting: a number of notes, or notes by name', async () => {
  const { noteRequest } = await import('../web/app/imports/api/common/note-requests.mjs')
  assert.deepEqual(noteRequest('can you add a couple more regular notes'), { labels: ['New note', 'New note'] })
  assert.deepEqual(noteRequest('Add two notes'), { labels: ['New note', 'New note'] })
  assert.deepEqual(noteRequest('please add a note'), { labels: ['New note'] })
  assert.deepEqual(noteRequest('Add a note called Call the printer'), { labels: ['Call the printer'] })
  assert.deepEqual(noteRequest('add notes: Budget, Venue and Catering'), { labels: ['Budget', 'Venue', 'Catering'] })
  assert.deepEqual(noteRequest('Add 3 sticky notes to the canvas.'), { labels: ['New note', 'New note', 'New note'] })
  // Notes about something have to be thought up, and a card is a card.
  for (const message of ['add notes about our onboarding risks', 'Add a card called New idea', 'Move this to Now', 'Intake → Review', 'add twenty notes'])
    assert.equal(noteRequest(message), null, message)
})

test('only a request that has to be thought up needs drafting; typed steps and pasted lines never do', async () => {
  const { needsDrafting } = await import('../web/app/imports/api/common/native-canvas-conversation.mjs')
  for (const message of ['add notes about our onboarding risks', 'Which lane has the most left?', 'Can you summarise this board', 'Brainstorm ten names for the launch'])
    assert.equal(needsDrafting(message), true, message)
  for (const message of ['Intake → Review → Reply', 'Intake -> Review', 'Plan\nBuild\nShip', 'Draw a flow from Intake to Review', 'Review notes', 'add two notes', 'Intake then Review'])
    assert.equal(needsDrafting(message), false, message)
})

test('notes asked for by number or name are drawn in a row below the drawing and its workshop, never over a lane', async () => {
  const { workshopOrigin } = await import('../web/app/imports/api/common/workshop-look.mjs')
  const { workshopLanePlaces } = await import('slateboxjs/workshops/model')
  const welcome = { options: { id: 'w', text: 'Welcome!', xPos: 40, yPos: 40, width: 140, height: 60 }, relationships: { associations: [] } }
  const workshop = { version: 1, title: 'Plan', lanes: [{ id: 'now', label: 'Now' }, { id: 'next', label: 'Next' }, { id: 'later', label: 'Later' }], cards: [{ id: 'idea', label: 'New idea', laneId: 'now' }] }
  const board = { options: {}, nodes: [welcome], nativeCanvasDrawing: true, creative: { revision: 3, model: { kind: 'workshop', version: 1, workshop } } }
  const draft = nativeCanvasDraft(board, 'can you add a couple more regular notes', req)
  assert.equal(draft.mode, 'draw')
  assert.deepEqual(draft.labels, ['New note', 'New note'])
  assert.deepEqual(draft.nodes.map(n => n.options.text), ['New note', 'New note'])
  assert.ok(draft.nodes.every(n => n.options.id.startsWith('chat-' + req + '-')))
  const origin = workshopOrigin(board.options, board.nodes), { height } = workshopLanePlaces(workshop)
  for (const node of draft.nodes) assert.ok(node.options.yPos >= origin.y + height, 'below the workshop')
  assert.ok(draft.nodes[1].options.xPos > draft.nodes[0].options.xPos + draft.nodes[0].options.width, 'side by side')
  // The workshop's place is recorded with them, so it does not move beside the new notes.
  assert.deepEqual(draft.workshopOrigin, origin)
  assert.equal(nativeCanvasDraft({ ...board, options: { workshopOrigin: origin } }, 'add two notes', req).workshopOrigin, undefined)
  // Typed steps on a workshop slate start past the workshop's right edge, not over its lanes.
  const steps = nativeCanvasDraft(board, 'Plan → Build', req)
  assert.ok(steps.nodes[0].options.xPos >= origin.x + workshopLanePlaces(workshop).width)
})

// cards-fix (2026-11-19)
test('a request for too many notes, or notes with markup, is answered with what to change, never with a plan', async () => {
  const { noteRequestProblem } = await import('../web/app/imports/api/common/note-requests.mjs')
  const { needsDrafting } = await import('../web/app/imports/api/common/native-canvas-conversation.mjs')
  assert.equal(noteRequestProblem('add 13 notes'), 'I can add up to 12 notes at a time.')
  assert.equal(noteRequestProblem('add twenty notes'), 'I can add up to 12 notes at a time.')
  assert.equal(noteRequestProblem('add notes: <b>x</b>, y'), 'A note holds plain words: leave out < and >.')
  assert.equal(noteRequestProblem('add two notes'), null)
  assert.equal(noteRequestProblem('add notes about our onboarding risks'), null)
  for (const message of ['add 13 notes', 'add notes: <b>x</b>, y']) assert.equal(needsDrafting(message), false, message)
})

test('a request that needs drafting is answered truthfully for the account and the install', async () => {
  const { draftingRefusal } = await import('../web/app/imports/api/common/native-canvas-conversation.mjs')
  // Slatebox Cloud has no plans: a guest is asked to sign in, anyone else hears the meter's reason.
  assert.deepEqual(draftingRefusal({ selfHosted: false, guest: true }), { error: 'sign-in', reason: 'Sign in to use AI.' })
  const used = { code: 'ai-today', message: "You have used today's free AI. Add your own key or top up in your profile." }
  assert.deepEqual(draftingRefusal({ selfHosted: false, meter: used }), { error: 'ai-today', reason: used.message })
  for (const refusal of [draftingRefusal({ selfHosted: false }), draftingRefusal({ selfHosted: false, guest: true }), draftingRefusal({ selfHosted: false, meter: used })]) {
    assert.doesNotMatch(refusal.reason, /\bPro\b|\bTeam\b|plan/i)
  }
  assert.equal(draftingRefusal({ selfHosted: true, aiOn: false }).error, 'drafting-off')
  assert.match(draftingRefusal({ selfHosted: true, aiOn: false }).reason, /administrator/)
  // A guest on an install that has AI is not told the install has none.
  const guest = draftingRefusal({ selfHosted: true, aiOn: true, guest: true })
  assert.equal(guest.error, 'drafting-off')
  assert.equal(guest.reason, 'Drafting from a request is for signed-in members of this install. Sign in to use it.')
})

// aicontrol fixes (2026-11-24): with no AI to draft it, a board described in the builder or Ask Slatebox
// is answered with the real refusal (the meter's reason, AI off, not set up), never drawn as a note holding it.
test('a described board with no AI is refused with the real reason, never drawn as a note of the prompt', async () => {
  const { drawsRequestAsNote, needsDrafting } = await import('../web/app/imports/api/common/native-canvas-conversation.mjs')
  for (const message of ['A board where ideas go in piles of five', 'Ideas go in piles; each pile holds up to five.',
    'Stand-up board with Yesterday, Today and Blocked columns', 'a kanban for the support team where urgent tickets jump the queue']) {
    assert.equal(needsDrafting(message), false, message)
    assert.equal(drawsRequestAsNote(message), true, message)
    // Without the gate the direct path draws exactly that: one note holding the whole request.
    assert.deepEqual(nativeCanvasDraft({ nodes: [] }, message, req).labels, [message])
  }
  // Typed steps, pasted lines, a short label and notes asked for by name are still drawn as they stand.
  for (const message of ['Intake → Review → Reply', 'Intake -> Review', 'Plan\nBuild\nShip', 'Research then design then build', 'Review notes',
    'Customer onboarding', 'add two notes', 'Add a note called Call the printer about the venue', 'add 13 notes'])
    assert.equal(drawsRequestAsNote(message), false, message)
  // The method asks before drawing anything: the refusal (meter, AI off, not set up) comes first.
  const method = readFileSync(new URL('../web/app/server/methods/canvas-conversation.js', import.meta.url), 'utf8')
  const gate = method.indexOf('if (!canGenerate && !lines && (needsDrafting(message) || drawsRequestAsNote(message))) {')
  assert.ok(gate > 0, 'the no-AI gate covers a described board')
  assert.ok(gate < method.indexOf('conversation.preview({'), 'refused before the direct path draws')
  assert.match(method.slice(gate, gate + 600), /throw new Meteor\.Error\(\.\.\.refusalErrorArgs\(refusal\)\)/)
})
