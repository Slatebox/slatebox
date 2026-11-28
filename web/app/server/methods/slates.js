/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-underscore-dangle */
// methods
import { Random } from 'meteor/random'
import { Meteor } from 'meteor/meteor'
import { check, Match } from 'meteor/check'
import { SVGPathData } from 'svg-pathdata'
import stringSimilarity from 'string-similarity'

import slateFilter from '../../imports/api/common/slateFilter'
import rawMongoSearch from '../common/rawMongoSearch'

import {
  Slates,
  SlateAccess,
  AgentTasks,
  Comments,
  Messages,
  GuestViews,
  SlateSnapshots,
  SlatePresentations,
} from '../../imports/api/common/models'
import { readCreativeState } from '../../imports/api/common/creativeSlates.mjs'
import { openSlateRole } from '../common/slate-open-role.mjs'
import { rememberInvitedEdit } from './joined-slates'
import { recordNativeGuestEdit } from './kept-native-slate'
import { saveNativeSlate } from './native-slate-save.mjs'
import { slateSaveCore } from '../slate-save'
import AuthManager from '../../imports/api/common/AuthManager'
import CONSTANTS from '../../imports/api/common/constants'
import { boardEmbed } from '../../imports/api/common/slate-embed.mjs'
import { audit } from '../audit/recorder.mjs'
import { projectAccess, slateProjectRoleOf } from '../projects/access-meteor'
import { checkPlacement } from '../projects/place.mjs'
import { projectCan } from '../../imports/api/common/project-roles.mjs'

// Where published board pictures are served from: the instance itself when self-hosted.
export const embedViewerOrigin = () =>
  Meteor.settings.public.env === 'selfhost' ? Meteor.settings.public.baseUrl : 'https://api.slatebox.com'

async function attempt(asId) {
  const shareId = Random.hexString(10)
  const query = asId ? { 'options.id': shareId } : { shareId }
  let exists = await Slates.findOneAsync(query, { _id: 1 })
  if (!exists) {
    exists = await SlateAccess.findOneAsync({ accessKey: shareId })
  }
  if (exists) {
    return attempt()
  }
  return shareId
}

export const generateSlateShareId = () => attempt()

// The collections the open rule reads (slate-open-role.mjs), shared with collaborators.init.
export const slateOpenStores = {
  findSlate: query => Slates.findOneAsync(query),
  findGrant: query => SlateAccess.findOneAsync(query),
  listGrants: query => SlateAccess.find(query, {
    fields: { slateId: 1, type: 1, userId: 1, accessKey: 1, slateAccessPermissionId: 1 },
  }).fetchAsync(),
  isTeamAdmin: userId => AuthManager.userHasClaim(userId, [CONSTANTS.claims.admin._id]),
  // A slate in a project: the project's people get its role (server/projects).
  projectRoleOf: slateProjectRoleOf,
}

const method = {}

method[CONSTANTS.methods.slates.scale] = async (opts) => {
  check(opts, Match.ObjectIncluding({ path: String, width: Number, height: Number }))
  if (opts.path.length <= 200000 && opts.width && opts.height) {
    const p = new SVGPathData(opts.path).scale(opts.width, opts.height).encode()
    return p
  }
  return null
}

method[CONSTANTS.methods.slates.translate] = async (opts) => {
  check(opts, Match.ObjectIncluding({ path: String, x: Number, y: Number }))
  const user = await Meteor.userAsync()
  if (user && opts.path.length <= 200000) {
    const p = new SVGPathData(opts.path).translate(opts.x, opts.y).encode()
    return p
  }
  return null
}

// Deletes one slate the caller owns, with its sharing, messages, comments and a workshop's own
// presentation. The Slates page's Delete (below) and the API's slates.delete both delete through here.
export async function deleteOwnedSlate(slate) {
  // The activity log keeps its name: there is no restore, so the entry is what remains of it.
  const logged = audit.record({
    action: 'slate.deleted',
    target: { type: 'slate', id: slate.shareId || slate._id, name: slate.options?.name || 'Untitled slate' },
    slateId: slate.shareId || slate._id,
    ...(slate.orgId && { orgId: slate.orgId }),
  })
  await SlateAccess.removeAsync({ slateId: slate._id })
  await Messages.removeAsync({ slateId: slate._id })
  await Comments.removeAsync({ slateId: slate._id })
  await AgentTasks.removeAsync({ slateId: slate._id })
  await Slates.removeAsync({ _id: slate._id })
  if (slate.creative?.model?.kind === 'workshop') {
    await SlatePresentations.removeAsync({ slateShareId: slate.shareId, userId: slate.userId, workshop: { $exists: true } })
  }
  await logged
  return { deleted: true }
}

