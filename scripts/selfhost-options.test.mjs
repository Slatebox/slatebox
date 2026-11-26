// The header's Move to Cloud on a self-hosted install (owner, 2026-11-25), without Meteor.
// Integrations are free on every install since 2026-11-26, so the button's only job is the move:
// there is no trial, no license key, no unlock and no "Upgrade" any more.
// - who sees it (cloudMoveOffer): Cloud never; nobody signed out; this server's administrator only;
// - what it says: the move and that staying is free; never a trial, a license, a plan, a price or Pro;
// - the server: no trial, key or license calls are left, and nothing asks Slatebox Cloud for a key;
// - the move: export here, upload to Cloud, counts compared section by section, live only on the
//   administrator's yes, identical slates on Cloud; one at a time, re-runnable, resumable after a
//   restart without uploading twice, a waiting move replaced only when asked, cancellable
//   mid-upload, and Cloud's limits and an unreachable Cloud in plain words.
// Run: node --test scripts/selfhost-options.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as options from '../web/app/imports/api/common/selfhost-options.mjs'
import { createCloudClient, CloudError } from '../web/app/server/selfhost-options/cloud-client.mjs'
import * as cloudClient from '../web/app/server/selfhost-options/cloud-client.mjs'
import { createMoveService, memoryFlows, MoveError } from '../web/app/server/selfhost-options/service.mjs'
import { createTeamExporter } from '../web/app/server/team-export/export-core.mjs'
import { createTeamImporter } from '../web/app/server/team-export/import-core.mjs'
import { createTeamTransfer, createTicketStore, MOVES_PER_DAY } from '../web/app/server/team-export/transfer.mjs'
import { classifyUpload } from '../web/app/server/common/upload-kinds.mjs'
import { memoryDb } from './team-export-store.mjs'
import { startFakeCloud, testSigner } from './fake-slatebox-cloud.mjs'

const { cloudMoveOffer, FLOW_WORDS, FREE_HERE, MOVE_LABEL, MOVED_LABEL, moveLabel, MOVE_WHAT_CHANGES, MOVE_WHAT_MOVES } = options
const appRequire = createRequire(new URL('../web/app/package.json', import.meta.url))
appRequire('slateboxjs/workshops/behaviour')
appRequire('slateboxjs/workshops/rules')
const { validateWorkshop } = appRequire('slateboxjs/workshops/model')

const signer = testSigner()
const HOST = 'boards.acme.test'
const selfHost = (extra = {}) => ({ public: { env: 'selfhost', edition: 'self-host', baseUrl: `https://${HOST}`, ...extra } })
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
// What self-host copy never says (owner rules): no trial, license, unlock, upgrade, plan, price or payment.
const NOT_SAID = /trial|licen[cs]e|unlock|upgrade|enterprise features|\bPro\b|Business|\$\s?\d|price|pay(ment)?s?\b|stripe|plans\//i

// ------------------------------------------------------------------ who sees it, and what it says

test('who sees Move to Cloud: never on Cloud or signed out; this server\'s administrator only, whatever runs here', () => {
  const cloud = { public: { edition: 'cloud', enterprise: { unlocked: true, via: 'cloud', features: [] } } }
  for (const serverAdmin of [true, false, null]) assert.deepEqual(cloudMoveOffer({ settings: cloud, signedIn: true, serverAdmin }), { show: 'none' }, 'Cloud never')
  assert.deepEqual(cloudMoveOffer({ settings: selfHost(), signedIn: false, serverAdmin: true }), { show: 'none' }, 'nobody signed in (or a guest)')
  assert.deepEqual(cloudMoveOffer({ settings: selfHost(), signedIn: true, serverAdmin: null }), { show: 'none' }, 'not until the server answers who is admin')
  assert.deepEqual(cloudMoveOffer({ settings: selfHost(), signedIn: true, serverAdmin: false }), { show: 'none' }, 'a member cannot move a team: no dead control')
  assert.deepEqual(cloudMoveOffer({ settings: selfHost(), signedIn: true, serverAdmin: true }), { show: 'move' })
  assert.deepEqual(cloudMoveOffer({ settings: {}, signedIn: true, serverAdmin: true }), { show: 'move' }, 'a settings file without an edition is self-host')
  // Integrations running here or not changes nothing: the button only moves the team.
  for (const enterprise of [{ unlocked: true, via: 'self-host', features: ['agents.invite'] }, { unlocked: false }])
    assert.deepEqual(cloudMoveOffer({ settings: selfHost({ enterprise }), signedIn: true, serverAdmin: true }), { show: 'move' })
})

