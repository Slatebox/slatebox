// A RecipeContext (design B.7) in memory, for the GitHub recipe tests (MIT, test support): the
// only API a recipe sees. The ledger, cursor, emitted events, log lines and model calls are kept
// so a test can read them; budget.spend counts vendor calls and refuses past the run's budget.
// The GitHub vendor session is the real client (enterprise/server/recipes/vendors/github/client.mjs,
// read calls only) over a fake GitHub (github-api.mjs).
import { createGithubClient, createInstallationGate } from '../../enterprise/server/recipes/vendors/github/client.mjs'
import { READ_CALLS } from '../../enterprise/server/recipes/vendors/github/index.mjs'
import { OWN_EVENT_DATA } from '../../enterprise/common/recipes/events.mjs'
import { validate } from '../../web/app/server/actions/schema.mjs'

export function memoryLedger() {
  const rows = new Map()
  const tombs = new Set()
  return {
    rows,
    // As the runtime's ledger (enterprise/server/recipes/context.mjs): a row's data, or null.
    async get(key) {
      return rows.has(key) ? structuredClone(rows.get(key).data ?? null) : null
    },
    async upsert(list) {
      for (const row of list) rows.set(row.key, structuredClone({ ...row, at: row.at ?? Date.now() }))
    },
    async since(at, kind) {
      return [...rows.values()].filter((r) => r.kind === kind && (r.data?.at ?? r.at) >= at).map((r) => structuredClone(r))
    },
    async tombstone(key) {
      tombs.add(key)
      rows.delete(key)
    },
    async isTombstoned(key) {
      return tombs.has(key)
    },
  }
}

/** A budget: { vendorCalls, tokensIn, tokensOut } left; spend(kind, n) → false when it would go past. */
export function testBudget(limits = { vendorCalls: 200, tokensIn: 60000, tokensOut: 6000 }) {
  const used = { vendorCalls: 0, tokensIn: 0, tokensOut: 0 }
  return {
    used,
    spend(kind, n = 1) {
      if (used[kind] + n > (limits[kind] ?? Infinity)) return false
      used[kind] += n
      return true
    },
    left: () => Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, v - used[k]])),
  }
}

/**
 * A context for one run. options: { github (fake), installationId, config, cursor, trigger, ledger,
 * ai: (request) → object|null, budget, now, slates: { read, mermaid } }
 */
export function createTestContext({ github, installationId = '42', instance = {}, config = {}, cursor = {}, trigger = { kind: 'manual' }, ledger = memoryLedger(), ai = null, budget = testBudget(), now = () => Date.parse('2026-11-27T12:00:00Z'), slates = null, runId = 'run-1', mode = 'run' } = {}) {
  const events = []
  const log = []
  const aiCalls = []
  const state = { cursor: structuredClone(cursor) }
  const client = createGithubClient({ fetch: github.fetch, installationId, token: async () => 'ghs_test', gate: createInstallationGate({ now }), budget })
  const session = Object.freeze(Object.fromEntries([...READ_CALLS.map((name) => [name, client[name]]), ['stats', client.stats]]))
  const ctx = {
    instance: { id: instance.id ?? 'inst-1', name: instance.name ?? 'Recipe', config, cursor: state.cursor, projectId: instance.projectId ?? 'proj-1' },
    run: { id: runId, trigger, mode },
    signal: new AbortController().signal,
    now,
    vendor: { github: session },
    ai: {
      async json(request) {
        aiCalls.push(request)
        if (!ai) return null
        if (!budget.spend('tokensIn', request.maxIn ?? 0)) return null
        return ai(request)
      },
    },
    ledger,
    slates: slates || { read: async () => null, mermaid: async () => null },
    setCursor(patch) {
      state.cursor = { ...state.cursor, ...structuredClone(patch) }
    },
    log(level, code, msg) {
      log.push({ level, code, msg: `${msg}`.slice(0, 200) })
    },
    // As the runtime checks a recipe's own events (context.mjs): flat data, names and numbers only.
    emit(event, data) {
      const invalid = validate(OWN_EVENT_DATA, data)
      if (invalid) throw new Error(`${event}: ${invalid.message}`)
      events.push({ event, data })
    },
    quarantine: (value) => value,
    budget: { left: () => budget.left() },
  }
  return { ctx, events, log, aiCalls, state, budget, ledger, client }
}
