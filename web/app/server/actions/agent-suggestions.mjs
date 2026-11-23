// What agents suggest on a slate, and what people do with it, on every surface (the canvas's
// Keep and Discard on each ghost and on an agent's chip, REST, exec, the MCP tools):
//   suggestions.list    anyone who may open the slate: what is waiting, and each agent's activity
//   suggestions.decide  keep or discard waiting suggestions, or undo one agent action (kept
//                       suggestions, or a direct edit): whoever may edit the slate; an agent never
//                       keeps its own (a person does, or lets it edit directly)
//   agents.control      people only (the app): pause or resume every agent on the slate, or let one
//                       agent edit directly (settings.public.agents.editDirectly)
// The store and its rules: server/agents/suggestions.mjs.
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { loadSlate } from './slate-access.mjs'
import { shareIdInput } from './slate-schemas.mjs'
import { applyToCanvas } from './slate-operations.mjs'
import { publicAction } from '../agents/suggestions.mjs'

const id64 = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' }
const agentIdInput = { ...id64, description: "The agent's id on this slate, as suggestions.list gives it (agents[].agentId)." }
const actionIdInput = { ...id64, description: 'The action, as list_suggestions gives it (actions[].actionId).' }

const storeOf = (deps) => {
  if (!deps.suggestions) throw problem(501, 'not_available', 'Agent suggestions are not available on this server.')
  return deps.suggestions
}

// A signed-in page by the session's rule (deps.resolveSlateForUser), a token by its account's
// rule on the slate (authorizeTokenForSlate). write: the edit right is needed.
const loadFor = (write) => async (principal, input, ctx) => {
  if (principal.kind === 'person' || principal.kind === 'guest') {
    const found = await ctx.deps.resolveSlateForUser(input.shareId, principal.userId)
    if (!found?.slate || !found.canRead) throw problem(404, 'not_found', 'Slate not found or unavailable.')
    if (write && !found.canEdit)
      throw problem(403, 'edit_role_required', 'Only people who can edit this slate keep, discard or undo what agents do on it.')
    ctx.access = { canEdit: Boolean(found.canEdit) }
    return found.slate
  }
  return loadSlate(write)(principal, input, ctx)
}

// Saves a kept suggestion or an undo through the edit path, as whoever kept or undid it.
const saverFor = (ctx) => async (principal, slate, plan, attribution) => {
  const result = await applyToCanvas(principal, { plan, userMessage: '', expectedRevision: slate.revision ?? 0 }, {
    ...ctx, mode: 'save', idempotencyKey: null, resource: slate, attribution,
  })
  return { revision: result.body.revision }
}

const editDirectlyOn = (deps) => Boolean(deps.agentOptions?.editDirectly?.())

const itemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    kind: { type: 'string', enum: ['add', 'update', 'remove', 'link', 'unlink'] },
    state: { type: 'string', enum: ['pending', 'kept', 'discarded', 'applied', 'undone', 'refused'] },
    nodeId: { type: 'string' },
    node: { type: 'object', description: 'add: the note as it would be stored.' },
    changes: { type: 'object', description: 'update: the note keys the agent changes.' },
    previous: { type: 'object', description: 'update: what those keys were.' },
    parentId: { type: 'string' },
    association: { type: 'object', description: 'link / unlink: the line.' },
    reason: { type: 'string', description: 'refused: why it could not be kept.' },
    decidedBy: { type: 'string', description: 'The first name of whoever kept or discarded it.' },
  },
  required: ['id', 'kind', 'state'],
}
const actionSchema = {
  type: 'object',
  properties: {
    actionId: { type: 'string' },
    agentId: { type: 'string' },
    label: { type: 'string' },
    origin: { type: ['string', 'null'], description: 'visiting (its own MCP client), invited, or slatebox.' },
    via: { type: ['string', 'null'] },
    invitedBy: { type: ['string', 'null'] },
    summary: { type: 'string', description: 'What it suggests, in plain words: "2 new notes and 1 line".' },
    message: { type: ['string', 'null'] },
    mode: { type: 'string', enum: ['suggest', 'direct'] },
    createdAt: { type: 'string' },
    undoable: { type: 'boolean' },
    undone: { type: 'boolean' },
    items: { type: 'array', items: itemSchema },
  },
  required: ['actionId', 'agentId', 'label', 'summary', 'mode', 'items'],
}

