// The one door between the MIT app and the Cloud-only code in the repository's enterprise/
// directory (enterprise/LICENSE). Runs without Meteor and is tested that way
// (scripts/enterprise-carveout.test.mjs); server/enterprise.js is its Meteor side.
//
// On self-host (settings.public.edition absent or not 'cloud') the enterprise module is never
// even required, so nothing from it runs and nothing is registered. On Cloud the module's
// register(api, context) is called once, at server start, and may only add to the app through
// the api below:
//   api.addActions([definition, ...])  actions for the one registry (server/actions/registry.mjs),
//                                      so each is a Meteor method, an /api/v1 route, an exec call
//                                      and an MCP tool with the same permission checks
//   api.addMethods({ name: fn })       plain Meteor methods (prefer actions)
//   api.addRoute({ method, path, handler })  an Express route on the app (OAuth callbacks)
//   api.onStartup(fn)                  run inside Meteor.startup
import { agentInviteEnabled, editionOf } from '../imports/api/common/edition.mjs'

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

/**
 * Loads and registers the enterprise module, on Cloud only.
 * @param {object} options
 * @param {object} options.settings  Meteor.settings
 * @param {() => object} options.load  returns the enterprise server module (a synchronous require)
 * @param {ReturnType<typeof createEnterpriseHost>} [options.host]
 * @param {(text: string) => void} [options.log]
 * @returns {{ edition: 'cloud'|'self-host', loaded: boolean, reason?: string, name?: string }}
 */
export function loadEnterprise({ settings, load, host = enterpriseHost, log = () => {} }) {
  const edition = editionOf(settings)
  if (edition !== 'cloud') return { edition, loaded: false, reason: 'self-host' }
  let mod
  try {
    mod = load()
  } catch (error) {
    if (!isMissingModule(error)) throw error
    log('settings say Cloud, but this build has no enterprise code (scripts/enterprise-stage.mjs)')
    return { edition, loaded: false, reason: 'missing' }
  }
  if (typeof mod?.register !== 'function') {
    log('settings say Cloud, but this build carries the self-host stub in place of enterprise code')
    return { edition, loaded: false, reason: 'stub' }
  }
  mod.register(host.api, { edition, settings, agentInvite: agentInviteEnabled(settings) })
  return { edition, loaded: true, name: mod.manifest?.name || 'enterprise' }
}
