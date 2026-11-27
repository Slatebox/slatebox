// Passkeys, the core (web/app/server/passkeys/core.mjs): which relying party and origins a server
// accepts, the challenge lifecycle, the signature-counter rule, and how a failed check reads. Plain
// node: core.mjs has no Meteor import. The ceremonies end to end, with a software authenticator,
// are in passkeys-methods.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const core = await import('../web/app/server/passkeys/core.mjs')
const { relyingParty, challengeRecord, challengeKey, challengeOf, challengeFits, counterDecision, failureCode, cleanName, defaultName,
  hasPassword, passkeySummary, newChallenge, CHALLENGE_TTL_MS, SHARED_PARENTS, COPY, PasskeyError } = core

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0)

// ---- the relying party ----

test('the relying party is the exact host of ROOT_URL: Cloud, test, a team address, a custom domain, localhost', () => {
  for (const [rootUrl, rpId, origin] of [
    ['https://app.slatebox.com/', 'app.slatebox.com', 'https://app.slatebox.com'],
    ['https://test.slatebox.com', 'test.slatebox.com', 'https://test.slatebox.com'],
    ['https://acme.slatebox.team/', 'acme.slatebox.team', 'https://acme.slatebox.team'],
    ['https://Boards.Example.COM', 'boards.example.com', 'https://boards.example.com'],
    ['https://boards.example.com:8443/', 'boards.example.com', 'https://boards.example.com:8443'],
    ['http://localhost:3000/', 'localhost', 'http://localhost:3000'],
    ['http://localhost:7070', 'localhost', 'http://localhost:7070'],
  ]) {
    const rp = relyingParty({ rootUrl })
    assert.equal(rp.off, undefined, rootUrl)
    assert.equal(rp.rpId, rpId, rootUrl)
    assert.deepEqual(rp.origins, [origin], rootUrl)
    assert.equal(rp.rpName, 'Slatebox')
  }
})

test('a shared parent is never the relying party: test and Cloud, and two team addresses, never share passkeys', () => {
  assert.deepEqual([...SHARED_PARENTS].sort(), ['slatebox.com', 'slatebox.team'])
  const cloud = relyingParty({ rootUrl: 'https://app.slatebox.com' })
  const test = relyingParty({ rootUrl: 'https://test.slatebox.com' })
  const acme = relyingParty({ rootUrl: 'https://acme.slatebox.team' })
  const globex = relyingParty({ rootUrl: 'https://globex.slatebox.team' })
  assert.notEqual(cloud.rpId, test.rpId)
  assert.notEqual(acme.rpId, globex.rpId)
  // Not even by override.
  assert.match(relyingParty({ rootUrl: 'https://acme.slatebox.team', settings: { passkeys: { rpId: 'slatebox.team' } } }).off, /shared/)
  assert.match(relyingParty({ rootUrl: 'https://app.slatebox.com', settings: { passkeys: { rpId: 'slatebox.com' } } }).off, /shared/)
  // An install whose own host is a shared parent keeps it (it is that host, not a parent of it).
  assert.equal(relyingParty({ rootUrl: 'https://slatebox.com' }).rpId, 'slatebox.com')
})

test('an rpId override must be the host or a parent of it, and a host name', () => {
  assert.equal(relyingParty({ rootUrl: 'https://boards.example.com', settings: { passkeys: { rpId: 'example.com' } } }).rpId, 'example.com')
  assert.equal(relyingParty({ rootUrl: 'https://boards.example.com', settings: { passkeys: { rpId: 'boards.example.com' } } }).rpId, 'boards.example.com')
  assert.match(relyingParty({ rootUrl: 'https://boards.example.com', settings: { passkeys: { rpId: 'other.com' } } }).off, /not boards\.example\.com or a parent/)
  assert.match(relyingParty({ rootUrl: 'https://boards.example.com', settings: { passkeys: { rpId: 'ample.com' } } }).off, /not boards\.example\.com/)
  assert.match(relyingParty({ rootUrl: 'https://boards.example.com', settings: { passkeys: { rpId: 'com' } } }).off, /not a host name/)
})

test('passkeys are off without a secure host name: plain http off localhost, an IP address, no ROOT_URL, a path, or turned off', () => {
  for (const rootUrl of ['http://boards.example.com', 'http://192.168.1.20:7070', 'https://10.0.0.5', 'https://[::1]:3000', '', undefined, 'not a url',
    'https://boards.example.com/slatebox/', 'ftp://boards.example.com']) {
    assert.ok(relyingParty({ rootUrl }).off, String(rootUrl))
  }
  assert.match(relyingParty({ rootUrl: 'https://app.slatebox.com', settings: { passkeys: { enabled: false } } }).off, /enabled is false/)
})

