import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { requireAIControlAdmin } from './ai-control-get.mjs'

// The AI control audit trail (spec 1.8, 3.7): who changed the AI configuration, when, through
// what, why, and what it was before and after. Keys never appear: a key-bearing value is
// { redacted: true, fingerprint }. Rows are kept 400 days (settings.ai.auditDays).
const TIME = { type: 'string', pattern: '^[0-9][0-9TZ:.+-]{9,34}$' }
// a previous answer's next: '<time>|<row id>'
const CURSOR = { type: 'string', pattern: '^[0-9][0-9TZ:.+-]{9,34}(\\|[A-Za-z0-9_-]{1,64})?$' }

export default defineAction({
  id: 'ai.audit.list',
  title: 'AI control changes',
  description:
    'Lists changes to the AI configuration, newest first: AI control changes, ai.update (connections and feature choices at any level) and persona saves (chatIntentions.save). Each row has who (account and the name of the person, or "a deleted account"; person or agent, token, and via ddp, http or exec), the action, what it changed, the reason, before and after (keys only as fingerprints), and whether it was refused. Filter by action (exact, or a prefix ending in a dot such as ai.control.), kind, id, userId, outcome and time; pass next as before for the next page. Administrators only.',
  toolset: 'admin',
  kind: 'read',
  scope: 'ai:admin:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/ai/control/audit', operationId: 'listAIControlAudit' } },
  tool: { name: 'list_ai_control_changes', title: 'List AI configuration changes', description: 'List who changed this server\'s AI configuration, when, why, and what changed. Keys appear only as fingerprints. Administrators only.' },
  input: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 200 },
      before: CURSOR,
      since: TIME,
      action: { type: 'string', pattern: '^[a-z][A-Za-z.]{0,79}$' },
      kind: { type: 'string', pattern: '^[A-Za-z]{1,40}$' },
      id: { type: 'string', pattern: '^[A-Za-z0-9_.:|@-]{1,200}$' },
      userId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
      outcome: { type: 'string', enum: ['ok', 'refused'] },
    },
    additionalProperties: false,
  },
  output: { type: 'object', properties: { rows: { type: 'array', items: { type: 'object' } }, next: { type: ['string', 'null'] } } },
  handler: async (principal, input, { deps }) => {
    await requireAIControlAdmin(principal, deps)
    for (const name of ['before', 'since']) {
      if (input[name] !== undefined && Number.isNaN(Date.parse(input[name].split('|')[0]))) {
        throw problem(400, 'invalid_request', `${name} is a time, such as 2026-11-24T10:00:00Z.`, { details: { field: name } })
      }
    }
    return deps.aiControlOps.listAudit(input)
  },
})
