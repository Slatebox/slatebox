// Team "Export everything" and importing it as a new team (web/app/server/team-export):
// the archive (signed, checked, optionally encrypted, read as a stream within limits), what an
// export holds and never holds, the round trip into a new hidden team with new ids, a hostile
// archive, confirm, discard and the purge, the one-time addresses and who may use them, and the
// actions every surface calls.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { generateKeyPairSync } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import express from 'express'
import { memoryDb } from './team-export-store.mjs'
import { readArchive, writeArchive } from '../web/app/server/team-export/archive.mjs'
import { LIMITS, contentHash } from '../web/app/server/team-export/format.mjs'
import { createTeamExporter } from '../web/app/server/team-export/export-core.mjs'
import { createTeamImporter, isPublicEndpoint } from '../web/app/server/team-export/import-core.mjs'
import { createTeamTransfer, createTicketStore } from '../web/app/server/team-export/transfer.mjs'
import { mountTeamTransfer } from '../web/app/server/team-export/routes.mjs'
import { createPlaceholderInvite } from '../web/app/server/team-export/invite.mjs'
import { classifyUpload } from '../web/app/server/common/upload-kinds.mjs'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'

const appRequire = createRequire(new URL('../web/app/package.json', import.meta.url))
appRequire('slateboxjs/workshops/behaviour')
appRequire('slateboxjs/workshops/rules')
const { catalogPreset } = appRequire('slateboxjs/catalog')
const { validateWorkshop } = appRequire('slateboxjs/workshops/model')

const CLOUD = 'https://files.example.test'
const APP = 'https://app.example.test'
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('picture bytes '.repeat(50))])
const id17 = (tag, n) => (tag + String(n).padStart(17, '0')).slice(-17).replace(/^./, tag[0])
const SECRETS = ['$2b$10$SECRETHASH', 'HASHEDLOGINSECRET', 'CIPHERSECRET', 'TOKENHASHSECRET', 'LINKKEYSECRET', 'sk-live-SECRET', 'STRIPESECRET']
const CLAIMS = ['admin', 'canViewUsers', 'canEditUsers', 'canAddUsers']

// Two teams on one server: Acme (alice, admin; bob) and Beta (carol, admin), and a server admin.
function seed() {
  const db = memoryDb()
  const files = new Map()
  const A = 'orgA0000000000001'
  const B = 'orgB0000000000001'
  const alice = id17('a', 1)
  const bob = id17('b', 1)
  const guest = id17('g', 1)
  const carol = id17('c', 1)
  const root = id17('r', 1)
  const aliceFile = `2026/11/01/u_${alice}_${id17('f', 1)}.png`
  const carolFile = `2026/11/01/u_${carol}_${id17('f', 2)}.png`
  files.set(aliceFile, PNG)
  files.set(carolFile, Buffer.concat([PNG, Buffer.from('beta')]))
  const board = catalogPreset('now-next-later')
  const rows = {
    organizations: [
      { _id: A, name: 'Acme', createdOn: 1, stripeCustomerId: 'STRIPESECRET' },
      { _id: B, name: 'Beta', createdOn: 2 },
    ],
    users: [
      { _id: alice, orgId: A, isOrgOwner: true, emails: [{ address: 'alice@acme.test', verified: true }], profile: { firstName: 'Alice', lastName: 'A' }, services: { password: { bcrypt: '$2b$10$SECRETHASH' }, resume: { loginTokens: [{ hashedToken: 'HASHEDLOGINSECRET' }] } } },
      { _id: bob, orgId: A, emails: [{ address: 'bob@acme.test', verified: false }], profile: { firstName: 'Bob', lastName: 'B' } },
      { _id: guest, orgId: A, isAnonymous: true, profile: { firstName: 'Guest' } },
      { _id: carol, orgId: B, isOrgOwner: true, emails: [{ address: 'carol@beta.test', verified: true }], profile: { firstName: 'Carol', lastName: 'C' } },
      { _id: root, emails: [{ address: 'root@server.test', verified: true }], profile: { firstName: 'Root' } },
    ],
    permissions: [
      { _id: 'p1', userId: alice, orgId: A, claimId: 'admin' },
      { _id: 'p2', userId: bob, orgId: A, claimId: 'canViewUsers' },
      { _id: 'p3', userId: carol, orgId: B, claimId: 'admin' },
      { _id: 'p4', userId: root, claimId: 'uberMensch' },
      { _id: 'p5', userId: alice, orgId: A, claimId: 'uberMensch' },
    ],
    slates: [
      {
        _id: 'slateA1', shareId: 'aaaa000001', userId: alice, orgId: A, isTemplate: true, revision: 7,
        options: { id: 'slateA1', name: 'Roadmap', isPublic: true, isPrivate: false, isUnlisted: false, isTemplate: true, templateApproved: true },
        nodes: [
          { options: { id: 'n1', text: 'Ship it', image: `${CLOUD}/${aliceFile}` } },
          { options: { id: 'n2', text: 'See notes', link: `${APP}/canvas/aaaa000002` } },
        ],
        creative: { model: board, revision: 3 },
      },
      {
        _id: 'slateA2', shareId: 'aaaa000002', userId: bob, orgId: A,
        options: { id: 'slateA2', name: 'Notes', isPrivate: true },
        nodes: [{ options: { id: 'n3', text: 'Borrowed picture', image: `${CLOUD}/${carolFile}` } }],
      },
      {
        _id: 'slateB1', shareId: 'bbbb000001', userId: carol, orgId: B,
        options: { id: 'slateB1', name: 'Beta secret plans', isPrivate: true },
        nodes: [{ options: { id: 'n9', text: 'Beta only', image: `${CLOUD}/${carolFile}` } }],
      },
    ],
    snapshots: [
      { _id: 'v1', slateId: 'slateA1', userId: alice, snapshot: JSON.stringify({ image: `${CLOUD}/${aliceFile}` }), created: new Date(1000) },
      { _id: 'v2', slateId: 'slateB1', userId: carol, snapshot: 'beta version', created: new Date(1000) },
    ],
    events: [{ _id: 'slateA1:7', slateId: 'slateA1', revision: 7, at: Date.now() }],
    comments: [
      { _id: 'c1', slateId: 'slateA1', nodeId: 'n1', text: 'Looks good', createdByUserId: bob, mentionedTeamMembers: [alice], resolved: false },
      { _id: 'c2', slateId: 'slateB1', nodeId: 'n9', text: 'Beta secret comment', createdByUserId: carol },
    ],
    presentations: [{ _id: 'pr1', slateShareId: 'aaaa000001', userId: alice, orgId: A, isPublic: true, isPublished: true, name: 'Roadmap talk' }],
    presentationChats: [{ _id: 'pc1', slateShareId: 'aaaa000001', userId: alice, prompt: { role: 'user', content: 'make a deck' } }],
    slateAccess: [
      { _id: 'g1', slateId: 'slateA1', type: 'public', slateAccessPermissionId: 'READ', accessKey: 'LINKKEYSECRET1' },
      { _id: 'g2', slateId: 'slateA2', type: 'private', userId: alice, slateAccessPermissionId: 'EDIT', accessKey: 'LINKKEYSECRET2' },
      { _id: 'g3', slateId: 'slateB1', type: 'private', userId: carol, slateAccessPermissionId: 'EDIT', accessKey: 'LINKKEYSECRET3' },
    ],
    orgSettings: [{ _id: 's1', orgId: A, type: 'branding', primary: '#123456' }],
    providerKeys: [
      { _id: 'k1', ownerType: 'org', ownerId: A, provider: 'openai-compatible', name: 'ours', baseUrl: 'https://llm.example.com/v1', model: 'm1', cipher: 'CIPHERSECRET', last4: 'abcd' },
      { _id: 'k2', ownerType: 'org', ownerId: A, provider: 'openai-compatible', name: 'office', baseUrl: 'https://10.0.0.5/v1', cipher: 'CIPHERSECRET' },
      { _id: 'k3', ownerType: 'org', ownerId: B, provider: 'deepinfra', name: 'beta-key', cipher: 'CIPHERSECRET' },
    ],
    aiChoices: [{ _id: 'org:' + A, use: { chat: 'team:ours', generation: 'team:office', vision: 'builtin' } }],
    apiTokens: [
      { _id: 't1', userId: alice, name: 'CI bot', prefix: 'abcd1234', tokenHash: 'TOKENHASHSECRET', scopes: ['slates:read'], createdAt: 5, revokedAt: null },
      { _id: 't2', userId: alice, name: 'old', tokenHash: 'TOKENHASHSECRET', scopes: ['slates:read'], createdAt: 4, revokedAt: 6 },
    ],
  }
  for (const [name, list] of Object.entries(rows)) for (const row of list) db[name].rows.set(row._id, structuredClone(row))
  return { db, files, A, B, alice, bob, carol, root, aliceFile, carolFile }
}

