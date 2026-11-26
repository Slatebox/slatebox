// About you (Profile › About you): the facts a person keeps about themselves, so Slatebox can
// suggest boards and slates made for their work. Every action is the signed-in person's, for
// themselves only: a guest gets nothing (save the account first), and a token reaches its own
// account's profile only with the profile:read or profile:write permission, which no token has
// unless the person chose it.
//   profile.facts.list      every fact, each with where it came from, and whether personalization is on
//   profile.facts.add       a fact in their words (kind + text)
//   profile.facts.update    new words or a new kind
//   profile.facts.hide      hidden: kept and shown to them, never used (hidden false shows it again)
//   profile.facts.remove    one fact
//   profile.facts.clear     every fact, or those from one kind of source
//   profile.settings.get    personalization on or off, and each source's switch
//   profile.settings.set    people only (the app): an agent never turns on what Slatebox reads about
//                           someone, as agents.control is people only.
// The store: server/profile/store.mjs; the rules: imports/api/common/personal-facts.mjs.
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { FACT_ID_PATTERN, FACT_KINDS, LIMITS, MAX_SOURCE_SWITCHES, SOURCE_KEY_PATTERN, SOURCE_TYPES, publicFact, publicSettings, sortFacts } from '../../imports/api/common/personal-facts.mjs'

// Writes per signed-in person, per minute (DDPRateLimiter in server/profile/meteor.js): a person
// typing, never a loop. A token's calls are counted by the registry's own limiter.
export const PROFILE_WRITE_LIMITS = Object.freeze({
  'profile.facts.add': 30,
  'profile.facts.update': 30,
  'profile.facts.hide': 30,
  'profile.facts.remove': 30,
  'profile.facts.clear': 5,
  'profile.settings.set': 20,
})

const storeOf = (deps) => {
  if (!deps.profile) throw problem(501, 'not_available', 'About you is not available on this server.')
  return deps.profile
}

const kindInput = { type: 'string', enum: FACT_KINDS, description: `What the fact is about: ${FACT_KINDS.join(', ')}.` }
const textInput = { type: 'string', minLength: 1, maxLength: LIMITS.text, description: `The fact in a few plain words, up to ${LIMITS.text} characters ("Product manager", "Uses Linear").` }
const factIdInput = { type: 'string', pattern: FACT_ID_PATTERN, description: 'The fact, as profile.facts.list gives it (facts[].id). The fact read from the first slate is "first-slate".' }

const factSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    kind: { type: 'string', enum: FACT_KINDS },
    text: { type: 'string' },
    source: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: SOURCE_TYPES },
        ref: { type: 'string', description: 'Which tool, upload or answer.' },
        label: { type: 'string', description: 'Its name, as shown.' },
      },
      required: ['type'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    hidden: { type: 'boolean', description: 'Kept and shown to the person, never used.' },
    derived: { type: 'boolean', description: 'Read from their first slate when listed, not stored.' },
    createdAt: { type: ['string', 'null'] },
    updatedAt: { type: ['string', 'null'] },
  },
  required: ['id', 'kind', 'text', 'source', 'confidence', 'hidden'],
}
const settingsSchema = {
  type: 'object',
  properties: {
    on: { type: 'boolean', description: 'Personalization: when off, nothing About you holds is used, and no source adds to it.' },
    sources: { type: 'object', description: 'Each source\'s switch by its key (interview, integration:<id>, upload:<id>). A connected tool or an upload is off until switched on.' },
    updatedAt: { type: ['string', 'null'] },
  },
  required: ['on', 'sources'],
}

// An agent writes as itself: the fact says which connection added it.
const writer = (principal) => (principal.kind === 'agent' ? { label: principal.tokenName || 'an agent' } : {})

const list = defineAction({
  id: 'profile.facts.list',
  title: 'About you',
  description:
    'What Slatebox knows about you, so it can make boards and slates for your work: every fact, each with its kind and where it came from (you, your first slate, and later an interview with the agent), hidden ones included, and whether personalization is on. Only you see this.',
  toolset: 'account',
  kind: 'read',
  scope: 'profile:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/profile/facts', operationId: 'listProfileFacts' } },
  input: {
    type: 'object',
    properties: { kind: { ...kindInput, description: 'Only facts of this kind.' } },
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      on: { type: 'boolean' },
      facts: { type: 'array', items: factSchema },
      limit: { type: 'integer', description: 'How many facts About you keeps at most.' },
    },
    required: ['on', 'facts', 'limit'],
  },
  tool: { name: 'list_profile_facts', title: 'Read what Slatebox knows about you', description: 'Read the person\'s About you facts (role, team, work, goals, projects, tools, topics, style, routines), each with where it came from, and whether personalization is on.' },
  async handler(principal, input, { deps }) {
    const { settings, facts } = await storeOf(deps).list(principal.userId)
    const shown = input.kind ? facts.filter((fact) => fact.kind === input.kind) : facts
    return { on: publicSettings(settings).on, facts: sortFacts(shown).map(publicFact), limit: LIMITS.perPerson }
  },
})

