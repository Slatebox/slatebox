// A slate's presentation, for agents: create one with Present's planner (the AI composes its steps
// and layouts, counted like Present), read the deck (its style and each step's layout and caption)
// and switch its style in one call. Switching composes the same art direction in the new style: the
// steps stay the same notes in the same order, and no AI is asked or counted.
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { loadSlate } from './slate-access.mjs'
import { shareIdInput } from './slate-schemas.mjs'
import { STYLE_IDS } from '../../imports/ui/components/presentations/presentationStyles.mjs'
import { MAX_REFINEMENT_CHARS } from '../methods/presentationRequest.mjs'
import { LAYOUTS } from '../../imports/ui/components/presentations/presentationCompose.mjs'
import { wearDeckOnSlate, wornSlateSet } from '../methods/presentationDeck.mjs'
import { sharedSaveConditions } from '../methods/native-slate-save.mjs'
import { runExpiry } from '../../imports/api/common/slate-operation-runs.mjs'
import { undoRecord } from './slate-undo-record.mjs'
import { showAgent } from './slate-operations.mjs'
import { playableDeck } from '../../imports/ui/components/presentations/presentationBake.mjs'

const hex = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }

const deckOutput = {
  type: 'object',
  properties: {
    presentationId: { type: 'string' },
    version: { type: 'integer' },
    name: { type: 'string' },
    published: { type: 'boolean' },
    style: { type: ['string', 'null'], enum: [...STYLE_IDS, null], description: 'The style it plays in.' },
    styles: { type: 'array', items: { type: 'string' }, description: 'Every style it can play in.' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          step: { type: 'integer' },
          layout: { type: 'string', enum: LAYOUTS },
          kicker: { type: 'string' },
          caption: { type: 'string' },
          notes: { type: 'integer', description: 'How many of the slate\'s notes the step shows.' },
          nodeIds: { type: 'array', items: { type: 'string' }, description: 'The notes the step shows (their ids on the slate).' },
          box: {
            type: ['object', 'null'],
            description: 'What the camera frames, in canvas units (null when the step frames nothing on the slate as it is now).',
            properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
          },
          fill: { type: 'number', description: 'How much of the screen the box fills (0 to 1).' },
          hide: { type: 'array', items: { type: 'string' }, description: 'Notes of the style hidden on this step (a caption or card of another step).' },
          duration: { type: 'integer', description: 'How long the step usually shows, in milliseconds.' },
        },
        required: ['step', 'layout', 'caption'],
      },
    },
  },
  required: ['presentationId', 'style', 'steps'],
}

// The camera over each step as the player plays it (presentationBake.playableDeck): a worn style's
// deck as saved, else the camera over the slate as it is now. One frame per step, or none.
function framesOf(row, slate) {
  const points = Array.isArray(row.viewpoints) ? row.viewpoints : []
  let deck = null
  try {
    deck = playableDeck({ deck: row.deck ?? null, viewpoints: points, slateJSON: slate?.nodes ? { options: slate.options || {}, nodes: slate.nodes } : null })
  } catch {
    deck = null
  }
  return deck?.steps?.length === points.length ? deck.steps : []
}

const boxOf = (box) =>
  box && [box.x, box.y, box.width, box.height].every(Number.isFinite) ? { x: box.x, y: box.y, width: box.width, height: box.height } : null

// `slate` (optional): the slate as stored, so a deck that wears no style frames its notes where they are now.
export const deckSummary = (row, slate = null) => {
  const frames = framesOf(row, slate)
  return {
    presentationId: row._id,
    version: row.version ?? 1,
    name: row.name || '',
    published: Boolean(row.isPublished),
    style: row.style?.id ?? null,
    styles: STYLE_IDS,
    steps: (row.viewpoints || []).map((step, index) => {
      const frame = frames[index] || null
      const nodeIds = [step.nodeIds ?? []].flat().filter((id) => id != null).map(String)
      return {
        step: index,
        layout: LAYOUTS.includes(step.layout) ? step.layout : 'group',
        kicker: step.kicker || '',
        caption: step.narrative || '',
        notes: nodeIds.length,
        nodeIds,
        box: boxOf(frame?.box),
        fill: Number.isFinite(frame?.camera?.fill) ? frame.camera.fill : 0.86,
        hide: Array.isArray(frame?.hide) ? frame.hide.map(String) : [],
        duration: Math.round(Number(frame?.duration ?? step.duration) || 3200),
      }
    }),
  }
}

