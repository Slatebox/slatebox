import { Meteor } from 'meteor/meteor';
import { CONSTANTS } from '/imports/api/common/constants.js';
import { Slates, Collaboration } from '/imports/api/common/models.js';

Meteor.publish("featuredSlates", function(opts) {

	const self = this;
  let query = {};
  let user = Meteor.users.findOne({ isMasterUser: true });

  if (user) {
    user = user._id;
  }

  function isFeatured(doc) {
    if (opts && opts.custom) {
      return true;
    } else {
      const u = Meteor.users.findOne(doc.userId);
      if (_org && AuthManager.userHasClaim(doc.userId, [CONSTANTS.claims.admin._id]) || (!_org && u && u.isMasterUser && doc.options.isPublic)) {
        return true;
      } else {
        return false;
      }
    }
  };

  if (opts && opts.custom) {
    query[opts.custom] = true;
    Object.assign(query, { userId: user });
  } else {
    const _org = Meteor.SB.getOrg(self);
    query = { $or: [{ "options.isFeatured": true }] };
    if (user) {
      query["$or"].push({ userId: user });
    }
    if (_org) {
      Object.assign(query, { orgId: _org._id });
    }
  }

  console.log("featured slates query ", JSON.stringify(query));

  const watchSlates = Slates.find(query, { sort: { featureOrder: 1 } }).observe({
    added: function(doc) {
      const s = isFeatured(doc);
      if (s) {
        self.added("featuredSlates", doc._id, doc);
      }
    }
    , changed: function(doc) {
      const s = isFeatured(doc);
      if (s) {
        self.changed("featuredSlates", doc._id, doc);
      }
    }
    , removed: function(doc) {
      const s = isFeatured(doc);
      if (s) {
        self.removed("featuredSlates", doc._id, doc);
      }
    }
  });

  self.ready();

  self.onStop(function () {
    watchSlates.stop();
  });

});