const add = defineAction({
  id: 'profile.facts.add',
  title: 'Add something about you',
  description:
    `Adds a fact to About you in your words: a kind (${FACT_KINDS.join(', ')}) and a few words. The same fact again answers the one you have (added false). About you keeps up to ${LIMITS.perPerson} facts. An agent cannot add while personalization is off.`,
  toolset: 'account',
  kind: 'write',
  changesNoSlate: true,
  scope: 'profile:write',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/profile/facts', operationId: 'addProfileFact' } },
  idempotency: 'optional',
  input: {
    type: 'object',
    properties: { kind: kindInput, text: textInput },
    required: ['kind', 'text'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: { fact: factSchema, added: { type: 'boolean', description: 'false: you already had this fact.' } },
    required: ['fact', 'added'],
  },
  failure: { code: 'profile_failed', message: 'That could not be saved. Retry.' },
  tool: { name: 'add_profile_fact', title: 'Remember something about the person', description: 'Add one fact to the person\'s About you, in their words, when they tell you something about their work they want Slatebox to remember.' },
  async handler(principal, input, { deps }) {
    const store = storeOf(deps)
    // With personalization off nothing adds to About you but the person's own typing.
    if (principal.kind === 'agent' && !publicSettings(await store.getSettings(principal.userId)).on)
      throw problem(403, 'personalization_off', 'Personalization is off, so nothing can be added for this person. Only they can switch it on, in Profile › About you.')
    const { fact, added } = await store.add(principal.userId, input, writer(principal))
    return { fact: publicFact(fact), added }
  },
})

const update = defineAction({
  id: 'profile.facts.update',
  title: 'Change a fact about you',
  description: 'New words or a new kind for one fact. Changing the fact from your first slate makes it one of your own.',
  toolset: 'account',
  kind: 'write',
  changesNoSlate: true,
  scope: 'profile:write',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'PATCH', path: '/profile/facts/{factId}', operationId: 'updateProfileFact' } },
  idempotency: 'optional',
  successStatus: 200,
  input: {
    type: 'object',
    properties: { factId: factIdInput, kind: kindInput, text: textInput },
    required: ['factId'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { fact: factSchema }, required: ['fact'] },
  failure: { code: 'profile_failed', message: 'That could not be changed. Retry.' },
  tool: { name: 'update_profile_fact', title: 'Change a fact about the person', description: 'Change the words or the kind of one About you fact.' },
  precheck(_principal, input) {
    if (input.kind === undefined && input.text === undefined) throw problem(400, 'invalid_request', 'Send kind, text or both.')
  },
  async handler(principal, input, { deps }) {
    update.precheck(principal, input)
    const fact = await storeOf(deps).update(principal.userId, input.factId, { kind: input.kind, text: input.text })
    return { fact: publicFact(fact) }
  },
})

const hide = defineAction({
  id: 'profile.facts.hide',
  title: 'Hide a fact about you',
  description: 'Hides one fact: it stays in About you, where you see it, and is never used. hidden false shows it again.',
  toolset: 'account',
  kind: 'write',
  changesNoSlate: true,
  idempotent: true,
  scope: 'profile:write',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/profile/facts/{factId}/hide', operationId: 'hideProfileFact' } },
  idempotency: 'optional',
  successStatus: 200,
  input: {
    type: 'object',
    properties: { factId: factIdInput, hidden: { type: 'boolean', default: true, description: 'false shows the fact again.' } },
    required: ['factId'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { fact: factSchema }, required: ['fact'] },
  failure: { code: 'profile_failed', message: 'That could not be changed. Retry.' },
  tool: { name: 'hide_profile_fact', title: 'Hide or show a fact about the person', description: 'Hide one About you fact so it is never used (hidden false shows it again).' },
  async handler(principal, input, { deps }) {
    return { fact: publicFact(await storeOf(deps).setHidden(principal.userId, input.factId, input.hidden)) }
  },
})

const remove = defineAction({
  id: 'profile.facts.remove',
  title: 'Remove a fact about you',
  description: 'Removes one fact from About you.',
  toolset: 'account',
  kind: 'write',
  destructive: true,
  scope: 'profile:write',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'DELETE', path: '/profile/facts/{factId}', operationId: 'removeProfileFact' } },
  idempotency: 'optional',
  successStatus: 200,
  input: {
    type: 'object',
    properties: { factId: factIdInput },
    required: ['factId'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { factId: { type: 'string' }, removed: { const: true } }, required: ['factId', 'removed'] },
  failure: { code: 'profile_failed', message: 'That could not be removed. Retry.' },
  tool: { name: 'remove_profile_fact', title: 'Remove a fact about the person', description: 'Remove one About you fact.' },
  async handler(principal, input, { deps }) {
    await storeOf(deps).remove(principal.userId, input.factId)
    return { factId: input.factId, removed: true }
  },
})

