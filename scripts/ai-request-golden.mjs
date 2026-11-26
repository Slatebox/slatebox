// Records what the board and canvas model call sites send to req(): lane chat and map chat
// (workshops.js chatTurn), board drafting (workshops.js draftWorkshop), the canvas conversation and
// the Slatebox agent (canvas-conversation.js modelFor). Each recording is the request with its
// system text, prompts, tool schemas and forced call, plus the retry prompts its response check
// gives for a wrong answer. scripts/ai-request-golden.test.mjs compares them with goldens captured
// from the code before the surface catalogue (scripts/fixtures/ai-request/call-sites.golden.json).
//
//   node scripts/ai-request-golden.mjs [webAppRoot]   prints the recordings as JSON
//   node scripts/ai-request-golden.mjs --prompts [webAppRoot]   every call site whose prompts AI
//     control serves (spec S5): the above with retry prompts for every branch, plus custom shapes,
//     the canvas conversation's exec chat (system, fix-it prompt), the Slatebox agent's request
//     envelope, presentation planning (each intention, a template, a brief, a refinement, a
//     conversation's kept system text) and the library refine turn. Compared byte for byte with
//     scripts/fixtures/ai-request/prompt-sites.golden.json (captured from 4ffde9cf, before the
//     prompts moved to server/ai-control/prompts).
//   node scripts/ai-request-golden.mjs --used [webAppRoot]   the prompt ids those sites asked the
//     registry for (every prompt in it should be one of them)
// One app root per process: the module hooks are registered once.
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

const TARGETS = ['server/methods/workshops.js', 'server/methods/canvas-conversation.js', 'server/methods/presentations.js']

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

// What req() answers every call: { abort: true } for the goldens, or what a part an administrator
// turned off answers (--disabled), to see which words reach the person.
const OFF = { abort: true, abortMessage: 'Board chat is off for maintenance until noon.', fallbackBlocked: true, disabled: true, failure: 'stop' }
let answer = { abort: true }
// What the up-front check (ai-settings surfaceOffFor) says: null (on) for the goldens, or a part an
// administrator turned off (--off-first), to see that it is said before any lock or request.
const OFF_FIRST = 'Drawing chat is paused by the admin for a test.'
let offState = null

