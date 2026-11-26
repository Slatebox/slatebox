// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The agent gallery as data (/admin/ai › Gallery): administrators turn cards on and off, order them,
// edit what a card says and its recipe (enterprise/server/recipes.mjs). Every change is an aiAgents
// document written through the AI control store, so it has an audit row and moves the generation.
//   - The built-in cards (common/gallery.mjs) serve until a card is edited; a card's address never
//     changes here (consent is to an address). New servers arrive only as Community cards: a custom
//     MCP server someone suggested and an administrator approved in the library's review queue
//     (library kind integration, communityCard), here or on Slatebox Cloud for a licensed install
//     (cloud-library.mjs). They follow the built-in ones; administrators turn them off, order them and
//     edit their words like any card.
//   - A recipe is checked (checkRecipe) before it is saved; at run time a recipe only ever calls a
//     tool the inviter allowed. Its intents run lookups only; its writes only offer a change to the
//     change planner, and every change is an action card a person approves (outside.mjs), unless
//     the inviter lets the agent act without asking. Its tools word (lookup, change, destructive)
//     corrects how a tool is grouped: an administrator's call, audited like every edit.
//   - Only a person saves or reorders (an agent may read). The hint the planner gets for a card is a
//     prompt (connectors.recipe.<id>) in the Prompts tab, versioned and published there; a card with
//     none yet (promptIdOf: null) is planned from its tools' own descriptions.
import { defineAction } from '/server/actions/registry.mjs'
import { requireAIControlAdmin } from '/server/actions/ai-control-get.mjs'
import { guardControlWrite } from '/server/actions/ai-providers.mjs'
import { GALLERY, GROUPS, NATIVE_CARDS, RETIRED, RETIRED_WORDS, canonicalAddress, cardFor } from '../common/gallery.mjs'
import { checkMcpUrl } from './mcp-fetch.mjs'
import { checkRecipe } from './recipes.mjs'
import { plainText } from './tools.mjs'
import { PROMPT_IDS } from '/server/ai-control/prompts/index.mjs'
import { secretInPath } from '/imports/api/common/library-model.mjs'

export const EDITABLE = Object.freeze({ name: 40, job: 40, lands: 200, try: 120, cost: 60, keyHint: 120 })
const docId = (id) => 'gallery:' + id
// The planner's hint for a card (connectors.recipe.<id>, in Prompts), or null for a card with none yet.
export const promptIdOf = (id) => (PROMPT_IDS.includes('connectors.recipe.' + id) ? 'connectors.recipe.' + id : null)

const COMMUNITY_COST = Object.freeze({ none: 'Free', oauth: 'Sign in on its own page', key: 'Needs your key or token' })
/** A Community card's id: a gallery id (^[a-z0-9]{1,40}$) made from its library item's id. */
export const communityId = (itemId) => 'c' + String(itemId || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 39)

/**
 * The gallery card a published library integration is (this server's own, or one Slatebox Cloud
 * exported to a licensed install), or null when anything in it fails the checks every card passes:
 * a canonical https address the endpoint policy allows, plain words within the card limits with no
 * web addresses, a known group, and no secret in its path (secretInPath). Its words are its author's and
 * reviewer's, never the server's own. devOrigins: this install's own development origins, for its own
 * cards only (a card from Slatebox Cloud is checked with none).
 */
