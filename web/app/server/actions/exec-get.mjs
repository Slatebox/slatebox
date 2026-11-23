// GET /api/v1/exec/{execId}: your own record of one script run (kept 30 days). Code is kept
// for runs on this server only; a local run's record has its calls but never its code.
import { defineAction } from './registry.mjs'
import { EXEC_ID_PATTERN } from './exec-schemas.mjs'

export default defineAction({
  id: 'exec.get',
  title: 'Read the record of a script run',
  description:
    'Returns the record of one of your exec runs: intent, status, every call with its outcome, counters, and the code for runs on this server. Another token\'s run answers 404.',
  toolset: 'exec',
  kind: 'read',
  scope: null,
  principals: ['agent'],
  mounts: { http: { method: 'GET', path: '/exec/{execId}', operationId: 'getExec' } },
  input: {
    type: 'object',
    properties: { execId: { type: 'string', pattern: EXEC_ID_PATTERN } },
    required: ['execId'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      execId: { type: 'string' },
      surface: { type: 'string', enum: ['api', 'mcp', 'app', 'local'] },
      intent: { type: 'string' },
      status: { type: 'string' },
      mode: { type: 'string' },
      codeSha256: { type: 'string' },
      code: { type: 'string' },
      calls: { type: 'array', items: { type: 'object' } },
      counters: { type: 'object' },
      startedAt: { type: ['string', 'null'] },
      endedAt: { type: ['string', 'null'] },
      expiresAt: { type: ['string', 'null'] },
    },
    required: ['execId', 'surface', 'status', 'calls'],
  },
  handler: (principal, input, { deps }) => deps.exec.get(principal, input.execId),
})
