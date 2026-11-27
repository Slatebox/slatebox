// Passkeys: sign in to Slatebox with a passkey (WebAuthn) instead of, or beside, a password.
// No Meteor import: unit-tested with node (scripts/passkeys.test.mjs). server/passkeys/meteor.js
// wires it to Mongo, the methods and Accounts.registerLoginHandler('passkey').
//
// The relying party (the site a passkey belongs to) is the exact host of the server's ROOT_URL:
// app.slatebox.com, test.slatebox.com, <name>.slatebox.team, a custom domain, or localhost. Never a
// shared parent (slatebox.com, slatebox.team): any sibling host could then ask for another install's
// passkeys. It never comes from the request, so a forged Host header changes nothing.
//
// Challenges are kept on the server (passkeyChallenges, by hash), used once, and expire after
// CHALLENGE_TTL_MS. User verification is required in every ceremony; attestation is 'none'.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server'

export const CHALLENGE_TTL_MS = 5 * 60 * 1000
// How long the browser shows its passkey prompt (the challenge outlives it a little).
export const CEREMONY_TIMEOUT_MS = 4 * 60 * 1000
export const MAX_PASSKEYS = 20
export const NAME_MAX = 60
export const PURPOSES = Object.freeze(['register', 'login', 'claim'])

// Parents that several installs or deployments share: never a relying party ID, even by override.
export const SHARED_PARENTS = Object.freeze(['slatebox.com', 'slatebox.team'])

export const METHODS = Object.freeze({
  available: 'passkeys.available',
  loginOptions: 'passkeys.loginOptions',
  registerOptions: 'passkeys.registerOptions',
  register: 'passkeys.register',
  claimOptions: 'passkeys.claimOptions',
  claim: 'passkeys.claim',
  list: 'passkeys.list',
  rename: 'passkeys.rename',
  remove: 'passkeys.remove',
})

// [method, calls, per milliseconds], per connection; the anonymous ones also per client address.
// The 'login' method itself keeps Meteor's own limit, and every passkey sign-in needs a
// loginOptions challenge first, so this list bounds passkey sign-ins too.
export const RATE_LIMITS = Object.freeze([
  [METHODS.available, 30, 60_000],
  [METHODS.loginOptions, 20, 60_000, { clientAddress: 60 }],
  [METHODS.registerOptions, 10, 60_000],
  [METHODS.register, 10, 60_000],
  [METHODS.claimOptions, 10, 60_000, { clientAddress: 30 }],
  [METHODS.claim, 10, 60_000, { clientAddress: 30 }],
  [METHODS.list, 30, 60_000],
  [METHODS.rename, 20, 60_000],
  [METHODS.remove, 20, 60_000],
])

// Under "SSO only" single sign-on is the way in: these are closed for everyone (sso/policy.mjs).
// list and remove stay open, so an account can still see and remove what it has.
export const CLOSED_UNDER_SSO_ONLY = Object.freeze([METHODS.loginOptions, METHODS.registerOptions, METHODS.register, METHODS.claimOptions, METHODS.claim])

// What people read. Plain words, "passkey", US spelling.
export const COPY = Object.freeze({
  off: 'Passkeys are not available on this server.',
  'sso-only': 'This Slatebox uses single sign-on. Choose "Sign in with SSO".',
  'sso-linked': 'This account signs in with single sign-on, so it cannot add a passkey.',
  'sign-in': 'Sign in first.',
  guest: 'Save your work first, then add a passkey.',
  'not-guest': 'This account is already saved. Add a passkey from your profile.',
  disabled: 'This account is turned off. Ask your administrator.',
  'not-set-up': 'This server is not set up yet. Open the setup link first.',
  'email-invalid': 'Enter a valid email address.',
  'email-taken': 'There is already an account with that email. Sign in to it instead.',
  'too-many': `You have ${MAX_PASSKEYS} passkeys, the most an account can have. Remove one first.`,
  challenge: 'That passkey request expired or was already used. Try again.',
  'already-added': 'That passkey is already on your account.',
  'unknown-passkey': 'That passkey is not on any account here. Sign in another way, then add it from your profile.',
  'user-verification': 'Your device did not confirm it was you. Try again and unlock with your fingerprint, face, PIN or screen lock.',
  counter: 'That passkey looks copied, so it was refused. Sign in another way and remove it from your profile.',
  invalid: 'That passkey could not be checked. Try again.',
  'name-invalid': `Give the passkey a name of 1 to ${NAME_MAX} characters.`,
  'not-found': 'That passkey is not on your account.',
  'last-way-in': 'This is your only way to sign in. Add another passkey or set a password first.',
})

