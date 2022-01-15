import { Meteor } from 'meteor/meteor';
import AuthManager from '../imports/api/common/AuthManager';
import { CONSTANTS } from '../imports/api/common/constants';
import { GuestViews } from '../imports/api/common/models';
import {    
   Organizations
  , Collaboration
  , Slates
  , Collaborators
  , Claims
  , Messages
  , SlateAccess
  , Comments
  , Audit
  , ApprovalRequests } from '/imports/api/common/models.js';

function hasPermission(userId, doc, isSlate) {
  let allow = false;
  if (!userId) {
    if (doc.instanceId) {
      let hasGuestView = GuestViews.findOne({ guestCollaboratorId: doc.instanceId });
      console.log("found guest view?", doc.instanceId, hasGuestView);
      allow = hasGuestView ? new Date().valueOf() < hasGuestView.timestamp + (1000 * 60 * 60 * 24) : false;
    }
    // null {
    //   I20210710-13:09:44.287(-5)?   _id: 'nCW6mBGs3tkhHWrNm',
    //   I20210710-13:09:44.287(-5)?   shareId: 'be2e9151',
    //   I20210710-13:09:44.287(-5)?   userId: 'KpqYorJLm4FFGbJgA',
    //   I20210710-13:09:44.288(-5)?   heartbeat: false,
    //   I20210710-13:09:44.288(-5)?   instanceId: 'nCW6mBGs3tkhHWrNm',
    //   I20210710-13:09:44.288(-5)?   isAnonymous: true,
    //   I20210710-13:09:44.288(-5)?   userName: 'Friend'
    //   I20210710-13:09:44.288(-5)? } [ 'heartbeat' ] { '$set': { heartbeat: true } }
  } else {
    allow = doc.userId === userId;
    if (!allow) {
      allow = isSlate ? doc.options.collaboration.allow : false;
    }
  }
  return allow
}

function hasOrgPermission(userId, addlClaims = []) {
	return AuthManager.userHasClaim(userId, [CONSTANTS.claims.admin.id, ...addlClaims]);
}

function _isMasterUser() {
	return Meteor.user() && Meteor.user().isMasterUser;
}

Meteor.users.allow({
	insert: function(userId, doc) {
		return hasOrgPermission(userId, [CONSTANTS.claims.canAddUsers.id]);
	}
	, update: function(userId, doc, fieldNames, modifier) {
    const _perm = hasOrgPermission(userId, [CONSTANTS.claims.canEditUsers.id]) || Meteor.userId() === userId;
		return _perm;
	}
	, remove: function(userId, doc) {
		return hasOrgPermission(userId, [CONSTANTS.claims.canRemoveUsers.id]) || Meteor.userId() === userId;
	}
});

Audit.allow({
  insert: function(userId, doc) {
    return hasOrgPermission(userId);
  }
  , update: function(userId, doc, fieldNames, modifier) {
    return hasOrgPermission(userId) || Meteor.userId() === userId;
  }
  , remove: function(userId, doc) {
    return hasOrgPermission(userId) || Meteor.userId() === userId;
  }
});

Messages.allow({
  insert: function(userId, doc) {
    console.log("inserted message", userId, doc, hasOrgPermission(userId), Meteor.userId());
    return hasOrgPermission(userId) || Meteor.userId() === userId;
  }
  , update: function(userId, doc, fieldNames, modifier) {
    console.log("updating message", userId, doc, hasOrgPermission(userId), Meteor.userId());
    return hasOrgPermission(userId) || Meteor.userId() === userId;
  }
  , remove: function(userId, doc) {
    return hasOrgPermission(userId) || Meteor.userId() === userId;
  }
});

Comments.allow({
  insert: function(userId, doc) {
    return hasOrgPermission(userId) || Meteor.userId() === userId;
  }
  , update: function(userId, doc, fieldNames, modifier) {
    return hasOrgPermission(userId) || Meteor.userId() === userId;
  }
  , remove: function(userId, doc) {
    return hasOrgPermission(userId) || Meteor.userId() === userId;
  }
});

Collaboration.allow({
	insert: function(userId, doc) {
    console.log("checking on collaboration permission ", userId, doc);
		return hasPermission(userId, doc);
	}
	, update: function(userId, doc, fieldNames, modifier) {
    console.log("checking on collaboration permission ", userId, doc, fieldNames, modifier);
		return hasPermission(userId, doc);
	}
	, remove: function(userId, doc) {
		return hasPermission(userId, doc);
	}
});

Slates.allow({
	insert: function(userId, doc) {
		return hasPermission(userId, doc, true);
	}
	, update: function(userId, doc, fieldNames, modifier) {
		var p = hasPermission(userId, doc, true);
		return p;
	}
	, remove: function(userId, doc) {
		return hasPermission(userId, doc, true);
	}
});

SlateAccess.allow({
  insert: function(userId, doc) {
    return Slates.findOne({ _id: doc.slateId, userId: userId });
  }
  , update: function(userId, doc, fieldNames, modifier) {
    return Slates.findOne({ _id: doc.slateId, userId: userId });
  }
  , remove: function(userId, doc) {
    return Slates.findOne({ _id: doc.slateId, userId: userId });
  }
});

Collaborators.allow({
	insert: function(userId, doc) {
		return hasPermission(userId, doc);
	}
	, update: function(userId, doc, fieldNames, modifier) {
    console.log("checking on collaborator permission ", userId, doc, fieldNames, modifier);
		return hasPermission(userId, doc);
	}
	, remove: function(userId, doc) {
		return hasPermission(userId, doc);
	}
});

Claims.allow({
	insert: function(userId, doc) {
		return _isMasterUser();
	}
	, update: function(userId, doc, fieldNames, modifier) {
		return _isMasterUser();
	}
	, remove: function(userId, doc) {
		return _isMasterUser();
	}
});

Organizations.allow({
  insert: function(userId, doc) {
    return hasOrgPermission(userId);
  }
  , update: function(userId, doc, fieldNames, modifier) {
    return hasOrgPermission(userId);
  }
  , remove: function(userId, doc) {
    return hasOrgPermission(userId);
  }
});

ApprovalRequests.allow({
  insert: function(userId, doc) {
    return hasPermission(userId, doc);
  }
  , update: function(userId, doc, fieldNames, modifier) {
    return _isMasterUser();
  }
  , remove: function(userId, doc) {
    return hasPermission(userId, doc);
  }
})