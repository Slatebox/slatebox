// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The Meteor side of team addresses, loaded at start on Slatebox Cloud only (index.js): the
// collections (never published), the Cloudflare client over the server's own fetch, who a
// device-code token belongs to, the owner's emails, and the reconciler under a lease so one
// server runs it every 10 minutes.
//
// Settings (server-only, never under "public"):
//   cloudflare.teamClaims.accountId     Cloudflare account that holds the tunnels
//   cloudflare.teamClaims.zoneId        the slatebox.team zone
//   cloudflare.teamClaims.token         API token: Cloudflare Tunnel Write (account), DNS Write + Zone Read (zone)
//   cloudflare.teamClaims.zoneName      default 'slatebox.team'
//   cloudflare.teamClaims.maxTunnels    default 800 (new claims refused at the cap); alertTunnels default 600
//   cloudflare.teamClaims.paused        true stops NEW claims (live ones keep working)
//   cloudflare.teamClaims.auditPepper   key for the address hashes in the audit (optional)
//   cloudflare.teamClaims.alertEmail    where operational alerts go (optional)
//   cloudflare.teamClaims.e2eAccounts   user ids that may claim e2e-* names (the end-to-end test)
//   cloudflare.teamClaims.reconcile     false switches the reconciler off on this server
/* eslint-disable no-console */
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { Email } from 'meteor/email'
import { Permissions } from '/imports/api/common/models'
import CONSTANTS from '/imports/api/common/constants'
import apiTokenService from '/server/api-token-auth.mjs'
import { clientAddress } from '/server/actions/http.mjs'
import { cloudOn } from '/server/cloud-lock-meteor'
import { device } from '/server/oauth/meteor.js'
import { TEAM_ADDRESSES_SCOPE, teamClaimsConfigured } from '/server/oauth/device.mjs'
import { createCloudflare } from './cf.mjs'
import { createTeamAddressService } from './claims.mjs'
import { createReconciler } from './reconcile.mjs'
import { ensureIndexes, mongoStore } from './store.mjs'

const Claims = new Mongo.Collection('teamAddresses')
const Tombstones = new Mongo.Collection('teamAddressTombstones')
const Audit = new Mongo.Collection('teamAddressAudit')
const Blocklist = new Mongo.Collection('teamAddressBlocklist')
const Flags = new Mongo.Collection('teamAddressFlags')
const Counters = new Mongo.Collection('teamAddressCounters')
const Leases = new Mongo.Collection('teamAddressLeases')

const RECONCILE_MS = 10 * 60 * 1000
const claimsSettings = () => Meteor.settings.cloudflare?.teamClaims || {}

