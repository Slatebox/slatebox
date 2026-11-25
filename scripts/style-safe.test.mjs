// A style never loses anything, and "Revert to original" is always there (owner, 2026-11-25: "changing it removes a
// bunch of nodes as well - so...this is dangerous because it deletes nodes...we should revamp this so the style can
// be applied but there is no data loss, and there should always be a revert to original option").
//
// Proved over the pure code every surface shares (presentationBake: Present's style picker, Slate settings → Slate
// style, the agent's style_presentation, the library seed and the migration): all 8 styles, worn, switched and
// removed, on the six library presentations as a person's copy holds them and on a plain slate of a person's own.
// Content is every note a style may not take away: anything but its own untouched, wordless, unlinked decoration.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  hasStyleOriginal, isStyleArt, keepOriginal, ownNotesOf, replaceableArt, revertToOriginal, sealOf, setSlateBackground,
  takeOffStyle, wearStyle, wordsOf, wornStyle,
} from '../web/app/imports/ui/components/presentations/presentationBake.mjs'
import { STYLES, STYLE_IDS } from '../web/app/imports/ui/components/presentations/presentationStyles.mjs'
import { playerSlateCopy, wearDeckOnSlate, wornSlateSet } from '../web/app/server/methods/presentationDeck.mjs'
import { showcaseContent } from '../web/app/server/library/showcase.mjs'
import { showcasePresentations } from '../web/app/server/library/showcase/presentations.mjs'
import { slateOfLayout, whatIsSlatebox } from './presentation-fixtures.mjs'

const clone = (value) => JSON.parse(JSON.stringify(value))
// What a person's copy of a library presentation holds ("Make it yours" copies the library's slate as it is).
const libraryCopy = (entry) => clone(showcaseContent(entry).slate)
// A plain slate of a person's own: the mind map, one more note with a line to it, and a note of their own words.
function ownSlate() {
  const slate = slateOfLayout(whatIsSlatebox(), 'What is Slatebox')
  const root = slate.nodes[0]
  slate.nodes.push({ options: { id: 'mine', text: 'My own note', xPos: -600, yPos: -400, width: 200, height: 90, backgroundColor: '#ffffff' }, relationships: { associations: [] } })
  root.relationships.associations.push({ parentId: root.options.id, childId: 'mine', lineColor: '#333333' })
  return slate
}
const content = (doc) => {
  const gone = replaceableArt(doc)
  return new Map(doc.nodes.filter((node) => !gone.has(String(node.options.id))).map((node) => [String(node.options.id), wordsOf(node.options.text)]))
}
const words = (doc) => doc.nodes.map((node) => wordsOf(node.options.text)).filter(Boolean).sort()
// Every content note before is a note after, with the same words; every word before is a word after.
function nothingLost(before, after, label) {
  const was = content(before)
  const now = new Map(after.nodes.map((node) => [String(node.options.id), wordsOf(node.options.text)]))
  for (const [id, said] of was) {
    assert.ok(now.has(id), `${label}: note ${id} kept`)
    assert.equal(now.get(id), said, `${label}: note ${id} keeps its words`)
  }
  const left = [...words(after)]
  for (const said of words(before)) {
    const at = left.indexOf(said)
    assert.ok(at >= 0, `${label}: "${said}" kept`)
    left.splice(at, 1)
  }
  // Lines between content notes stay.
  const lines = (doc) => new Set(doc.nodes.flatMap((node) => (node.relationships?.associations || []).map((a) => `${a.parentId}->${a.childId}`)))
  const afterLines = lines(after)
  for (const line of lines(before)) {
    const [from, to] = line.split('->')
    if (was.has(from) && was.has(to)) assert.ok(afterLines.has(line), `${label}: line ${line} kept`)
  }
}
const same = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)))
const slates = () => [...showcasePresentations.map((entry) => ({ label: entry.slug, slate: libraryCopy(entry), entry })), { label: 'own slate', slate: ownSlate(), entry: null }]

