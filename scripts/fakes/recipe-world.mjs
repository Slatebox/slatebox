// The whole recipes runtime wired over fakes, for its tests (MIT, test support): one in-memory
// database, the fake Projects interface, the fake app side (slates with the real engine applier),
// a recorded fetch for webhooks, a fixed clock, and the real queue, scheduler, runner, permissions,
// webhooks and service. One world may run several "pods" (createPod) over the same database.
import { createRecipeStore } from '../../enterprise/server/recipes/store.mjs'
import { createRecipeQueue, createScheduler } from '../../enterprise/server/recipes/queue.mjs'
import { createRunner } from '../../enterprise/server/recipes/runner.mjs'
import { createPermissions } from '../../enterprise/server/recipes/permissions.mjs'
import { createOutbound } from '../../enterprise/server/recipes/webhooks/outbound.mjs'
import { createInbound } from '../../enterprise/server/recipes/webhooks/inbound.mjs'
import { createIntercepts } from '../../enterprise/server/recipes/webhooks/intercept.mjs'
import { createHookAuthority } from '../../enterprise/server/recipes/webhooks/authority.mjs'
import { createRecipeService } from '../../enterprise/server/recipes/service.mjs'
import { createMemoryDb } from './mongo-memory.mjs'
import { createFakeProjectsApi } from './projects-api.mjs'
import { createFakeSlates } from './recipe-slates.mjs'

