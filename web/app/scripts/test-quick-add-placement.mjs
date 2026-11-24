/* eslint-disable no-console */
/**
 * test-quick-add-placement.mjs
 *
 * Runs the REAL quick-add (imports/ui/components/node/addNote.js) and the outline helper
 * (pathAtOrigin.js) against the REAL local engine utils (slateboxjs-v2 dist), on a fake slate.
 *
 * Owner report (slate 301898fc07): a quick-add star was stored with its outline in canvas
 * coordinates ("M10041.91,10057.85 C..."), which sent its sibling's line, preview, bird's-eye
 * view and animations across the canvas. And a note quick-added while zoomed landed at its
 * canvas position divided by the zoom (x 20000 at 50%), far off screen for collaborators.
 *
 * Asserts:
 *  A. pathAtOrigin moves a canvas-coordinate path to its own origin, same size; a path at its
 *     origin comes back unchanged.
 *  B. The slate's first quick-add star is stored from its own origin.
 *  C. A star quick-added at zoom 0.5 / 1 / 2 (panned) is centred in the visible area, in the
 *     options collaborators receive, with its outline at its own origin.
 *
 * Skips (does not fail) when the engine dist is absent (SLATEBOX_LIB, default ../../../slateboxjs-v2).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')
const LIB_ROOT = process.env.SLATEBOX_LIB || path.resolve(appRoot, '../../../slateboxjs-v2')
const enginePath = path.join(LIB_ROOT, 'dist/slateboxjs.mjs')
if (!existsSync(enginePath)) {
  console.log(`SKIP quick-add placement (no engine dist at ${enginePath})`)
  process.exit(0)
}
const engine = await import(pathToFileURL(enginePath).href)
const Slatebox = engine.Slatebox || engine.default
assert.ok(Slatebox?.utils?._transformPath && Slatebox?.utils?.getBBox, 'engine dist exposes Slatebox.utils')

/* ---------- transform the real modules (bare imports → stubs) ---------- */
const outDir = path.join(appRoot, 'scripts/harness-assembly')
await mkdir(outDir, { recursive: true })
const nodeDir = path.join(appRoot, 'imports/ui/components/node')
const stubHeader = 'const Slatebox = globalThis.__QSTUBS.Slatebox\n'

const pathSrc = await readFile(path.join(nodeDir, 'pathAtOrigin.js'), 'utf8')
const pathOut = path.join(outDir, 'pathAtOrigin.harness.mjs')
await writeFile(pathOut, stubHeader + pathSrc.replace("import { Slatebox } from 'slateboxjs'", ''))

const addSrc = await readFile(path.join(nodeDir, 'addNote.js'), 'utf8')
const addTransformed = addSrc
  .replace("import cloneDeep from 'lodash.clonedeep'", 'const cloneDeep = (o) => (o === undefined ? o : structuredClone(o))')
  .replace("import { Slatebox } from 'slateboxjs'", '')
  .replace("import defaultShapes from './defaultShapes'", `import defaultShapes from '${pathToFileURL(path.join(nodeDir, 'defaultShapes.js')).href}'`)
  // Whatever addNote takes from noteStyle (dockNoteStyle, and stickyNoteLook for the + menu Sticky Note).
  .replace(
    /from '\.\.\/\.\.\/common\/noteStyle\.mjs'/,
    `from '${pathToFileURL(path.join(appRoot, 'imports/ui/common/noteStyle.mjs')).href}'`
  )
  .replace("import pathAtOrigin from './pathAtOrigin'", `import pathAtOrigin from '${pathToFileURL(pathOut).href}'`)
const leftover = addTransformed.split('\n').filter((l) => /^import /.test(l) && !l.includes('file://'))
assert.deepEqual(leftover, [], 'addNote transform left unstubbed imports')
const addOut = path.join(outDir, 'addNote.harness.mjs')
await writeFile(addOut, stubHeader + addTransformed)

/* ---------- stubs: real engine utils, a fake slate ---------- */
class HNode {
  constructor(o) {
    this.options = o
    this.id = o.id
    this.positioned = null
  }

