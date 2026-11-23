import { strict as assert } from 'node:assert'
import test from 'node:test'
import { nativeSlateFromBrief, readCreationBrief } from '../web/app/imports/api/common/native-diagram-brief.mjs'
import { nativeDrawingContext } from '../web/app/imports/api/common/native-graph-draft.mjs'
import callStatus from '../web/app/imports/api/common/call-status-slate.mjs'
import fridayLaunch from '../web/app/imports/api/common/friday-launch-slate.mjs'

function read(brief, extra = {}) {
  return readCreationBrief('#' + new URLSearchParams({ brief, ...extra }))
}

test('one create link defaults to drawing and recognizes an explicit request for play', () => {
  assert.equal(read('Draw a flow from Request to Review').play, false)
  assert.equal(read('Build an interactive map of our returns').play, true)
  assert.equal(read('How should returns work?', { play: '1' }).play, true)
  assert.throws(() => readCreationBrief('#brief=one&brief=two'))
  assert.throws(() => read('Question', { source: 'unrecognized' }))
  assert.throws(() => read('Question', { source: 'call-status', play: '1' }))
})

test('free diagrams reuse shared steps on several paths and preserve original brief', () => {
  const { brief } = read('Draw a flow from Request to Review to Approve\nReview -> Ask finance\nReview → Approve')
  const board = nativeSlateFromBrief(brief)
  assert.equal(board.options.creationBrief, brief)
  assert.equal(board.creative, undefined)
  assert.deepEqual(board.nodes.map(n => n.options.text), ['Request', 'Review', 'Approve', 'Ask finance'])
  assert.deepEqual(board.nodes[1].relationships.associations.map(edge => edge.childId), ['step-3', 'step-4'])
  assert.throws(() => nativeSlateFromBrief('Review → '))
})

test('source-backed diagram opens with the source nodes and edges, and can carry another path', () => {
  const original = nativeSlateFromBrief('What should support tell someone starting a new call during the outage?', 'call-status')
  assert.deepEqual(original.nodes, callStatus.nodes)
  assert.equal(original.nodes.flatMap(n => n.relationships.associations).length, 4)
  const custom = nativeSlateFromBrief('New session → Open support ticket', 'call-status')
  assert.equal(custom.options.briefSource, 'call-status')
  assert.equal(custom.nodes.length, 6)
  assert.equal(custom.nodes.find(n => n.options.id === 'new-session').relationships.associations.length, 2)
  assert.equal(callStatus.nodes.length, 5)
})

test('a source-backed instruction stays in the opening message and out of the drawing context', () => {
  const brief = 'Draw exactly seven notes. Copy the five short notes from the existing connected diagram with their exact labels and all their directed arrows. Add two independent notes named On-call owner and Incident log. Omit this request itself from the diagram.'
  const board = nativeSlateFromBrief(brief, 'call-status')
  assert.equal(board.options.creationBrief, brief)
  assert.equal(board.options.briefSource, 'call-status')
  assert.deepEqual(board.nodes, callStatus.nodes)
  const context = nativeDrawingContext(board, brief)
  assert.deepEqual(context.notes.map(note => note.text).sort(), callStatus.nodes.map(node => node.options.text).sort())
  assert.equal(context.connections.length, 4)
})

test('a named source accepts pasted evidence lines and a path through a source note', () => {
  const brief = 'Incident log\r\nOn-call owner\r\nNew session -> Offer a callback'
  const board = nativeSlateFromBrief(brief, 'call-status')
  assert.equal(board.options.creationBrief, brief)
  const added = board.nodes.slice(callStatus.nodes.length)
  assert.deepEqual(added.map(node => node.options.text), ['Incident log', 'On-call owner', 'Offer a callback'])
  assert.ok(board.nodes.find(node => node.options.id === 'new-session').relationships.associations.some(edge => edge.childId === added[2].options.id))
  assert.deepEqual(added.slice(0, 2).map(node => node.relationships.associations), [[], []])
})

test('the homepage session source opens its decided drawing and extends a named note', () => {
  const question = 'What can still ship on Friday?'
  assert.equal(read(question, { source: 'friday-launch' }).source, 'friday-launch')
  const original = nativeSlateFromBrief(question, 'friday-launch')
  assert.deepEqual(original.nodes, fridayLaunch.nodes)
  assert.deepEqual(original.nodes.map(node => node.options.id), ['promise', 'checkout', 'migration', 'friday', 'reader', 'monday', 'tell'])
  assert.equal(original.nodes.flatMap(node => node.relationships.associations).length, 7)
  assert.deepEqual(original.options, { ...fridayLaunch.options, creationBrief: question, briefSource: 'friday-launch' })

  const row = 'Ships Monday → Email the pilot customers'
  const extended = nativeSlateFromBrief(row, 'friday-launch')
  assert.equal(extended.options.creationBrief, row)
  assert.equal(extended.options.briefSource, 'friday-launch')
  assert.deepEqual(extended.nodes.slice(0, 7).map(node => node.options), fridayLaunch.nodes.map(node => node.options))
  assert.equal(extended.nodes.length, 8)
  assert.equal(extended.nodes.filter(node => node.options.text === 'Ships Monday').length, 1)
  const added = extended.nodes[7]
  assert.equal(added.options.text, 'Email the pilot customers')
  assert.deepEqual(added.relationships.associations, [])
  assert.deepEqual(extended.nodes.find(node => node.options.id === 'monday').relationships.associations.map(edge => edge.childId),
    ['tell', added.options.id])
  assert.equal(extended.nodes.flatMap(node => node.relationships.associations).length, 8)
  assert.equal(fridayLaunch.nodes.length, 7)
  assert.equal(fridayLaunch.nodes.find(node => node.options.id === 'monday').relationships.associations.length, 1)
})

test('preserves pasted notes and rejects an incomplete or oversized brief', () => {
  assert.deepEqual(nativeSlateFromBrief('Support noticed timeouts\r\nCalls stayed connected').nodes.map(n => n.options.text),
    ['Support noticed timeouts', 'Calls stayed connected'])
  for (const value of ['', ' '.repeat(20), 'x'.repeat(1201), 'unsafe<tag>']) assert.throws(() => read(value))
})

test('collaboration and budget examples use the same Create slate URL', async () => {
  const { nativeSlateStarters } = await import('../web/app/imports/api/common/creativeSlates.mjs')
  const open = (brief, source) => nativeSlateStarters.get('diagram').readFragment('#' + new URLSearchParams({brief, source}))
  const investigation = open('Sign-in is down. Which customers still have access, and what should support tell everyone else?', 'sign-in-outage')
  assert.equal(investigation.nodes.length, 6)
  assert.equal(investigation.options.briefSource, 'sign-in-outage')
  const budget = open('Compare two launch experiments', 'pilot-budget')
  assert.equal(budget.creative.model.kind, 'workshop')
  assert.equal(budget.creative.revision, 0)
  assert.equal(budget.options.creationBrief, 'Compare two launch experiments')
  assert.ok(budget.creative.model.workshop.cards.length)
})

test('a brief row names a source note that wraps over two lines', () => {
  const board = nativeSlateFromBrief('second engineer reads it first → Pair on the review', 'friday-launch')
  assert.equal(board.nodes.length, 8)
  const reader = board.nodes.find(node => node.options.id === 'reader')
  assert.equal(reader.options.text, 'Second engineer\nreads it first')
  assert.deepEqual(reader.relationships.associations.map(edge => edge.childId), ['monday', board.nodes[7].options.id])
  assert.equal(board.nodes[7].options.text, 'Pair on the review')
})
