// A team's single sign-on connections (ssoConnections): what a team admin may save, which
// connection an email address signs in with, and which address an identity provider's answer
// stands for. No Meteor import: unit-tested with node (scripts/sso-connections.test.mjs).
//
// The one safety rule: a connection signs in only addresses inside the domains its team proved it
// owns (a DNS TXT record, domains.mjs). Each preset adds its provider's own checks, because each
// provider vouches for an address differently:
//   Entra ID   the tenant-specific issuer, the tid claim must be the tenant, and the email claim
//              counts only when Entra says the domain is verified for the tenant (xms_edov);
//              otherwise the sign-in name (upn) must be in a verified domain. Entra's email claim
//              is editable by tenant admins and unverified, so trusting it alone lets one tenant
//              sign in as another tenant's people (nOAuth).
//   Google     the hd claim (the Workspace domain) must be a verified domain.
//   Okta, OIDC email_verified must be true.
//   SAML       the assertion is signed by the certificate the admin saved (saml.mjs).
import { createHash } from 'node:crypto'
import { domainRoutes } from './domains.mjs'

export const PROTOCOLS = Object.freeze(['oidc', 'saml'])
export const PRESETS = Object.freeze({
  okta: Object.freeze({ protocol: 'oidc', name: 'Okta', console: 'https://help.okta.com/en-us/content/topics/apps/apps_app_integration_wizard_oidc.htm' }),
  entra: Object.freeze({ protocol: 'oidc', name: 'Microsoft Entra ID', console: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' }),
  google: Object.freeze({ protocol: 'oidc', name: 'Google Workspace', console: 'https://console.cloud.google.com/apis/credentials' }),
  oidc: Object.freeze({ protocol: 'oidc', name: 'Other OpenID Connect', console: null }),
  saml: Object.freeze({ protocol: 'saml', name: 'SAML 2.0', console: null }),
})
export const SESSION_HOURS = Object.freeze([8, 24, 168])
export const JOIN_RULES = Object.freeze(['member', 'invited-only'])
export const MAX_BREAK_GLASS = 2
export const MAX_CONNECTIONS = 10
export const MAX_DOMAINS = 20
export const DEFAULT_POLICY = Object.freeze({ requireSso: false, breakGlass: [], joinRule: 'member', sessionHours: 24, signOutOfIdp: false })
export const ENTRA_ISSUER = (tenantId) => `https://login.microsoftonline.com/${tenantId}/v2.0`
export const GOOGLE_ISSUER = 'https://accounts.google.com'

export class SsoConfigError extends Error {}
const refuse = (message) => { throw new SsoConfigError(message) }

// Addresses anyone can get. A team cannot claim them: that would sign in strangers.
export const PUBLIC_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com', 'yahoo.com',
  'yahoo.co.uk', 'ymail.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'pm.me',
  'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru', 'mail.ru', 'qq.com',
  '163.com', '126.com', 'fastmail.com', 'hey.com', 'tutanota.com', 'tuta.io', 'duck.com',
])

