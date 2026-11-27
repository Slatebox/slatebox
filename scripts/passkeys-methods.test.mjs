// Passkeys, the methods (2026-11-26): passkeys.registerOptions/register, loginOptions and the
// 'passkey' login handler, claimOptions/claim (a guest saves, or signs up, with a passkey), and
// list/rename/remove, as server/passkeys/meteor.js runs them: core.mjs's createPasskeys over
// in-memory stores shaped like the Mongo ones, answered by a software authenticator
// (scripts/passkey-authenticator.mjs) so SimpleWebAuthn's real verification runs end to end. Then
// the wiring: the Meteor file, the rate limits, single sign-on's rules, account removal, team
// export, and MIT core never importing enterprise/.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuthenticator } from './passkey-authenticator.mjs'

const core = await import('../web/app/server/passkeys/core.mjs')
const policy = await import('../web/app/server/sso/policy.mjs')
const ssoAccounts = await import('../web/app/server/sso/accounts.mjs')
const { createPasskeys, relyingParty, CHALLENGE_TTL_MS, MAX_PASSKEYS, METHODS, RATE_LIMITS, CLOSED_UNDER_SSO_ONLY, COPY } = core

const app = fileURLToPath(new URL('../web/app/', import.meta.url))
const read = (path) => readFileSync(join(app, path), 'utf8')
const walk = (dir) => readdirSync(join(app, dir)).flatMap((name) => {
  const path = join(dir, name)
  return statSync(join(app, path)).isDirectory() ? walk(path) : /\.(m?js|jsx)$/.test(name) ? [path] : []
})

const ORIGIN = 'https://app.slatebox.com'
const START = Date.UTC(2026, 10, 26, 12, 0, 0)

function makeWorld({ rootUrl = ORIGIN, settings = {}, ssoOnly = false, setup = false, mail = true, claimFails = null } = {}) {
  const clock = { now: START }
  const users = new Map([
    ['ada', { _id: 'ada', emails: [{ address: 'ada@example.com', verified: true }], profile: { firstName: 'Ada', lastName: 'Lovelace' }, services: { password: { bcrypt: 'hash' } } }],
    ['pia', { _id: 'pia', emails: [{ address: 'pia@example.com', verified: true }], profile: {}, services: {} }],
    ['gus', { _id: 'gus', isAnonymous: true, emails: [{ address: 'guest-1@anonymous.slatebox.invalid', verified: false }], profile: { start: { job: 'plan' } }, services: { password: { bcrypt: 'random' } } }],
    ['sso', { _id: 'sso', emails: [{ address: 'sso@corp.test', verified: true }], profile: {}, services: { sso: { issuer: 'kc', subject: 's1' } } }],
    ['off', { _id: 'off', isDisabled: true, emails: [{ address: 'off@example.com' }], profile: {}, services: { password: { bcrypt: 'x' } } }],
  ])
  const passkeys = new Map()
  const challenges = new Map()
  const audits = []
  const notices = []
  const verifications = []
  const logs = []
  let ids = 0
  const service = createPasskeys({
    rp: () => relyingParty({ rootUrl, settings }),
    ssoOnly: () => ssoOnly,
    users: {
      get: async (id) => structuredClone(users.get(id)) || null,
      byEmail: async (email) => [...users.values()].find((user) => user.emails?.some((entry) => entry.address.toLowerCase() === email)) || null,
      setHandle: async (id, handle) => {
        const user = users.get(id)
        user.services.passkey = user.services.passkey || { userHandle: handle }
        return user.services.passkey.userHandle
      },
      claim: async (id, { email, firstName, lastName }) => {
        if (claimFails === 'throw') throw new Error('E11000 duplicate key: emails.address')
        if (claimFails) return false
        const user = users.get(id)
        if (!user?.isAnonymous) return false
        user.isAnonymous = false
        user.emails[0] = { address: email, verified: false }
        user.profile = { firstName: firstName || '', lastName: lastName || '', transcribeOnStart: true, audioMutedOnStart: false, ...(user.profile.start && { start: user.profile.start }) }
        delete user.services.password
        return true
      },
    },
    passkeys: {
      insert: async (doc) => { if ([...passkeys.values()].some((p) => p.credentialId === doc.credentialId)) throw new Error('E11000'); passkeys.set(doc._id, structuredClone(doc)) },
      byUser: async (userId) => [...passkeys.values()].filter((doc) => doc.userId === userId).map((doc) => structuredClone(doc)),
      byCredentialId: async (credentialId) => structuredClone([...passkeys.values()].find((doc) => doc.credentialId === credentialId)) || null,
      update: async (id, set) => { Object.assign(passkeys.get(id), set) },
      remove: async (id, userId) => (passkeys.get(id)?.userId === userId && passkeys.delete(id) ? 1 : 0),
    },
    challenges: {
      insert: async (record) => { challenges.set(record._id, record) },
      take: async (key) => { const record = challenges.get(key) || null; challenges.delete(key); return record },
    },
    setupRequired: async () => setup,
    sendVerification: async (userId) => { verifications.push(userId); return mail ? true : { verificationEmailSent: false } },
    notifyAdded: async (user, doc) => { notices.push({ to: user.emails[0].address, name: doc.name }) },
    audit: async (entry) => { audits.push(entry) },
    log: (line) => logs.push(line),
    now: () => clock.now,
    newId: () => `pk${++ids}`,
  })
  const device = createAuthenticator({ origin: rootUrl.replace(/\/$/, '') })
  const as = (userId, connectionId = 'c-' + userId) => ({ userId, connectionId })
  // The browser's whole "add a passkey" ceremony.
  const addPasskey = async (userId, { name, overrides, on = device } = {}) => {
    const options = await service.registerOptions(as(userId))
    return service.register(as(userId), { response: on.create(options, overrides), name })
  }
  const signIn = async (connectionId = 'c-login', overrides, on = device) => {
    const options = await service.loginOptions({ connectionId })
    return service.login({ connectionId }, on.get(options, overrides))
  }
  return { service, users, passkeys, challenges, audits, notices, verifications, logs, clock, device, as, addPasskey, signIn }
}

