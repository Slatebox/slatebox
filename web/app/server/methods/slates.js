/* eslint-disable no-underscore-dangle */
// methods
import { Random } from 'meteor/random'
import { Meteor } from 'meteor/meteor'
import { SVGPathData } from 'svg-pathdata'
import fetch from 'node-fetch'
import imageToBase64 from 'image-to-base64'
import stringSimilarity from 'string-similarity'
import { Buffer } from 'buffer'
import slateFilter from '../../imports/api/common/slateFilter'
import rawMongoSearch from '../common/rawMongoSearch'
import {
  Organizations,
  Slates,
  SlateAccess,
  ArchivedSlates,
  Comments,
  Messages,
  GuestViews,
  Themes,
  CachedImages,
  CachedImageTiming,
  SlateSnapshots,
} from '../../imports/api/common/models'
import CONSTANTS from '../../imports/api/common/constants'

const method = {}

method[CONSTANTS.methods.slates.scaleAndTranslate] = async (opts) => {
  if (Meteor.user()) {
    const p = new SVGPathData(opts.path)
      .scale(opts.width, opts.height)
      .translate(opts.x, opts.y)
      .encode()
    return p
  }
  return null
}

method[CONSTANTS.methods.slates.scale] = async (opts) => {
  if (Meteor.user()) {
    const p = new SVGPathData(opts.path).scale(opts.width, opts.height).encode()
    return p
  }
  return null
}

method[CONSTANTS.methods.slates.translate] = async (opts) => {
  if (Meteor.user()) {
    const p = new SVGPathData(opts.path).translate(opts.x, opts.y).encode()
    return p
  }
  return null
}

method[CONSTANTS.methods.slates.remove] = async (opts) => {
  if (Meteor.user()) {
    const queryable = slateFilter({ type: 'mine' })
    queryable.push({ _id: opts.slateId })
    const slate = Slates.findOne(
      { $and: queryable },
      { fields: { _id: 1, options: 1 } }
    )
    if (slate) {
      let eligible = true
      // second check theme usage
      if (slate.options.eligibleForThemeCompilation) {
        const otherSlates = Slates.find({
          'options.basedOnThemeId': slate.options.id,
        }).count()
        eligible = otherSlates === 0
      }
      if (eligible) {
        SlateAccess.remove({ slateId: slate._id })
        Messages.remove({ slateId: slate._id })
        Comments.remove({ slateId: slate._id })
        Slates.remove({ _id: slate._id })
        Themes.remove({ _id: slate._id })
      } else {
        throw new Meteor.Error(
          `Slate is a theme in use by others - it cannot be deleted`
        )
      }
    } else {
      throw new Meteor.Error(`Slate is not deletable`)
    }
  }
}

method[CONSTANTS.methods.slates.update] = async (opts) => {
  const oopts = opts
  const lastSaved = new Date().valueOf()
  let accessibleGuest = false
  if (oopts.guestCollaboratorId) {
    const guestView = GuestViews.findOne({
      guestCollaboratorId: oopts.guestCollaboratorId,
    })
    accessibleGuest =
      guestView &&
      new Date().valueOf() < guestView.timestamp + 1000 * 60 * 60 * 24
  }

  if (Meteor.userId() || accessibleGuest) {
    if (!oopts.slate.created) {
      oopts.slate.created = new Date().valueOf()
    }

    oopts.slate.lastSaved = new Date().valueOf()

    // auto approve templates and themes for master user
    if (Meteor.user().isMasterUser) {
      if (oopts.slate.options.isTemplate) {
        oopts.slate.options.templateApproved = true
        oopts.slate.options.userNameOverride = 'Slatebox'
      }
      // console.log("will save theme2", oopts.slate.options.eligibleForThemeCompilation, oopts.slate.options.id);
      // if (opts.slate.options.eligibleForThemeCompilation) {
      //   Themes.update({ _id: opts.slate.options.id }, { $set: { options: { themeApproved: true } } });
      // }
    }

    Slates.upsert({ _id: opts.slate.options.id }, { $set: opts.slate })
  }
  return lastSaved
}

method[CONSTANTS.methods.slates.getNonPublic] = async () => {
  if (Meteor.userId()) {
    const queryable = [
      { $or: [{ 'options.isPrivate': true }, { 'options.isUnlisted': true }] },
    ]
    if (Meteor.user().orgId) {
      queryable.push({ orgId: Meteor.user().orgId })
    } else {
      queryable.push({ userId: Meteor.userId() })
    }
    const nonPublicFilter = { $and: queryable }
    const nonPublics = Slates.find(nonPublicFilter)
      .fetch()
      .map((s) => ({ name: s.options.name, id: s.options.id }))
    return nonPublics
  }
  return null
}

