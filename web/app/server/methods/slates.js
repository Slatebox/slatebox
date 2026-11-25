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
import { resolveSlateRole, slateVisibility } from './slate-role.mjs'
import { rememberInvitedEdit } from './joined-slates'
import { recordNativeGuestEdit } from './kept-native-slate'
import { saveNativeSlate } from './native-slate-save.mjs'
import { slateSaveCore } from '../slate-save'
import AuthManager from '../../imports/api/common/AuthManager'
import CONSTANTS from '../../imports/api/common/constants'
import { boardEmbed } from '../../imports/api/common/slate-embed.mjs'

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
  await SlateAccess.removeAsync({ slateId: slate._id })
  await Messages.removeAsync({ slateId: slate._id })
  await Comments.removeAsync({ slateId: slate._id })
  await AgentTasks.removeAsync({ slateId: slate._id })
  await Slates.removeAsync({ _id: slate._id })
  if (slate.creative?.model?.kind === 'workshop') {
    await SlatePresentations.removeAsync({ slateShareId: slate.shareId, userId: slate.userId, workshop: { $exists: true } })
  }
  return { deleted: true }
}

method[CONSTANTS.methods.slates.remove] = async (opts) => {
  const user = await Meteor.userAsync()
  if (user) {
    const queryable = await slateFilter({ type: 'mine' })
    queryable.push({ _id: { $in: opts.slateIds } })
    const slates = await Slates.find(
      { $and: queryable },
      { fields: { _id: 1, options: 1, shareId: 1, userId: 1, 'creative.model.kind': 1 } }
    ).fetchAsync()
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
  if (opts.shareId) {
    // first get the slate
    let getSlateAccess = null

    // embeddable can send in the url_name as the shareId for templates
    let slate = await Slates.findOneAsync({
      $or: [{ shareId: opts.shareId }, { 'options.url_name': opts.shareId }],
    })


    if (!slate) {
      getSlateAccess = await SlateAccess.findOneAsync({
        accessKey: opts.shareId,
      })
      if (getSlateAccess) {
        slate = await Slates.findOneAsync({ _id: getSlateAccess.slateId })
        if (!slate) return null
        // final check: slate public/private/unlisted options must match the accessKey
        if (
          (getSlateAccess.type === 'unlisted' && !slate.options.isUnlisted) ||
          (getSlateAccess.type === 'private' && !slate.options.isPrivate) ||
          (getSlateAccess.type === 'public' && !slate.options.isPublic)
        ) {
          return null
        }
      }
    }

    if (slate && !user && !slate.options?.isPublic && !slate.options?.isUnlisted) return null
    const isAdmin = Boolean(user?.isMasterUser === true ||
      (user?.orgId && user.orgId === slate?.orgId && await AuthManager.userHasClaim(user._id, [CONSTANTS.claims.admin._id])))

    if (slate?.creative) slate.creative = readCreativeState(slate.creative)

    // always ensure this is copied over for compatibility
    if (slate?.options) {
      slate.options.id = slate._id
    }

    let accessLevel = null
    if (slate) {
      const grants = user?._id && slate.userId === user._id ? [] :
        await SlateAccess.find({ slateId: slate._id, type: slateVisibility(slate) }, {
          fields: { slateId: 1, type: 1, userId: 1, accessKey: 1, slateAccessPermissionId: 1 },
        }).fetchAsync()
      accessLevel = resolveSlateRole(slate, user, isAdmin, grants, getSlateAccess ? opts.shareId : undefined)
      if (!accessLevel) return null
    }
    if (slate) {
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
    const sFilter = await slateFilter({
      type: opts.type,
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
    if (slate?.userId !== Meteor?.userId()) {
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
