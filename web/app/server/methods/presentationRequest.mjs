// What presentations.analyze does with a request before and around the AI, kept pure so it can be
// tested: the presenter's layout is cut down to what a plan needs and capped (the server's work
// and the prompt's size stay bounded, whatever a caller sends), the prompt is built from that,
// its cost is estimated before it is sent, and a plan the AI could not make is a failure the
// meter gives back, with the grouped automatic plan in its place.
import buildFallbackPresentation from '../../imports/ui/components/presentations/buildFallbackPresentation.mjs'
import {
  isTrivialLayout, normalizePresentationPlan, planFailureReason, planHints, PLAN_VERSION,
} from '../../imports/ui/components/presentations/presentationPlan.mjs'
import { refusalOf } from '../metering/refusal-pay.mjs'

/** The most notes a slate may have for the AI to plan it. A larger slate gets the automatic plan. */
export const MAX_PLAN_NOTES = 300
/** The most of a note's text the AI is sent. */
export const MAX_NOTE_TEXT = 140
/** The largest layout payload the server reads (characters of JSON). */
export const MAX_LAYOUT_CHARS = 1_500_000
/** The longest refinement request the AI is sent. */
export const MAX_REFINEMENT_CHARS = 4000
/** What the presenter says on a slate with no notes. */
export const EMPTY_SLATE = 'There are no notes on this slate to present yet.'
export const TOO_MANY_NOTES = `This slate has more than ${MAX_PLAN_NOTES} notes, too many for Slatebox to plan.`
/**
 * The most tokens a plan comes back as: the estimate's output, and the request's cap (a plan is
 * segments of note ids and short narratives; it never needs more).
 */
export const PLAN_OUTPUT_TOKENS = 4000
/**
 * How long the server waits for a plan, every attempt included. Past it the person keeps the
 * local plan, the meter gives the plan back, and nothing more is sent (the presenter waits a
 * little longer, PLAN_TIMEOUT_MS in PresentSlate, so the server's answer reaches it).
 */
export const PLAN_TIME_LIMIT_MS = 17_000
export const PLAN_TOO_SLOW = 'Slatebox took too long to plan this slate.'

const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null)
const round = (value) => Math.round(value * 10) / 10

function cleanMetrics(metrics) {
  const bbox = metrics?.bbox
  const parts = bbox && [bbox.x, bbox.y, bbox.width, bbox.height].map(finite)
  return {
    rotation: finite(metrics?.rotation) ?? 0,
    bbox: parts && parts.every((part) => part !== null)
      ? { x: round(parts[0]), y: round(parts[1]), width: round(parts[2]), height: round(parts[3]) }
      : null,
  }
}

/**
 * The presenter's layout ({ nodes: [{ nodeId, description, metrics, childrenNodes }] }, as JSON or
 * an object), cut down to what a plan needs: each note once, its text shortened, its box, its
 * connections. Walked with a stack, so a deep chain cannot exhaust the server's stack, and
 * stopped past MAX_PLAN_NOTES. → { layout, count, tooMany } (layout null when there is nothing
 * to plan with: too many notes, a payload too large, bad JSON).
 */
export function sanitizeLayout(raw) {
  let data = raw
  if (typeof raw === 'string') {
    if (raw.length > MAX_LAYOUT_CHARS) return { layout: null, count: 0, tooMany: true }
    try {
      data = JSON.parse(raw)
    } catch {
      return { layout: null, count: 0, tooMany: false }
    }
  }
  if (!data || !Array.isArray(data.nodes)) return { layout: null, count: 0, tooMany: false }
  const seen = new Set()
  const root = { childrenNodes: [] }
  const stack = [...data.nodes].reverse().map((node) => ({ node, into: root.childrenNodes }))
  while (stack.length) {
    const { node, into } = stack.pop()
    if (!node || typeof node !== 'object' || node.nodeId == null || typeof node.nodeId === 'object') continue
    const id = String(node.nodeId).slice(0, 120)
    if (seen.has(id)) continue
    seen.add(id)
    if (seen.size > MAX_PLAN_NOTES) return { layout: null, count: seen.size, tooMany: true }
    const kept = {
      nodeId: id,
      description: typeof node.description === 'string' ? node.description.slice(0, MAX_NOTE_TEXT) : '',
      metrics: cleanMetrics(node.metrics),
      childrenNodes: [],
    }
    into.push(kept)
    const kids = Array.isArray(node.childrenNodes) ? node.childrenNodes : []
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push({ node: kids[i], into: kept.childrenNodes })
  }
  return { layout: { nodes: root.childrenNodes }, count: seen.size, tooMany: false }
}