export function communityCard(item, { from = 'local', devOrigins = [] } = {}) {
  if (!item || item.kind !== 'integration' || (item.status && item.status !== 'published')) return null
  const fields = item.integration || {}
  const url = canonicalAddress(fields.address)
  if (!url) return null
  try {
    // The address as stored (canonicalAddress alone would quietly drop a user name or password).
    const allowed = from === 'cloud' ? [] : devOrigins
    checkMcpUrl(String(fields.address), { devOrigins: allowed })
    checkMcpUrl(url, { devOrigins: allowed })
  } catch {
    return null
  }
  // A per-account secret in its path: whoever connected the card would act as its author. Never a card.
  if (secretInPath(String(fields.address)) || secretInPath(url)) return null
  const name = plainText(item.title, EDITABLE.name)
  const lands = plainText(item.summary, EDITABLE.lands)
  const group = GROUPS.some((g) => g.id === item.category) ? item.category : null
  if (!name || !lands || !group || [name, lands].some((text) => /\bhttps?:\/\//i.test(text))) return null
  const auth = ['none', 'oauth', 'key'].includes(fields.auth) ? fields.auth : 'none'
  let homepage = null
  try {
    const page = new URL(String(fields.homepage || ''))
    if (page.protocol === 'https:' && !page.username && !page.password) homepage = page.href.slice(0, 300)
  } catch {}
  const id = communityId(item.id || item._id)
  if (id.length < 2) return null
  return {
    id,
    origin: 'community',
    from,
    itemId: String(item.id || item._id),
    group,
    name,
    url,
    job: GROUPS.find((g) => g.id === group).label,
    lands,
    featured: false,
    cost: COMMUNITY_COST[auth],
    signIn: auth === 'none' ? null : auth,
    ...(auth === 'key' && { keyHint: 'Paste a key or token' }),
    ...(homepage && { homepage }),
    sharedBy: plainText(item.authorName, 60) || 'A Slatebox user',
    reviewedTools: (Array.isArray(fields.reviewedTools) ? fields.reviewedTools : []).slice(0, 64)
      .filter((tool) => typeof tool?.name === 'string' && typeof tool?.hash === 'string').map(({ name: tool, hash }) => ({ name: tool.slice(0, 128), hash: hash.slice(0, 128) })),
    recipe: { rounds: 1, calls: 2, intents: [] },
  }
}

/**
 * Community cards to add after the built-in ones: the first card for each address wins (this
 * server's own before Slatebox Cloud's), and none for an address a built-in card or alias lists.
 */
export function mergeCommunity(builtin = GALLERY, ...lists) {
  const out = []
  for (const card of lists.flat()) {
    if (!card?.url || cardFor(card.url, builtin) || cardFor(card.url, out) || out.some((have) => have.id === card.id)) continue
    out.push(card)
  }
  return out
}

/** The cards as served: the built-in ones with each saved edit on top, the enabled ones in order. */
export function liveGallery(docs = [], builtin = GALLERY, { all = false, extra = [] } = {}) {
  const byId = new Map(docs.filter((doc) => doc?.kind === 'outbound-connector' && typeof doc.galleryId === 'string').map((doc) => [doc.galleryId, doc]))
  const cards = [...builtin, ...mergeCommunity(builtin, extra)].map((card, index) => {
    const doc = byId.get(card.id)
    if (!doc) return { ...card, enabled: true, order: index, edited: false }
    // A saved word that is still a retired built-in default ("Reads only.") gives way to the card's current one.
    const retired = (key) => (RETIRED_WORDS[card.id]?.[key] || []).includes(doc[key].trim())
    const text = Object.fromEntries(Object.keys(EDITABLE).filter((key) => typeof doc[key] === 'string' && doc[key].trim() && !retired(key)).map((key) => [key, doc[key]]))
    return {
      ...card,
      ...text,
      url: card.url, // never edited
      recipe: doc.recipe ? checkRecipe(doc.recipe) || card.recipe : card.recipe,
      enabled: doc.enabled !== false,
      order: Number.isFinite(doc.order) ? doc.order : index,
      edited: true,
    }
  })
  const sorted = cards.sort((a, b) => a.order - b.order)
  return all ? sorted : sorted.filter((card) => card.enabled)
}

/** One card's edit, checked: plain text within limits, a recipe that reads, enabled a boolean. */
export function checkCardEdit(id, changes = {}, builtin = GALLERY) {
  const card = builtin.find((c) => c.id === id)
  if (!card) throw Object.assign(new Error('That is not a card in the gallery.'), { status: 404, code: 'not_found' })
  const out = {}
  for (const [key, max] of Object.entries(EDITABLE)) {
    if (changes[key] === undefined) continue
    const text = plainText(changes[key], max)
    if (!text && key !== 'keyHint') throw Object.assign(new Error(`A card needs ${key === 'try' ? 'an example ask' : 'its ' + key}.`), { status: 400, code: 'invalid_request' })
    if (/\bhttps?:\/\//i.test(text) && key !== 'try') throw Object.assign(new Error('Card words carry no web addresses.'), { status: 400, code: 'invalid_request' })
    out[key] = text
  }
  if (changes.enabled !== undefined) out.enabled = changes.enabled === true
  if (changes.recipe !== undefined) {
    const recipe = checkRecipe(changes.recipe)
    if (!recipe) throw Object.assign(new Error('That recipe could not be read.'), { status: 400, code: 'invalid_request' })
    const asked = (Array.isArray(changes.recipe?.intents) ? changes.recipe.intents : []).length
    if (recipe.intents.length !== asked) throw Object.assign(new Error('An ask in that recipe is missing its key, its words or its steps.'), { status: 400, code: 'invalid_request' })
    out.recipe = recipe
  }
  if ('url' in changes || 'address' in changes) throw Object.assign(new Error('A card\'s address cannot change: people consented to it.'), { status: 400, code: 'invalid_request' })
  return out
}

/** The gallery operations over the aiAgents documents (find) and the AI control store (store.write). */
export function createGalleryOps({ find, store, configured = null, community = async () => [] }) {
  const docs = async () => (await find()) || []
  const extra = async () => (await community()) || []
  return {
    async live() {
      return liveGallery(await docs(), GALLERY, { extra: await extra() })
    },
    async list() {
      const cards = liveGallery(await docs(), GALLERY, { all: true, extra: await extra() })
      return {
        cards: cards.map((card) => ({ ...card, promptId: promptIdOf(card.id) })),
        retired: RETIRED.map(({ id, name, url, why }) => ({ id, name, url, why })),
        // Built into Slatebox (Google Drive): on or off and their words, like a card; and, as yes or
        // no only, whether this server has what each needs.
        native: liveGallery(await docs(), NATIVE_CARDS, { all: true }).map((card) => ({ ...card, promptId: promptIdOf(card.id) })),
        ...(configured && { configuration: await configured() }),
      }
    },
    async save({ actor, id, changes, reason = null }) {
      const native = NATIVE_CARDS.some((c) => c.id === id)
      // A Community card is edited like a built-in one (its address never changes either).
      const builtin = native ? NATIVE_CARDS : [...GALLERY, ...mergeCommunity(GALLERY, await extra())]
      const set = checkCardEdit(id, changes, builtin)
      const current = (await docs()).find((doc) => doc._id === docId(id)) || { kind: 'outbound-connector', galleryId: id, order: builtin.findIndex((c) => c.id === id) }
      const { _id, updatedAt, updatedBy, ...kept } = current
      const written = await store.write({ kind: 'agents', id: docId(id), doc: { ...kept, ...set, kind: 'outbound-connector', galleryId: id }, action: 'ai.agents.gallery.save', actor, reason })
      return { id, card: liveGallery([written.after], builtin, { all: true }).find((c) => c.id === id), generation: written.generation }
    },
    async reorder({ actor, ids }) {
      const known = [...GALLERY, ...mergeCommunity(GALLERY, await extra())].map((card) => card.id)
      if (!Array.isArray(ids) || ids.length !== known.length || !known.every((id) => ids.includes(id))) throw Object.assign(new Error('Name every card once, in the new order.'), { status: 400, code: 'invalid_request' })
      const current = new Map((await docs()).map((doc) => [doc._id, doc]))
      let generation = null
      for (const [order, id] of ids.entries()) {
        const before = current.get(docId(id)) || { kind: 'outbound-connector', galleryId: id }
        if (before.order === order) continue
        const { _id, updatedAt, updatedBy, ...kept } = before
        generation = (await store.write({ kind: 'agents', id: docId(id), doc: { ...kept, order }, action: 'ai.agents.gallery.reorder', actor })).generation
      }
      return { ids, generation }
    },
  }
}

const CARD_OUT = { type: 'object', properties: { id: { type: 'string' }, card: { type: 'object' }, generation: { type: ['integer', 'null'] } } }
const personOnly = () => 'Only a person changes the agent gallery.'

/** The admin actions, over a getter for the aiAgents reader (set at server start); writes go through deps.aiControlStore. */
export function galleryActions(finder, configured = null, community = async () => []) {
  const ops = (deps) => createGalleryOps({ find: finder(), store: deps.aiControlStore, configured, community })
  return [
    defineAction({
      id: 'ai.agents.gallery.list',
      title: 'Agent gallery',
      description: 'Lists the outside agents the invite gallery offers: each card\'s words, whether it is on, its order, its recipe (the asks it runs without a planner) and the prompt that hints the planner; and the agents no longer listed, with why. Administrators only.',
      toolset: 'admin',
      kind: 'read',
      scope: 'ai:admin:read',
      principals: ['person', 'agent'],
      mounts: { ddp: true, http: { method: 'GET', path: '/ai/control/agents/gallery', operationId: 'listAIAgentGallery' } },
      tool: { name: 'list_ai_agent_gallery', title: 'List the agent gallery', description: 'List the agent gallery\'s cards, their order and recipes. Administrators only.' },
      input: { type: 'object', properties: {}, additionalProperties: false },
      output: { type: 'object', properties: { cards: { type: 'array', items: { type: 'object' } }, retired: { type: 'array', items: { type: 'object' } }, native: { type: 'array', items: { type: 'object' } }, configuration: { type: 'object', description: 'Yes or no for each thing a native integration needs on this server (never a value).' } } },
      handler: async (principal, _input, { deps }) => {
        await requireAIControlAdmin(principal, deps, 'read the agent gallery')
        return { status: 200, body: await ops(deps).list() }
      },
    }),
    defineAction({
      id: 'ai.agents.gallery.save',
      title: 'Save agent gallery card',
      description: 'Changes one gallery card: on or off, its words, or its recipe (checked before it is saved). Its address never changes. Audited. People only. Administrators only.',
      toolset: 'admin',
      kind: 'write',
      scope: 'ai:admin',
      principals: ['person'],
      // The app's page only, like publishing a prompt: a person changes what everyone is offered.
      mounts: { ddp: true },
      changesNoSlate: true,
      idempotency: 'optional',
      input: {
        type: 'object',
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9]{1,40}$', description: 'The card, as ai.agents.gallery.list gives it.' },
          changes: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' }, name: { type: 'string', maxLength: 40 }, job: { type: 'string', maxLength: 40 }, lands: { type: 'string', maxLength: 200 },
              try: { type: 'string', maxLength: 120 }, cost: { type: 'string', maxLength: 60 }, keyHint: { type: 'string', maxLength: 120 }, recipe: { type: 'object' },
            },
            additionalProperties: false,
          },
          reason: { type: 'string', maxLength: 300 },
        },
        required: ['id', 'changes'],
        additionalProperties: false,
      },
      output: CARD_OUT,
      handler: async (principal, input, { deps }) => {
        const actor = await guardControlWrite(principal, deps, { action: 'ai.agents.gallery.save', target: { kind: 'agent', id: input.id }, doing: 'change the agent gallery', refusal: personOnly })
        return { status: 200, body: await ops(deps).save({ actor, id: input.id, changes: input.changes, reason: input.reason ?? null }) }
      },
    }),
    defineAction({
      id: 'ai.agents.gallery.reorder',
      title: 'Reorder agent gallery',
      description: 'Puts the gallery\'s cards in a new order (every card once). Audited. People only. Administrators only.',
      toolset: 'admin',
      kind: 'write',
      scope: 'ai:admin',
      principals: ['person'],
      mounts: { ddp: true },
      changesNoSlate: true,
      idempotency: 'optional',
      input: { type: 'object', properties: { ids: { type: 'array', maxItems: 240, items: { type: 'string', pattern: '^[a-z0-9]{1,40}$' } } }, required: ['ids'], additionalProperties: false },
      output: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, generation: { type: ['integer', 'null'] } } },
      handler: async (principal, input, { deps }) => {
        const actor = await guardControlWrite(principal, deps, { action: 'ai.agents.gallery.reorder', target: { kind: 'agent', id: 'gallery' }, doing: 'change the agent gallery', refusal: personOnly })
        return { status: 200, body: await ops(deps).reorder({ actor, ids: input.ids }) }
      },
    }),
  ]
}