method[CONSTANTS.methods.slates.remove] = async (opts) => {
  const user = await Meteor.userAsync()
  if (user) {
    const queryable = await slateFilter({ type: 'mine' })
    queryable.push({ _id: { $in: opts.slateIds } })
    const fields = { _id: 1, options: 1, shareId: 1, userId: 1, orgId: 1, projectId: 1, 'creative.model.kind': 1 }
    const slates = await Slates.find({ $and: queryable }, { fields }).fetchAsync()
    // A project's owner deletes slates in it too, whoever made them (server/projects).
    const others = Array.isArray(opts.slateIds)
      ? await Slates.find({ _id: { $in: opts.slateIds.filter(id => typeof id === 'string') }, userId: { $ne: user._id }, projectId: { $type: 'string' } }, { fields }).fetchAsync()
      : []
    for (const slate of others) {
      if (await slateProjectRoleOf(slate, user) === 'owner') slates.push(slate)
    }
    if (slates) {
      // eslint-disable-next-line no-restricted-syntax
      for (const slate of slates) {
        await deleteOwnedSlate(slate)
      }
    } else {
      throw new Meteor.Error(`Slate(s) are not deletable`)
    }
  }
}

method[CONSTANTS.methods.slates.update] = async function updateSlate(request) {
  return saveNativeSlate({
    slates: Slates.rawCollection(),
    saveCore: slateSaveCore,
    rememberInvitedEdit,
    recordGuestEdit: (...args) => recordNativeGuestEdit(this.connection, ...args),
    access: SlateAccess.rawCollection(),
    guestViews: GuestViews.rawCollection(),
    isTeamAdmin: userId => AuthManager.userHasClaim(userId, [CONSTANTS.claims.admin._id]),
    projectRoleOf: slateProjectRoleOf,
    // /new?projectId=: the first save puts the slate in that project, for an editor of it
    placeSlate: (user, projectId) => checkPlacement({ access: projectAccess }, user, projectId),
    denied: () => new Meteor.Error('save-denied', 'You do not have permission to save this slate.'),
  }, await Meteor.userAsync(), request)
}

method[CONSTANTS.methods.slates.get] = async opts => getSlatesForUser(opts, await Meteor.userAsync())

export async function getSlatesForUser(opts, user) {
  // A share id, a url name or an access key is a string; anything else would make the lookups
  // below a search ({ $regex }, { $ne: null }).
  if (!opts || (opts.shareId !== undefined && opts.shareId !== null && typeof opts.shareId !== 'string')) {
    throw new Meteor.Error('invalid-argument', 'A slate is opened by its share id.')
  }
  // A drive link's key (/canvas/<id>?p=<key>) and a project list's project are strings too.
  for (const key of ['projectKey', 'projectId']) {
    if (opts[key] !== undefined && opts[key] !== null && (typeof opts[key] !== 'string' || opts[key].length > 128)) {
      throw new Meteor.Error('invalid-argument', `${key} is a string.`)
    }
  }
  if (opts.shareId) {
    // Who may open it, and as what: the same rule the collaboration relay's room token follows
    // (slate-open-role.mjs, collaborators.init).
    const opened = await openSlateRole(slateOpenStores, opts.shareId, user, { projectKey: opts.projectKey || null })
    if (!opened) return null
    const { slate, accessLevel } = opened
    if (slate?.creative) slate.creative = readCreativeState(slate.creative)

    // always ensure this is copied over for compatibility
    if (slate?.options) {
      slate.options.id = slate._id
    }

    if (slate) {
      // The slate as it was before its first style is for those who may edit it (Revert to original):
      // it may hold notes its author deleted since.
      if (accessLevel !== 'EDIT' && slate.options) delete slate.options.styleOriginal
      return { isMU: user?.isMasterUser, accessLevel, slateBase: slate }
    } else if (user && !/^[a-zA-Z0-9]{8}$/.test(opts.shareId)) {
      // Retired 8-character invitations must never become new boards on reload.
      // The native creator opens a freshly generated 10-character share ID.
      const newId = await attempt(true)
      return { exists: false, id: newId }
    } else {
      // no access
      return null
    }
  } else if (user?._id) {
    // A project's slates (its page): the project, or with nested its folders too, for anyone with a
    // role in it. No role: an empty list, as for a project that does not exist.
    let projectIds
    if (opts.type === 'project') {
      const role = opts.projectId ? await projectAccess.roleFor(user, opts.projectId, { linkKey: opts.projectKey || null }) : null
      if (!role) return { slates: [], counts: { total: 0 } }
      projectIds = await projectAccess.folderIds(opts.projectId, { nested: opts.nested === true })
    }
    const sFilter = await slateFilter({
      type: opts.type,
      projectIds,
      filterString: opts.filterString,
      private: opts.private,
      aiSuitable: opts.aiSuitable,
      useFullText: true,
    })
    const queryable = sFilter
    // const start = new Date().valueOf()
    if (queryable.length === 0) {
      // console.log(
      //   'empty queryable in slates.get',
      //   JSON.stringify(opts, null, 2)
      // )
      return { slates: [], counts: { total: 0 } }
    }
    const cnt = await rawMongoSearch(Slates, { $and: queryable }, 'count')
    const slates = await rawMongoSearch(
      Slates,
      { $and: queryable },
      'toArray',
      'lastSaved',
      opts.skip,
      opts.limit
    )
    // console.log('duration to get both', (new Date().valueOf() - start) / 1000)
    return { slates, counts: { total: cnt } }
  }
  return null
}

