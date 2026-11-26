// Where the browser half of the enterprise/ code plugs into the MIT app. The app
// leaves named slots (<EnterpriseSlot name="..."/>, imports/ui/common/EnterpriseSlot.jsx); on
// installs where enterprise code is unlocked (Slatebox Cloud, or a self-hosted install with a license
// key: the server says so in settings.public.enterprise), client/enterprise.js loads
// enterprise/client with import() (its own chunk, never part of the first load) and its
// register(api, context) fills slots. Where it is locked the chunk is never requested and every
// slot renders nothing.
import { editionOf, enterpriseState } from '../common/edition.mjs'

export function createSlots() {
  const components = new Map()
  const listeners = new Set()
  const notify = () => listeners.forEach((listener) => listener())
  return {
    api: Object.freeze({
      fill(name, component) {
        if (typeof name !== 'string' || !name) throw new Error('enterprise: a slot needs a name')
        if (components.has(name)) throw new Error(`enterprise: slot ${name} is filled twice`)
        components.set(name, component)
        notify()
      },
    }),
    get: (name) => components.get(name) || null,
    // The server answered enterprise_locked (its key ended while it ran): every slot empties for the
    // rest of this page's life, so nothing offers what the server now refuses. True when it did.
    lockIfRefused(error) {
      if (error?.error !== 'enterprise_locked' && error?.code !== 'enterprise_locked') return false
      if (components.size) {
        components.clear()
        notify()
      }
      return true
    },
    names: () => [...components.keys()],
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export const enterpriseSlots = createSlots()

/**
 * Loads the enterprise browser module where the server says enterprise code is unlocked.
 * @param {{ settings: object, load: () => Promise<object>, slots?: ReturnType<typeof createSlots> }} options
 */
export async function loadEnterpriseClient({ settings, load, slots = enterpriseSlots }) {
  const edition = editionOf(settings)
  const state = enterpriseState(settings)
  if (!state.unlocked) return { edition, loaded: false, reason: 'locked' }
  let mod
  try {
    mod = await load()
  } catch {
    return { edition, loaded: false, reason: 'missing' }
  }
  if (typeof mod?.register !== 'function') return { edition, loaded: false, reason: 'stub' }
  mod.register(slots.api, { edition, via: state.via, features: state.features, agentInvite: state.features.includes('agents.invite') })
  return { edition, loaded: true }
}

// Enterprise code unlocked while this page is open (the header button's trial or a pasted key,
// server/selfhost-options): the server answers its new public state, the page takes it as its own
// and loads the enterprise chunk now, with no reload. client/enterprise.js gives the loader (the
// only MIT file that names the enterprise chunk); components re-render through subscribe().
const changes = new Set()
let generation = 0
export const enterpriseClient = {
  load: null,
  generation: () => generation,
  subscribe(listener) {
    changes.add(listener)
    return () => changes.delete(listener)
  },
}

/**
 * @param {{ settings: object, state: { unlocked: boolean, via?: string, features?: string[] }, slots?: ReturnType<typeof createSlots>, load?: () => Promise<object> }} options
 */
export async function adoptEnterpriseState({ settings, state, slots = enterpriseSlots, load = enterpriseClient.load }) {
  if (!state?.unlocked || !load) return { loaded: false, reason: state?.unlocked ? 'no_loader' : 'locked' }
  settings.public = settings.public || {}
  const already = enterpriseState(settings).unlocked && slots.names().length > 0
  settings.public.enterprise = { unlocked: true, via: state.via, features: Array.isArray(state.features) ? state.features : [] }
  const result = already ? { edition: editionOf(settings), loaded: true, already: true } : await loadEnterpriseClient({ settings, load, slots })
  generation += 1
  changes.forEach((listener) => listener())
  return result
}
