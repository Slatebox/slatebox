// A style never loses anything, and "Revert to original" is always there (owner, 2026-11-25: "changing it removes a
// bunch of nodes as well - so...this is dangerous because it deletes nodes...we should revamp this so the style can
// be applied but there is no data loss, and there should always be a revert to original option").
//
// Proved over the pure code every surface shares (presentationBake: Present's style picker, Slate settings → Slate
// style, the agent's style_presentation, the library seed and the migration): all 8 styles, worn, switched and
// removed, on the six library presentations as a person's copy holds them and on a plain slate of a person's own.
// Content is every note a style may not take away: anything but its own untouched, unlinked art that is
// either wordless or holds words a style wrote on this slate since its original (made again by the next style,
// so they never pile up). Words the slate came with (a library copy's quotes, numbers) and words anyone wrote are content.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  cameraDeck, hasStyleOriginal, isStyleArt, keepOriginal, ownNotesOf, playsWornStyle, replaceableArt, revertToOriginal, revertedPresentation,
  sealOf, setSlateBackground, takeOffStyle, wearStyle, wordsOf, wornStyle,
} from '../web/app/imports/ui/components/presentations/presentationBake.mjs'
import { darkText } from '../web/app/imports/ui/components/presentations/presentationStyles.mjs'
import { copyDocument, sourceOnlyOptions } from '../web/app/server/actions/slate-copy.mjs'
import { withoutStyleOriginal } from '../web/app/server/slate-read.mjs'
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
// The words that are content (a style's own words, made again by the next style, aside).
const words = (doc) => {
  const gone = replaceableArt(doc)
  return doc.nodes.filter((node) => !gone.has(String(node.options.id))).map((node) => wordsOf(node.options.text)).filter(Boolean).sort()
}
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
  // The panel's Revert puts the saved presentations' decks back too (as Present's does), with the same routine.
  assert.match(panel, /onClick=\{\(\) => act\(\(\) => revertSlateAndPresentations\(slate\)\)\}/)
  assert.match(panel, /replaceSlateAsOwnStep\(slate, back, 'style-revert'\)/)
  assert.match(panel, /if \(!playsWornStyle\(row\)\) continue\s+const revert = revertedPresentation\(back, presentation, row\.viewpoints\)\s+await call\(CONSTANTS\.methods\.presentations\.update, \{ presentationId: row\._id, revert \}\)/)
  assert.match(panel, />\s*Revert to original\s*</)
  assert.match(panel, />\s*Remove style\s*</)
  assert.doesNotMatch(panel, /Take off style/)
  const sheet = ui('components/presentations/StyleSheet.jsx')
  assert.match(sheet, /label="Revert to original"/)
  assert.match(sheet, /disabled=\{busy \|\| !canRevert\}/)
  assert.doesNotMatch(sheet, /Undo takes it off/)
  const present = ui('components/PresentSlate.jsx')
  assert.match(present, /onRevert=\{handleStyleRevert\}/)
  // Read once when the sheet opens (and after a change there), not on every render.
  assert.match(present, /canRevert=\{styleCanRevert\}/)
  assert.match(present, /setStyleCanRevert\(Boolean\(styleAnchorEl\) && hasStyleOriginal\(slateCopy\(slate\)\)\)\s+\}, \[styleAnchorEl, curPresentation\.slateJSON\]\)/)
  assert.match(present, /revertedPresentation\(back, presentation, row\?\.viewpoints, curPresentation\.viewpoints, look\?\.deck\?\.steps\)/)
  assert.match(present, /presentations\.update, \{ presentationId, revert: \{ deck, direction, style \} \}/)
  // The copy promises what Revert does.
  assert.doesNotMatch(panel, /exactly as it was|Nothing on your slate is lost/)
  assert.match(panel, /Revert to original brings back the notes, layout and background from before the first style\. Notes and words added since are kept\./)
  assert.doesNotMatch(sheet, /nothing on it is lost/)
  assert.doesNotMatch(present, /takeOffStyle/)
})