// The caller's latest deck of the slate (an agent's token acts as its owner).
async function deckOf(deps, shareId, principal) {
  const row = await deps.latestPresentation?.(shareId, principal.userId)
  if (!row) throw problem(404, 'not_found', 'This slate has no presentation yet. Create one (presentations.create), or open the slate and press Present.')
  return row
}

// The deck a reader plays: their own latest, else the slate's published presentation when it was made
// by someone who may edit the slate (the deck the web's Present link plays to everyone who opens it).
async function playedDeckOf(deps, shareId, principal, slate) {
  const own = await deps.latestPresentation?.(shareId, principal.userId)
  if (own) return own
  const published = await deps.publishedPresentation?.(shareId)
  if (published && Array.isArray(published.viewpoints)) {
    const author = published.userId
    if (author && slate?.userId === author) return published
    const access = author && deps.resolveSlateForUser ? await deps.resolveSlateForUser(shareId, author) : null
    if (access?.canEdit) return published
  }
  return deckOf(deps, shareId, principal)
}

// Where the person presents a slate's latest deck: the slate, opened in the presenter.
export const presentLink = (origin, shareId) => new URL(`/canvas/${encodeURIComponent(shareId)}?present=1`, origin).href

const createOutput = {
  type: 'object',
  properties: {
    ...deckOutput.properties,
    presentationId: { type: ['string', 'null'], description: 'The new presentation (null in a preview, which saves nothing).' },
    version: { type: ['integer', 'null'] },
    link: { type: ['string', 'null'], description: 'Opens the slate and plays this presentation (null in a preview).' },
    automatic: { type: 'boolean', description: 'True when Slatebox grouped the notes itself because the AI could not plan the slate; reason says why.' },
    reason: { type: 'string' },
  },
  required: ['presentationId', 'style', 'steps', 'link', 'automatic'],
}

export const presentationsCreate = defineAction({
  id: 'presentations.create',
  title: 'Present',
  description:
    `Create a presentation of a slate with the planner the Present button uses: the AI (feature presentation, counted like other AI use) groups the notes into steps and chooses each step's layout, kicker and caption, played on the live canvas with camera moves. Optional: a style (${STYLE_IDS.join(', ')}), a palette (3 to 6 colors) and a brief (what to focus on). Needs edit access to the slate. Each call plans a new version; mode "preview" plans and returns the steps and saves nothing. Returns the presentation id, its steps and a link that opens the slate and plays it.`,
  toolset: 'slates',
  kind: 'write',
  scope: 'slates:write',
  principals: ['agent'],
  // Not read-only and not idempotent: it spends AI and saves a new version each time. A retried
  // call with the same Idempotency-Key is answered with the first result and plans nothing. It
  // reaches the AI provider (openWorld), as Present does; a preview plans too. It changes no slate
  // and shows nothing to anyone new (the deck is the caller's own, unpublished: changesNoSlate).
  openWorld: true,
  changesNoSlate: true,
  modes: ['save', 'preview'],
  idempotency: 'optional',
  mounts: { http: { method: 'POST', path: '/slates/{shareId}/presentation', operationId: 'createPresentation' } },
  input: {
    type: 'object',
    properties: {
      shareId: shareIdInput,
      style: { type: 'string', enum: STYLE_IDS, description: 'The style to play it in. Left out, the AI chooses.' },
      palette: { type: 'array', minItems: 3, maxItems: 6, items: hex, description: 'Your own colors, with a style: the first three lead, the background stays the style\'s.' },
      brief: { type: 'string', minLength: 1, maxLength: MAX_REFINEMENT_CHARS, description: 'What the presentation should focus on or bring out, in plain words.' },
    },
    required: ['shareId'],
    additionalProperties: false,
  },
  output: createOutput,
  load: loadSlate(true),
  tool: { name: 'create_presentation', title: 'Create a presentation', description: 'Make a presentation (slides) from a slate: the Slatebox agent composes a styled deck (its steps, layouts and captions) that flies across the canvas. For slides about a topic, draw the points on a slate first (import_mermaid). Returns the steps and a link that plays it.' },
  precheck(_principal, input) {
    if (input.palette && !input.style) throw problem(400, 'invalid_request', 'A palette goes with a style: name the style too.', { details: { field: 'palette' } })
  },
  async handler(principal, input, { deps, mode }) {
    if (input.palette && !input.style) throw problem(400, 'invalid_request', 'A palette goes with a style: name the style too.', { details: { field: 'palette' } })
    if (!deps.createPresentation) throw problem(503, 'unavailable', 'Presentations cannot be made on this server.')
    const preview = mode === 'preview'
    let made
    try {
      made = await deps.createPresentation({
        userId: principal.userId, shareId: input.shareId, brief: input.brief || '', style: input.style || null, palette: input.palette || null, preview,
      })
    } catch (error) {
      if (error?.error === 'slate-denied') throw problem(403, 'forbidden', 'You need edit access to this slate to present it.')
      if (error?.error === 'sign_in') throw problem(401, 'sign_in', 'Sign in to present this slate.')
      if (error?.error === 'invalid-presentation-plan') throw problem(409, 'conflict', 'There is nothing on this slate to present yet.')
      throw error
    }
    if (made.empty || made.tooMany) throw problem(409, 'conflict', made.reason, { details: { reason: made.empty ? 'empty' : 'too_many_notes' } })
    const summary = deckSummary(made.row)
    return {
      ...summary,
      presentationId: preview ? null : summary.presentationId,
      version: preview ? null : summary.version,
      link: preview ? null : presentLink(deps.appOrigin(), input.shareId),
      automatic: Boolean(made.automatic),
      reason: made.reason || '',
    }
  },
})

