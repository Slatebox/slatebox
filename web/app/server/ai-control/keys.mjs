// The server's provider keys: one providerKeys document per key (kind 'key'), sealed with the
// server's key-encryption key (metering/vault.mjs, SLATEBOX_KEY_ENCRYPTION_KEY, never changed
// here). A key is active (the one requests use), standby (saved, waiting to be switched to) or
// revoked (its cipher wiped; the document stays as history: which key, who, when). At most one key
// per provider is active (a unique index, metering/migrations.mjs M5).
//
// Keys live only here: no settings file, no environment variable. A key is never returned by
// anything in this module: an administrator sees its fingerprint (sha256:12345678…WXYZ), when it
// was added and by whom, when it was last tested and when it was last used.
//
// Pure apart from the injected collection, master key, checks and audit trail.
import { createHash, randomUUID } from 'node:crypto'
import { open as openKey, seal } from '../metering/vault.mjs'
import { redactText } from '../exec/redact.mjs'
import { PROVIDER_PRESETS } from './provider-presets.mjs'

export const SERVER_OWNER = Object.freeze({ ownerType: 'server', ownerId: 'server' })
export const KEY_STATUSES = Object.freeze(['active', 'standby', 'revoked'])
export const NO_MASTER = 'Set SLATEBOX_KEY_ENCRYPTION_KEY on this server to store model keys.'
// lastUsedAt is written at most once per key per this many ms, per process
export const TOUCH_EVERY_MS = 5 * 60 * 1000

/** Which key this is, without the key: sha256: + the first 8 hex of its sha256 + …last 4. */
export function keyFingerprint(key) {
  if (typeof key !== 'string' || !key) return null
  return `sha256:${createHash('sha256').update(key).digest('hex').slice(0, 8)}…${key.slice(-4)}`
}

export class KeyError extends Error {
  constructor(message, status = 400, details = undefined) {
    super(message)
    this.name = 'ModelError'
    this.status = status
    this.details = details
  }
}

/** What anyone may read about a key document: never the cipher. */
export function publicKey(doc) {
  if (!doc) return null
  return {
    id: doc._id, provider: doc.provider, status: doc.status, keyFingerprint: doc.keyFingerprint ?? null,
    label: doc.label ?? null, source: doc.source ?? 'admin', ...(doc.model && { model: doc.model }),
    createdAt: doc.createdAt ?? null, createdBy: doc.createdBy ?? null,
    activatedAt: doc.activatedAt ?? null, revokedAt: doc.revokedAt ?? null, revokedBy: doc.revokedBy ?? null,
    lastTest: doc.lastTest ?? null, lastUsedAt: doc.lastUsedAt ?? null,
  }
}

const ownerKey = (provider) => ({ ...SERVER_OWNER, provider })
const KEY_FILTER = { ...SERVER_OWNER, kind: 'key' }

/**
 * deps: {
 *   keys       the providerKeys collection (find, findOne, insertOne, updateOne, deleteOne)
 *   master     the vault master key (loadMasterKey) or null
 *   providerOf(id) → the provider ({ _id, label, baseUrl, protocol, auth, aux?, keyParts?, modelOptional? })
 *              or null (stored model providers and the services beside the models)
 *   check(connection) → a test result ({ ok, message, ... }) for a model provider's key
 *   checkAux(connection) → the same for a service beside the models
 *   modelFor?(provider) → the model a key test asks (the provider's first model), or null
 *   audit?(entry) → records { action, actor, target, before, after, reason } (store.record)
 *   bump?(actor) → moves the AI control generation, so every pod's snapshot sees the change
 *   now?() → Date, newId?()
 * }
 */