const list = defineAction({
  id: 'suggestions.list',
  title: 'Suggestions',
  description:
    'What agents suggested on a slate and what became of it: every suggestion still waiting (people on the slate see each as a ghost with Keep and Discard), and each agent\'s recent actions (kept, discarded, undone, applied directly). Also whether agents are paused there and how each agent\'s edits land (suggest or direct).',
  toolset: 'slates',
  kind: 'read',
  scope: 'slates:read',
  // The canvas reads this; a token reads the same list with the slate (slates.get include=suggestions).
  principals: ['person', 'guest'],
  mounts: { ddp: true },
  input: {
    type: 'object',
    properties: {
      shareId: shareIdInput,
      agentId: { ...agentIdInput, description: 'Only this agent\'s.' },
    },
    required: ['shareId'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      shareId: { type: 'string' },
      paused: { type: 'boolean' },
      editDirectly: { type: 'boolean', description: 'Whether people here may let an agent edit directly.' },
      agents: {
        type: 'array',
        items: { type: 'object', properties: { agentId: { type: 'string' }, label: { type: 'string' }, mode: { type: 'string', enum: ['suggest', 'direct'] }, waiting: { type: 'integer' } }, required: ['agentId', 'label', 'mode', 'waiting'] },
      },
      actions: { type: 'array', items: actionSchema },
    },
    required: ['shareId', 'paused', 'editDirectly', 'agents', 'actions'],
  },
  load: loadFor(false),
  async handler(principal, input, { deps, resource: slate }) {
    const store = storeOf(deps)
    const [actions, controls] = await Promise.all([store.list(slate._id), store.controlsOf(slate._id)])
    const shown = actions.filter((action) => !input.agentId || action.agentId === input.agentId)
    const agents = new Map()
    for (const action of shown) {
      const agent = agents.get(action.agentId) || { agentId: action.agentId, label: action.label, mode: controls.modes[action.agentId] === 'direct' && editDirectlyOn(deps) ? 'direct' : 'suggest', waiting: 0 }
      agent.label = action.label
      agent.waiting += action.items.filter((item) => item.state === 'pending').length
      agents.set(action.agentId, agent)
    }
    return { shareId: slate.shareId, paused: controls.paused, editDirectly: editDirectlyOn(deps), agents: [...agents.values()], actions: shown.map(publicAction) }
  },
})