// Every secret this module knows, scrubbed from anything it logs.
function scrub(line) {
  let text = String(line)
  const token = claimsSettings().token
  if (token) text = text.split(token).join('[cloudflare token]')
  return text
    .replace(/sbxi_[A-Za-z0-9]+_[A-Za-z0-9_-]+/g, 'sbxi_[redacted]')
    .replace(/eyJhIjoi[A-Za-z0-9+/=_-]+/g, '[tunnel token]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
}
const log = (line) => console.log(scrub(line))

const mailAvailable = () => Boolean(process.env.MAIL_URL || Meteor.settings.packages?.email?.service)
async function notify({ userId, subject, text }) {
  if (!mailAvailable()) return
  let to = claimsSettings().alertEmail || null
  if (userId) {
    const user = await Meteor.users.findOneAsync(userId, { fields: { emails: 1 } })
    to = user?.emails?.[0]?.address || null
  }
  if (!to) return
  await Email.sendAsync({ from: Meteor.settings.mailFrom || 'no-reply@slatebox.com', to, subject, text })
}

// One server runs the reconciler: a lease row it renews, taken over only once it lapses.
async function takeLease(name, holder, ms) {
  const at = Date.now()
  const raw = Leases.rawCollection()
  try {
    const result = await raw.findOneAndUpdate(
      { _id: name, $or: [{ until: { $lt: at } }, { holder }] },
      { $set: { holder, until: at + ms } },
      { upsert: true, returnDocument: 'after', includeResultMetadata: false }
    )
    return result?.holder === holder
  } catch (error) {
    if (error?.code === 11000) return false
    throw error
  }
}

export async function startTeamAddresses({ isUnlocked = () => true } = {}) {
  const gate = () => isUnlocked() && cloudOn() && teamClaimsConfigured(Meteor.settings)
  const forwardedCount = Number.parseInt(process.env.HTTP_FORWARDED_COUNT, 10) || 0
  const address = (req) => clientAddress(req, forwardedCount)
  const raw = {
    claims: Claims.rawCollection(),
    tombstones: Tombstones.rawCollection(),
    audit: Audit.rawCollection(),
    blocklist: Blocklist.rawCollection(),
    flags: Flags.rawCollection(),
    counters: Counters.rawCollection(),
  }
  const store = mongoStore(raw)
  // The client is made from the settings as they stand, so a rotated token needs a restart only.
  let client = null
  const cf = new Proxy({}, {
    get(_target, key) {
      if (!client) {
        const s = claimsSettings()
        client = createCloudflare({ token: s.token, accountId: s.accountId, zoneId: s.zoneId, fetch: globalThis.fetch })
      }
      return client[key]
    },
  })
  const findUser = (userId) => Meteor.users.findOneAsync(userId, { fields: { _id: 1, isAnonymous: 1, isDisabled: 1, emails: 1 } })
  const service = createTeamAddressService({ store, cf, config: claimsSettings, findUser, notify, log })

  // The owner of a device-code token from `npx slatebox install`: bound to this resource, with
  // the team-addresses scope. Personal tokens never carry that scope (it is not an action scope).
  async function authenticateUser(req) {
    const found = await apiTokenService.authenticateApiRequest(req, { audience: device.resourceFor('slatebox-cli') })
    if (!found || !found.token.scopes?.includes(TEAM_ADDRESSES_SCOPE)) return null
    return { _id: found.account._id }
  }
  const isAdmin = async (userId) => Boolean(await Permissions.findOneAsync({ userId, claimId: CONSTANTS.claims.uberMensch._id }, { fields: { _id: 1 } }))
  const describeOwner = async (userId) => {
    const user = await Meteor.users.findOneAsync(userId, { fields: { emails: 1 } })
    return user?.emails?.[0]?.address || null
  }

  if (gate()) {
    await ensureIndexes(raw).catch((error) => console.error('[team-addresses] indexes', scrub(error?.message || error)))
    const s = claimsSettings()
    const fingerprint = (await import('node:crypto')).createHash('sha256').update(String(s.token)).digest('hex').slice(0, 8)
    console.log(`[team-addresses] on: zone ${s.zoneName || 'slatebox.team'}, cloudflare token sha256:${fingerprint}…, new claims ${s.paused ? 'paused' : 'open'}`)
    if (claimsSettings().reconcile !== false) {
      const reconcileCf = createCloudflare({ token: s.token, accountId: s.accountId, zoneId: s.zoneId, fetch: globalThis.fetch, paceMs: 250 })
      const reconciler = createReconciler({ store, cf: reconcileCf, service, log, notify })
      const holder = `${process.pid}-${Math.random().toString(36).slice(2)}`
      let running = false
      const pass = async () => {
        if (running || !gate()) return
        running = true
        try {
          if (await takeLease('reconcile', holder, RECONCILE_MS * 2)) {
            const report = await reconciler.run()
            if (report.fixed.length || report.reaped.length || report.errors.length)
              log(`[team-addresses] reconcile: ${report.fixed.length} fixed, ${report.reaped.length} reaped, ${report.errors.length} errors`)
          }
        } catch (error) {
          log(`[team-addresses] reconcile failed: ${error?.message || error}`)
        } finally {
          running = false
        }
      }
      Meteor.setInterval(pass, RECONCILE_MS)
      Meteor.setTimeout(pass, 60_000)
    }
  } else if (cloudOn()) {
    console.log('[team-addresses] off: settings.cloudflare.teamClaims is not set on this server')
  }

  return { gate, service, authenticateUser, address, isAdmin, describeOwner }
}