test('the header button is called Move to Cloud, and nothing it opens offers a trial, a license, an upgrade or a price', () => {
  assert.equal(MOVE_LABEL, 'Move to Cloud')
  assert.deepEqual(Object.keys(options).sort(), ['CLOUD_ORIGIN', 'FLOW_WORDS', 'FREE_HERE', 'MOVED_LABEL', 'MOVE_LABEL', 'MOVE_WHAT_CHANGES', 'MOVE_WHAT_MOVES', 'cloudMoveOffer', 'moveLabel'])
  // After a finished move the header says where the team is, and still opens the panel.
  assert.equal(MOVED_LABEL, 'On Slatebox Cloud')
  assert.equal(moveLabel(null), MOVE_LABEL)
  assert.equal(moveLabel({ serverAdmin: true, move: { state: 'review' }, movedSaved: null }), MOVE_LABEL)
  assert.equal(moveLabel({ serverAdmin: true, move: { state: 'moved' }, movedSaved: null }), MOVED_LABEL)
  assert.equal(moveLabel({ serverAdmin: true, move: null, movedSaved: { url: 'https://app.slatebox.com/', banner: false } }), MOVED_LABEL)
  assert.deepEqual(Object.keys(FLOW_WORDS).sort(), ['cancelled', 'confirming', 'exporting', 'failed', 'moved', 'review', 'signing_in', 'uploading'])
  for (const words of [MOVE_LABEL, MOVED_LABEL, FREE_HERE, ...MOVE_WHAT_MOVES, ...MOVE_WHAT_CHANGES, ...Object.values(FLOW_WORDS)]) assert.doesNotMatch(words, NOT_SAID, words)
  assert.match(FREE_HERE, /integrations[\s\S]*free on this server/)
  const ui = ['web/app/imports/ui/components/selfhost/MoveToCloudButton.jsx', 'web/app/imports/ui/components/selfhost/MoveToCloudPanel.jsx']
  for (const path of ui) {
    // What a person reads: JSX text and string literals (comments are for developers).
    const shown = read(path).replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    assert.doesNotMatch(shown, NOT_SAID, path)
    assert.doesNotMatch(shown, /selfhost\.(startTrial|resumeTrial|enterKey|cloudOffer)|adoptEnterpriseState|license-key|start-trial/, path)
  }
  assert.match(read(ui[0]), /cloudMoveOffer/)
  assert.match(read('web/app/imports/ui/Main.jsx'), /<MoveToCloudButton \/>/)
})

test('the server keeps no trial, key or unlock path: nothing asks Slatebox Cloud for a key', () => {
  for (const name of ['licenseKey', 'licenseOffer']) assert.equal(createCloudClient({ origin: 'https://app.slatebox.com' })[name], undefined, name)
  assert.equal(cloudClient.LICENSE_SCOPE, undefined)
  const service = createMoveService({ cloud: createCloudClient({ origin: 'https://app.slatebox.com' }), flows: memoryFlows(), isServerAdmin: async () => true, preflight: async () => ({}), exportStream: async () => null, install: { label: HOST } })
  for (const name of ['offer', 'startTrial', 'resumeTrial', 'enterKey']) assert.equal(service[name], undefined, name)
  const meteor = read('web/app/server/selfhost-options/meteor.js')
  for (const method of ['selfhost.cloudOffer', 'selfhost.startTrial', 'selfhost.resumeTrial', 'selfhost.enterKey']) assert.ok(!meteor.includes(`'${method}'`), method)
  assert.doesNotMatch(meteor, /enterpriseRuntime|licenseKeys|installProofs|LICENSE_URL|PLANS_URL/)
  // This server answers no license proofs, and keeps no entered key.
  assert.doesNotMatch(read('web/app/server/apiHooks.js'), /installProofs|PROOF_PATH/)
  for (const gone of ['web/app/server/enterprise-key.mjs', 'web/app/server/enterprise-runtime.mjs', 'web/app/server/selfhost-options/proofs.mjs']) {
    assert.throws(() => read(gone), /ENOENT/, gone)
  }
})

test('an unreachable Cloud is explained, not shown as an errno', async () => {
  const client = createCloudClient({ origin: 'https://app.slatebox.com', fetch: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }) } })
  const error = await client.deviceAuthorize({ scope: 'team:export team:move' }).catch((e) => e)
  assert.ok(error instanceof CloudError)
  assert.deepEqual([error.code, error.detail], ['unreachable', 'ENOTFOUND'])
  assert.doesNotMatch(error.message, /ENOTFOUND/)
  assert.match(error.message, /outbound https connections to app\.slatebox\.com \(a proxy or firewall may block them\)\.$/)
  assert.doesNotMatch(error.message, NOT_SAID)
})