const refuses = (promise, code) => assert.rejects(promise, (error) => {
  assert.equal(error.code, code, error.message)
  assert.equal(error.message, COPY[code])
  return true
})

// ---- 1. add a passkey to an account ----

test('a signed-in account adds a passkey: resident key and user verification required, attestation none, a random user handle', async () => {
  const w = makeWorld()
  const options = await w.service.registerOptions(w.as('ada'))
  assert.equal(options.rp.id, 'app.slatebox.com')
  assert.equal(options.rp.name, 'Slatebox')
  assert.equal(options.attestation, 'none')
  assert.deepEqual(options.authenticatorSelection, { residentKey: 'required', requireResidentKey: true, userVerification: 'required' })
  assert.equal(options.user.name, 'ada@example.com')
  assert.equal(options.user.displayName, 'Ada Lovelace')
  const handle = w.users.get('ada').services.passkey.userHandle
  assert.equal(options.user.id, handle)
  assert.equal(Buffer.from(handle, 'base64url').length, 32, '32 random bytes')
  assert.ok(!handle.includes('ada') && !Buffer.from(handle, 'base64url').toString().includes('ada'), 'never the address or the account id')
  assert.ok(options.pubKeyCredParams.some((param) => param.alg === -7), 'ES256 offered')
  assert.equal(w.challenges.size, 1)

  const added = await w.service.register(w.as('ada'), { response: w.device.create(options), name: '  Work  laptop ' })
  assert.equal(added.name, 'Work laptop')
  assert.equal(added.lastUsedAt, null)
  assert.equal(added.backedUp, true)
  assert.equal(added.deviceType, 'multiDevice')
  const [doc] = [...w.passkeys.values()]
  assert.equal(doc.userId, 'ada')
  assert.equal(doc.counter, 0)
  assert.equal(doc.aaguid, 'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4')
  assert.deepEqual(doc.transports, ['internal', 'hybrid'])
  assert.ok(doc.publicKey.length > 40)
  assert.equal(w.challenges.size, 0, 'the challenge was used up')
  assert.deepEqual(w.audits, [{ type: 'passkey-added', userId: 'ada', passkeyId: doc._id }])
  assert.deepEqual(w.notices, [{ to: 'ada@example.com', name: 'Work laptop' }])
  // Without a name, the provider's name.
  assert.equal((await w.addPasskey('ada', { on: createAuthenticator({ origin: ORIGIN }) })).name, 'Google Password Manager')
  // The second ceremony keeps the same handle and excludes the passkey already added.
  const again = await w.service.registerOptions(w.as('ada'))
  assert.equal(again.user.id, handle)
  assert.equal(again.excludeCredentials.length, 2)
})

test('adding a passkey is refused to guests, SSO-linked and turned-off accounts, nobody, under SSO only, and past the cap', async () => {
  const w = makeWorld()
  await refuses(w.service.registerOptions(w.as('gus')), 'guest')
  await refuses(w.service.registerOptions(w.as('sso')), 'sso-linked')
  await refuses(w.service.registerOptions(w.as('off')), 'disabled')
  await refuses(w.service.registerOptions({ userId: null, connectionId: 'c' }), 'sign-in')
  await refuses(w.service.registerOptions(w.as('nobody')), 'sign-in')
  await refuses(makeWorld({ ssoOnly: true }).service.registerOptions(w.as('ada')), 'sso-only')
  await refuses(makeWorld({ rootUrl: 'http://boards.example.com' }).service.registerOptions(w.as('ada')), 'off')
  for (let i = 0; i < MAX_PASSKEYS; i += 1) w.passkeys.set('x' + i, { _id: 'x' + i, userId: 'ada', credentialId: 'cred' + i })
  await refuses(w.service.registerOptions(w.as('ada')), 'too-many')
})

