// The collaboration relay's room token (v2) and who collaborators.init gives one to.
//
// The relay used to take one credential for every room, signed with no room, no expiry and no role,
// and collaborators.init handed it to any connection, signed in or not: a stranger could read and
// write any slate whose id they knew (the room is the slate's options.id). Now:
// - a token names one room, a role and an expiry, signed with a key derived from the API secret;
// - collaborators.init mints one only for a person the canvas would open the slate for, write only
//   for a person the canvas's save would take an edit from, for the room in the server's record;
// - no token, bearer or secret is ever logged.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHmac, hkdfSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { memoryMongo } from './memory-mongo.mjs'
import {
  mintRoomToken, readRoomToken, relayKey, verifyRoomToken, RELAY_TOKEN_TTL_SECONDS,
} from '../web/app/server/common/relay-token.mjs'
import { relayAccess, RELAY_CODES } from '../web/app/server/common/relay-access.mjs'
import { openSlateRole } from '../web/app/server/common/slate-open-role.mjs'
import collaboratorDetails, { relayParams } from '../web/app/server/common/collaborator-details.mjs'

const app = (path) => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')
const keys = { publicKey: 'pk-test', secretKey: 'sk-test-secret' }
const settings = { slateboxAPI: keys, public: { wsUrl: 'ws://relay' } }
const secretFor = (pk) => (pk === keys.publicKey ? keys.secretKey : null)
const NOW = Date.UTC(2026, 10, 26, 12, 0, 0)

// ---------------------------------------------------------------- minting

test('the relay key is HKDF-SHA256 of the API secret, salt slatebox-relay, info room-token-v1, 32 bytes', () => {
  const expected = Buffer.from(hkdfSync('sha256', 'sk-test-secret', 'slatebox-relay', 'room-token-v1', 32))
  assert.deepEqual(relayKey('sk-test-secret'), expected)
  assert.equal(relayKey('sk-test-secret').length, 32)
  assert.notDeepEqual(relayKey('another-secret'), expected)
  assert.throws(() => relayKey(''), TypeError)
})

test('a token is base64url(JSON payload) "." base64url(HMAC-SHA256(relayKey, payload))', () => {
  const { token, exp } = mintRoomToken({ ...keys, room: 'slate-1', role: 'write', now: NOW, nonce: 'n-1' })
  const [payload, signature] = token.split('.')
  assert.match(payload, /^[A-Za-z0-9_-]+$/)
  assert.match(signature, /^[A-Za-z0-9_-]+$/)
  assert.equal(token.split('.').length, 2)
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  assert.deepEqual(claims, { v: 2, pk: 'pk-test', room: 'slate-1', role: 'write', exp, n: 'n-1' })
  const expected = createHmac('sha256', relayKey(keys.secretKey)).update(payload).digest('base64url')
  assert.equal(signature, expected)
  // Never the raw secret as the HMAC key.
  assert.notEqual(signature, createHmac('sha256', keys.secretKey).update(payload).digest('base64url'))
  assert.deepEqual(readRoomToken(token), claims)
})

test('a token runs out 15 minutes after it is made, in unix seconds', () => {
  const { exp } = mintRoomToken({ ...keys, room: 'r', role: 'read', now: NOW })
  assert.equal(RELAY_TOKEN_TTL_SECONDS, 900)
  assert.equal(exp, Math.floor(NOW / 1000) + 900)
  assert.ok(Number.isInteger(exp))
})

test('each token carries its own nonce', () => {
  const one = mintRoomToken({ ...keys, room: 'r', role: 'read', now: NOW })
  const two = mintRoomToken({ ...keys, room: 'r', role: 'read', now: NOW })
  assert.notEqual(readRoomToken(one.token).n, readRoomToken(two.token).n)
  assert.ok(readRoomToken(one.token).n.length >= 16)
})

test('minting refuses a missing room, key pair or role', () => {
  assert.throws(() => mintRoomToken({ ...keys, room: '', role: 'read' }), TypeError)
  assert.throws(() => mintRoomToken({ ...keys, room: 'r', role: 'admin' }), TypeError)
  assert.throws(() => mintRoomToken({ publicKey: 'pk', secretKey: '', room: 'r', role: 'read' }), TypeError)
})

