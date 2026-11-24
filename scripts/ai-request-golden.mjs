// Records what the board and canvas model call sites send to req(): lane chat and map chat
// (workshops.js chatTurn), board drafting (workshops.js draftWorkshop), the canvas conversation and
// the Slatebox agent (canvas-conversation.js modelFor). Each recording is the request with its
// system text, prompts, tool schemas and forced call, plus the retry prompts its response check
// gives for a wrong answer. scripts/ai-request-golden.test.mjs compares them with goldens captured
// from the code before the surface catalogue (scripts/fixtures/ai-request/call-sites.golden.json).
//
//   node scripts/ai-request-golden.mjs [webAppRoot]   prints the recordings as JSON
// One app root per process: the module hooks are registered once.
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

const TARGETS = ['server/methods/workshops.js', 'server/methods/canvas-conversation.js']

// A callable proxy that answers any property with itself: the stand-in for whatever a stubbed
// module exports that the call sites under test never really use.
function anything() {
  const fn = function () { return proxy }
  const proxy = new Proxy(fn, {
    get: (target, prop) => (prop === 'then' ? undefined : prop === Symbol.toPrimitive ? () => '' : proxy),
    apply: () => proxy,
    construct: () => proxy,
  })
  return proxy
}

const LANES = { version: 1, title: 'Pick a venue', lanes: [{ id: 'ideas', label: 'Ideas' }, { id: 'shortlist', label: 'Shortlist' }],
  cards: [{ id: 'hall', label: 'Town hall', laneId: 'ideas' }, { id: 'barn', label: 'Old barn', laneId: 'ideas' }] }
const MAP = { version: 1, title: 'Trip', lanes: [
  { id: 'station-1', label: 'Start', station: { column: 0, row: 0, next: ['station-2'], outcome: 'Set off.' } },
  { id: 'station-2', label: 'Summit', station: { column: 1, row: 0, next: [], outcome: 'At the top.' } }],
cards: [{ id: 'walker', label: 'Walker', laneId: 'station-1' }] }

export async function recordCallSites(appRoot) {
  const root = appRoot.replace(/\/+$/, '') + '/'
  register(new URL('./ai-request-golden-hooks.mjs', import.meta.url), { data: { appRoot: root, targets: TARGETS } })

  const calls = []
  let board = LANES
  class MeteorError extends Error {
    constructor(error, reason) { super(reason || error); this.error = error; this.reason = reason }
  }
  const methods = {}
  const Meteor = {
    methods: (defs) => Object.assign(methods, defs),
    userAsync: async () => ({ _id: 'ana', emails: [] }),
    userId: () => 'ana',
    users: { updateAsync: async () => 1, findOneAsync: async () => ({ _id: 'ana' }) },
    settings: { public: {} },
    Error: MeteorError,
    isServer: true,
    startup: () => {},
    callAsync: async () => ({ canGenerate: true }),
  }
  const stubs = {
    'meteor/meteor': { Meteor },
    'server/methods/ai/req': { default: async (opts) => { calls.push(opts); return { abort: true } } },
    'server/metering/context.mjs': { runAIAction: (_opts, fn) => fn() },
    'server/metering/context': { runAIAction: (_opts, fn) => fn() },
    'server/metering/meteor': { canStartAI: async () => true, aiRefusal: async () => null },
    'server/methods/creative-slates': {
      resolveCreativeSlate: async () => ({ canEdit: true, slateBase: { _id: 'slate1', options: {}, nodes: [], creative: { revision: 3, model: { kind: 'workshop', workshop: board } } } }),
      resolvePresentationSlate: async () => null,
    },
  }
  globalThis.__aiGoldenStub = (key) => stubs[key] || anything()

  const workshopsUrl = pathToFileURL(root + TARGETS[0]).href
  const canvasUrl = pathToFileURL(root + TARGETS[1]).href
  await import(workshopsUrl)
  const { modelFor } = await import(canvasUrl)

  // What each request's check tells the model after a wrong answer (its retry prompt).
  const retries = (opts, answers) => answers.map((answer) => {
    try { return opts.validateResponse?.(answer) ?? null } catch (error) { return { threw: error.message } }
  })
  const shape = (opts, answers) => ({ request: JSON.parse(JSON.stringify(opts)), retries: JSON.parse(JSON.stringify(retries(opts, answers))) })
  const wrongTool = [{ toolCall: { name: 'not_this_tool', arguments: {} } }, { toolCall: null, message: { content: '' } }]
  const last = () => calls.at(-1)
  const quiet = async (fn) => { try { await fn() } catch {} }

  const out = {}
  board = LANES
  await quiet(() => methods['workshops.laneChat']({ shareId: 'share1', revision: 3, message: 'move the barn to the shortlist', history: [] }))
  out.laneChat = shape(last(), wrongTool)
  board = MAP
  await quiet(() => methods['workshops.mapChat']({ shareId: 'share1', revision: 3, message: 'add a station after the summit', history: [] }))
  out.mapChat = shape(last(), wrongTool)
  for (const format of ['lanes', 'map', 'release-plan']) {
    await quiet(() => methods['workshops.draft']('Choose a venue for the spring party with the team', format))
    out[`draft:${format}`] = shape(last(), wrongTool)
  }
  const before = calls.length
  await quiet(() => methods['workshops.draft']('Let the walker skip the start', 'map', MAP))
  if (calls.length === before) throw new Error('the revision draft sent no request')
  out['draft:revision'] = shape(last(), wrongTool)
  const tool = { name: 'exec', description: 'Run code', parameters: { type: 'object', properties: { code: { type: 'string' } } } }
  const prompts = [{ role: 'user', content: 'draw three notes' }]
  await modelFor('share1')({ system: 'canvas system', prompts, tool })
  out.canvas = shape(last(), [{ toolCall: { name: 'exec', arguments: { code: '' } } }, { toolCall: null, message: { content: '' } }])
  await modelFor(null, 'agent')({ system: 'agent system', prompts, tool })
  out.agent = shape(last(), [{ toolCall: { name: 'exec', arguments: { code: '' } } }, { toolCall: null, message: { content: '' } }])
  return out
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const appRoot = process.argv[2] || new URL('../web/app/', import.meta.url).pathname
  process.stdout.write(JSON.stringify(await recordCallSites(appRoot), null, 2) + '\n')
}
