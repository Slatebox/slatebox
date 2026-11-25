// Moving a team between two Slatebox servers by its own owner (web/app/server/team-export,
// transfer.mjs startMove / receiveMove / confirmMove): a self-hosted server and Slatebox Cloud
// are two separate databases here, so the archive really crosses from one to the other.
// - the format round trip: what leaves the self-hosted server arrives on Cloud with identical
//   slate content (the exporter's content hashes), its files, brand kit logo, presentation
//   pictures and library items (sent to the receiving server's review queue on confirm), and
//   back the other way;
// - who may move (a team owner, or someone in no team yet), and only their own move;
// - a move into no team makes the mover its owner; into the mover's team it merges, and people
//   already there take their own seats; the team's brand kit wins;
// - the same archive twice is one move; a move holds at most MOVE_LIMITS;
// - nobody is invited unless the mover asks (then or later), nobody gets a sign-in without that
//   email, and someone who already has an account here joins only by accepting, signed in;
// - no review by this server's staff: at most MOVES_PER_DAY moves a person a day, each step in the
//   administrators' audit, and moves listed with the imports with who moved them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { createRequire } from 'node:module'
import express from 'express'
import { memoryDb } from './team-export-store.mjs'
import { readArchive, writeArchive } from '../web/app/server/team-export/archive.mjs'
import { LIMITS, contentHash } from '../web/app/server/team-export/format.mjs'
import { createTeamExporter } from '../web/app/server/team-export/export-core.mjs'
import { createTeamImporter } from '../web/app/server/team-export/import-core.mjs'
import { createTeamTransfer, createTicketStore, MOVE_LIMITS, MOVES_PER_DAY } from '../web/app/server/team-export/transfer.mjs'
import { createPlaceholderInvite, hashJoinToken } from '../web/app/server/team-export/invite.mjs'
import { mountTeamTransfer } from '../web/app/server/team-export/routes.mjs'
import { classifyUpload } from '../web/app/server/common/upload-kinds.mjs'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'

const appRequire = createRequire(new URL('../web/app/package.json', import.meta.url))
appRequire('slateboxjs/workshops/behaviour')
appRequire('slateboxjs/workshops/rules')
const { catalogPreset } = appRequire('slateboxjs/catalog')
const { validateWorkshop } = appRequire('slateboxjs/workshops/model')

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('picture bytes '.repeat(50))])
const LOGO = Buffer.concat([PNG, Buffer.from('logo')])
const DECK = Buffer.concat([PNG, Buffer.from('deck picture')])
const CLAIMS = ['admin', 'canViewUsers', 'canEditUsers', 'canAddUsers']
const id17 = (tag, n) => (tag + String(n).padStart(17, '0')).slice(-17).replace(/^./, tag[0])
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

// One Slatebox server: its database, its files, its address and its own signing key.
function server(name, origin, files) {
  const db = memoryDb()
  const store = new Map()
  for (const [key, bytes] of Object.entries(files || {})) store.set(key, bytes)
  const pair = generateKeyPairSync('ed25519')
  let n = 0
  let share = 0
  const tag = name[0].toUpperCase()
  const importer = (overrides = {}) =>
    createTeamImporter({
      db,
      newId: () => tag + String(++n).padStart(16, '0'),
      newShareId: async () => name[0] + String(++share).padStart(9, '0'),
      newAccessKey: async () => 'k' + String(++share).padStart(9, '0'),
      createSlate: (row) => db.slates.insertOne({ ...row, revision: 1 }),
      classifyFile: (bytes, ext) => classifyUpload(bytes, 'file.' + ext),
      async storeFile({ body, ext, ownerUserId }) {
        const key = `2026/11/24/u_${ownerUserId}_${tag + String(++n).padStart(16, '0')}.${ext}`
        store.set(key, body)
        return { url: `${origin}/files/${key}`, key }
      },
      deleteFile: async (key) => store.delete(key),
      validateBoard: validateWorkshop,
      teamClaims: CLAIMS,
      aiProviders: ['openai-compatible', 'deepinfra'],
      ...overrides,
    })
  const exporter = createTeamExporter({ db, cloudUrl: `${origin}/files`, readFile: async (key) => store.get(key) ?? null })
  const invites = []
  const transfer = (overrides = {}) =>
    createTeamTransfer({
      exporter,
      importer: importer({ invite: async (user) => (invites.push(user.importPlaceholder.email), user.importPlaceholder.emailVerified ? 'sent' : 'unverified') }),
      tickets: createTicketStore({ collection: db.tickets }),
      loadUser: (id) => db.users.findOne({ _id: id }),
      isTeamAdmin: async (user) => db.permissions.docs().some((row) => row.userId === user._id && row.orgId === user.orgId && row.claimId === 'admin'),
      isServerAdmin: async (userId) => db.permissions.docs().some((row) => row.userId === userId && row.claimId === 'uberMensch'),
      signer: { privateKey: pair.privateKey, publicKey: pair.publicKey },
      instance: { origin, name },
      ...overrides,
    })
  const put = (rows) => {
    for (const [collection, list] of Object.entries(rows)) for (const row of list) db[collection].rows.set(row._id, structuredClone(row))
  }
  return { name, origin, db, files: store, importer, exporter, transfer, invites, put }
}

