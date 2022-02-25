import { Meteor } from 'meteor/meteor';
import slateFilter from '/imports/api/common/slateFilter.js';
import { CONSTANTS } from '/imports/api/common/constants.js';
import { PricingTiers, Messages, Slates, Collaboration, Organizations, Claims, Permissions, SlateAccess, Collaborators, Comments } from '/imports/api/common/models.js';
import AuthManager from '../imports/api/common/AuthManager';
import { ApprovalRequests } from '../imports/api/common/models';

function _orgId(context) {
	var _org = Meteor.SB.getOrg(context);
	if (_org) {
		var _user = Meteor.users.findOne({_id: context.userId });
		return _user && _user.orgId === _org._id ? _org._id : false;
	}
	return false;
};

Meteor.publish(CONSTANTS.publications.slateAccess, function() {
  if (this.userId) {
    return SlateAccess.find({ $or: [{userId: this.userId}, { owningUserId: this.userId }] });
  } else {
    this.ready();
  }
});

Meteor.publish(CONSTANTS.publications.users.me, function publishMe() {
  return Meteor.users.find({ _id: this.userId }, { fields: { isAnonymous: 1, orgId: 1, isOrgOwner: 1, createdAt: 1, planType: 1, roles: 1 } });
});

// Meteor.publish(CONSTANTS.publications.mySlates, function(filter) {
//     var self = this;
//     if (Meteor.user()) {
//       let baseFilter = slateFilter(this.userId, false, filter?.filter);
//       console.log("searching slates ", JSON.stringify(baseFilter), filter?.skip, filter?.limit);

//       return Slates.find({ $and: baseFilter }, { 
//         skip: filter && filter.skip ? filter.skip : 0, 
//         limit: filter && filter.limit ? filter.limit : 3, 
//         sort: { lastModified: -1 } 
//       });
//     }
// });

Meteor.publish(CONSTANTS.publications.shareableSlate, function(slateId) {
  var self = this;
  if (Meteor.user()) {
    return Slates.find({ _id: slateId, userId: Meteor.userId() });
  }
});

// Meteor.publish(CONSTANTS.publications.communitySlates, function(filter) {
// 	const queryable = slateFilter(this.userId, true, filter.filter);
// 	console.log("getting public slate query ", JSON.stringify(queryable));

// 	//return new ChangeStreams(Slates, [{ $match: { $and: queryable } }], { limit: filter && filter.limit ? filter.limit : 3, sort: { created: -1 } });
// 	return Slates.find({ $and: queryable }, { limit: filter && filter.limit ? filter.limit : 3, sort: { created: -1 } });
// });

Meteor.publish(CONSTANTS.publications.messages, function() {
  if (this.userId) {
    return Messages.find({ userId: this.userId }, { sort: { timestamp: -1 } });
  }
});

Meteor.publish(CONSTANTS.publications.comments, function(filter) {
  //can be anonymously subscribed to
  if (filter.slateId) {
    let query = { slateId: filter.slateId };
    if (filter.nodeId) {
      query.nodeId = filter.nodeId;
    }
    //todo: additional slateaccess filter check for this slateId?
    console.log("sending down comments", filter, Comments.find({ slateId: filter.slateId, nodeId: filter.nodeId }, { sort: { timestamp: -1 } }).fetch());
    return Comments.find(query, { sort: { timestamp: -1 } });
  }
});

Meteor.publish(CONSTANTS.publications.collaboration, function(_slateIds, _slateInstanceIds, asOfDate) {
	//the date in the table is GREATER THAN or equal to the last saved date

	// console.log("getting collaboration", JSON.stringify({ $and: [ 
	// 		{ slateId: { $in: _slateIds } }
	// 		, { dated: { $gt: asOfDate } }
	// 		, { instanceId: { $nin: _slateInstanceIds } }
	// 	]
  // }));

	return Collaboration.find({ $and: [ 
			{ slateId: { $in: _slateIds } }
			, { dated: { $gt: asOfDate } }
			, { instanceId: { $nin: _slateInstanceIds } }
		]
	});

});

