import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import { CONSTANTS } from '/imports/api/common/constants.js';
import { Slates } from '/imports/api/common/models.js';

Meteor.publish(CONSTANTS.publications.tags, function(opts) {
  const self = this;
  const user = this.userId ? Meteor.users.findOne({ _id: self.userId }) : null;
  console.log("getting tags on server ", self.userId, user);
  let watchTags = null;

  if (user) {

    const masterUser = Meteor.users.findOne({ isMasterUser: true });
    const orgId = Meteor.users.findOne(self.userId).orgId;
    const queryable = [];
    let tags = {};

    if (orgId) {
      queryable.push({ orgId: orgId });
      if (opts && opts.includeUser) {
        queryable.push({ $or: [{ "options.isCommunity": true }, { userId: this.userId } ] });
      } else {
        queryable.push({ "options.isCommunity": true });
      }
    } else {
      if (masterUser) {
        queryable.push({ userId: { $ne: _masterUserId } });
      }
      if (opts && opts.includeUser) {
        queryable.push({ $or: [{ "options.isPublic": true }, { userId: this.userId }] });
      } else {
        queryable.push({ "options.isPublic": true });
      }
    }

    let defer = null;
    function broadcast() {
      clearTimeout(defer);
      defer = setTimeout(function() {
        console.log("will broadcast all tags ", tags);
        Object.keys(tags).forEach(t => {
          console.log("sending down ", tags[t], t);
          self[tags[t]] && self[tags[t]]("tags", Random.id(), { tag: t });
        });
        self.ready();
      }, 100);
    };

    function parse(doc, method) {
      console.log("what is doc?", doc);
      `${doc.options.name} ${doc.options.description}`.split(' ').forEach(t => {
        if (t && t.trim() !== '') {
          if (!tags[t]) {
            tags[t] = "added";
          } else {
            tags[t] = method;
          }
        }
      });
    }

    console.log("watching tags ", queryable);

    // watchTags = Slates.find({ $and: queryable }, { field: { "options.name": 1, "options.description": 1 }, sort: { "options.name": 1, "options.description": 1 } }).observe({
    //   added: function(doc) {
    //     parse(doc, 'added');
    //     broadcast();
    //   }
    //   , changed: function(doc) {
    //     parse(doc, 'changed');
    //     broadcast();
    //   }
    //   , removed: function(doc) {
    //     parse(doc, 'removed');
    //     broadcast();
    //   }
    // });
  } else {
    self.ready()
  }

  self.onStop(function () {
    watchTags && watchTags.stop();
  });

});