export class PasskeyError extends Error {
  constructor(code, message = COPY[code] || COPY.invalid) {
    super(message)
    this.code = code
  }
}
const fail = (code) => { throw new PasskeyError(code) }

// ---- the relying party -----------------------------------------------------------------------

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const isLocal = (host) => host === 'localhost' || host.endsWith('.localhost')
// A native Android app's origin: the exact prefix, then 43 base64url characters (32 bytes, no padding).
export const ANDROID_APP_ORIGIN = /^android:apk-key-hash:[A-Za-z0-9_-]{43}$/
const coveredBy = (host, rpId) => host === rpId || host.endsWith('.' + rpId)

function parseOrigin(value) {
  let url
  try { url = new URL(String(value)) } catch { return null }
  if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return null
  const host = url.hostname.toLowerCase()
  if (url.protocol === 'https:' || (url.protocol === 'http:' && isLocal(host))) return { origin: url.origin, host }
  return null
}

/**
 * The relying party for this server, from ROOT_URL and settings (never from a request):
 * { rpId, rpName, origins, ignored } or { off: reason }.
 * - rpId is ROOT_URL's exact host. settings.passkeys.rpId may name a parent of it (an unusual proxy
 *   setup), but never a shared parent (SHARED_PARENTS), a bare name, or anything ROOT_URL's host is
 *   not under.
 * - origins: ROOT_URL's origin, then settings.public.baseUrl and settings.passkeys.extraOrigins when
 *   each is https (http only on localhost), has no path, and its host is the rpId or under it. Any
 *   other is left out and named in `ignored`.
 * - Then the Slatebox app's Android builds: settings.mobile.android.passkeyOrigins, each exactly
 *   android:apk-key-hash:<the signing certificate's SHA-256, base64url without padding>, the origin
 *   Android's Credential Manager sends for a native app. Anything else there is left out and named in
 *   `ignored`. The rpId does not change (the app proves it may use it through assetlinks.json).
 * - Off when settings.passkeys.enabled is false, ROOT_URL is missing or plain http off localhost,
 *   or its host is an IP address (WebAuthn does not allow one).
 */
export function relyingParty({ rootUrl, settings = {} } = {}) {
  const conf = settings?.passkeys && typeof settings.passkeys === 'object' ? settings.passkeys : {}
  if (conf.enabled === false) return { off: 'passkeys.enabled is false in the settings' }
  const root = rootUrl ? parseOrigin(String(rootUrl).replace(/\/+$/, '/')) : null
  if (!root) return { off: 'ROOT_URL must be an https:// address (http:// only on localhost) with no path' }
  const host = root.host
  if (IPV4.test(host) || host.includes(':') || host.startsWith('[')) return { off: 'ROOT_URL is an IP address; passkeys need a host name' }
  let rpId = host
  if (conf.rpId !== undefined && conf.rpId !== null && conf.rpId !== '') {
    const wanted = String(conf.rpId).trim().toLowerCase()
    if (!coveredBy(host, wanted)) return { off: `passkeys.rpId "${wanted}" is not ${host} or a parent of it` }
    if (wanted !== host && SHARED_PARENTS.includes(wanted)) return { off: `passkeys.rpId "${wanted}" is shared with other installs; use ${host}` }
    if (!wanted.includes('.') && wanted !== 'localhost') return { off: `passkeys.rpId "${wanted}" is not a host name` }
    rpId = wanted
  }
  const origins = [root.origin]
  const ignored = []
  const extra = Array.isArray(conf.extraOrigins) ? conf.extraOrigins : []
  for (const candidate of [settings?.public?.baseUrl, ...extra]) {
    if (candidate === undefined || candidate === null || candidate === '') continue
    const parsed = parseOrigin(String(candidate).replace(/\/+$/, '/'))
    if (!parsed || !coveredBy(parsed.host, rpId)) { ignored.push(String(candidate)); continue }
    if (!origins.includes(parsed.origin)) origins.push(parsed.origin)
  }
  const apps = settings?.mobile?.android?.passkeyOrigins
  ;(Array.isArray(apps) ? apps : []).forEach((candidate) => {
    if (typeof candidate !== 'string' || !ANDROID_APP_ORIGIN.test(candidate)) ignored.push(String(candidate))
    else if (!origins.includes(candidate)) origins.push(candidate)
  })
  const rpName = typeof conf.rpName === 'string' && conf.rpName.trim() ? conf.rpName.trim().slice(0, 64) : 'Slatebox'
  return { rpId, rpName, origins, ignored }
}