test('a cog beside the slate name opens the same slate menu as the name, on a phone too', () => {
  const header = ui('components/CanvasToolbar.jsx')
  assert.match(header, /aria-label="Slate settings and actions"/)
  // No chevron on the name (the cog is the way in), one icon for settings, one tab stop for one menu, and a
  // sheet (dialog) on a phone is announced as one.
  assert.doesNotMatch(header, /ExpandMore|Sliders|icons-material\/Tune/)
  assert.match(header, /label: 'Slate settings', icon: <SettingsOutlined \/>/)
  assert.match(header, /className="sb-board-cog" color="inherit" size="small" tabIndex=\{-1\}/)
  assert.equal((header.match(/aria-haspopup=\{narrow \? 'dialog' : 'menu'\}/g) || []).length, 2)
  assert.match(header, /onClick=\{\(\) => setSlateMenu\(titleButton\.current\)\}/)
  // The cog is drawn whatever the width (only renaming hides it), inside the name's box.
  const name = header.slice(header.indexOf('<div className="sb-board-name">'), header.indexOf('<div ref={setBuilderSlot}'))
  assert.match(name, /\{!renaming && <Tooltip title="Slate settings and actions">/)
  assert.match(ui('common/main.css'), /\.sb-board-cog-wrap\{display:inline-flex;flex:none/)
})

// ---- review findings (2026-11-25, second pass) ----------------------------------------------------------------------

test('Revert to original keeps a line drawn after the first style between two notes the original already had', () => {
  const s = slateOfLayout(whatIsSlatebox(), 'What is Slatebox')
  const had = new Set(s.nodes.flatMap((n) => n.relationships.associations.map((a) => `${a.parentId}->${a.childId}`)))
  assert.ok(!had.has('n0->l1') && !had.has('l1->n0'))
  const w = wearStyle(s, { id: 'voyage' }).slate
  for (const node of w.nodes) if (['n0', 'l1'].includes(node.options.id)) node.relationships.associations.push({ parentId: 'n0', childId: 'l1' })
  const back = revertToOriginal(w).slate
  for (const id of ['n0', 'l1']) assert.ok(back.nodes.find((n) => n.options.id === id).relationships.associations.some((a) => a.parentId === 'n0' && a.childId === 'l1'), `${id} keeps the new line`)
  // The original's own lines are there once each (a restyled line is the same line).
  const n0 = back.nodes.find((n) => n.options.id === 'n0')
  same(n0.relationships.associations.filter((a) => !(a.parentId === 'n0' && a.childId === 'l1')), s.nodes.find((n) => n.options.id === 'n0').relationships.associations)
})

test('a picture someone put on a style\'s image art survives every switch, on a plain slate and a library copy', () => {
  const MINE = 'https://example.com/mine.png'
  const w = wearStyle(slateOfLayout(whatIsSlatebox(), 'What is Slatebox'), { id: 'voyage' }).slate
  const art = w.nodes.find((n) => n.options.id === 'sb-stage-4-image')
  assert.ok(art?.options.image, 'voyage draws a picture there')
  art.options.image = MINE
  for (const id of STYLE_IDS.filter((x) => x !== 'voyage')) {
    for (const opts of [{}, { ambient: true }]) {
      const next = wearStyle(w, { id }, opts).slate
      assert.equal(next.nodes.filter((n) => n.options.image === MINE).length, 1, `voyage → ${id} ${opts.ambient ? '(settings)' : '(present)'}: the picture is kept once`)
      assert.ok(next.nodes.some((n) => n.options.id === 'sb-stage-4-image' && n.options.image === MINE), `voyage → ${id}: on the same note`)
    }
  }
  const entry = showcasePresentations.find((item) => item.slug === 'roadmap-bets')
  const copy = libraryCopy(entry)
  const pic = copy.nodes.find((n) => isStyleArt(n) && n.options.image)
  pic.options.image = MINE
  let doc = copy
  for (const id of ['editorial', 'neon', 'calm', 'stage']) {
    doc = wearDeckOnSlate(doc, showcaseContent(entry).deck, { id }).slate
    assert.ok(doc.nodes.some((n) => n.options.id === pic.options.id && n.options.image === MINE), `roadmap-bets → ${id}: the picture is kept`)
  }
})

test('wordless decoration someone recolored, resized, moved or unlocked is theirs: kept through every switch and removal', () => {
  for (const slug of ['launch-war-room', 'checkout-postmortem', 'roadmap-bets']) {
    const entry = showcasePresentations.find((item) => item.slug === slug)
    const copy = libraryCopy(entry)
    const decor = copy.nodes.filter((n) => n.options.styleRole === 'decor' && !wordsOf(n.options.text))
    assert.ok(decor.length >= 4, `${slug} has decoration`)
    decor[0].options.backgroundColor = '#ff00ff'
    decor[1].options.width = Number(decor[1].options.width) + 77
    decor[2].options.xPos = Number(decor[2].options.xPos) + 120
    decor[3].options.isLocked = false
    const mine = decor.slice(0, 4).map((n) => n.options.id)
    assert.ok(mine.every((id) => !replaceableArt(copy).has(id)), `${slug}: changed decoration is content`)
    let doc = copy
    for (const id of ['calm', 'stage', 'editorial', 'neon']) {
      doc = wearDeckOnSlate(doc, showcaseContent(entry).deck, { id }).slate
      for (const keep of mine) assert.ok(doc.nodes.some((n) => n.options.id === keep), `${slug} → ${id}: ${keep} kept`)
    }
    assert.equal(doc.nodes.find((n) => n.options.id === decor[0].options.id).options.backgroundColor, '#ff00ff')
    const off = takeOffStyle(doc)
    for (const keep of mine) assert.ok(off.nodes.some((n) => n.options.id === keep), `${slug} removed: ${keep} kept`)
  }
})

test('a style\'s own words do not pile up: switching settles, Remove style takes them off, the slate\'s words stay', () => {
  let doc = slateOfLayout(whatIsSlatebox(), 'What is Slatebox')
  const own = words(doc)
  const counts = []
  for (let pass = 0; pass < 3; pass += 1) {
    for (const id of STYLE_IDS) doc = wearStyle(doc, { id }).slate
    counts.push(doc.nodes.length)
  }
  assert.equal(new Set(counts).size, 1, `the same notes after each pass over the styles (${counts})`)
  // Every word the slate had is still there; words a style wrote are the style's (made again by each).
  for (const said of own) assert.ok(doc.nodes.some((n) => wordsOf(n.options.text) === said), `"${said}" kept`)
  const off = takeOffStyle(doc)
  assert.equal(off.nodes.length, slateOfLayout(whatIsSlatebox(), 'What is Slatebox').nodes.length, 'removed: only the slate\'s own notes')
  same(revertToOriginal(doc).slate, slateOfLayout(whatIsSlatebox(), 'What is Slatebox'))
  // A library copy's words (its quotes and numbers) are content: never taken, however often it is switched.
  for (const entry of showcasePresentations) {
    const copy = libraryCopy(entry)
    let cur = copy
    for (let pass = 0; pass < 2; pass += 1) for (const id of STYLE_IDS) cur = wearStyle(cur, { id }, { direction: entry.look.direction && { ...entry.look.direction, style: { id } }, name: entry.title }).slate
    const left = words(cur)
    for (const said of words(copy)) assert.ok(left.includes(said), `${entry.slug}: "${said}" kept`)
    same(revertToOriginal(cur).slate, copy)
  }
})

test('a background picked by hand never leaves words unreadable on it', () => {
  for (const id of STYLE_IDS) {
    for (const color of ['#ffffff', '#0b1030', '#fbf7ef']) {
      const worn = setSlateBackground(wearStyle(slateOfLayout(whatIsSlatebox(), 'What is Slatebox'), { id }).slate, color)
      const bad = worn.nodes.filter((n) => {
        const o = n.options
        const bare = !o.image && !o.backgroundImage && typeof o.backgroundColor === 'string' && /^(|transparent|none)$/i.test(o.backgroundColor.trim())
        const ink = o.fontColor ?? o.foregroundColor
        return wordsOf(o.text) && bare && /^#[0-9a-f]{6}$/i.test(ink || '') && darkText(ink) === darkText(color)
      })
      assert.deepEqual(bad.map((n) => n.options.id), [], `${id} on ${color}`)
      // Re-inked art is still the style's own (its next switch replaces it as before).
      for (const node of worn.nodes.filter(isStyleArt)) assert.equal(node.options.styleSeal, sealOf(node.options))
    }
  }
})

test('the original a slate keeps never leaves with a copy, a fork, an agent\'s read or a reader\'s load', () => {
  assert.ok(sourceOnlyOptions.includes('styleOriginal'))
  const worn = wearStyle(ownSlate(), { id: 'neon' }).slate
  const copy = copyDocument(worn, { id: 'x', shareId: 'y', user: { _id: 'u' }, now: 1, name: 'Copy' })
  assert.equal(copy.options.styleOriginal, undefined)
  assert.equal(withoutStyleOriginal(worn).options.styleOriginal, undefined)
  assert.ok(worn.options.styleOriginal, 'the stored slate keeps it')
  const loader = readFileSync(new URL('../web/app/server/methods/slates.js', import.meta.url), 'utf8')
  assert.match(loader, /if \(accessLevel !== 'EDIT' && slate\.options\) delete slate\.options\.styleOriginal/)
})

test('a saved presentation goes back with its slate: the deck kept with the original, else the camera over the steps played before', () => {
  const entry = showcasePresentations[0]
  const copy = libraryCopy(entry)
  const row = showcaseContent(entry).deck
  const worn = wearDeckOnSlate(copy, row, { id: STYLE_IDS.find((id) => id !== entry.look.style) })
  const { slate: back, presentation } = revertToOriginal(worn.slate)
  assert.ok(playsWornStyle({ deck: worn.deck }))
  same(revertedPresentation(back, presentation, worn.deck.steps).deck, row.deck)
  // No deck kept (styled from Slate settings first): the steps played before, then the row's, framed on the slate as it is.
  const plain = ownSlate()
  const styled = wearStyle(plain, { id: 'stage' }).slate
  const before = [{ nodeIds: ['n0', 'mine'], narrative: 'Start', duration: 3000 }]
  const r1 = revertedPresentation(revertToOriginal(styled).slate, { style: null, direction: null, deck: { steps: before } }, [{ nodeIds: ['sb-stage-2-title'] }])
  assert.deepEqual(r1.deck.steps.map((s) => s.nodeIds), [['n0', 'mine']])
  const r2 = revertedPresentation(revertToOriginal(styled).slate, null, [{ nodeIds: ['l1'] }])
  assert.deepEqual(r2.deck.steps.map((s) => s.nodeIds), [['l1']])
  assert.equal(r2.style, null)
  same(r2.deck, cameraDeck(revertToOriginal(styled).slate, [{ nodeIds: ['l1'] }]))
})

test('the Background swatches are one radio group with arrow keys, visible names and a check, and the hex field says what is wrong', () => {
  const panel = ui('components/slate/SlateStyle.jsx')
  assert.match(panel, /tabIndex=\{index === swatchIndex \? 0 : -1\}/)
  assert.match(panel, /ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1/)
  assert.match(panel, /<Box component="span">\{swatch\.name\}<\/Box>/)
  assert.match(panel, /\{on && <CheckIcon/)
  assert.match(panel, /setHexProblem\(value \? HEX_HINT : ''\)/)
  assert.match(panel, /const HEX_HINT = 'Use a color like #1a2b3c\.'/)
  assert.match(panel, /'aria-invalid': Boolean\(hexProblem\)/)
})
