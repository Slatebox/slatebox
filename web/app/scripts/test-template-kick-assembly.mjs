/* eslint-disable no-console */
/**
 * test-template-kick-assembly.mjs
 *
 * Replays the TEMPLATE JOURNEY kickoff assembly offline against the REAL
 * initAIConversation source (imports/api/common/initAIConversation.js), fed
 * with the REAL production-shaped inputs:
 *   - the live sSdf "Template Population" intention document
 *     (scripts/fixtures/sSdf-test.json — dump of TEST env doc)
 *   - the real Pro/Con template seed (server/bootstrap/proConTemplate.json)
 *     transformed exactly the way Chat.jsx loadTemplateIntoSlate + the v3
     // engine deserialize would transform it.
 *
 * Scenario A: template WAS loaded before kickoff (basedOnTemplate visible,
 *             category nodes present) → kickoff must assemble and reach the
 *             conversation call with a resolved prompt (no {{...}} left).
 * Scenario B: template NOT loaded (the pre-iter15 race shape) → must abort
 *             with the loud message, never fire a contentless kick.
 *
 * If A ever regresses, this fails HERE, not on a live run.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')

/* ---------- 1. transform the real module (strip meteor/slateboxjs imports) ---------- */
const SRC = path.join(appRoot, 'imports/api/common/initAIConversation.js')
const src = await readFile(SRC, 'utf8')

const stubbed = `/* eslint-disable */
const Random = { id: () => 'harness-random-id' }
const Meteor = globalThis.__HSTUBS.Meteor
const Slatebox = globalThis.__HSTUBS.Slatebox
const difference = (a, b) => a.filter((x) => !b.includes(x))
const prepAISlate = globalThis.__HSTUBS.prepAISlate
`

const transformed = src
  .replace("import { Random } from 'meteor/random'", '')
  .replace("import { Meteor } from 'meteor/meteor'", '')
  .replace("import { Slatebox } from 'slateboxjs'", '')
  .replace("import difference from 'lodash.difference'", '')
  .replace("import prepAISlate from './prepAISlate'", '')
  .replace(
    "import CONSTANTS from './constants'",
    `import CONSTANTS from '${path.join(appRoot, 'imports/api/common/constants.js')}'`
  )
  .replace(
    "import defaultShapes from '../../ui/components/node/defaultShapes'",
    `import defaultShapes from '${path.join(appRoot, 'imports/ui/components/node/defaultShapes.js')}'`
  )
  .replace(
    "import parseTemplateIntoCategories from './parseTemplateIntoCategories'",
    `import parseTemplateIntoCategories from '${path.join(appRoot, 'imports/api/common/parseTemplateIntoCategories.js')}'`
  )

const importLines = transformed.split('\n').filter((l) => /^import /.test(l))
const bad = importLines.filter(
  (l) =>
    l.includes('meteor/') ||
    l.includes('slateboxjs') ||
    l.includes('lodash.difference') ||
    l.includes("'./prepAISlate'")
)
if (bad.length) {
  console.error('transform left unstubbed imports:')
  console.error(transformed.split('\n').slice(0, 14).join('\n'))
  process.exit(1)
}

const outDir = path.join(appRoot, 'scripts/harness-assembly')
await mkdir(outDir, { recursive: true })
const outFile = path.join(outDir, 'initAIConversation.harness.mjs')
await writeFile(outFile, stubbed + '\n' + transformed)

/* ---------- 2. stubs at the meteor boundary ---------- */
const calls = []
let captured = null

globalThis.__HSTUBS = {
  Meteor: {
    callAsync: async (name, args) => {
      calls.push(name)
      if (name === 'openai.chat') {
        captured = args
      }
      return { error: 'harness-stop' } // no further provider path needed
    },
  },
  Slatebox: {
    utils: {
      createMultiLineText: (t) => t,
      whiteOrBlack: () => '#000',
      _transformPath: (p) => p,
    },
    node: class HNode {
      constructor(o) {
        this.options = o
        this.id = o.id
      }
    },
  },
  prepAISlate: async ({ slate, aiSettings, prompt }) => {
    captured = { prompt, engine: aiSettings.engine, aiSettings }
    return { aiContext: { assembled: true }, abort: false }
  },
}

const mod = await import(outFile)
const initAIConversation = mod.default