// ---- challenges -------------------------------------------------------------------------------

export const newChallenge = (random = randomBytes) => Buffer.from(random(32)).toString('base64url')
export const challengeKey = (challenge) => createHash('sha256').update(String(challenge)).digest('base64url')

/** The stored record: the challenge's hash only, who and what it is for, and when it expires. */
export function challengeRecord({ challenge, purpose, userId = null, connectionId = null, email = null, now = Date.now(), ttlMs = CHALLENGE_TTL_MS }) {
  if (!PURPOSES.includes(purpose)) throw new Error(`unknown passkey purpose ${purpose}`)
  return {
    _id: challengeKey(challenge),
    purpose,
    userId,
    connectionId,
    ...(email ? { email } : {}),
    createdAt: new Date(now),
    expiresAt: new Date(now + ttlMs),
  }
}

/** The challenge a browser response answers (from its clientDataJSON), or null. */
export function challengeOf(response) {
  const data = response?.response?.clientDataJSON
  if (typeof data !== 'string' || data.length > 4096) return null
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
    return typeof parsed?.challenge === 'string' && parsed.challenge ? parsed.challenge : null
  } catch {
    return null
  }
}

/** Whether a taken (already deleted) record is the one this ceremony needs. */
export function challengeFits(record, { purpose, userId = null, connectionId = null, email = null, now = Date.now() }) {
  if (!record || record.purpose !== purpose) return false
  if (!(record.expiresAt instanceof Date) || record.expiresAt.getTime() <= now) return false
  if ((record.connectionId || null) !== (connectionId || null)) return false
  if ((record.userId || null) !== (userId || null)) return false
  if (purpose === 'claim' && (record.email || null) !== (email || null)) return false
  return true
}

// ---- counters and results ---------------------------------------------------------------------

/**
 * The signature counter rule (WebAuthn §7.2 step 21). A synced passkey always reports 0 and has
 * never counted, so 0 after 0 is never refused. A counter that has started counting must go up:
 * one at or below the stored value, 0 included, may be a copied authenticator (a copy can write
 * any count it likes), so that sign-in is refused and the passkey flagged.
 */
export function counterDecision(stored, reported) {
  const before = Number.isInteger(stored) && stored > 0 ? stored : 0
  const now = Number.isInteger(reported) && reported > 0 ? reported : 0
  if (now > before) return { ok: true, counter: now }
  if (before === 0) return { ok: true, counter: 0 }
  return { ok: false, counter: before, flag: 'counter-regressed' }
}

/** A failed SimpleWebAuthn verification, as one of COPY's codes. */
export function failureCode(error) {
  const message = String(error?.message || '')
  if (/user verification|could not be verified/i.test(message)) return 'user-verification'
  if (/challenge/i.test(message)) return 'challenge'
  return 'invalid'
}

// Names for the passkey providers people use most, by AAGUID; anything else is "Passkey".
export const PROVIDERS = Object.freeze({
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
  'adce0002-35bc-c60a-648b-0b25f1f05503': 'Chrome on Mac',
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain',
  'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': 'iCloud Keychain',
  '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
  '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello',
  '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
  'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
  'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
  '531126d6-e717-415c-9320-3d9aa6981239': 'Dashlane',
  '53414d53-554e-4700-0000-000000000000': 'Samsung Pass',
  '50726f74-6f6e-5061-7373-50726f746f6e': 'Proton Pass',
  'fdb141b2-5d84-443e-8a35-4698c205a502': 'KeePassXC',
})

