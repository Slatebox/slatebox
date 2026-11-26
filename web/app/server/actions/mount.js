// The Meteor side of the action registry: real stores in, the HTTP routes and the Meteor
// methods out. Everything below this file runs without Meteor and is tested that way.
import express from 'express'
import { Meteor } from 'meteor/meteor'
import { Mongo, MongoInternals } from 'meteor/mongo'
import { Random } from 'meteor/random'
import {
  Comments,
  Messages,
  SlateAccess,
  SlateOperationRuns,
  SlatePresentations,
  Slates,
} from '../../imports/api/common/models'
import { getExternalUserName } from '../../imports/api/common/getUserName'
import { applyPlanToJSON } from 'slateboxjs/operations'
import { createWorkshopOperations } from '../workshop-operation-api.mjs'
import { createSlateReader } from '../slate-read.mjs'
import { createPrivateSlateOperation } from '../create-slate-api.mjs'
import { createSlateInviteOperation } from '../slate-invite-api.mjs'
import { deleteOwnedSlate, embedViewerOrigin, generateSlateShareId } from '../methods/slates'
import { canCommentSlate } from '../common/slate-access'
import { resolvePresentationSlate } from '../methods/creative-slates'
import { slateSaveCore } from '../slate-save'
import CONSTANTS from '../../imports/api/common/constants'
import AuthManager from '../../imports/api/common/AuthManager'
import { slateListSelector } from './slate-list.mjs'
import { API_TOKEN_SCOPES } from '../api-token-core.mjs'
import apiTokenService from '../api-token-auth.mjs'
import { createAppRegistry } from './index.mjs'
import { enterpriseHost } from '../enterprise-loader.mjs'
import { accounts, describer } from '../instance/meteor'
import { createIdempotencyStore, ensureIdempotencyIndexes } from './idempotency.mjs'
import { createRateLimiter } from './rate-limit.mjs'
import { principalFromToken } from './principal.mjs'
import { MOVE_ACTIONS, MOVE_RESOURCE_PATH } from '../oauth/device.mjs'
import { mountHttp } from './http.mjs'
import { mountDdp } from './ddp.mjs'
import { mountMermaidFiles } from './mermaid-file.mjs'
import { createMeteorExec, ensureExecCollections } from '../exec/meteor'
import { gatedRegistry } from '../exec/system.mjs'
import { aiSettings } from '../methods/ai/ai-settings'
import { aiBindings, aiCatalog, aiControl, aiControlOps, aiControlStore, aiControlWriteLimit, aiKeys, aiPrompts, isAIControlAdmin } from '../ai-control/index.mjs'
import { presence } from '../presence/meteor'
import { mountTeamExport, teamTransfer } from '../team-export/meteor'
import { shapeService } from '../shapes/meteor'
import { createPresentationFor } from '../methods/presentations'
import { mediaLookup } from '../media/meteor'
import { posterAllowedFor } from '../media/media-lookup.mjs'
import { createAppLibrary } from '../library/meteor'
import { countApiCall, noticingFirstAction } from '../agent-reach/usage-meteor'
import { profileStore } from '../profile/meteor'
import { createAppPersonal } from '../personal/meteor'

const IdempotencyRecords = new Mongo.Collection('apiIdempotencyRecords')
const RateWindows = new Mongo.Collection('apiRateWindows')

const appOrigin = () => Meteor.settings.public.baseUrl || Meteor.absoluteUrl()
const store = {
  slates: Slates.rawCollection(),
  runs: SlateOperationRuns.rawCollection(),
  saveCore: slateSaveCore,
  withTransaction: (action) =>
    MongoInternals.defaultRemoteCollectionDriver()
      .mongo.client.withSession((session) => session.withTransaction(() => action(session))),
}

