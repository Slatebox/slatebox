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