// The self-hosted server: team Acme (alice owns it, bob is in it), with a picture on a slate, a
// brand kit logo, a presentation picture, a board with a rule, two library items and a key.
function selfHosted() {
  const origin = 'https://boards.acme.test'
  const alice = id17('a', 1)
  const bob = id17('b', 1)
  const A = 'orgA0000000000001'
  const picture = `2026/11/01/u_${alice}_${id17('f', 1)}.png`
  const logo = `2026/11/01/u_${alice}_${id17('f', 2)}.png`
  const deckPicture = `2026/11/01/u_${bob}_${id17('f', 3)}.png`
  const s = server('self', origin, { [picture]: PNG, [logo]: LOGO, [deckPicture]: DECK })
  const board = catalogPreset('now-next-later')
  s.put({
    organizations: [{ _id: A, name: 'Acme', createdOn: 1 }],
    users: [
      { _id: alice, orgId: A, isOrgOwner: true, emails: [{ address: 'Alice@Acme.test', verified: true }], profile: { firstName: 'Alice', lastName: 'A' }, services: { password: { bcrypt: '$2b$10$SECRETHASH' } } },
      { _id: bob, orgId: A, emails: [{ address: 'bob@acme.test', verified: true }], profile: { firstName: 'Bob', lastName: 'B' } },
    ],
    permissions: [
      { _id: 'p1', userId: alice, orgId: A, claimId: 'admin' },
      { _id: 'p2', userId: bob, orgId: A, claimId: 'canViewUsers' },
      { _id: 'p3', userId: alice, claimId: 'uberMensch' },
    ],
    slates: [
      {
        _id: 'slateA1', shareId: 'aaaa000001', userId: alice, orgId: A,
        options: { id: 'slateA1', shareId: 'aaaa000001', name: 'Roadmap', isPublic: false, isPrivate: false, isUnlisted: true },
        nodes: [
          { options: { id: 'n1', text: 'Ship it', image: `${origin}/files/${picture}` } },
          { options: { id: 'n2', text: 'See notes', link: `${origin}/canvas/aaaa000002` } },
        ],
        creative: { model: board, revision: 3 },
      },
      { _id: 'slateA2', shareId: 'aaaa000002', userId: bob, orgId: A, options: { id: 'slateA2', shareId: 'aaaa000002', name: 'Notes', isPrivate: true }, nodes: [{ options: { id: 'n3', text: 'Plain note' } }] },
    ],
    comments: [{ _id: 'c1', slateId: 'slateA1', nodeId: 'n1', text: 'Looks good', createdByUserId: bob, mentionedTeamMembers: [alice] }],
    presentations: [{ _id: 'pr1', slateShareId: 'aaaa000001', userId: bob, orgId: A, isPublic: true, isPublished: true, name: 'Roadmap talk', slides: [{ image: `${origin}/files/${deckPicture}` }] }],
    orgSettings: [
      { _id: 's1', orgId: A, type: 'logo', value: { logoType: 'squareLogo', name: 'acme.png', url: `${origin}/files/${logo}` }, deleted: false },
      { _id: 's2', orgId: A, type: 'color', value: { role: 'primary', hex: '#123456' } },
    ],
    providerKeys: [{ _id: 'k1', ownerType: 'org', ownerId: A, provider: 'openai-compatible', name: 'ours', baseUrl: 'https://llm.example.com/v1', model: 'm1', cipher: 'CIPHERSECRET', last4: 'abcd' }],
    aiChoices: [{ _id: 'org:' + A, use: { chat: 'team:ours' } }],
    libraryItems: [
      { _id: 'li1', kind: 'component', origin: 'user', status: 'published', authorId: alice, title: 'Launch board', summary: 'Plan a launch', category: 'planning', publishedVersion: 1, versionCount: 1 },
      { _id: 'li2', kind: 'component', origin: 'user', status: 'draft', authorId: bob, title: 'Retro', summary: 'Look back', draft: { kind: 'component', workshop: catalogPreset('now-next-later') } },
      { _id: 'builtin-x', kind: 'component', origin: 'builtin', status: 'published', authorId: null, title: 'Built in' },
    ],
    libraryVersions: [{ _id: 'li1:1', itemId: 'li1', n: 1, content: { kind: 'component', workshop: catalogPreset('now-next-later') } }],
  })
  return { ...s, A, alice, bob, picture, logo, deckPicture }
}

// Slatebox Cloud: alice has an account there in no team; dana owns team "Acme Cloud" where bob
// already is; erin is in dana's team but does not own it.
function cloud() {
  const s = server('cloud', 'https://app.slatebox.test')
  const D = 'orgD0000000000001'
  const ids = { alice: id17('x', 1), dana: id17('d', 1), bob: id17('y', 1), erin: id17('e', 1), guest: id17('g', 1) }
  s.put({
    organizations: [{ _id: D, name: 'Acme Cloud', createdOn: 5 }],
    users: [
      { _id: ids.alice, emails: [{ address: 'alice@acme.test', verified: true }], profile: { firstName: 'Alice', lastName: 'Cloud' } },
      { _id: ids.dana, orgId: D, isOrgOwner: true, emails: [{ address: 'dana@acme.test', verified: true }], profile: { firstName: 'Dana', lastName: 'D' } },
      { _id: ids.bob, orgId: D, emails: [{ address: 'BOB@acme.test', verified: true }], profile: { firstName: 'Bob', lastName: 'Cloud' } },
      { _id: ids.erin, orgId: D, emails: [{ address: 'erin@acme.test', verified: true }], profile: { firstName: 'Erin', lastName: 'E' } },
      { _id: ids.guest, isAnonymous: true, profile: { firstName: 'Guest' } },
    ],
    permissions: [
      { _id: 'q1', userId: ids.dana, orgId: D, claimId: 'admin' },
      { _id: 'q2', userId: ids.erin, orgId: D, claimId: 'admin' },
    ],
    orgSettings: [{ _id: 't1', orgId: D, type: 'color', value: { role: 'primary', hex: '#abcdef' } }],
    providerKeys: [{ _id: 'm1', ownerType: 'org', ownerId: D, provider: 'deepinfra', name: 'ours', cipher: 'CLOUDCIPHER' }],
  })
  return { ...s, D, ...ids }
}

async function collect(stream) {
  const parts = []
  for await (const part of stream) parts.push(part)
  return Buffer.concat(parts)
}
async function* from(bytes, size = 4096) {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size)
}