test('Slate settings (no presentation): every style, worn, switched and removed, keeps every note and word, exactly', () => {
  for (const { label, slate } of slates()) {
    for (const id of STYLE_IDS) {
      const next = STYLE_IDS[(STYLE_IDS.indexOf(id) + 3) % STYLE_IDS.length]
      const worn = wearStyle(slate, { id }, { ambient: true }).slate
      nothingLost(slate, worn, `${label} → ${id}`)
      // From Slate settings no words are invented: the words on the slate are exactly the words it had.
      assert.deepEqual(words(worn), words(slate), `${label} → ${id}: the same words`)
      assert.deepEqual([...content(worn).keys()].sort(), [...content(slate).keys()].sort(), `${label} → ${id}: the same content notes`)
      const switched = wearStyle(worn, { id: next }, { ambient: true }).slate
      nothingLost(worn, switched, `${label} → ${id} → ${next}`)
      assert.deepEqual(words(switched), words(slate), `${label} → ${id} → ${next}: the same words`)
      assert.deepEqual([...content(switched).keys()].sort(), [...content(slate).keys()].sort(), `${label} → ${id} → ${next}: the same content notes`)
      const off = takeOffStyle(switched)
      nothingLost(switched, off, `${label} → ${id} → ${next} → removed`)
      assert.equal(wornStyle(off), null)
      assert.equal(off.nodes.filter(isStyleArt).length, 0, `${label}: removed, the slate holds no style art`)
      // Revert to original, from anywhere along the way, is the slate exactly as it was.
      for (const [where, doc] of [['worn', worn], ['switched', switched], ['removed', off]]) {
        same(revertToOriginal(doc).slate, slate)
        assert.equal(hasStyleOriginal(revertToOriginal(doc).slate), false, `${label} ${where}: the original is used up`)
      }
    }
  }
})

test('Present\'s style picker (a presentation\'s words): every style switch keeps every note and word, and reverts exactly', () => {
  for (const { label, slate, entry } of slates()) {
    const direction = entry?.look.direction || null
    let doc = slate
    for (const id of STYLE_IDS) {
      const next = wearStyle(doc, { id }, { direction: direction && { ...direction, style: { id } }, name: entry?.title || '' }).slate
      nothingLost(doc, next, `${label}: present → ${id}`)
      nothingLost(slate, next, `${label}: copy → … → ${id}`)
      doc = next
    }
    nothingLost(doc, takeOffStyle(doc), `${label}: present → removed`)
    same(revertToOriginal(doc).slate, slate)
  }
})

test('the agent and the migration (wearDeckOnSlate) keep every note and word, and keep the deck played before with the original', () => {
  for (const entry of showcasePresentations) {
    const copy = libraryCopy(entry)
    const row = showcaseContent(entry).deck
    const other = STYLE_IDS.find((id) => id !== entry.look.style)
    const worn = wearDeckOnSlate(copy, row, { id: other })
    nothingLost(copy, worn.slate, `${entry.slug}: agent → ${other}`)
    const set = wornSlateSet(worn.slate)
    assert.ok(set['options.styleOriginal'], `${entry.slug}: the save writes the original`)
    const back = revertToOriginal(worn.slate)
    same(back.slate, copy)
    assert.deepEqual(back.presentation.deck, row.deck, `${entry.slug}: the deck played before comes back with it`)
    assert.deepEqual(back.presentation.style, row.style)
  }
})

test('words a person wrote into a style\'s art survive every switch, and stay after Revert to original', () => {
  const entry = showcasePresentations.find((item) => item.slug === 'trial-research')
  const copy = libraryCopy(entry)
  const title = copy.nodes.find((node) => node.options.styleRole === 'title')
  title.options.text = 'MY EDITED HEADLINE 123'
  for (const [how, opts] of [['settings', { ambient: true }], ['present', { direction: entry.look.direction, name: entry.title }]]) {
    let doc = copy
    for (const id of ['neon', 'voyage', 'calm', 'stage']) {
      doc = wearStyle(doc, { id }, opts).slate
      assert.equal(doc.nodes.filter((node) => wordsOf(node.options.text) === 'MY EDITED HEADLINE 123').length, 1, `${how} → ${id}: the edit is kept once`)
      assert.ok(doc.nodes.some((node) => node.options.id === title.options.id), `${how} → ${id}: on the same note`)
    }
    // Every quote and attribution of the copy is still there (the owner's probe lost these).
    for (const said of ['Why do trials stall?', 'Where do I add my team?', 'I gave up at the import.']) {
      if (words(copy).includes(said)) assert.ok(words(doc).includes(said), `${how}: "${said}" kept`)
    }
    const back = revertToOriginal(doc).slate
    // The original is the copy as it was made; the person's edit is newer and kept on the same note.
    assert.equal(back.nodes.find((node) => node.options.id === title.options.id).options.text, 'MY EDITED HEADLINE 123')
  }
})