Meteor.publish(CONSTANTS.publications.collaborators, function(shareIds) {
	return Collaborators.find({ shareId: { $in: shareIds } });
});


Meteor.publish(CONSTANTS.publications.organizations, function() {
  let user = Meteor.users.findOne({ _id: this.userId });
  if (user && user.orgId) {
    return Organizations.find({ _id: user.orgId });
  }
});

Meteor.publish(CONSTANTS.publications.orgUsers, function() {
  const user = Meteor.users.findOne({ _id: this.userId });
  console.log("getting org users", user, AuthManager.userHasClaim(user?._id, [CONSTANTS.claims.canViewUsers._id]));
	if (user?.orgId && AuthManager.userHasClaim(user._id, [CONSTANTS.claims.canViewUsers._id])) {
		return Meteor.users.find({ orgId: user.orgId }, { fields: { profile: 1, isAnonymous: 1, createdAt: 1, emails: 1, orgId: 1, isOrgOwner: 1 } });
	} else {
		this.ready();
	}
});

//slimmed down pub just for guest users
Meteor.publish(CONSTANTS.publications.orgUsersForGuest, function(opts) {
  //todo use slateAccess to ensure opts.slateId is unlisted or public
  const slate = Slates.findOne({ _id: opts.slateId });
  console.log("found slate ", slate, opts.slateId);
	if (slate && (slate.options.isUnlisted || slate.options.isPublic) && opts.orgId) {
		return Meteor.users.find({ orgId: opts.orgId }, { fields: { profile: 1, isAnonymous: 1, emails: 1 } });
	} else {
		this.ready();
	}
});

Meteor.publish(CONSTANTS.publications.orgSlates, function() {
  const user = Meteor.users.findOne({ _id: this.userId });
  console.log("getting org slates", user.orgId, AuthManager.userHasClaim(user._id, [CONSTANTS.claims.canViewSlates._id]));
	if (user?.orgId && AuthManager.userHasClaim(user._id, [CONSTANTS.claims.canViewSlates._id])) {
		return Slates.find({ "orgId": user.orgId }, { sort: { lastSaved: -1 } });
	} else {
		this.ready();
	}
});

Meteor.publish(CONSTANTS.publications.claims, function() {
  if (Meteor.user()) {
    return Claims.find({}, { disableOplog: true });
  } else {
    this.ready();
  }
});

Meteor.publish(CONSTANTS.publications.pricingTiers, function() {
	if (Meteor.user()) {
		return PricingTiers.find({}, { disableOplog: true });
	} else {
		this.ready();
	}
});

Meteor.publish(CONSTANTS.publications.permissions, function() {
  const user = Meteor.users.findOne({ _id: this.userId });
	if (user?.orgId) {
		return Permissions.find({ orgId: user.orgId }, { disableOplog: true });
	} else {
		this.ready();
	}
});

Meteor.publish(CONSTANTS.publications.approvalRequests, function(type, slateId) {
  if (this.userId) {
    return ApprovalRequests.find({ type: type, slateId: slateId });
  } else {
    this.ready();
  }
})

// Meteor.publish("publicSlates", function(filter) {

// 	const queryable = slateFilter(this.userId, true);
// 	if (filter && filter.keyword) {
// 		const re = { $regex: filter.keyword, $options: "gi" };
// 		queryable.push({ $or: [ {"options.name": re }, { "options.description": re } ] });
// 	}
// 	console.log("getting public slate query ", JSON.stringify(queryable));

// 	//return new ChangeStreams(Slates, [{ $match: { $and: queryable } }], { limit: filter && filter.limit ? filter.limit : 3, sort: { created: -1 } });
// 	return Slates.find({ $and: queryable }, { limit: filter && filter.limit ? filter.limit : 3, sort: { created: -1 } });
// });