test('a registration is checked: its own challenge, once, on its connection, in time, from this origin and site, verified by the person', async () => {
  const w = makeWorld()
  // Used once: a replay of the same response finds no challenge.
  const options = await w.service.registerOptions(w.as('ada'))
  const response = w.device.create(options)
  await w.service.register(w.as('ada'), { response })
  await refuses(w.service.register(w.as('ada'), { response }), 'challenge')
  // Another connection (another tab or browser) cannot use it.
  const other = await w.service.registerOptions(w.as('ada'))
  await refuses(w.service.register(w.as('ada', 'c-elsewhere'), { response: w.device.create(other) }), 'challenge')
  // Another account cannot use it.
  const adas = await w.service.registerOptions(w.as('ada', 'shared'))
  await refuses(w.service.register(w.as('pia', 'shared'), { response: w.device.create(adas) }), 'challenge')
  // Expired.
  const late = await w.service.registerOptions(w.as('ada'))
  w.clock.now += CHALLENGE_TTL_MS + 1
  await refuses(w.service.register(w.as('ada'), { response: w.device.create(late) }), 'challenge')
  // A challenge the server never made.
  const made = await w.service.registerOptions(w.as('ada'))
  await refuses(w.service.register(w.as('ada'), { response: w.device.create(made, { challenge: 'bm90LWlzc3VlZA' }) }), 'challenge')
  // Another origin (a look-alike site relaying the ceremony), another site's RP ID, no user verification.
  for (const [overrides, code] of [[{ origin: 'https://app.slatebox.com.evil.test' }, 'invalid'], [{ rpId: 'evil.test' }, 'invalid'],
    [{ userVerified: false }, 'user-verification'], [{ type: 'webauthn.get' }, 'invalid']]) {
    const fresh = await w.service.registerOptions(w.as('ada'))
    await refuses(w.service.register(w.as('ada'), { response: w.device.create(fresh, overrides) }), code)
  }
  assert.equal(w.passkeys.size, 1, 'only the first one was kept')
  // Every challenge answered was used up, right or wrong; only the one nobody answered (the
  // forged answer named another) waits for its expiry.
  assert.equal(w.challenges.size, 1)
  assert.equal([...w.challenges.values()][0]._id, core.challengeKey(made.challenge))
})

// ---- 2. sign in with a passkey ----

test('sign in with a passkey: discoverable (no list of passkeys), user verification required, last used recorded', async () => {
  const w = makeWorld()
  await w.addPasskey('ada')
  const options = await w.service.loginOptions({ connectionId: 'c-login' })
  assert.equal(options.rpId, 'app.slatebox.com')
  assert.equal(options.userVerification, 'required')
  assert.deepEqual(options.allowCredentials ?? [], [], 'no passkey list: the browser offers what it holds (autofill)')
  w.clock.now += 60_000
  const signedIn = await w.service.login({ connectionId: 'c-login' }, w.device.get(options))
  assert.equal(signedIn.userId, 'ada')
  const [doc] = [...w.passkeys.values()]
  assert.equal(+doc.lastUsedAt, START + 60_000)
  assert.equal(doc.counter, 0, 'a synced passkey reports 0')
  const listed = await w.service.list(w.as('ada'))
  assert.equal(+listed.passkeys[0].lastUsedAt, START + 60_000)
})

