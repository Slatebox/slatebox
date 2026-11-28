// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The Slack vendor as the recipes runtime starts it (enterprise/server/recipes/index.mjs
// VENDOR_FACTORIES): runtime deps in ({ store, clock, trigger, log }), the Slack integration's
// vault, fetch, settings and read gate borrowed from the running integrations (connectors-hand-off),
// the channel ledger and inbox kept in the runtime's own collections (recipeLedger, recipeInbox;
// their rows are told apart by id and fields), and the Slack events route's hand-off set, so
// message events reach the recipes that watch their channel.
import { NATIVE_ADDRESSES } from '../../../../common/gallery.mjs'
import { recipeConnectors } from '../connectors-hand-off.mjs'
import { setSlackRecipeIngest } from './hand-off.mjs'
import { createVendor } from './index.mjs'
import { mongoSlackStores } from './stores.mjs'

const SLACK_ADDRESS = NATIVE_ADDRESSES.slack
const UNLISTED = Object.freeze({ apiBase: 'https://slack.com', listed: false, historyLimit: 15, historyPerMinute: 1 })

export function slackVendorFactory({ store, clock = Date.now, trigger, log = () => {} }) {
  const connectors = () => {
    const found = recipeConnectors()
    if (!found) throw Object.assign(new Error('Connect Slack again on the Integrations page.'), { name: 'SignInNeeded', code: 'needs_sign_in' })
    return found
  }
  store.inbox.createIndex?.({ teamId: 1, channel: 1, folded: 1 })?.catch?.(() => {})
  store.ledger.createIndex?.({ teamId: 1, channel: 1 })?.catch?.(() => {})
  const vendor = createVendor({
    integrationOf: async (userId) => (await connectors().integrations.findOne({ ownerId: userId, address: SLACK_ADDRESS })) || null,
    tokenFor: (userId) => connectors().vault.tokenFor(userId, SLACK_ADDRESS),
    fetch: (...args) => connectors().slack.fetch(...args),
    config: () => recipeConnectors()?.slack.config() || UNLISTED,
    gates: {
      claim: (...args) => connectors().slack.gates.claim(...args),
      get: (...args) => connectors().slack.gates.get(...args),
      hold: (...args) => connectors().slack.gates.hold(...args),
    },
    stores: mongoSlackStores({ inbox: store.inbox, ledger: store.ledger, folds: store.ledger }),
    instances: {
      async matching(teamId, channel) {
        const rows = await store.instances.find({ state: 'active', 'match.slack.teamId': teamId, 'match.slack.channels': channel }, { projection: { _id: 1 }, limit: 200 }).toArray()
        return rows.map((row) => row._id)
      },
    },
    trigger: (instanceId, event) => trigger({ _id: instanceId }, event),
    log,
    now: clock,
  })
  setSlackRecipeIngest(vendor.ingest)
  return vendor
}
// Slack's events arrive on the Slack route that already exists (signature-checked there).
slackVendorFactory.routes = () => []