test('the relay check: signature, expiry with 60 s skew, and the room the socket asked for', () => {
  const { token, exp } = mintRoomToken({ ...keys, room: 'slate-1', role: 'read', now: NOW })
  assert.equal(verifyRoomToken(token, { room: 'slate-1', secretFor, now: NOW })?.role, 'read')
  assert.equal(verifyRoomToken(token, { room: 'slate-2', secretFor, now: NOW }), null, 'another room')
  assert.ok(verifyRoomToken(token, { room: 'slate-1', secretFor, now: (exp + 59) * 1000 }), 'within the skew')
  assert.equal(verifyRoomToken(token, { room: 'slate-1', secretFor, now: (exp + 61) * 1000 }), null, 'expired')
  assert.equal(verifyRoomToken(token, { room: 'slate-1', secretFor: () => 'wrong', now: NOW }), null, 'another secret')
  // A payload changed to write (or to another room) no longer matches its signature.
  const [payload, signature] = token.split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
  const forged = Buffer.from(JSON.stringify({ ...claims, role: 'write' })).toString('base64url') + '.' + signature
  assert.equal(verifyRoomToken(forged, { room: 'slate-1', secretFor, now: NOW }), null)
  for (const junk of ['', 'a', 'a.b.c', '.', 'x.', 42, null]) assert.equal(verifyRoomToken(junk, { room: 'slate-1', secretFor, now: NOW }), null)
})

// ---------------------------------------------------------------- the access matrix

const OWNER = { _id: 'owner', orgId: 'team-a', emails: [{ address: 'owner@example.com' }] }
const TEAMMATE = { _id: 'mate', orgId: 'team-a', emails: [{ address: 'mate@example.com' }] }
const VIEWER = { _id: 'viewer', orgId: 'team-a', emails: [{ address: 'viewer@example.com' }] }
const STRANGER = { _id: 'stranger', orgId: 'team-z', emails: [{ address: 'x@example.com' }] }
const GUEST_OWNER = { _id: 'guest-owner', isAnonymous: true }

async function world() {
  const slates = memoryMongo()
  const grants = memoryMongo()
  const guestViews = memoryMongo()
  const slate = (id, options, extra = {}) => slates.insertOne({
    _id: id, shareId: 'share-' + id, userId: 'owner', orgId: 'team-a', options: { id, ...options }, nodes: [], ...extra,
  })
  await slate('private', { isPrivate: true })
  await slate('unlisted-read', { isUnlisted: true })
  await slate('unlisted-edit', { isUnlisted: true })
  await slate('public-read', { isPublic: true })
  await slate('public-edit', { isPublic: true })
  await slate('workshop', { isPublic: true }, { creative: { model: { kind: 'workshop' } } })
  await slates.insertOne({ _id: 'guest-own', shareId: 'share-guest-own', userId: 'guest-owner', options: { id: 'guest-own', isPrivate: true }, nodes: [] })
  const grant = (row) => grants.insertOne({ _id: row.accessKey, ...row })
  await grant({ slateId: 'private', type: 'private', userId: 'mate', accessKey: 'key-mate', slateAccessPermissionId: 'EDIT' })
  await grant({ slateId: 'private', type: 'private', userId: 'viewer', accessKey: 'key-viewer', slateAccessPermissionId: 'READ' })
  await grant({ slateId: 'unlisted-read', type: 'unlisted', accessKey: 'key-ur', slateAccessPermissionId: 'READ' })
  await grant({ slateId: 'unlisted-edit', type: 'unlisted', accessKey: 'key-ue', slateAccessPermissionId: 'EDIT' })
  await grant({ slateId: 'public-read', type: 'public', accessKey: 'key-pr', slateAccessPermissionId: 'READ' })
  await grant({ slateId: 'public-edit', type: 'public', accessKey: 'key-pe', slateAccessPermissionId: 'EDIT' })
  await grant({ slateId: 'public-edit', type: 'public', userId: 'viewer', accessKey: 'key-pe-viewer', slateAccessPermissionId: 'COMMENT' })
  await grant({ slateId: 'workshop', type: 'public', accessKey: 'key-w', slateAccessPermissionId: 'EDIT' })
  // A visitor with no account admitted to public-edit an hour ago (organizations.trackGuest).
  await guestViews.insertOne({ _id: 'gv1', guestCollaboratorId: 'visitor-admitted', slateId: 'public-edit', userId: null,
    actualGuest: true, timestamp: Date.now() - 3600000 })
  await guestViews.insertOne({ _id: 'gv2', guestCollaboratorId: 'visitor-admitted', slateId: 'workshop', userId: null,
    actualGuest: true, timestamp: Date.now() - 3600000 })
  const users = new Map([OWNER, TEAMMATE, VIEWER, STRANGER, GUEST_OWNER].map((u) => [u._id, u]))
  return {
    findSlate: (query) => slates.findOne(query),
    findGrant: (query) => grants.findOne(query),
    listGrants: (query) => grants.find(query).toArray(),
    isTeamAdmin: async () => false,
    access: grants,
    guestViews,
    users,
  }
}

