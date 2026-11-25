// Moving a team between two Slatebox servers by its own owner (web/app/server/team-export,
// transfer.mjs startMove / receiveMove / confirmMove): a self-hosted server and Slatebox Cloud
// are two separate databases here, so the archive really crosses from one to the other.
// - the format round trip: what leaves the self-hosted server arrives on Cloud with identical
//   slate content (the exporter's content hashes), its files, brand kit logo, presentation
//   pictures and library items (as drafts), and back the other way;
// - who may move (a team owner, or someone in no team yet), and only their own move;
// - a move into no team makes the mover its owner; into the mover's team it merges, and people
//   already there take their own seats; the team's brand kit wins;
// - the same archive twice is one move; a move holds at most MOVE_LIMITS;
// - nobody is invited unless the mover asks, and nobody gets a sign-in without that email.
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
import { createTeamTransfer, createTicketStore, MOVE_LIMITS } from '../web/app/server/team-export/transfer.mjs'
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
        options: { id: 'slateA1', name: 'Roadmap', isPublic: false, isPrivate: false, isUnlisted: true },
        nodes: [
          { options: { id: 'n1', text: 'Ship it', image: `${origin}/files/${picture}` } },
          { options: { id: 'n2', text: 'See notes', link: `${origin}/canvas/aaaa000002` } },
        ],
        creative: { model: board, revision: 3 },
      },
      { _id: 'slateA2', shareId: 'aaaa000002', userId: bob, orgId: A, options: { id: 'slateA2', name: 'Notes', isPrivate: true }, nodes: [{ options: { id: 'n3', text: 'Plain note' } }] },
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

  // Library items arrive as their authors' drafts; built-ins never travel; nothing is published.
  const items = sky.db.libraryItems.docs()
  assert.deepEqual(items.map((item) => [item.title, item.status, item.authorId === sky.alice ? 'alice' : item.authorId === placeholders[0]._id ? 'bob' : '?', item.importedLibrary.status]).sort(), [
    ['Launch board', 'draft', 'alice', 'published'],
    ['Retro', 'draft', 'bob', 'draft'],
  ])
  for (const item of items) assert.equal(item.draft.kind, 'component')

  // No secret crossed over; AI connections arrive without keys.
  const written = JSON.stringify(Object.fromEntries(Object.entries(sky.db).map(([name, c]) => [name, c.docs()])))
  for (const secret of ['$2b$10$SECRETHASH', 'CIPHERSECRET']) assert.equal(written.includes(secret), false, secret)
  assert.deepEqual(sky.db.providerKeys.docs().filter((row) => row.ownerId === team._id).map((row) => [row.name, row.cipher]), [['ours', null]])

  // Invites are the mover's choice, afterwards (teamImports.invite flow for a confirmed import).
  assert.equal((await transfer.getMove(sky.alice, result.importId)).state, 'confirmed')
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
