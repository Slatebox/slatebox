// The one door between the MIT app and the code in the repository's enterprise/ directory
// (enterprise/LICENSE). Runs without Meteor and is tested that way
// (scripts/enterprise-carveout.test.mjs); server/enterprise.js is its Meteor side.
//
// Enterprise code runs where it is unlocked (server/enterprise-license.mjs): always on Slatebox
// Cloud, and on a self-hosted install once a license key from Slatebox LLC unlocks it. Where it is
// locked the enterprise module is never even required, so nothing from it runs and nothing is
// registered. Where it is unlocked the module's register(api, context) is called once, at server
// start, and may only add to the app through the api below:
//   api.addActions([definition, ...])  actions for the one registry (server/actions/registry.mjs),
//                                      so each is a Meteor method, an /api/v1 route, an exec call
//                                      and an MCP tool with the same permission checks
//   api.addMethods({ name: fn })       plain Meteor methods (prefer actions)
//   api.addRoute({ method, path, handler })  an Express route on the app (OAuth callbacks)
//   api.onStartup(fn)                  run inside Meteor.startup
// On a licensed install every action, method and route is checked again when it is called, so a
// license that ends while the server runs locks them then, not at the next restart.
import { agentInviteKilled, editionOf } from '../imports/api/common/edition.mjs'
import { enterpriseAccess, LICENSE_WORDS } from './enterprise-license.mjs'

const ROUTE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export function createEnterpriseHost() {
  const actions = []
  const methods = {}
  const routes = []
  const startups = []
  const api = Object.freeze({
    addActions(definitions) {
      if (!Array.isArray(definitions)) throw new Error('enterprise: addActions takes a list of action definitions')
      actions.push(...definitions)
    },
    addMethods(map) {
      for (const [name, fn] of Object.entries(map || {})) {
        if (typeof fn !== 'function') throw new Error(`enterprise: method ${name} needs a function`)
        if (Object.hasOwn(methods, name)) throw new Error(`enterprise: method ${name} is registered twice`)
        methods[name] = fn
      }
    },
    addRoute({ method, path, handler } = {}) {
      if (!ROUTE_METHODS.includes(method)) throw new Error(`enterprise: route method ${method} is not supported`)
      if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('enterprise: route path must start with /')
      if (typeof handler !== 'function') throw new Error(`enterprise: route ${method} ${path} needs a handler`)
      routes.push({ method, path, handler })
    },
    onStartup(fn) {
      if (typeof fn !== 'function') throw new Error('enterprise: onStartup takes a function')
      startups.push(fn)
    },
  })
  const isEmpty = () => !actions.length && !Object.keys(methods).length && !routes.length && !startups.length
  return { actions, methods, routes, startups, api, isEmpty }
}

// The server's one host. server/enterprise.js fills it; server/actions/mount.js adds its actions
// to the app registry. Both run at import time, enterprise.js first (server/main.js).
export const enterpriseHost = createEnterpriseHost()

const isMissingModule = (error) =>
  error?.code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(String(error?.message || ''))

// What a call to locked enterprise code answers (a license ended while the server ran).
export class EnterpriseLocked extends Error {
  constructor(reason) {
    super(LICENSE_WORDS[reason] || LICENSE_WORDS.no_license)
    this.status = 403
    this.code = 'enterprise_locked'
    this.error = 'enterprise_locked'
    this.reason = this.message
  }
}

// The api enterprise code registers through, with every entry point checked against `current()`
// (the license as it stands when the call comes) when the install is unlocked by a license.
function guardedApi(api, current) {
  const check = () => {
    const now = current()
    if (!now.unlocked) throw new EnterpriseLocked(now.reason)
  }
  const guard = (fn) =>
    function guarded(...args) {
      check()
      return fn.apply(this, args)
    }
  return Object.freeze({
    addActions(definitions) {
      if (!Array.isArray(definitions)) return api.addActions(definitions)
      return api.addActions(definitions.map((definition) => (typeof definition?.handler === 'function' ? { ...definition, handler: guard(definition.handler) } : definition)))
    },
    addMethods(map) {
      return api.addMethods(Object.fromEntries(Object.entries(map || {}).map(([name, fn]) => [name, typeof fn === 'function' ? guard(fn) : fn])))
    },
    addRoute(route = {}) {
      if (typeof route.handler !== 'function') return api.addRoute(route)
      return api.addRoute({
        ...route,
        handler(req, res, next) {
          const now = current()
          if (!now.unlocked) {
            res.statusCode = 403
            res.setHeader?.('Content-Type', 'application/json')
            return res.end(JSON.stringify({ error: 'enterprise_locked', message: LICENSE_WORDS[now.reason] || LICENSE_WORDS.no_license }))
          }
          return route.handler(req, res, next)
        },
      })
    },
    onStartup: (fn) => api.onStartup(fn),
  })
}

/**
 * Loads and registers the enterprise module where it is unlocked.
 * @param {object} options
 * @param {object} options.settings  Meteor.settings
 * @param {() => object} options.load  returns the enterprise server module (a synchronous require)
 * @param {ReturnType<typeof createEnterpriseHost>} [options.host]
 * @param {(text: string) => void} [options.log]
 * @param {(now?: number) => ReturnType<typeof enterpriseAccess>} [options.access]
 *   whether enterprise code is unlocked now (server/enterprise-license.mjs; the install's own
 *   settings, environment and Slatebox LLC's keys by default)
 * @returns {{ edition: 'cloud'|'self-host', loaded: boolean, reason?: string, name?: string,
 *             access: ReturnType<typeof enterpriseAccess>, features: string[] }}
 */
export function loadEnterprise({ settings, load, host = enterpriseHost, log = () => {}, access = (now) => enterpriseAccess({ settings, env: process.env, now }) }) {
  const edition = editionOf(settings)
  const first = access()
  if (!first.unlocked) return { edition, loaded: false, reason: 'locked', access: first, features: [] }
  let mod
  try {
    mod = load()
  } catch (error) {
    if (!isMissingModule(error)) throw error
    log('enterprise code is unlocked here, but this build has none (scripts/enterprise-stage.mjs)')
    return { edition, loaded: false, reason: 'missing', access: first, features: [] }
  }
  if (typeof mod?.register !== 'function') {
    log('enterprise code is unlocked here, but this build carries a stub in place of it')
    return { edition, loaded: false, reason: 'stub', access: first, features: [] }
  }
  // Invited agents are on wherever enterprise code runs; settings.connectors.off is the kill switch.
  const features = agentInviteKilled(settings) ? [] : ['agents.invite']
  // A license is read again at most once an hour while the server runs (Cloud never ends).
  let checked = { at: Date.now(), state: first }
  const current = () => {
    if (Date.now() - checked.at > 3_600_000) checked = { at: Date.now(), state: access() }
    return checked.state
  }
  const api = first.via === 'license' ? guardedApi(host.api, current) : host.api
  mod.register(api, { edition, settings, unlocked: true, via: first.via, features, agentInvite: features.includes('agents.invite') })
  return { edition, loaded: true, name: mod.manifest?.name || 'enterprise', access: first, features }
}