// "Export everything" on a server, as its team admin would: the archive's bytes.
async function exportTeam(srv, userId, passphrase = null) {
  const transfer = srv.transfer()
  const { downloadUrl } = await transfer.startExport(userId)
  const opened = await transfer.openExport(downloadUrl.split('/').pop(), passphrase)
  return collect(opened.stream)
}

// What each slate in an archive is, by name: its content hash as the exporter wrote it.
async function sentHashes(bytes, passphrase = null) {
  const out = {}
  const reader = readArchive(from(bytes), { passphrase })
  for (;;) {
    const next = await reader.next()
    if (next.done) return out
    if (next.value.s === 'slates') out[next.value.d.options.name] = next.value.h
  }
}

// A slate on the receiving server, hashed the way the exporter hashed it: files by their
// content, board rules on again (an import switches them off until reviewed).
function arrivedHash(srv, slate) {
  const copy = structuredClone(slate)
  const names = (url) => {
    const key = url.startsWith(srv.origin + '/files/') ? url.slice(srv.origin.length + 7) : null
    return key && srv.files.has(key) ? 'sbx-file:' + sha(srv.files.get(key)) : url
  }
  for (const rule of copy.creative?.model?.behaviour?.rules || []) rule.on = true
  return contentHash(copy, names)
}

async function move(srv, userId, bytes, { passphrase = null, transfer = srv.transfer() } = {}) {
  const started = await transfer.startMove(userId)
  return { started, result: await transfer.receiveMove(started.uploadUrl.split('/').pop(), from(bytes), passphrase), transfer }
}

test('self-host to Cloud: the moved team arrives with identical slates, its files, brand kit, decks and library, and is the mover\'s once confirmed', async () => {
  const self = selfHosted()
  const sky = cloud()
  const bytes = await exportTeam(self, self.alice, 'correct horse battery staple')
  const sent = await sentHashes(bytes, 'correct horse battery staple')

  const { started, result, transfer } = await move(sky, sky.alice, bytes, { passphrase: 'correct horse battery staple' })
  assert.equal(started.into, 'new_team')
  assert.equal(started.maxBytes, MOVE_LIMITS.totalBytes)
  assert.ok(started.uploadUrl.startsWith('https://app.slatebox.test/team-transfer/move/'))
  assert.equal(result.state, 'pending')
  assert.equal(result.report.team.name, 'Acme')
  assert.equal(result.report.source.instance, 'https://boards.acme.test')
  assert.equal(result.report.source.signerKnown, false, 'another server signed it')

  // Pending: hidden, private, and nobody's yet.
  const staging = sky.db.organizations.docs().find((org) => org.teamImportId === result.importId)
  assert.equal(staging.hidden, true)
  assert.equal((await sky.db.users.findOne({ _id: sky.alice })).orgId, undefined)
  for (const slate of sky.db.slates.docs()) assert.equal(slate.options.isPrivate, true)

  const confirmed = await transfer.confirmMove(sky.alice, result.importId)
  assert.deepEqual([confirmed.state, confirmed.merged, confirmed.teamId, confirmed.seats.mover], ['confirmed', false, staging._id, 'Alice A'])
  assert.deepEqual(confirmed.invited, { sent: 0, needsConsent: [], mailDisabled: 0, unverified: [] }, 'nobody is invited unless the mover asks')
  assert.deepEqual(sky.invites, [])
  const team = sky.db.organizations.docs().find((org) => org._id === confirmed.teamId)
  assert.equal(team.hidden, undefined)
  assert.equal(team.createdByUserId, sky.alice)

  // The mover owns the team, with the owner's roles; their placeholder is gone; bob waits.
  const aliceNow = await sky.db.users.findOne({ _id: sky.alice })
  assert.deepEqual([aliceNow.orgId, aliceNow.isOrgOwner], [team._id, true])
  assert.deepEqual(sky.db.permissions.docs().filter((row) => row.userId === sky.alice).map((row) => [row.claimId, row.orgId]), [['admin', team._id]])
  const placeholders = sky.db.users.docs().filter((user) => user.importPlaceholder)
  assert.deepEqual(placeholders.map((user) => [user.profile.firstName, user.emails, user.services]), [['Bob', [], undefined]])

  // Identical slates: every slate's content hashes to what the self-hosted server sent.
  const slates = sky.db.slates.docs().filter((slate) => slate.orgId === team._id)
  assert.deepEqual(slates.map((slate) => slate.options.name).sort(), ['Notes', 'Roadmap'])
  for (const slate of slates) assert.equal(arrivedHash(sky, slate), sent[slate.options.name], slate.options.name)
  const roadmap = slates.find((slate) => slate.options.name === 'Roadmap')
  const notes = slates.find((slate) => slate.options.name === 'Notes')
  assert.equal(roadmap.userId, sky.alice)
  assert.equal(notes.userId, placeholders[0]._id)
  assert.deepEqual([roadmap.options.isUnlisted, roadmap.options.isPrivate], [true, false], 'visibility comes back on confirm')
  assert.equal(roadmap.nodes[1].options.link, `https://boards.acme.test/canvas/${notes.shareId}`)
  assert.ok(roadmap.nodes[0].options.image.startsWith('https://app.slatebox.test/files/'))
  const comment = sky.db.comments.docs().find((row) => row.slateId === roadmap._id)
  assert.deepEqual([comment.createdByUserId, comment.mentionedTeamMembers], [placeholders[0]._id, [sky.alice]])

  // The brand kit's logo and the deck's picture moved too: Cloud serves its own copies.
  const logo = sky.db.orgSettings.docs().find((row) => row.orgId === team._id && row.type === 'logo')
  assert.ok(logo.value.url.startsWith('https://app.slatebox.test/files/'))
  assert.ok(sky.files.get(logo.value.url.slice(sky.origin.length + 7)).equals(LOGO))
  const deck = sky.db.presentations.docs().find((row) => row.orgId === team._id)
  assert.ok(sky.files.get(deck.slides[0].image.slice(sky.origin.length + 7)).equals(DECK))
  assert.deepEqual([deck.isPublic, deck.isPublished], [true, true])

  // Library items wait in Cloud's review queue, each its author's submission (version 1);
  // built-ins never travel; nothing is published until Cloud's review approves it.
  const items = sky.db.libraryItems.docs()
  assert.deepEqual(items.map((item) => [item.title, item.status, item.reviewStatus, item.authorId === sky.alice ? 'alice' : item.authorId === placeholders[0]._id ? 'bob' : '?', item.importedLibrary.status]).sort(), [
    ['Launch board', 'submitted', 'submitted', 'alice', 'published'],
    ['Retro', 'submitted', 'submitted', 'bob', 'draft'],
  ])
  assert.deepEqual(confirmed.library, { submitted: 2 })
  for (const item of items) {
    assert.deepEqual([item.pendingVersion, item.versionCount, item.publishedVersion, item.draft], [1, 1, undefined, undefined])
    const version = sky.db.libraryVersions.docs().find((row) => row.itemId === item._id)
    assert.deepEqual([version.n, version.source, version.content.kind, version.createdBy, version.meta.title], [1, 'move', 'component', item.authorId, item.title])
    assert.ok(sky.db.libraryEvents.docs().some((row) => row.itemId === item._id && row.type === 'submitted' && row.version === 1))
  }

  // No secret crossed over; AI connections arrive without keys.
  const written = JSON.stringify(Object.fromEntries(Object.entries(sky.db).map(([name, c]) => [name, c.docs()])))
  for (const secret of ['$2b$10$SECRETHASH', 'CIPHERSECRET']) assert.equal(written.includes(secret), false, secret)
  assert.deepEqual(sky.db.providerKeys.docs().filter((row) => row.ownerId === team._id).map((row) => [row.name, row.cipher]), [['ours', null]])

  // Invites are the mover's choice, afterwards (teamImports.invite flow for a confirmed import).
  assert.equal((await transfer.getMove(sky.alice, result.importId)).state, 'confirmed')
})