function exporterFor(world) {
  return createTeamExporter({ db: world.db, cloudUrl: CLOUD, readFile: async (key) => world.files.get(key) ?? null })
}

function importerFor(world, overrides = {}) {
  let n = 0
  let share = 0
  return createTeamImporter({
    db: world.db,
    newId: () => 'N' + String(++n).padStart(16, '0'),
    newShareId: async () => 'f' + String(++share).padStart(9, '0'),
    newAccessKey: async () => 'k' + String(++share).padStart(9, '0'),
    createSlate: (row) => world.db.slates.insertOne({ ...row, revision: 1 }),
    classifyFile: (bytes, ext) => classifyUpload(bytes, 'file.' + ext),
    async storeFile({ body, ext, ownerUserId }) {
      const key = `2026/11/22/u_${ownerUserId}_${'S' + String(++n).padStart(16, '0')}.${ext}`
      world.files.set(key, body)
      return { url: `${CLOUD}/${key}`, key }
    },
    deleteFile: async (key) => world.files.delete(key),
    validateBoard: validateWorkshop,
    teamClaims: CLAIMS,
    aiProviders: ['openai-compatible', 'deepinfra', 'anthropic'],
    ...overrides,
  })
}

async function collect(stream) {
  const parts = []
  for await (const part of stream) parts.push(part)
  return Buffer.concat(parts)
}

async function exportBytes(world, orgId, options = {}) {
  const skipped = []
  const bytes = await collect(
    writeArchive(exporterFor(world).records(orgId, { skipped }), { head: { createdAt: 'now', source: { instance: APP, team: 'x' } }, ...options })
  )
  return { bytes, skipped }
}

async function* from(bytes, size = 4096) {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size)
}

async function lines(bytes, options) {
  const out = []
  const reader = readArchive(from(bytes), options)
  for (;;) {
    const next = await reader.next()
    if (next.done) return { records: out, verified: next.value }
    out.push(next.value)
  }
}

const signer = () => {
  const pair = generateKeyPairSync('ed25519')
  return { privateKey: pair.privateKey, publicKey: pair.publicKey }
}

test('an archive reads back line for line, plain or encrypted, and is signed', async () => {
  const world = seed()
  const key = signer()
  const plain = await exportBytes(world, world.A, { signer: key })
  const sealed = await exportBytes(world, world.A, { signer: key, passphrase: 'correct horse battery staple', logN: 14 })
  assert.equal(sealed.bytes.subarray(0, 7).toString('latin1'), 'SBXTEAM')
  const a = await lines(plain.bytes)
  const b = await lines(sealed.bytes, { passphrase: 'correct horse battery staple' })
  assert.equal(a.records[0].t, 'head')
  assert.equal(a.records[0].format, 'slatebox-team-export')
  assert.equal(a.records[0].version, 2)
  assert.deepEqual(a.records.slice(1), b.records.slice(1))
  assert.ok(a.verified.signer.fingerprint)
  assert.equal(a.verified.signer.fingerprint, b.verified.signer.fingerprint)
  // The encrypted archive says nothing readable about the team.
  for (const word of ['Roadmap', 'Acme', 'alice@acme.test']) assert.equal(sealed.bytes.includes(word), false)
})

test('a wrong passphrase, a changed byte, a cut-off end and a changed line are each refused', async () => {
  const world = seed()
  const sealed = (await exportBytes(world, world.A, { passphrase: 'correct horse battery staple', logN: 14 })).bytes
  await assert.rejects(lines(sealed), { code: 'passphrase_required' })
  await assert.rejects(lines(sealed, { passphrase: 'wrong horse battery staple' }), { code: 'passphrase_wrong' })
  const flipped = Buffer.from(sealed)
  flipped[flipped.length - 40] ^= 1
  await assert.rejects(lines(flipped, { passphrase: 'correct horse battery staple' }), { code: 'corrupt' })
  await assert.rejects(lines(sealed.subarray(0, sealed.length - 30), { passphrase: 'correct horse battery staple' }), (error) => ['truncated', 'corrupt'].includes(error.code))

  const plain = (await exportBytes(world, world.A, { signer: signer() })).bytes
  const text = gunzipSync(plain).toString('utf8')
  // A line changed and gzipped again: the digest no longer matches.
  await assert.rejects(lines(gzipSync(Buffer.from(text.replace('Roadmap', 'Roadmop')))), { code: 'digest_mismatch' })
  // Its end line dropped: the archive ends early.
  await assert.rejects(lines(gzipSync(Buffer.from(text.split('\n').slice(0, -2).join('\n') + '\n'))), { code: 'truncated' })
  // A digest recomputed by someone without the key: the signature no longer matches.
  const all = text.trim().split('\n')
  const end = JSON.parse(all.at(-1))
  const body = all.slice(0, -1).map((line) => line.replace('Roadmap', 'Roadmop'))
  const { createHash } = await import('node:crypto')
  const digest = createHash('sha256')
  for (const line of body) digest.update(line + '\n')
  end.digest = digest.digest('hex')
  await assert.rejects(lines(gzipSync(Buffer.from([...body, JSON.stringify(end)].join('\n') + '\n'))), { code: 'signature_invalid' })
  // Not an archive at all.
  await assert.rejects(lines(Buffer.from('hello world, this is not an archive at all')), { code: 'format_unknown' })
})

