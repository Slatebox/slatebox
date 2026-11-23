// A slate's presentation, for agents: read the deck (its style and each step's layout and
// caption) and switch its style in one call. Switching composes the same art direction in the
// new style: the steps stay the same notes in the same order, and no AI is asked or counted.
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { loadSlate } from './slate-access.mjs'
import { shareIdInput } from './slate-schemas.mjs'
import { STYLE_IDS } from '../../imports/ui/components/presentations/presentationStyles.mjs'
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
  if (!row) throw problem(404, 'not_found', 'This slate has no presentation yet. Open the slate and press Present.')
  return row
}

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
  tool: { name: 'get_presentation', title: 'Read a presentation', description: 'Read a slate\'s presentation: its style and each step\'s layout and caption.' },
  async handler(principal, input, { deps }) {
    return deckSummary(await deckOf(deps, input.shareId, principal))
  },
})

export const presentationsSetStyle = defineAction({
  id: 'presentations.setStyle',
  title: 'Restyle',
  description:
    `Play your latest presentation of a slate in another style (${STYLE_IDS.join(', ')}), optionally with your own palette (3 to 6 colours). The same steps in the same order: no AI is asked and nothing is counted.`,
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
      palette: { type: 'array', minItems: 3, maxItems: 6, items: hex, description: 'Your own colours: the first three lead, the background stays the style\'s.' },
    },
    required: ['shareId', 'style'],
    additionalProperties: false,
  },
  output: deckOutput,
  load: loadSlate(true),
  tool: { name: 'style_presentation', title: 'Restyle a presentation', description: 'Switch a slate\'s presentation to another style (voyage, stage, editorial, neon, sketch, blueprint, journey, calm), keeping its steps.' },
  async handler(principal, input, { deps }) {
    const row = await deckOf(deps, input.shareId, principal)
    const overrides = input.palette ? { palette: input.palette } : {}
    const change = styleChange(row, Object.keys(overrides).length ? { id: input.style, overrides } : { id: input.style })
    if (!change) throw problem(409, 'conflict', 'This presentation has no art direction to restyle. Open the slate and press Present to plan it again.')
    await deps.savePresentation(row._id, change)
    return deckSummary({ ...row, ...change })
  },
})

export default [presentationsGet, presentationsSetStyle]