// As collaborators.init asks: the canvas's visitor id (`id`) is the guest admission's visitor.
const ask = (stores, who, { id, ...request }) => relayAccess(stores, { user: who ? stores.users.get(who) : null, visitor: id, ...request })

test('an anonymous connection gets nothing for a private slate, or with no slate named', async () => {
  const stores = await world()
  assert.deepEqual(await ask(stores, null, { shareId: 'share-private' }), { code: RELAY_CODES.noAccess })
  assert.deepEqual(await ask(stores, null, {}), { code: RELAY_CODES.invalidSlate })
  assert.deepEqual(await ask(stores, null, { shareId: { $ne: null } }), { code: RELAY_CODES.invalidSlate })
  const details = collaboratorDetails({ user: null, userId: null, id: 'tab', shareId: 'share-private', settings, fallbackSecret: 'x',
    access: await ask(stores, null, { shareId: 'share-private' }) })
  assert.equal(details.wsParams, null)
  assert.equal(details.relayCode, 'no-access')
  assert.equal(details.relayRole, null)
})

test('a share id nothing has gets no relay params (the forged-credential probe of 2026-11-26)', async () => {
  const stores = await world()
  const access = await ask(stores, null, { shareId: 'made-up-share-id' })
  assert.deepEqual(access, { code: RELAY_CODES.notFound })
  const signedIn = await ask(stores, 'stranger', { shareId: 'made-up-share-id' })
  assert.deepEqual(signedIn, { code: RELAY_CODES.notFound })
  const details = collaboratorDetails({ user: null, userId: null, id: 'tab', shareId: 'made-up-share-id', settings, fallbackSecret: 'x', access })
  assert.equal(details.wsParams, null, 'no token and no legacy bearer for a slate that does not exist')
  assert.equal(details.relayCode, 'slate-not-found')
})

test('a signed-in stranger gets nothing for another person\'s private slate, by share id or a teammate\'s invitation', async () => {
  const stores = await world()
  assert.equal((await ask(stores, 'stranger', { shareId: 'share-private' })).code, RELAY_CODES.noAccess)
  assert.equal((await ask(stores, 'stranger', { shareId: 'share-private', routeKey: 'key-mate' })).code, RELAY_CODES.noAccess)
  assert.equal((await ask(stores, null, { routeKey: 'key-mate' })).code, RELAY_CODES.noAccess)
})

test('the owner and a teammate the slate is shared with to edit get write; a read share gets read', async () => {
  const stores = await world()
  assert.deepEqual(await ask(stores, 'owner', { shareId: 'share-private' }), { code: 'ok', role: 'write', room: 'private', slateId: 'private' })
  assert.equal((await ask(stores, 'mate', { shareId: 'share-private' })).role, 'write')
  assert.equal((await ask(stores, 'viewer', { shareId: 'share-private' })).role, 'read')
})

