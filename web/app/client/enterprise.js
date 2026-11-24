// The browser side of the enterprise loader (imports/api/client/enterprise-slots.mjs). Where the
// server says enterprise code is unlocked (Slatebox Cloud, or a licensed self-hosted install) it
// requests the enterprise chunk after start; elsewhere it requests nothing.
import { Meteor } from 'meteor/meteor'
import { loadEnterpriseClient } from '../imports/api/client/enterprise-slots.mjs'

Meteor.startup(() => {
  loadEnterpriseClient({ settings: Meteor.settings, load: () => import('/enterprise/client') }).catch((error) =>
    console.warn('[enterprise]', error)
  )
})