const NARRATIVE_WORDS = 15

const SEGMENT_PROMPT = `You plan presentations of a slate, a canvas of notes. The presenter's camera moves from segment to segment: each segment frames a set of notes together and shows a short narrative line. The presenter opens and closes with the whole slate itself: you write only the opening and closing narratives, never their notes. You receive the notes as [id, text, x, y, width, height] (a seventh number is a rotation), the connections between them as [from, to], and suggested groups: notes that are connected or close to each other. Rules: 1) Plan meaningful segments, never one note at a time: a cluster of related notes, a branch, a lane or column, or a note with its connected neighbours. Start from the suggested groups, and merge or split them when the meaning calls for it. A segment usually has two to six notes; a single note only when it stands on its own. Use at most 24 segments. 2) Order the segments so the story flows: from the main idea to its parts, following the connections, otherwise in reading order (top to bottom, left to right). 3) Every note is in at least one segment. 4) The opening narrative says what the slate is about; the closing narrative sums it up. 5) Each narrative is plain and specific, at most ${NARRATIVE_WORDS} words, and says what the segment means rather than listing its notes. 6) Durations in milliseconds: a segment 2500 to 4500 (longer for more notes). Use only ids from the input. When asked to refine, give exactly the number of segments asked for, and keep each segment a meaningful group.`

// The intentions a slate can be made for. Each plans segments; they differ in how the published
// deck plays and in the tone asked for.
const INTENTIONS = {
  dynamic: {
    prompt: `${SEGMENT_PROMPT} This slate is a dynamic, visual piece: keep the pace quick (segments 2000 to 3000), and let the narratives build on each other like one sentence told across the segments.`,
    showNarrative: false,
    hideMenuOnPublish: true,
    autoplayOnPublish: true,
  },
  slideDeck: {
    prompt: `${SEGMENT_PROMPT} This slate is laid out like slides: a segment is usually one slide's notes together, in the slides' order.`,
    showNarrative: false,
    hideMenuOnPublish: true,
    autoplayOnPublish: true,
  },
}
const TEMPLATE_PROMPT = `${SEGMENT_PROMPT} The notes were added to a template by a group of collaborators: find the themes in what they wrote and build the segments around those themes.`

/**
 * The function the AI answers with: the plan's segments and the words for its opening and closing
 * overviews (the server adds their notes: the AI never lists every note twice).
 */
export const PLAN_FUNCTIONS = [
  {
    name: 'createPresentation',
    description: 'Plan the presentation as segments of related notes',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'A creative 5 words or less name for this presentation' },
        description: { type: 'string', description: 'Describe this presentation in 15 words or less' },
        opening: { type: 'string', description: `The opening narrative over the whole slate, ${NARRATIVE_WORDS} words or less` },
        segments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nodeIds: { type: 'array', description: 'The ids of the notes this segment frames together', items: { type: 'string' } },
              narrative: { type: 'string', description: `What this segment means, ${NARRATIVE_WORDS} words or less` },
              duration: { type: 'number', description: 'How long the segment is shown, in milliseconds' },
            },
            required: ['nodeIds', 'narrative', 'duration'],
          },
        },
        closing: { type: 'string', description: `The closing narrative over the whole slate, ${NARRATIVE_WORDS} words or less` },
      },
      required: ['name', 'description', 'opening', 'segments', 'closing'],
    },
  },
]

/**
 * The slate as the AI reads it, compact: each note as [id, text, x, y, width, height] (and its
 * rotation when it has one), whole numbers from the slate's top left, and the connections as
 * [from, to] pairs. No key names, no nesting, no SVG. → { notes, links }
 */
