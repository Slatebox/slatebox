import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { requireAIControlAdmin } from './ai-control-get.mjs'
import { guardControlWrite } from './ai-providers.mjs'
import { API_KEY, KEY_ID, PROVIDER_ID, REASON, asProblem } from './ai-control-schemas.mjs'

// The server's provider keys (ai-control/keys.mjs): every key lives in the backend, sealed with the
// server's key-encryption key, never in the settings file. Revocable (revoke wipes it, the record
// stays) and rotatable (rotate: add a new key, test it, switch over, the old one revoked). No action
// returns a key: only its fingerprint, when it was added and by whom, last tested and last used.
// Sending, switching, revoking or deleting a key is a person's act; administrators only.

const KEY_OUTPUT = { type: 'object', description: 'A key as anyone may read it: id, provider, status (active, standby, revoked), keyFingerprint, label, source, createdAt/By, activatedAt, revokedAt/By, lastTest, lastUsedAt. Never the key.' }
const TEST_OUTPUT = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, reachable: { type: 'boolean' }, tools: { type: 'string' }, message: { type: 'string' }, latencyMs: { type: 'number' }, key: KEY_OUTPUT },
}
const MODEL = { type: 'string', maxLength: 200, description: 'For google-cse, the search engine ID (cx). For a key test, the model asked (the provider\'s first model by default).' }

async function personOnly(principal, deps, action, provider) {
  if (principal.kind !== 'agent') return
  const error = problem(403, 'forbidden', 'Only a person can send, switch, revoke or delete a key.', { details: { personOnly: true } })
  await deps.aiControlStore?.refused({ action, actor: { userId: principal.userId, principal: 'agent', via: 'http' }, target: { kind: 'key', id: provider ?? 'key' }, error: error.message, trusted: true }).catch(() => {})
  throw error
}

export const aiKeysList = defineAction({
  id: 'ai.keys.list',
  title: 'AI keys',
  description: 'Lists the server\'s provider keys (or one provider\'s): which key each is (a fingerprint), whether it is active, standby or revoked, who added it and when, and when it was last tested and last used. Never a key. Administrators only.',
  toolset: 'admin',
  kind: 'read',
  scope: 'ai:admin:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/ai/control/keys', operationId: 'listAIKeys' } },
  tool: { name: 'list_ai_keys', title: 'List AI keys', description: 'List this server\'s AI provider keys by fingerprint, never the keys. Administrators only.' },
  input: { type: 'object', properties: { provider: PROVIDER_ID }, additionalProperties: false },
  output: { type: 'object', properties: { keys: { type: 'array', items: KEY_OUTPUT }, keysAvailable: { type: 'boolean' }, fromSettings: { type: 'array', items: { type: 'string' } } } },
  handler: async (principal, input, { deps }) => {
    await requireAIControlAdmin(principal, deps, 'read AI keys')
    return { keys: await deps.aiKeys.list({ provider: input.provider ?? null }), keysAvailable: deps.aiKeys.hasMaster(), fromSettings: deps.aiKeys.fromSettings() }
  },
})

