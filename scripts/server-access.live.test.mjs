// Live access probes: what a stranger can do to a running app with a raw Meteor connection.
// Each test plays an anonymous connection, a guest made the way the app makes one, or an
// ordinary registered account, against a second account's data.
//
// Run against a local app only (never production):
//   SLATEBOX_APP_URL=http://localhost:4374 npm run test:server-access:live
// Without SLATEBOX_APP_URL every test is skipped. SLATEBOX_HOOK_KEYS may name a JSON file with the
// local app's scratch { publicKey, secretKey }, to prove a genuinely signed hook still works.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { appUrl, connect, registeredUser, guestUser, errorOf, digest, closeAll } from './ddp-client.mjs'

const base = appUrl()
const live = { skip: base ? false : 'set SLATEBOX_APP_URL to a locally started app' }
const hex = (n) => randomBytes(n).toString('hex').slice(0, n)
const notFound = (r) => r.error && /not found/i.test(r.error.message + JSON.stringify(r.error.ddp || {}))
const refused = (r) => Boolean(r.error) || r.value == null || r.value === false
const alive = async () => (await fetch(base + '/livez')).ok

let victim, stranger, anon, victimTeam
const slates = {}

async function insertSlate(client, visibility, extra = {}) {
  const _id = hex(12)
  const doc = {
    _id, shareId: hex(10), userId: client.userId,
    options: { id: _id, name: `${visibility} board ${_id}`, isPublic: visibility === 'public', isPrivate: visibility === 'private', isUnlisted: visibility === 'unlisted' },
    nodes: [], ...extra,
  }
  // Restated (P05a): no browser writes the slates collection, so a person's new slate is saved by
  // the canvas's own method (slates.update) through the save core. Its team is its owner's: the
  // method takes none from the caller, so `orgId` in extra is not sent.
  await client.call('slates.update', { slate: { options: doc.options, shareId: doc.shareId, nodes: doc.nodes } })
  return doc
}

before(async () => {
  if (!base) return
  victim = await registeredUser('victim')
  victimTeam = await victim.call('organizations.create', { name: 'Victim team ' + hex(4), createdByUserId: victim.userId })
  slates.private = await insertSlate(victim, 'private', { orgId: victimTeam })
  slates.public = await insertSlate(victim, 'public', { orgId: victimTeam })
  slates.unlisted = await insertSlate(victim, 'unlisted', { orgId: victimTeam })
  await victim.call('/comments/insert', { _id: hex(17), slateId: slates.private._id, nodeId: 'n1', createdByUserId: victim.userId, text: 'private comment', timestamp: Date.now() })
  stranger = await registeredUser('stranger')
  anon = await connect()
})
after(() => closeAll())

test('users.get never returns account documents, and takes no operators', live, async () => {
  const dump = await errorOf(anon.call('users.get', { _id: { $ne: null } }))
  assert.ok(refused(dump), 'operator query answered: ' + JSON.stringify(dump.value)?.slice(0, 200))
  const byId = await errorOf(anon.call('users.get', { _id: victim.userId }))
  assert.ok(refused(byId) || !JSON.stringify(byId.value).includes('services'), 'a stranger read an account by id')
  const count = await anon.call('users.get', { email: victim.email, count: true })
  assert.equal(count, 1, 'the registration check still counts an address')
  const opCount = await errorOf(anon.call('users.get', { email: { $ne: null }, count: true }))
  assert.ok(refused(opCount), 'operator count answered')
})

test('signing up cannot choose a team or a plan', live, async () => {
  const c = await connect()
  const r = await errorOf(c.call('createUser', { email: `joiner-${hex(6)}@probe.invalid`, password: digest('Probe-pass-1'), orgId: victimTeam, planType: 'price_pro', isDemo: true }))
  if (!r.error) {
    await c.subscribe('me')
    const me = c.collection('users').find((u) => u._id === r.value.id)
    assert.notEqual(me?.orgId, victimTeam, 'joined a team by signing up')
    assert.equal(me?.planType, undefined, 'a plan field reached the browser')
  }
  c.close()
})

test('a guest cannot be created inside a team, nor from a public team slate', live, async () => {
  const g = await connect()
  const r = await g.call('users.createAnonymous', { orgId: victimTeam, shareId: slates.public.shareId })
  const email = typeof r === 'string' ? r : r.email
  const login = r?.token ? await g.call('login', { resume: r.token }) : await errorOf(g.call('login', { user: { email }, password: digest('ANONYMOUS') }))
  if (login.error) return // no way in at all is also fine
  await g.subscribe('me')
  const me = g.collection('users')[0]
  assert.notEqual(me?.orgId, victimTeam, 'guest placed in a team the caller chose')
  g.close()
})