export async function recordCallSites(appRoot, { disabled = false, offFirst = false, prompts: promptSites = false, used = false } = {}) {
  if (disabled) answer = OFF
  if (offFirst) offState = { surface: 'canvas', message: OFF_FIRST }
  const root = appRoot.replace(/\/+$/, '') + '/'
  // The pure modules the prompt sites run, loaded before the hooks: real code, real engine.
  const pure = promptSites ? await loadPure(root) : null
  // --used: which prompts of the registry (server/ai-control/prompts) the sites asked for
  const asked = new Set()
  if (used) {
    const { prompts: registry } = await import(pathToFileURL(root + 'server/ai-control/prompts/index.mjs').href)
    registry.setSource((id) => { asked.add(id); return null })
  }
  register(new URL('./ai-request-golden-hooks.mjs', import.meta.url), { data: { appRoot: root, targets: TARGETS } })

  const calls = []
  const locks = []
  const offAsked = []
  let board = LANES
  class MeteorError extends Error {
    constructor(error, reason) { super(reason || error); this.error = error; this.reason = reason }
  }
  const methods = {}
  const Meteor = {
    methods: (defs) => Object.assign(methods, defs),
    userAsync: async () => ({ _id: 'ana', emails: [] }),
    userId: () => 'ana',
    users: { updateAsync: async (selector, modifier) => { locks.push(Object.keys(modifier?.$set || modifier?.$unset || {})); return 1 }, findOneAsync: async () => ({ _id: 'ana' }) },
    settings: { public: {} },
    Error: MeteorError,
    isServer: true,
    startup: () => {},
    callAsync: async () => ({ canGenerate: true }),
  }
  const stubs = {
    'meteor/meteor': { Meteor },
    'server/methods/ai/req': { default: async (opts) => { calls.push(opts); return { ...answer } } },
    'server/metering/context.mjs': { runAIAction: (_opts, fn) => fn() },
    'server/metering/context': { runAIAction: (_opts, fn) => fn() },
    'server/metering/meteor': { canStartAI: async () => true, aiRefusal: async () => null },
    'server/methods/ai/ai-settings': { surfaceOffFor: async (query) => { offAsked.push(query); return offState } },
    'server/methods/creative-slates': {
      resolveCreativeSlate: async () => ({ canEdit: true, slateBase: { _id: 'slate1', options: {}, nodes: [], creative: { revision: 3, model: { kind: 'workshop', workshop: board } } } }),
      // a plain drawing the person can edit (canvasConversation.preview, --off-first)
      resolvePresentationSlate: async () => (offFirst ? { canEdit: true, slateBase: { _id: 'slate1', options: {}, nodes: [] } } : null),
    },
  }
  if (promptSites) Object.assign(stubs, presentationStubs(Meteor))
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
  if (offFirst) {
    // the error each method gives, and what it did before saying it: locks taken, requests sent
    const said = async (fn) => {
      const before = { locks: locks.length, calls: calls.length }
      try { await fn(); return { said: null } } catch (error) {
        return { error: error.error ?? null, said: error.reason || error.message, locks: locks.slice(before.locks), requests: calls.length - before.calls }
      }
    }
    const self = { userId: 'ana', connection: { id: 'conn1' } }
    return {
      draft: await said(() => methods['workshops.draft']('Choose a venue for the spring party with the team', 'lanes')),
      canvas: await said(() => methods['canvasConversation.preview'].call(self, 'share1', 'Suggest three names for a team retrospective board.', [], null)),
      asked: offAsked,
      expected: OFF_FIRST,
    }
  }
  if (disabled) {
    // the words each call site gives the person when req() says the part is off
    const said = async (fn) => { try { const out = await fn(); return out?.message ?? null } catch (error) { return error.reason || error.message } }
    const tool = { name: 'exec', description: 'Run code', parameters: { type: 'object', properties: { code: { type: 'string' } } } }
    const prompts = [{ role: 'user', content: 'draw three notes' }]
    board = LANES
    return {
      laneChat: await said(() => methods['workshops.laneChat']({ shareId: 'share1', revision: 3, message: 'move the barn', history: [] })),
      draft: await said(() => methods['workshops.draft']('Choose a venue for the spring party with the team', 'lanes')),
      canvas: await said(() => modelFor('share1')({ system: 'canvas system', prompts, tool })),
      agent: await said(() => modelFor(null, 'agent')({ system: 'agent system', prompts, tool })),
      expected: OFF.abortMessage,
    }
  }

  const out = {}
  if (promptSites) {
    // every branch of the board chat's retry prompt: a wrong tool, an empty reply, and a change the
    // board refuses in its own words
    const laneAnswers = [...wrongTool, { toolCall: { name: 'propose_workshop_edits', arguments: { reply: 'ok', commands: ['move @nowhere to @shortlist'] } } }]
    const mapAnswers = [...wrongTool, { toolCall: { name: 'propose_map_edits', arguments: { reply: 'ok', edits: [{ type: 'moveToken', id: 'walker', to: 'station-9' }] } } }]
    board = LANES
    await quiet(() => methods['workshops.laneChat']({ shareId: 'share1', revision: 3, message: 'move the barn to the shortlist', history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }] }))
    out.laneChat = shape(last(), laneAnswers)
    board = MAP
    await quiet(() => methods['workshops.mapChat']({ shareId: 'share1', revision: 3, message: 'add a station after the summit', history: [] }))
    out.mapChat = shape(last(), mapAnswers)
    board = LANES
    for (const format of ['lanes', 'map', 'release-plan', 'component', 'grid']) {
      await quiet(() => methods['workshops.draft']('Choose a venue for the spring party with the team', format))
      out[`draft:${format}`] = shape(last(), [...wrongTool, { toolCall: { name: last().functions[0].name, arguments: {} } }])
    }
    await quiet(() => methods['workshops.draft']('Let the walker skip the start', 'map', MAP))
    out['draft:revision'] = shape(last(), [...wrongTool, { toolCall: { name: 'revise_workshop_rules', arguments: { changes: [] } } }])
    const execTool = { name: 'exec', description: 'Run code', parameters: { type: 'object', properties: { code: { type: 'string' } } } }
    await modelFor('share1')({ system: 'canvas system', prompts: [{ role: 'user', content: 'draw three notes' }], tool: execTool })
    out.canvas = shape(last(), [{ toolCall: { name: 'exec', arguments: { code: '' } } }, { toolCall: null, message: { content: '' } }])
    Object.assign(out, await recordPure(pure))
    Object.assign(out, await recordPresentations(methods, calls))
    return used ? [...asked].sort() : out
  }
  board = LANES
  await quiet(() => methods['workshops.laneChat']({ shareId: 'share1', revision: 3, message: 'move the barn to the shortlist', history: [] }))
  out.laneChat = shape(last(), wrongTool)
  board = MAP
  await quiet(() => methods['workshops.mapChat']({ shareId: 'share1', revision: 3, message: 'add a station after the summit', history: [] }))
  out.mapChat = shape(last(), wrongTool)
  for (const format of ['lanes', 'map', 'release-plan', 'component']) {
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

// ---- the prompt sites outside Meteor files: loaded before the hooks, as they are ----------------
async function loadPure(root) {
  const at = (path) => import(pathToFileURL(root + path).href)
  const [shapes, execChat, teammate, refine, registry, render, translate, context, prompts] = await Promise.all([
    at('server/shapes/shape-core.mjs'), at('server/methods/ai/exec-chat.mjs'), at('server/agents/teammate.mjs'),
    at('server/library/refine-ai.mjs'), at('server/actions/index.mjs'), at('server/actions/client-render.mjs'),
    // invited agents (enterprise/, beside web/): the plan and layout prompts, with the registry's text
    at('../../enterprise/server/translate.mjs'), at('../../enterprise/server/context.mjs'), at('server/ai-control/prompts/index.mjs'),
  ])
  const manifest = render.buildClientManifest(registry.createAppRegistry())
  const exec = render.renderExecTool(manifest).exec
  return { shapes, execChat, teammate, refine, manifest, execTool: { name: exec.name, description: exec.description, parameters: exec.inputSchema }, translate, context, promptText: prompts.promptText }
}

const clone = (value) => JSON.parse(JSON.stringify(value))

async function recordPure({ shapes, execChat, teammate, refine, manifest, execTool, translate, context, promptText }) {
  const out = {}
  // custom shapes: the first ask, then the retry naming what was wrong and how many are missing
  const asked = []
  const square = { name: 'Square', d: 'M10 10 L90 10 L90 90 L10 90 Z', fillRule: 'nonzero' }
  const answers = [
    { json: { content: [{ type: 'tool_use', input: { shapes: [square, { name: 'Broken', d: 'not a path', fillRule: 'nonzero' }] } }] } },
    { abort: true },
  ]
  try {
    await shapes.generateShapes({ principal: { userId: 'ana' }, describe: 'a cloud with a hole', count: 3 }, {
      request: async (opts) => { asked.push(clone(opts)); return answers[asked.length - 1] || { abort: true } },
      run: (fn) => fn(), newId: () => 'id', now: () => new Date(0),
    })
  } catch {}
  out['shape:first'] = asked[0]
  out['shape:retry'] = asked[1]

  // the canvas conversation (and the Slatebox agent, which drafts through it): system, request, fix-it turn
  const turns = []
  const board = { nodes: [{ options: { id: 'n1', text: 'Plan the launch', xPos: 0, yPos: 0, width: 120, height: 60 } }, { options: { id: 'n2', text: 'Book the hall', xPos: 200, yPos: 0, width: 120, height: 60 } }] }
  try {
    await execChat.execChat({
      model: async (req) => { turns.push(clone(req)); return { toolCall: { name: 'exec', arguments: { intent: 'add notes', code: 'await slatebox.slates.get({shareId:"s1"})' } } } },
      manifest, tool: execTool, shareId: 's1', board, message: 'add three ideas beside the plan',
      history: [{ message: 'hello', reply: 'hi there' }], selection: { kind: 'notes', ids: ['n1'] },
      run: async () => ({ status: 'failed', error: { code: 'invalid_request', message: 'expectedRevision is required', line: 2 }, calls: [] }),
    })
  } catch {}
  out['exec:first'] = turns[0]
  out['exec:fix'] = turns[1]
  const noChange = []
  try {
    await execChat.execChat({
      model: async (req) => { noChange.push(clone(req)); return { toolCall: { name: 'exec', arguments: { code: 'return 1' } } } },
      manifest, tool: execTool, shareId: 's1', board, message: 'tidy it', history: [], attempts: 2,
      run: async () => ({ status: 'completed', context: { writes: [] }, calls: [] }),
    })
  } catch {}
  out['exec:noChange'] = noChange[1]

  // the Slatebox agent's request: the task alone, and with notes from other agents as data
  const task = { text: 'Add a note\nnamed "Budget"', log: [{ kind: 'handoff', by: 'Linear agent', text: 'Ticket ABC-12 says\n50 people' }, { kind: 'note', by: 'Ana', text: 'Keep it short' }, { kind: 'status', by: 'x', text: 'ignored' }] }
  out['agent:request'] = teammate.requestText(task, false)
  out['agent:requestWithNotes'] = teammate.requestText(task, true)

  // the library refine turn: a smart component with a board, a locked category, and a slate
  const refined = []
  const ask = refine.createRefineAI({ request: async (opts) => { refined.push(opts); return { abort: true } } })
  const lanes = { version: 1, title: 'Pick a venue', lanes: [{ id: 'ideas', label: 'Ideas' }, { id: 'shortlist', label: 'Shortlist', capacity: 2 }],
    cards: [{ id: 'hall', label: 'Town hall', laneId: 'ideas' }, { id: 'barn', label: 'Old barn', laneId: 'ideas' }] }
  const component = { kind: 'component', title: 'Venue picker', summary: 'Pick a venue', description: 'Lanes for venues', category: 'decide', synonyms: ['venue'], authorName: 'Ana' }
  for (const [name, item, withBoard] of [
    ['library:component', component, true],
    ['library:locked', { ...component, categoryLocked: true }, true],
    ['library:slate', { kind: 'slate', title: 'Retro', summary: 'A retro', synonyms: [], authorName: 'Bo' }, false],
  ]) {
    try {
      await ask({ item, board: withBoard ? lanes : null, message: 'Tighten the rules', history: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }], principal: { userId: 'ana' } })
    } catch {}
    const opts = refined.at(-1)
    // with the retry prompt its check gives a wrong answer
    out[name] = { request: clone(opts), retries: clone([opts.validateResponse({ toolCall: null }), opts.validateResponse({ toolCall: { name: 'propose_library_refinement', arguments: { reply: 'Fine' } } })]) }
  }
  Object.assign(out, recordConnectors({ translate, context, promptText }))
  return out
}