export const aiKeysAdd = defineAction({
  id: 'ai.keys.add',
  title: 'Add AI key',
  description: 'Saves a provider\'s key, encrypted. It becomes the active key when the provider has none (or activate is true: the key that was active is revoked), else it waits as standby. A key saved before, even a revoked one, is refused. A person only. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person'],
  mounts: { ddp: true },
  confirm: true,
  idempotent: false,
  successStatus: 200,
  input: {
    type: 'object',
    properties: { provider: PROVIDER_ID, apiKey: API_KEY, label: { type: 'string', maxLength: 80 }, model: MODEL, activate: { type: 'boolean' } },
    required: ['provider', 'apiKey'],
    additionalProperties: false,
  },
  output: KEY_OUTPUT,
  handler: async (principal, input, { deps }) => {
    await personOnly(principal, deps, 'ai.keys.add', input.provider)
    const actor = await guardControlWrite(principal, deps, { action: 'ai.keys.add', target: { kind: 'key', id: input.provider }, doing: 'add AI keys' })
    try {
      return await deps.aiKeys.add({ actor, provider: input.provider, apiKey: input.apiKey, label: input.label ?? null, model: input.model ?? null, activate: Boolean(input.activate) })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiKeysTest = defineAction({
  id: 'ai.keys.test',
  title: 'Test AI key',
  description: 'Tests a saved key (id) or one not yet saved (provider and apiKey): whether the provider is reached, takes the key, and its model answers and calls tools. A saved key keeps the outcome (last tested). Saves nothing else. The key goes only to the provider\'s own address. An unsaved key is a person\'s test. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/ai/control/keys/test', operationId: 'testAIKey' } },
  tool: { name: 'test_ai_key', title: 'Test an AI key', description: 'Test a saved AI provider key by its id. Administrators only.' },
  readOnly: true,
  openWorld: true,
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: { type: 'object', properties: { id: KEY_ID, provider: PROVIDER_ID, apiKey: API_KEY, model: MODEL }, additionalProperties: false },
  output: TEST_OUTPUT,
  handler: async (principal, input, { deps }) => {
    if (!input.id && !(input.provider && input.apiKey)) throw problem(400, 'invalid_request', 'Send a saved key\'s id, or a provider and the key to test.')
    if (!input.id) await personOnly(principal, deps, 'ai.keys.test', input.provider)
    const actor = await guardControlWrite(principal, deps, { action: 'ai.keys.test', target: { kind: 'key', id: input.provider ?? input.id }, doing: 'test AI keys' })
    try {
      return await deps.aiKeys.test({ id: input.id ?? null, provider: input.provider ?? null, apiKey: input.apiKey ?? null, model: input.model ?? null, actor })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiKeysActivate = defineAction({
  id: 'ai.keys.activate',
  title: 'Switch to AI key',
  description: 'Makes a standby key the provider\'s active key; the key that was active is revoked at once. A person only. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person'],
  mounts: { ddp: true },
  confirm: true,
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: { type: 'object', properties: { id: KEY_ID, reason: REASON }, required: ['id'], additionalProperties: false },
  output: { type: 'object', properties: { key: KEY_OUTPUT, revoked: { type: ['object', 'null'] } } },
  handler: async (principal, input, { deps }) => {
    await personOnly(principal, deps, 'ai.keys.activate')
    const actor = await guardControlWrite(principal, deps, { action: 'ai.keys.activate', target: { kind: 'key', id: input.id }, doing: 'switch AI keys', reason: input.reason ?? null })
    try {
      return await deps.aiKeys.activate({ actor, id: input.id, reason: input.reason ?? null })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiKeysRotate = defineAction({
  id: 'ai.keys.rotate',
  title: 'Replace AI key',
  description: 'Replaces a provider\'s key: the new key is saved, tested, and switched to only when the test passes; the old key is then revoked at once. A failing test keeps the new key as standby and says why. A person only. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person'],
  mounts: { ddp: true },
  confirm: true,
  openWorld: true,
  idempotent: false,
  successStatus: 200,
  input: {
    type: 'object',
    properties: { provider: PROVIDER_ID, apiKey: API_KEY, label: { type: 'string', maxLength: 80 }, model: MODEL, reason: REASON },
    required: ['provider', 'apiKey'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { key: KEY_OUTPUT, test: TEST_OUTPUT, activated: { type: 'boolean' }, revoked: { type: ['object', 'null'] } } },
  handler: async (principal, input, { deps }) => {
    await personOnly(principal, deps, 'ai.keys.rotate', input.provider)
    const actor = await guardControlWrite(principal, deps, { action: 'ai.keys.rotate', target: { kind: 'key', id: input.provider }, doing: 'replace AI keys', reason: input.reason ?? null })
    try {
      return await deps.aiKeys.rotate({ actor, provider: input.provider, apiKey: input.apiKey, label: input.label ?? null, model: input.model ?? null, reason: input.reason ?? null })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiKeysRevoke = defineAction({
  id: 'ai.keys.revoke',
  title: 'Revoke AI key',
  description: 'Revokes a key: nothing is sent with it again and its encrypted copy is wiped; the record (fingerprint, who, when) stays. Revoking the active key leaves the provider with no key until one is added. Needs a reason. A person only. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person'],
  mounts: { ddp: true },
  confirm: true,
  destructive: true,
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: { type: 'object', properties: { id: KEY_ID, reason: REASON }, required: ['id', 'reason'], additionalProperties: false },
  output: { type: 'object', properties: { key: KEY_OUTPUT, wasActive: { type: 'boolean' } } },
  handler: async (principal, input, { deps }) => {
    await personOnly(principal, deps, 'ai.keys.revoke')
    const actor = await guardControlWrite(principal, deps, { action: 'ai.keys.revoke', target: { kind: 'key', id: input.id }, doing: 'revoke AI keys', reason: input.reason })
    try {
      return await deps.aiKeys.revoke({ actor, id: input.id, reason: input.reason })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiKeysRemove = defineAction({
  id: 'ai.keys.remove',
  title: 'Delete AI key',
  description: 'Deletes the record of a standby or revoked key. An active key is revoked first. Needs a reason. A person only. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person'],
  mounts: { ddp: true },
  confirm: true,
  destructive: true,
  removes: () => true,
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: { type: 'object', properties: { id: KEY_ID, reason: REASON }, required: ['id', 'reason'], additionalProperties: false },
  output: { type: 'object', properties: { removed: { type: 'string' } } },
  handler: async (principal, input, { deps }) => {
    await personOnly(principal, deps, 'ai.keys.remove')
    const actor = await guardControlWrite(principal, deps, { action: 'ai.keys.remove', target: { kind: 'key', id: input.id }, doing: 'delete AI keys', reason: input.reason })
    try {
      return await deps.aiKeys.remove({ actor, id: input.id, reason: input.reason })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export default [aiKeysList, aiKeysAdd, aiKeysTest, aiKeysActivate, aiKeysRotate, aiKeysRevoke, aiKeysRemove]