export const presentationsGet = defineAction({
  id: 'presentations.get',
  title: 'Deck',
  description:
    'Read your latest presentation of a slate (or, when you have none, the slate\'s published one): its style, and each step\'s layout (title, overview, dive, hero, treeBuild, trace, sweep, group, bigNumber, quote, split, compare, cover, finale), kicker, caption, the notes it shows and what the camera frames (box, fill). The deck plays on the live canvas with Prezi-style camera moves.',
  toolset: 'slates',
  kind: 'read',
  scope: 'slates:read',
  principals: ['agent'],
  mounts: { http: { method: 'GET', path: '/slates/{shareId}/presentation', operationId: 'getPresentation' } },
  input: { type: 'object', properties: { shareId: shareIdInput }, required: ['shareId'], additionalProperties: false },
  output: deckOutput,
  load: loadSlate(false),
  tool: { name: 'get_presentation', title: 'Read a presentation', description: 'Read a slate\'s presentation (its slides): its style and each step\'s layout and caption.' },
  async handler(principal, input, { deps, resource }) {
    return deckSummary(await playedDeckOf(deps, input.shareId, principal, resource), resource)
  },
})

export const presentationsSetStyle = defineAction({
  id: 'presentations.setStyle',
  title: 'Restyle',
  description:
    `Put another style (${STYLE_IDS.join(', ')}) on a slate and your latest presentation of it, optionally with your own palette (3 to 6 colors). The slate itself wears the style (its background, its notes' look, and the style's title cards, captions and art as real notes), and the presentation is the camera over it: the same steps in the same order. No AI is asked and nothing is counted. Saved as your own edit of the slate (slates.undo takes it back). An agent wears a style by the rules slate settings meet: 423 agents_paused while people paused agents, 409 needs_direct_edit unless a person lets it edit directly.`,
  toolset: 'slates',
  kind: 'write',
  scope: 'slates:write',
  principals: ['agent'],
  idempotent: true,
  // Setting the same style twice is the same deck: a retried call is answered again.
  idempotency: 'optional',
  replay: 'rerun',
  mounts: { http: { method: 'POST', path: '/slates/{shareId}/presentation/style', operationId: 'setPresentationStyle' } },
  input: {
    type: 'object',
    properties: {
      shareId: shareIdInput,
      style: { type: 'string', enum: STYLE_IDS },
      palette: { type: 'array', minItems: 3, maxItems: 6, items: hex, description: 'Your own colors: the first three lead, the background stays the style\'s.' },
    },
    required: ['shareId', 'style'],
    additionalProperties: false,
  },
  output: deckOutput,
  load: loadSlate(true),
  tool: { name: 'style_presentation', title: 'Restyle a presentation', description: 'Put another style (voyage, stage, editorial, neon, sketch, blueprint, journey, calm) on a slate and its presentation, keeping its steps. The slate itself wears it: its background, its notes\' look, and the style\'s title cards, captions and art as real notes on the canvas; Present only plays the slate. undo_my_edit takes it back.' },
  async handler(principal, input, ctx) {
    const { deps } = ctx
    const slate = ctx.resource
    const row = await deckOf(deps, input.shareId, principal)
    if (!row?.direction?.steps) throw problem(409, 'conflict', 'This presentation has no art direction to restyle. Open the slate and press Present to plan it again.')
    const overrides = input.palette ? { palette: input.palette } : {}
    const styleRef = Object.keys(overrides).length ? { id: input.style, overrides } : { id: input.style }
    const extra = await asAgentWearing(principal, slate, ctx)
    // The slate IS the presentation: the style goes on the slate as stored (inside the save core, so a
    // person's save that lands first is built on), and the deck is the camera over it. One edit of the
    // caller's own: slates.undo takes the whole style back.
    let worn = null
    let before = null
    let undoable = null
    if (typeof deps.saveCore?.save !== 'function') throw problem(503, 'unavailable', 'Styles cannot be worn on this server.')
    let saved
    try {
      saved = await deps.saveCore.save({
        slateId: slate._id,
        actor: principal,
        source: 'operations',
        expectedRevision: slate.revision ?? 0,
        conditions: { userId: slate.userId, orgId: slate.orgId ?? null, ...sharedSaveConditions(slate, principal.userId) },
        build(current) {
          before = current
          worn = wearDeckOnSlate(current, row, styleRef)
          if (!worn) throw problem(409, 'conflict', 'There is nothing on this slate to wear a style on.')
          // Each line is kept on its own (defaultLineColor, put back, would recolor every line).
          undoable = undoRecord(current, worn.slate, ['background', 'style'])
          return { set: wornSlateSet(worn.slate) }
        },
      })
    } catch (error) {
      if (error?.status && error?.code) throw error
      if (error?.code === 'slate_changed' || error?.code === 'save_refused')
        throw problem(409, 'slate_changed', 'The slate changed while the style was being worn. Refresh and retry.')
      throw error
    }
    const message = `Wore the ${input.style} style on the slate: its canvas background, its notes' look and its art.`
    const now = ctx.now ? ctx.now() : Date.now()
    if (deps.operationRuns?.insertAsync && undoable) {
      await deps.operationRuns.insertAsync({
        userId: principal.userId, tokenId: principal.tokenId, slateId: slate._id, slateShareId: slate.shareId, idempotencyKey: null,
        revision: saved.revision, plan: { message, operations: [] }, userMessage: message, report: {},
        response: { ok: true, shareId: slate.shareId, revision: saved.revision, message, operations: [], report: {}, mode: 'save' },
        undoable, undoneBy: null, createdAt: now, expiresAt: runExpiry(now),
      })
    }
    if (extra.onApplied) await extra.onApplied({ before, after: worn.slate, revision: saved.revision })
    await showAgent(principal, slate, { message, report: { targets: worn.deck.steps[0]?.nodeIds || [] } }, deps)
    await deps.savePresentation(row._id, worn.change)
    return deckSummary({ ...row, ...worn.change }, worn.slate)
  },
})

