// ai-control-001 (startup, once per database): the feature choices an administrator saved for the
// server in AI settings (aiChoices, server) become published server bindings at version 1
// (aiBindings), so AI control holds them from now on. aiChoices is kept as written: with AI
// control's DB layer switched off (spec 2.4) those choices still apply, and ai.update keeps both
// in step from here on (bindings.mjs syncServerUse).
//
// It changes nothing anyone sees. Before writing, it resolves every surface with and without the
// proposed bindings and moves a choice only when no surface would answer differently: a choice the
// settings file overrides for a more specific part (file use.workshop under an app use.chat, say)
// stays a choice. A surface that already has a server binding is never touched. Choices of people
// and teams stay in their AI settings (they outrank server bindings, resolve.mjs).
//
// Pure apart from the injected collections and services; ai-control/index.mjs runs it.
import { BINDABLE_SURFACES, bindingIdOf } from '../ai-control/bindings.mjs'
import { primaryOf, resolveBinding } from '../ai-control/resolve.mjs'

export const AI_CONTROL_001 = 'migration:ai-control-001'
export const REASON_001 = 'Moved from the AI settings to AI control (ai-control-001)'

/**
 * deps: {
 *   state         the aiControlState collection (insertOne, updateOne, deleteOne): the marker
 *   aiSettings    ai-settings-core.mjs (serverState: the merged choices, where each comes from)
 *   ops           bindings.mjs createBindingOps (publish, heads)
 *   snapshot()    the current snapshot (after its first load)
 *   settings      Meteor.settings
 *   now?()        → Date
 *   log?          console
 * }
 * → { ran: false } when another start ran it, else { ran: true, moved: [surface], kept: [{ surface, why }] }
 */
export async function runAIControl001({ state, aiSettings, ops, snapshot, settings = {}, now = () => new Date(), log = console }) {
  try {
    await state.insertOne({ _id: AI_CONTROL_001, startedAt: now() })
  } catch (error) {
    if (error?.code === 11000 || /duplicate/i.test(error?.message || '')) return { ran: false }
    throw error
  }
  try {
    const server = await aiSettings.serverState()
    const appKeys = Object.keys(server.useSource || {}).filter((key) => server.useSource[key] === 'app')
    const existing = new Set((await ops.heads()).map((doc) => doc.surface))
    const kept = []
    const candidates = []
    for (const key of appKeys) {
      if (!BINDABLE_SURFACES.includes(key)) kept.push({ surface: key, why: 'not a surface that can be bound in this build' })
      else if (existing.has(key)) kept.push({ surface: key, why: 'already has a server binding' })
      else candidates.push(key)
    }

    // every surface for the server's choices alone (people's and teams' choices outrank bindings)
    const holders = { person: null, team: null, server: { connections: server.connections, use: server.use }, ownProviders: false, serverUseSource: server.useSource }
    const base = snapshot()
    const answers = (bindings) => JSON.stringify(BINDABLE_SURFACES.map((surface) => primaryOf(resolveBinding({ ...base, bindings }, { surface, holders, settings }))))
    const before = answers(base.bindings)
    const accepted = {}
    const docFor = (key) => ({ _id: bindingIdOf(key), surface: key, scope: { level: 'server' }, enabled: true, chain: [{ connection: server.use[key] === 'builtin' ? 'builtin' : server.use[key] }], status: 'published', version: 1 })
    for (const key of candidates) {
      const trial = { ...base.bindings, ...accepted, [bindingIdOf(key)]: docFor(key) }
      if (answers(trial) === before) accepted[bindingIdOf(key)] = docFor(key)
      else kept.push({ surface: key, why: 'the settings file sets a more specific part, so moving it would change an answer' })
    }

    const actor = { userId: null, principal: 'system', via: 'system' }
    const moved = []
    for (const doc of Object.values(accepted)) {
      try {
        await ops.publish({ actor, input: { surface: doc.surface, chain: doc.chain }, reason: REASON_001, note: 'From AI settings', action: 'ai.bindings.migrate', extra: { origin: 'ai-control-001' } })
        moved.push(doc.surface)
      } catch (error) {
        kept.push({ surface: doc.surface, why: error.message })
      }
    }
    await state.updateOne({ _id: AI_CONTROL_001 }, { $set: { doneAt: now(), moved, kept } })
    if (moved.length || kept.length) log.info?.(`ai-control-001: moved ${moved.length} server AI choice(s) to bindings${kept.length ? `, kept ${kept.length} as choices` : ''}`)
    return { ran: true, moved, kept }
  } catch (error) {
    // try again at the next start
    await state.deleteOne({ _id: AI_CONTROL_001 }).catch(() => {})
    throw error
  }
}
