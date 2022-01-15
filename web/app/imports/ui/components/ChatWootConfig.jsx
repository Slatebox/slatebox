// @ts-nocheck
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { getUserName } from '../../api/common/getUserName.js';
import { promisify } from '../../api/client/promisify.js';
import { CONSTANTS } from '../../api/common/constants.js';
import { useEffect } from 'react';

export const ChatWootConfig = () => {
  
  async function identifyChatWootUser() {
    let hash = await promisify(Meteor.call, CONSTANTS.methods.chatWoot.identifyUser);
    const cwIdentify =  {
      name: Meteor.userId() ? getUserName(Meteor.userId()) : "Guest", // Name of the user
      avatar_url: '', // Avatar URL
      email: (!Meteor.user() || Meteor.user().isAnonymous) ? '' : Meteor.user().emails[0].address, // Email of the user
      identifier_hash: hash // Identifier Hash generated based on the webwidget hmac_token
    };
    if (Meteor.userId()) {
      window.$chatwoot.setUser(Meteor.userId(), cwIdentify);
    }
  }
  
  useTracker(() => {
    if (Meteor.userId()) {
      identifyChatWootUser();
    }
  });
  
  return null;
}