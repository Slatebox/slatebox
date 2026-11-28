// A recipe run without the runtime, for the Slack, Google and generic recipe tests (MIT, test
// support; the runtime's own world is scripts/fakes/recipe-world.mjs on feat/recipes-runtime): a RecipeContext in the shape of design B.7 (instance, run, now, vendor, ai, ledger,
// slates, setCursor, log, emit, quarantine, budget), a fake model that answers from the prompt, a
// fake Slack Web API with per-method counters, and the memory read gates. No network anywhere.

/** The read gate (slackReadGates) in memory: claimed once per period per id. */
export function memoryGates() {
  const rows = new Map()
  return {
    async claim(id, at, until) {
      const row = rows.get(id)
      if (row && row.nextAt > at) return false
      rows.set(id, { nextAt: until })
      return true
    },
    get: async (id) => rows.get(id) || null,
    async hold(id, until) {
      const row = rows.get(id)
      rows.set(id, { nextAt: row && row.nextAt > until ? row.nextAt : until })
    },
    rows,
  }
}

/**
 * A fake Slack Web API: call(token, method, params) answers from the world.
 * world: { token, channels: [{ id, name, members: [userId], private? }], users: { id: name },
 *          me: userId, search(query, page) → { matches, pages }, replies: { [ts]: [message] },
 *          posted: [] (chat.postMessage), refuse: { [method]: code }, limited: { [method]: seconds } }
 */
export function fakeSlackApi(world) {
  const counts = {}
  world.posted = world.posted || []
  const call = async (token, method, params = {}) => {
    counts[method] = (counts[method] || 0) + 1
    if (token !== world.token) throw Object.assign(new Error('Slack answered invalid_auth'), { code: 'invalid_auth', slack: 'invalid_auth', name: 'SlackRecipeError' })
    if (world.limited?.[method]) throw Object.assign(new Error('Slack answered ratelimited'), { code: 'ratelimited', slack: 'ratelimited', retryAfter: world.limited[method] })
    if (world.refuse?.[method]) throw Object.assign(new Error('Slack answered ' + world.refuse[method]), { code: world.refuse[method], slack: world.refuse[method] })
    if (method === 'users.conversations') return { ok: true, channels: world.channels.filter((c) => c.members.includes(world.me)).map((c) => ({ id: c.id, name: c.name, is_private: Boolean(c.private) })) }
    if (method === 'users.info') return world.users[params.user] ? { ok: true, user: { id: params.user, profile: { display_name: world.users[params.user] } } } : { ok: true, user: { id: params.user } }
    if (method === 'search.messages') {
      const answer = world.search ? world.search(params.query, Number(params.page) || 1) : { matches: [], pages: 1 }
      return { ok: true, messages: { matches: answer.matches, paging: { pages: answer.pages || 1 } } }
    }
    if (method === 'conversations.replies') return { ok: true, messages: (world.replies?.[params.ts] || []).slice(0, Number(params.limit) || 15) }
    if (method === 'chat.postMessage') {
      const ts = `17650000${String(world.posted.length).padStart(2, '0')}.000100`
      world.posted.push({ channel: params.channel, text: params.text, ts })
      return { ok: true, ts, channel: params.channel }
    }
    if (method === 'chat.getPermalink') return { ok: true, permalink: `https://acme.slack.com/archives/${params.channel}/p${String(params.message_ts).replace('.', '')}` }
    return { ok: false, error: 'unknown_method' }
  }
  return { call, counts }
}

/**
 * A fake model: answer(prompt, schema, purpose) → object | null. Records each call's purpose and size
 * (characters / 4 as tokens), and returns null once off or past maxIn.
 */
export function fakeAi(answer = () => null) {
  const calls = []
  return {
    calls,
    off: false,
    async json({ prompt, schema, maxIn, maxOut, purpose }) {
      const tokensIn = Math.ceil(String(prompt).length / 4)
      calls.push({ purpose, tokensIn, maxIn, maxOut })
      if (this.off || tokensIn > maxIn) return null
      return answer(prompt, schema, purpose)
    },
  }
}

/**
 * A RecipeContext (design B.7). instance { _id, name, config, cursor, projectId };
 * vendor { slack?, google? }; ai (fakeAi) or null; now (ms) or a clock { now() };
 * slates { [role + ':' + key]: { slate, revision } }; project { listSlates(), recipes() }.
 */
export function recipeContext({ instance, vendor = {}, ai = null, now = Date.parse('2026-11-27T18:00:00Z'), trigger = { kind: 'manual' }, mode = 'run', slates = {}, project = null, budget = null }) {
  const clock = typeof now === 'object' ? now : { now: () => now }
  const events = []
  const logs = []
  const ledger = new Map()
  const tombstones = new Set()
  instance.cursor = instance.cursor || {}
  const ctx = {
    instance: { id: instance._id, name: instance.name, config: instance.config, cursor: instance.cursor, projectId: instance.projectId },
    run: { id: 'run-' + Math.random().toString(36).slice(2, 8), trigger, mode },
    signal: new AbortController().signal,
    now: () => clock.now(),
    vendor,
    ai: ai || { json: async () => null },
    ledger: {
      get: async (key) => ledger.get(key) || null,
      upsert: async (rows) => rows.forEach((row) => ledger.set(row.key, row)),
      since: async (at, kind) => [...ledger.values()].filter((r) => (!kind || r.kind === kind) && Date.parse(r.at) >= at),
      tombstone: async (key) => tombstones.add(key),
      isTombstoned: async (key) => tombstones.has(key),
    },
    slates: {
      read: async (role, key) => slates[role + ':' + key] || null,
      mermaid: async () => null,
    },
    ...(project && { project }),
    setCursor(patch) {
      Object.assign(instance.cursor, patch)
      ctx.instance.cursor = instance.cursor
    },
    log: (level, code, msg) => logs.push({ level, code, msg }),
    // The runtime's rule for a recipe's own events (enterprise/common/recipes/events.mjs OWN_EVENT_DATA):
    // a flat object of scalars or lists of scalars, strings at most 300 characters.
    emit(event, data) {
      for (const [key, value] of Object.entries(data)) {
        const scalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v) && (typeof v !== 'string' || v.length <= 300)
        if (!(scalar(value) || (Array.isArray(value) && value.length <= 200 && value.every((v) => v !== null && scalar(v))))) throw new Error(`${event}.${key} is not a flat value`)
      }
      events.push({ event, data })
    },
    quarantine: (value) => value,
    budget: budget || { left: () => ({ vendorCalls: 200, tokensIn: 60000, tokensOut: 6000, ops: 400 }) },
  }
  return { ctx, events, logs, ledger }
}

/** A run budget that counts (take returns false past the limit). */
export function countingBudget(limits = { vendorCalls: 200 }) {
  const used = {}
  return {
    used,
    take(kind, n = 1) {
      used[kind] = (used[kind] || 0) + n
      return used[kind] <= (limits[kind] ?? Infinity)
    },
    left: () => Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, v - (used[k] || 0)])),
  }
}
