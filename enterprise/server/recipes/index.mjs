// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Recipes: agents that keep a project's slates up to date for a person, on a schedule, on their
// integrations' events, by hand or from a webhook. registerRecipes(api, context) is called once from
// enterprise/server/index.js. Nothing is added while settings.recipes.off is set (no actions, no
// routes, no workers). On a self-hosted install the code is here but stays off until an admin turns
// it on in Admin › Recipes (the install switch, store.mjs settings).
//
// Built-in recipes and vendors: each adds one line to RECIPE_MODULES or VENDOR_FACTORIES (and its
// manifest to enterprise/common/recipes/catalog.mjs).
//   recipe module   { manifest: defineRecipe({...}), run: async (ctx) => ({ desired, writes?, summary }) }
//   vendor factory  (deps) => { name, session(instance, { signal, budget }), routes(), matchInstances(event),
//                               perform(write, { instance, grant, signal }), checkHardLimits(write) }
/* eslint-disable no-console */
import { recipeActions } from './actions.mjs'
import { setRecipeHooks } from '/server/recipes-hooks.mjs'

export const RECIPE_MODULES = Object.freeze([
])

export const VENDOR_FACTORIES = Object.freeze([
])

const byId = new Map(RECIPE_MODULES.map((m) => [m.manifest.id, m]))
export const recipeOf = (id) => byId.get(id) || null
export const catalog = () => RECIPE_MODULES.map((m) => m.manifest)

const readRaw = (req, limit) => new Promise((resolve, reject) => {
  if (Buffer.isBuffer(req.body)) return resolve(req.body)
  const chunks = []
  let size = 0
  req.on('data', (chunk) => {
    size += chunk.length
    if (size > limit) {
      reject(Object.assign(new Error('too large'), { status: 413 }))
      req.destroy?.()
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => resolve(Buffer.concat(chunks)))
  req.on('error', reject)
})

const send = (res, status, body, headers = {}) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
  res.end(JSON.stringify(body))
}

/** What an entry the runtime records becomes in the activity log (server/audit). */
export function auditEntry({ action, instance = null, project = null, server = false, details = {} }) {
  if (server) return { scope: 'server', action, target: { type: 'recipe', id: 'install', name: 'Recipes' }, details }
  return {
    action,
    ...(instance && { target: { type: 'recipe', id: instance._id, name: instance.name } }),
    ...(!instance && project && { target: { type: 'recipe', id: String(project), name: 'Project webhooks' } }),
    ...(instance?.orgId && { orgId: instance.orgId }),
    details: Object.fromEntries(Object.entries(details).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 120) : v])),
  }
}

export function registerRecipes(api, context) {
  if (context?.settings?.recipes?.off) return
  let started = null
  const starting = () => Object.assign(new Error('Recipes are starting. Try again in a moment.'), { status: 409, code: 'starting' })
  const running = () => {
    if (!started) throw starting()
    return started.service
  }
  api.addActions(recipeActions(running))
  // A recipe's inbound webhook: its signed body, read raw (server/raw-body-paths.mjs).
  api.addRoute({
    method: 'POST',
    path: '/hooks/recipes/:hookId',
    async handler(req, res) {
      if (!started) return send(res, 503, { error: { code: 'starting', message: 'Recipes are starting. Try again in a moment.' } }, { 'Retry-After': '10' })
      try {
        const rawBody = await readRaw(req, 256 * 1024 + 1)
        const out = await started.inbound.handle({ hookId: req.params?.hookId, headers: req.headers, rawBody })
        return send(res, out.status, out.body, out.headers)
      } catch (error) {
        if (error?.status === 413) return send(res, 413, { error: { code: 'too_large', message: 'The body is over 256 KB.' } })
        console.warn('[recipes] inbound failed', error?.message)
        return send(res, 500, { error: { code: 'internal_error', message: 'The request could not be completed.' } })
      }
    },
  })
  // The vendors' own routes (GitHub App events, Drive pings), each checking its vendor's signature.
  for (const factory of VENDOR_FACTORIES) {
    for (const route of factory.routes?.() || []) {
      api.addRoute({
        method: route.method,
        path: route.path,
        async handler(req, res) {
          if (!started) return send(res, 503, { error: { code: 'starting', message: 'Recipes are starting.' } }, { 'Retry-After': '10' })
          const vendor = started.vendors.get(route.vendor)
          const handler = vendor?.routes?.().find((r) => r.path === route.path && r.method === route.method)?.handler
          if (!handler) return send(res, 404, { error: { code: 'not_found', message: 'Not found.' } })
          const rawBody = route.raw ? await readRaw(req, 1024 * 1024) : undefined
          return handler(req, res, { rawBody, trigger: started.trigger })
        },
      })
    }
  }
  api.onStartup(async () => {
    if (!context.projects) {
      console.warn('[recipes] this server has no projects (context.projects): recipes stay off')
      return
    }
    const { startRecipes } = await import('./meteor.js')
    started = startRecipes({
      via: context.via, isUnlocked: context.isUnlocked || (() => true), projects: context.projects, recipeOf, catalog, vendorFactories: VENDOR_FACTORIES,
      audit: (entry) => api.audit(auditEntry(entry), { coalesce: Boolean(entry.coalesce) }).catch?.(() => {}),
    })
    // The app tells recipes when a person loses access (removed from a team, unshared, account deleted).
    setRecipeHooks({ ownerLostAccess: (userId, projectId = null) => started.service.ownerLostAccess(userId, projectId) })
  })
}
