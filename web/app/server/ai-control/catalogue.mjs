// The surface catalogue: every place Slatebox asks a model or exposes an agent, in one list.
// A surface has a stable id (never renamed, only archived), a plain-English title, and `follows`:
// whose choice applies while nothing is set for it. Everything else that names AI features is
// derived from this list: the parts an administrator binds to a model (bindings.mjs), the features
// people choose for their own AI (connections.mjs AI_FEATURES, USE_KEYS), the request features each
// call site sends to req(), and the meter's estimates and ceilings (metering/prices.mjs). A new
// surface is one row here.
//
// Row fields:
//   id              slug, ^[a-z0-9][a-z0-9.-]{0,47}$ (a dot marks a part of a parent surface)
//   title           plain English, sentence case
//   follows         the surface whose choice applies while this one is unset; null for the root
//   needs           what a model must do for it: tools | vision | images | voice (talks in real time:
//                   only a realtime provider's models, server/voice; a voice part never falls back
//                   to a text model, and a text part never to a voice model)
//   requestFeatures the `feature` names call sites pass to req() for it
//   meterFeatures   the `feature` names runAIAction meters it under; estimate and ceiling (µ$) apply
//                   to each of them
//   builtinOnly     served by a built-in service, never a model choice (image search)
//   useKey          false: not a choice people make (admin test runs name their model per call)
//   bindable        an administrator binds it to a model in AI control (default: when people choose it too);
//                   true with useKey false: an administrator's choice only (the eval judge)
//   ownRow          true: a row of its own on the AI settings page although it follows another
//                   surface (library follows chat but people choose it on the first row too)
//   branch          the surface ships on that branch; until it lands it is "Not in this build"
//   edition         'cloud' when only Slatebox Cloud has it
// Pure data and functions: no Meteor, so the node tests, exec and the browser can all read it.

const ID = /^[a-z0-9][a-z0-9.-]{0,47}$/
const NEEDS = ['tools', 'vision', 'images', 'voice']

function defineSurfaces(rows) {
  const byId = new Map()
  const requestOwner = new Map()
  const meterOwner = new Map()
  for (const row of rows) {
    if (!ID.test(row.id || '')) throw new Error(`ai-control catalogue: bad surface id ${row.id}`)
    if (byId.has(row.id)) throw new Error(`ai-control catalogue: ${row.id} is listed twice`)
    if (typeof row.title !== 'string' || !row.title) throw new Error(`ai-control catalogue: ${row.id} has no title`)
    if (row.follows != null && !byId.has(row.follows)) throw new Error(`ai-control catalogue: ${row.id} follows ${row.follows}, which is not listed above it`)
    if (row.ownRow && (row.follows == null || row.follows === 'default')) throw new Error(`ai-control catalogue: ${row.id} has its own row only when it follows a surface other than default`)
    if (row.builtinOnly && row.follows != null) throw new Error(`ai-control catalogue: built-in-only ${row.id} follows nothing`)
    for (const need of row.needs || []) if (!NEEDS.includes(need)) throw new Error(`ai-control catalogue: ${row.id} needs ${need}`)
    if ((row.needs || []).includes('voice') && row.needs.length !== 1) throw new Error(`ai-control catalogue: voice part ${row.id} needs voice only (its tool runs through the surface's own text path)`)
    const parent = row.follows != null ? byId.get(row.follows) : null
    if (parent && parent.id !== 'default' && parent.needs.includes('voice') !== (row.needs || []).includes('voice')) throw new Error(`ai-control catalogue: ${row.id} and ${parent.id} must both talk or both not`)
    for (const feature of row.requestFeatures || []) {
      if (requestOwner.has(feature)) throw new Error(`ai-control catalogue: request feature ${feature} belongs to ${requestOwner.get(feature)} and ${row.id}`)
      requestOwner.set(feature, row.id)
    }
    for (const feature of row.meterFeatures || []) {
      if (meterOwner.has(feature)) throw new Error(`ai-control catalogue: meter feature ${feature} belongs to ${meterOwner.get(feature)} and ${row.id}`)
      meterOwner.set(feature, row.id)
    }
    const surface = Object.freeze({
      id: row.id,
      title: row.title,
      follows: row.follows ?? null,
      needs: Object.freeze([...(row.needs || [])]),
      requestFeatures: Object.freeze([...(row.requestFeatures || [])]),
      meterFeatures: Object.freeze([...(row.meterFeatures || [])]),
      estimate: row.estimate ?? null,
      ceiling: row.ceiling ?? null,
      builtinOnly: Boolean(row.builtinOnly),
      useKey: row.useKey !== false && !row.builtinOnly,
      bindable: row.bindable ?? (row.useKey !== false && !row.builtinOnly),
      ownRow: Boolean(row.ownRow),
      branch: row.branch ?? null,
      edition: row.edition ?? null,
      inBuild: !row.branch,
    })
    byId.set(surface.id, surface)
  }
  return Object.freeze([...byId.values()])
}