const clear = defineAction({
  id: 'profile.facts.clear',
  title: 'Delete all facts about you',
  description: 'Removes every fact in About you, or only those from one kind of source (source). Your switches stay as they are.',
  toolset: 'account',
  kind: 'write',
  destructive: true,
  scope: 'profile:write',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/profile/facts/clear', operationId: 'clearProfileFacts' } },
  idempotency: 'optional',
  successStatus: 200,
  input: {
    type: 'object',
    properties: { source: { type: 'string', enum: SOURCE_TYPES, description: 'Only facts from this kind of source.' } },
    additionalProperties: false,
  },
  output: { type: 'object', properties: { removed: { type: 'integer' } }, required: ['removed'] },
  failure: { code: 'profile_failed', message: 'That could not be deleted. Retry.' },
  tool: { name: 'clear_profile_facts', title: 'Delete what Slatebox knows about the person', description: 'Remove every About you fact, or those from one kind of source.' },
  async handler(principal, input, { deps }) {
    return { removed: await storeOf(deps).clear(principal.userId, { sourceType: input.source }) }
  },
})

const settingsGet = defineAction({
  id: 'profile.settings.get',
  title: 'Personalization settings',
  description: 'Whether personalization is on, and each source\'s switch. A connected tool or an upload is off until you switch it on.',
  toolset: 'account',
  kind: 'read',
  scope: 'profile:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/profile/settings', operationId: 'getProfileSettings' } },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: settingsSchema,
  tool: { name: 'get_profile_settings', title: 'Read personalization settings', description: 'Read whether personalization is on for the person, and which sources may add to About you.' },
  async handler(principal, _input, { deps }) {
    return publicSettings(await storeOf(deps).getSettings(principal.userId))
  },
})

const settingsSet = defineAction({
  id: 'profile.settings.set',
  title: 'Turn personalization on or off',
  description: `Turns personalization on or off (on), and sources on or off (sources, by key: interview, integration:<id>, upload:<id>). Only the sources named change; up to ${MAX_SOURCE_SWITCHES} source switches are kept. People only, in the app.`,
  toolset: 'account',
  kind: 'write',
  scope: 'profile:write',
  principals: ['person'],
  mounts: { ddp: true },
  successStatus: 200,
  input: {
    type: 'object',
    properties: {
      on: { type: 'boolean' },
      sources: {
        type: 'object',
        properties: {},
        additionalProperties: { type: 'boolean' },
        description: 'Switches by source key, true or false.',
      },
    },
    additionalProperties: false,
  },
  output: settingsSchema,
  failure: { code: 'profile_failed', message: 'That could not be saved. Retry.' },
  precheck(_principal, input) {
    if (input.on === undefined && !Object.keys(input.sources || {}).length) throw problem(400, 'invalid_request', 'Send on, sources or both.')
    const keys = Object.keys(input.sources || {})
    if (keys.length > 50) throw problem(400, 'invalid_request', 'Send at most 50 sources at once.')
    // a key is a field name in the stored switches, so never a dot or a "$" (SOURCE_KEY_PATTERN)
    const bad = keys.find((key) => !new RegExp(SOURCE_KEY_PATTERN).test(key))
    if (bad) throw problem(400, 'invalid_request', `${bad} is not a source.`, { details: { field: `sources.${bad}` } })
  },
  async handler(principal, input, { deps }) {
    settingsSet.precheck(principal, input)
    return publicSettings(await storeOf(deps).setSettings(principal.userId, { on: input.on, sources: input.sources }))
  },
})

export default [list, add, update, hide, remove, clear, settingsGet, settingsSet]