test('the reader keeps to its limits: a gzip that expands too far and an over-long line are refused', async () => {
  const bomb = gzipSync(Buffer.alloc(5 * 1024 * 1024, 0x61))
  await assert.rejects(lines(bomb, { limits: { ...LIMITS, totalBytes: 1024 * 1024 } }), { code: 'too_large' })
  const head = JSON.stringify({ t: 'head', format: 'slatebox-team-export', version: 2 })
  await assert.rejects(lines(gzipSync(Buffer.from(head + '\n' + 'x'.repeat(300000))), { limits: { ...LIMITS, lineBytes: 100000 } }), { code: 'too_large' })
  await assert.rejects(lines(gzipSync(Buffer.from(JSON.stringify({ t: 'head', format: 'slatebox-team-export', version: 3 }) + '\n'))), { code: 'version_unknown' })
  // A newer archive than this server reads: update this server. Older than it reads: export again.
  await assert.rejects(lines(gzipSync(Buffer.from(JSON.stringify({ t: 'head', format: 'slatebox-team-export', version: 3 }) + '\n'))), { message: /Update this server to the latest Slatebox, then import it again/ })
  await assert.rejects(lines(gzipSync(Buffer.from(JSON.stringify({ t: 'head', format: 'slatebox-team-export', version: 1 }) + '\n'))), { code: 'version_too_old', message: /Export it again from an up-to-date server/ })
})

test('an export holds everything the team owns and no secret', async () => {
  const world = seed()
  const { bytes, skipped } = await exportBytes(world, world.A)
  const text = gunzipSync(bytes).toString('utf8')
  for (const secret of SECRETS) assert.equal(text.includes(secret), false, `the export holds ${secret}`)
  for (const field of ['"services"', '"tokenHash"', '"cipher"', '"accessKey"', '"bcrypt"', '"hashedToken"', '"loginTokens"', '"prefix"', '"stripeCustomerId"'])
    assert.equal(text.includes(field), false, `the export has a ${field} field`)
  const { records } = await lines(bytes)
  const of = (section) => records.filter((record) => record.t === 'doc' && record.s === section).map((record) => record.d)
  assert.deepEqual(of('team'), [{ _id: world.A, name: 'Acme', createdOn: 1 }])
  assert.deepEqual(of('members').map((m) => [m.email, m.owner, m.roles]), [['alice@acme.test', true, ['admin']], ['bob@acme.test', false, ['canViewUsers']]])
  assert.deepEqual(of('slates').map((s) => s.options.name), ['Roadmap', 'Notes'])
  assert.equal(of('versions').length, 1)
  assert.equal(of('events').length, 1)
  assert.deepEqual(of('comments').map((c) => c.text), ['Looks good'])
  assert.equal(of('presentations').length, 1)
  assert.equal(of('presentationChats').length, 1)
  assert.deepEqual(of('links').map((l) => [l.slateId, l.type, l.userId, l.role]), [['slateA1', 'public', null, 'READ'], ['slateA2', 'private', world.alice, 'EDIT']])
  assert.equal(of('settings')[0].primary, '#123456')
  assert.deepEqual(of('ai')[0].connections, [
    { name: 'ours', provider: 'openai-compatible', baseUrl: 'https://llm.example.com/v1', model: 'm1', hadKey: true },
    { name: 'office', provider: 'openai-compatible', baseUrl: 'https://10.0.0.5/v1', hadKey: true },
  ])
  assert.deepEqual(of('tokens').map((t) => [t.name, t.scopes, t.revoked]), [['CI bot', ['slates:read'], false], ['old', ['slates:read'], true]])
  const fileRecords = records.filter((record) => record.t === 'file')
  assert.equal(fileRecords.length, 1)
  assert.equal(fileRecords[0].d.size, PNG.length)
  // The board and its rules travel as they are; the slate carries its content hash.
  const roadmap = records.find((record) => record.s === 'slates' && record.d.options.name === 'Roadmap')
  assert.equal(roadmap.d.creative.model.behaviour.rules[0].on, true)
  assert.match(roadmap.h, /^[0-9a-f]{64}$/)
  assert.deepEqual(skipped, [{ s: 'files', id: `${CLOUD}/${world.carolFile}`, reason: 'another_team' }])
  // The sections come in the order the format lists.
  const order = records.filter((record) => record.t === 'doc').map((record) => record.s)
  assert.deepEqual([...new Set(order)], ['team', 'members', 'index', 'slates', 'versions', 'events', 'comments', 'presentations', 'presentationChats', 'links', 'settings', 'ai', 'tokens'])
})

test('isolation: one team\'s export never holds another team\'s slates, comments, files, people or keys', async () => {
  const world = seed()
  for (const [orgId, own, other] of [
    [world.A, ['Roadmap', 'Looks good', 'alice@acme.test'], ['Beta secret plans', 'Beta secret comment', 'carol@beta.test', 'slateB1', 'beta-key', 'beta version']],
    [world.B, ['Beta secret plans', 'Beta secret comment', 'carol@beta.test'], ['Roadmap', 'Looks good', 'alice@acme.test', 'slateA1', 'bob@acme.test', 'CI bot', '#123456']],
  ]) {
    const { bytes } = await exportBytes(world, orgId)
    const text = gunzipSync(bytes).toString('utf8')
    for (const word of own) assert.ok(text.includes(word), `${orgId} export lacks ${word}`)
    for (const word of other) assert.equal(text.includes(word), false, `${orgId} export holds ${word}`)
  }
  // Beta's own file is exported for Beta, and its bytes never appear in Acme's.
  const beta = await lines((await exportBytes(world, world.B)).bytes)
  assert.equal(beta.records.filter((record) => record.t === 'file').length, 1)
  const { createHash } = await import('node:crypto')
  const acme = await lines((await exportBytes(world, world.A)).bytes)
  assert.deepEqual(acme.records.filter((record) => record.t === 'file').map((record) => record.d.sha256), [createHash('sha256').update(PNG).digest('hex')])
  assert.notEqual(createHash('sha256').update(world.files.get(world.carolFile)).digest('hex'), createHash('sha256').update(PNG).digest('hex'))
  // A team that does not exist exports nothing.
  assert.equal(await exporterFor(world).preflight('nope'), null)
})