test('a copy of a style\'s art, art somebody changed, and art with a line are a person\'s own: never taken away', () => {
  const plain = ownSlate()
  const worn = wearStyle(plain, { id: 'voyage' }).slate
  const decor = worn.nodes.filter((node) => isStyleArt(node) && !wordsOf(node.options.text))
  assert.ok(decor.length >= 3, 'voyage brings decoration')
  // A copy (another id, the same role and look), a recolored picture, and a line drawn to a star.
  const copy = clone(decor[0])
  copy.options.id = 'copy-of-star'
  copy.options.xPos += 40
  worn.nodes.push(copy)
  const changed = worn.nodes.find((node) => node.options.id === decor[1].options.id)
  changed.options.vectorPath = 'M0 0L100 0L100 100Z'
  const linked = decor[2]
  worn.nodes.find((node) => node.options.id === 'mine').relationships.associations.push({ parentId: 'mine', childId: linked.options.id })
  const gone = replaceableArt(worn)
  for (const id of ['copy-of-star', decor[1].options.id, linked.options.id]) assert.ok(!gone.has(id), `${id} is content`)
  for (const id of STYLE_IDS) {
    const after = wearStyle(worn, { id }).slate
    nothingLost(worn, after, `voyage → ${id}`)
    for (const keep of ['copy-of-star', decor[1].options.id, linked.options.id]) assert.ok(after.nodes.some((node) => node.options.id === keep), `voyage → ${id}: ${keep} kept`)
    assert.ok(after.nodes.find((node) => node.options.id === 'mine').relationships.associations.some((a) => a.childId === linked.options.id), `voyage → ${id}: the line kept`)
  }
  // Removed or reverted, they stay too (as plain notes: no longer the style's).
  const off = takeOffStyle(worn)
  for (const keep of ['copy-of-star', decor[1].options.id, linked.options.id]) assert.ok(off.nodes.some((node) => node.options.id === keep && !isStyleArt(node)))
  const back = revertToOriginal(worn).slate
  for (const keep of ['copy-of-star', decor[1].options.id, linked.options.id]) assert.ok(back.nodes.some((node) => node.options.id === keep && !isStyleArt(node)), `reverted: ${keep} kept`)
  assert.ok(back.nodes.find((node) => node.options.id === 'mine').relationships.associations.some((a) => a.childId === linked.options.id), 'reverted: the line drawn since kept')
  for (const node of plain.nodes) same(back.nodes.find((other) => other.options.id === node.options.id).options, node.options)
})

test('a note\'s own picture is never taken by a style, and the art\'s seal says what the style made', () => {
  const plain = ownSlate()
  plain.nodes[0].options.image = 'https://example.com/team.png'
  plain.nodes[1].options.backgroundImage = 'https://example.com/paper.png'
  for (const id of STYLE_IDS) {
    let doc = wearStyle(plain, { id }).slate
    doc = wearStyle(doc, { id: STYLE_IDS[(STYLE_IDS.indexOf(id) + 1) % STYLE_IDS.length] }, { ambient: true }).slate
    assert.equal(doc.nodes.find((node) => node.options.id === plain.nodes[0].options.id).options.image, 'https://example.com/team.png', id)
    assert.equal(doc.nodes.find((node) => node.options.id === plain.nodes[1].options.id).options.backgroundImage, 'https://example.com/paper.png', id)
    for (const node of doc.nodes.filter(isStyleArt)) assert.equal(node.options.styleSeal, sealOf(node.options), `${id}: ${node.options.id} sealed`)
  }
})

test('the original is kept once, survives saving and reloading, and Revert keeps everything made since', () => {
  const plain = ownSlate()
  const first = wearStyle(plain, { id: 'neon' }).slate
  assert.ok(hasStyleOriginal(first))
  same(first.options.styleOriginal.nodes, plain.nodes)
  // A second style never replaces the original.
  const second = wearStyle(first, { id: 'calm' }, { ambient: true }).slate
  same(second.options.styleOriginal, first.options.styleOriginal)
  // Saved and loaded (as text), it is the same original.
  const reloaded = JSON.parse(JSON.stringify(second))
  same(revertToOriginal(reloaded).slate, plain)
  // A note added and a note's words changed after the style: both kept by Revert to original.
  reloaded.nodes.push({ options: { id: 'later', text: 'Added after the style', xPos: 0, yPos: 900, width: 200, height: 80 }, relationships: { associations: [] } })
  reloaded.nodes.find((node) => node.options.id === 'mine').options.text = 'My own note, changed later'
  const back = revertToOriginal(reloaded).slate
  assert.equal(back.nodes.find((node) => node.options.id === 'later').options.text, 'Added after the style')
  assert.equal(back.nodes.find((node) => node.options.id === 'mine').options.text, 'My own note, changed later')
  assert.equal(back.nodes.filter(isStyleArt).length, 0)
  assert.equal(wornStyle(back), null)
  assert.throws(() => revertToOriginal(plain), /no original/)
})

