// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The Linear vendor as the recipes runtime starts it (enterprise/server/recipes/index.mjs
// VENDOR_FACTORIES): the vault, Linear's fetch, the account rows and the Linear service borrowed
// from the running integrations (connectors-hand-off, set by enterprise/server/meteor.js), and its
// one collection, linearDeliveries (each Linear-Delivery once, expiring after an hour). Until the
// integrations start, or with them off, a Linear recipe is told to connect again.
import { recipeConnectors } from '../connectors-hand-off.mjs'
import { createVendor, LINEAR_EVENTS_PATH } from './index.mjs'
import { LINEAR_ADDRESS } from '../../../linear/linear.mjs'

export function linearVendorFactory({ collection, log = () => {}, clock = Date.now }) {
  const linear = () => recipeConnectors()?.linear || null
  const deliveries = collection('linearDeliveries')
  deliveries.createIndex?.({ expiresAt: 1 }, { expireAfterSeconds: 0 })?.catch?.(() => {})
  return createVendor({
    accountOf: async (userId) => (linear() ? linear().accounts.get(userId) : null),
    tokenFor: (userId, { force = false } = {}) => {
      const found = recipeConnectors()
      if (!found?.linear) throw Object.assign(new Error('Connect Linear again.'), { name: 'SignInNeeded', code: 'needs_sign_in' })
      return found.vault.tokenFor(userId, LINEAR_ADDRESS, { force })
    },
    fetch: (...args) => {
      if (!linear()) throw Object.assign(new Error('Connect Linear again.'), { name: 'SignInNeeded', code: 'needs_sign_in' })
      return linear().fetch(...args)
    },
    signingSecret: async () => (linear() ? linear().service.signingSecret() : null),
    clientId: async () => (linear() ? linear().service.clientId?.() : null),
    revokedFor: async (organizationId) => (linear() ? linear().service.revokedFor(organizationId) : 0),
    deliveries: {
      async claim(id, expiresAt) {
        try {
          await deliveries.insertOne({ _id: id, expiresAt })
          return true
        } catch (error) {
          if (error?.code === 11000) return false
          throw error
        }
      },
    },
    log: (entry) => log({ vendor: 'linear', ...entry }),
    now: clock,
  })
}
linearVendorFactory.routes = () => [{ method: 'POST', path: LINEAR_EVENTS_PATH, raw: true, vendor: 'linear' }]
