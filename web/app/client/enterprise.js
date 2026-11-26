// The browser side of the enterprise loader (imports/api/client/enterprise-slots.mjs). Where the
// server says enterprise code is unlocked (Slatebox Cloud, or a licensed self-hosted install) it
// requests the enterprise chunk after start; elsewhere it requests nothing.
import { Meteor } from 'meteor/meteor'
import { enterpriseClient, loadEnterpriseClient } from '../imports/api/client/enterprise-slots.mjs'

// The same loader, for enterprise code a license unlocks while the page is open (adoptEnterpriseState).
enterpriseClient.load = () => import('/enterprise/client')

Meteor.startup(() => {
  loadEnterpriseClient({ settings: Meteor.settings, load: enterpriseClient.load }).catch((error) =>
    console.warn('[enterprise]', error)
  )
})