test('a sign-in is refused for a replay, another connection, an expired request, an unknown passkey, a wrong user handle, a guest, SSO', async () => {
  const w = makeWorld()
  await w.addPasskey('ada')
  const options = await w.service.loginOptions({ connectionId: 'c1' })
  const response = w.device.get(options)
  await w.service.login({ connectionId: 'c1' }, response)
  await refuses(w.service.login({ connectionId: 'c1' }, response), 'challenge')
  const other = await w.service.loginOptions({ connectionId: 'c1' })
  await refuses(w.service.login({ connectionId: 'c2' }, w.device.get(other)), 'challenge')
  const late = await w.service.loginOptions({ connectionId: 'c1' })
  w.clock.now += CHALLENGE_TTL_MS
  await refuses(w.service.login({ connectionId: 'c1' }, w.device.get(late)), 'challenge')
  // A passkey this server never saw (made for this site on another server, or removed here).
  const stranger = createAuthenticator({ origin: ORIGIN })
  stranger.create({ rp: { id: 'app.slatebox.com' }, user: { id: 'aGFuZGxl' }, challenge: 'x' })
  await refuses(w.signIn('c3', undefined, stranger), 'unknown-passkey')
  // The passkey's user handle must be this account's.
  await refuses(w.signIn('c4', { userHandle: Buffer.from('someone else').toString('base64url') }), 'unknown-passkey')
  // Another origin, another RP ID, no user verification, a bad signature.
  await refuses(w.signIn('c5', { origin: 'https://test.slatebox.com' }), 'invalid')
  await refuses(w.signIn('c6', { rpId: 'test.slatebox.com' }), 'invalid')
  await refuses(w.signIn('c7', { userVerified: false }), 'user-verification')
  const forged = await w.service.loginOptions({ connectionId: 'c8' })
  const bad = w.device.get(forged)
  bad.response.signature = w.device.get(forged).response.signature.replace(/^.{8}/, 'AAAAAAAA')
  await refuses(w.service.login({ connectionId: 'c8' }, bad), 'invalid')
  // The account became a guest-less, SSO-linked or turned-off account: its passkey no longer signs in.
  w.users.get('ada').services.sso = { issuer: 'kc', subject: 'x' }
  await refuses(w.signIn('c9'), 'unknown-passkey')
  delete w.users.get('ada').services.sso
  w.users.get('ada').isDisabled = true
  await refuses(w.signIn('c10'), 'disabled')
  delete w.users.get('ada').isDisabled
  assert.equal((await w.signIn('c11')).userId, 'ada', 'and back again')
  // Under SSO only there is no passkey sign-in at all.
  await refuses(makeWorld({ ssoOnly: true }).service.loginOptions({ connectionId: 'c' }), 'sso-only')
  // Off here: the sign-in page gets no options and shows no button.
  assert.equal(await makeWorld({ rootUrl: 'http://10.0.0.5:7070' }).service.loginOptions({ connectionId: 'c' }), null)
  assert.equal(makeWorld({ rootUrl: 'http://10.0.0.5:7070' }).service.available(), false)
  assert.equal(makeWorld({ ssoOnly: true }).service.available(), false)
  assert.equal(makeWorld().service.available(), true)
})

test('a counting authenticator must count up: a repeat or a switch to 0 is refused and flagged', async () => {
  const w = makeWorld()
  const key = createAuthenticator({ origin: ORIGIN, synced: false })
  await w.addPasskey('ada', { on: key })
  assert.equal((await w.signIn('c1', undefined, key)).userId, 'ada')
  assert.equal((await w.signIn('c2', undefined, key)).userId, 'ada')
  const [doc] = [...w.passkeys.values()]
  assert.equal(doc.counter, 2)
  await refuses(w.signIn('c3', { counter: 'fixed' }, key), 'counter')
  assert.equal(w.passkeys.get(doc._id).counterFlag, 'counter-regressed')
  assert.ok(w.audits.some((entry) => entry.type === 'passkey-refused' && entry.reason === 'counter-regressed'))
  assert.ok(w.logs.some((line) => /counter-regressed \(stored 2, reported 2\)/.test(line)))
  // A copy can write any count: 0 after counting is refused too (WebAuthn §7.2 step 21).
  await refuses(w.signIn('c4', { counter: 0 }, key), 'counter')
  assert.equal(w.passkeys.get(doc._id).counter, 2)
  assert.equal(w.passkeys.get(doc._id).counterFlag, 'counter-regressed')
  assert.ok(w.logs.some((line) => /counter-regressed \(stored 2, reported 0\)/.test(line)))
  assert.equal(w.audits.filter((entry) => entry.type === 'passkey-refused').length, 2)
})

// ---- 3 and 4. a guest saves (or signs up) with a passkey ----

test('a guest saves the account with only an email and a passkey: slates and first-run answer stay, no password, verification mail', async () => {
  const w = makeWorld()
  const options = await w.service.claimOptions(w.as('gus'), { email: ' Gus@Example.com ' })
  assert.equal(options.user.name, 'gus@example.com')
  assert.equal(options.authenticatorSelection.userVerification, 'required')
  const result = await w.service.claim(w.as('gus'), { response: w.device.create(options), email: 'gus@example.com', firstName: 'Gus', lastName: '' })
  assert.equal(result, true)
  const gus = w.users.get('gus')
  assert.equal(gus.isAnonymous, false)
  assert.deepEqual(gus.emails, [{ address: 'gus@example.com', verified: false }])
  assert.deepEqual(gus.profile.start, { job: 'plan' })
  assert.equal(gus.profile.firstName, 'Gus')
  assert.equal(gus.services.password, undefined, "the guest's random password is gone")
  assert.deepEqual(w.verifications, ['gus'])
  assert.equal([...w.passkeys.values()][0].userId, 'gus')
  assert.equal([...w.passkeys.values()][0].addedUnverified, true, 'added before the address was confirmed')
  assert.ok(w.audits.some((entry) => entry.type === 'passkey-account-saved' && entry.userId === 'gus'))
  // And the account signs in with it.
  assert.equal((await w.signIn('c-next')).userId, 'gus')
  // Without mail on a self-hosted server, the account is still saved and says so.
  const quiet = makeWorld({ mail: false })
  const opts = await quiet.service.claimOptions(quiet.as('gus'), { email: 'gus@example.com' })
  assert.deepEqual(await quiet.service.claim(quiet.as('gus'), { response: quiet.device.create(opts), email: 'gus@example.com' }), { verificationEmailSent: false })
})