method[CONSTANTS.methods.slates.archive] = async (opts) => {
  const allSlates = Slates.find({ userId: { $in: opts.userId } }).fetch()
  allSlates.forEach((s) => {
    const ss = s
    const owner = Meteor.users.findOne({ _id: s.userId })
    ss.slateOwnerDetails = { profile: owner.profile, emails: owner.emails }
    ss.archivedDate = new Date().valueOf()
    ss.archivedBy = Meteor.userId()
    ArchivedSlates.insert(ss)
  })
  Slates.remove({ _id: { $in: allSlates.map((s) => s._id) } })
  return true
}

method['slates.echo'] = async (msg) => ({ echo: msg })

method[CONSTANTS.methods.slates.get] = async (opts) => {
  // console.log("getitng slates ", opts);

  if (opts.shareId) {
    // first get the slate
    let slate = Slates.findOne({ shareId: opts.shareId })
    if (!slate) {
      const getSlate = SlateAccess.findOne({ accessKey: opts.shareId })
      if (getSlate) {
        slate = Slates.findOne({ _id: getSlate?.slateId })
        // final check: slate public/private/unlisted options must match the accessKey
        if (
          (getSlate.type === 'unlisted' && !slate.options.isUnlisted) ||
          (getSlate.type === 'private' && !slate.options.isPrivate) ||
          (getSlate.type === 'public' && !slate.options.isPublic)
        ) {
          slate = null
        }
      }
    }

    if (slate && slate.userId === Meteor.userId()) {
      return {
        accessLevel: CONSTANTS.slateAccessPermissions.edit.id,
        slateBase: slate,
      }
    }

    // for non owners, continue...
    if (slate) {
      let type = 'public'
      if (slate.options.isUnlisted) {
        type = 'unlisted'
      } else if (slate.options.isPrivate) {
        type = 'private'
      }
      if (!Meteor.user() && type === 'public') {
        return {
          accessLevel: CONSTANTS.slateAccessPermissions.read.id,
          slateBase: slate,
        }
      }
      const access = SlateAccess.find({
        slateId: slate._id,
        type,
        slateAccessPermissionId: {
          $ne: CONSTANTS.slateAccessPermissions.none.id,
        },
      }).fetch()
      // console.log("got slate access ", access);
      if (access.length > 0) {
        if (
          (slate.options.isUnlisted || slate.options.isPublic) &&
          access.length === 1
        ) {
          return {
            accessLevel: access[0].slateAccessPermissionId,
            slateBase: slate,
          }
        }
        if (slate.options.isPrivate && Meteor.userId()) {
          const userAccess = access.find((a) => a.userId === Meteor.userId())
          if (userAccess) {
            return {
              accessLevel: userAccess.slateAccessPermissionId,
              slateBase: slate,
            }
          }
          // no access
          return null
        }
        // no access
        return null
      }
    } else if (Meteor.user()) {
      // new slate
      return { exists: false }
    } else {
      // no access
      return null
    }
  } else if (Meteor.userId()) {
    const sFilter = slateFilter({
      type: opts.type,
      filterString: opts.filterString,
      private: opts.private,
      useFullText: true,
    })
    const queryable = sFilter
    // const start = new Date().valueOf()
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
  if (Meteor.userId()) {
    const { baseUrl } = Meteor.settings.public
    const url = `${baseUrl}/canvas/${opts.slateId}/all/true`

    const multiplier =
      opts.size / Math.max(opts.orient.width, opts.orient.height)
    const width = parseInt(opts.orient.width * multiplier, 10)
    const height = parseInt(opts.orient.height * multiplier, 10)

    const base = {
      non: "<div id='sb_embed_{{id}}'><div id='slate_{{id}}' style='width:{{width}}px;height:{{height}}px;'></div><script>(function(w) { var a = 0, _deps = [{t: 'Slatebox', u: '//static.slatebox.com/2.0.0/slatebox.min'}], ck = function() { if (a === 1) { window.onload = function(e) { var ll = document.createElement('link'); ll.rel='stylesheet'; ll.type='text/css'; ll.href='//static.slatebox.com/2.0.0/slatebox.min.css'; document.head.appendChild(ll); var _slate = new Slatebox().slate({ container: 'slate_{{id}}', viewPort:{allowDrag:false},showBirdsEye:false,showZoom:false,showMultiSelect:false,showUndoRedo:false,showAddNodes:false,isEmbedding:true,showLocks:false,isSharing:{{share}}}); _slate.init(); Slatebox.getJSON('{{slateboxUrl}}/api/slates/?id={{id}}&callback=?', function(_json) { _slate.loadJSON(JSON.stringify(_json[0])); _slate.controller.scaleToFitAndCenter(); _slate.disable(); }); } } }; for(dx in _deps) { d = _deps[dx]; if (!w[d.t]) { var sc = document.createElement('script'); sc.src = d.u; sc.async = true; sc.onload = sc.onreadystatechange = function () { var state = sc.readyState; if (!state || /loaded|complete/.test(state)) { a++; ck(); } }; document.head.appendChild(sc); } else { a++; ck(); } }; })(window);</script></div>",
      iframe: `<iframe id='sb_embed_{{id}}' src='${url}' width='100%' height='100%' frameborder='0' scrolling='no' style="overflow:hidden;overflow-x:hidden;overflow-y:hidden;height:100%;width:100%;position:absolute;top:0px;left:0px;right:0px;bottom:0px"></iframe>`,
    }

    const _templates = {
      non_share: base.non
        .replace(/{{id}}/gi, opts.slateId)
        .replace(/{{slateboxUrl}}/gi, baseUrl)
        .replace(/{{width}}/gi, width)
        .replace(/{{height}}/gi, height)
        .replace(/{{size}}/gi, opts.size)
        .replace(/{{share}}/gi, 'true'),
      non_noshare: base.non
        .replace(/{{id}}/gi, opts.slateId)
        .replace(/{{slateboxUrl}}/gi, baseUrl)
        .replace(/{{width}}/gi, width)
        .replace(/{{height}}/gi, height)
        .replace(/{{size}}/gi, opts.size)
        .replace(/{{share}}/gi, 'false'),
      iframe_share: base.iframe
        .replace(/{{id}}/gi, opts.slateId)
        .replace(/{{width}}/gi, width)
        .replace(/{{height}}/gi, height)
        .replace(/{{size}}/gi, opts.size)
        .replace(/{{share}}/gi, 'true'),
      iframe_noshare: base.iframe
        .replace(/{{id}}/gi, opts.slateId)
        .replace(/{{width}}/gi, width)
        .replace(/{{height}}/gi, height)
        .replace(/{{size}}/gi, opts.size)
        .replace(/{{share}}/gi, 'false'),
    }

    return _templates
  }

  return null
}

function attempt() {
  const shareId = Random.hexString(8)
  const exists = Slates.findOne({ shareId })
  if (exists) {
    return attempt()
  }
  return shareId
}

method[CONSTANTS.methods.slates.generateShareId] = async () => {
  if (Meteor.user()) {
    return attempt()
  }
  return null
}

method[CONSTANTS.methods.slates.cacheImage] = async (opts) => {
  if (Meteor.user()) {
    const exists = CachedImages.findOne({ url: opts.url })
    const needsBytes = !exists || (exists && !exists.bytes)
    if (needsBytes) {
      // let base64 = Meteor.call(CONSTANTS.methods.utils.base64StringFromRemoteUrl, { type: imageType, url: opts.url });
      CachedImages.upsert(
        {
          url: opts.url,
        },
        {
          $set: {
            bytes: Buffer.from(await imageToBase64(opts.url), 'base64'),
          },
        }
      )
    }
    const cacheUrl = `${
      Meteor.settings.public.baseUrl
    }/sbimages/${encodeURIComponent(opts.url)}`
    return cacheUrl
  }
  return null
}

method[CONSTANTS.methods.slates.searchBackgroundImages] = async (opts) => {
  if (Meteor.user()) {
    const getCache = CachedImageTiming.findOne({
      provider: opts.provider,
      filter: opts.filter,
    })
    if (!getCache) {
      CachedImageTiming.insert({
        provider: opts.provider,
        filter: opts.filter,
        lastSearched: new Date().valueOf(),
      })
    }
    const lastTime = getCache?.lastSearched || -1
    let res = []
    if (new Date().valueOf() > lastTime + 1000 * 60 * 60 * 24) {
      CachedImageTiming.upsert(
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
          const url = `https://pixabay.com/api?key=${Meteor.settings.public.pixabayAPIKey}&category=backgrounds&safesearch=true&q=${opts.filter}&per_page=50`
          const response = await fetch(url)
          const data = await response.json()
          data.hits.forEach((d) => {
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
            CachedImages.insert(r)
            res.push(r)
          })
          break
        }
        default:
          break
      }
    } else {
      // retrieve and translate the image url
      res = CachedImages.find(
        { provider: opts.provider, filter: opts.filter },
        { fields: { bytes: 0 } }
      ).fetch()
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
  if (
    Meteor.user() &&
    Slates.findOne(opts.slateId).userId === Meteor.userId()
  ) {
    const last = SlateSnapshots.findOne(
      { slateId: opts.slateId },
      { sort: { created: -1 } }
    )
    const ps = stringSimilarity.compareTwoStrings(
      opts.snapshot,
      last ? last.snapshot : ''
    )
    // console.log('percentSimilar', ps)
    // 0.9985405384644929
    const isFree =
      Meteor.user().planType === 'free' ||
      (Meteor.user().orgId &&
        Organizations.findOne(Meteor.user().orgId).planType === 'free')
    const threshold = isFree ? 0.75 : 0.95
    if (ps < threshold) {
      // snapshot every 5% change if paid or 20% change if free
      SlateSnapshots.insert({
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
  if (Meteor.user()) {
    const q = { slateId: opts.slateId, userId: Meteor.userId() }
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