/* ---------- 3. real fixture data ---------- */
const intention = JSON.parse(
  await readFile(path.join(appRoot, 'scripts/fixtures/sSdf-test.json'), 'utf8')
)
const template = JSON.parse(
  await readFile(path.join(appRoot, 'server/bootstrap/proConTemplate.json'), 'utf8')
)

// the real wizard handoff (verified shape from live run + Chat.handleWelcome)
const wizardResult = {
  instructions:
    'Build a Pro/Con Analysis slate comparing PostgreSQL vs MySQL for an engineering personal-use project.',
  instructions_unchecked:
    'Build a Pro/Con Analysis slate comparing PostgreSQL vs MySQL for an engineering personal-use project.',
  val: true,
  dedicated: true,
  technicalInstructions:
    'Use varied fonts. Given a {{baseColor}} background color, use a sophisticated color palette.',
  baseColor: '#4a7c9e',
  template: 'tplprocon001',
  intentionId: 'sSdfQkbvvFZDsMB7r',
}

/* Scenario A: template loaded into the live canvas.
   Mirrors Chat.jsx loadTemplateIntoSlate + engine deserializeInner:
   options are Object.assign'ed (all keys), nodes spawn as objects with
   .options, so parseTemplateIntoCategories sees the 4 category sections. */
const loadedSlate = {
  shareId: 'harnesscanvas',
  options: {
    ...template.options,
    id: 'harnesscanvas',
    shareId: 'harnesscanvas',
    createdViaIA: true,
    isTemplate: false,
    templateApproved: false,
    basedOnTemplate: 'tplprocon001',
    templateName: template.options.name,
  },
  nodes: {
    allNodes: (template.nodes || []).map((n) => ({
      options: { ...n.options },
    })),
  },
  collab: { exe: () => {} },
}

const catCount = loadedSlate.nodes.allNodes.filter(
  (n) => n.options.isCategory && n.options.categoryName
).length
assert.ok(catCount >= 3, `fixture must expose category sections, got ${catCount}`)

/* Scenario B: no template (the pre-await race shape). */
const bareSlate = {
  shareId: 'harnesscanvas',
  options: { id: 'harnesscanvas', name: 'New Slate' },
  nodes: { allNodes: [] },
  collab: { exe: () => {} },
}

/* ---------- 4. run ---------- */
// A) loaded → must assemble a resolved kickoff
calls.length = 0
captured = null
const resA = await initAIConversation({
  slate: loadedSlate,
  intention: structuredClone(intention),
  result: { ...wizardResult },
  uploadedFiles: [],
})

console.log('A abort?', resA.abort || false)
assert.ok(!resA.abort, `Scenario A must NOT abort; got: ${resA.abortMessage}`)
assert.ok(captured, 'kick payload must reach the conversation boundary')
const kickText = JSON.stringify(captured.prompt || captured)
assert.ok(!kickText.includes('{{'), `kick leaked placeholders: ${(kickText.match(/{{[^}]{0,25}/g) || []).slice(0, 5).join(' | ')}`)
assert.ok(
  kickText.includes('Pro/Con') && kickText.includes('PostgreSQL vs MySQL'),
  'kick must carry template name + user specifics'
)
assert.ok(
  kickText.includes('Advantages') && kickText.includes('Costs'),
  'kick must carry the category set'
)