method[CONSTANTS.methods.slates.getEmbedCode] = async (opts) => {
  if (!Meteor.userId() || typeof opts?.slateId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(opts.slateId)) return null

  const { code: iframe } = boardEmbed(embedViewerOrigin(), opts.slateId)
  // In the activity log of the slate's team, for its owner and its team's people only.
  const user = await Meteor.userAsync()
  const own = user && await Slates.findOneAsync({ shareId: opts.slateId, $or: [{ userId: user._id }, ...(user.orgId ? [{ orgId: user.orgId }] : [])] }, { fields: { _id: 1 } })
  if (own) audit.record({ action: 'sharing.embedOpened', target: { type: 'slate', id: opts.slateId }, slateId: opts.slateId }, { coalesce: true })
  return { iframe_share: iframe, iframe_noshare: iframe, non_share: iframe, non_noshare: iframe }
}

method[CONSTANTS.methods.slates.generateShareId] = async () => {
  const user = await Meteor.userAsync()
  if (user) {
    return attempt()
  }
  return null
}

method[CONSTANTS.methods.slates.createSnapshot] = async (opts) => {
  check(opts, Match.ObjectIncluding({ slateId: String, snapshot: String }))
  if (Meteor?.userId()) {
    const slate = await Slates.findOneAsync(opts.slateId)
    // Optional-chain: findOneAsync resolves undefined for a slate not yet persisted
    // (new/unsaved), and reading .userId of undefined threw a 500. A missing slate
    // correctly fails this check and skips the snapshot.
    // The owner, and a manager or the owner of the slate's project.
    if (slate?.userId !== Meteor?.userId() &&
        !(slate?.projectId && projectCan(await slateProjectRoleOf(slate, await Meteor.userAsync()), 'snapshotSlates'))) {
      return false
    }
    const last = await SlateSnapshots.findOneAsync(
      { slateId: opts.slateId },
      { sort: { created: -1 } }
    )
    const ps = stringSimilarity.compareTwoStrings(
      opts.snapshot,
      last ? last.snapshot : ''
    )
    // console.log('percentSimilar', ps)
    // 0.9985405384644929
    const threshold = 0.998 // isFree ? 0.95 : 0.998
    if (ps < threshold) {
      // snapshot every 5% change if paid or 20% change if free
      await SlateSnapshots.insertAsync({
        slateId: opts.slateId,
        userId: Meteor.userId(),
        snapshot: opts.snapshot,
        created: new Date(),
      })
    }
    return true
  }

  return false
}

method[CONSTANTS.methods.slates.getSnapshots] = async (opts) => {
  check(opts, Match.ObjectIncluding({ slateId: String }))
  const user = await Meteor.userAsync()
  if (user) {
    const q = { slateId: opts.slateId, userId: user._id }
    const cnt = await rawMongoSearch(SlateSnapshots, q, 'count')
    const all = await rawMongoSearch(
      SlateSnapshots,
      q,
      'toArray',
      'created',
      opts.skip,
      opts.limit
    )
    return { count: cnt, snaps: all }
  }
  return []
}

Meteor.methods(method)