test('nobody signs in as a guest with the shared guest password', live, async () => {
  const g = await connect()
  const r = await g.call('users.createAnonymous', {})
  const email = typeof r === 'string' ? r : r.email
  const c = await connect()
  const login = await errorOf(c.call('login', { user: { email }, password: digest('ANONYMOUS') }))
  assert.ok(login.error, 'signed in as a guest with ANONYMOUS')
  g.close(); c.close()
})

// An account saved before saving required a password of one's own kept the guest password
// (Cloud data): the password itself is refused, whoever the account is.
test('no account signs up or signs in with the password every early guest shared', live, async () => {
  const email = `shared-${hex(6)}@probe.invalid`
  const c = await connect()
  const made = await errorOf(c.call('createUser', { email, password: digest('ANONYMOUS') }))
  assert.ok(made.error, 'an account was made with the shared guest password')
  const d = await connect()
  const login = await errorOf(d.call('login', { user: { email }, password: digest('ANONYMOUS') }))
  assert.ok(login.error, 'signed in with the shared guest password')
  const g = await guestUser()
  const saved = await errorOf(g.call('users.identify', { email: `saved-${hex(6)}@probe.invalid`, password: 'ANONYMOUS' }))
  assert.ok(saved.error, 'a guest saved its account with the shared guest password')
  c.close(); d.close(); g.close()
})

test('organizations.create cannot name someone else as the owner', live, async () => {
  const g = await registeredUser('orgmaker')
  await g.call('organizations.create', { name: 'Hostile ' + hex(4), createdByUserId: victim.userId })
  await victim.subscribe('me')
  const me = victim.collection('users').find((u) => u._id === victim.userId)
  assert.equal(me.orgId, victimTeam, "the victim's team changed")
  // The stranger is admin of its own team only: it cannot edit the victim or the victim's team.
  const upd = await errorOf(g.call('users.update', { userId: victim.userId, firstName: 'Pwned' }))
  assert.ok(refused(upd) || /permission|not/i.test(String(upd.value)), 'cross-team users.update: ' + upd.value)
  await victim.subscribe('me')
  const org = await errorOf(g.call('/organizations/update', { _id: victimTeam }, { $set: { planType: 'price_hacked' } }))
  assert.ok(org.error, 'edited another team')
  const roles = await errorOf(g.call('users.changeRoles', { users: [{ orgId: undefined, userId: g.userId, claimIds: ['uberMensch'], action: 'add' }] }))
  const search = await errorOf(g.call('users.search', { search: 'victim' }))
  assert.ok(refused(search), 'granted itself uberMensch: ' + JSON.stringify(roles))
  g.close()
})

test('orgUsersForGuest publishes only the names of the slate\'s own team', live, async () => {
  const c = await connect()
  // An operator anywhere in the arguments refuses the whole subscription (server/argument-guard.js).
  assert.match(await c.subscribe('orgUsersForGuest', { slateId: slates.public._id, orgId: { $ne: 'x' } }), /^error/)
  assert.equal(c.collection('users').length, 0)
  await c.subscribe('orgUsersForGuest', { slateId: slates.public._id })
  await c.subscribe('orgUsersForGuest', { slateId: slates.private._id })
  const users = c.collection('users')
  assert.deepEqual(users.map((u) => u._id), [victim.userId], 'published ' + users.length + ' accounts')
  assert.ok(users.every((u) => !u.emails && !u.services), 'published addresses: ' + JSON.stringify(users))
  c.close()
})

test('a team\'s private and unlisted slate names are not listed to a guest', live, async () => {
  const r = await errorOf(stranger.call('slates.getNonPublic'))
  assert.ok(notFound(r), 'slates.getNonPublic still answers')
})

test('users.getSlateAccessUrl gives a slate address only to the owner or a person its sharing names', live, async () => {
  await victim.call('slateAccess.configureLink', { slateId: slates.unlisted._id, type: 'unlisted', permission: 'EDIT', initialize: true })
  for (const caller of [anon, stranger]) {
    const r = await errorOf(caller.call('users.getSlateAccessUrl', { slateId: slates.unlisted._id, nodeId: 'x' }))
    assert.ok(refused(r), 'gave a stranger ' + r.value)
  }
  assert.equal(await victim.call('users.getSlateAccessUrl', { slateId: slates.unlisted._id, nodeId: 'x' }), `/canvas/${slates.unlisted.shareId}/x`)
})