test('saving with a passkey is for guests only, with an address nobody has, on a set-up server, for the address asked about', async () => {
  const w = makeWorld()
  await refuses(w.service.claimOptions(w.as('ada'), { email: 'new@example.com' }), 'not-guest')
  await refuses(w.service.claimOptions(w.as('gus'), { email: 'ada@example.com' }), 'email-taken')
  await refuses(w.service.claimOptions(w.as('gus'), { email: 'ADA@example.com' }), 'email-taken')
  await refuses(w.service.claimOptions(w.as('gus'), { email: 'not an address' }), 'email-invalid')
  await refuses(makeWorld({ setup: true }).service.claimOptions(w.as('gus'), { email: 'gus@example.com' }), 'not-set-up')
  await refuses(makeWorld({ ssoOnly: true }).service.claimOptions(w.as('gus'), { email: 'gus@example.com' }), 'sso-only')
  // The challenge is for the address it was made for.
  const options = await w.service.claimOptions(w.as('gus'), { email: 'gus@example.com' })
  await refuses(w.service.claim(w.as('gus'), { response: w.device.create(options), email: 'other@example.com' }), 'challenge')
  // An address taken between the two steps.
  const again = await w.service.claimOptions(w.as('gus'), { email: 'late@example.com' })
  w.users.set('late', { _id: 'late', emails: [{ address: 'late@example.com' }], profile: {}, services: {} })
  await refuses(w.service.claim(w.as('gus'), { response: w.device.create(again), email: 'late@example.com' }), 'email-taken')
  assert.equal(w.users.get('gus').isAnonymous, true, 'still a guest')
  assert.equal(w.passkeys.size, 0)
  // A guest never signs in with a passkey (none can exist; one written by hand is refused).
  w.passkeys.set('hand', { _id: 'hand', userId: 'gus', credentialId: 'abc', publicKey: 'x', counter: 0 })
  w.device.credentials.set('abc', { ...[...w.device.credentials.values()][0], id: 'abc' })
  await refuses(w.signIn('c-guest', { credentialId: 'abc' }), 'unknown-passkey')
})

// ---- 1 again. list, rename, remove; one way in always remains ----

test('list, rename and remove; the last way in cannot be removed', async () => {
  const w = makeWorld()
  // Pia has no password: her first passkey is her only way in.
  const first = await w.addPasskey('pia', { name: 'Phone' })
  let listed = await w.service.list(w.as('pia'))
  assert.equal(listed.available, true)
  assert.equal(listed.reason, null)
  assert.equal(listed.hasPassword, false)
  assert.equal(listed.rpId, 'app.slatebox.com')
  assert.equal(listed.userHandle, w.users.get('pia').services.passkey.userHandle)
  assert.deepEqual(listed.passkeys.map((p) => p.name), ['Phone'])
  assert.ok(!JSON.stringify(listed).includes(w.passkeys.get(first.id).publicKey), 'never the key')
  await refuses(w.service.remove(w.as('pia'), { id: first.id }), 'last-way-in')
  w.clock.now += 1000
  const second = await w.addPasskey('pia', { name: 'Laptop', on: createAuthenticator({ origin: ORIGIN }) })
  const renamed = await w.service.rename(w.as('pia'), { id: second.id, name: ' Work laptop ' })
  assert.equal(renamed.name, 'Work laptop')
  await refuses(w.service.rename(w.as('pia'), { id: second.id, name: '   ' }), 'name-invalid')
  await refuses(w.service.rename(w.as('pia'), { id: second.id, name: 'x'.repeat(61) }), 'name-invalid')
  const removed = await w.service.remove(w.as('pia'), { id: first.id })
  assert.deepEqual(removed, { removed: first.credentialId, remaining: [second.credentialId] })
  await refuses(w.service.remove(w.as('pia'), { id: second.id }), 'last-way-in')
  listed = await w.service.list(w.as('pia'))
  assert.deepEqual(listed.passkeys.map((p) => p.name), ['Work laptop'])
  // Someone else's passkey is not theirs to rename or remove.
  await refuses(w.service.rename(w.as('ada'), { id: second.id, name: 'Mine' }), 'not-found')
  await refuses(w.service.remove(w.as('ada'), { id: second.id }), 'not-found')
  // With a password, the only passkey can go.
  const adas = await w.addPasskey('ada')
  assert.deepEqual((await w.service.remove(w.as('ada'), { id: adas.id })).remaining, [])
  assert.deepEqual(w.audits.map((entry) => entry.type),
    ['passkey-added', 'passkey-added', 'passkey-renamed', 'passkey-removed', 'passkey-added', 'passkey-removed'])
  // A guest has no list; an SSO-linked account sees why it cannot add one.
  await refuses(w.service.list(w.as('gus')), 'sign-in')
  assert.deepEqual(await w.service.list(w.as('sso')).then((l) => [l.available, l.reason]), [false, 'sso-linked'])
  assert.deepEqual(await makeWorld({ ssoOnly: true }).service.list(w.as('ada')).then((l) => [l.available, l.reason]), [false, 'sso-only'])
  assert.deepEqual(await makeWorld({ rootUrl: 'http://boards.example.com' }).service.list(w.as('ada')).then((l) => [l.available, l.reason, l.rpId]), [false, 'off', null])
})

