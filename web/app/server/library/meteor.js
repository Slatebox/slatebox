// The Meteor side of the shared library: real collections in, the core out (deps.library in
// server/actions/mount.js), plus its indexes and the built-in seed at startup. Everything it wires
// runs without Meteor in the tests (server/library/*.mjs).
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import {
  LibraryEvents, LibraryItems, LibraryVersions, Permissions, SlatePresentations, Slates,
} from '../../imports/api/common/models'
import CONSTANTS from '../../imports/api/common/constants'
import { catalogSamples } from 'slateboxjs/workshops/samples'
import { createLibraryCore } from './core.mjs'
import { seedBuiltins } from './builtins.mjs'
import { migrateCommunity } from './migrate.mjs'
import { refineWithAI } from './refine-ai.mjs'

const raw = (collection) => collection.rawCollection()

/** A server administrator (the uberMensch claim): who reviews library submissions. */
export const isLibraryReviewer = async (userId) =>
  Boolean(userId && (await Permissions.findOneAsync({ userId, claimId: CONSTANTS.claims.uberMensch._id }, { fields: { _id: 1 } })))

// The name shown as an item's author: the account's own name, never its email address.
async function loadUser(userId) {
  const user = userId && (await Meteor.users.findOneAsync(userId, { fields: { _id: 1, orgId: 1, isAnonymous: 1, 'profile.firstName': 1, 'profile.lastName': 1 } }))
  if (!user) return null
  const name = user.isAnonymous ? '' : [user.profile?.firstName, user.profile?.lastName].filter((part) => typeof part === 'string' && part.trim()).join(' ')
  return { _id: user._id, orgId: user.orgId, isAnonymous: Boolean(user.isAnonymous), name }
}

const isTeamAdmin = async (userId, orgId) =>
  Boolean(userId && orgId && (await Permissions.findOneAsync({ userId, orgId, claimId: CONSTANTS.claims.admin._id }, { fields: { _id: 1 } })))

/** The library core over the app's collections. `shared` is mount.js's deps (save core, slate access, presentations). */
export function createAppLibrary(shared) {
  return createLibraryCore({
    items: raw(LibraryItems),
    versions: raw(LibraryVersions),
    events: raw(LibraryEvents),
    slates: raw(Slates),
    saveCore: shared.saveCore,
    isLibraryReviewer,
    loadUser,
    isTeamAdmin,
    resolveSlateForUser: shared.resolveSlateForUser,
    latestPresentation: shared.latestPresentation,
    publishedPresentation: shared.publishedPresentation,
    copyPresentation: shared.copyPresentation,
    applyWorkshopOperations: shared.applyWorkshopOperations,
    refineWithAI,
    generateShareId: shared.generateShareId,
    newId: () => Random.id(),
    now: Date.now,
    appOrigin: shared.appOrigin,
    samples: catalogSamples,
  })
}

/** The library's indexes (spec §2.1-2.3). */
export async function ensureLibraryIndexes() {
  const items = raw(LibraryItems)
  await items.createIndex({ status: 1, kind: 1, category: 1, publishedAt: -1 })
  await items.createIndex({ authorId: 1, status: 1, updatedAt: -1 })
  await items.createIndex({ reviewStatus: 1, submittedAt: 1 }, { partialFilterExpression: { reviewStatus: { $type: 'string' } } })
  await items.createIndex({ slug: 1 }, { unique: true })
  await items.createIndex({ builtinId: 1 }, { unique: true, sparse: true })
  await items.createIndex({ migratedFrom: 1 }, { unique: true, sparse: true })
  await items.createIndex({ kind: 1, sourceShareId: 1, authorId: 1 })
  await raw(LibraryVersions).createIndex({ itemId: 1, n: 1 }, { unique: true })
  await raw(LibraryEvents).createIndex({ itemId: 1, at: 1 })
  await raw(LibraryEvents).createIndex({ type: 1, 'actor.userId': 1, at: -1 })
}

/** The built-in catalogue entries as library items, refreshed at every start. */
export function seedLibraryBuiltins() {
  return seedBuiltins({ items: raw(LibraryItems), versions: raw(LibraryVersions), events: raw(LibraryEvents), samples: catalogSamples, newId: () => Random.id() })
}

/** Community slates, templates and featured presentations as library items (QUEUE runs it at startup). */
export async function migrateCommunitySlates({ dryRun = false } = {}) {
  const master = await Meteor.users.findOneAsync({ isMasterUser: true }, { fields: { _id: 1 } })
  return migrateCommunity({
    slates: raw(Slates), presentations: raw(SlatePresentations), items: raw(LibraryItems), versions: raw(LibraryVersions), events: raw(LibraryEvents),
    userName: async (userId) => (await loadUser(userId))?.name || 'A Slatebox user', masterUserId: master?._id ?? null,
    newId: () => Random.id(), dryRun,
  })
}