  position(where) {
    this.positioned = where
  }
}
globalThis.__QSTUBS = { Slatebox: { utils: { ...Slatebox.utils, guid: () => 'harness-id' }, node: HNode } }

const { default: pathAtOrigin } = await import(pathToFileURL(pathOut).href)
const { default: addNote } = await import(pathToFileURL(addOut).href)
const defaultShapes = (await import(pathToFileURL(path.join(nodeDir, 'defaultShapes.js')).href)).default
const star = defaultShapes.find((s) => s.key === 'star') || defaultShapes.find((s) => s.path && s.key !== 'rect')
assert.ok(star, 'defaultShapes has a star (or another path shape)')

const bb = (p) => Slatebox.utils.getBBox({ path: p })
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)

/* A. pathAtOrigin */
{
  const placed = Slatebox.utils._transformPath(star.path, 'T10000,10000s6,6')
  const before = bb(placed)
  assert.ok(before.x > 5000, `fixture path sits in canvas coordinates (x ${before.x})`)
  const moved = pathAtOrigin(placed)
  const after = bb(moved)
  near(after.x, 0, 0.01, 'A: moved path starts at x 0')
  near(after.y, 0, 0.01, 'A: moved path starts at y 0')
  near(after.width, before.width, 0.01, 'A: width kept')
  near(after.height, before.height, 0.01, 'A: height kept')
  assert.equal(pathAtOrigin(moved), moved, 'A: a path at its origin comes back unchanged')
  assert.equal(pathAtOrigin(''), '', 'A: empty path unchanged')
  console.log('PASS A: pathAtOrigin moves canvas-coordinate outlines to their origin')
}

function fakeSlate({ notes = [], viewBox = null, zoom = 1 } = {}) {
  const sent = []
  const added = []
  return {
    sent,
    added,
    nodes: { allNodes: notes, add: (n) => added.push(n) },
    collab: { send: (pkg) => sent.push(pkg) },
    options: { viewPort: { zoom: { r: zoom } } },
    getOrientation: () => ({ left: 9990, top: 9990, width: 300, height: 200, orientation: 'landscape' }),
    v2: {
      governanceOf: () => null,
      canvas: viewBox ? { viewbox: () => viewBox } : undefined,
    },
  }
}

/* B. first note */
{
  const slate = fakeSlate()
  const node = addNote(slate, star)
  const box = bb(node.options.vectorPath)
  near(box.x, 0, 0.01, 'B: first star outline x at origin')
  near(box.y, 0, 0.01, 'B: first star outline y at origin')
  near(box.width, node.options.width, 0.5, 'B: outline width is the note width')
  assert.equal(slate.sent[0].data.nodeOptions.vectorPath, node.options.vectorPath, 'B: collaborators get the same outline')
  console.log('PASS B: the first quick-add star is stored from its own origin')
}

/* C. zoomed + panned */
for (const zoom of [0.5, 1, 2]) {
  const vw = 1440 / zoom
  const vh = 900 / zoom
  const viewBox = { x: 12000 - vw / 2, y: 7000 - vh / 2, width: vw, height: vh }
  const existing = { options: { x: 9990, y: 9990, width: 300, height: 200, backgroundColor: '#fff' }, v2: {} }
  const slate = fakeSlate({ notes: [existing], viewBox, zoom })
  const node = addNote(slate, star)
  const o = slate.sent[0].data.nodeOptions
  near(o.xPos + o.width / 2, 12000, 0.5, `C: zoom ${zoom} centre x is the view's centre (collab options)`)
  near(o.yPos + o.height / 2, 7000, 0.5, `C: zoom ${zoom} centre y is the view's centre (collab options)`)
  const box = bb(node.options.vectorPath)
  near(box.x, 0, 0.01, `C: zoom ${zoom} outline at origin`)
  near(box.y, 0, 0.01, `C: zoom ${zoom} outline at origin`)
  console.log(`PASS C: zoom ${zoom}: the star lands in the middle of the view (${o.xPos.toFixed(1)}, ${o.yPos.toFixed(1)})`)
}

console.log('PASS: quick-add placement and stored outlines')
