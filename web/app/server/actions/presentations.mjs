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
import { styleChange } from '../methods/presentationDeck.mjs'

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
        },
        required: ['step', 'layout', 'caption'],
      },
    },
  },
  required: ['presentationId', 'style', 'steps'],
}

export const deckSummary = (row) => ({
  presentationId: row._id,
  version: row.version ?? 1,
  name: row.name || '',
  published: Boolean(row.isPublished),
  style: row.style?.id ?? null,
  styles: STYLE_IDS,
  steps: (row.viewpoints || []).map((step, index) => ({
    step: index,
    layout: LAYOUTS.includes(step.layout) ? step.layout : 'group',
    kicker: step.kicker || '',
    caption: step.narrative || '',
    notes: step.nodeIds?.length || 0,
  })),
})

// The caller's latest deck of the slate (an agent's token acts as its owner).
async function deckOf(deps, shareId, principal) {
  const row = await deps.latestPresentation?.(shareId, principal.userId)
  if (!row) throw problem(404, 'not_found', 'This slate has no presentation yet. Create one (presentations.create), or open the slate and press Present.')
  return row
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
  tool: { name: 'create_presentation', title: 'Create a presentation', description: 'Turn a slate into slides: the Slatebox agent plans a styled presentation (its steps, layouts and captions) that flies across the canvas. Returns the steps and a link that plays it.' },
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
    'Read your latest presentation of a slate: its style, and each step\'s layout (title, overview, dive, hero, treeBuild, trace, sweep, group, bigNumber, quote, split, compare, cover, finale), kicker and caption. The deck plays on the live canvas with Prezi-style camera moves.',
  toolset: 'slates',
  kind: 'read',
  scope: 'slates:read',
  principals: ['agent'],
  mounts: { http: { method: 'GET', path: '/slates/{shareId}/presentation', operationId: 'getPresentation' } },
  input: { type: 'object', properties: { shareId: shareIdInput }, required: ['shareId'], additionalProperties: false },
  output: deckOutput,
  load: loadSlate(false),
  tool: { name: 'get_presentation', title: 'Read a presentation', description: 'Read a slate\'s presentation (its slides): its style and each step\'s layout and caption.' },
  async handler(principal, input, { deps }) {
    return deckSummary(await deckOf(deps, input.shareId, principal))
  },
})

export const presentationsSetStyle = defineAction({
  id: 'presentations.setStyle',
  title: 'Restyle',
  description:
    `Play your latest presentation of a slate in another style (${STYLE_IDS.join(', ')}), optionally with your own palette (3 to 6 colors). The same steps in the same order: no AI is asked and nothing is counted.`,
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
  tool: { name: 'style_presentation', title: 'Restyle a presentation', description: 'Switch a slate\'s presentation (its slides) to another style (voyage, stage, editorial, neon, sketch, blueprint, journey, calm), keeping its steps.' },
  async handler(principal, input, { deps }) {
    const row = await deckOf(deps, input.shareId, principal)
    const overrides = input.palette ? { palette: input.palette } : {}
    const change = styleChange(row, Object.keys(overrides).length ? { id: input.style, overrides } : { id: input.style })
    if (!change) throw problem(409, 'conflict', 'This presentation has no art direction to restyle. Open the slate and press Present to plan it again.')
    await deps.savePresentation(row._id, change)
    return deckSummary({ ...row, ...change })
  },
})

export default [presentationsCreate, presentationsGet, presentationsSetStyle]