export const idempotency = createIdempotencyStore({ collection: IdempotencyRecords.rawCollection() })
export const deps = {
    apiTokens: apiTokenService,
    authorizeTokenForSlate: apiTokenService.authorizeTokenForSlate,
    readSlate: createSlateReader({
      listComments: (slateId) =>
        Comments.rawCollection().find({ slateId }, { projection: { nodeId: 1, resolved: 1 } }).toArray(),
      findPresentation: (selector) => SlatePresentations.rawCollection().findOne(selector),
      appOrigin,
      embedOrigin: embedViewerOrigin,
    }),
    applySlateOperationPlanToJSON: applyPlanToJSON,
    applyWorkshopOperations: createWorkshopOperations(store),
    manageInvite: createSlateInviteOperation({
      ...store,
      grants: SlateAccess.rawCollection(),
      users: Meteor.users.rawCollection(),
      generateKey: () => Random.id(8),
      appOrigin,
    }),
    createPrivateSlate: createPrivateSlateOperation({
      ...store,
      users: Meteor.users.rawCollection(),
      generateShareId: generateSlateShareId,
      appOrigin,
    }),
    saveCore: slateSaveCore,
    operationRuns: SlateOperationRuns,
    // The session rule the canvas uses: what this account may open and edit.
    // The drawer's comment rule (comments.add for a signed-in page): the sharing comment role.
    canComment: (slate, userId) => canCommentSlate(userId, slate),
    async resolveSlateForUser(shareId, userId) {
      const access = await resolvePresentationSlate(shareId, userId)
      return access ? { slate: access.slateBase, canRead: Boolean(access.accessLevel), canEdit: access.canEdit } : null
    },
    newId: () => Random.id(),
    publishedPresentation: (shareId) => SlatePresentations.findOneAsync({ slateShareId: shareId, isPublished: true }),
    // presentations.get and presentations.setStyle: the caller's latest deck of a slate.
    latestPresentation: (shareId, userId) => SlatePresentations.findOneAsync(
      { slateShareId: shareId, userId, viewpoints: { $type: 'array' } },
      { sort: { version: -1 } }
    ),
    savePresentation: (id, set) => SlatePresentations.updateAsync({ _id: id }, { $set: set }),
    // presentations.create: Present's plan, on the server (methods/presentations.js).
    createPresentation: (request) => createPresentationFor(request),
    async copyPresentation(presentation, { shareId, sourceShareId, user, now }) {
      const { isFeatured: _retired, ...deck } = structuredClone(presentation)
      await SlatePresentations.insertAsync({
        ...deck,
        _id: Random.id(),
        slateShareId: shareId,
        originalPresentationId: presentation._id,
        originalSlateShareId: sourceShareId,
        copiedOn: now,
        version: 1,
        userId: user._id,
        orgId: user.orgId,
        author: await getExternalUserName(user._id),
        isPublic: false,
      })
    },
    loadUser: (userId) => Meteor.users.findOneAsync(userId, { fields: { _id: 1, orgId: 1, isAnonymous: 1 } }),
    generateShareId: generateSlateShareId,
    appOrigin,
    instance: describer,
    accounts,
    // ai.get, ai.update, ai.check (methods/ai/ai-settings.js)
    ai: aiSettings,
    aiControl,
    aiControlAdmin: isAIControlAdmin,
    // ai.audit.list, usage per surface and ai.control.reset (ai-control/admin.mjs)
    aiControlOps,
    aiControlStore,
    // ai.providers.*, ai.models.* (ai-control/models.mjs); AI control writes per administrator
    aiCatalog,
    // ai.keys.*: the providers' keys, kept in the backend (ai-control/keys.mjs)
    aiKeys,
    aiControlWriteLimit,
    // ai.bindings.* (ai-control/bindings.mjs)
    aiBindings,
    aiPrompts,
    // Agents on the canvas: a saved write shows its run's pointer to everyone on the slate.
    presence,
    // team.export and teamImports.* (server/team-export)
    teamTransfer,
    // shapes.generate, shapes.list, shapes.searchIcons, shapes.apply (server/shapes)
    shapes: shapeService,
    // slates.list: the Slates page's lists (imports/api/common/slateFilter.js), for a token's account.
    async listSlates({ userId, orgId, scope, q, limit }) {
      let isAdmin = false
      let grantedIds = []
      if (scope === 'team' && orgId) {
        isAdmin = await AuthManager.userHasClaim(userId, [CONSTANTS.claims.admin._id])
        if (!isAdmin) {
          const grants = await SlateAccess.find({
            userId, type: 'private', orgId,
            slateAccessPermissionId: { $ne: CONSTANTS.slateAccessPermissions.none.id },
          }, { fields: { slateId: 1 } }).fetchAsync()
          grantedIds = grants.map((grant) => grant.slateId)
        }
      }
      const selector = slateListSelector({ userId, orgId, scope, isAdmin, grantedIds, q })
      if (!selector) return []
      return Slates.rawCollection().find(selector, {
        projection: { shareId: 1, userId: 1, lastSaved: 1, 'options.name': 1, 'options.description': 1, 'options.isPublic': 1, 'options.isUnlisted': 1, 'options.isPrivate': 1 },
        sort: { lastSaved: -1 },
        limit,
      }).toArray()
    },
    // slates.delete: the Slates page's Delete (methods/slates.js).
    deleteSlate: (slate) => deleteOwnedSlate(slate),
    // comments.*: the comment drawer's collection, through Meteor so open drawers update.
    userName: (userId) => getExternalUserName(userId),
    comments: {
      list: ({ slateId, nodeId, unresolved }) => Comments.find(
        { slateId, ...(nodeId && { nodeId }), ...(unresolved && { resolved: { $ne: true } }) },
        { sort: { timestamp: 1 }, limit: 500 }
      ).fetchAsync(),
      add: (row) => Comments.insertAsync(row),
      resolve: ({ slateId, nodeId, resolved }) =>
        Comments.updateAsync({ slateId, nodeId }, { $set: { resolved } }, { multi: true }),
      get: ({ slateId, commentId }) => Comments.findOneAsync({ _id: commentId, slateId }),
      async remove({ slateId, commentId }) {
        const removed = await Comments.removeAsync({ _id: commentId, slateId })
        if (removed) await Messages.removeAsync({ commentId })
        return removed
      },
    },
    // media.lookup and slates.addMedia (server/media): video titles and posters
    media: mediaLookup,
    // Video posters in a plan must be ones this app stored (slate-operations.mjs).
    posterAllowed: (url) => posterAllowedFor(Meteor.settings)(url),
    // profile.*: About you, the person's own facts and switches (server/profile)
    profile: profileStore,
}