const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const TENANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A domain name as stored: lower case, no dot at the end. Throws SsoConfigError. */
export function normalizeDomain(raw) {
  const domain = String(raw ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (!DOMAIN.test(domain)) refuse('Enter a domain name, such as acme.com.')
  if (PUBLIC_MAIL_DOMAINS.has(domain)) refuse(`${domain} is a public mail service: anyone can have an address there, so it cannot be a team's sign-in domain.`)
  return domain
}

export function domainOf(email) {
  const value = String(email ?? '').trim().toLowerCase()
  const at = value.lastIndexOf('@')
  return at > 0 && at < value.length - 1 ? value.slice(at + 1) : ''
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

function httpsUrl(raw, what) {
  let url
  try { url = new URL(String(raw ?? '').trim()) } catch { refuse(`${what} must be a web address.`) }
  if (url.protocol !== 'https:') refuse(`${what} must start with https://.`)
  if (url.username || url.password || url.hash) refuse(`${what} cannot carry a user name, password or #.`)
  return url
}

/** The issuer address a preset signs in with, from what the admin typed. */
export function issuerFor(preset, input) {
  if (preset === 'google') return GOOGLE_ISSUER
  if (preset === 'entra') {
    const tenantId = text(input.tenantId, 64).toLowerCase()
    if (!TENANT.test(tenantId)) refuse('Enter the directory (tenant) ID from Entra ID: a GUID such as 0b6f3c4e-…. "common" and "organizations" are not allowed.')
    return ENTRA_ISSUER(tenantId)
  }
  const url = httpsUrl(input.issuer, 'The issuer')
  return url.href.replace(/\/$/, '')
}

function pemCertificate(raw) {
  const body = String(raw ?? '').replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body) || body.length < 200 || body.length > 20000) refuse('Paste the identity provider\'s signing certificate (PEM, or the base64 inside it).')
  const lines = body.match(/.{1,64}/g).join('\n')
  return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----`
}

/**
 * What a team admin saves, checked and shaped for storage, without the secret (the caller seals
 * it: secretRequired says whether one must be there). existing: the stored connection when
 * editing one. Throws SsoConfigError with a sentence for the admin.
 */
export function connectionFields(input, { existing } = {}) {
  const preset = existing?.preset ?? input.preset
  if (!Object.hasOwn(PRESETS, preset)) refuse('Choose an identity provider.')
  if (existing?.managed) refuse('This connection is set by the server administrator and cannot be changed here.')
  const { protocol, name } = PRESETS[preset]
  const label = text(input.label, 60) || name
  const fields = { preset, protocol, label, enabled: input.enabled !== false }
  if (protocol === 'oidc') {
    const clientId = text(input.clientId, 300)
    if (!clientId) refuse('Enter the client ID (application ID) the identity provider gave Slatebox.')
    fields.oidc = { issuer: issuerFor(preset, input), clientId }
    if (preset === 'entra') fields.oidc.tenantId = text(input.tenantId, 64).toLowerCase()
    const secret = typeof input.clientSecret === 'string' ? input.clientSecret.trim() : ''
    if (secret.length > 2000) refuse('That client secret is too long.')
    return { fields, secret: secret || null, secretRequired: !existing?.oidc?.secret || existing.oidc.clientId !== clientId }
  }
  const idpEntityId = text(input.idpEntityId, 500)
  if (!idpEntityId) refuse('Enter the identity provider\'s entity ID (issuer).')
  const ssoUrl = httpsUrl(input.ssoUrl, 'The sign-in address (SSO URL)').href
  const certs = input.certificate ? [pemCertificate(input.certificate)] : existing?.saml?.certs
  if (!certs?.length) refuse('Paste the identity provider\'s signing certificate.')
  const emailAttribute = text(input.emailAttribute, 200)
  fields.saml = { idpEntityId, ssoUrl, certs, ...(emailAttribute && { emailAttribute }) }
  return { fields, secret: null, secretRequired: false }
}

/** The policy as stored, from what the admin chose. admins: the ids of the team's admins. */
export function policyFields(input, { admins = [], ownerId } = {}) {
  const policy = { ...DEFAULT_POLICY, ...input }
  const sessionHours = Number(policy.sessionHours)
  if (!SESSION_HOURS.includes(sessionHours)) refuse('Choose 8 hours, 24 hours or 7 days.')
  if (!JOIN_RULES.includes(policy.joinRule)) refuse('Choose who may join at first sign-in.')
  const breakGlass = [...new Set(Array.isArray(policy.breakGlass) ? policy.breakGlass.filter((id) => typeof id === 'string' && id) : [])]
    .filter((id) => id !== ownerId)
  if (breakGlass.length > MAX_BREAK_GLASS) refuse(`Name at most ${MAX_BREAK_GLASS} admins who may still sign in with a password. The owner always may.`)
  if (breakGlass.some((id) => !admins.includes(id))) refuse('Only team admins can keep a password sign-in.')
  return {
    requireSso: policy.requireSso === true,
    breakGlass,
    joinRule: policy.joinRule,
    sessionHours,
    signOutOfIdp: policy.signOutOfIdp === true,
  }
}

/** The domains of a connection that route sign-ins today (verified, and not failing for too long). */
export function routableDomains(connection, now = Date.now()) {
  if (!connection?.enabled) return []
  return (connection.domains || []).filter((entry) => domainRoutes(entry, now)).map((entry) => entry.domain)
}

/** The enabled connection for an address: an exact match on a verified domain, or null. */
export function connectionForEmail(email, connections, now = Date.now()) {
  const domain = domainOf(email)
  if (!domain) return null
  return (connections || []).find((c) => !c.managed && routableDomains(c, now).includes(domain)) || null
}

export const OUTSIDE_VERIFIED = 'the address is not in a domain this team has verified'

/**
 * The address an identity provider's answer signs in, for a team connection, or throws with the
 * reason (an SsoConfigError, shown to the admin in "Try it" and logged on a refused sign-in).
 * claims: the ID token claims (OIDC) or { email, emailVerified: true } (SAML, signed assertion).
 */
export function assertedEmail(connection, claims, now = Date.now()) {
  const verified = routableDomains({ ...connection, enabled: true }, now)
  const inVerified = (address) => verified.includes(domainOf(address))
  const lower = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '')
  let email = lower(claims.email)
  if (connection.protocol === 'oidc') {
    if (connection.preset === 'entra') {
      if (lower(claims.tid) !== connection.oidc.tenantId) refuse('the sign-in came from another Entra ID tenant')
      if (claims.xms_edov !== true && claims.xms_edov !== 'true' && claims.xms_edov !== 1) {
        const upn = lower(claims.upn) || lower(claims.preferred_username)
        if (!upn || !inVerified(upn)) refuse('Entra ID did not confirm the address belongs to the tenant (add the optional claim xms_edov, or sign in with an address in a verified domain)')
        email = upn
      }
    } else if (connection.preset === 'google') {
      if (!lower(claims.hd) || !verified.includes(lower(claims.hd))) refuse('the Google account is not in a Workspace domain this team has verified')
      if (claims.email_verified !== true) refuse('Google has not verified the address')
    } else if (claims.email_verified !== true && claims.email_verified !== 'true') {
      refuse('the identity provider has not verified the address (email_verified)')
    }
  }
  if (!email) refuse('the identity provider sent no email address')
  if (!inVerified(email)) refuse(OUTSIDE_VERIFIED)
  return email
}

const fingerprintOf = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 8)
export const secretFingerprint = fingerprintOf

/** The addresses an admin copies into the identity provider's console. */
export function serviceAddresses(connection, origin) {
  const base = String(origin || '').replace(/\/$/, '')
  if (connection.protocol === 'saml') {
    return {
      entityId: `${base}/sso/saml/${connection._id}`,
      acsUrl: `${base}/sso/saml/${connection._id}/acs`,
      metadataUrl: `${base}/sso/saml/${connection._id}/metadata`,
      startUrl: `${base}/sso/start?c=${connection._id}`,
    }
  }
  return {
    redirectUri: `${base}/sso/callback`,
    backchannelLogoutUri: `${base}/sso/oidc/${connection._id}/backchannel-logout`,
    startUrl: `${base}/sso/start?c=${connection._id}`,
  }
}

/** A connection as a team admin sees it: never the secret, only that one is saved and its fingerprint. */
export function describeConnection(connection, { origin, now = Date.now() } = {}) {
  const preset = PRESETS[connection.preset]
  return {
    id: connection._id,
    preset: connection.preset,
    presetName: preset?.name ?? connection.preset,
    console: preset?.console ?? null,
    protocol: connection.protocol,
    label: connection.label,
    managed: connection.managed || null,
    enabled: connection.enabled === true,
    ...(connection.oidc && {
      oidc: {
        issuer: connection.oidc.issuer,
        clientId: connection.oidc.clientId,
        ...(connection.oidc.tenantId && { tenantId: connection.oidc.tenantId }),
        secretSaved: Boolean(connection.oidc.secret),
        ...(connection.oidc.secretFingerprint && { secretFingerprint: connection.oidc.secretFingerprint }),
      },
    }),
    ...(connection.saml && {
      saml: {
        idpEntityId: connection.saml.idpEntityId,
        ssoUrl: connection.saml.ssoUrl,
        certificateFingerprints: connection.saml.certs.map(fingerprintOf),
        ...(connection.saml.emailAttribute && { emailAttribute: connection.saml.emailAttribute }),
      },
    }),
    domains: (connection.domains || []).map((entry) => ({
      domain: entry.domain,
      verified: Boolean(entry.verifiedAt),
      verifiedAt: entry.verifiedAt ? new Date(entry.verifiedAt).toISOString() : null,
      routes: domainRoutes(entry, now),
      failingSince: entry.failingSince ? new Date(entry.failingSince).toISOString() : null,
      record: { name: `_slatebox-challenge.${entry.domain}`, type: 'TXT', value: `slatebox-domain-verification=${entry.token}` },
      ...(entry.verifiedBy === 'server-admin' && { verifiedBy: 'server-admin' }),
    })),
    policy: { ...DEFAULT_POLICY, ...(connection.policy || {}) },
    addresses: serviceAddresses(connection, origin),
  }
}

/**
 * The self-hosted server's bundled Keycloak as a connection (settings.sso, SLATEBOX_SSO=keycloak).
 * It belongs to the default team, signs in with the button on the sign-in page instead of by
 * address, and keeps the server's own account rules (allowed domains, Member or invite-first).
 * Read-only in Team settings: the server administrator sets it.
 */
export const MANAGED_KEYCLOAK_ID = 'keycloak'
export function managedConnection(sso, orgId) {
  return {
    _id: MANAGED_KEYCLOAK_ID,
    managed: 'keycloak',
    orgId: orgId || null,
    protocol: 'oidc',
    preset: 'oidc',
    label: sso.label || 'Sign in with SSO',
    enabled: true,
    oidc: { issuer: sso.issuer, clientId: sso.clientId },
    domains: [],
    policy: { ...DEFAULT_POLICY },
  }
}
