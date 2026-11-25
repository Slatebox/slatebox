// The slate IS the presentation, polished (owner review of the six side-by-sides, 2026-11-25): what the canvas and
// the player draw agree, captions sit like the posters' captions, a dark slate's minimap is not a white card, the
// add dock stays shut on a copy, the Custom picker shows the worn background, an agent's style_presentation wears
// the style on the stored slate, and presentations saved with a style before slates wore styles are worn by their
// slates (slate-style-001).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { wearStyle } from '../web/app/imports/ui/components/presentations/presentationBake.mjs'
import { engineTextHeight, fitFont } from '../web/app/imports/ui/components/presentations/presentationCompose.mjs'
import { slateFaces, loadSlateFaces } from '../web/app/imports/ui/components/presentations/slateFaces.mjs'
import { minimapTokens } from '../web/app/imports/ui/common/canvasTheme.mjs'
import { showcasePresentations } from '../web/app/server/library/showcase/presentations.mjs'
import { deckRecord, wearDeckOnSlate } from '../web/app/server/methods/presentationDeck.mjs'
import { storedSlateLayout } from '../web/app/server/methods/presentationLayout.mjs'
import { sanitizeLayout } from '../web/app/server/methods/presentationRequest.mjs'
import { createSlateSaveCore } from '../web/app/server/slate-save-core.mjs'
import { wearStyledDecks } from '../web/app/server/migrations/slate-style-001.mjs'
import { memoryMongo } from './memory-mongo.mjs'

const app = fileURLToPath(new URL('../web/app/', import.meta.url))
const read = (path) => readFileSync(join(app, path), 'utf8')
const wearOf = (slug) => {
  const entry = showcasePresentations.find((e) => e.slug === slug)
  return wearStyle(entry.slate, { id: entry.look.style }, { direction: entry.look.direction, name: entry.title })
}

test('a note fits all of its words, every line it was written on, not only the first', () => {
  // The war room's burst: "Launch day:" / "version 2 goes live" set as the poster sets it (three lines), not in a
  // size only the first line fits (five lines on the canvas).
  const root = wearOf('launch-war-room').slate.nodes.find((n) => n.options.id === 'launch').options
  const w = root.width * root.textBox.w * 0.92 - 14
  const h = root.height * root.textBox.h * 0.86
  assert.ok(root.fontSize <= fitFont('Launch day:\nversion 2 goes live', w, h, 200, 'Anton'), `${root.fontSize}`)
  assert.ok(root.fontSize < fitFont('Launch day:', w, h, 200, 'Anton'), 'smaller than the first line alone would allow')
  // Each written line starts a line of its own.
  assert.ok(fitFont('One\nTwo\nThree', 400, 100, 60) < fitFont('One Two Three', 400, 100, 60))
})

test('a worn deck\'s plain notes of words are as tall as the engine draws them, so neither the canvas nor the player grows one on load', () => {
  for (const entry of showcasePresentations) {
    const { slate } = wearStyle(entry.slate, { id: entry.look.style }, { direction: entry.look.direction, name: entry.title })
    for (const node of slate.nodes) {
      const o = node.options
      // The style's words and the slate's own notes in a plain outline (a custom outline shrinks its text instead).
      if (!o.text || o.vectorPath || o.image || o.shape === 'custom' || /circle|ellipse/i.test(String(o.shape || ''))) continue
      assert.ok(o.height >= engineTextHeight(o.text, o.fontSize, o.width, o.fontFamily, o.fontWeight), `${entry.slug}: ${o.id} ${o.height}`)
    }
  }
})

test('captions sit close under what their step frames, in type sized for the screen the step fills (as the posters set them)', () => {
  const shares = []
  for (const entry of showcasePresentations) {
    const { slate, deck } = wearStyle(entry.slate, { id: entry.look.style }, { direction: entry.look.direction, name: entry.title })
    const byId = new Map(slate.nodes.map((n) => [n.options.id, n.options]))
    deck.steps.forEach((step, index) => {
      const caption = step.own.map((id) => byId.get(id)).find((o) => o?.styleRole === 'caption')
      if (!caption) return
      // The screen the step fills, caption included.
      const screen = Math.max(step.box.height, (step.box.width * 9) / 16) / (step.camera.fill ?? 0.86)
      shares.push(caption.fontSize / screen)
      // Never fine print: even a caption pushed away from a crowded step stays readable.
      assert.ok(caption.fontSize >= screen * 0.018, `${entry.slug} step ${index}: caption ${caption.fontSize} on a ${Math.round(screen)} screen`)
    })
  }
  // Typically the posters' size: about 4% of the screen's height (they set captions at 4.6%).
  shares.sort((a, b) => a - b)
  assert.ok(shares[Math.floor(shares.length / 2)] >= 0.036, `median ${shares[Math.floor(shares.length / 2)]}`)
})

