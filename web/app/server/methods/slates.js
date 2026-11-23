/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-underscore-dangle */
// methods
import { Random } from 'meteor/random'
import { Meteor } from 'meteor/meteor'
import { check, Match } from 'meteor/check'
import { fetchPublicImage } from '../common/safe-fetch.mjs'
import { SVGPathData } from 'svg-pathdata'
import fetch from 'node-fetch'
import stringSimilarity from 'string-similarity'

import slateFilter from '../../imports/api/common/slateFilter'
import rawMongoSearch from '../common/rawMongoSearch'

import {
  Slates,
  SlateAccess,
  Comments,
  Messages,
  GuestViews,
  Themes,
  CachedImages,
  CachedImageTiming,
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

// Deletes one slate the caller owns, with its sharing, messages, comments, a workshop's own
// presentation and its theme row. A theme other slates are built on stays: { themeInUse: true }.
// The Slates page's Delete (below) and the API's slates.delete both delete through here.
export async function deleteOwnedSlate(slate) {
  if (slate.options?.eligibleForThemeCompilation) {
    const otherSlates = await Slates.find({ 'options.basedOnThemeId': slate.options.id }).countAsync()
    if (otherSlates !== 0) return { themeInUse: true }
  }
  await SlateAccess.removeAsync({ slateId: slate._id })
  await Messages.removeAsync({ slateId: slate._id })
  await Comments.removeAsync({ slateId: slate._id })
  await Slates.removeAsync({ _id: slate._id })
  if (slate.creative?.model?.kind === 'workshop') {
    await SlatePresentations.removeAsync({ slateShareId: slate.shareId, userId: slate.userId, workshop: { $exists: true } })
  }
  await Themes.removeAsync({ _id: slate._id })
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
    const errors = []
    const infos = []
    if (slates) {
      // eslint-disable-next-line no-restricted-syntax
      for (const slate of slates) {
        const { themeInUse } = await deleteOwnedSlate(slate)
        if (!themeInUse) {
          infos.push(
            `Slate ${slate.options.name} (${slate.options.id}) successfully deleted.`
          )
        } else {
          errors.push(
            `Slate ${slate.options.name} (${slate.options.id}) is a theme in use by others - it cannot be deleted`
          )
        }
      }
      if (errors.length > 0) {
        throw new Meteor.Error(`${errors.join(', ')} | ${infos.join(', ')}`)
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

// A background image from the image search is kept so the canvas can load it from this app.
// Only an https image from a public address, within the size cap, is fetched (safe-fetch.js).
method[CONSTANTS.methods.slates.cacheImage] = async (opts) => {
  check(opts, Match.ObjectIncluding({ url: String }))
  const user = await Meteor.userAsync()
  if (user) {
    const exists = await CachedImages.findOneAsync({ url: opts.url }, { fields: { _id: 1, bytes: 1, contentType: 1 } })
    if (!exists?.bytes) {
      const image = await fetchPublicImage(opts.url).catch((error) => {
        throw new Meteor.Error('image-unavailable', error.message)
      })
      await CachedImages.upsertAsync(
        { url: opts.url },
        { $set: { bytes: image.bytes, contentType: image.contentType } }
      )
    }
    return `${Meteor.settings.public.baseUrl}/sbimages/${encodeURIComponent(opts.url)}`
  }
  return null
}

method[CONSTANTS.methods.slates.searchBackgroundImages] = async (opts) => {
  check(opts, Match.ObjectIncluding({ provider: String, filter: String }))
  const user = await Meteor.userAsync()
  if (user && opts.filter.length <= 200) {
    const getCache = await CachedImageTiming.findOneAsync({
      provider: opts.provider,
      filter: opts.filter,
    })
    if (!getCache) {
      await CachedImageTiming.insertAsync({
        provider: opts.provider,
        filter: opts.filter,
        lastSearched: new Date().valueOf(),
      })
    }
    const lastTime = getCache?.lastSearched || -1
    let res = []
    if (new Date().valueOf() > lastTime + 1000 * 60 * 60 * 24) {
      await CachedImageTiming.upsertAsync(
        {
          provider: opts.provider,
          filter: opts.filter,
        },
        {
          $set: {
            lastSearched: new Date().valueOf(),
          },
        }
      )
      switch (opts.provider) {
        case 'pixabay': {
          const url = `https://pixabay.com/api?key=${encodeURIComponent(Meteor.settings.public.pixabayAPIKey)}&category=backgrounds&safesearch=true&q=${encodeURIComponent(opts.filter)}&per_page=50`
          const response = await fetch(url)
          const data = await response.json()
          for (const d of data.hits) {
            const r = {
              url: d.largeImageURL,
              previewUrl: d.previewURL,
              created: new Date().valueOf(),
              provider: opts.provider,
              filter: opts.filter,
              size: 'cover',
              attribution: {
                title: d.tags,
                author: d.user,
                authorUrl: d.userImageURL,
              },
            }
            await CachedImages.insertAsync(r)
            res.push(r)
          }
          break
        }
        default:
          break
      }
    } else {
      // retrieve and translate the image url
      res = await CachedImages.find(
        { provider: opts.provider, filter: opts.filter },
        { fields: { bytes: 0 } }
      ).fetchAsync()
    }

    return res
    // [
    //   {
    //     id: 2539322,
    //     pageURL: 'https://pixabay.com/photos/blurred-background-united-sa-la-2539322/',
    //     type: 'photo',
    //     tags: 'blurred background, united sa la, focus',
    //     previewURL: 'https://cdn.pixabay.com/photo/2017/07/25/19/44/blurred-background-2539322_150.jpg',
    //     previewWidth: 150,
    //     previewHeight: 99,
    //     webformatURL: 'https://pixabay.com/get/g3ea0f8c0e1f64b12888229d92058075f0c43ca4910a942451c8e746f549da99b4d9c395bf56511a24633f9b47df360a8aa36c3d03508f182f61f5ec0804ba31c_640.jpg',
    //     webformatWidth: 640,
    //     webformatHeight: 426,
    //     largeImageURL: 'https://pixabay.com/get/g88bf9cf9cf0b491554f8ced8a0cf1bec843f027993f4617263d89607fb02a2c7a2dcdb7e23d906d0952583d2018ec49ed661047eb12db19b01b8b2a4694bff74_1280.jpg',
    //     imageWidth: 6000,
    //     imageHeight: 4000,
    //     imageSize: 3726887,
    //     views: 477,
    //     downloads: 156,
    //     collections: 1,
    //     likes: 4,
    //     comments: 1,
    //     user_id: 4926886,
    //     user: 'tranhao',
    //     userImageURL: 'https://cdn.pixabay.com/user/2017/07/29/17-29-20-270_250x250.jpg'
    //   }
    // ]
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