test('a pending move puts nothing in the review queue, and a discarded one leaves no library rows', async () => {
  const self = selfHosted()
  const sky = cloud()
  const { result, transfer } = await move(sky, sky.alice, await exportTeam(self, self.alice))
  assert.deepEqual(sky.db.libraryItems.docs().map((item) => item.status), ['draft', 'draft'])
  assert.equal(sky.db.libraryVersions.docs().length, 0)
  await transfer.discardMove(sky.alice, result.importId)
  assert.equal(sky.db.libraryItems.docs().length, 0)
})

test('Cloud to self-host: the same format goes back, and a round trip keeps every slate identical', async () => {
  const self = selfHosted()
  const sky = cloud()
  const out = await move(sky, sky.alice, await exportTeam(self, self.alice))
  await out.transfer.confirmMove(sky.alice, out.result.importId)
  const back = await exportTeam(sky, sky.alice)
  const original = await sentHashes(await exportTeam(self, self.alice))

  // A fresh self-hosted server whose first admin (in no team) moves the Cloud team in.
  const fresh = server('fresh', 'https://boards.fresh.test')
  const admin = id17('z', 1)
  fresh.put({ users: [{ _id: admin, emails: [{ address: 'alice@acme.test', verified: true }], profile: { firstName: 'Alice', lastName: 'Admin' } }], permissions: [{ _id: 'u1', userId: admin, claimId: 'uberMensch' }] })
  const home = await move(fresh, admin, back)
  const done = await home.transfer.confirmMove(admin, home.result.importId)
  const slates = fresh.db.slates.docs().filter((slate) => slate.orgId === done.teamId)
  assert.deepEqual(slates.map((slate) => slate.options.name).sort(), ['Notes', 'Roadmap'])
  for (const slate of slates) assert.equal(arrivedHash(fresh, slate), original[slate.options.name], slate.options.name)
  assert.equal(fresh.db.libraryItems.docs().length, 2)
  assert.ok(fresh.db.orgSettings.docs().some((row) => row.type === 'logo' && row.value.url.startsWith('https://boards.fresh.test/files/')))
})

test('a move into the team you own merges: people already there take their seats, your brand kit and agent choices stay', async () => {
  const self = selfHosted()
  const sky = cloud()
  const { started, result, transfer } = await move(sky, sky.dana, await exportTeam(self, self.alice))
  assert.equal(started.into, 'your_team')
  const confirmed = await transfer.confirmMove(sky.dana, result.importId, { invite: true })
  assert.deepEqual([confirmed.merged, confirmed.teamId, confirmed.settings], [true, sky.D, 'kept_yours'])
  // No address of dana's in the archive: she takes the owner's seat. Bob is already in her team.
  assert.equal(confirmed.seats.mover, 'Alice A')
  assert.deepEqual(confirmed.seats.matched, ['bob@acme.test'])
  assert.equal(sky.db.organizations.docs().some((org) => org.teamImportId === result.importId), false, 'the hidden team is gone')

  const slates = sky.db.slates.docs().filter((slate) => slate.orgId === sky.D)
  assert.equal(slates.length, 2)
  assert.equal(slates.find((slate) => slate.options.name === 'Roadmap').userId, sky.dana)
  assert.equal(slates.find((slate) => slate.options.name === 'Notes').userId, sky.bob)
  assert.equal(sky.db.presentations.docs().find((row) => row.orgId === sky.D).userId, sky.bob)
  // Dana and bob keep their own roles; no placeholder is left; nobody to invite.
  assert.equal(sky.db.users.docs().filter((user) => user.importPlaceholder).length, 0)
  assert.deepEqual(sky.db.permissions.docs().filter((row) => row.orgId === sky.D).map((row) => [row.userId, row.claimId]).sort(), [[sky.dana, 'admin'], [sky.erin, 'admin']].sort())
  assert.equal(confirmed.invited.sent, 0)
  // The team's own brand kit and connection named "ours" win.
  assert.deepEqual(sky.db.orgSettings.docs().filter((row) => row.orgId === sky.D).map((row) => row._id), ['t1'])
  assert.deepEqual(sky.db.providerKeys.docs().filter((row) => row.ownerId === sky.D).map((row) => row._id), ['m1'])
})

