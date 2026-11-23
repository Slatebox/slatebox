// @ts-nocheck
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import getUserName from '../../api/common/getUserName'
import promisify from '../../api/client/promisify'
import CONSTANTS from '../../api/common/constants'

export default function ChatWootConfig() {
  // Kill-switch mirror of the server-side injection gate: when the widget is
  // disabled per-env (public.chatWoot.enabled=false), don't even spend the
  // identifyUser round trip. $chatwoot guard below already covers script
  // absence; this also removes the wasted DDP call.
  if (Meteor.settings?.public?.chatWoot?.enabled === false) return null
  async function identifyChatWootUser() {
    const hash = await Meteor.callAsync(CONSTANTS.methods.chatWoot.identifyUser)
    const cwIdentify = {
      name: Meteor.userId() ? getUserName(Meteor.userId()) : 'Guest', // Name of the user
      avatar_url: '', // Avatar URL
      email:
        !Meteor.user() || Meteor.user().isAnonymous
          ? ''
          : Meteor.user().emails?.[0]?.address || '', // Email of the user
      identifier_hash: hash, // Identifier Hash generated based on the webwidget hmac_token
    }
    // Guard window.$chatwoot: the Chatwoot widget may not be loaded (local dev with no
    // token, an ad-blocker, or a slow/failed script load) — calling setUser on undefined
    // threw "Cannot read properties of undefined (reading 'setUser')".
    if (Meteor.userId() && window.$chatwoot) {
      window.$chatwoot.setUser(Meteor.userId(), cwIdentify)
    }
  }

  useTracker(() => {
    if (Meteor.userId()) {
      identifyChatWootUser()
    }
  })

  return null
}
