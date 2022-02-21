// methods.js
import { CONSTANTS } from '../../imports/api/common/constants.js';
import { Organizations, Slates, SlateAccess, ArchivedSlates, Comments, Messages, GuestViews, Themes, CachedImages, CachedImageTiming, SlateSnapshots } from '../../imports/api/common/models.js';
import { Random } from 'meteor/random';
import { Meteor } from 'meteor/meteor';
import { SVGPathData } from 'svg-pathdata';
import fetch from 'node-fetch';
import rawMongoSearch from '../common/rawMongoSearch.js';
import slateFilter from "../../imports/api/common/slateFilter";
import imageToBase64 from 'image-to-base64';
import stringSimilarity from 'string-similarity';
import { Buffer } from 'buffer';

let method = {};

method[CONSTANTS.methods.slates.scaleAndTranslate] = async function (opts) {
  if (Meteor.user()) {
    let p = new SVGPathData(opts.path).scale(opts.width, opts.height).translate(opts.x, opts.y).encode();
    return p;
  }
}

method[CONSTANTS.methods.slates.scale] = async function (opts) {
  if (Meteor.user()) {
    let p = new SVGPathData(opts.path).scale(opts.width, opts.height).encode();
    return p;
  }
}

method[CONSTANTS.methods.slates.translate] = async function (opts) {
  if (Meteor.user()) {
    let p = new SVGPathData(opts.path).translate(opts.x, opts.y).encode();
    return p;
  }
}

method[CONSTANTS.methods.slates.remove] = async function (opts) {
  if (Meteor.user()) {
    const queryable = slateFilter({ type: "mine" });
    queryable.push({ _id: opts.slateId });
    console.log("ensuring slate can be removed ", queryable);
    let slate = Slates.findOne({ $and: queryable }, { fields: { _id: 1, "options": 1 } });
    if (slate) {
      let eligible = true;
      // second check theme usage
      console.log("checking options", slate.options);
      if (slate.options.eligibleForThemeCompilation) {
        const otherSlates = Slates.find({ "options.basedOnThemeId": slate.options.id }).count();
        console.log("found", slate.options.id, otherSlates);
        eligible = otherSlates === 0;
      }
      if (eligible) {
        SlateAccess.remove({ slateId: slate._id });
        Messages.remove({ slateId: slate._id });
        Comments.remove({ slateId: slate._id });
        Slates.remove({ _id: slate._id });
        Themes.remove({ _id: slate._id });
      } else {
        throw new Meteor.Error(`Slate is a theme in use by others - it cannot be deleted`);
      }
    } else {
      throw new Meteor.Error(`Slate is not deletable`);
    }
  }
}

method[CONSTANTS.methods.slates.update] = async function(opts) {
  const lastSaved = new Date().valueOf();
  let accessibleGuest = false;
  console.log("checking collaboratorId ", opts.guestCollaboratorId);
  if (opts.guestCollaboratorId) {
    let guestView = GuestViews.findOne({ guestCollaboratorId: opts.guestCollaboratorId });
    console.log("checking guestView ", guestView, new Date().valueOf() < guestView.timestamp + (1000 * 60 * 60 * 24));
    accessibleGuest = guestView && new Date().valueOf() < guestView.timestamp + (1000 * 60 * 60 * 24);
  }

  if (Meteor.userId() || accessibleGuest) {
    if (!opts.slate.created) {
      opts.slate.created = new Date().valueOf();
    }

    opts.slate.lastSaved = new Date().valueOf();

    //auto approve templates and themes for master user
    console.log("will save theme", Meteor.user().isMasterUser);
    if (Meteor.user().isMasterUser) {
      if (opts.slate.options.isTemplate) {
        opts.slate.options.templateApproved = true;
        opts.slate.options.userNameOverride = "Slatebox";
      }
      // console.log("will save theme2", opts.slate.options.eligibleForThemeCompilation, opts.slate.options.id);
      // if (opts.slate.options.eligibleForThemeCompilation) {
      //   Themes.update({ _id: opts.slate.options.id }, { $set: { options: { themeApproved: true } } });
      // }
    }

    console.log("saving slate ", opts.slate.options.id, opts.slate);
    Slates.upsert({ _id: opts.slate.options.id }, { $set: opts.slate });
  }
  return lastSaved;
};

