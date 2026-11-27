// SAML 2.0 for a team's connection, on @node-saml/node-saml (the maintained core of passport-saml).
//   SP entity ID   https://<host>/sso/saml/<connection id>
//   ACS            POST https://<host>/sso/saml/<connection id>/acs
//   metadata       https://<host>/sso/saml/<connection id>/metadata
// The assertion must be signed with the certificate the team admin saved, for this SP (audience and
// recipient), from the IdP's entity ID, current (60 s of clock skew), and in answer to a request this
// server made (InResponseTo, kept 10 minutes in ssoRequests): sign-ins the IdP starts on its own are
// refused (Okta and Entra app tiles point at /sso/start?c=<id> instead). Each assertion ID is
// accepted once. AuthnRequests are not signed and encrypted assertions are not offered.
//
// The request record carries the sign-in's browser binding and where to return to, so the answer
// to someone else's request cannot sign this browser in. No Meteor import: unit-tested with node.
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml'
import { randomBytes } from 'node:crypto'
import { bindingFor, safeNext, SsoError, validVerifier } from './oidc.mjs'

export const REQUEST_TTL_MS = 10 * 60_000
const CLOCK_SKEW_MS = 60_000
const EMAIL_ATTRIBUTES = [
  'email', 'mail', 'urn:oid:0.9.2342.19200300.100.1.3',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
]
const EMAIL_FORMAT = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'

/**
 * The request and replay cache node-saml needs, over a store with
 *   put(key, value, expiresAt)  putIfAbsent(key, value, expiresAt) → boolean
 *   get(key) → value | null     take(key) → value | null (atomic)     remove(key)
 * Keys are prefixed per connection, so a request id from one connection never answers another.
 */
export function samlCache(store, connectionId, { now = Date.now, ttlMs = REQUEST_TTL_MS, record } = {}) {
  const key = (name) => `saml:${connectionId}:${name}`
  const taken = {}
  return {
    taken,
    async saveAsync(name, value) {
      // node-saml keeps the request's time; the request's own record (binding, next) sits beside it
      const expiresAt = new Date(now() + ttlMs)
      await store.put(key(`${name}:record`), JSON.stringify(record || {}), expiresAt)
      await store.put(key(name), value, expiresAt)
      return { value, createdAt: now() }
    },
    async getAsync(name) { return store.get(key(name)) },
    async removeAsync(name) {
      if (name) { await store.remove(key(name)); await store.remove(key(`${name}:record`)) }
      return name
    },
    async consumeAsync(name) {
      const value = await store.take(key(name))
      const kept = await store.take(key(`${name}:record`))
      if (value && kept) taken.request = JSON.parse(kept)
      return value
    },
    async saveIfAbsentAsync(name, value, expiresAtMs) {
      return store.putIfAbsent(key(`assertion:${name}`), value, new Date(Math.max(expiresAtMs, now() + ttlMs)))
    },
  }
}

/** A store in this process only (tests). */
export function memorySamlStore({ now = Date.now } = {}) {
  const items = new Map()
  const live = (k) => {
    const item = items.get(k)
    if (!item) return null
    if (item.expiresAt.getTime() < now()) { items.delete(k); return null }
    return item.value
  }
  return {
    items,
    async put(k, value, expiresAt) { items.set(k, { value, expiresAt }) },
    async putIfAbsent(k, value, expiresAt) {
      if (live(k) !== null) return false
      items.set(k, { value, expiresAt })
      return true
    },
    async get(k) { return live(k) },
    async take(k) { const value = live(k); items.delete(k); return value },
    async remove(k) { items.delete(k) },
  }
}

/** The same store over a Mongo collection (the raw driver collection of ssoRequests; TTL on expiresAt). */
export function mongoSamlStore(collection, { now = Date.now } = {}) {
  const fresh = (doc) => (doc && doc.expiresAt.getTime() >= now() ? doc.value : null)
  return {
    async put(k, value, expiresAt) { await collection.replaceOne({ _id: k }, { value, expiresAt }, { upsert: true }) },
    async putIfAbsent(k, value, expiresAt) {
      try {
        await collection.insertOne({ _id: k, value, expiresAt })
        return true
      } catch (error) {
        if (error?.code === 11000) return false
        throw error
      }
    },
    async get(k) { return fresh(await collection.findOne({ _id: k })) },
    async take(k) {
      const result = await collection.findOneAndDelete({ _id: k })
      return fresh(result && Object.hasOwn(result, 'ok') && Object.hasOwn(result, 'value') ? result.value : result)
    },
    async remove(k) { await collection.deleteOne({ _id: k }) },
  }
}

