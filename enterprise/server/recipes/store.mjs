// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The recipes runtime's records, as MongoDB driver collections (meteor.js passes each Mongo
// collection's rawCollection(); tests pass scripts/fakes/mongo-memory.mjs). Every multi-pod
// guarantee is a single atomic command on one of these (findOneAndUpdate, a unique _id), so the
// runtime needs no lock service. Never published: every read goes through an action.
//   instances   RecipeInstance     one recipe in one project, owned by one person
//   runs        RecipeRun          one run (TTL 90 days after it finishes)
//   notes       RecipeNote         which notes on which slate a recipe keeps (and which became a person's)
//   grants      RecipeGrant        standing permissions to change things outside Slatebox
//   hooks       RecipeHook         outbound, inbound and intercept webhooks (secrets sealed)
//   deliveries  RecipeDelivery     each outbound send and its retries (TTL 14 days)
//   ledger      RecipeLedgerRow    what a recipe remembers between runs (TTL by retention)
//   inbox       RecipeInboxRow     vendor events waiting to fold, and replay keys (TTL 2 days)
//   cards       RecipeCard         a change outside Slatebox waiting for a person's approval
//   settings    { _id: 'install' } the install switch and limit overrides

export const COLLECTIONS = Object.freeze({
  instances: 'recipeInstances',
  runs: 'recipeRuns',
  notes: 'recipeNotes',
  grants: 'recipeGrants',
  hooks: 'recipeHooks',
  deliveries: 'recipeDeliveries',
  ledger: 'recipeLedger',
  inbox: 'recipeInbox',
  cards: 'recipeCards',
  settings: 'recipeSettings',
})

export const RETENTION = Object.freeze({ runsDays: 90, deliveriesDays: 14, ledgerDays: 180, inboxDays: 2, replayHours: 1 })

/** findOneAndUpdate's answer across driver versions (the document, or { value }). */
export const docOf = (result) => (result && Object.hasOwn(result, 'value') && Object.hasOwn(result, 'ok') ? result.value : result) ?? null

export const isDuplicate = (error) => error?.code === 11000 || /E11000/.test(String(error?.message || ''))

/**
 * @param {(name: string) => object} collection  a driver collection by name
 */
export function createRecipeStore(collection) {
  const store = {}
  for (const [key, name] of Object.entries(COLLECTIONS)) store[key] = collection(name)
  store.ensureIndexes = async () => {
    const { instances, runs, notes, grants, hooks, deliveries, ledger, inbox, cards } = store
    await instances.createIndex({ state: 1, nextDueAt: 1 })
    await instances.createIndex({ state: 1, debounceUntil: 1 })
    await instances.createIndex({ state: 1, savesDueAt: 1 })
    await instances.createIndex({ watchSlates: 1 }, { sparse: true })
    await instances.createIndex({ projectId: 1 })
    await instances.createIndex({ ownerId: 1 })
    await instances.createIndex({ 'match.github.installationId': 1 })
    await instances.createIndex({ 'match.slack.teamId': 1 })
    await runs.createIndex({ state: 1, dueAt: 1 })
    await runs.createIndex({ instanceId: 1, startedAt: -1 })
    await runs.createIndex({ instanceId: 1, created: -1 })
    await runs.createIndex({ ownerId: 1, state: 1 })
    await runs.createIndex({ finishedAt: 1 }, { expireAfterSeconds: RETENTION.runsDays * 86400 })
    await notes.createIndex({ slateId: 1 })
    await notes.createIndex({ instanceId: 1 })
    await grants.createIndex({ instanceId: 1, kind: 1 })
    await hooks.createIndex({ 'scope.instanceId': 1 })
    await hooks.createIndex({ 'scope.projectId': 1 })
    await deliveries.createIndex({ state: 1, nextAt: 1 })
    await deliveries.createIndex({ hookId: 1, created: -1 })
    await deliveries.createIndex({ created: 1 }, { expireAfterSeconds: RETENTION.deliveriesDays * 86400 })
    await ledger.createIndex({ instanceId: 1, kind: 1, at: -1 })
    await ledger.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    await inbox.createIndex({ at: 1 }, { expireAfterSeconds: RETENTION.inboxDays * 86400 })
    await cards.createIndex({ instanceId: 1, state: 1 })
    await cards.createIndex({ instanceId: 1, key: 1 }, { unique: true })
  }
  return store
}
