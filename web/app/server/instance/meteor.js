// The Meteor side of the instance description and the account summary: real stores in, one
// describer and one accounts core out. The registry's instance.describe and account.get and the
// workshop AI gate read these.
import { Meteor } from 'meteor/meteor'
import { Email } from 'meteor/email'
import { Mongo } from 'meteor/mongo'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describeOperations, LIMITS } from 'slateboxjs/operations'
import { describeWorkshopEdits } from 'slateboxjs/workshops/model'
import { execLimits } from '../exec/meteor'
import {
  Organizations,
  Permissions,
} from '../../imports/api/common/models'
import { actions } from '../actions/index.mjs'
import { RATE_LIMITS } from '../actions/rate-limit.mjs'
import { createAccounts } from './account-summary.mjs'
import { canStartAI, includedThisMonth, proSummaryFor } from '../metering/meteor'
import { createInstanceDescriber } from './describe.mjs'
import { resolveInstanceIdentity } from './identity.mjs'
import { packageVersion } from './package-version.mjs'

const InstanceIdentity = new Mongo.Collection('instanceIdentity')
const { settings } = Meteor
const origin = () => settings.public.baseUrl || Meteor.absoluteUrl()

export function enrollmentMailAvailable() {
  return Boolean(process.env.MAIL_URL?.trim() || settings.packages?.email?.service || Email.customTransport)
}

// Cloud always sends mail; a self-hosted instance only once its operator configured it.
export function verificationMailAvailable() {
  return settings.public.env !== 'selfhost' || enrollmentMailAvailable()
}

// Whether this account may draft workshops with AI: the meter's answer (anyone signed in on
// Cloud, while the included amount, a balance or an own key covers it; self-hosted operators opt in).
export const canGenerate = (user) => canStartAI(user)

export const accounts = createAccounts({
  settings,
  origin: origin(),
  findUser: (userId) => Meteor.users.findOneAsync(userId),
  findOrganization: (orgId) => Organizations.findOneAsync(orgId),
  listClaims: async (userId) =>
    (await Permissions.find({ userId }, { fields: { claimId: 1 } }).fetchAsync()).map((row) => row.claimId),
  includedThisMonth,
  proSummary: (user) => proSummaryFor(user),
  canGenerate,
})

// Meteor's own require answers module ids, not files: ask Node, from the server bundle's npm
// folder (programs/server/npm in development and in a built bundle alike).
function engineVersion() {
  try {
    const entry = createRequire(join(process.cwd(), 'npm', 'package.json')).resolve('slateboxjs/operations')
    return packageVersion(entry, 'slateboxjs')
  } catch {
    return null
  }
}

// Read once per process; a failure is retried on the next call.
let identity = null
const instanceIdentity = () => {
  identity ||= resolveInstanceIdentity({
    collection: InstanceIdentity.rawCollection(),
    configuredId: settings.instance?.id,
  }).catch((error) => {
    identity = null
    throw error
  })
  return identity
}

export const describer = createInstanceDescriber({
  settings,
  origin: origin(),
  identity: instanceIdentity,
  engine: {
    version: engineVersion(),
    operations: describeOperations(),
    workshopEdits: describeWorkshopEdits(),
    limits: LIMITS,
  },
  actions,
  rateLimits: RATE_LIMITS,
  mailAvailable: verificationMailAvailable,
  accounts,
  env: process.env,
  execLimits: execLimits(),
})

Meteor.startup(async () => {
  // Fail loudly at start, not on a caller, when instance.id is malformed.
  await instanceIdentity()
})