// A style is a slate setting (its background, its record): an agent wears one by the rules update_slate
// meets. Not while people paused the slate's agents, and only when a person lets it edit directly (there
// is no suggestion of a background); the Slatebox agent works on tasks a person approved, and saves.
async function asAgentWearing(principal, slate, ctx) {
  const store = ctx.deps.suggestions
  if (!store || principal.kind !== 'agent') return {}
  if ((await store.controlsOf(slate._id)).paused)
    throw problem(423, 'agents_paused', 'People on this slate paused its agents. Ask one of them to resume agents, then retry.')
  if (principal.builtin === 'slatebox' || !ctx.deps.presence?.identify) return {}
  const who = await ctx.deps.presence.identify(principal, slate)
  const direct = (await store.modeOf(slate._id, who.agentId, Boolean(ctx.deps.agentOptions?.editDirectly?.()))) === 'direct'
  if (!direct)
    throw problem(409, 'needs_direct_edit', 'A style changes the slate itself (its background and its notes\' look), which a person does, or an agent a person lets edit directly. Ask a person to let this agent edit directly, or to wear the style from Present.')
  return {
    onApplied: ({ before, after, revision }) => store.applied(principal, slate, { before, after, revision, message: 'Wore a style', identity: who }),
  }
}

export default [presentationsCreate, presentationsGet, presentationsSetStyle]
