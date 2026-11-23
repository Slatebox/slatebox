// Assembles exec for one app process: the client manifest (from the registry itself), the
// gate, the sealed runner pool, the stores and the service. The Meteor side (meteor.js) and the
// tests both build exec here, so they run the same wiring.
import { buildClientManifest, renderPrelude, wrapScript } from '../actions/client-render.mjs'
import { createGate } from './gate.mjs'
import { createExecStore } from './audit.mjs'
import { createRunnerPool } from './runner-pool.mjs'
import { createExecService } from './service.mjs'
import { createCodeRedactor } from './redact.mjs'
import { EXEC_LIMITS } from './limits.mjs'
import { problem } from '../actions/errors.mjs'

export function createExecSystem({
  registry,
  idempotency, // the registry's idempotency store: a derived key it already completed is a replay
  collections, // { runs, confirmations, locks } MongoDB driver collections
  readSlate,
  audienceOf,
  childPath,
  runEntry,
  nodePath,
  limits = EXEC_LIMITS,
  now = Date.now,
  log,
  pool: sharedPool, // another system's pool: one runner child per app process
  presence = null, // the agent presence store: a run's pointer ends with the run
}) {
  const manifest = buildClientManifest(registry)
  const prelude = renderPrelude(manifest, { logBytes: limits.logBytes })
  const store = createExecStore({ ...collections, now, auditDays: limits.auditDays })
  const isReplay = async (subject, key) => (await idempotency?.get(subject, key))?.state === 'done'
  const gate = createGate({ registry, manifest, limits, readSlate, audienceOf, isReplay, store, now })
  const pool = sharedPool || createRunnerPool({ childPath, runEntry, limits, nodePath, now, ...(log && { log }) })
  const service = createExecService({ gate, pool, store, wrap: (code) => wrapScript(prelude, code), limits, now, presence, redact: createCodeRedactor(registry), ...(log && { log }) })
  return { manifest, prelude, store, gate, pool, service }
}

// The registry every HTTP route is mounted with: a call that carries exec headers goes through
// the gate as a script's call; an agent's call without them meets the same holds (a removal
// waits for a yes) through gate.directCall; a person's call goes straight to the registry.
export const gatedRegistry = (registry, gate) => ({
  ...registry,
  run: (principal, id, input, options = {}) => {
    if (options.exec) {
      if (options.confirm !== undefined)
        return Promise.reject(problem(400, 'invalid_request', 'A script sends its confirmation as Slatebox-Exec-Confirm.'))
      return gate.httpCall(principal, id, input, options)
    }
    return gate.directCall(principal, id, input, options)
  },
})
