// methods.js
import { CONSTANTS } from '../../imports/api/common/constants.js';
import { Organizations, Slates } from '../../imports/api/common/models.js';
import { Random } from 'meteor/random';
import { Meteor } from 'meteor/meteor';

let method = {};
method[CONSTANTS.methods.slates.update] = async function(opts) {
  if (Meteor.userId()) {
    var lastSaved = new Date().valueOf();

    //enforce all slates to be public if they are in free mode.
    if (Meteor.user().planType === "free" && !Meteor.user().orgId) {
      opts.slate.options.isPublic = true;
    }

    // if (!opts.slate._id) {
    //   opts.slate._id = opts.slate.options.id;
    // }

    if (!opts.slate.created) {
      opts.slate.created = new Date().valueOf();
    }

    opts.slate.lastModified = new Date().valueOf();

    console.log("saving slate ", opts.slate.options.id, opts.slate);
    Slates.upsert({ _id: opts.slate.options.id }, { $set: opts.slate });
    return lastSaved;
  }
};

method[CONSTANTS.methods.slates.get] = async function(shareId) {
  if (Meteor.userId()) {

    //TODO: add the permission logic to ensure user has access to the shareId
    return Slates.findOne({ shareId: shareId });
  }
};

method[CONSTANTS.methods.slates.getEmbedCode] = async function(opts) {
  if (Meteor.userId()) {

    let baseUrl = Meteor.settings.baseUrl;
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

Meteor.methods(method);