/** A name a person gave, tidied; null when there is nothing left or it is too long. */
export function cleanName(value) {
  if (typeof value !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const name = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return name && name.length <= NAME_MAX ? name : null
}

export const defaultName = (aaguid) => PROVIDERS[String(aaguid || '').toLowerCase()] || 'Passkey'

export function hasPassword(user) {
  const password = user?.services?.password
  return Boolean(password?.bcrypt || password?.argon2 || password?.srp)
}

/** The passkey as its owner sees it (Profile › Sign-in): never the key itself. */
export function passkeySummary(doc) {
  return {
    id: doc._id,
    credentialId: doc.credentialId,
    name: doc.name,
    createdAt: doc.createdAt,
    lastUsedAt: doc.lastUsedAt || null,
    backedUp: Boolean(doc.backedUp),
    deviceType: doc.deviceType || null,
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const cleanEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '')
const sameBytes = (a, b) => {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}
const displayName = (user, email) =>
  `${user?.profile?.firstName || ''} ${user?.profile?.lastName || ''}`.trim() || email

// ---- the ceremonies, over injected stores ------------------------------------------------------

/**
 * The passkey methods, over stores meteor.js supplies (and the tests supply in memory):
 * - rp(): relyingParty(...)            - ssoOnly(): whether the server is "SSO only"
 * - users: { get(id), byEmail(email), setHandle(id, handle) -> handle, claim(id, { email, firstName, lastName }) -> bool }
 * - passkeys: { insert(doc), byUser(userId), byCredentialId(id), update(id, set), remove(id, userId) -> count }
 * - challenges: { insert(record), take(key) -> record | null }   (take deletes: used once)
 * - setupRequired(), sendVerification(userId), notifyAdded(user, passkey), audit(entry), log(line)
 * Each method throws PasskeyError (code + the words to show) when it refuses.
 */
export function createPasskeys(deps) {
  const {
    rp, ssoOnly = () => false, users, passkeys, challenges,
    setupRequired = async () => false, sendVerification = async () => true, notifyAdded = async () => {},
    audit = async () => {}, log = () => {}, now = Date.now, random = randomBytes, newId = () => random(12).toString('hex'),
  } = deps

  const party = () => {
    const value = rp()
    if (!value || value.off) fail('off')
    return value
  }

  async function account(userId, { guest = false } = {}) {
    if (typeof userId !== 'string' || !userId) fail('sign-in')
    const user = await users.get(userId)
    if (!user) fail('sign-in')
    if (user.isDisabled) fail('disabled')
    if (guest && !user.isAnonymous) fail('not-guest')
    if (!guest && user.isAnonymous) fail('guest')
    if (user.services?.sso) fail('sso-linked')
    return user
  }

  async function handleFor(user) {
    const existing = user.services?.passkey?.userHandle
    if (typeof existing === 'string' && existing) return existing
    return users.setHandle(user._id, Buffer.from(random(32)).toString('base64url'))
  }

  async function issue({ purpose, userId = null, connectionId = null, email = null, make }) {
    const challenge = newChallenge(random)
    // The library takes the challenge as bytes and sends their base64url: the same string as ours.
    const options = await make(Buffer.from(challenge, 'base64url'))
    if (options.challenge !== challenge) throw new Error('passkey options carry another challenge')
    await challenges.insert(challengeRecord({ challenge, purpose, userId, connectionId, email, now: now() }))
    return options
  }

  async function take(response, fits) {
    const challenge = challengeOf(response)
    if (!challenge) fail('challenge')
    const record = await challenges.take(challengeKey(challenge))
    if (!challengeFits(record, { ...fits, now: now() })) fail('challenge')
    return challenge
  }

  function creationOptions(rpValue, user, handle, email, existing) {
    return (challenge) => generateRegistrationOptions({
      rpName: rpValue.rpName,
      rpID: rpValue.rpId,
      userName: email,
      userID: Buffer.from(handle, 'base64url'),
      userDisplayName: displayName(user, email),
      challenge,
      timeout: CEREMONY_TIMEOUT_MS,
      attestationType: 'none',
      excludeCredentials: existing.map((doc) => ({ id: doc.credentialId, transports: doc.transports || [] })),
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    })
  }

  async function verifyNew(rpValue, response, challenge) {
    let result
    try {
      result = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: rpValue.origins,
        expectedRPID: rpValue.rpId,
        requireUserVerification: true,
      })
    } catch (error) {
      log(`registration refused: ${error?.message}`)
      fail(failureCode(error))
    }
    if (!result?.verified || !result.registrationInfo) fail('invalid')
    const info = result.registrationInfo
    if (!info.userVerified) fail('user-verification')
    if (await passkeys.byCredentialId(info.credential.id)) fail('already-added')
    return info
  }

  // addedUnverified: added while the account's address was not confirmed, so possibly by someone
  // who does not own it (a guest saved with another person's address). When the address is
  // proven later (a password reset, an emailed sign-in link), such passkeys go: see
  // removeAddedUnverified.
  async function keep(userId, info, givenName, { addedUnverified = false } = {}) {
    const at = new Date(now())
    const doc = {
      _id: newId(),
      userId,
      credentialId: info.credential.id,
      publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
      counter: info.credential.counter || 0,
      transports: Array.isArray(info.credential.transports) ? info.credential.transports.slice(0, 8) : [],
      aaguid: info.aaguid,
      deviceType: info.credentialDeviceType,
      backedUp: Boolean(info.credentialBackedUp),
      name: cleanName(givenName) || defaultName(info.aaguid),
      createdAt: at,
      lastUsedAt: null,
      ...(addedUnverified ? { addedUnverified: true } : {}),
    }
    await passkeys.insert(doc)
    return doc
  }

  return {
    /** Whether this server offers passkeys at all (the sign-in page's button, the account form's choice). */
    available() {
      const value = rp()
      return Boolean(value && !value.off) && !ssoOnly()
    },

    /** Options for a passkey sign-in (the button, or the browser's autofill). Null when passkeys are off. */
    async loginOptions({ connectionId } = {}) {
      const rpValue = rp()
      if (!rpValue || rpValue.off) return null
      if (ssoOnly()) fail('sso-only')
      return issue({
        purpose: 'login',
        connectionId,
        make: (challenge) => generateAuthenticationOptions({ rpID: rpValue.rpId, allowCredentials: [], userVerification: 'required', challenge, timeout: CEREMONY_TIMEOUT_MS }),
      })
    },

    /** The account a passkey sign-in is for: { userId }. For the 'passkey' login handler. */
    async login({ connectionId } = {}, response) {
      const rpValue = party()
      if (ssoOnly()) fail('sso-only')
      const challenge = await take(response, { purpose: 'login', connectionId })
      const credentialId = typeof response?.id === 'string' ? response.id : ''
      const doc = credentialId && await passkeys.byCredentialId(credentialId)
      if (!doc) fail('unknown-passkey')
      const user = await users.get(doc.userId)
      if (!user || user.isAnonymous || user.services?.sso) fail('unknown-passkey')
      if (user.isDisabled) fail('disabled')
      const handle = user.services?.passkey?.userHandle
      const given = response?.response?.userHandle
      if (!handle || (given !== undefined && given !== null && !sameBytes(given, handle))) fail('unknown-passkey')
      let result
      try {
        result = await verifyAuthenticationResponse({
          response,
          expectedChallenge: challenge,
          expectedOrigin: rpValue.origins,
          expectedRPID: rpValue.rpId,
          // The counter rule is counterDecision's, not the library's: 0 here turns its check off.
          credential: { id: doc.credentialId, publicKey: Buffer.from(doc.publicKey, 'base64url'), counter: 0, transports: doc.transports },
          requireUserVerification: true,
        })
      } catch (error) {
        log(`sign-in refused for passkey ${doc._id}: ${error?.message}`)
        fail(failureCode(error))
      }
      if (!result?.verified) fail('invalid')
      if (!result.authenticationInfo.userVerified) fail('user-verification')
      const decision = counterDecision(doc.counter, result.authenticationInfo.newCounter)
      const set = { counter: decision.counter, backedUp: Boolean(result.authenticationInfo.credentialBackedUp) }
      if (decision.flag) {
        set.counterFlag = decision.flag
        set.counterFlaggedAt = new Date(now())
        log(`passkey ${doc._id} of account ${doc.userId}: ${decision.flag} (stored ${doc.counter}, reported ${result.authenticationInfo.newCounter})`)
      }
      if (!decision.ok) {
        await passkeys.update(doc._id, set)
        await audit({ type: 'passkey-refused', userId: doc.userId, passkeyId: doc._id, reason: decision.flag })
        fail('counter')
      }
      await passkeys.update(doc._id, { ...set, lastUsedAt: new Date(now()) })
      return { userId: doc.userId, passkeyId: doc._id }
    },

    /** Options to add a passkey to the signed-in account. */
    async registerOptions({ userId, connectionId } = {}) {
      const rpValue = party()
      if (ssoOnly()) fail('sso-only')
      const user = await account(userId)
      const existing = await passkeys.byUser(user._id)
      if (existing.length >= MAX_PASSKEYS) fail('too-many')
      const email = user.emails?.[0]?.address || ''
      const handle = await handleFor(user)
      return issue({ purpose: 'register', userId: user._id, connectionId, make: creationOptions(rpValue, user, handle, email, existing) })
    },

    /** Add the passkey the browser made: the new passkey as Profile › Sign-in lists it. */
    async register({ userId, connectionId } = {}, { response, name } = {}) {
      const rpValue = party()
      if (ssoOnly()) fail('sso-only')
      const user = await account(userId)
      const challenge = await take(response, { purpose: 'register', userId: user._id, connectionId })
      if ((await passkeys.byUser(user._id)).length >= MAX_PASSKEYS) fail('too-many')
      const info = await verifyNew(rpValue, response, challenge)
      const doc = await keep(user._id, info, name, { addedUnverified: user.emails?.[0]?.verified !== true })
      await audit({ type: 'passkey-added', userId: user._id, passkeyId: doc._id })
      await notifyAdded(user, doc)
      return passkeySummary(doc)
    },

    /** Options for a guest saving their account with a passkey instead of a password (sign-up too). */
    async claimOptions({ userId, connectionId } = {}, { email } = {}) {
      const rpValue = party()
      if (ssoOnly()) fail('sso-only')
      const user = await account(userId, { guest: true })
      if (await setupRequired()) fail('not-set-up')
      const address = cleanEmail(email)
      if (!EMAIL.test(address) || address.length > 254) fail('email-invalid')
      const other = await users.byEmail(address)
      if (other && other._id !== user._id) fail('email-taken')
      const handle = await handleFor(user)
      return issue({ purpose: 'claim', userId: user._id, connectionId, email: address, make: creationOptions(rpValue, user, handle, address, []) })
    },

    /**
     * Save the guest's account with the passkey the browser made: the guest's slates and first-run
     * answer stay, the address waits for its verification email, and no password is set (the
     * guest's random one is removed: nobody knows it). Returns what sendVerification returns.
     */
    async claim({ userId, connectionId } = {}, { response, email, firstName, lastName, name } = {}) {
      const rpValue = party()
      if (ssoOnly()) fail('sso-only')
      const user = await account(userId, { guest: true })
      if (await setupRequired()) fail('not-set-up')
      const address = cleanEmail(email)
      if (!EMAIL.test(address)) fail('email-invalid')
      const challenge = await take(response, { purpose: 'claim', userId: user._id, connectionId, email: address })
      const info = await verifyNew(rpValue, response, challenge)
      const other = await users.byEmail(address)
      if (other && other._id !== user._id) fail('email-taken')
      const text = (value) => (typeof value === 'string' ? value.trim().slice(0, 100) : '')
      // The passkey first, then the account: if either step fails, the guest stays a guest with
      // its own password, never a saved account with no way in.
      const doc = await keep(user._id, info, name, { addedUnverified: true })
      let claimed = false
      try {
        claimed = await users.claim(user._id, { email: address, firstName: text(firstName), lastName: text(lastName) })
      } finally {
        if (!claimed) await passkeys.remove(doc._id, user._id)
      }
      if (!claimed) fail('not-guest')
      await audit({ type: 'passkey-account-saved', userId: user._id, passkeyId: doc._id })
      return sendVerification(user._id)
    },

    /** Profile › Sign-in: the account's passkeys, and what the browser needs to keep its list in step. */
    async list({ userId } = {}) {
      if (typeof userId !== 'string' || !userId) fail('sign-in')
      const user = await users.get(userId)
      if (!user || user.isAnonymous) fail('sign-in')
      const rpValue = rp()
      const docs = await passkeys.byUser(user._id)
      let reason = null
      if (!rpValue || rpValue.off) reason = 'off'
      else if (ssoOnly()) reason = 'sso-only'
      else if (user.services?.sso) reason = 'sso-linked'
      return {
        available: reason === null,
        // why passkeys cannot be added here, when they cannot
        reason,
        rpId: rpValue && !rpValue.off ? rpValue.rpId : null,
        userHandle: user.services?.passkey?.userHandle || null,
        hasPassword: hasPassword(user),
        passkeys: docs.map(passkeySummary).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
      }
    },

    async rename({ userId } = {}, { id, name } = {}) {
      if (typeof userId !== 'string' || !userId) fail('sign-in')
      const clean = cleanName(name)
      if (!clean) fail('name-invalid')
      const doc = (await passkeys.byUser(userId)).find((entry) => entry._id === id)
      if (!doc) fail('not-found')
      await passkeys.update(doc._id, { name: clean })
      await audit({ type: 'passkey-renamed', userId, passkeyId: doc._id })
      return passkeySummary({ ...doc, name: clean })
    },

    /** Remove a passkey, unless it is the last way in: { remaining } lists the credential IDs kept. */
    async remove({ userId } = {}, { id } = {}) {
      if (typeof userId !== 'string' || !userId) fail('sign-in')
      const user = await users.get(userId)
      if (!user || user.isAnonymous) fail('sign-in')
      const docs = await passkeys.byUser(user._id)
      const doc = docs.find((entry) => entry._id === id)
      if (!doc) fail('not-found')
      const others = docs.filter((entry) => entry._id !== doc._id)
      const needsOne = !hasPassword(user) && !user.services?.sso
      if (!others.length && needsOne) fail('last-way-in')
      if (!await passkeys.remove(doc._id, user._id)) fail('not-found')
      // Two removals at once (two tabs) each saw the other passkey: count again, and put this one
      // back if it left no way in.
      const left = needsOne ? await passkeys.byUser(user._id) : others
      if (needsOne && !left.length) {
        await passkeys.insert(doc)
        fail('last-way-in')
      }
      await audit({ type: 'passkey-removed', userId: user._id, passkeyId: doc._id })
      return { removed: doc.credentialId, remaining: left.map((entry) => entry.credentialId) }
    },

    /**
     * Someone just proved they own the account's address (a password reset, an emailed sign-in
     * link): remove the passkeys added before the address was confirmed. One may belong to whoever
     * saved a guest with this address first; a reset would replace their password, so it removes
     * their passkey too. Returns how many went.
     */
    async removeAddedUnverified({ userId, reason } = {}) {
      if (typeof userId !== 'string' || !userId) return 0
      const docs = (await passkeys.byUser(userId)).filter((doc) => doc.addedUnverified === true)
      let removed = 0
      for (const doc of docs) {
        if (!await passkeys.remove(doc._id, userId)) continue
        removed += 1
        await audit({ type: 'passkey-removed', userId, passkeyId: doc._id, reason: reason || 'address-proven' })
      }
      if (removed) log(`removed ${removed} passkey${removed === 1 ? '' : 's'} of account ${userId} added before its address was confirmed (${reason || 'address-proven'})`)
      return removed
    },
  }
}