// library.* (server/library): the shared library, over the same save core, slate access and decks.
deps.library = createAppLibrary(deps)
// personal.ideas.* (server/personal): For you, which saves to the library and opens slates through the same doors.
deps.personal = createAppPersonal(deps)

export const limiter = createRateLimiter({ collection: RateWindows.rawCollection() })
export const registry = createAppRegistry({ deps, idempotency, limiter, extraActions: enterpriseHost.actions })
// exec: the sealed runner and the gate. exec.run reaches it through deps; a local script's
// calls (Slatebox-Exec-* headers) reach the gate through the gated registry below.
export const exec = createMeteorExec({ registry, idempotency, presence })
deps.exec = exec.service
ensureExecCollections()

export function mountActions(app) {
  // Proxies in front of the app; Meteor reads the same setting for its own client addresses.
  const forwardedCount = Number.parseInt(process.env.HTTP_FORWARDED_COUNT, 10) || 0
  mountHttp(app, gatedRegistry(registry, exec.gate), {
    express,
    // Personal tokens; and a move's device sign-in (server/oauth/device.mjs), for the move actions only.
    authenticate: async (req) => {
      const moveResource = new URL(Meteor.settings.public?.baseUrl || Meteor.absoluteUrl()).origin + MOVE_RESOURCE_PATH
      return principalFromToken(await apiTokenService.authenticateApiRequest(req, { audience: moveResource }), { audiences: { [moveResource]: MOVE_ACTIONS } })
    },
    forwardedCount,
    // a token's calls, counted by action and User-Agent (agent-reach), for Admin › Overview
    onAgentCall: countApiCall,
  })
  // A public slate's Mermaid as plain text: /slates/<id>.mmd and .md.
  mountMermaidFiles(app, registry, { forwardedCount })
  // The one-time addresses a team export downloads from and an import uploads to.
  mountTeamExport(app, express)
  // each account's first action through the app, beside the first by an agent (agent-reach)
  const ddp = {
    defineMethods: (methods) => Meteor.methods(methods),
    makeError: (code, reason, details) => new Meteor.Error(code, reason, details),
    loadUser: (userId) => Meteor.users.findOneAsync(userId, { fields: { _id: 1, isAnonymous: 1 } }),
    scopes: API_TOKEN_SCOPES,
  }
  mountDdp(noticingFirstAction(registry), { ...ddp })
}

Meteor.startup(async () => {
  await RateWindows.rawCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  await ensureIdempotencyIndexes(IdempotencyRecords.rawCollection())
})