test('the round trip: an export imports as a new hidden team with new ids, private slates, rules off and no secrets', async () => {
  const world = seed()
  const { bytes } = await exportBytes(world, world.A, { passphrase: 'correct horse battery staple', logN: 14, signer: signer() })
  const exported = await lines(bytes, { passphrase: 'correct horse battery staple' })
  const before = structuredClone(world.db.slates.docs())
  const importer = importerFor(world)
  const { importId, report, state } = await importer.importArchive(readArchive(from(bytes), { passphrase: 'correct horse battery staple' }), { actorUserId: world.root })
  assert.equal(state, 'pending')
  const team = world.db.organizations.docs().find((org) => org.teamImportId === importId)
  assert.ok(team.hidden)
  assert.notEqual(team._id, world.A)
  assert.equal(team.name, 'Acme')
  assert.equal(report.team.name, 'Acme')
  assert.equal(report.source.signerKnown, false)
  assert.ok(report.source.signer)

  // Every source id is new; nothing of Acme or Beta changed.
  const imported = world.db.slates.docs().filter((slate) => slate.teamImportId === importId)
  assert.equal(imported.length, 2)
  for (const slate of imported) {
    assert.ok(!['slateA1', 'slateA2', 'slateB1'].includes(slate._id))
    assert.ok(!['aaaa000001', 'aaaa000002'].includes(slate.shareId))
    assert.equal(slate.orgId, team._id)
    assert.equal(slate.options.id, slate._id)
    assert.deepEqual([slate.options.isPrivate, slate.options.isPublic, slate.options.isUnlisted], [true, false, false])
    assert.equal(slate.isTemplate, undefined)
    assert.equal(slate.options.isTemplate, undefined)
    assert.equal(slate.options.templateApproved, undefined)
  }
  for (const original of before) assert.deepEqual(world.db.slates.docs().find((slate) => slate._id === original._id), original)

  // People are placeholders: no sign-in, no address an account is found by, the team's roles only.
  const people = world.db.users.docs().filter((user) => user.teamImportId === importId)
  assert.deepEqual(people.map((p) => [p.profile.firstName, p.emails, p.services, p.isOrgOwner]), [['Alice', [], undefined, true], ['Bob', [], undefined, false]])
  const roles = world.db.permissions.docs().filter((row) => row.teamImportId === importId)
  assert.deepEqual(roles.map((row) => [row.claimId, row.orgId]).sort(), [['admin', team._id], ['canViewUsers', team._id]])
  assert.equal(team.createdByUserId, people.find((p) => p.isOrgOwner)._id)

  // Content survives: equal hashes, the picture stored anew and pointed at, the slate link rewritten.
  const roadmap = imported.find((slate) => slate.options.name === 'Roadmap')
  const notes = imported.find((slate) => slate.options.name === 'Notes')
  const newPicture = roadmap.nodes[0].options.image
  assert.notEqual(newPicture, `${CLOUD}/${world.aliceFile}`)
  assert.ok(world.files.get(newPicture.slice(CLOUD.length + 1)).equals(PNG))
  assert.ok(newPicture.includes(`/u_${roadmap.userId}_`))
  assert.equal(roadmap.nodes[1].options.link, `${APP}/canvas/${notes.shareId}`)
  assert.equal(notes.nodes[0].options.image, `${CLOUD}/${world.carolFile}`, 'another team\'s picture keeps its address')
  assert.equal(roadmap.userId, people.find((p) => p.profile.firstName === 'Alice')._id)
  assert.equal(notes.userId, people.find((p) => p.profile.firstName === 'Bob')._id)
  const sha = (await import('node:crypto')).createHash('sha256').update(PNG).digest('hex')
  const names = (url) => (url === newPicture ? 'sbx-file:' + sha : url)
  const sent = exported.records.find((record) => record.s === 'slates' && record.d.options.name === 'Roadmap')
  // The rules were switched off on arrival: with them on again the content is what was sent.
  const rulesOn = structuredClone(roadmap)
  for (const rule of rulesOn.creative.model.behaviour.rules) rule.on = true
  assert.equal(contentHash(rulesOn, names), sent.h)
  assert.deepEqual(roadmap.creative.model.behaviour.rules.map((rule) => rule.on), [false])
  assert.equal(report.rulesSwitchedOff, 1)
  assert.deepEqual(report.slates.map((s) => s.contentHash).sort(), exported.records.filter((r) => r.s === 'slates').map((r) => r.h).sort())

  // What hangs off the slates follows them.
  const comment = world.db.comments.docs().find((row) => row.teamImportId === importId)
  assert.equal(comment.slateId, roadmap._id)
  assert.equal(comment.createdByUserId, notes.userId)
  assert.deepEqual(comment.mentionedTeamMembers, [roadmap.userId])
  const version = world.db.snapshots.docs().find((row) => row.teamImportId === importId)
  assert.equal(version.slateId, roadmap._id)
  assert.ok(version.snapshot.includes(newPicture))
  const presentation = world.db.presentations.docs().find((row) => row.teamImportId === importId)
  assert.deepEqual([presentation.slateShareId, presentation.isPublic, presentation.isPublished, presentation.orgId], [roadmap.shareId, false, false, team._id])
  const grants = world.db.slateAccess.docs().filter((row) => row.teamImportId === importId)
  assert.equal(grants.length, 2)
  for (const grant of grants) assert.ok(!String(grant.accessKey).startsWith('LINKKEY'))
  assert.equal(world.db.orgSettings.docs().find((row) => row.teamImportId === importId).orgId, team._id)

  // AI without keys and only on a public address; tokens listed, never made.
  const keys = world.db.providerKeys.docs().filter((row) => row.teamImportId === importId)
  assert.deepEqual(keys.map((k) => [k.name, k.ownerId, k.cipher]), [['ours', team._id, null]])
  assert.deepEqual(report.ai.skipped, [{ name: 'office', reason: 'not_public' }])
  assert.deepEqual(world.db.aiChoices.docs().find((row) => row.teamImportId === importId).use, { chat: 'team:ours', vision: 'builtin' })
  assert.deepEqual(report.tokens, [{ person: 'Alice A', name: 'CI bot', scopes: ['slates:read'] }])
  assert.equal(world.db.apiTokens.docs().length, 2)
  assert.equal(report.sections.events.skipped, 1)

  // Nothing secret anywhere the import wrote.
  const written = JSON.stringify(Object.fromEntries(Object.entries(world.db).map(([name, c]) => [name, c.docs().filter((row) => row.teamImportId === importId)])))
  for (const secret of SECRETS) assert.equal(written.includes(secret), false)
  // The report never carries a source id back.
  assert.equal(JSON.stringify(report).includes(world.alice), false)
})

test('confirm makes the team live and gives slates back their visibility; discard removes everything the import wrote', async () => {
  const world = seed()
  const { bytes } = await exportBytes(world, world.A)
  const sent = []
  const importer = importerFor(world, { invite: async (user) => (sent.push(user.importPlaceholder.email), user.importPlaceholder.email === 'bob@acme.test' ? 'needs_consent' : 'sent') })
  const first = await importer.importArchive(readArchive(from(bytes)), { actorUserId: world.root })
  const second = await importer.importArchive(readArchive(from(bytes)), { actorUserId: world.root })
  assert.notEqual(first.importId, second.importId)
  const filesBefore = world.files.size

  const confirmed = await importer.confirm(first.importId, { invite: true })
  assert.deepEqual(confirmed.invited, { sent: 1, needsConsent: ['bob@acme.test'], mailDisabled: 0, unverified: [] })
  const team = world.db.organizations.docs().find((org) => org._id === confirmed.teamId)
  assert.equal(team.hidden, undefined)
  const roadmap = world.db.slates.docs().find((slate) => slate.teamImportId === first.importId && slate.options.name === 'Roadmap')
  assert.deepEqual([roadmap.options.isPublic, roadmap.options.isPrivate], [true, false])
  assert.equal(world.db.presentations.docs().find((row) => row.teamImportId === first.importId).isPublished, true)
  await assert.rejects(importer.confirm(first.importId), { code: 'not_pending' })
  await assert.rejects(importer.discard(first.importId), { code: 'not_pending' })

  await importer.discard(second.importId)
  for (const [name, collection] of Object.entries(world.db))
    if (name !== 'imports') assert.equal(collection.docs().filter((row) => row.teamImportId === second.importId || row.importId === second.importId).length, 0, name)
  assert.equal(world.files.size, filesBefore - 1, 'the discarded import\'s stored file is deleted')
  assert.equal((await importer.get(second.importId)).state, 'discarded')
  // The confirmed one is untouched.
  assert.equal(world.db.slates.docs().filter((slate) => slate.teamImportId === first.importId).length, 2)
  await assert.rejects(importer.discard('nope'), { code: 'not_found' })
})

