// Canonical Mermaid (the text a repository keeps): sorted by id and never by place, note ids as
// names, a fixed direction, frames as subgraphs, a header naming the slate, its revision and the
// body's hash, and notes about the diagram (a recipe's legend) left out when asked.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { canonicalBody, canonicalGraph, hexToBase32, parseMermaid, sha1Hex, slateToMermaid } from '../web/app/imports/api/common/mermaid/index.mjs'

const note = (id, text, x, y, extra = {}) => ({ options: { id, text, xPos: x, yPos: y, width: 160, height: 80, vectorPath: 'rectangle', ...extra }, relationships: { associations: [] } })
const line = (from, to, extra = {}) => ({ id: `${from}->${to}`, parentId: from, childId: to, ...extra })

function slate(order = ['b', 'a', 'c']) {
  const notes = {
    a: note('a', 'Alpha', 0, 0),
    b: { ...note('b', 'Beta', 300, 0), relationships: { associations: [line('b', 'a', { label: 'reads' }), line('b', 'c')] } },
    c: note('c', 'Gamma "q"', 600, 0, { vectorPath: 'ellipse' }),
  }
  return { shareId: 'S1', revision: 7, options: { name: 'Demo' }, nodes: order.map((id) => notes[id]) }
}

test('SHA-1 and base32 match the standard vectors (no node:crypto: the same on the client)', () => {
  assert.equal(sha1Hex('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d')
  assert.equal(sha1Hex('The quick brown fox jumps over the lazy dog'), '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12')
  for (const text of ['é ☃ 𝄞', 'a'.repeat(1000), '', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64)])
    assert.equal(sha1Hex(text), createHash('sha1').update(text, 'utf8').digest('hex'), JSON.stringify(text.slice(0, 8)))
  assert.equal(hexToBase32('ffffffffff'), '77777777')
})

test('the same diagram in any note order or position writes the same body', () => {
  const one = slateToMermaid(slate(), { canonical: true })
  const shuffled = slate(['c', 'a', 'b'])
  shuffled.nodes[0].options.xPos = -900
  const two = slateToMermaid(shuffled, { canonical: true })
  assert.equal(two.body, one.body)
  assert.equal(one.body, ['flowchart LR', '  a["Alpha"]', '  b["Beta"]', '  c(["Gamma #quot;q#quot;"])', '  b -->|"reads"| a', '  b --> c'].join('\n'))
  assert.equal(one.mermaid, `%% slatebox:S1 rev:7 hash:${one.hash}\n${one.body}\n`)
  assert.equal(slateToMermaid(slate(), { canonical: true, direction: 'TD' }).body.split('\n')[0], 'flowchart TD')
})

test('the canonical text reads back with the same names (note ids) and the same graph', () => {
  const out = slateToMermaid(slate(), { canonical: true })
  const read = parseMermaid(out.mermaid)
  assert.deepEqual(read.nodes.map((n) => [n.id, n.text]), [['a', 'Alpha'], ['b', 'Beta'], ['c', 'Gamma "q"']])
  assert.deepEqual(read.edges.map((e) => [e.from, e.to, e.text ?? '']), [['b', 'a', 'reads'], ['b', 'c', '']])
})

test('frames are subgraphs by id; excluded notes (a legend) are left out with their lines', () => {
  const s = slate()
  s.nodes.unshift(note('frame1', 'Repo', -20, -20, { width: 1000, height: 200 }))
  s.nodes.push(note('legend1', 'Synced from acme @ abc', 0, 500))
  s.nodes[1].relationships.associations.push(line('a', 'legend1'))
  // frames are drawn first (behind): put the frame before its members
  const body = canonicalBody(canonicalGraph(s, { exclude: ['legend1'] }))
  assert.match(body, /\n {2}subgraph frame1\["Repo"\]\n {4}a\["Alpha"\]\n {4}b\["Beta"\]\n {4}c\(\["Gamma #quot;q#quot;"\]\)\n {2}end\n/)
  assert.ok(!body.includes('legend1'))
  assert.notEqual(canonicalBody(canonicalGraph(s)), body, 'without exclude, the legend is a note like any other')
})