test('self-host addresses: a passkey made on one install never signs in on another, a team address or a custom domain', async () => {
  const acme = makeWorld({ rootUrl: 'https://acme.slatebox.team' })
  const globex = makeWorld({ rootUrl: 'https://globex.slatebox.team' })
  await acme.addPasskey('ada')
  assert.equal((await acme.signIn('c1')).userId, 'ada')
  // The same device, the same passkey, presented to the other team's server (its RP ID and origin).
  globex.passkeys.set('copied', [...acme.passkeys.values()][0])
  globex.users.get('ada').services.passkey = acme.users.get('ada').services.passkey
  await refuses(globex.signIn('c1', undefined, acme.device), 'invalid')
  const custom = makeWorld({ rootUrl: 'https://boards.example.com' })
  const options = await custom.service.registerOptions(custom.as('ada'))
  assert.equal(options.rp.id, 'boards.example.com')
  await custom.service.register(custom.as('ada'), { response: custom.device.create(options) })
  assert.equal((await custom.signIn('c1')).userId, 'ada')
  const local = makeWorld({ rootUrl: 'http://localhost:7070' })
  await local.addPasskey('ada')
  assert.equal((await local.signIn('c1')).userId, 'ada')
})

// ---- review fixes: takeover before sign-up, saving order, removals at once ----