method[CONSTANTS.methods.slates.getNonPublic] = async function() {
  if (Meteor.userId()) {
    let queryable = [{ $or: [{ "options.isPrivate": true }, { "options.isUnlisted": true }] }];
    if (Meteor.user().orgId) {
      queryable.push({ orgId: Meteor.user().orgId });
    } else {
      queryable.push({ userId: Meteor.userId() });
    }
    const nonPublicFilter = { $and: queryable };
    console.log("nonPublicFilter", nonPublicFilter);
    const nonPublics = Slates.find(nonPublicFilter).fetch().map(s => { return { name: s.options.name, id: s.options.id }; });
    console.log("nonPublics are", nonPublics);
    return nonPublics;
  }
  return null;
};

method[CONSTANTS.methods.slates.archive] = async function(opts) {
  const allSlates = Slates.find({ userId: { $in: opts.userId } }).fetch();
  allSlates.forEach(s => {
    let owner = Meteor.users.findOne({ _id: s.userId });
    s.slateOwnerDetails = { profile: owner.profile, emails: owner.emails };
    s.archivedDate = new Date().valueOf();
    s.archivedBy = Meteor.userId();
    ArchivedSlates.insert(s);
  });
  Slates.remove({ _id: { $in: allSlates.map(s => s._id) }});
  return true;
}

method["slates.echo"] = async function(msg) {
  console.log("echoed", msg);
  return { echo: msg };
};

method[CONSTANTS.methods.slates.get] = async function(opts) {

  //console.log("getitng slates ", opts);

  if (opts.shareId) {
    //first get the slate
    let slate = Slates.findOne({ shareId: opts.shareId });
    if (!slate) {
      let getSlate = SlateAccess.findOne({ accessKey: opts.shareId });
      if (getSlate) {
        slate = Slates.findOne({ _id: getSlate?.slateId });
        //final check: slate public/private/unlisted options must match the accessKey
        if ((getSlate.type === "unlisted" && !slate.options.isUnlisted) || (getSlate.type === "private" && !slate.options.isPrivate) || (getSlate.type === "public" && !slate.options.isPublic)) {
          slate = null;
        }
      }
    }

    //console.log("got slate", opts.shareId, slate);

    if (slate && slate.userId === Meteor.userId()) {
      return { accessLevel: CONSTANTS.slateAccessPermissions.edit.id, slateBase: slate };
    }

    //for non owners, continue...
    if (slate) {
      let type = "public";
      if (slate.options.isUnlisted) {
        type = "unlisted";
      } else if (slate.options.isPrivate) {
        type = "private";
      }
      if (!Meteor.user() && type === "public") {
        return { accessLevel: CONSTANTS.slateAccessPermissions.read.id, slateBase: slate };
      } else {
        let access =  SlateAccess.find({ slateId: slate._id, type: type, slateAccessPermissionId: { $ne: CONSTANTS.slateAccessPermissions.none.id } }).fetch();
        //console.log("got slate access ", access);
        if (access.length > 0) {
          if ((slate.options.isUnlisted || slate.options.isPublic) && access.length === 1) {
            return { accessLevel: access[0].slateAccessPermissionId, slateBase: slate };
          } else if (slate.options.isPrivate && Meteor.userId()) {
            let userAccess = access.find(a => a.userId === Meteor.userId());
            if (userAccess) {
              return { accessLevel: userAccess.slateAccessPermissionId, slateBase: slate };
            } else {
              //no access
              return null;
            }
          } else {
            //no access
            return null;
          }
        }
      }
    } else if (Meteor.user()) {
      //new slate
      return { exists: false };
    } else {
      //no access
      return null;
    }
  } else if (Meteor.userId()) {
    let sFilter = slateFilter({ type: opts.type, filterString: opts.filterString, private: opts.private, useFullText: true });
    const queryable = sFilter;
    let start = new Date().valueOf();
    console.log("getting slates ", JSON.stringify(queryable, null, 2), opts);
    const cnt = await rawMongoSearch(Slates, { $and: queryable }, "count");
    const slates = await rawMongoSearch(Slates, { $and: queryable }, "toArray", "lastSaved", opts.skip, opts.limit);
    console.log("duration to get both", (new Date().valueOf() - start)/1000);
    return { slates, counts: { total: cnt } };
  } else {
    return null;
  }
};

