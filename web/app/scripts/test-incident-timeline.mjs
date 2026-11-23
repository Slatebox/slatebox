import test from 'node:test'
import assert from 'node:assert/strict'
import { incidentTimeline, readIncidentFragment } from '../imports/api/common/incident-timeline.mjs'

const fragment = notes => '#' + new URLSearchParams({ notes: JSON.stringify(notes) })

test('opens all four native timeline notes and directed connections', () => {
  const slate = readIncidentFragment('')
  assert.deepEqual(slate.nodes.map(node => node.options.id), ['trace', 'retries', 'recovery', 'handoff'])
  assert.deepEqual(slate.nodes.flatMap(node => node.relationships.associations.map(a => [a.parentId, a.childId, a.showChildArrow])),
    [['trace', 'retries', true], ['retries', 'recovery', true], ['recovery', 'handoff', true]])
})

test('applies only the passed positions and text and keeps the original reusable', () => {
  const changed = readIncidentFragment(fragment({ retries: { x: -18, y: 73 }, handoff: { text: 'Ask who owns the retry budget.' } }))
  const expected = structuredClone(incidentTimeline)
  Object.assign(expected.nodes[1].options, { xPos: -18, yPos: 73 })
  expected.nodes[3].options.text = 'Ask who owns the retry budget.'
  assert.deepEqual(changed, expected)
  assert.equal(readIncidentFragment('').nodes[1].options.xPos, 290)
})

test('rejects invalid fields, unknown notes, oversized strings and coordinates', () => {
  const invalid = [null, [], {extra:{}}, {trace:{x:4097}}, {trace:{y:0.5}}, {trace:{text:'a'.repeat(241)}},
    {trace:{width:16}}, {trace:{text:'a\u0000b'}}, {trace:{relationships:[]}}]
  for (const notes of invalid) assert.throws(() => readIncidentFragment(fragment(notes)))
  assert.throws(() => readIncidentFragment('#notes=hi&notes=%7B%7D'))
})

test('outage handoff keeps both customer paths, native geometry and arrow styling after note edits', async () => {
  const { default: original } = await import('../imports/api/common/sign-in-outage.mjs')
  const { readNativeNotesFragment } = await import('../imports/api/common/native-notes-fragment.mjs')
  const changed = readNativeNotesFragment(original, fragment({ signin: { x: 321, y: 76 }, fallback: { text: 'Send the status link' } }))
  const note = (model, id) => model.nodes.find(n => n.options.id === id).options
  assert.deepEqual(changed.nodes.flatMap(n => n.relationships.associations.map(e => [e.parentId,e.childId,e.showChildArrow])), [
    ['newcomer','signin',true], ['signin','blocked',true], ['blocked','fallback',true], ['session','workspace',true]
  ])
  const expected = structuredClone(original)
  Object.assign(note(expected,'signin'), { xPos:321, yPos:76 })
  note(expected,'fallback').text = 'Send the status link'
  assert.deepEqual(changed, expected)
  assert.deepEqual(readNativeNotesFragment(original, ''), original)
  assert.throws(() => readNativeNotesFragment(original, fragment({ trace:{ x:1 } })))
})