export function createRecipeWorld({ recipes = [], now = Date.UTC(2026, 10, 27, 12), via = 'cloud', vendors = {}, realVendors = {}, ai = [] } = {}) {
  const db = createMemoryDb()
  const store = createRecipeStore((name) => db[name])
  let at = now
  const clock = () => at
  const projects = createFakeProjectsApi()
  const slates = createFakeSlates({ slates: projects.slates })
  const audits = []
  const notices = []
  const fetched = []
  const routes = new Map() // url → (request) => { status, body }
  const fetch = async (url, init) => {
    fetched.push({ url, ...init })
    const handler = routes.get(url)
    const answer = handler ? await handler(init) : { status: 404, body: '' }
    if (answer instanceof Error) throw answer
    return new Response(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body ?? {}), { status: answer.status })
  }
  const sealer = { seal: (hookId, plain) => ({ hookId, plain: Buffer.from(plain).toString('base64') }), open: (hookId, sealed) => (sealed?.hookId === hookId ? Buffer.from(sealed.plain, 'base64').toString() : null) }
  const byId = new Map(recipes.map((r) => [r.manifest.id, r]))
  const recipeOf = (id) => byId.get(id) || null
  const state = { serverOff: false, installEnabled: via === 'cloud', orgOff: new Set(), ownerPaused: new Set(), members: new Set() }
  const switches = {
    serverOff: async () => state.serverOff,
    installEnabled: async () => state.installEnabled,
    setInstallEnabled: async (on) => { state.installEnabled = on },
    orgRecipesOff: async (orgId) => state.orgOff.has(orgId),
    ownerPaused: async (userId) => state.ownerPaused.has(userId),
    isMember: async (userId, orgId) => state.members.has(`${userId}:${orgId}`),
    isTeamAdmin: async (userId, orgId) => state.members.has(`${userId}:${orgId}:admin`),
    setOwnerPaused: async (userId, paused) => { if (paused) state.ownerPaused.add(userId); else state.ownerPaused.delete(userId) },
    setOrgRecipesOff: async (orgId, off) => { if (off) state.orgOff.add(orgId); else state.orgOff.delete(orgId) },
  }
  const performed = []
  const vendorPlugins = new Map()
  for (const [name, session] of Object.entries(vendors)) {
    vendorPlugins.set(name, {
      name,
      session: async () => (typeof session === 'function' ? session() : session),
      perform: async (write) => {
        performed.push(write)
        return { ref: `https://example.com/${write.kind}/${performed.length}` }
      },
      checkHardLimits: () => null,
    })
  }
  // Real vendor plug-ins (session, perform, checkHardLimits, resolveMatch as the server runs them), over fake APIs.
  for (const [name, plugin] of Object.entries(realVendors)) vendorPlugins.set(name, plugin)
  const answers = [...ai]
  const aiCalls = []
  const complete = async (request) => {
    aiCalls.push(request)
    const next = answers.shift()
    if (next instanceof Error) throw next
    return { json: next ?? null, tokensIn: 100, tokensOut: 20 }
  }
  let n = 0
  const randomId = () => `id${++n}`

  function createPod(worker = 'a') {
    const queue = createRecipeQueue({ store, clock, worker, randomId })
    const scheduler = createScheduler({ store, clock, queue })
    const hookAllowed = createHookAuthority({ projects: projects.api })
    const outbound = createOutbound({ store, clock, fetch, sealer, randomId, hookAllowed, notify: async (u, m) => { notices.push({ to: u, ...m }) } })
    const intercepts = createIntercepts({ store, clock, fetch, sealer, randomId, hookAllowed })
    const audit = async (entry) => { audits.push(entry) }
    let runner = null
    const permissions = createPermissions({ store, clock, audit, randomId, manifestOf: (id) => recipeOf(id)?.manifest, vendorOf: (kind) => vendorPlugins.get(kind.split('.')[0]), emit: (e) => outbound.emit(e), onRevoked: (instance) => runner.stopInstance(instance, 'paused', 'grant_revoked') })
    runner = createRunner({
      store, queue, clock, recipeOf, projects: projects.api, switches, vendors: vendorPlugins, slates: slates.adapter, permissions, outbound, intercepts, complete,
      audit, notify: async (u, m) => { notices.push({ to: u, ...m }) }, firstName: async (id) => (id === 'ana' ? 'Ana' : null), origin: () => 'https://app.test',
    })
    const service = createRecipeService({
      store, queue, runner, clock, randomId, recipeOf, catalog: () => recipes.map((r) => r.manifest), projects: projects.api, switches, permissions, outbound, sealer,
      checkHookUrl: (url) => { if (!/^https:\/\//.test(url)) throw new Error('Slatebox sends hooks only to https addresses.') },
      slateIdFor: async (principal, shareId) => {
        const slate = [...projects.slates.values()].find((s) => s.shareId === shareId)
        if (!slate) return null
        const role = await projects.api.roleFor(principal.userId, slate.projectId)
        return { slateId: slate._id, canRead: Boolean(role), canEdit: ['editor', 'manager', 'owner'].includes(role) }
      },
      undo: async (principal, slateId, operationRunId) => ({ undone: operationRunId }),
      connected: async () => true, firstName: async (id) => (id === 'ana' ? 'Ana' : null), isServerAdmin: async (id) => id === 'admin', audit,
      resolveMatch: async (manifest, match, ownerId) => (vendorPlugins.get(manifest.integration)?.resolveMatch ? vendorPlugins.get(manifest.integration).resolveMatch(match, ownerId) : match),
      notify: async (u, m) => { notices.push({ to: u, ...m }) },
    })
    const inbound = createInbound({ store, clock, sealer, hookAllowed, manifestOf: (id) => recipeOf(id)?.manifest, enqueue: (instance, trigger) => queue.enqueue(instance, trigger), isOn: async () => !state.serverOff && state.installEnabled })
    /** Claims and runs everything due on this pod. → the outcomes */
    async function drain(max = 20) {
      const out = []
      for (let k = 0; k < max; k += 1) {
        const claimed = await queue.claim()
        if (!claimed) break
        const outcome = await runner.runOne(claimed)
        // the run as recorded (trigger, skippedReason, log), beside what runOne answered
        out.push({ ...outcome, run: await store.runs.findOne({ _id: claimed.run._id }) })
      }
      return out
    }
    return { queue, scheduler, outbound, intercepts, permissions, runner, service, inbound, drain }
  }

  const pod = createPod('a')
  return {
    store, db, clock, advance: (ms) => { at += ms }, projects, slates, audits, notices, fetched, routes, performed, aiCalls, state, sealer,
    createPod, ...pod,
    person: (userId) => ({ kind: 'person', userId }),
    agent: (userId, scopes = ['recipes:read', 'recipes:write', 'recipes:run']) => ({ kind: 'agent', userId, tokenId: `tok_${userId}`, scopes }),
  }
}
