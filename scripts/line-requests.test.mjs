// Plain requests about lines in the canvas conversation (imports/api/common/line-requests.mjs):
// each becomes one canvas plan with the same operations an agent's exec program sends, and the
// plan does to the stored slate what the words say.
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPlanToJSON } from 'slateboxjs/operations'
import { lineRequest } from '../web/app/imports/api/common/line-requests.mjs'
import { describeWrites } from '../web/app/server/exec/conversation.mjs'

const note = (id, text, xPos, yPos) => ({ options: { id, text, xPos, yPos, width: 200, height: 100 }, relationships: { associations: [] } })
function board() {
  const nodes = [note('n1', 'sing', 100, 100), note('n2', 'asfd', 500, 100), note('n3', 'Gamma', 300, 400)]
  nodes[0].relationships.associations.push({ id: 'n1->n2', parentId: 'n1', childId: 'n2', lineType: 'orthogonal', showChildArrow: true, label: 'aha' })
  return { options: { name: 'Demo' }, nodes }
}
const run = (b, asked) => applyPlanToJSON(b, asked.plan).slate
const linesOf = (b) => b.nodes.flatMap((n) => n.relationships.associations.map((a) => ({ owner: n.options.id, ...a })))
const selected = { kind: 'line', id: 'n1->n2', label: 'aha' }

test('“connect asfd to gamma” draws a line between the two notes, by name in any case', () => {
  const asked = lineRequest(board(), 'connect asfd to gamma')
  assert.deepEqual(asked.plan.operations, [{ kind: 'connect_nodes', from: { ids: ['n2'] }, to: { ids: ['n3'] } }])
  assert.ok(linesOf(run(board(), asked)).some((l) => l.parentId === 'n2' && l.childId === 'n3'))
  assert.equal(lineRequest(board(), 'Draw a line from Gamma to sing').plan.operations[0].kind, 'connect_nodes')
})

test('“unpin the line ends” lets every end follow; “pin the ends” pins them where they are', () => {
  const pinned = run(board(), lineRequest(board(), 'pin the ends'))
  assert.deepEqual(linesOf(pinned)[0].sourceAnchor, { x: 1, y: 0.5 })
  assert.deepEqual(linesOf(pinned)[0].targetAnchor, { x: 0, y: 0.5 })
  const asked = lineRequest(pinned, 'Unpin the line ends.')
  assert.deepEqual(asked.plan.operations, [{ kind: 'update_connections', connectionIds: ['n1->n2'], changes: { ends: 'follow' } }])
  const free = linesOf(run(pinned, asked))[0]
  assert.equal(free.sourceAnchor, null)
  assert.equal(free.targetAnchor, null)
  assert.equal(lineRequest(board(), 'let the ends follow their notes').plan.operations[0].changes.ends, 'follow')
  assert.deepEqual(lineRequest(board(), 'pin the ends of the line between sing and asfd').plan.operations[0].connectionIds, ['n1->n2'])
})

test('“detach this line from asfd” leaves that end free just outside asfd; the line stays sing’s', () => {
  const asked = lineRequest(board(), 'detach this line from asfd', selected)
  const [op] = asked.plan.operations
  assert.equal(op.kind, 'update_connections')
  assert.deepEqual(op.changes, { toPoint: { x: 440, y: 150 } })
  const line = linesOf(run(board(), asked))[0]
  assert.equal(line.owner, 'n1')
  assert.deepEqual(line.targetPoint, { x: 440, y: 150 })
  assert.equal(line.label, 'aha')
})

test('detaching the line from the note it starts at hands it to the other note, drawn the same way', () => {
  // sing has one line, so “this line” needs no selection.
  const asked = lineRequest(board(), 'detach the line from sing')
  assert.deepEqual(asked.plan.operations[0].changes, { fromPoint: { x: 360, y: 150 } })
  const line = linesOf(run(board(), asked))[0]
  assert.equal(line.owner, 'n2')
  assert.equal(line.showParentArrow, true)
  assert.equal(line.showChildArrow, false)
})

test('“move this line to Gamma” moves the far end; a free end can be attached', () => {
  const moved = lineRequest(board(), 'move this line to Gamma', selected)
  assert.deepEqual(moved.plan.operations[0].changes, { toNote: 'n3' })
  assert.equal(linesOf(run(board(), moved))[0].childId, 'n3')
  const free = run(board(), lineRequest(board(), 'detach this line from asfd', selected))
  const attach = lineRequest(free, 'attach the free end to Gamma')
  assert.equal(linesOf(run(free, attach))[0].childId, 'n3')
})

test('says what to change when the request cannot be read one way, and leaves other requests alone', () => {
  const two = board()
  two.nodes[2].relationships.associations.push({ id: 'n3->n2', parentId: 'n3', childId: 'n2' })
  assert.match(lineRequest(two, 'detach this line from asfd').problem, /has 2 lines/)
  assert.match(lineRequest(board(), 'detach this line from Nowhere').problem, /no note that says “Nowhere”/)
  assert.equal(lineRequest(board(), 'add two notes'), null)
  assert.equal(lineRequest(board(), 'connect Review to Done'), null)
  assert.equal(lineRequest(board(), 'Review -> Done'), null)
})

test('the preview says how many lines a request changes', () => {
  const b = board()
  const asked = lineRequest(b, 'unpin the line ends')
  const { report } = applyPlanToJSON(b, asked.plan)
  const shown = describeWrites(b, [{ body: { report, operations: asked.plan.operations } }])
  assert.deepEqual(shown.labels, ['Changes 1 line'])
})

test('requests that are not about a line’s ends pass on to drafting, not refused (lines review M3)', () => {
  // Moving lines on the slate, not one end onto a note.
  assert.equal(lineRequest(board(), 'move the arrows to the left'), null)
  assert.equal(lineRequest(board(), 'move the line to the top', selected), null)
  // A link is a note's web link, not a line.
  assert.equal(lineRequest(board(), 'attach the link to Gamma'), null)
  assert.equal(lineRequest(board(), 'move the link to Gamma', selected), null)
  // “Lock” is for notes: locking is not pinning a line's ends.
  assert.equal(lineRequest(board(), 'lock the line'), null)
  assert.equal(lineRequest(board(), 'unlock the arrows'), null)
  // Still read: the same requests about a line's end, named plainly.
  assert.deepEqual(lineRequest(board(), 'move this line to Gamma', selected).plan.operations[0].changes, { toNote: 'n3' })
  assert.equal(lineRequest(board(), 'pin the line').plan.operations[0].changes.ends, 'pinned')
})

test('“pin the line” with several lines and none selected asks which, instead of pinning them all', () => {
  const two = board()
  two.nodes[2].relationships.associations.push({ id: 'n3->n2', parentId: 'n3', childId: 'n2' })
  assert.match(lineRequest(two, 'pin the line').problem, /Select the line/)
  assert.match(lineRequest(two, 'unpin this line').problem, /Select the line/)
  // Said of all of them, all of them.
  assert.deepEqual(lineRequest(two, 'pin all the lines').plan.operations[0].connectionIds, ['n1->n2', 'n3->n2'])
  assert.deepEqual(lineRequest(two, 'unpin the line ends').plan.operations[0].connectionIds, ['n1->n2', 'n3->n2'])
  assert.deepEqual(lineRequest(two, 'pin the line', { kind: 'line', id: 'n3->n2' }).plan.operations[0].connectionIds, ['n3->n2'])
})
