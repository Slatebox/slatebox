// methods.js
import { Random } from 'meteor/random';
import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
import { CONSTANTS } from '../../imports/api/common/constants.js';
import { utils } from '../../imports/api/common/utils.js';
import AuthManager from '../../imports/api/common/AuthManager';

import { Permissions, Claims, Organizations, Slates, Messages, SlateAccess } from '../../imports/api/common/models.js'

let method = {};
method[CONSTANTS.methods.users.createAnonymous] = async function(opts) {
  //HTTP_FORWARDED_COUNT=1 should be set
  let ip = utils.ipFromConnection(this.connection);
  console.log("creating user ", ip, CONSTANTS.ipWhitelist); //76.17.204.120
  //if (CONSTANTS.ipWhitelist.includes(ip)) {
    const email = 'user@' + Random.id() + ".com";
    const base = { isAnonymous: true, password: CONSTANTS.anonUserPwd, email: email, profile: { name: '' } };
    if (opts && opts.orgId) {
      Object.assign(base, { orgId: opts.orgId });
    }
    const id = Accounts.createUser(base);

    return email;
  // }
  // console.log("returning null ", ip, CONSTANTS.ipWhitelist);
  // return null;
}

method[CONSTANTS.methods.users.impersonate] = async function(email) {
  if (AuthManager.userHasClaim(Meteor.userId(), [CONSTANTS.claims.uberMensch._id])) {
    const usr = Meteor.users.findOne({ "emails.0.address": email });
    if (usr) {
      this.setUserId(usr._id);
    } else {
      throw new Meteor.Error("impersonateUser.userDoesntExist", "Cannot impersonate user if not exist");
    }
  } else {
    throw new Meteor.Error("impersonateUser.noPermission", "You do not have permission");
  }
}

method[CONSTANTS.methods.users.getSlateAccessUrl] = async function(opts) {
  if (opts.slateId) {
    const root = `/canvas`;
    const slate = Slates.findOne({ _id: opts.slateId });
    let type = "public";
    if (slate.options.isPrivate) {
      type = "private";
    } else if (slate.options.isUnlisted) {
      type = "unlisted";
    }
    if (Meteor.userId() && Meteor.userId() === slate.userId) {
      return `${root}/${slate.shareId}/${opts.nodeId}`;
    } else {
      const slateAccess = SlateAccess.findOne({ slateId: opts.slateId, type: type });
      if (slateAccess) {
        return `${root}/${slateAccess.accessKey}/${opts.nodeId}`;
      } else {
        return null;
      }
    }
  }
};

method[CONSTANTS.methods.users.getUserName] = async function(opts) {
  //HTTP_FORWARDED_COUNT=1 should be set
  let user = Meteor.users.findOne({ _id: opts.userId });
  return user?.isAnonymous ? 'Guest' : `${user?.profile?.firstName} ${user?.profile?.lastName}`.replace(/undefined/gi, "") || user?.emails[0].address.split(' ')[0];
}

method[CONSTANTS.methods.users.identify] = async function(opts) {
  if (Meteor.user()) {
    const updateUser = { isAnonymous: false, profile: { firstName: Meteor.user().profile?.firstName || "", lastName: Meteor.user().profile?.lastName || "" } };
    if (opts.firstName) {
      updateUser.profile.firstName = opts.firstName;
    }
    if (opts.lastName) {
      updateUser.profile.lastName = opts.lastName;
    }
    if (opts.email) {
      updateUser["emails.0.address"] = opts.email;
    }
    console.log("updating user", updateUser);
    Meteor.users.update({ _id: Meteor.userId() }, { $set: updateUser });
    Accounts.sendVerificationEmail(Meteor.userId());
    return true;
  }
  return false;
}

method[CONSTANTS.methods.users.resetPassword] = async function(opts) {
  if (opts.email) {
    const user = Meteor.users.findOne({ "emails.0.address": opts.email });
    if (user) {
      Accounts.sendResetPasswordEmail(user._id, opts.email);
      return true;
    } else {
      return false;
    }
  }
  return false;
}

