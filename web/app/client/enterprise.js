// The browser side of the enterprise loader (imports/api/client/enterprise-slots.mjs). Where the
// server says enterprise code runs (Slatebox Cloud, and every self-hosted install whose build carries
// it) it requests the enterprise chunk after start; elsewhere it requests nothing.
import { Meteor } from 'meteor/meteor'
import { loadEnterpriseClient } from '../imports/api/client/enterprise-slots.mjs'

Meteor.startup(() => {
  loadEnterpriseClient({ settings: Meteor.settings, load: () => import('/enterprise/client') }).catch((error) =>
    console.warn('[enterprise]', error)
  )
})
