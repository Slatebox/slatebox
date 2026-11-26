// A stand-in Slatebox Cloud for the self-hosted Upgrade (web/app/server/selfhost-options), built from the
// app's own code over in-memory stores: the real device sign-in (server/oauth/device.mjs and its
// routes), the real token check (api-token-core.mjs), the real license issuer and route
// (server/licenses), and the real team move (team-export transfer, import core and the /api/v1
// team move actions from the action registry). Only the stores, the clock and the signing key
// are stand-ins: the key is a test key made here, never Slatebox LLC's.
//
// Used in-process by scripts/selfhost-options.test.mjs, and as its own process by the browser spec
// (scripts/selfhost-options.spec.mjs):
//   node scripts/fake-slatebox-cloud.mjs <port> <keyfile>
// where keyfile is JSON { kid, privateKey (PKCS8 PEM) } written by the spec's harness. GET /device
// is a stand-in consent page with Approve and Decline; /__state answers what Cloud holds now.
import { createPrivateKey, generateKeyPairSync, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import express from 'express'
import { memoryCollection, memoryDb } from './team-export-store.mjs'
import { createDeviceFlow, MOVE_ACTIONS, MOVE_RESOURCE_PATH, memoryWindowCounter } from '../web/app/server/oauth/device.mjs'
import { mountDeviceFlow } from '../web/app/server/oauth/routes.mjs'
import { createApiTokenService } from '../web/app/server/api-token-core.mjs'
import { createLicenseIssuer } from '../web/app/server/licenses/issuer.mjs'
import { mountLicenseRoutes } from '../web/app/server/licenses/routes.mjs'
import { signLicense } from '../web/app/server/enterprise-license.mjs'
import { createTeamExporter } from '../web/app/server/team-export/export-core.mjs'
import { createTeamImporter } from '../web/app/server/team-export/import-core.mjs'
import { createTeamTransfer, createTicketStore } from '../web/app/server/team-export/transfer.mjs'
import { mountTeamTransfer } from '../web/app/server/team-export/routes.mjs'
import { classifyUpload } from '../web/app/server/common/upload-kinds.mjs'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'
import { mountHttp } from '../web/app/server/actions/http.mjs'
import { principalFromToken } from '../web/app/server/actions/principal.mjs'
import { createIdempotencyStore } from '../web/app/server/actions/idempotency.mjs'
import { memoryDriverCollection } from './action-test-stores.mjs'

const appRequire = createRequire(new URL('../web/app/package.json', import.meta.url))
appRequire('slateboxjs/workshops/behaviour')
appRequire('slateboxjs/workshops/rules')
const { validateWorkshop } = appRequire('slateboxjs/workshops/model')

// The Meteor collection API (device.mjs, api-token-core.mjs) over a driver-style memory collection.
export function meteorView(collection) {
  let n = 0
  return {
    raw: collection,
    insertAsync: async (doc) => (await collection.insertOne({ ...doc, _id: doc._id || `${collection.name}-${(n += 1)}-${randomBytes(3).toString('hex')}` })).insertedId,
    findOneAsync: async (selector) => (await collection.findOne(selector)) ?? undefined,
    updateAsync: async (selector, update) => (await collection.updateOne(selector, update)).matchedCount,
    find: (selector) => ({ fetchAsync: () => collection.find(selector).toArray() }),
  }
}

/** A test license signer (never Slatebox LLC's): { kid, privateKey, keys: { kid: spki } }. */
export function testSigner(kid = 'test-cloud-2026') {
  const pair = generateKeyPairSync('ed25519')
  return {
    kid,
    privateKey: pair.privateKey,
    privatePem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    spki: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    get keys() {
      return { [kid]: this.spki }
    },
  }
}

/**
 * @param {{ port?: number, signer?: ReturnType<typeof testSigner>, trialDays?: number, now?: () => number,
 *           account?: { _id: string, email: string, firstName: string }, autoApprove?: boolean }} [options]
 */
export async function startFakeCloud({ port = 0, signer = testSigner(), trialDays = 30, now = Date.now, account = { _id: 'cloudAlice0000001', email: 'alice@acme.test', firstName: 'Alice' } } = {}) {
  const app = express()
  const server = await new Promise((resolve) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s))
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const db = memoryDb()
  const files = new Map()
  const licenses = memoryCollection('licenses')
  await db.users.insertOne({ _id: account._id, emails: [{ address: account.email, verified: true }], profile: { firstName: account.firstName, lastName: 'Cloud' } })

  const grants = meteorView(memoryCollection('grants'))
  const apiTokens = meteorView(db.apiTokens)
  const users = meteorView(db.users)
  const device = createDeviceFlow({ grants, apiTokens, users, origin, counter: memoryWindowCounter({ now }), enabled: () => true, now })
  const tokens = createApiTokenService({ apiTokens, users, slates: meteorView(db.slates), slateAccess: meteorView(db.slateAccess), now })

  let n = 0
  const importer = createTeamImporter({
    db,
    newId: () => 'C' + String(++n).padStart(16, '0'),
    newShareId: async () => 'c' + String(++n).padStart(9, '0'),
    newAccessKey: async () => 'k' + String(++n).padStart(9, '0'),
    createSlate: (row) => db.slates.insertOne({ ...row, revision: 1 }),
    classifyFile: (bytes, ext) => classifyUpload(bytes, 'file.' + ext),
    async storeFile({ body, ext, ownerUserId }) {
      const key = `cloud/u_${ownerUserId}_${++n}.${ext}`
      files.set(key, body)
      return { url: `${origin}/files/${key}`, key }
    },
    deleteFile: async (key) => files.delete(key),
    validateBoard: validateWorkshop,
    teamClaims: ['admin', 'canViewUsers', 'canEditUsers', 'canAddUsers'],
    aiProviders: ['openai-compatible', 'deepinfra'],
  })
  const invited = []
  const transfer = createTeamTransfer({
    exporter: createTeamExporter({ db, cloudUrl: `${origin}/files`, readFile: async (key) => files.get(key) ?? null }),
    importer: { ...importer },
    tickets: createTicketStore({ collection: db.tickets }),
    loadUser: (id) => db.users.findOne({ _id: id }),
    isTeamAdmin: async (user) => db.permissions.docs().some((row) => row.userId === user._id && row.orgId === user.orgId && row.claimId === 'admin'),
    isServerAdmin: async () => false,
    instance: { origin, name: 'Slatebox Cloud (test)' },
  })

  // The stand-in consent page: the code, then Approve or Decline as the one Cloud account.
  app.get('/device', (req, res) => {
    const code = String(req.query.code || '').replace(/[^A-Za-z-]/g, '').slice(0, 12)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<!doctype html><html><head><title>Slatebox Cloud (test): approve a sign-in</title>
<style>body{font:16px system-ui;margin:48px;color:#1b1f24}main{max-width:460px}code{font-size:26px;letter-spacing:.12em}button{font:inherit;padding:10px 18px;margin-right:8px;border-radius:8px;border:1px solid #1b1f24;cursor:pointer}.go{background:#1b1f24;color:#fff}</style></head>
<body><main><h1>Approve this sign-in?</h1><p>Signed in to Slatebox Cloud (test) as <b>${account.email}</b>.</p><p>Code <code data-code>${code}</code></p>
<form method="post" action="/device/decide"><input type="hidden" name="code" value="${code}">
<button class="go" name="allow" value="1">Approve</button><button name="allow" value="0">Decline</button></form></main></body></html>`)
  })
  app.post('/device/decide', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      const decided = await device.decide({ userCode: String(req.body.code || ''), user: { _id: account._id }, allow: req.body.allow === '1' })
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(`<!doctype html><title>Done</title><body style="font:16px system-ui;margin:48px"><h1 data-decided="${decided.status}">${decided.status === 'approved' ? 'Approved. You can close this tab.' : 'Declined.'}</h1></body>`)
    } catch (error) {
      res.status(400).end(String(error.message))
    }
  })
  mountDeviceFlow(app, { express, device })

  const issuer = createLicenseIssuer({
    licenses,
    sign: (payload) => signLicense(payload, { kid: signer.kid, privateKey: signer.privateKey }),
    counter: memoryWindowCounter({ now }),
    trialDays,
    now,
    newId: () => randomBytes(6).toString('hex'),
  })
  const licenseAudience = device.resourceFor('slatebox-server', 'license')
  const outcomes = []
  mountLicenseRoutes(app, {
    gate: () => true,
    issuer: () => issuer,
    async authenticate(req) {
      const found = await tokens.authenticateApiRequest(req, { audience: licenseAudience })
      if (!found || !found.token.scopes?.includes('license:trial')) return null
      return { _id: found.account._id, email: account.email, deviceGrantId: found.token.deviceGrantId ?? null }
    },
    report: (caller, outcome) => {
      outcomes.push(outcome)
      return device.report({ grantId: caller.deviceGrantId, userId: caller._id, ...outcome })
    },
  })

  mountTeamTransfer(app, transfer, { express })
  const moveResource = origin + MOVE_RESOURCE_PATH
  const registry = createAppRegistry({ deps: { teamTransfer: transfer }, idempotency: createIdempotencyStore({ collection: memoryDriverCollection(), now }), now })
  mountHttp(app, registry, {
    express,
    authenticate: async (req) => principalFromToken(await tokens.authenticateApiRequest(req, { audience: moveResource }), { audiences: { [moveResource]: MOVE_ACTIONS } }),
  })
  app.get('/__state', async (_req, res) => {
    res.json({
      licenses: licenses.docs().map(({ key: _key, ...row }) => row),
      teams: db.organizations.docs().map((org) => ({ _id: org._id, name: org.name, hidden: Boolean(org.hidden) })),
      slates: db.slates.docs().map((slate) => ({ name: slate.options?.name, orgId: slate.orgId })),
      imports: (await db.imports.find({}).toArray()).map((row) => ({ _id: row._id, state: row.state })),
      outcomes,
    })
  })

  // What a person does on the real /device page, without the page (in-process tests).
  async function approve(userCode, allow = true) {
    return device.decide({ userCode, user: { _id: account._id }, allow })
  }

  return {
    origin,
    db,
    files,
    licenses,
    invited,
    signer,
    account,
    device,
    approve,
    outcomes,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

// node scripts/fake-slatebox-cloud.mjs <port> <keyfile>
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [port, keyFile] = process.argv.slice(2)
  const key = JSON.parse(readFileSync(keyFile, 'utf8'))
  const signer = { kid: key.kid, privateKey: createPrivateKey(key.privateKey), keys: { [key.kid]: key.spki } }
  const cloud = await startFakeCloud({ port: Number(port), signer })
  console.log(`fake Slatebox Cloud at ${cloud.origin} (test key ${signer.kid})`)
}