method[CONSTANTS.methods.slates.getEmbedCode] = async function(opts) {
  if (Meteor.userId()) {

    let baseUrl = Meteor.settings.public.baseUrl;
    let orgName = Meteor.user().orgId ? Organizations.findOne(Meteor.user().orgId).name : "";
    let url = [baseUrl, orgName,  "/snap/{{id}}/{{size}}?share={{share}}"].join('');
    
    var multiplier = opts.size/Math.max(opts.orient.width, opts.orient.height);
    var width = parseInt(opts.orient.width * multiplier, 10);
    var height = parseInt(opts.orient.height * multiplier, 10);

    var base = {
      non: "<div id='sb_embed_{{id}}'><div id='slate_{{id}}' style='width:{{width}}px;height:{{height}}px;'></div><script>(function(w) { var a = 0, _deps = [{t: 'Slatebox', u: '//static.slatebox.com/2.0.0/slatebox.min.js'}], ck = function() { if (a === 1) { window.onload = function(e) { var ll = document.createElement('link'); ll.rel='stylesheet'; ll.type='text/css'; ll.href='//static.slatebox.com/2.0.0/slatebox.min.css'; document.head.appendChild(ll); var _slate = new Slatebox().slate({ container: 'slate_{{id}}', viewPort:{allowDrag:false},showBirdsEye:false,showZoom:false,showMultiSelect:false,showUndoRedo:false,showAddNodes:false,isEmbedding:true,showLocks:false,isSharing:{{share}}}); _slate.init(); Slatebox.getJSON('{{slateboxUrl}}/api/slates/?id={{id}}&callback=?', function(_json) { _slate.loadJSON(JSON.stringify(_json[0])); _slate.controller.scaleToFitAndCenter(); _slate.disable(); }); } } }; for(dx in _deps) { d = _deps[dx]; if (!w[d.t]) { var sc = document.createElement('script'); sc.src = d.u; sc.async = true; sc.onload = sc.onreadystatechange = function () { var state = sc.readyState; if (!state || /loaded|complete/.test(state)) { a++; ck(); } }; document.head.appendChild(sc); } else { a++; ck(); } }; })(window);</script></div>"
      , iframe: "<iframe id='sb_embed_{{id}}' src='" + url + "' width='{{width}}' height='{{height}}' frameborder='0' scrolling='no'></iframe>"
    }

    const _templates = {
      non_share: base.non.replace(/{{id}}/gi, opts.slateId).replace(/{{slateboxUrl}}/gi, baseUrl).replace(/{{width}}/gi, width).replace(/{{height}}/gi, height).replace(/{{size}}/gi, opts.size).replace(/{{share}}/gi, "true")
      , non_noshare: base.non.replace(/{{id}}/gi, opts.slateId).replace(/{{slateboxUrl}}/gi, baseUrl).replace(/{{width}}/gi, width).replace(/{{height}}/gi, height).replace(/{{size}}/gi, opts.size).replace(/{{share}}/gi, "false")
      , iframe_share: base.iframe.replace(/{{id}}/gi, opts.slateId).replace(/{{width}}/gi, width).replace(/{{height}}/gi, height).replace(/{{size}}/gi, opts.size).replace(/{{share}}/gi, "true")
      , iframe_noshare: base.iframe.replace(/{{id}}/gi, opts.slateId).replace(/{{width}}/gi, width).replace(/{{height}}/gi, height).replace(/{{size}}/gi, opts.size).replace(/{{share}}/gi, "false")
    };

    return _templates;
  }
}

function attempt() {
  let shareId = Random.hexString(8)
  const exists = Slates.findOne({ shareId: shareId });
  if (exists) {
    return attempt();
  } else {
    console.log("returning shareId", shareId);
    return shareId;
  }
}

method[CONSTANTS.methods.slates.generateShareId] = async function(opts) {
  console.log("genning shareId", opts);
  if (Meteor.user()) {
    return attempt();
  }
  return null;
};

