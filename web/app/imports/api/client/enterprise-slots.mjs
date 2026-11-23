// Where the browser half of the Cloud-only enterprise/ code plugs into the MIT app. The app
// leaves named slots (<EnterpriseSlot name="..."/>, imports/ui/common/EnterpriseSlot.jsx); on
// Cloud, client/enterprise.js loads enterprise/client with import() (its own chunk, never part of
// the first load) and its register(api, context) fills slots. On self-host the chunk is never
// requested and every slot renders nothing.
import { agentInviteEnabled, editionOf } from '../common/edition.mjs'

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
 * Loads the enterprise browser module on Cloud only.
 * @param {{ settings: object, load: () => Promise<object>, slots?: ReturnType<typeof createSlots> }} options
 */
export async function loadEnterpriseClient({ settings, load, slots = enterpriseSlots }) {
  const edition = editionOf(settings)
  if (edition !== 'cloud') return { edition, loaded: false, reason: 'self-host' }
  let mod
  try {
    mod = await load()
  } catch {
    return { edition, loaded: false, reason: 'missing' }
  }
  if (typeof mod?.register !== 'function') return { edition, loaded: false, reason: 'stub' }
  mod.register(slots.api, { edition, agentInvite: agentInviteEnabled(settings) })
  return { edition, loaded: true }
}
