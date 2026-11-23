// The browser side of the enterprise loader (imports/api/client/enterprise-slots.mjs). On Cloud
// it requests the enterprise chunk after start; on self-host it requests nothing.
import { Meteor } from 'meteor/meteor'
import { loadEnterpriseClient } from '../imports/api/client/enterprise-slots.mjs'

Meteor.startup(() => {
  loadEnterpriseClient({ settings: Meteor.settings, load: () => import('/enterprise/client') }).catch((error) =>
    console.warn('[enterprise]', error)
  )
})
