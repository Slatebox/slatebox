// POST /api/v1/exec: run a script against the typed `slatebox` client in the sealed runner on
// this server. The hosted /mcp endpoint calls this action too, so an exec request is admitted,
// rate-limited and audited like any action. HTTP 200 whenever the script ran, whatever its
// status; an error status only when it did not run (400, 401, 409 confirmation_invalid,
// 429 rate_limited or exec_busy, 503 exec_unavailable).
import { defineAction } from './registry.mjs'
import { execOutput, execRunInput } from './exec-schemas.mjs'

export default defineAction({
  id: 'exec.run',
  title: 'Run a Slatebox script',
  description:
    'Runs a short JavaScript or TypeScript program against the typed slatebox client, in the sealed runner on this server. Every call the script makes is checked as your own token\'s call. mode "preview" previews every write. A held change answers status confirmation_required; run the same code again with confirm and the same idempotencyKey once the person agrees.',
  toolset: 'exec',
  kind: 'write',
  scope: null,
  principals: ['agent'],
  mounts: { http: { method: 'POST', path: '/exec', operationId: 'runExec' } },
  modes: ['save', 'preview'],
  // Replay safety comes from the keys derived per call inside the script, so a rerun runs the
  // code again and its saved writes replay; no stored exec answer is replayed.
  idempotency: 'none',
  destructive: true,
  bodyLimit: '128kb',
  input: execRunInput,
  output: execOutput,
  failure: { code: 'exec_failed', message: 'The script could not be run. Retry with the same idempotencyKey.' },
  async handler(principal, input, { deps, mode }) {
    const body = await deps.exec.run({
      principal,
      surface: principal.via === 'mcp' ? 'mcp' : 'api',
      intent: input.intent,
      code: input.code,
      mode,
      confirm: input.confirm,
      idempotencyKey: input.idempotencyKey,
    })
    return { status: 200, body }
  },
})
