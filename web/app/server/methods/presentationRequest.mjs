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
import { STEP_LAYOUTS, normalizeDirection, CAPTION_WORDS } from '../../imports/ui/components/presentations/presentationCompose.mjs'
import { STYLES, STYLE_IDS } from '../../imports/ui/components/presentations/presentationStyles.mjs'
import { MASK_NAMES } from '../../imports/ui/components/presentations/presentationPaths.mjs'
import { codePromptText, promptRef, promptText } from '../ai-control/prompts/index.mjs'

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

// The planning instructions are prompts an administrator can edit (server/ai-control/prompts/
// presentation.mjs): how to plan segments, how to art-direct the deck, and one system prompt per kind
// of slate. The style list, layouts, masks and word limits are the code's own, passed as values.
const STYLE_GUIDE = STYLE_IDS.map((id) => `${id} (${STYLES[id].blurb})`).join('; ')
// Art direction: the deck is played on the live canvas in a style, with Prezi-style camera moves.
// The AI chooses the style, the layout of each step, the words and the pictures; the composer
// places everything in free canvas space (the AI never does geometry).
const systemParts = () => ({
  segments: promptText('presentation.segments', { narrativeWords: NARRATIVE_WORDS }),
  art: promptText('presentation.art', { styleGuide: STYLE_GUIDE, stepLayouts: STEP_LAYOUTS.join(', '), captionWords: CAPTION_WORDS, masks: MASK_NAMES.join(', ') }),
})
// The prompts a plan's system text is made of, as `id@v<n>`: kept with the conversation so a
// refinement can say which versions its plan was made with.
const systemRefOf = (id) => ({ system: promptRef(id), segments: promptRef('presentation.segments'), art: promptRef('presentation.art') })

// The intentions a slate can be made for. Each plans segments; they differ in how the published
// deck plays and in the tone asked for.
const INTENTIONS = {
  dynamic: {
    // the id of its system prompt
    prompt: 'presentation.system.dynamic',
    showNarrative: false,
    hideMenuOnPublish: true,
    autoplayOnPublish: true,
  },
  slideDeck: {
    prompt: 'presentation.system.slides',
    showNarrative: false,
    hideMenuOnPublish: true,
    autoplayOnPublish: true,
  },
}
const TEMPLATE_PROMPT = 'presentation.system.template'
const ART_PROMPT = 'presentation.system'
const systemText = (id) => promptText(id, systemParts())

// The descriptions that steer picture search and generation, and the tool's own, are prompts
// (tool.create-presentation*): planFunctions(text) builds the tool with the published ones.
const imageSchemaWith = (text) => ({
  type: 'object',
  description: 'A picture for this step: searched for, else generated, else drawn from the style',
  properties: {
    query: { type: 'string', description: text('tool.create-presentation.image-query') },
    prompt: { type: 'string', description: text('tool.create-presentation.image-prompt') },
    why: { type: 'string', description: text('tool.create-presentation.image-why') },
    mask: { type: 'string', enum: MASK_NAMES },
  },
  required: ['query', 'why'],
})

/**
 * The function the AI answers with: the plan's segments and the words for its opening and closing
 * overviews (the server adds their notes: the AI never lists every note twice). text(id) gives a
 * prompt's text: the published one for a request (planFunctions()), the built-in for PLAN_FUNCTIONS.
 */
export function planFunctions(text = promptText) {
  const imageSchema = imageSchemaWith(text)
  return [
  {
    name: 'createPresentation',
    description: text('tool.create-presentation'),
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
              narrative: { type: 'string', description: `The caption: what this segment means, ${CAPTION_WORDS} words or less` },
              duration: { type: 'number', description: 'How long the segment is shown, in milliseconds' },
              layout: { type: 'string', enum: STEP_LAYOUTS, description: 'How the camera and stage show this segment' },
              kicker: { type: 'string', description: 'A short label over the caption, like "01 · Free and open"' },
              headline: { type: 'string', description: 'Big words placed beside the notes, 6 words or less' },
              headlines: { type: 'array', items: { type: 'string' }, description: 'compare: the two sides\' headings' },
              number: { type: 'string', description: 'bigNumber: the number, as written on the slate' },
              numberLabel: { type: 'string', description: 'bigNumber: what the number counts' },
              quote: { type: 'string', description: 'quote: a note\'s own words' },
              detail: {
                type: 'object',
                description: 'dive: a tiny sticker the camera zooms deep into',
                properties: { label: { type: 'string' }, fine: { type: 'string' }, caption: { type: 'string' } },
              },
              image: imageSchema,
              images: { type: 'array', items: imageSchema, description: 'sweep: one picture per group' },
              roll: { type: 'number', description: 'Camera roll in degrees, -12 to 12; 0 for level' },
            },
            required: ['nodeIds', 'narrative', 'duration', 'layout'],
          },
        },
        closing: { type: 'string', description: `The closing narrative over the whole slate, ${NARRATIVE_WORDS} words or less` },
        style: { type: 'string', enum: STYLE_IDS, description: 'The style that fits this slate' },
        title: { type: 'string', description: 'The title card, 8 words or less' },
        kicker: { type: 'string', description: 'A kicker over the title, 5 words or less' },
        subtitle: { type: 'string', description: 'One line under the title, 14 words or less' },
        cta: { type: 'string', description: 'The call to action on the finale, 4 words or less' },
        cover: imageSchema,
      },
      required: ['name', 'description', 'opening', 'segments', 'closing', 'style', 'title'],
    },
  },
  ]
}
/** The tool with its built-in descriptions (version 0). */
export const PLAN_FUNCTIONS = planFunctions(codePromptText)

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
  return promptText('presentation.slate', { notes: JSON.stringify(notes), links: JSON.stringify(links), groups: JSON.stringify(layout ? planHints(layout) : []) })
}

/**
 * The prompts for planning this slate. `layout` is the kept layout (sanitizeLayout); the AI is
 * sent that, never the caller's payload. → { system, systemFor({ intentionId, isTemplate }),
 * systemRefFor(same), settingsFor(intentionId), user, withBrief(brief), refinement(message, slateChanged) }
 */
export function presentationPrompts({ layout, scenes = [], isTemplate = false }) {
  const systemId = ({ intentionId, isTemplate: template = false } = {}) => (template ? TEMPLATE_PROMPT : INTENTIONS[intentionId]?.prompt ?? ART_PROMPT)
  const user = promptText('presentation.user', {
    slate: slateForPrompt(layout),
    isTemplate: Boolean(isTemplate),
    hasScenes: scenes.length > 0,
    scenes: scenes.map((scene) => scene.nodeIds.join(' + ')).join(', then '),
  })
  return {
    system: systemText(ART_PROMPT),
    systemFor: (args) => systemText(systemId(args)),
    systemRefFor: (args) => systemRefOf(systemId(args)),
    settingsFor: (intentionId) => INTENTIONS[intentionId] ?? {},
    user,
    // the presenter's own words, as a JSON string inside the request
    withBrief: (brief) => promptText('presentation.brief', { request: user, brief: JSON.stringify(brief) }),
    refinement: (message, slateChanged = false) => promptText('presentation.refine', { message: String(message), slateChanged: Boolean(slateChanged), ...(slateChanged && { slate: slateForPrompt(layout) }) }),
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
      // The AI's art direction, made safe (a plan in the older shape is directed from its segments).
      plan.direction = normalizeDirection(raw, layout, { name })
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