// ------------------------------------------------------------------ a self-hosted server with a team

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('picture bytes '.repeat(50))])
function selfHostedServer() {
  const origin = `https://${HOST}`
  const db = memoryDb()
  const files = new Map([['2026/11/01/u_alice_pic.png', PNG]])
  const put = (rows) => {
    for (const [collection, list] of Object.entries(rows)) for (const row of list) db[collection].rows.set(row._id, structuredClone(row))
  }
  put({
    organizations: [{ _id: 'orgA', name: 'Acme', createdOn: 1 }],
    users: [
      { _id: 'alice', orgId: 'orgA', isOrgOwner: true, emails: [{ address: 'alice@acme.test', verified: true }], profile: { firstName: 'Alice', lastName: 'A' } },
      { _id: 'bob', orgId: 'orgA', emails: [{ address: 'bob@acme.test', verified: true }], profile: { firstName: 'Bob', lastName: 'B' } },
    ],
    permissions: [
      { _id: 'p1', userId: 'alice', orgId: 'orgA', claimId: 'admin' },
      { _id: 'p2', userId: 'alice', claimId: 'uberMensch' },
      { _id: 'p3', userId: 'bob', orgId: 'orgA', claimId: 'canViewUsers' },
    ],
    slates: [
      { _id: 'slateA1', shareId: 'aaaa000001', userId: 'alice', orgId: 'orgA', options: { id: 'slateA1', shareId: 'aaaa000001', name: 'Roadmap', isUnlisted: true }, nodes: [{ options: { id: 'n1', text: 'Ship it', image: `${origin}/files/2026/11/01/u_alice_pic.png` } }] },
      { _id: 'slateA2', shareId: 'aaaa000002', userId: 'bob', orgId: 'orgA', options: { id: 'slateA2', shareId: 'aaaa000002', name: 'Notes', isPrivate: true }, nodes: [{ options: { id: 'n2', text: 'Plain note' } }, { options: { id: 'n3', text: 'Second note' } }] },
    ],
    orgSettings: [{ _id: 's1', orgId: 'orgA', type: 'color', value: { role: 'primary', hex: '#123456' } }],
  })
  let n = 0
  const transfer = createTeamTransfer({
    exporter: createTeamExporter({ db, cloudUrl: `${origin}/files`, readFile: async (key) => files.get(key) ?? null }),
    importer: createTeamImporter({ db, newId: () => 'S' + String(++n).padStart(16, '0'), newShareId: async () => 's' + String(++n).padStart(9, '0'), newAccessKey: async () => 'k' + String(++n), createSlate: (row) => db.slates.insertOne(row), classifyFile: (bytes, ext) => classifyUpload(bytes, 'file.' + ext), storeFile: async () => ({}), deleteFile: async () => {}, validateBoard: validateWorkshop, teamClaims: ['admin'], aiProviders: [] }),
    tickets: createTicketStore({ collection: db.tickets }),
    loadUser: (id) => db.users.findOne({ _id: id }),
    isTeamAdmin: async (user) => db.permissions.docs().some((row) => row.userId === user._id && row.orgId === user.orgId && row.claimId === 'admin'),
    isServerAdmin: async (userId) => db.permissions.docs().some((row) => row.userId === userId && row.claimId === 'uberMensch'),
    instance: { origin, name: 'Acme boards' },
  })
  return { origin, db, transfer }
}

// One clock for both sides: the service's waits move it, so a five-second poll interval passes at once.
function sharedClock() {
  let skew = 0
  return {
    now: () => Date.now() + skew,
    sleep: async (ms) => {
      skew += ms
      await new Promise((resolve) => setTimeout(resolve, 2))
    },
  }
}