test('collection writes: no message, comment, AI row, icon pack or audit row of someone else', live, async () => {
  const fake = { _id: hex(17), userId: victim.userId, text: 'fake system message', type: 'system', read: false, timestamp: Date.now() }
  assert.ok((await errorOf(anon.call('/messages/insert', fake))).error, 'anonymous inserted a message')
  assert.ok((await errorOf(stranger.call('/messages/insert', { ...fake, _id: hex(17) }))).error, 'stranger inserted a message for the victim')
  assert.ok((await errorOf(stranger.call('/aiContent/insert', { _id: hex(17), userId: victim.userId, role: 'coordinator', state: 'complete', month: 1 }))).error, 'stranger wrote AI content as the victim')
  const comments = await victim.subscribe('comments', { slateId: slates.private._id })
  const comment = victim.collection('comments')[0]
  assert.equal(comments, 'ready')
  assert.ok(comment, 'the owner sees their comment')
  assert.ok((await errorOf(stranger.call('/comments/remove', { _id: comment._id }))).error, 'stranger removed a comment')
  assert.ok((await errorOf(anon.call('/comments/update', { _id: comment._id }, { $set: { text: 'x' } }))).error, 'anonymous edited a comment')
  assert.ok((await errorOf(stranger.call('/iconPacks/insert', { _id: hex(17), userId: victim.userId, visibility: 'public', name: 'x', icons: [] }))).error, 'stranger inserted an icon pack')
})

test('comments.remove and openai.deleteAIContent take no operators and need the owner', live, async () => {
  const r = await errorOf(anon.call('messages.remove', { commentId: { $ne: null } }))
  assert.ok(r.error || (r.value?.removeComments === 0), 'removed comments by operator: ' + JSON.stringify(r.value))
  const d = await errorOf(anon.call('openai.deleteAIContent', { _id: { $ne: null } }))
  assert.ok(refused(d), 'anonymous deleted AI content')
  await victim.subscribe('comments', { slateId: slates.private._id })
  assert.ok(victim.collection('comments').length > 0, 'the comment is gone')
})

test('comments, chat and transcripts are published only for a slate the subscriber may read', live, async () => {
  await victim.call('/comments/insert', { _id: hex(17), slateId: slates.private._id, nodeId: 'n2', createdByUserId: victim.userId, text: 'another private comment', timestamp: Date.now() })
  const c = await connect()
  await c.subscribe('comments', { slateId: { $exists: true } })
  await c.subscribe('comments', { slateId: slates.private._id })
  assert.equal(c.collection('comments').length, 0, 'anonymous read comments')
  await stranger.subscribe('messages', { types: ['chat'], slateShareId: { $exists: true } })
  assert.equal(stranger.collection('messages').filter((m) => m.type === 'chat').length, 0, 'chat by operator')
  const t = await stranger.subscribe('transcripts,', { slateShareId: { $exists: true } })
  assert.equal(stranger.collection('transcripts').length, 0, 'transcripts by operator: ' + t)
  c.close()
})

test('a signed-out connection cannot insert a slate', live, async () => {
  const c = await connect()
  // The visitor id is the caller's own choice: a guest view of any public slate admits it.
  const visitor = hex(12)
  await errorOf(c.call('organizations.trackGuest', { slateId: slates.public._id, guestCollaboratorId: visitor }))
  const _id = hex(12)
  const r = await errorOf(c.call('/slates/insert', { _id, shareId: hex(10), userId: victim.userId, instanceId: visitor, options: { id: _id, name: 'forged', isPublic: true }, nodes: [] }))
  assert.ok(r.error, 'signed-out slate insert accepted')
  c.close()
})

// Restated (P05a): the browser's insert is gone for everyone; the canvas's save names no team, and
// the slate lands in its owner's own (none, for the stranger), never the one the caller wanted.
test('a slate cannot be put into a team its owner is not in', live, async () => {
  const forged = await errorOf(stranger.call('/slates/insert', { _id: hex(12), shareId: hex(10), userId: stranger.userId, orgId: victimTeam, options: { name: 'forged', isPublic: true }, nodes: [] }))
  assert.ok(forged.error, 'stranger inserted a slate into the victim team')
  const made = await insertSlate(stranger, 'public', { orgId: victimTeam })
  const stored = (await stranger.call('slates.get', { shareId: made.shareId }))?.slateBase
  assert.equal(stored?.shareId, made.shareId)
  assert.notEqual(stored.orgId ?? null, victimTeam, 'the saved slate joined the victim team')
})