export function createKeyStore({
  keys, master, providerOf, check = async () => ({ ok: false, message: 'Testing is not available.' }), checkAux = null,
  modelFor = () => null, audit = null, bump = null, now = () => new Date(), newId = () => randomUUID().replaceAll('-', '').slice(0, 17),
  touchEveryMs = TOUCH_EVERY_MS, log = console,
}) {
  // keys a settings file still holds that could not be moved here this boot (no master key, the
  // database refused the write): used from memory only, never written or logged (ai-control-002)
  const fallback = new Map()
  const touched = new Map()

  const label = (provider) => providerOf(provider)?.label || PROVIDER_PRESETS[provider]?.label || provider
  const noKey = (provider) => `${label(provider)} has no active key. An administrator adds one in Admin → AI control.`

  async function record(entry) {
    if (audit) {
      try {
        await audit(entry)
      } catch (error) {
        log.warn?.(`ai-control: could not record ${entry.action} in the audit trail: ${error.message}`)
      }
    }
    if (bump) {
      try {
        await bump(entry.actor)
      } catch (error) {
        log.warn?.(`ai-control: the generation did not move after ${entry.action}: ${error.message}`)
      }
    }
  }

  const docOf = (id) => keys.findOne({ ...KEY_FILTER, _id: id })
  const activeOf = (provider) => keys.findOne({ ...KEY_FILTER, provider, status: 'active' })

  function checkKeyText(provider, apiKey) {
    if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey) || apiKey.length > 400) throw new KeyError('Paste the key on one line (at most 400 characters).')
    const p = providerOf(provider)
    if (p?.keyParts && apiKey.split(':').length !== p.keyParts.length) throw new KeyError(`${p.label} takes ${p.keyParts.join(' and ')}: paste them as ${p.keyParts.join(':')}.`)
    return apiKey.trim()
  }

  function checkModel(provider, model) {
    const p = providerOf(provider)
    if (model === undefined || model === null || model === '') {
      if (p?.aux && p.modelOptional === false) throw new KeyError(`Enter the ${(p.modelLabel || 'model').toLowerCase()}.`)
      return null
    }
    if (!p?.aux || !p.modelLabel) throw new KeyError('Only a service that needs one takes a model with its key.')
    if (typeof model !== 'string' || model.length > 200 || /[\r\n]/.test(model)) throw new KeyError(`${p.modelLabel} is one line of at most 200 characters.`)
    return model.trim()
  }

  async function list({ provider = null } = {}) {
    const docs = await keys.find({ ...KEY_FILTER, ...(provider && { provider }) }, { projection: { cipher: 0 } }).toArray()
    const order = { active: 0, standby: 1, revoked: 2 }
    return docs
      .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .map(publicKey)
  }

  // Switches a provider to one key: the key that was active is revoked (its cipher wiped). The old
  // key steps aside to standby first, so the one-active index never sees two; if the switch fails,
  // it is put back.
  async function switchTo(doc, actor) {
    const previous = await activeOf(doc.provider)
    if (previous?._id === doc._id) return { previous: null }
    const at = now()
    if (previous) await keys.updateOne({ _id: previous._id }, { $set: { status: 'standby' } })
    try {
      await keys.updateOne({ _id: doc._id }, { $set: { status: 'active', activatedAt: at } })
    } catch (error) {
      if (previous) await keys.updateOne({ _id: previous._id }, { $set: { status: 'active' } }).catch(() => {})
      throw error
    }
    if (previous) await keys.updateOne({ _id: previous._id }, { $set: { status: 'revoked', revokedAt: at, revokedBy: actor?.userId ?? null }, $unset: { cipher: '' } })
    return { previous }
  }

  /**
   * Saves a key, sealed. It is active when the provider has none (or activate is true: the key
   * that was active is revoked), else standby. A key saved before, in any status, is refused: a
   * revoked key is never brought back. → the key as anyone may read it
   */
  async function add({ actor, provider, apiKey, label: keyLabel = null, model = null, activate = false, source = 'admin', action = 'ai.keys.add' }) {
    const p = providerOf(provider)
    if (!p) throw new KeyError(`There is no provider ${provider}. Add it first.`, 404)
    const value = checkKeyText(provider, apiKey)
    const option = checkModel(provider, model)
    if (keyLabel !== null && (typeof keyLabel !== 'string' || keyLabel.length > 80 || /[\r\n]/.test(keyLabel))) throw new KeyError('A key\'s label is at most 80 characters on one line.')
    if (!master) throw new KeyError(NO_MASTER, 503)
    const fingerprint = keyFingerprint(value)
    const same = await keys.findOne({ ...KEY_FILTER, provider, keyFingerprint: fingerprint }, { projection: { cipher: 0 } })
    if (same) throw new KeyError(same.status === 'revoked' ? 'This key was revoked and cannot be used again. Add a new key.' : 'This key is already saved.', 409, { id: same._id })
    const active = await activeOf(provider)
    const at = now()
    const doc = {
      _id: newId(), ...KEY_FILTER, provider, status: 'standby',
      cipher: seal({ master, owner: ownerKey(provider), plaintext: value }), last4: value.slice(-4), keyFingerprint: fingerprint,
      label: keyLabel?.trim() || null, source, ...(option && { model: option }),
      createdAt: at, createdBy: actor?.userId ?? null, activatedAt: null, revokedAt: null, revokedBy: null, lastTest: null, lastUsedAt: null,
    }
    if (!active) Object.assign(doc, { status: 'active', activatedAt: at })
    try {
      await keys.insertOne(doc)
    } catch (error) {
      if (error?.code === 11000) throw new KeyError('This key is already saved.', 409)
      throw error
    }
    let replaced = null
    if (active && activate) ({ previous: replaced } = await switchTo(doc, actor))
    const saved = await docOf(doc._id)
    await record({
      action, actor, target: { kind: 'key', id: provider },
      before: replaced ? publicKey({ ...replaced, cipher: undefined }) : null, after: publicKey(saved),
    })
    return publicKey(saved)
  }

  // A key as a connection a test can send: the provider's address, key style and the model asked.
  function connectionFor(provider, apiKey, model) {
    const p = providerOf(provider)
    return { name: provider, type: provider, baseUrl: p.baseUrl, model: model ?? null, apiKey, capabilities: {}, ...(p.aux && { aux: true }) }
  }

  async function runTest(provider, apiKey, model) {
    const p = providerOf(provider)
    const started = now().getTime()
    const connection = connectionFor(provider, apiKey, p.aux ? model : (model || modelFor(provider)))
    let result
    if (p.aux) {
      result = checkAux ? await checkAux(connection) : { ok: false, message: 'Testing this kind of key is not available on this server.' }
    } else {
      result = await check(connection)
    }
    const latencyMs = Math.max(0, now().getTime() - started)
    const message = redactText(result?.message ?? '', { keys: [apiKey, ...String(apiKey).split(':')] })
    return { ...result, message, latencyMs }
  }

  /** Tests a saved key (id) or one not yet saved (provider, apiKey). A saved key keeps the outcome. */
  async function test({ id = null, provider = null, apiKey = null, model = null }) {
    if (id) {
      const doc = await docOf(id)
      if (!doc) throw new KeyError('There is no such key.', 404)
      if (doc.status === 'revoked' || !doc.cipher) throw new KeyError('This key was revoked. Add a new key.', 409)
      if (!master) throw new KeyError(NO_MASTER, 503)
      let value
      try {
        value = openKey({ master, owner: ownerKey(doc.provider), cipher: doc.cipher })
      } catch {
        throw new KeyError('This key could not be read: it was saved under another SLATEBOX_KEY_ENCRYPTION_KEY. Add it again.', 409)
      }
      const result = await runTest(doc.provider, value, doc.model ?? model)
      const lastTest = { at: now(), ok: Boolean(result.ok), latencyMs: result.latencyMs, error: result.ok ? null : result.message || 'no answer' }
      await keys.updateOne({ _id: doc._id }, { $set: { lastTest } }).catch((error) => log.warn?.(`ai-control: the test of a ${doc.provider} key was not kept: ${error.message}`))
      return { ...result, key: publicKey({ ...doc, lastTest }) }
    }
    if (!providerOf(provider)) throw new KeyError(`There is no provider ${provider}.`, 404)
    return runTest(provider, checkKeyText(provider, apiKey), checkModel(provider, model) ?? model)
  }

  /** Makes a standby key the active one; the key that was active is revoked. */
  async function activate({ actor, id, reason = null }) {
    const doc = await docOf(id)
    if (!doc) throw new KeyError('There is no such key.', 404)
    if (doc.status === 'revoked' || !doc.cipher) throw new KeyError('A revoked key cannot be used again. Add a new key.', 409)
    if (doc.status === 'active') return { key: publicKey(doc), revoked: null }
    const { previous } = await switchTo(doc, actor)
    const saved = await docOf(id)
    await record({
      action: 'ai.keys.activate', actor, target: { kind: 'key', id: doc.provider }, reason,
      before: previous ? publicKey(previous) : null, after: publicKey(saved),
    })
    return { key: publicKey(saved), revoked: previous ? publicKey({ ...previous, status: 'revoked' }) : null }
  }

  /**
   * Replaces a provider's key ("cycle"): the new key is saved, tested, and switched to only when
   * the test passes; the old key is revoked at once. A failing test keeps the new key as standby.
   * → { key, test, activated, revoked }
   */
  async function rotate({ actor, provider, apiKey, label: keyLabel = null, model = null, reason = null }) {
    const hadActive = Boolean(await activeOf(provider))
    const saved = await add({ actor, provider, apiKey, label: keyLabel, model, activate: false })
    const result = await test({ id: saved.id })
    if (!result.ok) return { key: result.key, test: result, activated: !hadActive, revoked: null }
    if (!hadActive) return { key: result.key, test: result, activated: true, revoked: null }
    const out = await activate({ actor, id: saved.id, reason })
    return { key: out.key, test: result, activated: true, revoked: out.revoked }
  }

  /** Revokes a key: nothing is sent with it again, its cipher is wiped, the record stays. */
  async function revoke({ actor, id, reason }) {
    const doc = await docOf(id)
    if (!doc) throw new KeyError('There is no such key.', 404)
    if (doc.status === 'revoked') return { key: publicKey(doc), wasActive: false }
    const at = now()
    await keys.updateOne({ _id: id }, { $set: { status: 'revoked', revokedAt: at, revokedBy: actor?.userId ?? null }, $unset: { cipher: '' } })
    const saved = await docOf(id)
    await record({ action: 'ai.keys.revoke', actor, target: { kind: 'key', id: doc.provider }, reason, before: publicKey(doc), after: publicKey(saved) })
    return { key: publicKey(saved), wasActive: doc.status === 'active' }
  }

  /** Deletes a standby or revoked key's record. An active key is revoked first. */
  async function remove({ actor, id, reason }) {
    const doc = await docOf(id)
    if (!doc) throw new KeyError('There is no such key.', 404)
    if (doc.status === 'active') throw new KeyError('Revoke the active key first, or switch to another key.', 409)
    await keys.deleteOne({ _id: id })
    await record({ action: 'ai.keys.remove', actor, target: { kind: 'key', id: doc.provider }, reason, before: publicKey(doc), after: null })
    return { removed: id }
  }

  /** Revokes every key of a provider (its address changed, or it is archived). → [ids] */
  async function revokeAll({ actor, provider, reason }) {
    const docs = await keys.find({ ...KEY_FILTER, provider, status: { $ne: 'revoked' } }, { projection: { cipher: 0 } }).toArray()
    for (const doc of docs) await revoke({ actor, id: doc._id, reason })
    return docs.map((doc) => doc._id)
  }

  function touch(id) {
    const at = now().getTime()
    if (at - (touched.get(id) ?? -Infinity) < touchEveryMs) return
    touched.set(id, at)
    Promise.resolve()
      .then(() => keys.updateOne({ _id: id }, { $set: { lastUsedAt: new Date(at) } }))
      .catch((error) => log.warn?.(`ai-control: lastUsedAt not kept: ${error.message}`))
  }

  /**
   * The provider's active key for one request, opened now (so a switch takes effect without a
   * restart). → { apiKey, model?, keyId } or { error } (a sentence for the person). A key a
   * settings file still holds that could not be moved here this boot is used only while the
   * provider has no active key.
   */
  async function keyFor(provider, { use = true } = {}) {
    let doc
    try {
      doc = await activeOf(provider)
    } catch (error) {
      // the database is down: a key the settings file still held keeps answering this boot
      const kept = fallback.get(provider)
      if (kept) return { apiKey: kept.value, model: kept.model ?? null, keyId: null, fromSettings: true }
      return { error: `The ${label(provider)} key could not be read right now (${error.message}). Try again in a minute.` }
    }
    if (!doc) {
      const kept = fallback.get(provider)
      return kept ? { apiKey: kept.value, model: kept.model ?? null, keyId: null, fromSettings: true } : { error: noKey(provider) }
    }
    if (!master || !doc.cipher) return { error: `The ${label(provider)} key cannot be read on this server (${master ? 'it has no cipher' : 'SLATEBOX_KEY_ENCRYPTION_KEY is not set'}). An administrator adds it again in Admin → AI control.` }
    try {
      const apiKey = openKey({ master, owner: ownerKey(provider), cipher: doc.cipher })
      if (use) touch(doc._id)
      return { apiKey, model: doc.model ?? null, keyId: doc._id }
    } catch {
      return { error: `The ${label(provider)} key could not be read: it was saved under another SLATEBOX_KEY_ENCRYPTION_KEY. An administrator adds it again in Admin → AI control.` }
    }
  }

  /** Whether the provider has a key a request can use (no key is opened). */
  async function hasKey(provider) {
    return Boolean(await activeOf(provider)) || fallback.has(provider)
  }

  /** The active key of every provider, without ciphers (for the snapshot). → { [provider]: { id, keyFingerprint } } */
  async function activeSummary() {
    const docs = await keys.find({ ...KEY_FILTER, status: 'active' }, { projection: { cipher: 0 } }).toArray()
    return Object.fromEntries(docs.map((doc) => [doc.provider, { id: doc._id, keyFingerprint: doc.keyFingerprint ?? null }]))
  }

  return {
    list, add, test, activate, rotate, revoke, remove, revokeAll, keyFor, hasKey, activeSummary, touch,
    /** ai-control-002: a settings-file key that could not be moved this boot, used from memory. */
    keepFromSettings(provider, value, model = null) {
      fallback.set(provider, { value, model })
    },
    forgetFromSettings(provider) {
      fallback.delete(provider)
    },
    fromSettings: () => [...fallback.keys()],
    findByFingerprint: (provider, fingerprint) => keys.findOne({ ...KEY_FILTER, provider, keyFingerprint: fingerprint }, { projection: { cipher: 0 } }),
    activeOf: async (provider) => publicKey(await activeOf(provider)),
    hasMaster: () => Boolean(master),
  }
}
