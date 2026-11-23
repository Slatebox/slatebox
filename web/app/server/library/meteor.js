// The Meteor side of the shared library: real collections in, the core out (deps.library in
// server/actions/mount.js), plus its indexes and the built-in seed at startup. Everything it wires
// runs without Meteor in the tests (server/library/*.mjs).
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { Email } from 'meteor/email'
import {
  LibraryEvents, LibraryItems, LibraryVersions, Messages, Permissions, SlatePresentations, Slates,
} from '../../imports/api/common/models'
import CONSTANTS from '../../imports/api/common/constants'
import { catalogSamples } from 'slateboxjs/workshops/samples'
import { createLibraryCore } from './core.mjs'
import { seedBuiltins } from './builtins.mjs'
import { migrateCommunity } from './migrate.mjs'
import { createRefineAI } from './refine-ai.mjs'
import { createLibraryNotifier } from './notify.mjs'
import req from '../methods/ai/req'
import { runAIAction } from '../metering/context.mjs'
import { canStartAI } from '../metering/meteor'
import { resolveAIFeatureConfig } from '../methods/ai/feature-config.mjs'

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

// The refine chat of the review panel: the library use key (settings.ai.use.library, then use.chat),
// counted like any chat turn. One per server: its memory lets Keep apply the proposal it previewed.
const refineWithAI = createRefineAI({
  request: (opts) => req(opts),
  meter: (opts, fn) => runAIAction(opts, fn),
  canUseAI: async (userId) => canStartAI(userId && (await Meteor.users.findOneAsync(userId)), 'library'),
  config: () => resolveAIFeatureConfig('library', Meteor.settings),
})

// The author hears about every decision: in the bell's list, and by email when the server sends mail.
const mailAvailable = () => Boolean(process.env.MAIL_URL || Meteor.settings.packages?.email?.service)
const notifyAuthor = (appOrigin) => createLibraryNotifier({
  insertMessage: (row) => Messages.insertAsync(row),
  sendEmail: (mail) => (mailAvailable() ? Email.sendAsync({ from: Meteor.settings.mailFrom || 'no-reply@slatebox.com', ...mail }) : null),
  loadAuthor: async (userId) => {
    const user = await Meteor.users.findOneAsync(userId, { fields: { emails: 1, isAnonymous: 1 } })
    return user && { email: user.emails?.[0]?.address, isAnonymous: Boolean(user.isAnonymous) }
  },
  appOrigin,
})

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
    notify: notifyAuthor(shared.appOrigin || (() => Meteor.settings.public?.baseUrl || '')),
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