test('an imported version names the new slate and its share link, never the source\'s', async () => {
  const world = seed()
  const source = world.db.slates.docs().find((slate) => slate._id === 'slateA1')
  // A version is the whole slate as it was, kept as one JSON string.
  world.db.snapshots.rows.set('v3', { _id: 'v3', slateId: 'slateA1', userId: world.alice, snapshot: JSON.stringify(source), created: new Date(2000) })
  const { bytes } = await exportBytes(world, world.A)
  const importer = importerFor(world)
  const { importId } = await importer.importArchive(readArchive(from(bytes)), { actorUserId: world.root })
  const roadmap = world.db.slates.docs().find((slate) => slate.teamImportId === importId && slate.options.name === 'Roadmap')
  const versions = world.db.snapshots.docs().filter((row) => row.teamImportId === importId)
  assert.equal(versions.length, 2)
  const whole = JSON.parse(versions.find((row) => row.snapshot.includes('"nodes"')).snapshot)
  assert.equal(whole.options.id, roadmap._id)
  assert.equal(whole.shareId, roadmap.shareId)
  assert.equal(whole._id, roadmap._id)
  assert.equal(whole.userId, roadmap.userId)
  assert.notEqual(whole.orgId, world.A)
  // The ids and links inside it are rewritten like the slate's own.
  assert.equal(whole.nodes[1].options.link, roadmap.nodes[1].options.link)
  assert.equal(whole.nodes[0].options.image, roadmap.nodes[0].options.image)
  for (const sourceId of ['slateA1', 'aaaa000001', 'aaaa000002', world.alice, world.A]) assert.equal(versions.some((row) => row.snapshot.includes(sourceId)), false, sourceId)
  // A version that is not JSON keeps its text.
  const crafted = await craft([
    { t: 'doc', s: 'team', d: { name: 'T' } },
    { t: 'doc', s: 'index', d: { slates: [{ id: 's1', shareId: 'share00001' }] } },
    { t: 'doc', s: 'slates', d: { _id: 's1', shareId: 'share00001', options: { name: 'One' }, nodes: [] } },
    { t: 'doc', s: 'versions', d: { _id: 'v1', slateId: 's1', snapshot: 'plain words' } },
  ])
  const second = await importer.importArchive(readArchive(from(crafted)), { actorUserId: world.root })
  assert.equal(world.db.snapshots.docs().find((row) => row.teamImportId === second.importId).snapshot, 'plain words')
})

test('inviting imported people: any letter case of an existing address needs consent, and unverified addresses wait for the administrator', async () => {
  const world = seed()
  // Alice's account here is stored with capitals; the archive lowercases every address.
  world.db.users.rows.get(world.alice).emails = [{ address: 'Alice@Acme.test', verified: true }]
  const { bytes } = await exportBytes(world, world.A)
  const mails = []
  let mail = true
  const invite = createPlaceholderInvite({ users: world.db.users, mailAvailable: () => mail, sendEnrollment: async (userId, email) => mails.push([userId, email]) })
  const importer = importerFor(world, { invite })
  const { importId } = await importer.importArchive(readArchive(from(bytes)), { actorUserId: world.root })
  // As if the archive came from another server: Bob has no account here.
  world.db.users.rows.get(world.bob).emails = [{ address: 'robert@elsewhere.test', verified: true }]
  const placeholders = world.db.users.docs().filter((user) => user.teamImportId === importId)
  const placeholderOf = (email) => placeholders.find((user) => user.importPlaceholder.email === email)
  assert.equal(placeholderOf('alice@acme.test').importPlaceholder.emailVerified, true)
  assert.equal(placeholderOf('bob@acme.test').importPlaceholder.emailVerified, false)

  const confirmed = await importer.confirm(importId, { invite: true })
  assert.deepEqual(confirmed.invited, { sent: 0, needsConsent: ['alice@acme.test'], mailDisabled: 0, unverified: ['bob@acme.test'] })
  assert.deepEqual(mails, [])
  // Nobody was given an address: Alice's account stays the only one with hers, in any case.
  for (const user of world.db.users.docs().filter((row) => row.teamImportId === importId)) assert.deepEqual(user.emails, [])
  assert.equal(world.db.users.docs().filter((user) => (user.emails || []).some((e) => e.address.toLowerCase() === 'alice@acme.test')).length, 1)
  assert.equal((await importer.get(importId)).invited.unverified[0], 'bob@acme.test')

  // The administrator checked Bob's address: only then is he invited.
  await assert.rejects(importer.inviteAddress(importId, 'nobody@acme.test'), { code: 'person_not_found' })
  mail = false
  assert.equal((await importer.inviteAddress(importId, 'bob@acme.test')).outcome, 'mail_disabled')
  assert.deepEqual((await importer.get(importId)).invited.unverified, ['bob@acme.test'])
  mail = true
  const sent = await importer.inviteAddress(importId, ' BOB@acme.test ')
  assert.deepEqual(sent, { importId, email: 'bob@acme.test', outcome: 'sent' })
  const bob = placeholderOf('bob@acme.test')
  assert.deepEqual(mails, [[bob._id, 'bob@acme.test']])
  assert.deepEqual(world.db.users.docs().find((user) => user._id === bob._id).emails, [{ address: 'bob@acme.test', verified: false }])
  const record = await importer.get(importId)
  assert.deepEqual([record.invited.sent, record.invited.unverified], [1, []])
  assert.equal((await importer.inviteAddress(importId, 'bob@acme.test')).outcome, 'already_invited')
  assert.equal(mails.length, 1)

  // A pending import invites no one.
  const pending = await importer.importArchive(readArchive(from(bytes)), { actorUserId: world.root })
  await assert.rejects(importer.inviteAddress(pending.importId, 'bob@acme.test'), { code: 'not_confirmed' })
})

test('an address another account takes between the check and the write is given back', async () => {
  const world = seed()
  const placeholder = { _id: 'P0000000000000001', orgId: 'x', emails: [], importPlaceholder: { importId: 'i', email: 'dana@acme.test', emailVerified: true } }
  world.db.users.rows.set(placeholder._id, structuredClone(placeholder))
  const mails = []
  const users = {
    ...world.db.users,
    // The other account arrives while the placeholder's address is written.
    async updateOne(selector, update) {
      const result = await world.db.users.updateOne(selector, update)
      if (update.$set?.emails?.length) world.db.users.rows.set('other', { _id: 'other', emails: [{ address: 'DANA@acme.test', verified: false }] })
      return result
    },
  }
  const invite = createPlaceholderInvite({ users, mailAvailable: () => true, sendEnrollment: async (...args) => mails.push(args) })
  assert.equal(await invite(placeholder), 'needs_consent')
  assert.deepEqual(world.db.users.rows.get(placeholder._id).emails, [])
  assert.deepEqual(mails, [])
})