// ---- invited agents (enterprise/server/translate.mjs): the plan and layout turns ---------------
function recordConnectors({ translate, context, promptText }) {
  const out = {}
  const slate = { nodes: [
    { options: { id: 'n1', text: 'Checkout service', xPos: 0, yPos: 0, width: 200, height: 90 }, relationships: { associations: [{ id: 'l1', parentId: 'n1', childId: 'n2' }] } },
    { options: { id: 'n2', text: 'Retry declined cards', xPos: 300, yPos: 0, width: 200, height: 90 } },
  ] }
  const packed = context.packContext({ slate, level: 'selection', selection: ['n1', 'n2'], request: 'what are my latest commits? make a couple notes', viewerId: 'ana' })
  const tools = [
    { name: 'get_me', description: 'Get details of the authenticated GitHub user.', inputSchema: { type: 'object', properties: {} } },
    { name: 'list_commits', description: 'Get list of commits of a branch in a GitHub repository.', inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, author: { type: 'string' }, perPage: { type: 'number' } }, required: ['owner', 'repo'] } },
  ]
  const result = (text, links = []) => ({ isError: false, text, links, structured: null, left: [] })
  const entries = [
    { tool: 'get_me', args: {}, result: result('{"login":"ana"}') },
    { tool: 'list_commits', args: { owner: 'ana', repo: 'shop', author: 'ana', perPage: 5 }, result: result('abc1234 Fix retry on declined cards', [{ url: 'https://github.com/ana/shop/commit/abc1234', host: 'github.com', title: 'abc1234' }]) },
  ]
  const tool = (t) => clone({ name: t.name, description: t.description, parameters: t.parameters })
  const planTool = translate.planTool ? translate.planTool(promptText) : translate.PLAN_TOOL
  const layoutTool = translate.layoutTool ? translate.layoutTool(promptText) : translate.LAYOUT_TOOL
  out['connectors:plan'] = { ...clone(translate.planPrompt({ serverName: 'GitHub', tools, packed, text: promptText })), tool: tool(planTool) }
  out['connectors:planNext'] = clone(translate.planPrompt({ serverName: 'GitHub', tools, packed, previous: entries, text: promptText }))
  out['connectors:layout'] = { ...clone(translate.translatePrompt({ serverName: 'GitHub', packed, entries, text: promptText })), tool: tool(layoutTool) }
  // pass 2: the number of notes asked for, a follow-up's earlier turns, and each gallery agent's hint
  if (translate.recipeHint) {
    const history = [{ message: 'hey', reply: 'Hi, I am GitHub.' }]
    out['connectors:layoutBudget'] = clone(translate.translatePrompt({ serverName: 'GitHub', packed, entries, text: promptText, budget: { notes: 3, lines: 2 }, history }))
    out['connectors:layoutOneNote'] = clone(translate.translatePrompt({ serverName: 'GitHub', packed, entries, text: promptText, budget: { notes: 1 } }))
    for (const id of ['github', 'linear', 'huggingface', 'deepwiki', 'context7', 'wolfram', 'firecrawl', 'exa'])
      out['connectors:plan:' + id] = clone(translate.planPrompt({ serverName: 'Agent', tools, packed, text: promptText, calls: 2, history, hint: translate.recipeHint({ galleryId: id, serverName: 'Agent', text: promptText }) }))
  }
  // pass 3 (agents read and write): the change planner, with a change tool and the Linear hint
  if (translate.writePlanPrompt) {
    const writes = [{ name: 'create_issue', description: 'Creates an issue in a team.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, team: { type: 'string' } }, required: ['title', 'team'] } }]
    const asked = context.packContext({ slate, level: 'selection', selection: ['n2'], request: 'file the retry bug', viewerId: 'ana' })
    out['connectors:planWrites'] = { ...clone(translate.writePlanPrompt({ serverName: 'Linear', tools: writes, packed: asked, text: promptText, calls: 2, hint: translate.recipeHint({ galleryId: 'linear', serverName: 'Linear', text: promptText }) })), tool: tool(planTool) }
  }
  return out
}

// ---- presentation planning (presentations.js): its prompts as req() receives them -------------
const LAYOUT = { nodes: [
  { nodeId: 'n1', description: 'Launch plan', metrics: { rotation: 0, bbox: { x: 0, y: 0, width: 200, height: 80 } }, childrenNodes: [
    { nodeId: 'n2', description: 'Book the hall', metrics: { rotation: 0, bbox: { x: 260, y: 0, width: 160, height: 60 } }, childrenNodes: [] },
    { nodeId: 'n3', description: 'Invite 50 people', metrics: { rotation: 5, bbox: { x: 260, y: 120, width: 160, height: 60 } }, childrenNodes: [] },
  ] },
  { nodeId: 'n4', description: 'Budget: $2,000', metrics: { rotation: 0, bbox: { x: 0, y: 200, width: 160, height: 60 } }, childrenNodes: [] },
] }
const presentationState = { conversation: [] }

function pathProxy(path) {
  const fn = function () { return path }
  return new Proxy(fn, {
    get: (_t, prop) => (prop === Symbol.toPrimitive ? () => path : prop === 'toString' ? () => path : prop === 'then' ? undefined : pathProxy(path ? `${path}.${String(prop)}` : String(prop))),
  })
}

function presentationStubs(Meteor) {
  const slate = { _id: 'slate1', shareId: 'share1', userId: 'ana', options: { name: 'Spring launch' },
    nodes: LAYOUT.nodes.flatMap(function flat(node) { const b = node.metrics.bbox; return [{ options: { id: node.nodeId, text: node.description, xPos: b.x, yPos: b.y, width: b.width, height: b.height } }, ...node.childrenNodes.flatMap(flat)] }) }
  const cursor = (rows) => ({ fetchAsync: async () => rows, toArray: async () => rows })
  const models = {
    Slates: { findOneAsync: async () => slate },
    SlatePresentations: { findOneAsync: async () => null, find: () => cursor([]), updateAsync: async () => 1, insertAsync: async () => 'p1' },
    SlatePresentationConversations: { find: () => cursor(presentationState.conversation), removeAsync: async () => 0, insertAsync: async () => 'c1', rawCollection: () => ({ insertMany: async () => ({}) }) },
    OrganizationSettings: { findOneAsync: async () => null },
  }
  Meteor.users.findOneAsync = async () => ({ _id: 'ana', profile: { firstName: 'Ana' } })
  return {
    'imports/api/common/models': new Proxy(models, { get: (t, p) => (p in t ? t[p] : anything()) }),
    'imports/api/common/constants': { default: { methods: pathProxy('') } },
    'server/common/slate-access': { canEditSlate: async () => true },
    'server/methods/ai/ai-settings': { surfaceOffFor: async () => null, resolveRequestConnection: async () => null },
    'server/metering/context.mjs': { runAIAction: (_opts, fn) => fn(), keepActionOpen: () => {} },
    'meteor/check': { check: () => {}, Match: anything() },
  }
}

async function recordPresentations(methods, calls) {
  const out = {}
  const { createPresentationFor } = await import(pathToFileURL(TARGET_ROOT + 'server/methods/presentations.js').href)
  const analyze = methods['presentations.analyze']
  const presentationData = JSON.stringify(LAYOUT)
  // the plan's time limit is a clock reading: kept as whether it was set
  const timeless = (opts) => ({ ...opts, deadline: typeof opts.deadline === 'number', timeoutMs: typeof opts.timeoutMs === 'number' })
  const plan = async (name, args) => {
    const before = calls.length
    try { await analyze({ presentationData, ...args }) } catch (e) { if (process.env.GOLDEN_DEBUG) console.error(name, e) }
    out[name] = calls.length > before ? clone(timeless(calls.at(-1))) : { sent: null }
  }
  await plan('presentation:art', { slate: { shareId: 'share1', name: 'Spring launch' } })
  await plan('presentation:dynamic', { slate: { shareId: 'share1', name: 'Spring launch', intentionId: 'dynamic' } })
  await plan('presentation:slideDeck', { slate: { shareId: 'share1', name: 'Spring launch', intentionId: 'slideDeck' } })
  await plan('presentation:template', { slate: { shareId: 'share1', name: 'Spring launch', isTemplate: true } })
  presentationState.conversation = [
    { systemPrompt: 'The system text this conversation was planned with.' },
    { prompt: { role: 'user', content: [{ type: 'text', text: 'an earlier request' }] } },
    { prompt: { role: 'assistant', content: 'an earlier plan' } },
  ]
  await plan('presentation:refine', { slate: { shareId: 'share1', name: 'Spring launch' }, refinementMessage: 'Make it four segments', slateChanged: true })
  await plan('presentation:refineSame', { slate: { shareId: 'share1', name: 'Spring launch' }, refinementMessage: 'Shorter captions' })
  presentationState.conversation = []
  const before = calls.length
  try { await createPresentationFor({ userId: 'ana', shareId: 'share1', brief: 'Focus on the budget "and" the guests', preview: true }) } catch {}
  out['presentation:brief'] = calls.length > before ? clone(timeless(calls.at(-1))) : { sent: null }
  return out
}

let TARGET_ROOT = ''

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const disabled = args.includes('--disabled')
  const offFirst = args.includes('--off-first')
  const prompts = args.includes('--prompts') || args.includes('--used')
  const used = args.includes('--used')
  const appRoot = args.find((a) => !a.startsWith('--')) || new URL('../web/app/', import.meta.url).pathname
  TARGET_ROOT = appRoot.replace(/\/+$/, '') + '/'
  process.stdout.write(JSON.stringify(await recordCallSites(appRoot, { disabled, offFirst, prompts, used }), null, 2) + '\n')
}