test('a move into no team with others in it invites only when the mover asks, and only verified addresses', async () => {
  const self = selfHosted()
  const sky = cloud()
  const { result, transfer } = await move(sky, sky.alice, await exportTeam(self, self.alice))
  const confirmed = await transfer.confirmMove(sky.alice, result.importId, { invite: true })
  assert.deepEqual(confirmed.invited, { sent: 1, needsConsent: [], mailDisabled: 0, unverified: [] })
  assert.deepEqual(sky.invites, ['bob@acme.test'])
})

test('who may move: a team owner or someone in no team, only their own move, one at a time, and the team must not change', async () => {
  const self = selfHosted()
  const sky = cloud()
  const bytes = await exportTeam(self, self.alice)
  const transfer = sky.transfer()
  await assert.rejects(transfer.startMove(sky.erin), { status: 403, code: 'team_owner_required' })
  await assert.rejects(transfer.startMove(sky.bob), { status: 403, code: 'team_owner_required' })
  await assert.rejects(transfer.startMove(sky.guest), { status: 403, code: 'forbidden' })
  await assert.rejects(transfer.startMove('ghost'), { status: 403, code: 'forbidden' })

  const { result } = await move(sky, sky.alice, bytes, { transfer })
  await assert.rejects(transfer.startMove(sky.alice), { status: 409, code: 'move_pending' })
  for (const other of [sky.dana, sky.erin])
    for (const call of [() => transfer.getMove(other, result.importId), () => transfer.confirmMove(other, result.importId), () => transfer.discardMove(other, result.importId)])
      await assert.rejects(call(), { status: 404, code: 'not_found' })
  // A server administrator's import confirm is not how a move is confirmed.
  sky.put({ permissions: [{ _id: 'root', userId: sky.dana, claimId: 'uberMensch' }] })
  await assert.rejects(transfer.confirmImport(sky.dana, result.importId), { status: 409, code: 'is_a_move' })
  assert.deepEqual((await transfer.listMoves(sky.alice)).map((record) => record._id), [result.importId])

  // Alice joins a team between upload and confirm: the move no longer fits.
  await sky.db.users.updateOne({ _id: sky.alice }, { $set: { orgId: sky.D } })
  await assert.rejects(transfer.confirmMove(sky.alice, result.importId), { code: 'team_owner_required' })
  await sky.db.users.updateOne({ _id: sky.alice }, { $unset: { orgId: 1 } })
  await transfer.discardMove(sky.alice, result.importId)
  assert.equal(sky.db.slates.docs().length, 0, 'a discarded move leaves nothing')

  // Asked in no team, uploaded after joining one: refused, nothing written.
  const started = await transfer.startMove(sky.alice)
  await sky.db.users.updateOne({ _id: sky.alice }, { $set: { orgId: 'orgOther000000001', isOrgOwner: true } })
  sky.put({ permissions: [{ _id: 'own', userId: sky.alice, orgId: 'orgOther000000001', claimId: 'admin' }] })
  await assert.rejects(transfer.receiveMove(started.uploadUrl.split('/').pop(), from(bytes)), { status: 409, code: 'team_changed' })
  assert.equal(sky.db.slates.docs().length, 0)
})

test('the same archive moved twice is one move, and nothing is written twice', async () => {
  const self = selfHosted()
  const sky = cloud()
  const bytes = await exportTeam(self, self.alice)
  const { result, transfer } = await move(sky, sky.alice, bytes)
  await transfer.confirmMove(sky.alice, result.importId)
  const counts = () => Object.fromEntries(Object.entries(sky.db).filter(([name]) => !['tickets', 'imports'].includes(name)).map(([name, c]) => [name, c.docs().length]))
  const before = counts()
  const filesBefore = sky.files.size
  const again = await move(sky, sky.alice, bytes, { transfer })
  assert.deepEqual([again.result.importId, again.result.state, again.result.duplicate], [result.importId, 'confirmed', true])
  assert.deepEqual(counts(), before)
  assert.equal(sky.files.size, filesBefore, 'the second copy\'s files are deleted again')
  assert.equal(sky.db.imports.docs().length, 1)
  // A fresh export (a new archive) of the same team is a new move.
  const fresh = await exportTeam(self, self.alice)
  sky.put({ users: [{ _id: id17('w', 1), emails: [{ address: 'wes@acme.test', verified: true }], profile: { firstName: 'Wes' } }] })
  const other = await move(sky, id17('w', 1), fresh, { transfer })
  assert.notEqual(other.result.importId, result.importId)
})

test('a move holds at most its limit, and one too large leaves nothing behind', async () => {
  const self = selfHosted()
  const sky = cloud()
  const bytes = await exportTeam(self, self.alice)
  const transfer = sky.transfer({ moveLimits: { ...LIMITS, totalBytes: 2000 } })
  const started = await transfer.startMove(sky.alice)
  assert.equal(started.maxBytes, 2000)
  await assert.rejects(transfer.receiveMove(started.uploadUrl.split('/').pop(), from(bytes)), (error) => error.status === 413 || error.code === 'too_large')
  assert.equal(sky.db.slates.docs().length, 0)
  assert.equal(sky.db.organizations.docs().length, 1)
  assert.equal(sky.files.size, 0)
})