method[CONSTANTS.methods.slates.cacheImage] = async function(opts) {
  if (Meteor.user()) {
    let exists = CachedImages.findOne({ url: opts.url });
    let needsBytes = !exists || (exists && !exists.bytes);
    console.log("caching image", opts, needsBytes);
    if (needsBytes) {
      // let base64 = Meteor.call(CONSTANTS.methods.utils.base64StringFromRemoteUrl, { type: imageType, url: opts.url });
      CachedImages.upsert({ 
        url: opts.url,
      }, { $set: {
        bytes: Buffer.from(await imageToBase64(opts.url), "base64")
      } });
    }
    const cacheUrl = `${Meteor.settings.public.baseUrl}/sbimages/${encodeURIComponent(opts.url)}`;
    console.log("cacheUrl ", cacheUrl);
    return cacheUrl;
  }
}

method[CONSTANTS.methods.slates.searchBackgroundImages] = async function(opts) {
  if (Meteor.user()) {
    let getCache = CachedImageTiming.findOne({ provider: opts.provider, filter: opts.filter });
    if (!getCache) {
      CachedImageTiming.insert({
        provider: opts.provider,
        filter: opts.filter,
        lastSearched: new Date().valueOf()
      });
    }
    let lastTime = getCache?.lastSearched || -1;
    let res = [];
    if (new Date().valueOf() > lastTime + (1000 * 60 * 60 * 24)) {
      CachedImageTiming.upsert({
        provider: opts.provider,
        filter: opts.filter
      }, { $set: {
        lastSearched: new Date().valueOf()
      }});
      switch (opts.provider) {
        case "pixabay": {
          const url = `https://pixabay.com/api?key=${Meteor.settings.public.pixabayAPIKey}&category=backgrounds&safesearch=true&q=${opts.filter}&per_page=50`;
          console.log("searching bg images", url);
          const response = await fetch(url);
          console.log("raw response", JSON.stringify(response, null, 2));
          const data = await response.json();
          for (let d of data.hits) {
            const r = {
              url: d.largeImageURL,
              previewUrl: d.previewURL,
              created: new Date().valueOf(),
              provider: opts.provider,
              filter: opts.filter,
              size: "cover",
              attribution: {
                title: d.tags,
                author: d.user,
                authorUrl: d.userImageURL
              }
            };
            CachedImages.insert(r);
            res.push(r);
          }
          break;
        }
      }
    }
    else {
      // retrieve and translate the image url
      console.log("find cached images", opts.provider, opts.filter);
      res = CachedImages.find({ provider: opts.provider, filter: opts.filter }, { fields: { bytes: 0 } }).fetch();
      // res.forEach(r => {
      //   r.sburl = `${CONSTANTS.sbImagePrefix}${encodeURIComponent(r.url)}`;
      // });
    }

    console.log("got results", res);
    
    return res;
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
  return null;
};

method[CONSTANTS.methods.slates.createSnapshot] = async function (opts) {
  if (Meteor.user()) {
    if (Slates.findOne(opts.slateId).userId === Meteor.userId()) {
      const last = SlateSnapshots.findOne({ slateId: opts.slateId }, { sort: { created: -1 } });
      const ps = stringSimilarity.compareTwoStrings(opts.snapshot, last ? last.snapshot : "");
      console.log("percentSimilar", ps);
      // 0.9985405384644929
      let threshold = .75;
      if (ps < threshold) { // snapshot every 25% change
        SlateSnapshots.insert({ slateId: opts.slateId, userId: Meteor.userId(), snapshot: opts.snapshot, created: new Date() });
      }
      return true;
    } else {
      return false;
    }
  }
};

method[CONSTANTS.methods.slates.getSnapshots] = async function(opts) {
  if (Meteor.user()) {
    const q = { slateId: opts.slateId, userId: Meteor.userId() };
    console.log("getting snaps", opts);
    const cnt = await rawMongoSearch(SlateSnapshots, q, "count");
    const all = await rawMongoSearch(SlateSnapshots, q, "toArray", "created", opts.skip, opts.limit);
    console.log("got snaps", cnt, all.length);
    return { count: cnt, snaps: all };
  }
  return [];
};



Meteor.methods(method);