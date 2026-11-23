// The Meteor side of team export and import: the real collections, the file store and who is an
// admin, in; the transfer service (for the actions) and the two archive routes, out. Everything
// it wires runs without Meteor and is tested that way (scripts/team-export.test.mjs).
import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto'
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { Random } from 'meteor/random'
import { Accounts } from 'meteor/accounts-base'
import { validateWorkshop } from 'slateboxjs/workshops/model'
import CONSTANTS from '../../imports/api/common/constants'
import {
  AIChoices,
  Comments,
  OrganizationSettings,
  Organizations,
  Permissions,
  ProviderKeys,
  SlateAccess,
  SlateApiTokens,
  SlatePresentationConversations,
  SlatePresentations,
  SlateSnapshots,
  Slates,
} from '../../imports/api/common/models'
import { SlateEvents, slateSaveCore } from '../slate-save'
import { generateSlateShareId } from '../methods/slates'
import { classifyUpload } from '../common/upload-kinds.mjs'
import { deleteImageByKey, readS3Object, uploadS3Object } from '../common/s3Utils'
import { CONNECTION_TYPES } from '../methods/ai/connections.mjs'
import { enrollmentMailAvailable } from '../instance/meteor'
import { publicKeyFingerprint } from './archive.mjs'
import { createTeamExporter } from './export-core.mjs'
import { createTeamImporter } from './import-core.mjs'
import { createPlaceholderInvite } from './invite.mjs'
import { createTeamTransfer, createTicketStore } from './transfer.mjs'
import { mountTeamTransfer } from './routes.mjs'

const TeamImports = new Mongo.Collection('teamImports')
const TeamImportMap = new Mongo.Collection('teamImportMap')
const TeamTransferTickets = new Mongo.Collection('teamTransferTickets')
const TeamExportKeys = new Mongo.Collection('teamExportKeys')

const raw = (collection) => collection.rawCollection()
const db = {
  organizations: raw(Organizations),
  users: raw(Meteor.users),
  permissions: raw(Permissions),
  slates: raw(Slates),
  events: raw(SlateEvents),
  snapshots: raw(SlateSnapshots),
  comments: raw(Comments),
  presentations: raw(SlatePresentations),
  presentationChats: raw(SlatePresentationConversations),
  slateAccess: raw(SlateAccess),
  orgSettings: raw(OrganizationSettings),
  providerKeys: raw(ProviderKeys),
  aiChoices: raw(AIChoices),
  apiTokens: raw(SlateApiTokens),
  imports: raw(TeamImports),
  importMap: raw(TeamImportMap),
}

const cloudUrl = () => Meteor.settings.aws?.cloudUrl || ''
const fileStore = () => Boolean(Meteor.settings.aws?.imageBucket && Meteor.settings.aws?.cloudUrl)
const dateFolder = () => {
  const now = new Date()
  return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`
}

// This server's signing key for the archives it writes (Ed25519), made once and kept.
let signerPromise = null
function signer() {
  signerPromise ||= (async () => {
    const keys = raw(TeamExportKeys)
    let row = await keys.findOne({ _id: 'signing' })
    if (!row) {
      const pair = generateKeyPairSync('ed25519')
      await keys.updateOne(
        { _id: 'signing' },
        {
          $setOnInsert: {
            privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
            publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
            createdAt: new Date(),
          },
        },
        { upsert: true }
      )
      row = await keys.findOne({ _id: 'signing' })
    }
    const publicKey = createPublicKey(row.publicKey)
    return {
      privateKey: createPrivateKey(row.privateKey),
      publicKey,
      fingerprint: publicKeyFingerprint(publicKey.export({ type: 'spki', format: 'der' })),
    }
  })()
  return signerPromise
}

const exporter = createTeamExporter({
  db,
  cloudUrl: cloudUrl(),
  readFile: (key, maxBytes) => (fileStore() ? readS3Object(key, maxBytes) : null),
})

const teamClaims = Object.values(CONSTANTS.claims)
  .map((claim) => claim._id)
  .filter((id) => id !== CONSTANTS.claims.uberMensch._id)

let knownSigners = []
const importer = createTeamImporter({
  db,
  newId: () => Random.id(),
  newShareId: generateSlateShareId,
  newAccessKey: generateSlateShareId,
  createSlate: (row, actor) => slateSaveCore.create({ row, actor, source: 'import' }),
  classifyFile: (bytes, ext) => classifyUpload(bytes, 'file.' + ext),
  async storeFile({ body, ext, type, ownerUserId }) {
    if (!fileStore()) throw Object.assign(new Error('This server has no file store for imported files.'), { status: 422, code: 'file_store_missing' })
    const key = `${dateFolder()}/u_${ownerUserId}_${Random.id()}.${ext}`
    const url = await uploadS3Object({ body, key, contentType: type })
    return { url, key }
  },
  deleteFile: (key) => (fileStore() ? deleteImageByKey(key) : null),
  validateBoard: validateWorkshop,
  teamClaims,
  aiProviders: Object.keys(CONNECTION_TYPES),
  knownSigners: () => knownSigners,
  // A placeholder becomes an account the person claims by the enrollment email, unless the
  // address already has an account here in any letter case: that person has to agree to move.
  // An address the source had not verified waits for the administrator to confirm it.
  invite: createPlaceholderInvite({
    users: db.users,
    mailAvailable: enrollmentMailAvailable,
    sendEnrollment: (userId, email) => Accounts.sendEnrollmentEmail(userId, email),
  }),
})

const isServerAdmin = async (userId) =>
  Boolean(userId && (await Permissions.findOneAsync({ userId, claimId: CONSTANTS.claims.uberMensch._id }, { fields: { _id: 1 } })))

let transferSigner = null
export const teamTransfer = createTeamTransfer({
  exporter,
  importer,
  tickets: createTicketStore({ collection: raw(TeamTransferTickets) }),
  loadUser: (id) => Meteor.users.findOneAsync(id, { fields: { _id: 1, orgId: 1, isAnonymous: 1 } }),
  isTeamAdmin: async (user) =>
    Boolean(user?.orgId && (await Permissions.findOneAsync({ userId: user._id, orgId: user.orgId, claimId: CONSTANTS.claims.admin._id }, { fields: { _id: 1 } }))),
  isServerAdmin,
  signer: () => transferSigner,
  instance: {
    get origin() {
      return Meteor.settings.public.baseUrl || Meteor.absoluteUrl()
    },
    name: Meteor.settings.public.instanceName || 'Slatebox',
  },
  log: (message, fields) => console.log(message, JSON.stringify(fields)),
})

export function mountTeamExport(app, express) {
  mountTeamTransfer(app, teamTransfer, { express })
}

Meteor.startup(async () => {
  const key = await signer()
  transferSigner = key
  knownSigners = [key.fingerprint]
  await raw(TeamImportMap).createIndex({ importId: 1, section: 1 })
  await raw(TeamImports).createIndex({ state: 1, updatedAt: 1 })
  await raw(TeamTransferTickets).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86400 })
  // Pending imports nobody confirmed for 14 days are discarded; checked every hour.
  const purge = () => importer.purge().then(({ purged }) => purged && console.log('team imports purged', purged)).catch((error) => console.error('team import purge failed', error.message))
  Meteor.setTimeout(purge, 60 * 1000)
  Meteor.setInterval(purge, 60 * 60 * 1000)
})
