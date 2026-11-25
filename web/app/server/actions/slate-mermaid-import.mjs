import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { tokenLike } from './principal.mjs'
import { shareIdInput } from './slate-schemas.mjs'
import { mermaidProblem } from './slate-mermaid-export.mjs'
import { sharedSaveConditions } from '../methods/native-slate-save.mjs'
import { privateSlateDocument } from '../private-slate-document.mjs'
import { slatePreview } from '../../imports/api/common/slate-preview.mjs'
import { diagramPlans, importOrigin, lastNoteLook, parseMermaid, MERMAID_MAX_LENGTH } from '../../imports/api/common/mermaid/index.mjs'
import { runExpiry } from '../../imports/api/common/slate-operation-runs.mjs'

const USER_MESSAGE = 'Import Mermaid'

// The slate the caller may add to. A token is checked as every token write is (slate-access.mjs);
// a person in the app as the canvas checks them (resolveSlateForUser).
async function editableSlate(principal, shareId, deps) {
  if (principal.kind === 'agent') {
    const { slate, authorized } = await deps.authorizeTokenForSlate(tokenLike(principal), shareId, true)
    if (authorized) return slate
    throw slate ? problem(403, 'forbidden', 'Slate not found or unavailable.') : problem(404, 'not_found', 'Slate not found or unavailable.')
  }
  const found = await deps.resolveSlateForUser(shareId, principal.userId)
  if (!found?.canEdit) throw problem(404, 'not_found', 'Slate not found or unavailable.')
  return found.slate
}

// Every plan applied in order by the engine's own applier: the notes and lines are made
// exactly as an edit_slate plan makes them, and each materialized plan is what canvases replay.
function applyAll(deps, target, plans) {
  let slate = target
  const applied = []
  for (const plan of plans) {
    let result
    try {
      result = deps.applySlateOperationPlanToJSON(slate, plan, { userMessage: USER_MESSAGE, requireMatches: true })
    } catch (error) {
      if (error?.code && error?.status) throw problem(error.status, error.code, error.message, { details: error.details })
      throw problem(400, 'invalid_operation_plan', error.message)
    }
    slate = result.slate
    applied.push(result)
  }
  return { slate, applied }
}

const summary = (drawn) => ({
  ok: true,
  kind: drawn.kind,
  notes: drawn.notes,
  frames: drawn.frames,
  lines: drawn.lines,
  created: drawn.created,
  warnings: drawn.warnings,
  message: `Imported a Mermaid ${{ flowchart: 'flowchart', mindmap: 'mind map', gantt: 'Gantt chart' }[drawn.kind]}: ${drawn.notes} note${drawn.notes === 1 ? '' : 's'}, ${drawn.lines} line${drawn.lines === 1 ? '' : 's'}${drawn.frames ? `, ${drawn.frames} frame${drawn.frames === 1 ? '' : 's'}` : ''}.`,
})

async function importInto(principal, input, model, { deps, mode, now, idempotencyKey }) {
  const slate = await editableSlate(principal, input.shareId, deps)
  // A workshop's lanes and cards are drawn beside the slate's own notes; other kinds keep their own drawing.
  if (slate.creative?.model && slate.creative.model.kind !== 'workshop')
    throw problem(400, 'invalid_operation_plan', 'This type of slate keeps its own drawing. Import Mermaid into an ordinary slate or a new one.')
  const drawnNow = slatePreview(slate).nodes
  const drawn = diagramPlans(model, {
    existingIds: drawnNow.map((node) => node?.options?.id).filter((id) => typeof id === 'string'),
    existingConnectorIds: drawnNow.flatMap((node) => (node?.relationships?.associations || []).map((a) => a.id).filter(Boolean)),
    origin: importOrigin(drawnNow),
    // The new notes take after the slate's own last note, as a note a person adds does.
    noteStyle: lastNoteLook(slate.nodes),
  })
  const url = new URL('/canvas/' + slate.shareId, deps.appOrigin()).href
  if (mode === 'preview') {
    applyAll(deps, slate, drawn.plans)
    return { status: 200, body: { ...summary(drawn), shareId: slate.shareId, url, revision: slate.revision ?? 0 } }
  }
  let result
  let saved
  try {
    saved = await deps.saveCore.save({
      slateId: slate._id,
      actor: principal,
      source: 'mermaid',
      // Adding notes never conflicts; the revision read is named as every edit names it.
      expectedRevision: slate.revision ?? 0,
      conditions: { userId: slate.userId, orgId: slate.orgId ?? null, ...sharedSaveConditions(slate, principal.userId) },
      build(current) {
        result = applyAll(deps, current, drawn.plans)
        return { set: { nodes: result.slate.nodes } }
      },
    })
  } catch (error) {
    if (error?.code === 'slate_changed' || error?.code === 'save_refused')
      throw problem(409, 'slate_changed', 'The slate changed while the import was being drawn. Retry.')
    throw error
  }
  // One run per plan, in order: open canvases draw each (SlateOperationListener) as an agent's edit.
  const at = now()
  for (const [index, { materializedPlan, report }] of result.applied.entries()) {
    await deps.operationRuns.insertAsync({
      userId: principal.userId,
      tokenId: principal.tokenId,
      slateId: slate._id,
      slateShareId: slate.shareId,
      idempotencyKey: index === 0 ? idempotencyKey || null : null,
      revision: saved.revision,
      plan: materializedPlan,
      userMessage: USER_MESSAGE,
      report,
      createdAt: at + index,
      expiresAt: runExpiry(at + index),
    })
  }
  return { status: 201, body: { ...summary(drawn), shareId: slate.shareId, url, revision: saved.revision } }
}