test('the canvas and the player wait for the slate\'s own faces before drawing it, from the page itself (no font host)', async () => {
  assert.match(read('imports/api/client/createSlate.js'), /await loadSlateFaces\(loaded\)\n\s+await slate\.loadJSON/)
  assert.match(read('imports/ui/components/presentations/livePresenter.mjs'), /await loadSlateFaces\(presented, \{ doc \}\)\n\s+await slate\.loadJSON/)
  const declared = new Set(['anton', 'space grotesk'])
  const json = { nodes: [{ options: { fontFamily: 'Anton' } }, { options: { fontFamily: 'Space Grotesk', fontWeight: 'bold' } }, { options: { fontFamily: 'Arial, sans-serif' } }, { options: { fontFamily: 'Fraunces', fontStyle: 'italic' } }] }
  assert.deepEqual(slateFaces(json, declared), ['16px "Anton"', 'bold 16px "Space Grotesk"'])
  const asked = []
  const faces = [{ family: '"Anton"' }, { family: 'Space Grotesk' }]
  const doc = { fonts: { forEach: (fn) => faces.forEach(fn), load: async (font) => { asked.push(font) } } }
  await loadSlateFaces(json, { doc })
  assert.deepEqual(asked, ['16px "Anton"', 'bold 16px "Space Grotesk"'])
  // A face that never arrives is not waited for forever.
  const stuck = { fonts: { forEach: (fn) => faces.forEach(fn), load: () => new Promise(() => {}) } }
  const started = Date.now()
  await loadSlateFaces(json, { doc: stuck, timeoutMs: 30 })
  assert.ok(Date.now() - started < 1000)
  for (const file of ['imports/ui/components/presentations/slateFaces.mjs']) assert.doesNotMatch(read(file), /googleapis/)
})

test('a dark slate\'s minimap takes its colors from the slate, not a white card; a slate that follows the mode keeps the app\'s', () => {
  const neon = minimapTokens({ backgroundColor: '#0b0016' })
  assert.equal(neon.scheme, 'dark')
  assert.notEqual(neon.tokens['--sb-minimap-bg'].toLowerCase(), '#ffffff')
  assert.ok(parseInt(neon.tokens['--sb-minimap-bg'].slice(1, 3), 16) < 60)
  assert.equal(minimapTokens({ backgroundColor: '#f3f1e4' }).scheme, 'light')
  assert.equal(minimapTokens({ backgroundColor: '#ffffff' }), null)
  assert.equal(minimapTokens(null), null)
  assert.equal(minimapTokens({ backgroundColor: '#0b0016', backgroundImage: 'x.jpg' }), null)
  assert.match(read('imports/ui/common/main.css'), /#slateCanvas\[data-sb-slate-bg\] \.slateboxjs-birdseye\{background-color:var\(--sb-minimap-bg\)!important;border-color:var\(--sb-minimap-edge\)!important\}/)
})

test('the add dock opens on hover only when the pointer comes to it, never because a notice over it went away', () => {
  const dock = read('imports/ui/components/node/QuickNodeActions.jsx')
  assert.match(dock, /const still = !native\?\.movementX && !native\?\.movementY/)
  assert.match(dock, /if \(still \|\| performance\.now\(\) - lastPressAt\.current < 800\) return/)
  assert.match(dock, /handleActionMenuOpen\(event, 'mouseEnter'\)/)
})

test('the Custom colors show the background the slate has now (a worn style\'s), read from the live engine', () => {
  const colors = read('imports/ui/components/slate/SlateColors.jsx')
  assert.match(colors, /const liveOptions = live\?\.v2\?\.options \?\? live\?\.options/)
  assert.match(colors, /\}, \[bcolor, lcolor, style\?\.backgroundColorAsGradient, styleVersion\]\)/)
  assert.match(read('imports/ui/components/slate/SlateStyle.jsx'), /React\.cloneElement\(child, \{ styleVersion: version \}\)/)
})

test('neon and voyage lines are drawn at the style\'s strength on the canvas (real lines, under the notes)', () => {
  for (const slug of ['launch-war-room', 'roadmap-bets']) {
    const { slate } = wearOf(slug)
    const lines = slate.nodes.flatMap((n) => n.relationships?.associations || [])
    assert.ok(lines.length && lines.every((l) => l.lineOpacity > 0 && l.lineOpacity < 1), slug)
  }
})

// ---- the stored slate wears it: agents and the migration --------------------------------------------------------