test('the move route takes the archive and answers 201, then 200 with the first move for the same archive', async (t) => {
  const self = selfHosted()
  const sky = cloud()
  const bytes = await exportTeam(self, self.alice)
  const transfer = sky.transfer()
  const app = express()
  mountTeamTransfer(app, transfer, { express })
  const listener = app.listen(0)
  t.after(() => listener.close())
  const base = `http://127.0.0.1:${listener.address().port}`
  const send = async () => {
    const { uploadUrl } = await transfer.startMove(sky.alice)
    const path = new URL(uploadUrl).pathname
    return fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes })
  }
  const first = await send()
  assert.equal(first.status, 201)
  const body = await first.json()
  await transfer.confirmMove(sky.alice, body.importId)
  const second = await send()
  assert.equal(second.status, 200)
  assert.deepEqual([(await second.json()).importId], [body.importId])
  const wrong = await fetch(base + '/team-transfer/move/' + 'x'.repeat(43), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes })
  assert.equal(wrong.status, 404)
})

test('the move actions: a token needs team:move, and none of them is bound into exec scripts', async () => {
  const sky = cloud()
  const registry = createAppRegistry({ deps: { teamTransfer: sky.transfer() } })
  const agent = (userId, scopes) => ({ kind: 'agent', userId, tokenId: 'tok-' + userId, tokenName: 'CLI', scopes })
  await assert.rejects(registry.run(agent(sky.alice, ['team:import', 'team:export']), 'teamMove.start', {}), { code: 'insufficient_scope' })
  const started = await registry.run(agent(sky.alice, ['team:move']), 'teamMove.start', {})
  assert.equal(started.body.into, 'new_team')
  assert.deepEqual((await registry.run(agent(sky.alice, ['team:move']), 'teamMove.list', {})).body, { moves: [] })
  await assert.rejects(registry.run(agent(sky.erin, ['team:move']), 'teamMove.start', {}), { code: 'team_owner_required' })
  assert.equal(registry.get('teamMove.confirm').confirm, true)
  assert.equal(registry.get('teamMove.discard').destructive, true)
  assert.ok(registry.scopes.includes('team:move'))
})

test('a slate whose exporter hashed options.shareId (the share address inside its options) still reads', async () => {
  const { contentHash: _h, matchesContentHash } = await import('../web/app/server/team-export/format.mjs')
  const { slateContent, canonicalJson } = await import('../web/app/server/team-export/format.mjs')
  const slate = { _id: 's', shareId: 'abc', options: { id: 's', shareId: 'abc', name: 'X' }, nodes: [{ options: { text: 'hi' } }] }
  const legacy = createHash('sha256').update(canonicalJson(slateContent(slate, undefined, { keepOptionShareId: true }))).digest('hex')
  assert.ok(matchesContentHash(slate, undefined, legacy))
  assert.ok(matchesContentHash(slate, undefined, _h(slate)))
  assert.equal(matchesContentHash({ ...slate, nodes: [] }, undefined, legacy), false)
  // The share address inside options is identity: a moved slate hashes the same.
  assert.equal(_h(slate), _h({ ...slate, shareId: 'xyz', options: { ...slate.options, shareId: 'xyz' } }))
})

test('no staff review, but at most MOVES_PER_DAY moves a day per person, each step in the audit trail, and moves listed for administrators', async () => {
  const self = selfHosted()
  const sky = cloud()
  let clock = Date.parse('2026-11-24T10:00:00Z')
  const audit = []
  const transfer = sky.transfer({ now: () => clock, importer: sky.importer({ now: () => clock }), audit: async (entry) => audit.push(entry) })
  assert.equal(MOVES_PER_DAY, 3)
  for (let i = 0; i < MOVES_PER_DAY; i += 1) {
    const { result } = await move(sky, sky.alice, await exportTeam(self, self.alice), { transfer })
    await transfer.discardMove(sky.alice, result.importId)
    clock += 60_000
  }
  await assert.rejects(transfer.startMove(sky.alice), { status: 429, code: 'move_limit' })
  // Addresses asked for in a row are each still one move: counted again at upload.
  assert.deepEqual(audit.filter((row) => row.type === 'team-move-uploaded').length, 3)
  assert.deepEqual(audit.filter((row) => row.type === 'team-move-discarded').length, 3)
  assert.ok(audit.some((row) => row.type === 'team-move-limit' && row.userId === sky.alice))
  const uploaded = audit.find((row) => row.type === 'team-move-uploaded')
  assert.deepEqual([uploaded.userId, uploaded.teamName, uploaded.source, uploaded.signerKnown, uploaded.intoOrgId], [sky.alice, 'Acme', 'https://boards.acme.test', false, null])
  // Someone else is not limited by alice's moves; a day later alice may move again.
  await transfer.startMove(sky.dana)
  clock += 24 * 60 * 60 * 1000
  const later = await move(sky, sky.alice, await exportTeam(self, self.alice), { transfer })
  const done = await transfer.confirmMove(sky.alice, later.result.importId)
  assert.ok(audit.some((row) => row.type === 'team-move-confirmed' && row.importId === later.result.importId && row.library === 2 && row.merged === false))
  assert.equal(done.state, 'confirmed')
  // Two addresses at once, then two uploads, when one move is left: the second upload is refused.
  const busy = server('busy', 'https://busy.test')
  busy.put({ users: [{ _id: 'u0000000000000001', emails: [{ address: 'u@busy.test', verified: true }] }] })
  const t2 = busy.transfer({ movesPerDay: 1 })
  const a = await t2.startMove('u0000000000000001')
  const b = await t2.startMove('u0000000000000001')
  const bytes = await exportTeam(self, self.alice)
  await t2.receiveMove(a.uploadUrl.split('/').pop(), from(bytes))
  await assert.rejects(t2.receiveMove(b.uploadUrl.split('/').pop(), from(bytes)), { status: 429, code: 'move_limit' })
  // Administrators see moves among the imports, with who moved each.
  sky.put({ permissions: [{ _id: 'root', userId: sky.dana, claimId: 'uberMensch' }] })
  // (discarded moves are not listed; the audit trail keeps them)
  const rows = await transfer.listImports(sky.dana)
  assert.deepEqual(rows.map((row) => [row._id, row.state]), [[later.result.importId, 'confirmed']])
  for (const row of rows) assert.equal(row.movedBy, 'alice@acme.test')
  const registry = createAppRegistry({ deps: { teamTransfer: transfer } })
  const listed = await registry.run({ kind: 'person', userId: sky.dana, tokenId: null, tokenName: null, scopes: registry.scopes }, 'teamImports.list', {})
  assert.ok(listed.body.imports.every((row) => row.kind === 'move' && row.movedBy === 'alice@acme.test'))
})