test('a guest who made their own slate edits it live', async () => {
  const stores = await world()
  assert.deepEqual(await ask(stores, 'guest-owner', { shareId: 'share-guest-own', id: 'tab' }),
    { code: 'ok', role: 'write', room: 'guest-own', slateId: 'guest-own' })
})

test('a view-only share gives read; an edit invitation gives write', async () => {
  const stores = await world()
  // Unlisted with a read link: anyone holding the link reads, signed in or not.
  assert.equal((await ask(stores, null, { shareId: 'share-unlisted-read', routeKey: 'key-ur', id: 'v' })).role, 'read')
  assert.equal((await ask(stores, 'stranger', { shareId: 'share-unlisted-read', routeKey: 'key-ur' })).role, 'read')
  // Unlisted with an edit link: a signed-in holder edits.
  assert.equal((await ask(stores, 'stranger', { shareId: 'share-unlisted-edit', routeKey: 'key-ue' })).role, 'write')
  // Public with a read link: read, also at its bare address.
  assert.equal((await ask(stores, null, { shareId: 'share-public-read', id: 'v' })).role, 'read')
  assert.equal((await ask(stores, 'stranger', { shareId: 'share-public-read' })).role, 'read')
})

test('a visitor with no account writes only once admitted, as their saves do', async () => {
  const stores = await world()
  const admitted = await ask(stores, null, { shareId: 'share-public-edit', routeKey: 'key-pe', id: 'visitor-admitted' })
  assert.equal(admitted.role, 'write')
  const notAdmitted = await ask(stores, null, { shareId: 'share-public-edit', routeKey: 'key-pe', id: 'visitor-new' })
  assert.equal(notAdmitted.role, 'read')
  // At the bare public address (no invitation) the visitor reads.
  assert.equal((await ask(stores, null, { shareId: 'share-public-edit', id: 'visitor-admitted' })).role, 'read')
})

test('comment access, a visitor on a workshop and a read-only request all get read', async () => {
  const stores = await world()
  assert.equal((await ask(stores, 'viewer', { shareId: 'share-public-edit', routeKey: 'key-pe-viewer' })).role, 'read')
  assert.equal((await ask(stores, null, { shareId: 'share-workshop', routeKey: 'key-w', id: 'visitor-admitted' })).role, 'read')
  assert.equal((await ask(stores, 'owner', { shareId: 'share-private', readOnly: true })).role, 'read')
})

test('the room is the slate\'s id from its record; an address and a share id naming two slates are refused', async () => {
  const stores = await world()
  // Whatever else the caller sends (a room, a slate id), the token's room is the record's.
  const access = await relayAccess(stores, { user: OWNER, shareId: 'share-private', room: 'public-edit', slateId: 'public-edit' })
  assert.equal(access.room, 'private')
  const { token } = relayParams({ settings, access, now: NOW })
  assert.equal(readRoomToken(token).room, 'private')
  assert.ok(verifyRoomToken(token, { room: 'private', secretFor, now: NOW }))
  assert.equal(verifyRoomToken(token, { room: 'public-edit', secretFor, now: NOW }), null)
  // A read invitation for one slate does not open another slate's room.
  assert.equal((await ask(stores, 'stranger', { shareId: 'share-unlisted-edit', routeKey: 'key-ur' })).code, RELAY_CODES.noAccess)
})

