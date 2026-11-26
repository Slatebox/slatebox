/* eslint-disable no-console */
// The Meteor side of Slatebox Cloud's license keys for self-hosted servers (issuer.mjs, routes.mjs):
// the collections, Cloud's signing key from its server-side settings, the device sign-in's token
// check, and the route. Answers only on Slatebox Cloud (its own key) with settings.licenses.signer set.
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { Random } from 'meteor/random'
import { createPrivateKey } from 'node:crypto'
import { Audit } from '../../imports/api/common/models'
import apiTokenService from '../api-token-auth.mjs'
import { cloudOn } from '../cloud-lock-meteor'
import { signLicense } from '../enterprise-license.mjs'
import { createWindowCounter, LICENSE_SCOPE } from '../oauth/device.mjs'
import { device } from '../oauth/meteor'
import { createLicenseIssuer, ensureLicenseIndexes, licenseIssuerConfigured, trialDaysFrom } from './issuer.mjs'
import { mountLicenseRoutes } from './routes.mjs'

const Licenses = new Mongo.Collection('enterpriseLicenses')
const LicenseCounters = new Mongo.Collection('enterpriseLicenseCounters')

const gate = () => cloudOn() && licenseIssuerConfigured(Meteor.settings)

let issuer = null
const issuerNow = () => {
  if (issuer) return issuer
  const { kid, privateKey } = Meteor.settings.licenses.signer
  const key = createPrivateKey(privateKey)
  issuer = createLicenseIssuer({
    licenses: Licenses.rawCollection(),
    sign: (payload) => signLicense(payload, { kid, privateKey: key }),
    counter: createWindowCounter({ collection: LicenseCounters.rawCollection() }),
    trialDays: trialDaysFrom(Meteor.settings),
    audit: (entry) => Audit.insertAsync({ ...entry, created: Date.now() }),
    newId: () => Random.id(),
  })
  return issuer
}

async function authenticate(req) {
  const found = await apiTokenService.authenticateApiRequest(req, { audience: device.resourceFor('slatebox-server', 'license') })
  if (!found || !found.token.scopes?.includes(LICENSE_SCOPE)) return null
  const user = await Meteor.users.findOneAsync(found.account._id, { fields: { emails: 1 } })
  return { _id: found.account._id, email: user?.emails?.[0]?.address || null, deviceGrantId: found.token.deviceGrantId ?? null }
}

export function mountLicenses(app) {
  mountLicenseRoutes(app, {
    gate,
    issuer: issuerNow,
    authenticate,
    report: (caller, outcome) => (caller?.deviceGrantId ? device.report({ grantId: caller.deviceGrantId, userId: caller._id, ...outcome }) : undefined),
    log: (line) => console.error('[licenses]', line),
  })
}

Meteor.startup(async () => {
  await LicenseCounters.rawCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {})
  if (!gate()) return
  await ensureLicenseIndexes(Licenses.rawCollection()).catch((error) => console.error('[licenses] indexes', error?.message))
  console.log(`[licenses] issuing enterprise license keys to self-hosted servers (trials ${trialDaysFrom(Meteor.settings)} days)`)
})