async function importNew(principal, input, model, { deps, mode, now }) {
  const user = await deps.loadUser(principal.userId)
  if (!user || user.isAnonymous) throw problem(403, 'registration_required', 'Create an account to do this.')
  const drawn = diagramPlans(model, { origin: importOrigin([]) })
  const name = (input.name ?? drawn.title ?? 'Imported diagram').toString().trim().slice(0, 200) || 'Imported diagram'
  const start = { options: { name, description: '', ...(drawn.mindMap && { mindMapMode: true }) }, nodes: [] }
  const { slate: content } = applyAll(deps, start, drawn.plans)
  if (mode === 'preview') return { status: 200, body: { ...summary(drawn), shareId: null, url: null, revision: 0 } }
  const shareId = await deps.generateShareId()
  const row = privateSlateDocument({ content: { options: content.options, nodes: content.nodes }, id: deps.newId(), user, shareId, now: now() })
  const made = await deps.saveCore.create({ row, actor: principal, source: 'mermaid' })
  return {
    status: 201,
    body: { ...summary(drawn), shareId, url: new URL('/canvas/' + shareId, deps.appOrigin()).href, revision: made.revision },
  }
}

export default defineAction({
  id: 'slates.importMermaid',
  title: 'Draw Mermaid',
  description:
    'Draw a Mermaid flowchart, mind map or Gantt chart as real notes and lines, laid out in the diagram\'s direction (subgraphs and Gantt sections become frames). With shareId the diagram is added beside what that slate holds (it needs edit access; everyone on the slate sees it drawn); without, it becomes a new private slate of yours named name (or the diagram\'s title). Mermaid in a Markdown ```mermaid block is read too. Another kind of diagram is refused with 422 mermaid_unsupported; a mistake with 400 mermaid_invalid naming its line; a diagram past a slate\'s limits (1,000 notes counting frames, 5,000 lines, frames 50 deep, or a subgraph too big for one frame) with 422 mermaid_too_large. mode "preview" shows what would be drawn without saving.',
  toolset: 'slates',
  kind: 'write',
  scope: 'slates:write',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/slates/mermaid', operationId: 'importMermaid' } },
  modes: ['save', 'preview'],
  idempotency: 'optional',
  replay: 'stored',
  // The largest body any route takes (the instance descriptor's requestBodyBytes): 100,000
  // characters of Mermaid fit; text past that is refused with 413 payload_too_large.
  bodyLimit: '128kb',
  input: {
    type: 'object',
    properties: {
      mermaid: {
        type: 'string',
        minLength: 1,
        maxLength: MERMAID_MAX_LENGTH,
        description: 'Mermaid source (flowchart/graph, mindmap or gantt), or Markdown holding a ```mermaid block.',
      },
      shareId: { ...shareIdInput, description: 'Add to this slate. Leave out to make a new private slate.' },
      name: { type: 'string', minLength: 1, maxLength: 200, description: 'The new slate\'s name (without shareId).' },
    },
    required: ['mermaid'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      mode: { type: 'string', enum: ['save', 'preview'] },
      shareId: { type: ['string', 'null'] },
      url: { type: ['string', 'null'] },
      revision: { type: 'integer', minimum: 0 },
      kind: { type: 'string', enum: ['flowchart', 'mindmap', 'gantt'] },
      notes: { type: 'integer' },
      frames: { type: 'integer' },
      lines: { type: 'integer' },
      created: { type: 'array', items: { type: 'string' }, description: 'The ids of the notes drawn (frames first).' },
      warnings: { type: 'array', items: { type: 'string' } },
      message: { type: 'string' },
    },
    required: ['ok', 'mode', 'shareId', 'kind', 'notes', 'lines', 'message'],
  },
  failure: { code: 'mermaid_import_failed', message: 'The diagram could not be drawn. Retry with the same key.' },
  tool: { name: 'import_mermaid', title: 'Draw a mind map, flowchart or Gantt plan', description: 'Draw an editable mind map, brainstorm, flowchart or project plan (Gantt chart) on a shared slate, from an outline written in Mermaid (flowchart/graph, mindmap or gantt), on a new slate or beside what an existing slate holds. Returns the slate link, where the team edits it live and can present it.' },
  handler(principal, input, ctx) {
    let model
    try {
      model = parseMermaid(input.mermaid)
    } catch (error) {
      throw mermaidProblem(error)
    }
    return input.shareId === undefined ? importNew(principal, input, model, ctx) : importInto(principal, input, model, ctx)
  },
})