const tree = () => {
  const node = (id, text, x, y, kids = []) => ({ options: { id, text, xPos: x, yPos: y, width: 220, height: 100, backgroundColor: '#cfe3d6', fontFamily: 'Arial', fontSize: 20 },
    relationships: { associations: kids.map((kid) => ({ id: `${id}-${kid}`, parentId: id, childId: kid, lineColor: '#5d6b64', lineWidth: 3 })) } })
  return {
    options: { id: 's1', name: 'Plan', containerStyle: { backgroundColor: '#ffffff' }, isPrivate: true, isPublic: false, isUnlisted: false },
    nodes: [node('root', 'Q3 plan', 0, 200, ['a', 'b']), node('a', 'Hire two engineers', 400, 0, ['a1']), node('a1', 'Post the roles', 700, 0), node('b', 'Ship the app', 400, 400, ['b1']), node('b1', 'Beta in May', 700, 400)],
  }
}
const directionFor = (slate, style) => deckRecord({ layout: sanitizeLayout(storedSlateLayout(slate)).layout, style: { id: style }, name: 'Plan' }).direction

test('wearing a deck on a stored slate keeps every note and its words, and gives a deck of camera steps over it', () => {
  const slate = tree()
  const worn = wearDeckOnSlate(slate, { direction: directionFor(slate, 'calm'), name: 'Plan' }, { id: 'neon' })
  assert.equal(worn.slate.options.style.id, 'neon')
  assert.equal(worn.change.deck.version, 5)
  for (const node of slate.nodes) assert.equal(worn.slate.nodes.find((n) => n.options.id === node.options.id)?.options.text, node.options.text)
  assert.equal(wearDeckOnSlate({ nodes: [] }, { direction: { steps: [] } }, { id: 'neon' }), null)
})

test('slate-style-001: each slate whose latest deck was saved with a style wears it natively, once; nothing is deleted', async () => {
  const slates = memoryMongo()
  const events = memoryMongo()
  const presentations = memoryMongo()
  let clock = 1000
  const saveCore = createSlateSaveCore({ slates, events, now: () => clock++ })
  const plain = tree()
  await saveCore.create({ row: { _id: 's1', shareId: 'share1', userId: 'u1', ...plain }, actor: { kind: 'person', userId: 'u1' }, source: 'create' })
  await saveCore.create({ row: { _id: 's2', shareId: 'share2', userId: 'u2', ...tree(), options: { ...plain.options, id: 's2' } }, actor: { kind: 'person', userId: 'u2' }, source: 'create' })
  await saveCore.create({ row: { _id: 's3', shareId: 'share3', userId: 'u3', ...tree(), options: { ...plain.options, id: 's3' } }, actor: { kind: 'person', userId: 'u3' }, source: 'create' })
  // A published voyage deck; a library copy in neon; a slate presented again since without a style; an unstyled deck.
  await presentations.insertOne({ _id: 'p1', slateShareId: 'share1', version: 1, name: 'Plan', style: { id: 'voyage' }, direction: directionFor(plain, 'voyage'), isPublished: true, slateJSON: '{"nodes":[]}' })
  await presentations.insertOne({ _id: 'p2', slateShareId: 'share2', version: 1, name: 'Plan', style: { id: 'neon' }, direction: directionFor(plain, 'neon'), libraryCopy: true })
  await presentations.insertOne({ _id: 'p3', slateShareId: 'share3', version: 1, name: 'Plan', style: { id: 'neon' }, direction: directionFor(plain, 'neon') })
  await presentations.insertOne({ _id: 'p4', slateShareId: 'share3', version: 2, name: 'Plan', viewpoints: [] })
  const quiet = { info: () => {}, error: () => {} }
  const report = await wearStyledDecks({ presentations, slates, saveCore, log: quiet })
  assert.deepEqual(report.worn.sort(), ['p1', 'p2'])
  assert.deepEqual(report.skipped, ['p3'])
  assert.deepEqual(report.failed, [])
  const s1 = await slates.findOne({ _id: 's1' })
  assert.equal(s1.options.style.id, 'voyage')
  assert.equal(s1.options.containerStyle.backgroundColor, wearStyle(plain, { id: 'voyage' }).slate.options.containerStyle.backgroundColor)
  for (const node of plain.nodes) assert.equal(s1.nodes.find((n) => n.options.id === node.options.id)?.options.text, node.options.text, 'every note kept')
  assert.ok(s1.nodes.some((n) => n.options.styleRole === 'caption'), 'captions are real notes')
  const p1 = await presentations.findOne({ _id: 'p1' })
  assert.equal(p1.deck.version, 5)
  assert.ok(JSON.parse(p1.slateJSON).nodes.length > plain.nodes.length, 'the published snapshot is the styled slate')
  assert.equal((await slates.findOne({ _id: 's2' })).options.style.id, 'neon')
  assert.equal((await slates.findOne({ _id: 's3' })).options.style, undefined, 'a slate presented again since keeps its look')
  // Again: nothing to do, nothing saved.
  const revisions = [(await slates.findOne({ _id: 's1' })).revision, (await slates.findOne({ _id: 's2' })).revision]
  const again = await wearStyledDecks({ presentations, slates, saveCore, log: quiet })
  assert.deepEqual(again.worn, [])
  assert.deepEqual([(await slates.findOne({ _id: 's1' })).revision, (await slates.findOne({ _id: 's2' })).revision], revisions)
  assert.match(read('server/startup.js'), /wearStyledDecks\(\{ presentations: SlatePresentations\.rawCollection\(\), slates: Slates\.rawCollection\(\), saveCore: slateSaveCore \}\)/)
})