async function world(t, { cloudFetch, flows = memoryFlows() } = {}) {
  const clock = sharedClock()
  const cloud = await startFakeCloud({ signer, now: clock.now })
  t.after(() => cloud.close())
  const self = selfHostedServer()
  const service = createMoveService({
    cloud: createCloudClient({ origin: cloud.origin, ...(cloudFetch && { fetch: cloudFetch(cloud.origin) }) }),
    flows,
    isServerAdmin: async (userId) => userId === 'alice',
    preflight: (userId) => self.transfer.preflight(userId),
    async exportStream(userId, passphrase, onEnd) {
      const issued = await self.transfer.startExport(userId)
      return (await self.transfer.openExport(new URL(issued.downloadUrl).pathname.split('/').pop(), passphrase, { onEnd })).stream
    },
    install: { label: HOST },
    sleep: clock.sleep,
    now: clock.now,
  })
  // Polls the move as the panel does, until it reaches one of the states.
  const until = async (id, states) => {
    for (let i = 0; i < 400; i += 1) {
      const flow = await service.follow('alice', id)
      if (states.includes(flow.state)) return flow
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    return assert.fail(`flow ${id} never reached ${states.join(' or ')}: ${JSON.stringify(await service.follow('alice', id))}`)
  }
  return { cloud, self, service, flows, until, clock }
}

test('cancel: a sign-in nobody will finish, and a move mid-upload (discarded, nothing goes live)', async (t) => {
  const w = await world(t)
  await assert.rejects(w.service.startMove('bob'), (error) => error instanceof MoveError && error.code === 'admin_required')
  const started = await w.service.startMove('alice')
  const stopped = await w.service.cancel('alice', started._id)
  assert.deepEqual([stopped.state, stopped.signIn], ['cancelled', null])
  await w.service.idle()
  assert.equal((await w.service.follow('alice', started._id)).state, 'cancelled', 'the poll stops without writing over it')

  // The move: the upload is held until cancelled, then aborted.
  let held = 0
  const m = await world(t, {
    cloudFetch: () => async (url, init) => {
      if (init?.headers?.['content-type'] === 'application/octet-stream') {
        held += 1
        return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
      }
      return fetch(url, init)
    },
  })
  const move = await m.service.startMove('alice')
  await m.cloud.approve(move.signIn.userCode)
  await m.until(move._id, ['uploading'])
  const cancelled = await m.service.cancel('alice', move._id)
  assert.equal(cancelled.state, 'cancelled')
  await m.service.idle()
  const after = await m.service.follow('alice', move._id)
  assert.deepEqual([after.state, after.failure ?? null], ['cancelled', null])
  assert.equal(held, 1)
  assert.equal(m.cloud.db.organizations.docs().filter((org) => !org.hidden).length, 0, 'nothing live on Cloud')
  // And it can start over.
  assert.equal((await m.service.startMove('alice')).state, 'signing_in')
})

// ------------------------------------------------------------------ the move

const slateTexts = (slates) => Object.fromEntries(slates.map((slate) => [slate.options.name, slate.nodes.map((node) => node.options.text)]).sort())

test('one click: the team moves to Cloud with every slate, counts checked, live only on the admin\'s yes', async (t) => {
  const w = await world(t)
  await assert.rejects(w.service.startMove('bob'), { code: 'admin_required' })
  const started = await w.service.startMove('alice')
  assert.equal(started.state, 'signing_in')
  assert.deepEqual([started.team.name, started.members, started.slates], ['Acme', 2, 2])
  assert.equal((await w.service.startMove('alice'))._id, started._id, 'one at a time: the same flow again')
  await w.cloud.approve(started.signIn.userCode)
  const review = await w.until(started._id, ['review', 'failed'])
  assert.equal(review.state, 'review', JSON.stringify(review.failure))
  assert.equal(review.verify.ok, true, JSON.stringify(review.verify))
  assert.deepEqual(review.verify.slates, { sent: 2, arrived: 2 })
  assert.equal(review.verify.sections.slates.sent, 2)
  assert.equal(review.others, 1, 'bob could be invited')
  assert.equal(review.report.into, 'new_team')
  assert.ok(review.progress.bytes > 0)
  // Nothing is visible on Cloud before the yes.
  assert.ok(w.cloud.db.organizations.docs().every((org) => org.hidden), 'hidden until confirmed')

  const confirming = await w.service.confirmMove('alice', started._id, { invite: false })
  assert.ok(['confirming', 'moved'].includes(confirming.state))
  const moved = await w.until(started._id, ['moved', 'failed'])
  assert.equal(moved.state, 'moved', JSON.stringify(moved.failure))
  assert.equal(moved.cloudUrl, w.cloud.origin + '/')
  const team = w.cloud.db.organizations.docs().find((org) => !org.hidden)
  assert.equal(team.name, 'Acme')
  assert.equal((await w.cloud.db.users.findOne({ _id: w.cloud.account._id })).orgId, team._id, 'the Cloud account owns the moved team')
  // Content equal: the same slates with the same notes on Cloud as here.
  const here = slateTexts(w.self.db.slates.docs())
  const there = slateTexts(w.cloud.db.slates.docs().filter((slate) => slate.orgId === team._id))
  assert.deepEqual(there, here)
  // This install is left exactly as it was.
  assert.equal(w.self.db.slates.docs().length, 2)
  assert.equal(w.self.db.organizations.docs().length, 1)
  // Confirming again is one confirm.
  assert.equal((await w.service.confirmMove('alice', started._id)).state, 'moved')
  assert.equal(w.cloud.db.organizations.docs().filter((org) => org.name === 'Acme').length, 1)
})

test('the move resumes after a restart from where it stopped, without uploading twice', async (t) => {
  const flows = memoryFlows()
  const w = await world(t, { flows })
  const started = await w.service.startMove('alice')
  await w.cloud.approve(started.signIn.userCode)
  await w.until(started._id, ['review'])
  const imports = (await w.cloud.db.imports.find({}).toArray()).length
  assert.equal(imports, 1)

  // The server restarts: the same flows, a new service (Cloud's token was in memory only).
  const restarted = createMoveService({
    cloud: createCloudClient({ origin: w.cloud.origin }),
    flows,
    isServerAdmin: async (userId) => userId === 'alice',
    preflight: (userId) => w.self.transfer.preflight(userId),
    exportStream: async () => assert.fail('nothing is exported again'),
    install: { label: HOST },
    sleep: w.clock.sleep,
    now: w.clock.now,
  })
  // The review waits; Make it live asks for a new sign-in first, then confirms the same move.
  assert.equal((await restarted.follow('alice', started._id)).state, 'review')
  const asked = await restarted.confirmMove('alice', started._id, { invite: true })
  assert.equal(asked.state, 'signing_in')
  await w.cloud.approve(asked.signIn.userCode)
  const live = await (async () => {
    for (let i = 0; i < 400; i += 1) {
      const flow = await restarted.follow('alice', started._id)
      if (['moved', 'failed'].includes(flow.state)) return flow
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    return null
  })()
  assert.equal(live?.state, 'moved', JSON.stringify(live?.failure))
  assert.equal((await w.cloud.db.imports.find({}).toArray()).length, imports, 'the archive was not sent twice')
  assert.ok(live.invited, 'the others were invited as asked')

  // A restart mid-export: the flow says so and resumes with a new sign-in.
  const stale = { _id: 'f'.repeat(24), kind: 'move', state: 'uploading', userId: 'alice', keys: { start: 'k1', confirm: 'k2' }, createdAt: w.clock.now() + 10, updatedAt: w.clock.now() }
  await flows.insert(stale)
  const told = await restarted.follow('alice', stale._id)
  assert.deepEqual([told.state, told.failure.code], ['needs_sign_in', 'sign_in_ended'])
})

test('a move already waiting on Cloud is replaced only when asked; Cloud\'s daily limit in its own words', async (t) => {
  const w = await world(t)
  // First move: uploaded, left waiting.
  const first = await w.service.startMove('alice')
  await w.cloud.approve(first.signIn.userCode)
  await w.until(first._id, ['review'])
  await w.flows.set(first._id, { state: 'cancelled' })
  // A second move finds the first waiting on Cloud.
  const second = await w.service.startMove('alice')
  await w.cloud.approve(second.signIn.userCode)
  const blocked = await w.until(second._id, ['failed', 'review'])
  assert.deepEqual([blocked.state, blocked.failure.code], ['failed', 'move_pending'])
  assert.match(blocked.failure.message, /already waiting/)
  // Replace it: the waiting one is discarded on Cloud, and this one goes on.
  const resumed = await w.service.startMove('alice', { replaceWaiting: true })
  assert.equal(resumed._id, second._id)
  await w.cloud.approve(resumed.signIn.userCode)
  assert.equal((await w.until(second._id, ['review', 'failed'])).state, 'review')
  assert.ok((await w.cloud.db.imports.find({}).toArray()).some((row) => row.state === 'discarded'))

  // Cloud's limit: three moves a day per person, refused with Cloud's words.
  assert.equal(MOVES_PER_DAY, 3)
  await w.flows.set(second._id, { state: 'cancelled' })
  for (const row of await w.cloud.db.imports.find({}).toArray()) await w.cloud.db.imports.updateOne({ _id: row._id }, { $set: { state: 'discarded' } })
  await w.cloud.db.imports.insertOne({ _id: 'extra-move', state: 'discarded', move: { actorUserId: w.cloud.account._id }, createdAt: new Date(w.clock.now()) })
  const third = await w.service.startMove('alice')
  await w.cloud.approve(third.signIn.userCode)
  const limited = await w.until(third._id, ['failed', 'review'])
  assert.deepEqual([limited.state, limited.failure.code], ['failed', 'move_limit'])
  assert.match(limited.failure.message, /3 times a day/)
})

test('only a team admin who administers this server can move the team', async (t) => {
  const w = await world(t)
  await w.self.db.permissions.deleteMany({ _id: 'p1' })
  await assert.rejects(w.service.startMove('alice'), { code: 'team_admin_required' })
})