//only for uber admins
method[CONSTANTS.methods.users.search] = async function(opts) {
  if (AuthManager.userHasClaim(Meteor.userId(), [CONSTANTS.claims.uberMensch._id])) {
    const re = { $regex: opts.search, $options: "gi" };
    const all = Meteor.users.find({ $and: [{ $or: [ {"profile.firstName": re }, {"profile.lastName": re }, { "emails.0.address": re } ] }] }).fetch();
    return all.splice(0, 100);
  }
}

method[CONSTANTS.methods.users.get] = async function(opts) {
  //needs to be open for registration check of the same email
  if (opts.email || opts._id) {
    const find = {};
    if (opts.email) {
      find["emails.0.address"] = opts.email;
    }
    if (opts._id) {
      find._id = opts._id;
    }
    if (opts.count) {
      return  Meteor.users.find(find).count();
    } else {
      const users = Meteor.users.find(find).fetch();
      if (opts.includeSlateCounts) {
        const slates = Slates.find({ userId: { $in: users.map(u => u._id) } }, { fields: { userId: 1, _id: 1 } }).fetch();
        console.log("got slates for user ", users, slates);
        return users.map((u) => {
          return {
            user: u,
            slateCount: slates.filter(s => s.userId === u._id).length
          };
        });
      } else {
        return users;
      }
    }
  }
}


method[CONSTANTS.methods.users.getTokenByEmailForTesting] = async function(opts) {
  if (Meteor.settings.public.env === "dev") {
    let ip = utils.ipFromConnection(this.connection);
    console.log("looking up user ", ip, CONSTANTS.ipWhitelist, opts);
    if (CONSTANTS.ipWhitelist.includes(ip)) {
      let user = Meteor.users.findOne({ "emails.0.address": opts.email });
      switch (opts.type) {
        case "verifyEmail": {
          return user.services.email.verificationTokens[0].token;
        }
        default: {
          return "Unknown";
        }
      }
    }
  } else {
    return null;
  }
}

method[CONSTANTS.methods.users.extractUserAndOrgNamesByResetToken] = async function(token) {
  let ip = utils.ipFromConnection(this.connection);
  console.log("looking up user ", ip, CONSTANTS.ipWhitelist, token);
  //if (CONSTANTS.ipWhitelist.includes(ip)) {
    let user = Meteor.users.findOne({ $or: [{ "services.password.reset.token": token }, { "services.password.enroll.token": token }] });
    console.log("got user by token", user);
    const orgName = user && user.orgId ? Organizations.findOne({ _id: user.orgId }).name : null;
    return user ? { name: `${user.profile.firstName} ${user.profile.lastName}`, orgName: orgName } : null;
  // }
  // return null;
}

method[CONSTANTS.methods.users.update] = async function(opts) {
  if (Meteor.user() && (Meteor.userId() === opts.userId || AuthManager.userHasClaim(Meteor.userId(), [CONSTANTS.claims.canEditUsers._id]))) {
    const user = Meteor.users.findOne(opts.userId);
    const upd = { profile: { firstName: user.profile?.firstName || "", lastName: user.profile?.lastName || "" } };

    if (opts.orgId) {
      upd.orgId = opts.orgId;
    }
    if (opts.firstName) {
      upd.profile.firstName = opts.firstName;
    }
    if (opts.lastName) {
      upd.profile.lastName = opts.lastName;
    }
    if (opts.email) {
      const existing = Meteor.users.findOne({ _id: opts.userId });
      console.log("found existing ", existing.emails, opts.email);
      if (existing && existing.emails[0].address !== opts.email) {
        Accounts.removeEmail(opts.userId, existing.emails[0].address);
        console.log("removed email");
        Accounts.addEmail(opts.userId, opts.email, false);
        console.log("added email");
        Accounts.sendVerificationEmail(opts.userId);
      }
      return `The user's email is updated - a verification email was sent to ${opts.email}.`;
    }
    if (Object.keys(upd).length > 0) {
      console.log("user update is ", opts.userId, upd);
      Meteor.users.update({ _id: opts.userId }, { $set: upd });
    }
    return `The user was successfully updated`;
  }
  return `You do not have permission to update this user`;
}

