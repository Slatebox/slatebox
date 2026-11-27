// SAML 2.0 for a team's connection (web/app/server/sso/saml.mjs): a response is accepted only when
// its assertion is signed with the saved certificate, for this SP, from the IdP's entity ID, current,
// and in answer to a request this server made for this browser tab; sign-ins the IdP starts on its own
// and replays are refused. The fake IdP (scripts/fixtures/sso/fake-saml-idp.mjs) signs real XML.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { b64, makeSigner, responseXml, signAssertion } from './fixtures/sso/fake-saml-idp.mjs'

const app = fileURLToPath(new URL('../web/app/', import.meta.url))
const saml = await import(app + 'server/sso/saml.mjs')
const { bindingFor } = await import(app + 'server/sso/oidc.mjs')

const ORIGIN = 'https://app.slatebox.test'
const idp = await makeSigner()
const stranger = await makeSigner('Someone else')
const connection = {
  _id: 'conn1', orgId: 'team1', protocol: 'saml', preset: 'saml', label: 'Acme SAML', enabled: true,
  saml: { idpEntityId: 'http://www.okta.com/exk-acme', ssoUrl: 'https://acme.okta.test/app/sso/saml', certs: [idp.cert] },
  domains: [{ domain: 'acme.test', verifiedAt: new Date() }],
}
const spEntityId = saml.spEntityId(ORIGIN, connection)
const acsUrl = saml.acsUrl(ORIGIN, connection)
const verifier = 'v'.repeat(43)

async function started(store = saml.memorySamlStore()) {
  const { url, requestId } = await saml.beginSamlSignIn({ connection, origin: ORIGIN, store, next: '/canvas/x', verifier })
  return { store, url: new URL(url), requestId }
}
const respond = (store, xml) => saml.completeSamlSignIn({ connection, origin: ORIGIN, store, body: { SAMLResponse: b64(xml) } })
const good = (requestId, extra = {}) => signAssertion(responseXml({ idpEntityId: connection.saml.idpEntityId, spEntityId, acsUrl, inResponseTo: requestId, ...extra }), idp)

test('the sign-in goes to the IdP with a request this server remembers for the tab', async () => {
  const { url, requestId, store } = await started()
  assert.equal(url.origin + url.pathname, connection.saml.ssoUrl)
  assert.ok(url.searchParams.get('SAMLRequest'))
  assert.match(requestId, /^_[0-9a-f]{40}$/)
  const kept = JSON.parse(await store.get(`saml:conn1:${requestId}:record`))
  assert.equal(kept.binding, bindingFor(verifier))
  assert.equal(kept.next, '/canvas/x')
  await assert.rejects(saml.beginSamlSignIn({ connection, origin: ORIGIN, store, next: '/', verifier: 'short' }), { code: 'no-binding' })
})

test('a signed assertion answering our request signs in its NameID with its email, once', async () => {
  const { store, requestId } = await started()
  const xml = good(requestId)
  const result = await respond(store, xml)
  assert.equal(result.claims.sub, 'okta-user-1')
  assert.equal(result.claims.email, 'ada@acme.test')
  assert.equal(result.binding, bindingFor(verifier))
  assert.equal(result.next, '/canvas/x')
  await assert.rejects(respond(store, xml), { code: 'saml' }, 'the same response again is refused')
})