// B) unloaded → loud abort, and the message must name the leftovers
calls.length = 0
captured = null
const resB = await initAIConversation({
  slate: bareSlate,
  intention: structuredClone(intention),
  result: { ...wizardResult },
  uploadedFiles: [],
})
assert.ok(resB.abort, 'Scenario B must abort (no contentless kick)')
assert.ok(
  /unresolved placeholders: \{\{/.test(resB.abortMessage || ''),
  `abort must name leftovers, got: ${resB.abortMessage}`
)

console.log(
  'PASS: loaded-template kickoff assembles clean (no {{ leakage); unloaded aborts loudly.'
)

/* ---------- Scenario C: REAL engine + REAL seed, end-to-end ----------
 * Runs the BUILT local engine artifact (exactly what the ship script
 * packages into the image) against the real initAIConversation on ONE live
 * slate instance, mirroring Chat.jsx loadTemplateIntoSlate → kickoff.
 *
 * Regression class this catches (iteration 19 root cause): the compat
 * facade's slate.options used to stay frozen at the boot copy while
 * loadJSON merged only into the private v2 options — so the template gate
 * in initAIConversation saw basedOnTemplate=null even after a perfectly
 * awaited load, and every template journey aborted contentless. If the
 * facade contract ever regresses again, THIS fails offline.
 *
 * Skips (does not fail) when the local engine dist or jsdom are absent,
 * e.g. CI containers without a sibling slateboxjs-v2 checkout.
 */
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const LIB_ROOT =
  process.env.SLATEBOX_LIB || path.resolve(appRoot, '../../../slateboxjs-v2')
const enginePath = path.join(LIB_ROOT, 'dist/slateboxjs.mjs')

let scenarioCRan = false
try {
  const jsdomMod = await import('jsdom').catch(() => null)
  if (!jsdomMod || !existsSync(enginePath)) {
    console.log(
      `SKIP Scenario C (engine dist or jsdom unavailable: ${
        existsSync(enginePath) ? 'no jsdom' : 'no dist'
      })`
    )
  } else {
    const { JSDOM } = jsdomMod
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="harnessStage"></div></body></html>',
      { pretendToBeVisual: true }
    )
    const { window } = dom
    global.window = window
    global.document = window.document
    globalThis.requestAnimationFrame = (cb) =>
      setTimeout(() => cb(Date.now()), 16)
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    if (window.SVGElement) {
      if (!window.SVGElement.prototype.getBBox) {
        window.SVGElement.prototype.getBBox = function () {
          const t = (this.textContent || '').length
          return { x: 0, y: 0, width: Math.max(20, t * 6), height: 16 }
        }
      }
      if (!window.SVGElement.prototype.getComputedTextLength) {
        window.SVGElement.prototype.getComputedTextLength = function () {
          return (this.textContent || '').length * 6
        }
      }
    }
    global.SVGElement = window.SVGElement
    globalThis.getComputedStyle = window.getComputedStyle.bind(window)

    const engine = await import(pathToFileURL(enginePath).href)
    const SB = engine.Slatebox || engine.default?.Slatebox
    if (!SB?.slate) {
      console.log('SKIP Scenario C (no Slatebox.slate export in dist)')
    } else {
      const live = await new SB.slate({ container: 'harnessStage' }).init()

      // Fresh canvas must not look template-loaded.
      assert.ok(
        !live.options.basedOnTemplate,
        'fresh engine slate must not carry template context'
      )

      // Exact shape of Chat.jsx loadTemplateIntoSlate: mutate the fetched
      // slateBase's options, then feed it through the engine's loadJSON.
      const slateBase = structuredClone(template)
      slateBase.options.id = 'harnesscanvas'
      slateBase.options.shareId = 'harnesscanvas'
      slateBase.options.createdViaIA = true
      slateBase.options.isTemplate = false
      slateBase.options.templateApproved = false
      slateBase.options.basedOnTemplate = 'tplprocon001'
      slateBase.options.templateName = template.options.name

      await live.loadJSON(JSON.stringify(slateBase))

      // The gate contract the app depends on: facade reads reflect the load.
      assert.equal(
        live.options.basedOnTemplate,
        'tplprocon001',
        'facade options must expose basedOnTemplate after load (iter-19 regression)'
      )
      const catsC = (live.nodes.allNodes || []).filter(
        (n) => n.options?.isCategory && n.options?.categoryName
      )
      assert.equal(
        catsC.length,
        4,
        `facade nodes must expose the 4 category sections, got ${catsC.length}`
      )

      // Kickoff assembly on the SAME live instance.
      calls.length = 0
      captured = null
      const resC = await initAIConversation({
        slate: live,
        intention: structuredClone(intention),
        result: { ...wizardResult },
        uploadedFiles: [],
      })
      assert.ok(
        !resC.abort,
        `Scenario C (real engine) must NOT abort; got: ${resC.abortMessage}`
      )
      const kickC = JSON.stringify(captured?.prompt || captured || '')
      assert.ok(
        !kickC.includes('{{'),
        `C kick leaked placeholders: ${(
          kickC.match(/{{[^}]{0,25}/g) || []
        ).slice(0, 5).join(' | ')}`
      )
      assert.ok(
        kickC.includes('This template has 4 categories'),
        'C kick must inject the category set into the template prompt'
      )
      assert.ok(
        kickC.includes('PostgreSQL vs MySQL'),
        'C kick must carry the user specifics'
      )
      // iter22 live finding: the fixture's real ChatIntentions text (with
      // the ask-first permission clause) must come out of the assembled
      // kick WITHOUT the permission and WITH the imperative closer.
      assert.ok(
        !/be proactive in asking/i.test(kickC),
        'C kick must strip the legacy ask-first permission clause (real fixture carries it)'
      )
      assert.ok(
        !/as many as the user asks|may ask for notes to be created right away/i.test(
          kickC
        ),
        'C kick must strip the conditional note-creation clauses (fixture carries them)'
      )
      assert.ok(
        kickC.includes('Respond NOW by calling the respond function'),
        'C kick must end-drive with the fill-now imperative'
      )
      // iter26 quality nits, pinned:
      assert.ok(
        kickC.includes('skip citations entirely and never invent'),
        'C kick (no sources uploaded) must carry the citation-disarm line'
      )
      assert.ok(
        kickC.includes('attach it to the main topic'),
        'C kick must route the title note to the main topic, not a category'
      )
      assert.ok(
        !/\{\{template/.test(kickC),
        'C kick must not leak unresolved placeholders'
      )
      scenarioCRan = true
      console.log(
        'PASS Scenario C: real engine load → template gate visible → kickoff assembled with categories.'
      )
    }
  }
} catch (cErr) {
  console.error('FAIL Scenario C (real engine integration):', cErr.message)
  process.exit(1)
}
if (!scenarioCRan) console.log('(scenario C skipped; A+B still gate)')

/* ---------- Scenario D: static contract on the Chat welcome gate ----------
 * The iteration-20 live failure: `if (slate.options.ai) return` treated the
 * default fresh-canvas `ai: {}` (truthy!) as an existing conversation and
 * silently disabled /canvas?prompt= auto-submit. Pinned so the class can't
 * silently return: the gate must interrogate the conversation shape, not the
 * container's truthiness.
 */
const chatSrc = await readFile(
  path.join(appRoot, 'imports/ui/components/ai/SlateAIRunner.jsx'),
  'utf8'
)
assert.ok(
  !/if\s*\(\s*slate\??\.options\??\.ai\s*\)/.test(chatSrc),
  'Chat.jsx must not gate the welcome flow on bare options.ai truthiness (empty {} is truthy — fresh canvases would never fire)'
)
assert.ok(
  /options\??\.ai\??\.isConversation/.test(chatSrc),
  'Chat.jsx welcome gate must check the actual conversation shape (ai?.isConversation)'
)
console.log('PASS Scenario D: welcome-gate contract holds.')

/* ---------- Scenario E: prompt latch (one dispatch per canvas+prompt) ----------
 * The iteration-20 live failure had TWO welcome chains and TWO kickoff
 * pipelines for ONE wizard submit (3f04265bdf): the initWelcome effect can
 * execute more than once per page, and both executions were live. The latch
 * is the dispatch-level kill switch — exercised here for real, not just as
 * a static contract.
 */
const { claimPrompt, __resetPromptLatch } = await import(
  path.join(appRoot, 'imports/ui/common/promptLatch.js')
)
__resetPromptLatch()
assert.ok(claimPrompt('shareA|do the thing'), 'E: first claim must succeed')
assert.ok(!claimPrompt('shareA|do the thing'), 'E: repeat claim must be suppressed')
assert.ok(
  claimPrompt('shareB|do the thing'),
  'E: same prompt on a different canvas must claim (per-canvas key)'
)
assert.ok(!claimPrompt('') && !claimPrompt(null), 'E: empty key must not claim')
for (let i = 0; i < 250; i++) claimPrompt(`filler-${i}`)
assert.ok(claimPrompt('after-cap'), 'E: latch stays bounded and usable past the cap')
assert.ok(
  chatSrc.includes("from '../../common/promptLatch'") &&
    chatSrc.includes('claimPrompt(') &&
    chatSrc.includes('if (!slate) return'),
  'Chat.jsx must wire the prompt latch and skip the effect when the engine slate is absent'
)
console.log('PASS Scenario E: prompt latch semantics + wiring.')