test('an agent\'s style_presentation wears the style on the stored slate, as its own undoable edit', async (t) => {
  const { createAppRegistry } = await import('../web/app/server/actions/index.mjs')
  const { createIdempotencyStore } = await import('../web/app/server/actions/idempotency.mjs')
  const { serve } = await import('./action-test-stores.mjs')
  const { createRequire } = await import('node:module')
  const { applyPlanToJSON } = createRequire(new URL('../web/app/package.json', import.meta.url))('slateboxjs/operations')
  const slates = memoryMongo()
  const events = memoryMongo()
  const runs = memoryMongo()
  let clock = 5000
  const now = () => clock++
  const saveCore = createSlateSaveCore({ slates, events, now })
  const plain = tree()
  await saveCore.create({ row: { _id: 's1', shareId: 'share1', userId: 'owner', lastSaved: 1, ...plain }, actor: { kind: 'person', userId: 'owner' }, source: 'create' })
  const deckRow = { _id: 'deck1', version: 1, name: 'Plan', style: { id: 'calm' }, direction: directionFor(plain, 'calm'), viewpoints: [] }
  const saved = []
  const sortBy = (sort = {}) => (a, b) => {
    for (const [key, dir] of Object.entries(sort)) {
      if ((a[key] ?? -Infinity) < (b[key] ?? -Infinity)) return -dir
      if ((a[key] ?? -Infinity) > (b[key] ?? -Infinity)) return dir
    }
    return 0
  }
  const deps = {
    saveCore,
    authorizeTokenForSlate: async (token, shareId) => {
      const slate = await slates.findOne({ shareId })
      const authorized = Boolean(slate && slate.userId === token.userId)
      return { slate, authorized, access: authorized ? { role: 'EDIT', canEdit: true, isOwner: true, linkRole: null, grantKey: null } : null }
    },
    loadUser: async (userId) => ({ _id: userId }),
    applySlateOperationPlanToJSON: applyPlanToJSON,
    latestPresentation: async () => deckRow,
    savePresentation: async (id, set) => { saved.push([id, set]); Object.assign(deckRow, set) },
    operationRuns: {
      findOneAsync: async (selector, options = {}) => (await runs.find(selector).toArray()).sort(sortBy(options.sort))[0] ?? null,
      insertAsync: (row) => runs.insertOne({ _id: 'run-' + runs.docs().length, ...row }),
      updateAsync: (selector, update) => runs.updateOne(selector, update),
    },
  }
  const registry = createAppRegistry({ deps, idempotency: createIdempotencyStore({ collection: memoryMongo() }), now })
  const authenticate = async () => ({ kind: 'agent', tokenId: 'token-owner', tokenName: 'Agent', userId: 'owner', scopes: ['slates:read', 'slates:write'] })
  const call = await serve(t, registry, authenticate)
  const restyled = await call('/api/v1/slates/share1/presentation/style', { token: 'owner', method: 'POST', body: { style: 'neon' } })
  assert.ok([200, 201].includes(restyled.status), JSON.stringify(restyled.body))
  assert.equal(restyled.body.style, 'neon')
  const stored = await slates.findOne({ _id: 's1' })
  assert.equal(stored.options.style.id, 'neon', 'the stored slate wears the style')
  assert.ok(stored.nodes.some((n) => n.options.styleRole), 'its art is real notes on the slate')
  assert.equal(saved[0][1].deck.version, 5)
  // One edit of the caller's own: slates.undo takes the whole style back.
  const undone = await call('/api/v1/slates/share1/undo', { token: 'owner', method: 'POST', body: {} })
  assert.equal(undone.status, 200, JSON.stringify(undone.body))
  const back = await slates.findOne({ _id: 's1' })
  assert.equal(back.options.style ?? null, null)
  assert.equal(back.options.containerStyle.backgroundColor, '#ffffff')
  assert.deepEqual(back.nodes.map((n) => n.options.id).sort(), plain.nodes.map((n) => n.options.id).sort())
})