// Order matters only for display: the rows that follow `default` are the features people choose
// first, in this order (Conversation and edits, Drafts and layouts, ...).
export const SURFACES = defineSurfaces([
  { id: 'default', title: 'Everything not set below', follows: null },
  { id: 'chat', title: 'Conversation and edits', follows: 'default', needs: ['tools'], requestFeatures: ['welcome', 'chat'], meterFeatures: ['welcome'], estimate: 2000, ceiling: 50000 },
  { id: 'chat.route', title: 'Deciding whether a message is an edit or a question', follows: 'chat', needs: ['tools'], requestFeatures: ['welcome-route'] },
  { id: 'generation', title: 'Drafts and layouts', follows: 'default', needs: ['tools'], requestFeatures: ['generation', 'layout'], meterFeatures: ['generation'], estimate: 30000, ceiling: 200000 },
  // Its own request feature arrives with the server-side ad-hoc prompts; until then it follows Drafting.
  { id: 'generation.notes', title: 'Rewriting, shortening and expanding a note', follows: 'generation', needs: [] },
  { id: 'presentation', title: 'Presentation planning', follows: 'default', needs: ['tools'], requestFeatures: ['presentation'], meterFeatures: ['presentation'], estimate: 10000, ceiling: 200000 },
  { id: 'vision', title: 'Reading images and diagrams', follows: 'default', needs: ['vision'], requestFeatures: ['vision'], meterFeatures: ['vision'], ceiling: 200000 },
  { id: 'images', title: 'Generating images', follows: 'default', needs: ['images'], requestFeatures: ['image-generation', 'images'], meterFeatures: ['image-generation'], estimate: 30000 },
  { id: 'images.search', title: 'Finding pictures on the web', builtinOnly: true, requestFeatures: ['image-search'], meterFeatures: ['image-search'], estimate: 5000 },
  { id: 'shape', title: 'Drawing custom shapes', follows: 'default', needs: ['tools'], requestFeatures: ['shape'], meterFeatures: ['shape'], estimate: 8000, ceiling: 60000 },
  { id: 'workshop', title: 'Lane and map board conversation', follows: 'chat', needs: ['tools'], requestFeatures: ['lane-chat', 'map-chat'], meterFeatures: ['lane-chat', 'map-chat'], estimate: 3000, ceiling: 50000 },
  // Board drafting owns the `workshop` meter key; the canvas conversation and the agent meter under it too. A For you
  // build (workshops.js draftForYou) is a board draft on this surface metered under `personal.build`, a key of its own
  // so the personalization allowance (metering/allowance.mjs) can pay for it without paying for every board draft;
  // it has this row's estimate and ceiling (5,000 µ$, and the meter's default 50,000 µ$).
  { id: 'workshop.draft', title: 'Drafting a new board or its rules', follows: 'workshop', needs: ['tools'], requestFeatures: ['workshop'], meterFeatures: ['workshop', 'personal.build'], estimate: 5000 },
  { id: 'canvas', title: 'Canvas conversation (drawing chat)', follows: 'chat', needs: ['tools'], requestFeatures: ['canvas'] },
  { id: 'agent.slatebox', title: 'The Slatebox agent (tasks, ask_agent, @mentions)', follows: 'canvas', needs: ['tools'], requestFeatures: ['agent'] },
  // Library refinement (server/library/refine-ai.mjs) has a row on the settings page of its own;
  // unset, it follows the conversation.
  // Library and connectors meter as they did when they landed: no estimate or ceiling of their own, so
  // the meter's workshop estimate and default ceiling apply (5,000 and 50,000 µ$).
  { id: 'library', title: 'Library review and refinement', follows: 'chat', ownRow: true, needs: ['tools'], requestFeatures: ['library-refine'], meterFeatures: ['library-refine'] },
  { id: 'connectors', title: 'Outside agents: planning and laying out results', follows: 'chat', needs: ['tools'], requestFeatures: ['connectors'], meterFeatures: ['connectors'] },
  // The interview (About you): the agent asks about the person's work, one question a turn, and proposes facts
  // with its remember tool for the person to keep. A conversation turn, metered as one (chat's estimate and ceiling).
  { id: 'interview', title: 'Getting to know you (the interview)', follows: 'chat', needs: ['tools'], requestFeatures: ['interview'], meterFeatures: ['interview'], estimate: 2000, ceiling: 50000 },
  // For you (server/personal): from what the person keeps in About you and the names of the tools they connected, the
  // agent suggests 3 to 6 smart components and printable pages made for their work. One forced tool call (and at most
  // one retry), metered under its own key; building one is board drafting (workshop.draft, metered under 'personal.build').
  // Both are part of the personalization allowance (metering/allowance.mjs PERSONAL_FEATURES).
  { id: 'personal.suggest', title: 'Ideas made for you (For you)', follows: 'chat', needs: ['tools'], requestFeatures: ['personal.suggest'], meterFeatures: ['personal.suggest'], estimate: 3000, ceiling: 50000 },
  // Learning from a connected tool (About you › "Use <tool> to personalize", S3): one call turns a small, quarantined
  // sample of the tool into a few proposed facts with its propose_facts tool. One call, metered as a conversation turn.
  { id: 'profile.sources', title: 'Learning from your tools (About you)', follows: 'chat', needs: ['tools'], requestFeatures: ['profile.sources'], meterFeatures: ['profile.sources'], estimate: 2000, ceiling: 50000 },
  // Voice: talking with the agent in real time, full duplex (server/voice: the browser holds one
  // socket to this server, the server holds the provider's). One binding (voice) covers every voice
  // part, and each part can be bound on its own. The realtime model has one tool, send_to_slatebox,
  // which the browser runs through the part's own text path (Preview and Keep, the meter and the
  // audit trail stay that path's), so a voice part needs only voice. Metered per minute under its
  // own feature (server/voice/meter.mjs): the estimate is what one minute is held for, the ceiling
  // the most one minute may spend.
  { id: 'voice', title: 'Talking with the agent (voice)', follows: 'default', needs: ['voice'], requestFeatures: ['voice'], meterFeatures: ['voice'], estimate: 50000, ceiling: 200000 },
  { id: 'voice.chat', title: 'Voice: Ask Slatebox on slates and boards', follows: 'voice', needs: ['voice'], requestFeatures: ['voice-chat'], meterFeatures: ['voice-chat'], estimate: 50000, ceiling: 200000 },
  { id: 'voice.interview', title: 'Voice: getting to know you (the interview)', follows: 'voice', needs: ['voice'], requestFeatures: ['voice-interview'], meterFeatures: ['voice-interview'], estimate: 50000, ceiling: 200000 },
  // Prompt test runs and eval gates name their model per call; the row keeps them out of `chat`.
  { id: 'admin.test', title: 'Admin test runs', follows: null, useKey: false, estimate: 30000, ceiling: 200000 },
  // The judge of the live evals (scripts/evals): an administrator's choice only, never a person's, so a model other
  // than the one that drafted can grade the drafts. Unset, it falls to the default, which may be the drafter's.
  { id: 'eval', title: 'Grading eval runs (the judge)', follows: null, useKey: false, bindable: true, requestFeatures: ['eval'] },
])