test('the background set by hand is part of the style: wearing it again keeps it, and Revert to original takes it back', () => {
  const plain = ownSlate()
  plain.options.containerStyle = { backgroundColor: '#fafafa' }
  const worn = wearStyle(plain, { id: 'neon' }, { ambient: true }).slate
  const painted = setSlateBackground(worn, '#123456')
  assert.equal(painted.options.containerStyle.backgroundColor, '#123456')
  assert.deepEqual(wornStyle(painted), { id: 'neon', overrides: { bg: '#123456' }, v: 4 })
  // The same style again (a picture swapped, the same chip) keeps the hand-set background; another style brings its own.
  assert.equal(wearStyle(painted, { id: 'neon' }, { ambient: true }).slate.options.containerStyle.backgroundColor, '#123456')
  assert.equal(wearStyle(painted, { id: 'calm' }, { ambient: true }).slate.options.containerStyle.backgroundColor, STYLES.calm.bg)
  same(revertToOriginal(painted).slate, plain)
  // On a slate that wears no style, a background change still keeps the original, so Revert brings it back.
  const unstyled = setSlateBackground(plain, '#ABCDEF')
  assert.equal(unstyled.options.containerStyle.backgroundColor, '#abcdef')
  assert.equal(wornStyle(unstyled), null)
  same(revertToOriginal(unstyled).slate, plain)
  assert.throws(() => setSlateBackground(plain, 'red'), /like #/)
})

test('a library copy\'s original is the slate as copied; the original is never published', () => {
  for (const entry of showcasePresentations) {
    const content = showcaseContent(entry)
    assert.equal(hasStyleOriginal(content.slate), false, `${entry.slug}: the library's slate keeps no original of its own`)
    const worn = wearStyle(content.slate, { id: 'calm' }, { ambient: true }).slate
    same(worn.options.styleOriginal.nodes, content.slate.nodes)
    assert.doesNotMatch(playerSlateCopy(worn), /styleOriginal|styleSeal/, `${entry.slug}: the published copy holds no original`)
  }
  // keepOriginal leaves an original that is there alone.
  const doc = keepOriginal(clone(ownSlate()))
  const kept = clone(doc.options.styleOriginal)
  doc.nodes.pop()
  keepOriginal(doc)
  same(doc.options.styleOriginal, kept)
  // The slate's own notes (what a deck is planned from) never include a style's art.
  assert.equal(ownNotesOf(wearStyle(ownSlate(), { id: 'neon' }).slate).filter(isStyleArt).length, 0)
})

const ui = (path) => readFileSync(new URL(`../web/app/imports/ui/${path}`, import.meta.url), 'utf8')

test('both style pickers offer Revert to original (enabled while the slate keeps one); nobody is told Undo takes it off', () => {
  const panel = ui('components/slate/SlateStyle.jsx')
  assert.match(panel, /data-slate-style-revert/)
  assert.match(panel, /disabled=\{busy \|\| !original\}/)
  assert.match(panel, /revertToOriginal\(json\)\.slate, 'style-revert'/)
  assert.match(panel, />\s*Revert to original\s*</)
  assert.match(panel, />\s*Remove style\s*</)
  assert.doesNotMatch(panel, /Take off style/)
  const sheet = ui('components/presentations/StyleSheet.jsx')
  assert.match(sheet, /label="Revert to original"/)
  assert.match(sheet, /disabled=\{busy \|\| !canRevert\}/)
  assert.doesNotMatch(sheet, /Undo takes it off/)
  const present = ui('components/PresentSlate.jsx')
  assert.match(present, /onRevert=\{handleStyleRevert\}/)
  assert.match(present, /canRevert=\{Boolean\(styleAnchorEl\) && hasStyleOriginal\(slateCopy\(slate\)\)\}/)
  assert.match(present, /presentations\.update, \{ presentationId, revert: \{ deck, direction, style \} \}/)
  assert.doesNotMatch(present, /takeOffStyle/)
})

test('a cog beside the slate name opens the same slate menu as the name, on a phone too', () => {
  const header = ui('components/CanvasToolbar.jsx')
  assert.match(header, /aria-label="Slate settings and actions"/)
  assert.match(header, /onClick=\{\(\) => setSlateMenu\(titleButton\.current\)\}/)
  // The cog is drawn whatever the width (only renaming hides it), inside the name's box.
  const name = header.slice(header.indexOf('<div className="sb-board-name">'), header.indexOf('<div ref={setBuilderSlot}'))
  assert.match(name, /\{!renaming && <Tooltip title="Slate settings and actions">/)
  assert.match(ui('common/main.css'), /\.sb-board-cog-wrap\{display:inline-flex;flex:none/)
})