test('a pending import nobody confirms is purged after 14 days', async () => {
  const world = seed()
  let clock = Date.parse('2026-11-01T00:00:00Z')
  const importer = importerFor(world, { now: () => clock })
  const { bytes } = await exportBytes(world, world.A)
  const { importId } = await importer.importArchive(readArchive(from(bytes)), { actorUserId: world.root })
  clock += 13 * 86400000
  assert.deepEqual(await importer.purge(), { purged: 0 })
  clock += 2 * 86400000
  assert.deepEqual(await importer.purge(), { purged: 1 })
  assert.equal((await importer.get(importId)).state, 'discarded')
  assert.equal(world.db.slates.docs().filter((slate) => slate.teamImportId === importId).length, 0)
})

// A hand-made archive: what a hostile self-host admin could send.
async function craft(records, options) {
  return collect(writeArchive((async function* () { yield* records })(), { head: { createdAt: 'now', source: { instance: 'https://evil.test' } }, ...options }))
}

test('a hostile archive cannot choose ids, take over documents, smuggle secrets or grant server rights', async () => {
  const world = seed()
  const before = { slates: world.db.slates.docs(), users: world.db.users.docs(), orgs: world.db.organizations.docs(), grants: world.db.slateAccess.docs() }
  const bytes = await craft([
    { t: 'doc', s: 'team', d: { _id: world.B, name: 'Beta' } },
    { t: 'doc', s: 'members', d: { _id: world.carol, email: 'carol@beta.test', firstName: 'Carol', roles: ['admin'], owner: true } },
    { t: 'doc', s: 'members', d: { _id: 'm2', email: 'x@evil.test', firstName: 'Root', roles: ['uberMensch'] } },
    { t: 'doc', s: 'members', d: { _id: 'm3', email: 'y@evil.test', firstName: 'Sneaky', services: { password: { bcrypt: 'x' } } } },
    { t: 'doc', s: 'members', d: { _id: 'm4', email: 'z@evil.test', firstName: 'Dollar', roles: [], $where: 'x' } },
    { t: 'doc', s: 'index', d: { slates: [{ id: 'slateB1', shareId: 'bbbb000001' }, { id: 'slateA1', shareId: 'aaaa000001' }] } },
    { t: 'doc', s: 'slates', d: { _id: 'slateB1', shareId: 'bbbb000001', userId: world.carol, orgId: world.B, options: { name: 'Overwritten?' }, nodes: [] } },
    { t: 'doc', s: 'slates', d: { _id: 'slateA1', shareId: 'aaaa000001', userId: world.alice, orgId: world.A, options: { name: 'Bad keys' }, nodes: [{ $gt: 1 }] } },
    { t: 'doc', s: 'slates', d: { _id: 'slateX', options: { name: 'Not listed' } } },
    { t: 'doc', s: 'comments', d: { _id: 'c2', slateId: 'slateB1', text: 'hi', orgId: world.A, teamImportId: 'someone-else' } },
    { t: 'doc', s: 'links', d: { slateId: 'slateB1', type: 'public', role: 'EDIT', userId: world.alice } },
  ])
  const importer = importerFor(world)
  const { importId, report } = await importer.importArchive(readArchive(from(bytes)), { actorUserId: world.root })
  // Beta's slate, people, team and grants are exactly as they were.
  assert.deepEqual(world.db.slates.docs().filter((s) => !s.teamImportId), before.slates)
  assert.deepEqual(world.db.users.docs().filter((u) => !u.teamImportId), before.users)
  assert.deepEqual(world.db.organizations.docs().filter((o) => !o.teamImportId), before.orgs)
  assert.deepEqual(world.db.slateAccess.docs().filter((g) => !g.teamImportId), before.grants)
  const made = world.db.slates.docs().filter((slate) => slate.teamImportId === importId)
  assert.deepEqual(made.map((s) => s.options.name), ['Overwritten?'])
  assert.notEqual(made[0]._id, 'slateB1')
  assert.notEqual(made[0].shareId, 'bbbb000001')
  const reasons = Object.fromEntries(report.skipped.map((row) => [row.id, row.reason]))
  assert.equal(reasons.m2, 'role_refused')
  assert.equal(reasons.m3, 'carries_secrets')
  assert.equal(reasons.m4, 'unexpected_fields')
  assert.equal(reasons.slateA1, 'unsafe_keys')
  assert.equal(reasons.slateX, 'not_listed')
  // No server-wide claim, no claim outside the new team.
  const claims = world.db.permissions.docs().filter((row) => row.teamImportId === importId)
  assert.deepEqual(claims.map((row) => row.claimId), ['admin'])
  assert.ok(claims.every((row) => row.orgId === made[0].orgId))
  // The comment belongs to the import, not to whoever it named.
  const comment = world.db.comments.docs().find((row) => row.teamImportId === importId)
  assert.equal(comment.orgId, undefined)
  assert.equal(comment.slateId, made[0]._id)
  // A grant for a person the archive did not bring is dropped, never given to a person here.
  assert.equal(world.db.slateAccess.docs().filter((row) => row.teamImportId === importId).length, 0)
  // The report says nothing about whether an id it named exists here.
  assert.equal(JSON.stringify(report).includes('exists'), false)
})

test('an archive out of order, without its team or with a damaged file is refused and leaves nothing behind', async () => {
  const world = seed()
  const count = () => Object.entries(world.db).filter(([name]) => name !== 'imports').reduce((sum, [, c]) => sum + c.docs().length, 0)
  const start = count()
  const files = world.files.size
  const cases = [
    [[{ t: 'doc', s: 'members', d: { _id: 'm1', firstName: 'A' } }], 'team_missing'],
    [[{ t: 'doc', s: 'team', d: { name: 'T' } }, { t: 'doc', s: 'index', d: { slates: [] } }, { t: 'doc', s: 'members', d: { _id: 'm1' } }], 'out_of_order'],
    [[{ t: 'doc', s: 'team', d: { name: 'T' } }, { t: 'doc', s: 'nonsense', d: {} }], 'section_unknown'],
    [[{ t: 'doc', s: 'team', d: { name: 'T' } }, { t: 'file', d: { id: 'a'.repeat(32), url: 'https://x.test/a.png', ext: 'png', size: PNG.length, sha256: 'b'.repeat(64) } }, { t: 'chunk', id: 'a'.repeat(32), data: PNG.toString('base64') }], 'corrupt'],
    [[{ t: 'doc', s: 'team', d: { name: 'T' } }, { t: 'file', d: { id: 'a'.repeat(32), url: 'https://x.test/a.png', ext: 'png', size: 10, sha256: 'b'.repeat(64) } }], 'corrupt'],
  ]
  const importer = importerFor(world)
  for (const [records, code] of cases) {
    const bytes = await craft(records)
    await assert.rejects(importer.importArchive(readArchive(from(bytes)), { actorUserId: world.root }), { code })
  }
  assert.equal(count(), start)
  assert.equal(world.files.size, files)
  assert.ok(world.db.imports.docs().every((row) => row.state === 'failed'))
  // A file the archive says is a picture but is not one is skipped, never stored.
  const sha = (await import('node:crypto')).createHash('sha256').update(Buffer.from('<html><script>x</script>')).digest('hex')
  const bad = await craft([
    { t: 'doc', s: 'team', d: { name: 'T' } },
    { t: 'file', d: { id: sha.slice(0, 32), url: 'https://x.test/a.png', ext: 'png', size: 24, sha256: sha } },
    { t: 'chunk', id: sha.slice(0, 32), data: Buffer.from('<html><script>x</script>').toString('base64') },
  ])
  const { report } = await importer.importArchive(readArchive(from(bad)), { actorUserId: world.root })
  assert.equal(report.skipped[0].reason, 'not_allowed_kind')
  assert.equal(world.files.size, files)
})