const BY_ID = new Map(SURFACES.map((s) => [s.id, s]))
export const SURFACE_IDS = Object.freeze(SURFACES.map((s) => s.id))
export const surface = (id) => BY_ID.get(id) || null
/** Whether a surface talks (needs a realtime voice model). */
export const isVoiceSurface = (id) => Boolean(BY_ID.get(id)?.needs.includes('voice'))
/** The voice parts people open a voice session for (voice.open): every voice surface but the root. */
export const VOICE_SURFACES = Object.freeze(SURFACES.filter((s) => s.needs.includes('voice') && s.follows !== 'default').map((s) => s.id))

// Paths that are not a model at all: video calls are metered under `call` but never reach req().
const NOT_AI_FEATURES = Object.freeze(['call'])
export const BUILTIN_ONLY_FEATURES = Object.freeze([
  ...SURFACES.filter((s) => s.builtinOnly).flatMap((s) => s.requestFeatures), ...NOT_AI_FEATURES,
])

// request feature -> surface id (every row in this build and on branches: a request feature that
// reaches this server names its surface whether or not the surface's admin row is ready)
export const REQUEST_FEATURES = Object.freeze(Object.fromEntries(
  SURFACES.filter((s) => !s.builtinOnly).flatMap((s) => s.requestFeatures.map((f) => [f, s.id])),
))