test('unsigned, wrongly signed, or wrapped (XSW) assertions are refused', async () => {
  let { store, requestId } = await started()
  await assert.rejects(respond(store, responseXml({ idpEntityId: connection.saml.idpEntityId, spEntityId, acsUrl, inResponseTo: requestId })), { code: 'saml' }, 'unsigned')
  ;({ store, requestId } = await started())
  await assert.rejects(respond(store, signAssertion(responseXml({ idpEntityId: connection.saml.idpEntityId, spEntityId, acsUrl, inResponseTo: requestId }), stranger)), { code: 'saml' }, 'another key')
  // Signature wrapping: a signed assertion for ada, and an unsigned one for the attacker placed first.
  ;({ store, requestId } = await started())
  const signed = good(requestId)
  const evil = responseXml({ idpEntityId: connection.saml.idpEntityId, spEntityId, acsUrl, inResponseTo: requestId, nameId: 'attacker', email: 'boss@acme.test' })
  const evilAssertion = evil.slice(evil.indexOf('<saml:Assertion'), evil.indexOf('</samlp:Response>'))
  const wrapped = signed.replace('<saml:Assertion', `${evilAssertion}<saml:Assertion`)
  await assert.rejects(respond(store, wrapped), { code: 'saml' }, 'two assertions')
  // the signed one tucked inside the unsigned one's Extensions-like element
  ;({ store, requestId } = await started())
  const signed2 = good(requestId)
  const inner = signed2.slice(signed2.indexOf('<saml:Assertion'), signed2.indexOf('</samlp:Response>'))
  const tucked = signed2.replace(inner, evilAssertion.replace('<saml:Subject>', `<saml:Advice>${inner}</saml:Advice><saml:Subject>`))
  await assert.rejects(respond(store, tucked), { code: 'saml' }, 'signed assertion inside an unsigned one')
})

test('wrong audience, recipient, issuer, or an expired assertion are refused', async () => {
  const cases = {
    audience: { audience: 'https://elsewhere.test/sp' },
    recipient: { recipient: 'https://elsewhere.test/acs' },
    issuer: { issuer: 'http://www.okta.com/exk-other' },
    expired: { now: Date.now() - 30 * 60_000, notOnOrAfter: Date.now() - 20 * 60_000 },
  }
  for (const [what, extra] of Object.entries(cases)) {
    const { store, requestId } = await started()
    await assert.rejects(respond(store, good(requestId, extra)), { code: 'saml' }, what)
  }
})

test('a sign-in the IdP starts on its own, or an answer to another request, is refused', async () => {
  const { store } = await started()
  await assert.rejects(respond(store, good(undefined)), { code: 'saml' }, 'IdP-initiated (no InResponseTo)')
  await assert.rejects(respond(store, good('_not-a-request-we-made')), { code: 'saml' }, 'unknown request')
  // A request of another connection does not answer this one: request ids are kept per connection.
  const other = { ...connection, _id: 'conn2' }
  const { requestId } = await saml.beginSamlSignIn({ connection: other, origin: ORIGIN, store, next: '/', verifier })
  await assert.rejects(respond(store, good(requestId)), { code: 'saml' })
})

test('the same assertion ID is accepted once, even with a fresh request', async () => {
  const first = await started()
  const assertionId = '_fixed-assertion-id'
  await respond(first.store, good(first.requestId, { assertionId }))
  const { requestId } = await saml.beginSamlSignIn({ connection, origin: ORIGIN, store: first.store, next: '/', verifier })
  await assert.rejects(respond(first.store, good(requestId, { assertionId })), { code: 'saml' })
})

test('the email comes from the admin\'s attribute, a usual one, or an email NameID', () => {
  assert.equal(saml.samlEmail({ mail: ['Ada@Acme.test'] }, connection), 'ada@acme.test')
  assert.equal(saml.samlEmail({ 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': 'ada@acme.test' }, connection), 'ada@acme.test')
  assert.equal(saml.samlEmail({ nameID: 'ada@acme.test', nameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress' }, connection), 'ada@acme.test')
  assert.equal(saml.samlEmail({ work: 'ada@acme.test', email: 'other@acme.test' }, { saml: { emailAttribute: 'work' } }), 'ada@acme.test')
  assert.equal(saml.samlEmail({ nameID: 'opaque' }, connection), '')
})

test('the SP metadata names the entity ID and the ACS', () => {
  const xml = saml.spMetadata(connection, { origin: ORIGIN })
  assert.match(xml, new RegExp(`entityID="${spEntityId}"`))
  assert.match(xml, new RegExp(`Location="${acsUrl}"`))
})