test('the upload route needs a signed-in account, an image and a size cap, and never crashes the server', live, async () => {
  const form = new FormData()
  form.append('file', new Blob(['<html><script>alert(1)</script></html>'], { type: 'text/html' }), 'evil.html')
  const r = await fetch(base + '/sbupload/image?skipTimestamp=true', { method: 'POST', body: form })
  assert.ok(r.status === 401 || r.status === 403, 'anonymous upload answered ' + r.status)
  const empty = await fetch(base + '/sbupload/image', { method: 'POST' })
  assert.ok(empty.status >= 400 && empty.status < 500, 'empty upload answered ' + empty.status)
  assert.ok(await alive(), 'the server died after an empty upload')
  const headers = { 'x-slatebox-login-token': stranger.token }
  const html = new FormData()
  html.append('file', new Blob(['<html></html>'], { type: 'text/html' }), 'page.html')
  const typed = await fetch(base + '/sbupload/image', { method: 'POST', body: html, headers })
  assert.equal(typed.status, 415, 'html upload answered ' + typed.status)
  const big = new FormData()
  big.append('file', new Blob([new Uint8Array(21 * 1024 * 1024)], { type: 'image/png' }), 'big.png')
  const huge = await fetch(base + '/sbupload/image', { method: 'POST', body: big, headers })
  assert.equal(huge.status, 413, 'oversized upload answered ' + huge.status)
  assert.ok(await alive())
  // The signed-in upload of a real image still works, under a name the server chose.
  const png = new FormData()
  png.append('file', new Blob([Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex')], { type: 'image/png' }), '../../evil name.html')
  const ok = await fetch(base + '/sbupload/image', { method: 'POST', body: png, headers })
  const url = await ok.text()
  assert.equal(ok.status, 200, 'a signed-in PNG upload answered ' + ok.status + ' ' + url)
  assert.match(url, new RegExp('/\\d{4}/\\d{2}/\\d{2}/u_' + stranger.userId + '_[A-Za-z0-9]{17}\\.png$'))
  // Its owner may remove it; nobody else may.
  assert.equal(await victim.call('images.removeImage', { url }), false)
  assert.equal(await stranger.call('images.removeImage', { url }), true)
})

test('GET /sbimages never crashes the server on a row without bytes', live, async () => {
  const r = await fetch(base + '/sbimages/' + encodeURIComponent('https://example.invalid/none-' + hex(6) + '.jpg'))
  assert.ok(r.status === 404, 'missing image answered ' + r.status)
  assert.ok(await alive(), 'the server died')
})

test('server-side fetches refuse private, loopback and metadata addresses', live, async () => {
  for (const url of [base + '/livez', 'http://127.0.0.1:4374/livez', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'file:///etc/passwd.png', 'http://localhost/x.png']) {
    const b64 = await errorOf(stranger.call('utils.base64StringFromRemoteUrl', { type: 'application/pdf', url }))
    assert.ok(b64.error, 'base64StringFromRemoteUrl fetched ' + url)
    const exists = await errorOf(stranger.call('utils.urlExists', url))
    assert.ok(exists.error || exists.value === false, 'urlExists probed ' + url)
  }
  const sharpMethod = await errorOf(stranger.call('utils.base64StringFromRemoteUrl', { type: 'toFile', url: 'https://example.com/a.png' }))
  assert.ok(sharpMethod.error, 'a caller chose the sharp method')
})

test('dead methods are gone', live, async () => {
  for (const name of ['layouts.aiCalculate', 'slates.archive', 'slates.echo', 'tags.remove', 'tags.update', 'themes.getPrivate', 'svgImports.aws',
    'tts.textToSpeechUrl', 'youtube.urlToAudio', 'utils.createImage', 'slates.convertTextToPaths', 'utils.clearBase64Cache', 'utils.getBase64CacheStats',
    'slates.scaleAndTranslate', 'stripe.deleteCustomer', 'googleDocs.createFolder', 'images.svgToPaths', 'users.impersonate']) {
    const r = await errorOf(anon.call(name, {}))
    assert.ok(notFound(r), name + ' still answers: ' + (r.error?.message || JSON.stringify(r.value)))
  }
})

test('images.removeImage deletes only an exact upload of the caller', live, async () => {
  for (const fileName of ['', '/', 'a/b', '2026']) {
    const r = await errorOf(stranger.call('images.removeImage', { fileName }))
    assert.ok(r.error, 'accepted removeImage ' + JSON.stringify(fileName))
  }
  for (const url of ['', 'http://localhost:1/', 'http://localhost:1/2026/01/01/u_' + victim.userId + '_AAAAAAAAAAAAAAAAA.png']) {
    const r = await errorOf(stranger.call('images.removeImage', { url }))
    assert.ok(r.error || r.value === false, 'accepted removeImage ' + url)
  }
})

test('cloud links and Google Docs export need edit rights on the slate', live, async () => {
  // A public slate with no sharing rows is editable by any signed-in account (slate-role.mjs);
  // the unlisted and private ones are not.
  const r = await errorOf(stranger.call('utils.getCloudLink', slates.private._id, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', true))
  assert.match(r.error?.message || 'accepted: ' + JSON.stringify(r.value), /permission/i, 'stranger set a preview image on the victim slate')
  // Google Docs export is the Google integration's now (google.exportDoc): a stranger can't read the slate to export it.
  const e = await errorOf(stranger.call('google.exportDoc', { shareId: slates.unlisted.shareId }))
  assert.ok(e.error, 'accepted: ' + JSON.stringify(e.value))
  assert.match(String(e.error?.message), /Slate not found/, 'stranger exported the victim slate')
})

test('messages.recreateMessagesForComment needs the comment author and derives recipients', live, async () => {
  const r = await errorOf(anon.call('messages.recreateMessagesForComment', { commentId: 'x', userId: victim.userId, slateId: slates.private._id, text: 'click here', mentionedTeamMembers: [victim.userId] }))
  assert.ok(r.error || r.value == null, 'anonymous queued messages')
})

test('paid services refuse a guest and an anonymous connection', live, async () => {
  const g = await guestUser()
  for (const caller of [anon, g]) {
    const image = await errorOf(caller.call('stabilityai.generate', { prompts: ['a cat'] }))
    assert.ok(image.error, 'stabilityai.generate served ' + (caller === g ? 'a guest' : 'anonymous') + ': ' + JSON.stringify(image.value))
  }
  for (const [name, arg] of [['humanticApi.fetch', 'https://www.linkedin.com/in/x'], ['images.searchGoogleImages', { query: 'x' }]]) {
    assert.ok(notFound(await errorOf(anon.call(name, arg))), name + ' still answers')
  }
  const layout = await errorOf(anon.call('layouts.calculate', { layoutType: 'x', packageLayout: {} }))
  assert.ok(layout.error || JSON.stringify(layout.value) === '{}', 'layouts.calculate served anonymous')
  g.close()
})

test('presentations: a stranger cannot publish under or analyse someone else\'s slate', live, async () => {
  const r = await errorOf(stranger.call('presentations.publish', { slateShareId: slates.private.shareId, version: 1 }))
  assert.match(r.error?.message || 'accepted', /permission/i, 'stranger published a presentation for the victim slate')
  const a = await errorOf(stranger.call('presentations.analyze', { slate: { shareId: slates.private.shareId, nodes: [] } }))
  assert.match(a.error?.message || 'accepted', /permission/i, 'stranger analysed the victim slate')
})

// Restated 2026-11-21 (added): a slate with a workshop was refused here ("Publish this workshop
// from its canvas."). It is now presented, and published, like any slate by someone who may edit it.
test('presentations: an editor of a slate with a workshop analyses and publishes it like any slate', live, async () => {
  const shareId = await victim.call('creativeSlates.create', 'workshop', '', hex(17))
  const layout = { nodes: [{ nodeId: 'note', description: 'A note', metrics: { bbox: { x: 0, y: 300, width: 100, height: 50 } }, childrenNodes: [] }] }
  const planned = await victim.call('presentations.analyze', { slate: { shareId, name: 'Workshop' }, presentationData: JSON.stringify(layout) })
  assert.ok(planned?.viewpoints?.length > 0, 'no presentation for a slate with a workshop: ' + JSON.stringify(planned))
  const denied = await errorOf(stranger.call('presentations.analyze', { slate: { shareId, name: 'Workshop' }, presentationData: JSON.stringify(layout) }))
  assert.match(denied.error?.message || 'accepted', /permission/i, 'a stranger analysed the workshop slate')
  const url = await victim.call('presentations.publish', { slateShareId: shareId, version: planned.version, svg: '<svg/>', rawSVG: '<svg/>',
    viewpoints: planned.viewpoints, presentationData: layout, orientData: { width: 100, height: 100 } })
  assert.match(url, new RegExp('/present/' + shareId + '$'))
  const published = await anon.call('presentations.get', { slateShareId: shareId, asPublished: true })
  assert.deepEqual(published.presentation.viewpoints.map((point) => point.nodeIds), planned.viewpoints.map((point) => point.nodeIds))
  assert.equal('workshop' in published.presentation, false)
})

test('organizationSettings.save cannot reach another team\'s setting', live, async () => {
  const id = await victim.call('organizationSettings.save', { type: 'preset', value: { name: 'victim brand' }, orgId: victimTeam })
  assert.equal(typeof id, 'string')
  const t = await registeredUser('teamb')
  const teamB = await t.call('organizations.create', { name: 'B ' + hex(4) })
  const r = await errorOf(t.call('organizationSettings.save', { _id: id, type: 'preset', value: { name: 'overwritten' }, orgId: teamB }))
  assert.ok(r.error, 'another team overwrote the setting')
  t.close()
})

test('password reset and guest creation are rate limited', live, async () => {
  const c = await connect()
  let limited = false
  for (let i = 0; i < 8 && !limited; i++) {
    const r = await errorOf(c.call('users.resetPassword', { email: `nobody-${hex(4)}@probe.invalid` }))
    limited = Boolean(r.error && /too many|rate|wait/i.test(r.error.message))
  }
  assert.ok(limited, 'eight resets in a row were all accepted')
  c.close()
})

test('a guest saves its account by choosing a password, and only then signs in with it', live, async () => {
  const g = await guestUser()
  const refusedClaim = await errorOf(g.call('users.identify', { firstName: 'Gee', email: g.email }))
  assert.ok(refusedClaim.error, 'a guest was registered with no password')
  const email = `claimed-${hex(6)}@probe.invalid`
  // A local app has no mail server: the account is saved and the verification mail fails.
  const claimed = await errorOf(g.call('users.identify', { firstName: 'Gee', lastName: 'Uest', email, password: 'Chosen-pass-1' }))
  assert.ok(!claimed.error || claimed.error.ddp?.error === 'verification-delivery', claimed.error?.message)
  const c = await connect()
  const login = await c.call('login', { user: { email }, password: digest('Chosen-pass-1') })
  assert.equal(login.id, g.userId)
  c.close(); g.close()
})

test('an ordinary account still updates its own call settings and names', live, async () => {
  const r = await stranger.call('users.update', { userId: stranger.userId, transcribeOnStart: false, firstName: 'Strange' })
  assert.match(r, /successfully/)
})

test('the collaboration credential any viewer receives is not a signature for the signed hooks', live, async () => {
  const c = await connect()
  // The legacy pair rides along only for a slate the connection may open (a public one here).
  const init = await c.call('collaborators.init', { shareId: slates.public.shareId })
  const { bearer, timestamp } = init.wsParams
  const parts = Buffer.from(bearer, 'base64').toString('utf8').split(':')
  assert.equal(parts.length, 2, 'the relay reads publicKey:hash')
  assert.ok(!timestamp.includes('/'), 'the relay cuts the stamp at a slash')
  const hash = parts[1]
  for (const dateString of [timestamp, timestamp.replace(/^collab\./, '')]) {
    const r = await fetch(`${base}/slates/createOrDisplay?bearer=${encodeURIComponent(hash)}&dateString=${encodeURIComponent(dateString)}&userId=${victim.userId}&promptHash=p1`)
    const body = await r.text()
    assert.equal(r.status, 504, 'the hook accepted the relay credential: ' + r.status + ' ' + body)
    assert.equal(await c.call('auth.isAuthenticated', { bearer: hash, dateString }), false)
  }
  const keysFile = process.env.SLATEBOX_HOOK_KEYS
  if (keysFile) {
    // A request signed the way api.slatebox.com signs still passes (createHmac.ts).
    const { publicKey, secretKey } = JSON.parse(readFileSync(keysFile, 'utf8'))
    const dateString = new Date().toISOString()
    const token = createHmac('sha256', secretKey).update(`${publicKey}:${dateString}`).digest('base64')
    assert.equal(await c.call('auth.isAuthenticated', { bearer: encodeURIComponent(token), dateString }), true)
    const g = await guestUser()
    const r = await fetch(`${base}/slates/createOrDisplay?bearer=${encodeURIComponent(token)}&dateString=${dateString}&userId=${g.userId}&promptHash=p-${hex(6)}`)
    assert.equal(r.status, 200)
    assert.equal(typeof (await r.json()).token, 'string')
    g.close()
  }
  c.close()
})

test('collaborators.init hands relay params only to who may open the slate, for its own room', live, async () => {
  const c = await connect()
  for (const request of [{}, { shareId: hex(10) }, { shareId: slates.private.shareId }, { shareId: { $ne: null } }]) {
    const r = await errorOf(c.call('collaborators.init', request))
    assert.ok(r.error || r.value?.wsParams == null, 'an anonymous connection got relay params for ' + JSON.stringify(request))
  }
  const strange = await stranger.call('collaborators.init', { shareId: slates.private.shareId })
  assert.equal(strange.wsParams, null, 'a stranger got relay params for a private slate')
  const owner = await victim.call('collaborators.init', { shareId: slates.private.shareId })
  assert.equal(owner.relayRole, 'write')
  const room = JSON.parse(Buffer.from(owner.wsParams.token.split('.')[0], 'base64url').toString()).room
  assert.equal(room, slates.private._id)
  const viewer = await c.call('collaborators.init', { shareId: slates.public.shareId })
  assert.equal(viewer.relayRole, 'read', 'an anonymous viewer of a public slate reads')
  const refreshed = await errorOf(c.call('collaborators.refresh', { shareId: slates.private.shareId }))
  assert.ok(refreshed.error || refreshed.value?.wsParams == null, 'refresh handed out a private room')
  c.close()
})

test('slates.get takes a share id string, never an operator', live, async () => {
  const g = await guestUser()
  for (const caller of [anon, g]) {
    for (const shareId of [{ $regex: '^' }, { $ne: null }, { $gt: '' }, { $in: [slates.unlisted.shareId] }]) {
      const r = await errorOf(caller.call('slates.get', { shareId }))
      assert.ok(r.error, 'slates.get answered ' + JSON.stringify(shareId) + ': ' + JSON.stringify(r.value)?.slice(0, 120))
    }
  }
  // Opening by the string still works for the owner and for anyone holding an unlisted link.
  assert.equal((await victim.call('slates.get', { shareId: slates.unlisted.shareId }))?.slateBase?._id, slates.unlisted._id)
  assert.equal((await g.call('slates.get', { shareId: slates.public.shareId }))?.slateBase?._id, slates.public._id)
  g.close()
})

test('no method or publication takes a Mongo operator anywhere in its arguments', live, async () => {
  const g = await guestUser()
  for (const [name, arg] of [['openai.fetchOriginalPrompt', { $ne: null }],
    ['iconPacks.get', { iconPackId: { $ne: null } }], ['organizations.trackGuest', { slateId: { $ne: null } }]]) {
    const r = await errorOf(g.call(name, arg))
    assert.match(r.error?.ddp?.error || 'accepted: ' + JSON.stringify(r.value)?.slice(0, 120), /invalid-argument/, name)
  }
  const sub = await g.subscribe('comments', { slateId: { $gt: '' } })
  assert.match(sub, /error/, 'a publication took an operator: ' + sub)
  g.close()
})

test('no stored document carries a key a browser refuses ($ or .)', live, async () => {
  const g = await guestUser()
  const planted = [
    ['iconPacks.update', { icons: [{ id: 'i', $gt: 1 }] }],
    ['/comments/insert', { _id: hex(17), slateId: slates.public._id, nodeId: 'n', createdByUserId: g.userId, text: 'x', timestamp: Date.now(), $gt: 1 }],
    ['/comments/insert', { _id: hex(17), slateId: slates.public._id, nodeId: 'n', createdByUserId: g.userId, text: 'x', timestamp: Date.now(), meta: { 'a.b': 1 } }],
    ['/messages/insert', { _id: hex(17), slateShareId: slates.public.shareId, userId: g.userId, type: 'chat', text: 'x', timestamp: Date.now(), extra: { $gt: 1 } }],
  ]
  for (const [name, doc] of planted) {
    const r = await errorOf(g.call(name, doc))
    assert.ok(r.error, name + ' stored ' + JSON.stringify(doc))
  }
  // A clean comment is still stored, and cannot be edited into a poisoned one.
  const clean = { _id: hex(17), slateId: slates.public._id, nodeId: 'n', createdByUserId: g.userId, text: 'clean', timestamp: Date.now() }
  await g.call('/comments/insert', clean)
  const upd = await errorOf(g.call('/comments/update', { _id: clean._id }, { $set: { text: { $gt: 1 } } }))
  assert.ok(upd.error, 'a comment was edited to carry an operator key')
  // What every viewer of the public slate receives has no such key.
  const viewer = await connect()
  await viewer.subscribe('comments', { slateId: slates.public._id })
  const bad = viewer.collection('comments').filter((c) => /"[$][a-z]|"[^"]*\.[^"]*":/i.test(JSON.stringify(c)))
  assert.deepEqual(bad, [])
  assert.ok(viewer.collection('comments').some((c) => c._id === clean._id), 'the clean comment is published')
  viewer.close(); g.close()
})

test('the scenarios editor\'s methods and publication are gone', live, async () => {
  const owner = await registeredUser('scenarios')
  for (const name of ['chatIntentions.save', 'chatIntentions.delete', 'chatIntentions.get', 'users.getConversationWelcome']) {
    assert.ok(notFound(await errorOf(owner.call(name, { name: 'x', intentionId: 'adhoc', _id: 'adhoc' }))), name + ' still answers')
  }
  assert.match(await owner.subscribe('chatIntentions'), /error/, 'the chatIntentions publication still answers')
  owner.close()
})

test('a guest cannot spend AI, and has no allowance to read', live, async () => {
  const g = await guestUser()
  assert.equal(await g.call('meter.summary'), null, 'a guest was shown an allowance')
  const r = await errorOf(g.call('openai.chat', { content: 'one-off', processImmediately: true }))
  // With the meter on, the request is refused before any provider call; without it, the scratch app has no AI key.
  assert.ok(r.error || r.value?.abort, 'a guest AI request went through')
  if (r.value?.abortMessage?.startsWith('Sign in')) assert.equal(r.value.abortMessage, 'Sign in to use AI.')
  g.close()
})

test('openai.fetchOriginalPrompt and openai.welcome need access to the slate and the conversation', live, async () => {
  const r = await errorOf(stranger.call('openai.fetchOriginalPrompt', slates.private.shareId))
  assert.ok(r.error || r.value?.empty === true, 'gave a stranger the prompt of a private slate')
  // The victim's conversation on its private slate, then a stranger names it from a slate of its own.
  const aid = 'ai_' + hex(12)
  await victim.call('/aiContent/insert', { _id: `${aid}_layout_settled`, aid, slateShareId: slates.private.shareId, layoutSettled: true, type: 'conversation' })
  const own = await insertSlate(stranger, 'private')
  const w = await errorOf(stranger.call('openai.welcome', { slateAid: aid, shareId: own.shareId, content: 'hi' }))
  assert.equal(w.error?.ddp?.error, 'conversation-denied', 'a stranger continued the victim\'s conversation: ' + (w.error?.message || JSON.stringify(w.value)?.slice(0, 120)))
})

test('an SVG that is slow to draw is cut off, and sign-in keeps answering', live, async () => {
  const rects = Array.from({ length: 30 }, (_, i) => `<rect x="${i * 10}" y="${i * 10}" width="1900" height="1900" fill="#${String(100000 + i * 7919).slice(0, 6)}" filter="url(#f)"/>`).join('')
  const bomb = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"><defs><filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="300"/><feMorphology operator="dilate" radius="200"/></filter></defs>${rects}</svg>`
  const g = await guestUser()
  const headers = { 'x-slatebox-login-token': g.token }
  const started = Date.now()
  const uploads = Array.from({ length: 6 }, () => {
    const form = new FormData()
    form.append('file', new Blob([bomb], { type: 'image/svg+xml' }), 'logo.svg')
    return fetch(base + '/sbupload/image', { method: 'POST', body: form, headers }).then((r) => r.status)
  })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  // While the six are being drawn, a password sign-in answers promptly.
  const c = await connect()
  const t0 = Date.now()
  const login = await c.call('login', { user: { email: stranger.email }, password: digest(stranger.password) })
  assert.equal(login.id, stranger.userId)
  assert.ok(Date.now() - t0 < 5000, 'sign-in took ' + (Date.now() - t0) + ' ms')
  const statuses = await Promise.all(uploads)
  assert.ok(statuses.every((s) => s === 415 || s === 503), 'statuses ' + statuses)
  assert.ok(Date.now() - started < 45000, 'the uploads took ' + (Date.now() - started) + ' ms')
  // A small SVG logo is still stored as a PNG.
  const ok = new FormData()
  ok.append('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="teal"/></svg>'], { type: 'image/svg+xml' }), 'logo.svg')
  const r = await fetch(base + '/sbupload/image', { method: 'POST', body: ok, headers })
  assert.equal(r.status, 200, await r.text())
  c.close(); g.close()
})

test('the server is still up after every probe', live, async () => {
  assert.ok(await alive())
})