export const spEntityId = (origin, connection) => `${String(origin).replace(/\/$/, '')}/sso/saml/${connection._id}`
export const acsUrl = (origin, connection) => `${spEntityId(origin, connection)}/acs`

function samlFor(connection, { origin, cacheProvider, requestId }) {
  const entityId = spEntityId(origin, connection)
  return new SAML({
    issuer: entityId,
    callbackUrl: acsUrl(origin, connection),
    entryPoint: connection.saml.ssoUrl,
    idpCert: connection.saml.certs,
    idpIssuer: connection.saml.idpEntityId,
    audience: entityId,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    acceptedClockSkewMs: CLOCK_SKEW_MS,
    validateInResponseTo: ValidateInResponseTo.always,
    rejectReplayedAssertions: true,
    requestIdExpirationPeriodMs: REQUEST_TTL_MS,
    cacheProvider,
    identifierFormat: null,
    disableRequestedAuthnContext: true,
    ...(requestId && { generateUniqueId: () => requestId }),
  })
}

/** The SP metadata XML a team admin uploads to their IdP. */
export function spMetadata(connection, { origin }) {
  return samlFor(connection, { origin, cacheProvider: samlCache(memorySamlStore(), connection._id) }).generateServiceProviderMetadata(null, null)
}

/**
 * Start a SAML sign-in: the IdP address to send the browser to (HTTP-Redirect binding). The request
 * is remembered with the tab's binding (the hash of its verifier) and where to return to.
 */
export async function beginSamlSignIn({ connection, origin, store, next, verifier, extra = {}, now = Date.now }) {
  if (!validVerifier(verifier)) throw new SsoError('no-binding', 'the sign-in was not started from the sign-in page')
  const requestId = `_${randomBytes(20).toString('hex')}`
  const record = { ...extra, binding: bindingFor(verifier), next: safeNext(next), connectionId: connection._id }
  const cacheProvider = samlCache(store, connection._id, { now, record })
  const url = await samlFor(connection, { origin, cacheProvider, requestId }).getAuthorizeUrlAsync('', { additionalParams: {} })
  return { url, requestId }
}

function firstString(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.find((item) => typeof item === 'string') || ''
  return ''
}

/** The address a validated assertion names: the admin's attribute, a usual email attribute, or an email NameID. */
export function samlEmail(profile, connection) {
  const names = connection.saml.emailAttribute ? [connection.saml.emailAttribute] : EMAIL_ATTRIBUTES
  for (const name of names) {
    const value = firstString(profile?.[name]).trim()
    if (value.includes('@')) return value.toLowerCase()
  }
  if (profile?.nameIDFormat === EMAIL_FORMAT && String(profile.nameID || '').includes('@')) return String(profile.nameID).trim().toLowerCase()
  return ''
}

/**
 * Finish a SAML sign-in from the ACS POST body. Returns the claims (subject: the NameID, email,
 * names), the binding and where to return to, or throws SsoError('saml').
 */
export async function completeSamlSignIn({ connection, origin, store, body, now = Date.now }) {
  if (typeof body?.SAMLResponse !== 'string' || !body.SAMLResponse || body.SAMLResponse.length > 500_000) {
    throw new SsoError('saml', 'no SAML response')
  }
  const cacheProvider = samlCache(store, connection._id, { now })
  let profile
  try {
    ({ profile } = await samlFor(connection, { origin, cacheProvider }).validatePostResponseAsync({ SAMLResponse: body.SAMLResponse }))
  } catch (error) {
    throw new SsoError('saml', error?.message || 'the SAML response was refused')
  }
  const request = cacheProvider.taken.request
  if (!profile || !request?.binding) throw new SsoError('saml', 'the response does not answer a sign-in started here')
  // The bearer confirmation must name this ACS as its recipient (SAML profiles 4.1.4.2): node-saml
  // checks the audience, not the recipient. Read from the verified assertion only.
  const recipients = [...String(profile.getAssertionXml?.() || '').matchAll(/<(?:\w+:)?SubjectConfirmationData\b[^>]*\bRecipient="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
  if (!recipients.length || recipients.some((r) => r !== acsUrl(origin, connection))) throw new SsoError('saml', 'the assertion is for another recipient')
  if (request.connectionId !== connection._id) throw new SsoError('saml', 'the response answers another connection')
  const subject = String(profile.nameID || '').trim()
  if (!subject) throw new SsoError('saml', 'the assertion names no subject')
  return {
    claims: {
      sub: subject,
      email: samlEmail(profile, connection),
      given_name: firstString(profile.givenName ?? profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'] ?? profile.firstName),
      family_name: firstString(profile.sn ?? profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'] ?? profile.lastName),
    },
    next: request.next,
    binding: request.binding,
    started: request,
  }
}