test('AI addresses on a private network are not public endpoints', () => {
  for (const url of ['https://api.openai.com/v1', 'https://llm.example.com']) assert.equal(isPublicEndpoint(url), true, url)
  for (const url of ['http://api.openai.com', 'https://localhost:8080', 'https://10.1.2.3', 'https://192.168.1.4/v1', 'https://172.20.0.1', 'https://169.254.169.254', 'https://ollama.local', 'https://gpu.internal', 'https://gpubox', 'https://[::1]/', 'https://user:pw@api.example.com', 'not a url'])
    assert.equal(isPublicEndpoint(url), false, url)
})

// ---- the one-time addresses, who may use them, and the actions ------------------------------

function transferWorld() {
  const world = seed()
  const key = signer()
  const isServerAdmin = async (userId) => world.db.permissions.docs().some((row) => row.userId === userId && row.claimId === 'uberMensch')
  let clock = Date.parse('2026-11-22T00:00:00Z')
  const transfer = createTeamTransfer({
    exporter: exporterFor(world),
    importer: importerFor(world),
    tickets: createTicketStore({ collection: world.db.tickets, now: () => clock }),
    loadUser: (id) => world.db.users.findOne({ _id: id }),
    isTeamAdmin: async (user) => world.db.permissions.docs().some((row) => row.userId === user._id && row.orgId === user.orgId && row.claimId === 'admin'),
    isServerAdmin,
    signer: () => key,
    instance: { origin: APP, name: 'Test' },
    now: () => clock,
  })
  return { ...world, transfer, tick: (ms) => (clock += ms) }
}

test('only a team admin exports, only their own team, once per address and only while it lasts', async () => {
  const w = transferWorld()
  await assert.rejects(w.transfer.startExport(w.bob), { code: 'team_admin_required' })
  await assert.rejects(w.transfer.startExport(w.root), { code: 'no_team' })
  await assert.rejects(w.transfer.startExport('ghost'), { code: 'forbidden' })
  const carol = await w.transfer.startExport(w.carol)
  assert.equal(carol.team.name, 'Beta')
  const alice = await w.transfer.startExport(w.alice)
  assert.deepEqual([alice.team.name, alice.members, alice.slates, alice.method], ['Acme', 2, 2, 'POST'])
  const ticket = alice.downloadUrl.split('/').pop()
  assert.ok(alice.downloadUrl.startsWith(APP + '/team-transfer/export/'))
  // The ticket is stored by its hash only.
  assert.equal(JSON.stringify(w.db.tickets.docs()).includes(ticket), false)
  // An export address is not an import address, and an import address is not an export address.
  await assert.rejects(w.transfer.receiveImport(ticket, from(Buffer.alloc(0))), { code: 'ticket_invalid' })
  const opened = await w.transfer.openExport(ticket, null)
  const text = gunzipSync(await collect(opened.stream)).toString('utf8')
  assert.ok(text.includes('Roadmap'))
  assert.equal(text.includes('Beta secret plans'), false)
  assert.match(opened.filename, /^acme-\d{4}-\d{2}-\d{2}\.sbxteam\.gz$/)
  await assert.rejects(w.transfer.openExport(ticket, null), { code: 'ticket_invalid' })
  // Expired, and a short passphrase.
  const late = (await w.transfer.startExport(w.alice)).downloadUrl.split('/').pop()
  w.tick(16 * 60 * 1000)
  await assert.rejects(w.transfer.openExport(late, null), { code: 'ticket_invalid' })
  const short = (await w.transfer.startExport(w.alice)).downloadUrl.split('/').pop()
  await assert.rejects(w.transfer.openExport(short, 'short'), { code: 'passphrase_invalid' })
  // An admin who moved to another team since asking gets nothing.
  const moved = (await w.transfer.startExport(w.alice)).downloadUrl.split('/').pop()
  await w.db.users.updateOne({ _id: w.alice }, { $set: { orgId: w.B } })
  await assert.rejects(w.transfer.openExport(moved, null), (error) => ['team_admin_required'].includes(error.code))
})

test('only a server administrator imports, lists, reads, confirms or discards', async () => {
  const w = transferWorld()
  for (const person of [w.carol, w.bob]) {
    await assert.rejects(w.transfer.startImport(person), { code: 'admin_required' })
    await assert.rejects(w.transfer.listImports(person), { code: 'admin_required' })
    await assert.rejects(w.transfer.confirmImport(person, 'x'), { code: 'admin_required' })
    await assert.rejects(w.transfer.discardImport(person, 'x'), { code: 'admin_required' })
  }
  const exported = await w.transfer.openExport((await w.transfer.startExport(w.alice)).downloadUrl.split('/').pop(), 'correct horse battery staple')
  const bytes = await collect(exported.stream)
  const start = await w.transfer.startImport(w.root)
  const ticket = start.uploadUrl.split('/').pop()
  const result = await w.transfer.receiveImport(ticket, from(bytes), 'correct horse battery staple')
  assert.equal(result.state, 'pending')
  assert.equal(result.report.source.signerKnown, false)
  await assert.rejects(w.transfer.receiveImport(ticket, from(bytes), 'correct horse battery staple'), { code: 'ticket_invalid' })
  const listed = await w.transfer.listImports(w.root)
  assert.equal(listed.length, 1)
  assert.equal((await w.transfer.getImport(w.root, result.importId)).report.team.name, 'Acme')
  await assert.rejects(w.transfer.getImport(w.carol, result.importId), { code: 'admin_required' })
})