test('the canvas read and the relay share one open rule', async () => {
  const stores = await world()
  for (const [who, key] of [[null, 'share-private'], ['stranger', 'share-private'], ['viewer', 'share-private'], [null, 'key-ur'],
    ['mate', 'key-mate'], ['stranger', 'key-mate'], [null, 'made-up']]) {
    const opened = await openSlateRole(stores, key, who ? stores.users.get(who) : null)
    const access = await ask(stores, who, { routeKey: key })
    if (opened?.slate) assert.equal(access.code, 'ok', `${who} ${key}`)
    else assert.notEqual(access.code, 'ok', `${who} ${key}`)
  }
  // slates.get answers through openSlateRole.
  const source = app('server/methods/slates.js')
  assert.match(source, /const opened = await openSlateRole\(slateOpenStores, opts\.shareId, user\)/)
  const method = app('server/methods/collaborators.js')
  assert.match(method, /relayAccess\(relayStores/)
  assert.match(method, /\.\.\.slateOpenStores/)
})

// ---------------------------------------------------------------- what init and refresh return

test('init returns only { token, exp } for the room and role by default (legacy off)', async () => {
  const stores = await world()
  const access = await ask(stores, 'mate', { shareId: 'share-private' })
  const details = collaboratorDetails({ user: TEAMMATE, userId: 'mate', id: 'tab', shareId: 'share-private', settings, fallbackSecret: 'x', access, now: new Date(NOW) })
  assert.deepEqual(Object.keys(details.wsParams).sort(), ['exp', 'token'])
  assert.equal(details.relayRole, 'write')
  assert.equal(details.relayCode, 'ok')
  assert.equal(verifyRoomToken(details.wsParams.token, { room: 'private', secretFor, now: NOW }).role, 'write')
  assert.equal(details.wsParams.exp, Math.floor(NOW / 1000) + 900)
  for (const relay of [undefined, {}, { legacy: false }, { legacy: 'true' }, { legacy: 1 }]) {
    const off = collaboratorDetails({ user: TEAMMATE, userId: 'mate', id: 'tab', shareId: 'share-private',
      settings: { ...settings, ...(relay ? { relay } : {}) }, fallbackSecret: 'x', access })
    assert.deepEqual(Object.keys(off.wsParams).sort(), ['exp', 'token'], `no legacy pair with relay ${JSON.stringify(relay)}`)
  }
})

test('with the rollout override (relay.legacy === true) the legacy pair goes only to write, never to read or readOnly', async () => {
  const stores = await world()
  const legacy = { ...settings, relay: { legacy: true } }
  const write = await ask(stores, 'mate', { shareId: 'share-private' })
  assert.equal(write.role, 'write')
  const withPair = collaboratorDetails({ user: TEAMMATE, userId: 'mate', id: 'tab', shareId: 'share-private', settings: legacy, fallbackSecret: 'x', access: write })
  assert.deepEqual(Object.keys(withPair.wsParams).sort(), ['bearer', 'exp', 'timestamp', 'token'])
  // The same editor asking for a slate's picture (readOnly) gets read, and no pair.
  const picture = await ask(stores, 'mate', { shareId: 'share-private', readOnly: true })
  assert.equal(picture.role, 'read')
  const pictureDetails = collaboratorDetails({ user: TEAMMATE, userId: 'mate', id: 'tab', shareId: 'share-private', settings: legacy, fallbackSecret: 'x', access: picture })
  assert.deepEqual(Object.keys(pictureDetails.wsParams).sort(), ['exp', 'token'])
  // A visitor on a public read-only slate gets read, and no pair.
  const viewer = await ask(stores, null, { shareId: 'share-public-read' })
  assert.equal(viewer.code, 'ok')
  assert.equal(viewer.role, 'read')
  const viewerDetails = collaboratorDetails({ user: null, userId: null, id: 'tab', shareId: 'share-public-read', settings: legacy, fallbackSecret: 'x', access: viewer })
  assert.deepEqual(Object.keys(viewerDetails.wsParams).sort(), ['exp', 'token'])
  // relayParams itself: read never carries the pair, even when asked for legacy.
  assert.deepEqual(Object.keys(relayParams({ settings: legacy, access: { code: 'ok', role: 'read', room: 'r' }, legacy: true })).sort(), ['exp', 'token'])
})

test('without the relay key pair there are no relay params, whatever the access', async () => {
  const stores = await world()
  const access = await ask(stores, 'owner', { shareId: 'share-private' })
  const details = collaboratorDetails({ user: OWNER, userId: 'owner', id: 'tab', shareId: 'share-private', settings: {}, fallbackSecret: 'x', access })
  assert.equal(details.wsParams, null)
  assert.equal(details.relayCode, 'relay-off')
})

test('refresh runs the access check again and returns only the token', () => {
  const source = app('server/methods/collaborators.js')
  const body = source.slice(source.indexOf('methods.collaborators.refresh]'))
  assert.match(body, /accessFor\(await Meteor\.userAsync\(\)/)
  assert.match(body, /legacy: false/)
  assert.match(app('imports/api/common/constants.js'), /refresh: 'collaborators\.refresh'/)
})

test('init and refresh are rate limited per connection and per address', () => {
  const source = app('server/methods/collaborators.js')
  for (const name of ['init', 'refresh']) {
    assert.match(source, new RegExp(`addRule\\(\\{ type: 'method', name: ${name}, connectionId: \\(\\) => true \\}`))
    assert.match(source, new RegExp(`addRule\\(\\{ type: 'method', name: ${name}, clientAddress: \\(\\) => true \\}`))
  }
})

test('the canvas names its address and asks after the guest is admitted; a slate\'s picture asks for read only', () => {
  const canvas = app('imports/ui/pages/Canvas.jsx')
  const start = canvas.indexOf('onInitCollaboration: async (clientID) => {')
  const body = canvas.slice(start, canvas.indexOf('return userBaseData', start))
  assert.ok(body.indexOf('organizations.trackGuest') < body.indexOf('collaborators.init'))
  assert.match(body, /shareId: slateBase\.shareId,\s*routeKey: id,/)
  assert.match(body, /refreshWebsocketParams: async \(\) =>/)
  assert.match(body, /websocketRole: collaboratorDetails\.relayRole/)
  const snap = app('imports/ui/components/SnapSlate.jsx')
  assert.match(snap, /readOnly: true/)
  assert.match(snap, /refreshWebsocketParams/)
})

// ---------------------------------------------------------------- no token in the logs

test('no token, bearer or secret reaches the logs on any path', async () => {
  const captured = []
  const originals = {}
  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    originals[level] = console[level]
    console[level] = (...args) => captured.push(args.map(String).join(' '))
  }
  const writes = [process.stdout.write, process.stderr.write]
  process.stdout.write = function write(chunk, ...rest) { captured.push(String(chunk)); return writes[0].call(this, chunk, ...rest) }
  process.stderr.write = function write(chunk, ...rest) { captured.push(String(chunk)); return writes[1].call(this, chunk, ...rest) }
  const issued = []
  try {
    const stores = await world()
    for (const [who, request] of [
      ['owner', { shareId: 'share-private' }], ['mate', { shareId: 'share-private' }], [null, { shareId: 'share-public-read' }],
      [null, { shareId: 'share-private' }], [null, { shareId: 'made-up' }], [null, {}], ['stranger', { routeKey: 'key-mate' }],
      [null, { shareId: 'share-public-edit', routeKey: 'key-pe', id: 'visitor-admitted' }],
    ]) {
      const access = await ask(stores, who, request)
      // With the legacy override on, so the old pair's path is covered too.
      const details = collaboratorDetails({ user: who ? stores.users.get(who) : null, userId: who, id: 'tab', shareId: request.shareId,
        settings: { ...settings, relay: { legacy: true } }, fallbackSecret: 'x', access })
      if (details.wsParams) issued.push(...[details.wsParams.token, details.wsParams.bearer, details.wsParams.token.split('.')[1]].filter(Boolean))
      const fresh = relayParams({ settings, access, legacy: false })
      if (fresh) issued.push(fresh.token)
    }
    verifyRoomToken('bad.token', { room: 'r', secretFor })
  } finally {
    Object.assign(console, originals)
    process.stdout.write = writes[0]
    process.stderr.write = writes[1]
  }
  assert.ok(issued.length >= 5, 'tokens were issued')
  const all = captured.join('\n')
  for (const secret of [...issued, keys.secretKey, relayKey(keys.secretKey).toString('base64url')]) {
    assert.ok(!all.includes(secret), 'a credential reached the log')
  }
  // And the code that handles tokens writes no log line at all.
  for (const file of ['server/methods/collaborators.js', 'server/common/collaborator-details.mjs', 'server/common/relay-token.mjs',
    'server/common/relay-access.mjs', 'server/common/slate-open-role.mjs']) {
    assert.doesNotMatch(app(file).replace(/^\s*\/\/.*$/gm, ''), /console\.|process\.std(out|err)/, file)
  }
})