export function compactSlate(layout) {
  const notes = []
  const links = []
  const stack = [...(layout?.nodes || [])].reverse().map((node) => ({ node, parent: null }))
  const seen = new Set()
  while (stack.length) {
    const { node, parent } = stack.pop()
    const id = node?.nodeId == null ? null : String(node.nodeId)
    if (id !== null && parent) links.push([parent, id])
    if (id !== null && !seen.has(id)) {
      seen.add(id)
      const box = node.metrics?.bbox || {}
      const rotation = Math.round(Number(node.metrics?.rotation) || 0) % 360
      notes.push([id, String(node.description || '').trim(), ...[box.x, box.y, box.width, box.height].map((value) => Math.round(Number(value) || 0)), ...(rotation ? [rotation] : [])])
      const kids = node.childrenNodes || []
      for (let i = kids.length - 1; i >= 0; i -= 1) stack.push({ node: kids[i], parent: id })
    }
  }
  const minX = Math.min(0, ...notes.map((note) => note[2]))
  const minY = Math.min(0, ...notes.map((note) => note[3]))
  return { notes: notes.map(([id, text, x, y, ...rest]) => [id, text, x - minX, y - minY, ...rest]), links }
}

/** The slate in words for the AI: the compact notes, connections and suggested groups. */
export function slateForPrompt(layout) {
  const { notes, links } = compactSlate(layout)
  return `Notes [id, text, x, y, width, height]: ${JSON.stringify(notes)}. Connections [from, to]: ${JSON.stringify(links)}. Suggested groups: ${JSON.stringify(layout ? planHints(layout) : [])}`
}

/**
 * The prompts for planning this slate. `layout` is the kept layout (sanitizeLayout); the AI is
 * sent that, never the caller's payload. → { system, systemFor({ intentionId, isTemplate }),
 * settingsFor(intentionId), user }
 */
export function presentationPrompts({ layout, scenes = [], isTemplate = false }) {
  const systemFor = ({ intentionId, isTemplate: template = false } = {}) => (template ? TEMPLATE_PROMPT : INTENTIONS[intentionId]?.prompt ?? SEGMENT_PROMPT)
  let user = `Please plan the presentation of this slate. ${slateForPrompt(layout)}`
  if (isTemplate) user += '. This slate is based on a template, so the notes\' texts give the themes, fewer than the notes under them.'
  if (scenes.length) {
    user += `. The slate holds a workshop whose lanes the team presents in this order, each lane with the notes on it: ${scenes
      .map((scene) => scene.nodeIds.join(' + ')).join(', then ')}. Present one segment per lane in that order, then the segments of the other notes.`
  }
  return {
    system: SEGMENT_PROMPT,
    systemFor,
    settingsFor: (intentionId) => INTENTIONS[intentionId] ?? {},
    user,
  }
}

/**
 * What a plan request may cost, in micro-dollars, before it is sent: its prompt (`chars`
 * characters, about three to a token) and a full plan back, at the dearest of `prices` (the
 * feature's model and its fallback: { inPerMillion, outPerMillion }, which are micro-dollars per
 * token).
 */
export function planEstimateMicros(chars, prices) {
  const tokensIn = Math.ceil(Math.max(0, chars) / 3)
  return Math.max(...prices.map((price) => Math.ceil(tokensIn * price.inPerMillion + PLAN_OUTPUT_TOKENS * price.outPerMillion)))
}

/**
 * The models a plan request is priced at: those that will serve it. `chosen` is the connection
 * settings.ai.use picks for this person (ai-settings-core.mjs resolveFor); when it names a model,
 * that model alone serves the plan (req.js sends a connection's request to its model, and a plan
 * has no second model). The feature's built-in model and its fallback (`feature`,
 * resolveAIFeatureConfig) price it only on the built-in AI, or on a DeepInfra key without a model
 * of its own, which follows the feature's model as req.js does.
 */
export function planModels({ feature = {}, chosen = null } = {}) {
  const model = chosen?.connection?.model
  if (typeof model === 'string' && model.trim()) return [model]
  return [feature.engine, feature.fallback?.engine].filter(Boolean)
}

/** A promise that fails with PLAN_TOO_SLOW once `ms` have passed. */
function withinTime(promise, ms) {
  let timer
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(PLAN_TOO_SLOW)), ms) })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

