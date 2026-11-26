// Admin › Updates: the Meteor side of service.mjs, on a self-hosted server only. On Slatebox Cloud
// (settings.public.env is not 'selfhost', or the edition is 'cloud') nothing here is registered:
// no methods, no timer, no outbound request.
//
// Every method is for a server administrator (the uberMensch claim, permissions.js isInstanceAdmin);
// a team admin is refused. Every change is rate limited and written to the Audit collection. The
// app never runs an update itself: it records what the admin wants, and the host updater (which
// checks the signed release on its own) takes it from there over `docker exec`.
import { readFileSync } from 'node:fs'
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { check, Match } from 'meteor/check'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import { Email } from 'meteor/email'
import CONSTANTS from '../../imports/api/common/constants'
import { Audit, Messages, Permissions, SystemSettings } from '../../imports/api/common/models'
import { isInstanceAdmin } from '../permissions'
import { setupAppliesHere, setupRequired } from '../self-host-setup/state.js'
import { enrollmentMailAvailable } from '../instance/meteor'
import { safeFetch } from '../common/safe-fetch.mjs'
import { FEED_HOSTS, MAX_DOCUMENT_BYTES } from './feed.mjs'
import { EVENTS_COLLECTION } from './policy.mjs'
import { trustedKeys } from './verify.mjs'
import { UpdatesError, createUpdatesService } from './service.mjs'

const M = CONSTANTS.methods.updates
const TICK_MS = 10 * 60 * 1000

export const updatesApply = setupAppliesHere

/** The feed's transport: GitHub's hosts only (redirects too), for the default feed; an operator's own feed (SLATEBOX_UPDATE_FEED) as given. */
export function feedGet(feedUrl) {
  return async (url) => {
    if (!feedUrl) return safeFetch(url, { allowHosts: FEED_HOSTS, maxBytes: MAX_DOCUMENT_BYTES, timeoutMs: 20000, userAgent: 'Slatebox self-host update check' })
    if (url.startsWith('https:')) return safeFetch(url, { maxBytes: MAX_DOCUMENT_BYTES, timeoutMs: 20000, userAgent: 'Slatebox self-host update check' })
    // http: a test or mirror feed the operator named; what it serves must still be signed with a release key.
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow' })
    if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`)
    return { bytes: Buffer.from(await response.arrayBuffer()) }
  }
}

function identity() {
  try {
    const parsed = JSON.parse(readFileSync('/opt/slatebox/identity.json', 'utf8'))
    return { version: parsed.version || null, revision: parsed.app || null }
  } catch {
    return { version: Meteor.settings.selfHosted?.version || null, revision: null }
  }
}

if (updatesApply) {
  const Events = new Mongo.Collection(EVENTS_COLLECTION)
  const cols = { settings: SystemSettings.rawCollection(), events: Events.rawCollection() }
  const adminIds = async () => [...new Set((await Permissions.find({ claimId: CONSTANTS.claims.uberMensch._id }, { fields: { userId: 1 } }).fetchAsync()).map((row) => row.userId))]
  const settings = Meteor.settings
  const { mode, feedUrl } = { mode: settings.selfHosted?.updates?.mode, feedUrl: settings.selfHosted?.updates?.feedUrl || null }

  const service = createUpdatesService({
    cols, settings, get: feedGet(feedUrl), keys: trustedKeys(), current: identity,
    setUp: async () => !(await setupRequired()),
    async notify({ kind, title, text, url, security }) {
      const doc = await cols.settings.findOne({ _id: 'selfHostUpdates' }, { projection: { policy: 1 } })
      const ids = await adminIds()
      if (doc?.policy?.notify?.bell !== false || security) {
        for (const userId of ids) {
          await Messages.insertAsync({ timestamp: Date.now(), userId, text, read: false, priority: security ? 9 : 5, type: CONSTANTS.messageTypes.system, action: { type: 'link', url }, updates: kind })
        }
      }
      if ((doc?.policy?.notify?.email !== false || security) && enrollmentMailAvailable()) {
        const users = await Meteor.users.find({ _id: { $in: ids }, isAnonymous: { $ne: true } }, { fields: { emails: 1 } }).fetchAsync()
        const origin = settings.public?.baseUrl || Meteor.absoluteUrl().replace(/\/$/, '')
        for (const user of users) {
          const to = user.emails?.[0]?.address
          if (!to) continue
          await Email.sendAsync({ from: settings.mailFrom || 'no-reply@slatebox.com', to, subject: title, text: `${text}\n\n${origin}${url}\n` }).catch((error) => console.warn('[updates] mail', error?.message))
        }
      }
    },
    audit: ({ by, action, before, after }) => Audit.insertAsync({ type: 'self-host-updates', userId: by, action, before, after, created: Date.now() }),
  })

  const asAdmin = async (method) => {
    if (!method.userId || !(await isInstanceAdmin(method.userId))) throw new Meteor.Error(403, 'Only a server administrator can do that.')
    return { by: method.userId }
  }
  const plain = (fn) => async function (...args) {
    const who = await asAdmin(this)
    try {
      return await fn.call(this, who, ...args)
    } catch (error) {
      if (error instanceof UpdatesError) throw new Meteor.Error(error.code, error.message, error.details)
      throw error
    }
  }

  Meteor.methods({
    [M.status]: plain(async () => service.status()),
    [M.checkNow]: plain(async (who) => service.checkNow(who)),
    [M.setPolicy]: plain(async (who, policy) => {
      check(policy, Match.ObjectIncluding({}))
      return service.setPolicy(policy, who)
    }),
    [M.adoptTimeZone]: plain(async (who, timeZone) => {
      check(timeZone, String)
      return service.adoptTimeZone(timeZone, who)
    }),
    [M.approve]: plain(async (who, version) => {
      check(version, String)
      return service.approve(version, who)
    }),
    [M.applyNow]: plain(async (who, version) => {
      check(version, String)
      return service.applyNow(version, who)
    }),
    [M.retry]: plain(async (who, version) => {
      check(version, String)
      return service.applyNow(version, { ...who, retry: true })
    }),
    [M.cancel]: plain(async (who) => service.cancel(who)),
    [M.rollback]: plain(async (who, options) => {
      check(options, Match.Maybe({ confirm: Match.Maybe(String) }))
      return service.rollback(options || {}, who)
    }),
  })

  // Check now: once a minute per person; every change: ten a minute.
  DDPRateLimiter.addRule({ type: 'method', name: M.checkNow, userId: () => true }, 1, 60000)
  for (const name of [M.setPolicy, M.adoptTimeZone, M.approve, M.applyNow, M.retry, M.cancel, M.rollback]) {
    DDPRateLimiter.addRule({ type: 'method', name, userId: () => true }, 10, 60000)
  }
  DDPRateLimiter.addRule({ type: 'method', name: M.status, userId: () => true }, 60, 60000)

  if (mode !== 'off') {
    Meteor.startup(() => {
      const run = () => service.tick().catch((error) => console.warn('[updates] tick', error?.message))
      // The first look a minute after start, then every ten minutes (the check itself every 6 hours).
      Meteor.setTimeout(run, 60 * 1000)
      Meteor.setInterval(run, TICK_MS)
    })
  }
}
