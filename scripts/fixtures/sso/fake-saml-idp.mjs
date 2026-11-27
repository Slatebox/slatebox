// A fake SAML identity provider for the unit tests: a signing key and a self-signed certificate made
// when the test starts (nothing secret is kept in the repository), and SAML responses with an
// assertion signed the way Okta and Entra ID sign them (enveloped, exclusive c14n, RSA-SHA256).
import { webcrypto, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const app = fileURLToPath(new URL('../../../web/app/', import.meta.url))
const { SignedXml } = await import(app + 'node_modules/xml-crypto/lib/index.js')
// @peculiar/x509 (from @simplewebauthn/server) makes the certificate; it needs the reflect polyfill first.
await import(app + 'node_modules/reflect-metadata/Reflect.js')
const x509 = await import(app + 'node_modules/@peculiar/x509/build/x509.es.js')
x509.cryptoProvider.set(webcrypto)

const pem = (label, der) => `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`

export async function makeSigner(name = 'Slatebox unit test IdP') {
  const alg = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 }
  const keys = await webcrypto.subtle.generateKey(alg, true, ['sign', 'verify'])
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomBytes(8).toString('hex'), name: `CN=${name}`, notBefore: new Date(Date.now() - 86400_000), notAfter: new Date(Date.now() + 365 * 86400_000), signingAlgorithm: alg, keys,
  })
  return { cert: cert.toString('pem'), key: pem('PRIVATE KEY', await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)) }
}

const instant = (ms) => new Date(ms).toISOString()

/** A SAML Response (not base64 yet). Each option changes one thing a test refuses. */
export function responseXml({
  idpEntityId, spEntityId, acsUrl, inResponseTo, nameId = 'okta-user-1', email = 'ada@acme.test', now = Date.now(),
  audience = spEntityId, recipient = acsUrl, notOnOrAfter = now + 5 * 60_000, assertionId = `_a${randomBytes(12).toString('hex')}`,
  issuer = idpEntityId, attributes = { email },
}) {
  const subjectData = `<saml:SubjectConfirmationData NotOnOrAfter="${instant(notOnOrAfter)}" Recipient="${recipient}"${inResponseTo ? ` InResponseTo="${inResponseTo}"` : ''}/>`
  const attrs = Object.entries(attributes).map(([key, value]) => `<saml:Attribute Name="${key}"><saml:AttributeValue>${value}</saml:AttributeValue></saml:Attribute>`).join('')
  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomBytes(12).toString('hex')}" Version="2.0" IssueInstant="${instant(now)}" Destination="${acsUrl}"${inResponseTo ? ` InResponseTo="${inResponseTo}"` : ''}>`
    + `<saml:Issuer>${issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>`
    + `<saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="${instant(now)}"><saml:Issuer>${issuer}</saml:Issuer>`
    + `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">${nameId}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">${subjectData}</saml:SubjectConfirmation></saml:Subject>`
    + `<saml:Conditions NotBefore="${instant(now - 60_000)}" NotOnOrAfter="${instant(notOnOrAfter)}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>`
    + `<saml:AuthnStatement AuthnInstant="${instant(now)}" SessionIndex="_s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`
    + `<saml:AttributeStatement>${attrs}</saml:AttributeStatement></saml:Assertion></samlp:Response>`
}

/** Sign the assertion in a response (enveloped signature after its Issuer). */
export function signAssertion(xml, { key, cert }) {
  const sig = new SignedXml({ privateKey: key, publicCert: cert })
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
  })
  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#'
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' } })
  return sig.getSignedXml()
}

export const b64 = (xml) => Buffer.from(xml).toString('base64')