method[CONSTANTS.methods.users.invite] = async function(opts) {
  //try {
    console.log("invites are ", JSON.stringify(opts));
    for (let invite of opts.invites) {
      const pkg = { orgId: opts.orgId, email: invite.email.toLowerCase(), profile: { firstName: invite.firstName, lastName: invite.lastName }, intro: { firstView: true } };
      console.log("creating user", pkg);
      const userId = Accounts.createUser(pkg);
      console.log("user created ", userId);
      const resEmail = Accounts.sendEnrollmentEmail(userId, opts.email);
      console.log("enroll email sent", resEmail);
    }

    return { success: true };
};

method[CONSTANTS.methods.users.resendEnrollment] = async function(opts) {
  console.log("invites are ", JSON.stringify(opts));
  for (let user of opts.users) {
    const resEmail = Accounts.sendEnrollmentEmail(user._id, user.emails[0].email);
    console.log("enroll email sent", resEmail);
  }
  return { success: true };
};

method[CONSTANTS.methods.users.changeEmail] = async function(opts) {
  if (Meteor.user() && !Meteor.user().isAnonymous) {
    let previousEmail = Meteor.user().emails[0].address;
    Accounts.removeEmail(Meteor.userId(), previousEmail);
    Accounts.addEmail(Meteor.userId(), opts.email);
    Accounts.sendVerificationEmail(Meteor.userId());
    return true;
  }
}

method[CONSTANTS.methods.users.delete] = async function() {
  console.log("deleting user", Meteor.user(), Meteor.user().orgId);
  if (Meteor.user() && !Meteor.user().orgId) {
    Slates.remove({ userId: Meteor.userId() });
    Messages.remove({ userId: Meteor.userId() });
    Meteor.users.remove({ _id: Meteor.userId() });
    return true;
  } else { 
    return false;
  }
}

// {
//   users: [
//     orgId: "",
//     userId: "",
//     claimIds: [],
//     action: "add|delete"    
//   ]
// }
method[CONSTANTS.methods.users.changeRoles] = async function(opts) {
  console.log("users are ", opts.users);
  if (Meteor.user() && AuthManager.userHasClaim(Meteor.userId(), [CONSTANTS.claims.canEditUsers._id])) {
    opts.users.forEach((u)  => {
      console.log("updating user ", u.orgId, Meteor.user().orgId);
      if (u.orgId === Meteor.user().orgId) {
        const claims = Claims.find({ _id: { $in: u.claimIds } }).fetch();
        if (claims.length !== u.claimIds.length) {
          throw new Meteor.Error("You've tried to add or remove role(s) that do not exist: " + JSON.stringify(u.claimIds.filter(r => r !== claims.map(c => c._id))));
        } else {
          console.log("checking action ", u.action, claims);
          switch (u.action) {
            case "add":
              if (u.claimIds[0] === "admin") {
                Permissions.remove({ orgId: opts.orgId, userId: u.userId });
              }
              claims.forEach((c) => {
                //only if it doesn't exist
                const q = { orgId: Meteor.user().orgId, userId: u.userId, claimId: c._id };
                if (Permissions.find(q).count() === 0) {
                  Permissions.insert(q);
                }
              });
              break;
            case "delete":
              Permissions.remove({ orgId: Meteor.user().orgId, userId: u.userId, claimId: { $in: claims.map(c => c._id) } });
              break;
          }
        }
        Meteor.users.update({ _id: u._id }, { $set: { roles: u.claimIds } });
      }
    });
    return true;
  }
  return false;
}

Meteor.methods(method);