test("someone who saves a guest with another person's address keeps no way in once the owner resets or uses a sign-in link", async () => {
  const w = makeWorld()
  // The attacker's guest, saved with the victim's address and the attacker's passkey.
  const options = await w.service.claimOptions(w.as('gus'), { email: 'victim@example.com' })
  await w.service.claim(w.as('gus'), { response: w.device.create(options), email: 'victim@example.com' })
  assert.equal((await w.signIn('c-attacker')).userId, 'gus')
  // A passkey added to an account whose address is confirmed is not marked.
  await w.addPasskey('ada', { on: createAuthenticator({ origin: ORIGIN }) })
  assert.equal([...w.passkeys.values()].find((doc) => doc.userId === 'ada').addedUnverified, undefined)
  // The real owner resets the password (or opens an emailed sign-in link): the attacker's passkey goes.
  assert.equal(await w.service.removeAddedUnverified({ userId: 'gus', reason: 'password-reset' }), 1)
  assert.equal([...w.passkeys.values()].filter((doc) => doc.userId === 'gus').length, 0)
  await refuses(w.signIn('c-attacker-2'), 'unknown-passkey')
  assert.ok(w.audits.some((entry) => entry.type === 'passkey-removed' && entry.userId === 'gus' && entry.reason === 'password-reset'))
  assert.ok(w.logs.some((line) => /removed 1 passkey of account gus added before its address was confirmed \(password-reset\)/.test(line)))
  // Only those: Ada's passkey stays, and nobody is a no-op.
  assert.equal(await w.service.removeAddedUnverified({ userId: 'ada', reason: 'sign-in-link' }), 0)
  assert.equal([...w.passkeys.values()].filter((doc) => doc.userId === 'ada').length, 1)
  assert.equal(await w.service.removeAddedUnverified({}), 0)
  // A passkey added from the profile while the address is still unconfirmed is marked the same way.
  w.users.set('una', { _id: 'una', emails: [{ address: 'una@example.com', verified: false }], profile: {}, services: { password: { bcrypt: 'h' } } })
  await w.addPasskey('una', { on: createAuthenticator({ origin: ORIGIN }) })
  assert.equal([...w.passkeys.values()].find((doc) => doc.userId === 'una').addedUnverified, true)
  // The wiring: a password reset and both kinds of emailed sign-in link call it.
  const meteor = read('server/passkeys/meteor.js')
  assert.match(meteor, /Accounts\.onLogin\(async \(attempt\) => \{\n\s+if \(attempt\?\.methodName === 'resetPassword' && attempt\.user\?\._id\) await removePasskeysAddedUnverified\(attempt\.user\._id, 'password-reset'\)/)
  const users = read('server/methods/users.js')
  const link = users.slice(users.indexOf('CONSTANTS.methods.users.attemptLoginWithLink'), users.indexOf('CONSTANTS.methods.users.extractUserAndOrgNamesByResetToken'))
  assert.equal(link.match(/await removePasskeysAddedUnverified\(ll\.userId, 'sign-in-link'\)/g)?.length, 2, 'the plain link and the Pro-move link')
})

test('saving a guest with a passkey never leaves an account with no way in: the passkey goes back if the save fails', async () => {
  for (const claimFails of [true, 'throw']) {
    const w = makeWorld({ claimFails })
    const options = await w.service.claimOptions(w.as('gus'), { email: 'gus@example.com' })
    const saving = w.service.claim(w.as('gus'), { response: w.device.create(options), email: 'gus@example.com' })
    if (claimFails === 'throw') await assert.rejects(saving, /E11000/)
    else await refuses(saving, 'not-guest')
    assert.equal(w.passkeys.size, 0, 'the passkey stored first was taken back')
    assert.equal(w.users.get('gus').isAnonymous, true)
    assert.ok(w.users.get('gus').services.password, "the guest keeps its own password")
    assert.ok(!w.audits.some((entry) => entry.type === 'passkey-account-saved'))
    assert.deepEqual(w.verifications, [])
  }
  // The passkey is stored before the account is saved.
  const core = read('server/passkeys/core.mjs')
  const claim = core.slice(core.indexOf('async claim('), core.indexOf('async list('))
  assert.ok(claim.indexOf('await keep(') < claim.indexOf('await users.claim('))
})

test('two removals at once never leave an account with no way in', async () => {
  const w = makeWorld()
  const one = await w.addPasskey('pia', { name: 'Phone' })
  const two = await w.addPasskey('pia', { name: 'Laptop', on: createAuthenticator({ origin: ORIGIN }) })
  const results = await Promise.allSettled([
    w.service.remove(w.as('pia', 'tab-1'), { id: one.id }),
    w.service.remove(w.as('pia', 'tab-2'), { id: two.id }),
  ])
  const left = [...w.passkeys.values()].filter((doc) => doc.userId === 'pia')
  assert.ok(left.length >= 1, 'a passkey is still there')
  const refused = results.filter((result) => result.status === 'rejected')
  assert.ok(refused.length >= 1)
  for (const result of refused) assert.equal(result.reason.code, 'last-way-in')
  // The one put back still signs in.
  for (const doc of left) assert.ok(doc.publicKey && doc.credentialId)
  assert.equal(w.audits.filter((entry) => entry.type === 'passkey-removed').length, results.length - refused.length)
})

// ---- the wiring ----

test('meteor.js: the login handler, every method, its rate limits, and two never-published collections', () => {
  const meteor = read('server/passkeys/meteor.js')
  assert.match(meteor, /Accounts\.registerLoginHandler\('passkey', async function passkeyLogin\(options\)/)
  assert.match(meteor, /if \(!options \|\| typeof options\.passkey !== 'object' \|\| options\.passkey === null\) return undefined/)
  assert.match(meteor, /passkeys\.login\(\{ connectionId: this\.connection\?\.id \|\| null \}, options\.passkey\)/)
  for (const key of Object.keys(METHODS)) assert.match(meteor, new RegExp(`\\[METHODS\\.${key}\\]\\(`), key)
  assert.match(meteor, /new Mongo\.Collection\('passkeys'\)/)
  assert.match(meteor, /new Mongo\.Collection\('passkeyChallenges'\)/)
  assert.match(meteor, /createIndex\(\{ credentialId: 1 \}, \{ unique: true \}\)/)
  assert.match(meteor, /createIndex\(\{ expiresAt: 1 \}, \{ expireAfterSeconds: 0 \}\)/)
  assert.match(meteor, /findOneAndDelete\(\{ _id: key \}\)/)
  // Derived from ROOT_URL and the settings, never from a request.
  assert.match(meteor, /relyingParty\(\{ rootUrl: Meteor\.absoluteUrl\(\), settings: Meteor\.settings \}\)/)
  assert.doesNotMatch(read('server/passkeys/core.mjs') + meteor, /\breq\b|headers|httpHeaders|x-forwarded/i)
  // Every method has a per-connection limit; the ones anyone may call, a per-address one too.
  const limited = RATE_LIMITS.map(([name]) => name)
  assert.deepEqual([...limited].sort(), Object.values(METHODS).sort())
  for (const [name, count, ms, extra] of RATE_LIMITS) {
    assert.ok(count > 0 && count <= 30 && ms === 60_000, name)
    if ([METHODS.loginOptions, METHODS.claimOptions, METHODS.claim].includes(name)) assert.ok(extra?.clientAddress > 0, name)
  }
  assert.match(meteor, /DDPRateLimiter\.addRule\(\{ type: 'method', name, connectionId: \(\) => true \}, count, interval\)/)
  assert.match(meteor, /DDPRateLimiter\.addRule\(\{ type: 'method', name, clientAddress: \(\) => true \}, extra\.clientAddress, interval\)/)
  // No publication anywhere serves either collection, and the account's own fields leave out services.
  for (const file of walk('server')) {
    const source = read(file)
    if (!/Meteor\.publish\(/.test(source)) continue
    assert.doesNotMatch(source, /Passkeys\.find|PasskeyChallenges|'passkeys'/, file)
  }
  assert.doesNotMatch(read('server/publications.js').slice(read('server/publications.js').indexOf('publications.users.me'), read('server/publications.js').indexOf('publications.users.me') + 600), /services/)
  assert.doesNotMatch(read('imports/api/common/models.js'), /passkey/i, 'the collections are server-only')
  assert.match(read('server/main.js'), /import '\.\/passkeys\/meteor'/)
  // The method names are the app's constants.
  const constants = read('imports/api/common/constants.js')
  for (const name of Object.values(METHODS)) assert.ok(constants.includes(`'${name}'`), name)
})

test('single sign-on keeps its rules: SSO only refuses passkeys everywhere; a linked account never uses one; a passkey is a credential', async () => {
  for (const name of CLOSED_UNDER_SSO_ONLY) assert.ok(policy.METHODS_CLOSED_UNDER_SSO_ONLY.includes(name), name)
  const passkey = { type: 'passkey', methodName: 'login', allowed: true, user: { _id: 'ada' } }
  assert.match(policy.loginRefusal(passkey, { only: true }), /single sign-on/i)
  assert.equal(policy.loginRefusal(passkey, { only: false }), null)
  assert.equal(policy.loginRefusal(passkey, null), null)
  const linked = { ...passkey, user: { _id: 'sso', services: { sso: { issuer: 'kc', subject: 's' } } } }
  assert.match(policy.loginRefusal(linked, { only: false }), /single sign-on/i)
  // A passkey-only account with an unverified address is in use: an IdP identity with that address cannot take it.
  const identity = ssoAccounts.ssoIdentity({ sub: 'kc-1', email: 'pia@example.com', email_verified: true }, 'kc')
  const pia = { _id: 'pia', emails: [{ address: 'pia@example.com', verified: false }], services: {} }
  assert.equal(ssoAccounts.hasCredentials(pia, { passkeys: 1 }), true)
  assert.equal(ssoAccounts.decideAccount(identity, { byEmail: pia, byEmailPasskeys: 1 }).action, 'refuse')
  assert.equal(ssoAccounts.decideAccount(identity, { byEmail: pia, byEmailPasskeys: 0 }).action, 'link', 'an unused invitation still links')
  // Linking (and a refused session) removes the account's passkeys with its other credentials.
  const calls = []
  const collection = (name) => ({ updateAsync: async (...args) => calls.push([name, ...args]), removeAsync: async (...args) => calls.push([name, ...args]) })
  await ssoAccounts.revokeCredentials({ apiTokens: collection('t'), loginLinks: collection('l'), apiLinks: collection('a'), passkeys: collection('p') }, 'pia', 1)
  assert.deepEqual(calls.at(-1), ['p', { userId: 'pia' }])
  const index = read('server/sso/index.js')
  assert.match(index, /const credentials = \{ apiTokens: SlateApiTokens, loginLinks: LoginLinks, apiLinks: APILinks, passkeys: Passkeys \}/)
  // Restated (team connections): one count of an account's credentials serves the server's own connection and the teams'.
  assert.match(index, /passkeys: await Passkeys\.find\(\{ userId: user\._id \}\)\.countAsync\(\)/)
  assert.match(index, /decideAccount\(identity, \{ bySubject, byEmail, byEmailApiTokens: counts\.apiTokens, byEmailPasskeys: counts\.passkeys, domains: sso\.domains \}\)/)
  assert.match(index, /decideTeamAccount\(identity, \{ connection, bySubject, byEmail, byEmailApiTokens: counts\.apiTokens, byEmailPasskeys: counts\.passkeys \}\)/)
})

test('a removed account takes its passkeys; a team export and a Cloud move never carry them; MIT core imports no enterprise code', () => {
  const users = read('server/methods/users.js')
  const removal = users.slice(users.indexOf('CONSTANTS.methods.users.delete'), users.indexOf('CONSTANTS.methods.users.changeRoles'))
  assert.match(removal, /await removePasskeysOf\(user\._id\)/)
  assert.ok(removal.indexOf('removePasskeysOf') < removal.indexOf('Meteor.users.removeAsync'))
  for (const file of [...walk('server/team-export'), ...walk('server/selfhost-options')]) assert.doesNotMatch(read(file), /passkey/i, file)
  assert.match(read('server/team-export/format.mjs'), /'services',/, 'services (and the passkey user handle in it) is scrubbed')
  for (const file of [...walk('server/passkeys'), 'imports/ui/passkeys/passkeys.js', 'imports/ui/passkeys/PasskeySignIn.jsx', 'imports/ui/passkeys/passkey-copy.mjs',
    'imports/ui/components/profile/SignInSettings.jsx']) {
    assert.doesNotMatch(read(file), /from ['"][^'"]*enterprise|require\(['"][^'"]*enterprise/, file)
  }
  const pkg = JSON.parse(read('package.json'))
  assert.match(pkg.dependencies['@simplewebauthn/server'], /^\^14\./)
  assert.match(pkg.dependencies['@simplewebauthn/browser'], /^\^14\./)
})