// The surfaces a person's or team's own `use` object may name (the original keys default, chat,
// generation, presentation, vision, images and shape are rows here).
export const USE_SURFACES = Object.freeze(SURFACES.filter((s) => s.useKey))

/** The surface itself, its parent, and so on up to the root (`default`). */
export function followChain(id) {
  const out = []
  for (let at = surface(id); at && !out.includes(at.id); at = surface(at.follows)) out.push(at.id)
  return out
}

/**
 * The feature people choose for a surface on the first row of their AI settings: the surface that
 * follows `default` directly (workshop -> chat, agent.slatebox -> chat, generation.notes ->
 * generation), or the nearest one with a row of its own (library). The root and surfaces outside
 * the tree are their own.
 */
export function rootSurface(id) {
  const chain = followChain(id)
  const i = chain.indexOf('default')
  if (i <= 0) return chain[0] ?? id
  const own = chain.slice(0, i).find((at) => surface(at).ownRow)
  return own ?? chain[i - 1]
}

const warned = new Set()
function warnOnce(name, text) {
  if (warned.has(name)) return
  warned.add(name)
  console.warn(text)
}

/**
 * The surface a request feature belongs to, or null for a path that is not a model choice (image
 * search, video calls). A router step (<feature>-route) belongs to its feature's surface unless it
 * has a row of its own (welcome-route -> chat.route). A feature no row names follows the
 * conversation choice, never the built-in AI behind the person's back, and is logged once.
 */
export function surfaceForRequest(feature) {
  if (BUILTIN_ONLY_FEATURES.includes(feature)) return null
  if (Object.hasOwn(REQUEST_FEATURES, feature)) return REQUEST_FEATURES[feature]
  if (typeof feature === 'string' && feature.endsWith('-route')) return surfaceForRequest(feature.slice(0, -'-route'.length))
  if (typeof feature === 'string' && feature !== 'default' && BY_ID.has(feature) && !BY_ID.get(feature).builtinOnly) return feature
  warnOnce(feature, `ai-control: unknown surface ${String(feature).slice(0, 60)}; it follows chat`)
  return 'chat'
}

/** The meter's pre-check estimate (µ$) by meter feature, from the rows in this build. */
export const METER_ESTIMATES = Object.freeze(Object.fromEntries(
  SURFACES.filter((s) => s.inBuild && s.estimate != null).flatMap((s) => s.meterFeatures.map((f) => [f, s.estimate])),
))
/** The most one request may spend (µ$) by meter feature, from the rows in this build that set one. */
export const METER_CEILINGS = Object.freeze(Object.fromEntries(
  SURFACES.filter((s) => s.inBuild && s.ceiling != null).flatMap((s) => s.meterFeatures.map((f) => [f, s.ceiling])),
))