// Cloud with real placeholder invitations (invite.mjs), mail on, and a way to ask an existing account to join.
function cloudWithMail() {
  const sky = cloud()
  const sent = { enrollments: [], asked: [] }
  const invite = createPlaceholderInvite({
    users: sky.db.users,
    mailAvailable: () => true,
    sendEnrollment: async (userId, email) => sent.enrollments.push(email),
    askToJoin: async ({ email, token, account }) => sent.asked.push({ email, token, account: account._id }),
  })
  const transfer = sky.transfer({ importer: sky.importer({ invite, hashToken: hashJoinToken }) })
  return { sky, sent, transfer }
}

test('invitations later: the mover invites everyone not invited yet; an existing account is asked to join and joins only by accepting, signed in as itself', async () => {
  const self = selfHosted()
  // bob already has an account on Cloud, in no team; carol (in the archive, unverified) is checked later.
  self.put({ users: [{ _id: id17('c', 1), orgId: self.A, emails: [{ address: 'carol@acme.test', verified: false }], profile: { firstName: 'Carol', lastName: 'C' } }] })
  const { sky, sent, transfer } = cloudWithMail()
  // Here bob's Cloud account is in no team (not in dana's, as in the other tests).
  sky.db.users.rows.delete(sky.bob)
  const bobCloud = id17('v', 1)
  sky.put({ users: [{ _id: bobCloud, emails: [{ address: 'Bob@Acme.test', verified: true }], profile: { firstName: 'Bob', lastName: 'Here' } }] })
  const { result } = await move(sky, sky.alice, await exportTeam(self, self.alice), { transfer })
  await assert.rejects(transfer.inviteMoved(sky.alice, result.importId), { status: 409, code: 'not_confirmed' })
  const confirmed = await transfer.confirmMove(sky.alice, result.importId)
  assert.deepEqual(confirmed.invited, { sent: 0, needsConsent: [], mailDisabled: 0, unverified: [] })
  assert.deepEqual([sent.enrollments, sent.asked], [[], []], 'nobody hears anything until the mover says so')

  // Later: bob (has an account) is asked to join; carol's address was never verified.
  await assert.rejects(transfer.inviteMoved(sky.dana, result.importId), { status: 404 })
  const later = await transfer.inviteMoved(sky.alice, result.importId)
  assert.deepEqual(later.invited, { sent: 0, needsConsent: [], mailDisabled: 0, unverified: ['carol@acme.test'], asked: ['bob@acme.test'] })
  assert.deepEqual(sent.asked.map((row) => [row.email, row.account]), [['bob@acme.test', bobCloud]])
  const bobSeat = sky.db.users.docs().find((user) => user.importPlaceholder?.email === 'bob@acme.test')
  assert.deepEqual(bobSeat.emails, [], 'the placeholder never gets the address an account already has')
  assert.equal(JSON.stringify(bobSeat).includes(sent.asked[0].token), false, 'the token is kept by hash only')
  // Asking again sends nothing new.
  assert.equal((await transfer.inviteMoved(sky.alice, result.importId)).now.asked, undefined)
  assert.equal(sent.asked.length, 1)

  // Not bob, a guest, or a bad token: refused, nothing changes.
  const { token } = sent.asked[0]
  await assert.rejects(transfer.joinMoved(sky.erin, token), { status: 403, code: 'invitation_for_another_account' })
  await assert.rejects(transfer.joinMoved(sky.guest, token), { status: 403 })
  await assert.rejects(transfer.joinMoved(bobCloud, 'x'.repeat(43)), { status: 404, code: 'invitation_invalid' })
  assert.equal((await sky.db.users.findOne({ _id: bobCloud })).orgId, undefined)

  // bob accepts: he joins the team with his roles, and his slate and comment are his.
  const joined = await transfer.joinMoved(bobCloud, token)
  assert.deepEqual([joined.teamId, joined.teamName], [confirmed.teamId, 'Acme'])
  assert.equal((await sky.db.users.findOne({ _id: bobCloud })).orgId, confirmed.teamId)
  assert.equal(sky.db.slates.docs().find((slate) => slate.options.name === 'Notes').userId, bobCloud)
  assert.equal(sky.db.comments.docs()[0].createdByUserId, bobCloud)
  assert.deepEqual(sky.db.permissions.docs().filter((row) => row.userId === bobCloud).map((row) => row.claimId), ['canViewUsers'])
  assert.equal(sky.db.users.docs().some((user) => user._id === bobSeat._id), false, 'the placeholder is gone')
  await assert.rejects(transfer.joinMoved(bobCloud, token), { code: 'invitation_invalid' }, 'used once')
  const record = await transfer.getMove(sky.alice, result.importId)
  assert.deepEqual([record.invited.asked, record.invited.joined], [[], ['bob@acme.test']])

  // carol, once the mover checked her address: an enrollment to claim her placeholder.
  const one = await transfer.inviteMoved(sky.alice, result.importId, { email: 'carol@acme.test' })
  assert.equal(one.outcome, 'sent')
  assert.deepEqual(sent.enrollments, ['carol@acme.test'])
})