/**
 * The AI's answer as viewpoints: its segments between an overview with its opening words and one
 * with its closing words (the notes of both are the whole slate, added here). An answer in the
 * earlier shape (viewpoints, overviews included) is taken as it is.
 */
export function answerViewpoints(raw, layout) {
  if (!Array.isArray(raw?.segments)) return Array.isArray(raw?.viewpoints) ? raw.viewpoints : []
  const all = []
  const visit = (nodes) => (nodes || []).forEach((node) => { all.push(String(node.nodeId)); visit(node.childrenNodes) })
  visit(layout?.nodes)
  return [
    { nodeIds: all, narrative: String(raw.opening ?? ''), duration: 4000 },
    ...raw.segments,
    { nodeIds: all, narrative: String(raw.closing ?? ''), duration: 3500 },
  ]
}

// A plan the meter refused: its code and the pay sheet's action, so the banner can offer it.
function refusalFields(error) {
  const refusal = refusalOf(error)
  return refusal ? { code: refusal.code, pay: refusal.pay } : {}
}

/**
 * Plan with the AI. `run(fn)` runs the counted request (runAIAction); `request({ deadline })`
 * sends it, and stops trying at `deadline`. The provider failing, aborting, taking longer than
 * `timeLimitMs`, or answering with no segment on the slate is a failure inside `run`, so the
 * meter gives the plan back; the person then gets the grouped automatic plan and the reason (a
 * refusal by the meter is said the same way). A refinement that fails is an error. A slate of
 * one or two notes is not planned: its overview is the whole presentation (`trivial`), and
 * nothing is sent or counted.
 * → { plan: { name?, description?, viewpoints }, automatic, trivial?, reason?, response?, toolUse? }
 */
export async function planWithAI({ run, request, layout, name = '', scenes = [], refining = false, timeLimitMs = PLAN_TIME_LIMIT_MS }) {
  if (!refining && layout && isTrivialLayout(layout)) {
    return { plan: buildFallbackPresentation(layout, name, { scenes }), automatic: true, trivial: true, reason: '' }
  }
  try {
    return await run(async () => {
      const response = await withinTime(Promise.resolve().then(() => request({ deadline: Date.now() + timeLimitMs })), timeLimitMs)
      if (response?.abort) throw new Error(planFailureReason(response))
      const toolUse = response?.json?.content?.find?.((part) => part.type === 'tool_use')
      const raw = toolUse?.input || response?.json
      const known = new Set()
      if (layout) {
        const visit = (nodes) => (nodes || []).forEach((node) => { known.add(String(node.nodeId)); visit(node.childrenNodes) })
        visit(layout.nodes)
      }
      const answered = [raw?.segments, raw?.viewpoints].find(Array.isArray) || []
      const onSlate = answered.some((viewpoint) => [viewpoint?.nodeIds ?? []].flat().some((id) => known.has(String(id))))
      if (!onSlate) throw new Error('The provider returned no viewpoints.')
      const plan = { ...raw, ...normalizePresentationPlan({ ...raw, viewpoints: answerViewpoints(raw, layout) }, layout, { name, scenes }) }
      if (!plan.viewpoints?.length) throw new Error('The provider returned no viewpoints.')
      return { plan, automatic: false, response, toolUse }
    })
  } catch (error) {
    if (refining) throw error
    return { plan: buildFallbackPresentation(layout, name, { scenes }), automatic: true, reason: planFailureReason(error), ...refusalFields(error) }
  }
}

const inFlight = new Map()
/** One plan at a time per key (a person on a slate): a second press while it runs gets the same result. */
export function singleFlight(key, fn) {
  if (inFlight.has(key)) return inFlight.get(key)
  const running = Promise.resolve().then(fn).finally(() => inFlight.delete(key))
  inFlight.set(key, running)
  return running
}

const changedByHand = (deck) => Boolean(deck?.viewpointsManuallyChanged?.updated?.length || deck?.viewpointsManuallyChanged?.deleted?.length)

/**
 * The deck a new automatic plan replaces in place (the person's latest, when it is an automatic
 * one nobody published or edited), so presses while the AI is unavailable do not add versions.
 */
export function reusableDeck(deck) {
  if (!deck?.automatic || deck.isPublished || changedByHand(deck)) return null
  return deck
}

export { PLAN_VERSION }