test('the archive routes: download with a passphrase, upload the archive, get the report', async (t) => {
  const w = transferWorld()
  const app = express()
  app.use(express.json())
  mountTeamTransfer(app, w.transfer, { express })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const local = (url) => base + new URL(url).pathname

  const { downloadUrl } = await w.transfer.startExport(w.alice)
  const download = await fetch(local(downloadUrl), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'passphrase=' + encodeURIComponent('correct horse battery staple') })
  assert.equal(download.status, 200)
  assert.equal(download.headers.get('content-type'), 'application/octet-stream')
  assert.match(download.headers.get('content-disposition'), /attachment; filename="acme-.*\.sbxteam"/)
  const archive = Buffer.from(await download.arrayBuffer())
  assert.equal(archive.subarray(0, 7).toString('latin1'), 'SBXTEAM')
  const again = await fetch(local(downloadUrl), { method: 'POST' })
  assert.equal(again.status, 404)
  assert.equal((await again.json()).error.code, 'ticket_invalid')

  const { uploadUrl } = await w.transfer.startImport(w.root)
  const wrongType = await fetch(local(uploadUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  assert.equal(wrongType.status, 415)
  const upload = await fetch(local(uploadUrl), { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'slatebox-export-passphrase': 'correct horse battery staple' }, body: archive })
  assert.equal(upload.status, 201)
  const body = await upload.json()
  assert.equal(body.state, 'pending')
  assert.equal(body.report.team.name, 'Acme')
  assert.equal(body.report.sections.slates.created, 2)

  const { uploadUrl: second } = await w.transfer.startImport(w.root)
  const wrong = await fetch(local(second), { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'slatebox-export-passphrase': 'not the right passphrase' }, body: archive })
  assert.equal(wrong.status, 422)
  assert.equal((await wrong.json()).error.code, 'passphrase_wrong')
})

test('every passphrase the export takes opens its archive through the import route', async (t) => {
  const w = transferWorld()
  const app = express()
  app.use(express.json())
  mountTeamTransfer(app, w.transfer, { express })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const local = (url) => base + new URL(url).pathname
  const exportWith = async (passphrase) => {
    const { downloadUrl } = await w.transfer.startExport(w.alice)
    return fetch(local(downloadUrl), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'passphrase=' + encodeURIComponent(passphrase) })
  }
  const importWith = async (archive, headers) => {
    const { uploadUrl } = await w.transfer.startImport(w.root)
    return fetch(local(uploadUrl), { method: 'POST', headers: { 'content-type': 'application/octet-stream', ...headers }, body: archive })
  }
  const b64 = (text) => Buffer.from(text, 'utf8').toString('base64url')

  // White space at either end would be lost on the way back (a header loses it): refused at export.
  for (const passphrase of ['correct horse battery staple ', ' correct horse battery staple', 'correct horse\tbattery staple']) {
    const refused = await exportWith(passphrase)
    assert.equal(refused.status, 422, JSON.stringify(passphrase))
    assert.equal((await refused.json()).error.code, 'passphrase_invalid')
  }

  // A passphrase that is not ASCII travels base64url-encoded, and NFKC makes the two forms of é one.
  for (const [written, typed] of [
    ['правильная лошадь батарея', 'правильная лошадь батарея'],
    ['café au lait, deux sucres', 'café au lait, deux sucres'],
  ]) {
    const download = await exportWith(written)
    assert.equal(download.status, 200)
    const archive = Buffer.from(await download.arrayBuffer())
    assert.equal(archive.subarray(0, 7).toString('latin1'), 'SBXTEAM')
    const upload = await importWith(archive, { 'slatebox-export-passphrase-base64': b64(typed) })
    assert.equal(upload.status, 201, written)
    assert.equal((await upload.json()).report.team.name, 'Acme')
    const wrong = await importWith(archive, { 'slatebox-export-passphrase-base64': b64(typed + '!') })
    assert.equal((await wrong.json()).error.code, 'passphrase_wrong')
  }

  // A plain ASCII passphrase still works in the plain header, and the export takes the base64 header too.
  const { downloadUrl } = await w.transfer.startExport(w.alice)
  const viaHeader = await fetch(local(downloadUrl), { method: 'POST', headers: { 'slatebox-export-passphrase-base64': b64('zwölf Zeichen und mehr') } })
  assert.equal(viaHeader.status, 200)
  const sealed = Buffer.from(await viaHeader.arrayBuffer())
  assert.equal((await importWith(sealed, { 'slatebox-export-passphrase-base64': b64('zwölf Zeichen und mehr') })).status, 201)
  const ascii = Buffer.from(await (await exportWith('correct horse battery staple')).arrayBuffer())
  assert.equal((await importWith(ascii, { 'slatebox-export-passphrase': 'correct horse battery staple' })).status, 201)

  // A base64 header that is not base64url of UTF-8 is refused.
  for (const bad of ['not base64!', Buffer.from([0xff, 0xfe, 0xfd]).toString('base64url')]) {
    const refused = await importWith(sealed, { 'slatebox-export-passphrase-base64': bad })
    assert.equal(refused.status, 400)
    assert.equal((await refused.json()).error.code, 'passphrase_header_invalid')
  }
})

test('the actions: team admins export, administrators import, a token needs the scope, an agent\'s export waits for a yes', async () => {
  const w = transferWorld()
  const registry = createAppRegistry({ deps: { teamTransfer: w.transfer } })
  const person = (userId) => ({ kind: 'person', userId, tokenId: null, scopes: registry.scopes })
  const agent = (userId, scopes) => ({ kind: 'agent', userId, tokenId: 'tok-' + userId, tokenName: 'Agent', scopes })
  const exported = await registry.run(person(w.alice), 'team.export', {})
  assert.equal(exported.status, 200)
  assert.equal(exported.body.team.name, 'Acme')
  await assert.rejects(registry.run(person(w.bob), 'team.export', {}), { status: 403, code: 'team_admin_required' })
  await assert.rejects(registry.run(agent(w.alice, ['slates:read']), 'team.export', {}), { status: 403, code: 'insufficient_scope' })
  assert.equal((await registry.run(agent(w.alice, ['team:export']), 'team.export', {})).status, 200)
  await assert.rejects(registry.run(person(w.carol), 'teamImports.start', {}), { status: 403, code: 'admin_required' })
  await assert.rejects(registry.run(agent(w.root, ['team:export']), 'teamImports.list', {}), { code: 'insufficient_scope' })
  const started = await registry.run(agent(w.root, ['team:import']), 'teamImports.start', {})
  assert.ok(started.body.uploadUrl.startsWith(APP + '/team-transfer/import/'))
  assert.deepEqual((await registry.run(person(w.root), 'teamImports.list', {})).body, { imports: [] })
  await assert.rejects(registry.run(person(w.root), 'teamImports.get', { importId: 'nope' }), { status: 404, code: 'not_found' })

  const action = registry.get('team.export')
  assert.equal(action.confirm, true)
  assert.equal(registry.get('teamImports.discard').destructive, true)
  assert.equal(registry.get('teamImports.confirm').confirm, true)
  assert.equal(registry.get('teamImports.invite').confirm, true)
  await assert.rejects(registry.run(person(w.carol), 'teamImports.invite', { importId: 'nope', email: 'a@b.test' }), { status: 403, code: 'admin_required' })
  await assert.rejects(registry.run(agent(w.root, ['team:export']), 'teamImports.invite', { importId: 'nope', email: 'a@b.test' }), { code: 'insufficient_scope' })
  await assert.rejects(registry.run(person(w.root), 'teamImports.invite', { importId: 'nope', email: 'a@b.test' }), { status: 404, code: 'not_found' })
  assert.ok(registry.scopes.includes('team:export') && registry.scopes.includes('team:import'))
})