test('origins: ROOT_URL first, then baseUrl and extraOrigins only when https, pathless and on the relying party; never from a request', () => {
  const rp = relyingParty({
    rootUrl: 'https://boards.example.com',
    settings: {
      public: { baseUrl: 'https://boards.example.com/' },
      passkeys: { rpId: 'example.com', extraOrigins: ['https://www.example.com', 'http://www.example.com', 'https://evil.com', 'https://example.com/x', 'https://sub.www.example.com'] },
    },
  })
  assert.deepEqual(rp.origins, ['https://boards.example.com', 'https://www.example.com', 'https://sub.www.example.com'])
  assert.deepEqual(rp.ignored, ['http://www.example.com', 'https://evil.com', 'https://example.com/x'])
  // A baseUrl on another host (a misconfiguration) is left out, not trusted.
  const other = relyingParty({ rootUrl: 'https://acme.slatebox.team', settings: { public: { baseUrl: 'https://app.slatebox.com' } } })
  assert.deepEqual(other.origins, ['https://acme.slatebox.team'])
  assert.deepEqual(other.ignored, ['https://app.slatebox.com'])
})

// ---- challenges ----

test('a challenge is stored by its hash only, with its purpose, its account or connection, and a five-minute expiry', () => {
  const challenge = newChallenge()
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/, '32 random bytes, base64url')
  assert.notEqual(newChallenge(), challenge)
  const record = challengeRecord({ challenge, purpose: 'login', connectionId: 'c1', now: NOW })
  assert.equal(record._id, createHash('sha256').update(challenge).digest('base64url'))
  assert.equal(record._id, challengeKey(challenge))
  assert.ok(!JSON.stringify(record).includes(challenge), 'the challenge itself is not stored')
  assert.deepEqual({ ...record, createdAt: +record.createdAt, expiresAt: +record.expiresAt },
    { _id: record._id, purpose: 'login', userId: null, connectionId: 'c1', createdAt: NOW, expiresAt: NOW + CHALLENGE_TTL_MS })
  assert.equal(CHALLENGE_TTL_MS, 5 * 60 * 1000)
  assert.throws(() => challengeRecord({ challenge, purpose: 'anything', now: NOW }), /unknown passkey purpose/)
})

test('the challenge a response answers is read from its clientDataJSON; anything else is no challenge', () => {
  const data = (value) => ({ response: { clientDataJSON: Buffer.from(JSON.stringify(value)).toString('base64url') } })
  assert.equal(challengeOf(data({ type: 'webauthn.get', challenge: 'abc' })), 'abc')
  for (const bad of [null, {}, { response: {} }, { response: { clientDataJSON: 12 } }, { response: { clientDataJSON: '!!!' } },
    data({ challenge: '' }), data({ challenge: 5 }), { response: { clientDataJSON: 'a'.repeat(5000) } }]) {
    assert.equal(challengeOf(bad), null)
  }
})

test('a challenge fits only its own ceremony: purpose, connection, account, address, and before it expires', () => {
  const login = challengeRecord({ challenge: 'x', purpose: 'login', connectionId: 'c1', now: NOW })
  assert.equal(challengeFits(login, { purpose: 'login', connectionId: 'c1', now: NOW + 1000 }), true)
  assert.equal(challengeFits(login, { purpose: 'login', connectionId: 'c2', now: NOW + 1000 }), false, 'another connection')
  assert.equal(challengeFits(login, { purpose: 'register', connectionId: 'c1', now: NOW + 1000 }), false, 'another purpose')
  assert.equal(challengeFits(login, { purpose: 'login', connectionId: 'c1', now: NOW + CHALLENGE_TTL_MS }), false, 'expired')
  assert.equal(challengeFits(null, { purpose: 'login', connectionId: 'c1', now: NOW }), false, 'already used (taken)')
  const register = challengeRecord({ challenge: 'y', purpose: 'register', userId: 'ada', connectionId: 'c1', now: NOW })
  assert.equal(challengeFits(register, { purpose: 'register', userId: 'ada', connectionId: 'c1', now: NOW }), true)
  assert.equal(challengeFits(register, { purpose: 'register', userId: 'ben', connectionId: 'c1', now: NOW }), false, 'another account')
  const claim = challengeRecord({ challenge: 'z', purpose: 'claim', userId: 'gus', connectionId: 'c1', email: 'gus@example.com', now: NOW })
  assert.equal(challengeFits(claim, { purpose: 'claim', userId: 'gus', connectionId: 'c1', email: 'gus@example.com', now: NOW }), true)
  assert.equal(challengeFits(claim, { purpose: 'claim', userId: 'gus', connectionId: 'c1', email: 'other@example.com', now: NOW }), false, 'another address')
})