test('an existing account in another team is asked, but cannot join until it leaves that team', async () => {
  const self = selfHosted()
  const { sky, sent, transfer } = cloudWithMail()
  // erin is in dana's team on Cloud and appears in the archive with her verified address.
  self.put({ users: [{ _id: id17('r', 1), orgId: self.A, emails: [{ address: 'erin@acme.test', verified: true }], profile: { firstName: 'Erin', lastName: 'Self' } }] })
  const { result } = await move(sky, sky.alice, await exportTeam(self, self.alice), { transfer })
  const confirmed = await transfer.confirmMove(sky.alice, result.importId, { invite: true })
  // bob and erin both have Cloud accounts in dana's team: both are asked, nobody gets an enrollment.
  assert.deepEqual(confirmed.invited, { sent: 0, needsConsent: [], mailDisabled: 0, unverified: [], asked: ['bob@acme.test', 'erin@acme.test'] })
  assert.deepEqual(sent.enrollments, [])
  const { token } = sent.asked.find((row) => row.email === 'erin@acme.test')
  await assert.rejects(transfer.joinMoved(sky.erin, token), { status: 409, code: 'in_another_team' })
  assert.equal((await sky.db.users.findOne({ _id: sky.erin })).orgId, sky.D)
  assert.ok(sky.db.users.docs().some((user) => user.importPlaceholder?.email === 'erin@acme.test'), 'her seat waits')
})

test('the move invite and join actions: invite needs team:move and the person\'s yes; join is for a signed-in person only', async () => {
  const { sky, transfer } = cloudWithMail()
  const registry = createAppRegistry({ deps: { teamTransfer: transfer } })
  const invite = registry.get('teamMove.invite')
  assert.deepEqual([invite.scope, invite.confirm, invite.mounts.http.path], ['team:move', true, '/team/moves/{importId}/invite'])
  const join = registry.get('teamMove.join')
  assert.deepEqual([join.principals, Boolean(join.mounts.http), join.mounts.ddp], [['person'], false, true])
  const agent = { kind: 'agent', userId: sky.alice, tokenId: 't', tokenName: 'CLI', scopes: ['team:move'] }
  await assert.rejects(registry.run(agent, 'teamMove.join', { token: 'x'.repeat(43) }), { code: 'session_required' })
})

test('a move sign-in\'s token reaches the move actions and nothing else', async () => {
  const sky = cloud()
  const registry = createAppRegistry({ deps: { teamTransfer: sky.transfer() } })
  const { principalFromToken } = await import('../web/app/server/actions/principal.mjs')
  const { MOVE_ACTIONS } = await import('../web/app/server/oauth/device.mjs')
  const resource = 'https://app.slatebox.test/api/v1/team/moves'
  const principal = principalFromToken({ token: { _id: 'tok', userId: sky.alice, kind: 'oauth', resource, scopes: ['team:export', 'team:move'], name: 'Slatebox installer' } }, { audiences: { [resource]: MOVE_ACTIONS } })
  assert.deepEqual(principal.onlyActions, [...MOVE_ACTIONS])
  assert.equal((await registry.run(principal, 'teamMove.start', {})).body.into, 'new_team')
  await assert.rejects(registry.run(principal, 'slates.list', {}), { status: 403, code: 'token_not_for_this' })
  await assert.rejects(registry.run(principal, 'teamImports.list', {}), { status: 403, code: 'token_not_for_this' })
  // A personal token is not narrowed.
  assert.equal(principalFromToken({ token: { _id: 't2', userId: sky.alice, scopes: ['team:move'] } }, { audiences: { [resource]: MOVE_ACTIONS } }).onlyActions, undefined)
  // Every action a move sign-in names exists, and each needs team:export or team:move (or none).
  for (const id of MOVE_ACTIONS) assert.ok(['team:export', 'team:move'].includes(registry.get(id).scope), id)
})

test('format: a newer server takes an older archive (no library section), and an archive with a section it does not know says to update this server', async () => {
  const self = selfHosted()
  const sky = cloud()
  async function* only(records, keep) {
    for await (const record of records) if (keep(record)) yield record
  }
  async function* plus(records, extra) {
    for await (const record of records) yield record
    yield extra
  }
  const archive = (records) => collect(writeArchive(records, { head: { createdAt: '2026-11-01T00:00:00Z', source: { instance: self.origin, name: 'self', team: 'Acme' }, encrypted: false } }))
  // An archive as a server before the library section wrote it: it imports, with no library items.
  const older = await archive(only(self.exporter.records(self.A, { skipped: [] }), (record) => record.s !== 'library'))
  const { result, transfer } = await move(sky, sky.alice, older)
  assert.equal(result.state, 'pending')
  assert.deepEqual(result.report.library, [])
  const done = await transfer.confirmMove(sky.alice, result.importId)
  assert.deepEqual(done.library, { submitted: 0 })
  assert.equal(sky.db.slates.docs().filter((slate) => slate.orgId === done.teamId).length, 2)
  // One from a newer server, with a section this server does not know yet: refused, nothing written.
  const fresh = cloud()
  const newer = await archive(plus(self.exporter.records(self.A, { skipped: [] }), { t: 'doc', s: 'tomorrow', d: { _id: 'x' } }))
  await assert.rejects(move(fresh, fresh.alice, newer), { code: 'section_unknown', message: /Update this server to the latest Slatebox, then import it again/ })
  assert.equal(fresh.db.slates.docs().length, 0)
})
