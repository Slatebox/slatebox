// Test helper for the outside-agent service (enterprise/): the app's real suggestion path behind a
// fake registry. An invited agent's save goes through slates.applyOperations' own suggestToCanvas
// and the real suggestion store (server/agents/suggestions.mjs), so its groups become live
// suggestions exactly as every other agent's edits do; keeping saves into the in-memory slate.
import { applyPlanToJSON } from 'slateboxjs/operations'
import { suggestToCanvas } from '../web/app/server/actions/slate-operations.mjs'
import { createSuggestionStore } from '../web/app/server/agents/suggestions.mjs'
import { memoryCollection } from './exec-test-world.mjs'

/**
 * slate: the in-memory stored slate (changed in place when something is kept).
 * presenceCalls: where presence.saved calls are recorded, as ['saved', principal, slate, record].
 * → { store, applied, applyOperations, suggestions, identify, saver }
 */
export function connectorSuggestions(slate, { presenceCalls = [] } = {}) {
  let n = 0
  const applied = []
  // Who an agent is on the slate (presence.identify): an invited agent by its connection.
  const identify = async (principal) => ({
    agentId: 'agent-' + (principal.connector?.id || principal.tokenId),
    label: principal.connector?.name || 'Agent',
    initial: (principal.connector?.name || 'A').charAt(0),
    colorIndex: principal.connector?.colorIndex ?? 1,
    origin: principal.connector ? 'invited' : 'visiting',
    via: null,
    invitedBy: principal.connector ? 'Ada' : null,
    iconUrl: null,
  })
  const store = createSuggestionStore({
    collection: memoryCollection(),
    controls: memoryCollection(),
    identify,
    applyPlan: async () => {
      throw new Error('keep and undo pass their own save')
    },
    findName: async (userId) => userId[0].toUpperCase() + userId.slice(1),
    newId: () => `s${String(++n).padStart(4, '0')}`,
  })
  const deps = {
    suggestions: store,
    applySlateOperationPlanToJSON: applyPlanToJSON,
    saveCore: {
      check({ expectedRevision }) {
        if (expectedRevision !== (slate.revision ?? 0)) throw Object.assign(new Error('The slate changed.'), { code: 'slate_changed' })
      },
    },
    presence: { saved: async (...args) => presenceCalls.push(['saved', ...args]) },
  }
  // The registry's slates.applyOperations as the service calls it: a preview applies in memory; an
  // agent's save is a suggestion (202, outcome suggested).
  async function applyOperations(principal, input, mode) {
    applied.push([principal, input, mode])
    if (mode !== 'save') {
      const result = applyPlanToJSON(structuredClone(slate), input.plan, { requireMatches: false })
      return { status: 200, body: { ok: true, operations: result.materializedPlan.operations, report: result.report } }
    }
    return suggestToCanvas(principal, input, { deps, mode, resource: slate }, await identify(principal, slate))
  }
  // Keeping or undoing saves into the in-memory slate, as the person (suggestions.decide's saver).
  const saver = async (_principal, _slate, plan) => {
    const result = applyPlanToJSON(structuredClone(slate), plan, { requireMatches: true })
    slate.nodes = result.slate.nodes
    slate.revision = (slate.revision ?? 0) + 1
    return { revision: slate.revision }
  }
  const suggestions = {
    agentIdOf: async (principal, s) => (await identify(principal, s)).agentId,
    withdraw: (person, s, agentId) => store.discard(person, s, { agentId }),
    paused: async (s) => (await store.controlsOf(s._id)).paused,
  }
  return { store, applied, applyOperations, suggestions, identify, saver }
}