// ---- the counter ----

test('the counter: a synced passkey reports 0 and is never refused; a counting one must go up, or it is refused and flagged', () => {
  assert.deepEqual(counterDecision(0, 0), { ok: true, counter: 0 })
  assert.deepEqual(counterDecision(0, 1), { ok: true, counter: 1 })
  assert.deepEqual(counterDecision(5, 6), { ok: true, counter: 6 })
  assert.deepEqual(counterDecision(5, 100), { ok: true, counter: 100 })
  // At or below the stored value, 0 included (WebAuthn §7.2 step 21): possibly a copied authenticator.
  assert.deepEqual(counterDecision(5, 0), { ok: false, counter: 5, flag: 'counter-regressed' })
  assert.deepEqual(counterDecision(5, 5), { ok: false, counter: 5, flag: 'counter-regressed' })
  assert.deepEqual(counterDecision(5, 3), { ok: false, counter: 5, flag: 'counter-regressed' })
  // Nonsense in, the safe reading out.
  assert.deepEqual(counterDecision(undefined, undefined), { ok: true, counter: 0 })
  assert.deepEqual(counterDecision(-1, 2), { ok: true, counter: 2 })
  assert.deepEqual(counterDecision(2, 1.5), { ok: false, counter: 2, flag: 'counter-regressed' })
  assert.deepEqual(counterDecision(0, 1.5), { ok: true, counter: 0 })
})

// ---- results ----

test('a failed verification reads as one plain reason; every reason has words', () => {
  assert.equal(failureCode(new Error('User verification required, but user could not be verified')), 'user-verification')
  assert.equal(failureCode(new Error('User verification was required, but user could not be verified')), 'user-verification')
  assert.equal(failureCode(new Error('Unexpected authentication response challenge "a", expected "b"')), 'challenge')
  assert.equal(failureCode(new Error('Unexpected authentication response origin "https://evil.com", expected "https://app.slatebox.com"')), 'invalid')
  assert.equal(failureCode(new Error('Unexpected RP ID hash')), 'invalid')
  assert.equal(failureCode(undefined), 'invalid')
  for (const code of ['off', 'sso-only', 'sso-linked', 'guest', 'not-guest', 'challenge', 'unknown-passkey', 'user-verification', 'counter', 'invalid',
    'last-way-in', 'email-taken', 'too-many', 'name-invalid', 'not-found', 'disabled', 'not-set-up', 'email-invalid', 'already-added', 'sign-in']) {
    assert.ok(COPY[code], code)
    const error = new PasskeyError(code)
    assert.equal(error.code, code)
    assert.equal(error.message, COPY[code])
  }
  // Plain words: "passkey", US spelling, no shouting, no internals.
  for (const text of Object.values(COPY)) {
    assert.doesNotMatch(text, /WebAuthn|credential|FIDO|authenticator|\bAI\b|cancelled|colour|organis|recognis/i, text)
  }
})

test('names: a provider name from the AAGUID, else "Passkey"; a given name tidied and capped at 60', () => {
  assert.equal(defaultName('ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4'), 'Google Password Manager')
  assert.equal(defaultName('FBFC3007-154E-4ECC-8C0B-6E020557D7BD'), 'iCloud Keychain')
  assert.equal(defaultName('00000000-0000-0000-0000-000000000000'), 'Passkey')
  assert.equal(defaultName(undefined), 'Passkey')
  assert.equal(cleanName('  Work   laptop\n'), 'Work laptop')
  assert.equal(cleanName('a'.repeat(60)), 'a'.repeat(60))
  assert.equal(cleanName('a'.repeat(61)), null)
  assert.equal(cleanName('   '), null)
  assert.equal(cleanName(7), null)
})

test('a password counts as a way in only when one is set; a summary never carries the key', () => {
  assert.equal(hasPassword({ services: { password: { bcrypt: 'x' } } }), true)
  assert.equal(hasPassword({ services: { password: { argon2: 'x' } } }), true)
  assert.equal(hasPassword({ services: { password: {} } }), false)
  assert.equal(hasPassword({}), false)
  const summary = passkeySummary({ _id: 'p1', userId: 'ada', credentialId: 'cid', publicKey: 'SECRET-KEY', counter: 3, name: 'Phone', createdAt: new Date(NOW), aaguid: 'x', backedUp: true, deviceType: 'multiDevice' })
  assert.deepEqual(Object.keys(summary).sort(), ['backedUp', 'createdAt', 'credentialId', 'deviceType', 'id', 'lastUsedAt', 'name'])
  assert.ok(!JSON.stringify(summary).includes('SECRET-KEY'))
})