const decide = defineAction({
  id: 'suggestions.decide',
  title: 'Keep/discard/undo',
  description:
    'Decide what an agent\'s work on a slate becomes, as the canvas does. keep or discard: what it suggested, as Keep and Discard on each ghost: name the action (actionId, from your edit or slates.get include=suggestions), optionally some of its items (itemIds); Keep all on an agent\'s chip decides each of its actions. Keeping saves them as one change (a line brings the new notes at its ends); an item whose note is gone is refused and says why. Discarding saves nothing. undo: one action (actionId) that was kept or saved directly, as Undo in the agent\'s activity list: only that action, and only what nobody changed since (left[] says what stayed and why), so it never undoes another agent\'s work or a person\'s. Needs the edit right on the slate; an agent cannot keep its own suggestions.',
  toolset: 'slates',
  kind: 'write',
  // Keeping a suggested removal, or undoing an added note, removes a note.
  destructive: true,
  removes: (input) => input?.decision !== 'discard',
  scope: 'slates:write',
  principals: ['person', 'guest', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/slates/{shareId}/suggestions/decide', operationId: 'decideSuggestions' } },
  idempotency: 'optional',
  replay: 'stored',
  input: {
    type: 'object',
    properties: {
      shareId: shareIdInput,
      decision: { type: 'string', enum: ['keep', 'discard', 'undo'] },
      actionId: actionIdInput,
      itemIds: { type: 'array', minItems: 1, maxItems: 200, items: id64, description: 'Only these items of the action.' },
    },
    required: ['shareId', 'decision', 'actionId'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      shareId: { type: 'string' },
      revision: { type: 'integer' },
      kept: { type: 'array', items: { type: 'object' } },
      discarded: { type: 'array', items: { type: 'object' } },
      refused: { type: 'array', items: { type: 'object' } },
      undone: { type: 'array', items: { type: 'string' }, description: 'undo: the items undone.' },
      left: { type: 'array', items: { type: 'object' }, description: 'undo: the items left as they are, each with its reason.' },
    },
    required: ['ok', 'shareId'],
  },
  precheck(_principal, input) {
    if (input.decision === 'undo' && input.itemIds)
      throw problem(400, 'invalid_request', 'undo takes the whole action: send its actionId without itemIds.')
  },
  load: loadFor(true),
  failure: { code: 'decide_failed', message: 'The agent\'s work could not be kept, discarded or undone. Retry.' },
  tool: { name: 'decide_suggestions', title: 'Keep, discard or undo agent work', description: 'Keep (save) or discard what an agent suggested on a slate (one action or some of its items), or undo one agent action that was kept or saved directly.' },
  async handler(principal, input, ctx) {
    const { deps, resource: slate } = ctx
    decide.precheck(principal, input)
    const store = storeOf(deps)
    const choice = { actionId: input.actionId, itemIds: input.itemIds }
    if (input.decision === 'undo') {
      const out = await store.undo(principal, slate, { actionId: input.actionId }, saverFor(ctx))
      return { ok: true, shareId: slate.shareId, ...out }
    }
    if (input.decision === 'discard') {
      const out = await store.discard(principal, slate, choice)
      return { ok: true, shareId: slate.shareId, revision: slate.revision ?? 0, ...out }
    }
    const out = await store.keep(principal, slate, choice, saverFor(ctx))
    return { ok: true, shareId: slate.shareId, ...out }
  },
})

const control = defineAction({
  id: 'agents.control',
  title: 'Pause agents or set how one edits',
  // People's controls over agents (the roster's Pause all agents and an agent's Edit directly): an
  // agent never resumes agents or widens an agent's rights, so this is not on the token surfaces.
  description:
    'On a slate: paused true stops every agent\'s edits there (Pause all agents), paused false lets them edit again; agentId with editing "direct" lets that agent\'s edits save at once (each one undoable), editing "suggest" puts it back to suggesting. Needs the edit right. "direct" is offered where settings allow it (settings.public.agents.editDirectly).',
  toolset: 'slates',
  kind: 'write',
  scope: 'slates:write',
  principals: ['person', 'guest'],
  mounts: { ddp: true },
  input: {
    type: 'object',
    properties: {
      shareId: shareIdInput,
      paused: { type: 'boolean' },
      agentId: agentIdInput,
      editing: { type: 'string', enum: ['suggest', 'direct'], description: 'How that agent\'s edits land: suggest (ghosts for a person to keep) or direct (saved at once, each undoable).' },
    },
    required: ['shareId'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      shareId: { type: 'string' },
      paused: { type: 'boolean' },
      modes: { type: 'object', description: 'agentId: "direct" for each agent that edits directly.' },
    },
    required: ['ok', 'shareId', 'paused', 'modes'],
  },
  precheck(principal, input) {
    if (input.paused === undefined && input.editing === undefined) throw problem(400, 'invalid_request', 'Send paused, or agentId with editing.')
    if ((input.editing === undefined) !== (input.agentId === undefined)) throw problem(400, 'invalid_request', 'editing and agentId go together.')
    if (principal.kind !== 'person' && input.editing === 'direct')
      throw problem(403, 'person_required', 'Only a signed-in person who can edit the slate lets an agent edit directly.')
  },
  load: loadFor(true),
  failure: { code: 'control_failed', message: 'Agents could not be paused or changed. Retry.' },
  async handler(principal, input, { deps, resource: slate }) {
    control.precheck(principal, input)
    const store = storeOf(deps)
    let state = await store.controlsOf(slate._id)
    if (input.editing === 'direct' && !editDirectlyOn(deps))
      throw problem(403, 'edit_directly_off', 'Letting an agent edit directly is not available here yet. Its edits stay suggestions.')
    if (input.paused !== undefined) state = await store.pause(slate._id, input.paused, principal)
    if (input.editing !== undefined) state = await store.setMode(slate._id, input.agentId, input.editing)
    return { ok: true, shareId: slate.shareId, paused: state.paused, modes: state.modes }
  },
})

export default [list, decide, control]
