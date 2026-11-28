// A team's own single sign-on (Team settings > Sign-in & security), in Slatebox Cloud and on a
// self-hosted server: what an admin may save, the domains a team proves it owns, which connection
// an address signs in with, what each provider must vouch for, which account a sign-in reaches,
// "Require single sign-on", session length, tickets shared by several servers, and the switch that
// keeps it free. Plain modules, run with node alone.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const app = fileURLToPath(new URL('../web/app/', import.meta.url))
const read = (path) => readFileSync(app + path, 'utf8')
const connections = await import(app + 'server/sso/connections.mjs')
const domains = await import(app + 'server/sso/domains.mjs')
const accounts = await import(app + 'server/sso/accounts.mjs')
const policy = await import(app + 'server/sso/policy.mjs')
const tickets = await import(app + 'server/sso/tickets.mjs')
const { createTeamSso, TeamSsoError } = await import(app + 'server/sso/admin.mjs')
const { open } = await import(app + 'server/metering/vault.mjs')
const { teamSecurityOn, TEAM_SECURITY } = await import(app + 'imports/api/common/team-security.mjs')
const model = await import(app + 'imports/ui/components/teams/security/security-model.mjs')

const NOW = Date.UTC(2026, 10, 27, 12)
const TENANT = '0b6f3c4e-1111-2222-3333-444455556666'
const verified = (domain, extra = {}) => ({ domain, token: 't', verifiedAt: new Date(NOW - 86400_000), ...extra })
const okta = (extra = {}) => ({
  _id: 'c1', orgId: 'team1', protocol: 'oidc', preset: 'okta', label: 'Acme', enabled: true,
  oidc: { issuer: 'https://acme.okta.com', clientId: 'cid' }, domains: [verified('acme.com')], policy: { ...connections.DEFAULT_POLICY }, ...extra,
})

// ---- connections ----

test('a team cannot claim a public mail domain, and a domain is a domain', () => {
  assert.equal(connections.normalizeDomain(' Acme.COM. '), 'acme.com')
  for (const bad of ['gmail.com', 'outlook.com', 'icloud.com', 'proton.me']) assert.throws(() => connections.normalizeDomain(bad), /public mail service/, bad)
  for (const bad of ['acme', 'acme..com', 'https://acme.com', 'a@acme.com', '']) assert.throws(() => connections.normalizeDomain(bad), connections.SsoConfigError, bad)
})

test('each preset asks for what its provider needs; issuers are https; Entra is one tenant, never "common"', () => {
  const entra = connections.connectionFields({ preset: 'entra', tenantId: TENANT.toUpperCase(), clientId: 'app', clientSecret: 's' })
  assert.equal(entra.fields.oidc.issuer, `https://login.microsoftonline.com/${TENANT}/v2.0`)
  assert.equal(entra.fields.oidc.tenantId, TENANT)
  for (const tenantId of ['common', 'organizations', 'consumers', '']) {
    assert.throws(() => connections.connectionFields({ preset: 'entra', tenantId, clientId: 'app' }), /tenant/)
  }
  assert.equal(connections.connectionFields({ preset: 'google', clientId: 'g', clientSecret: 's' }).fields.oidc.issuer, 'https://accounts.google.com')
  assert.throws(() => connections.connectionFields({ preset: 'oidc', issuer: 'http://idp.acme.com', clientId: 'x' }), /https/)
  assert.throws(() => connections.connectionFields({ preset: 'okta', issuer: 'https://acme.okta.com' }), /client ID/)
  const saved = connections.connectionFields({ preset: 'okta', issuer: 'https://acme.okta.com/', clientId: 'cid', clientSecret: 'sec' })
  assert.equal(saved.fields.oidc.issuer, 'https://acme.okta.com')
  assert.equal(saved.secret, 'sec')
  assert.equal(saved.secretRequired, true)
  // editing keeps the saved secret unless the client changes
  const existing = { preset: 'okta', oidc: { clientId: 'cid', secret: { v: 1 } } }
  assert.equal(connections.connectionFields({ issuer: 'https://acme.okta.com', clientId: 'cid' }, { existing }).secretRequired, false)
  assert.equal(connections.connectionFields({ issuer: 'https://acme.okta.com', clientId: 'other' }, { existing }).secretRequired, true)
  assert.throws(() => connections.connectionFields({ preset: 'saml', idpEntityId: 'e', ssoUrl: 'https://idp/sso' }), /certificate/)
  assert.throws(() => connections.connectionFields({}, { existing: { managed: 'keycloak', preset: 'oidc' } }), /server administrator/)
})

test('an address signs in with the connection whose verified domain matches it exactly', () => {
  const list = [okta(), okta({ _id: 'c2', domains: [verified('sub.acme.com')] }), okta({ _id: 'c3', domains: [{ domain: 'beta.com', token: 't', verifiedAt: null }] })]
  assert.equal(connections.connectionForEmail('Ada@ACME.com', list, NOW)._id, 'c1')
  assert.equal(connections.connectionForEmail('ada@sub.acme.com', list, NOW)._id, 'c2')
  assert.equal(connections.connectionForEmail('ada@x.acme.com', list, NOW), null, 'no suffix matching')
  assert.equal(connections.connectionForEmail('ada@beta.com', list, NOW), null, 'not verified')
  assert.equal(connections.connectionForEmail('ada@acme.com', [okta({ enabled: false })], NOW), null, 'turned off')
  const failing = okta({ domains: [verified('acme.com', { failingSince: new Date(NOW - 8 * 86400_000) })] })
  assert.equal(connections.connectionForEmail('ada@acme.com', [failing], NOW), null, 'record gone for over seven days')
})

test('the provider must vouch for an address inside the team\'s verified domains (nOAuth and friends)', () => {
  const ok = (connection, claims) => connections.assertedEmail(connection, claims, NOW)
  assert.equal(ok(okta(), { email: 'Ada@acme.com', email_verified: true }), 'ada@acme.com')
  assert.throws(() => ok(okta(), { email: 'ada@acme.com', email_verified: false }), /email_verified/)
  assert.throws(() => ok(okta(), { email: 'ada@victim.com', email_verified: true }), new RegExp(connections.OUTSIDE_VERIFIED))
  assert.throws(() => ok(okta(), { email_verified: true }), /no email/)
  const entra = okta({ preset: 'entra', oidc: { issuer: connections.ENTRA_ISSUER(TENANT), clientId: 'app', tenantId: TENANT } })
  assert.equal(ok(entra, { tid: TENANT, email: 'ada@acme.com', xms_edov: true }), 'ada@acme.com')
  // Entra's email claim is not proof by itself: without xms_edov the UPN must be in a verified domain
  assert.equal(ok(entra, { tid: TENANT, email: 'ceo@victim.com', upn: 'ada@acme.com' }), 'ada@acme.com')
  assert.throws(() => ok(entra, { tid: TENANT, email: 'ceo@acme.com', upn: 'mallory@mallory.onmicrosoft.com' }), /xms_edov/)
  assert.throws(() => ok(entra, { tid: 'ffffffff-1111-2222-3333-444455556666', email: 'ada@acme.com', xms_edov: true }), /another Entra ID tenant/)
  const google = okta({ preset: 'google', oidc: { issuer: connections.GOOGLE_ISSUER, clientId: 'g' } })
  assert.equal(ok(google, { hd: 'acme.com', email: 'ada@acme.com', email_verified: true }), 'ada@acme.com')
  assert.throws(() => ok(google, { email: 'ada@acme.com', email_verified: true }), /Workspace/)
  assert.throws(() => ok(google, { hd: 'other.com', email: 'ada@acme.com', email_verified: true }), /Workspace/)
  const samlConnection = okta({ protocol: 'saml', preset: 'saml', oidc: undefined, saml: { certs: ['x'] } })
  assert.equal(ok(samlConnection, { email: 'ada@acme.com' }), 'ada@acme.com')
  assert.throws(() => ok(samlConnection, { email: 'ada@gmail.com' }), new RegExp(connections.OUTSIDE_VERIFIED))
})

test('what an admin sees of a connection: the addresses to copy, never the secret', () => {
  const described = connections.describeConnection(okta({ oidc: { issuer: 'https://acme.okta.com', clientId: 'cid', secret: { v: 1, data: 'sealed' }, secretFingerprint: 'abcd1234' } }), { origin: 'https://app.slatebox.com', now: NOW })
  assert.equal(described.oidc.secretSaved, true)
  assert.equal(described.oidc.secretFingerprint, 'abcd1234')
  assert.doesNotMatch(JSON.stringify(described), /sealed/)
  assert.equal(described.addresses.redirectUri, 'https://app.slatebox.com/sso/callback')
  assert.equal(described.addresses.startUrl, 'https://app.slatebox.com/sso/start?c=c1')
  assert.deepEqual(described.domains[0].record, { name: '_slatebox-challenge.acme.com', type: 'TXT', value: 'slatebox-domain-verification=t' })
  const samlAddresses = connections.serviceAddresses({ _id: 's1', protocol: 'saml' }, 'https://app.slatebox.com/')
  assert.equal(samlAddresses.acsUrl, 'https://app.slatebox.com/sso/saml/s1/acs')
  assert.deepEqual(model.copyRows({ protocol: 'saml', addresses: samlAddresses }).map((r) => r.value), [samlAddresses.acsUrl, samlAddresses.entityId, samlAddresses.metadataUrl, samlAddresses.startUrl])
})

test('the self-hosted server\'s bundled Keycloak is the default team\'s read-only connection', () => {
  const managed = connections.managedConnection({ issuer: 'https://boards.example.com/auth/realms/slatebox', clientId: 'slatebox' }, 'team1')
  assert.equal(managed._id, connections.MANAGED_KEYCLOAK_ID)
  assert.equal(managed.managed, 'keycloak')
  assert.equal(managed.orgId, 'team1')
  assert.equal(connections.connectionForEmail('ada@acme.com', [{ ...managed, domains: [verified('acme.com')] }], NOW), null, 'it signs in by its button, not by address')
  const settings = policy.ssoSettings({ sso: { enabled: true, issuer: 'https://b/auth/realms/s', clientId: 'c', clientSecret: 's', stateKey: 'k', redirectUri: 'https://b/sso/callback',
    authorizationEndpoint: 'https://b/auth/realms/s/protocol/openid-connect/auth', tokenEndpoint: 'http://127.0.0.1:8080/auth/realms/s/protocol/openid-connect/token' } })
  assert.equal(settings.jwksUri, 'http://127.0.0.1:8080/auth/realms/s/protocol/openid-connect/certs', 'its keys beside its token endpoint')
  assert.equal(settings.endSessionEndpoint, 'https://b/auth/realms/s/protocol/openid-connect/logout')
  const selfHost = read('../../self-host/rootfs/opt/slatebox/lib/sso.mjs')
  assert.match(selfHost, /jwksUri: `\$\{internal\}\/realms\/\$\{SSO_REALM\}\/protocol\/openid-connect\/certs`/)
})

// ---- domains ----

test('a domain is verified by its TXT record, stops routing after seven days without it, and an outage does not count', async () => {
  const entry = domains.newDomainEntry('acme.com', NOW, 'tok')
  const answer = (records) => async (name) => {
    assert.equal(name, '_slatebox-challenge.acme.com')
    return records
  }
  const lookup = (resolveTxt) => domains.lookupChallenge({ domain: 'acme.com', token: 'tok', resolveTxt })
  assert.equal((await lookup(answer([['slatebox-domain-verification=', 'tok']]))).status, 'found', 'chunks are joined')
  assert.equal((await lookup(answer([['slatebox-domain-verification=other']]))).status, 'missing')
  assert.equal((await lookup(async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }) })).status, 'missing')
  assert.equal((await lookup(async () => { throw Object.assign(new Error('x'), { code: 'ETIMEOUT' }) })).status, 'unknown')
  const ok = domains.afterCheck(entry, 'found', NOW)
  assert.ok(ok.verifiedAt && domains.domainRoutes(ok, NOW))
  const failing = domains.afterCheck(ok, 'missing', NOW + 1000)
  assert.ok(failing.failingSince && domains.domainRoutes(failing, NOW + 6 * 86400_000))
  assert.equal(domains.domainRoutes(failing, NOW + 8 * 86400_000), false)
  assert.equal(domains.justStoppedRouting(failing, failing, NOW + 8 * 86400_000), false)
  assert.equal(domains.afterCheck(failing, 'unknown', NOW + 2000).failingSince, failing.failingSince)
  assert.equal(domains.afterCheck(failing, 'found', NOW + 3000).failingSince, null)
  assert.equal(domains.dueForRecheck({ ...ok, lastCheckAt: new Date(NOW) }, NOW + 3600_000), false)
  assert.equal(domains.dueForRecheck({ ...ok, lastCheckAt: new Date(NOW) }, NOW + 25 * 3600_000), true)
  assert.equal(domains.dueForRecheck({ ...ok, verifiedBy: 'server-admin' }, NOW + 99 * 86400_000), false)
  assert.equal(model.domainState({ verified: false }).word, 'Not verified')
  assert.equal(model.domainState({ verified: true, routes: false }).word, 'Paused')
})

// ---- which account ----

const identity = (extra = {}) => ({ ...accounts.teamIdentity({ sub: 'okta-1', given_name: 'Ada' }, okta(), 'ada@acme.com'), ...extra })
const decide = (state, connection = okta()) => accounts.decideTeamAccount(identity(), { connection, ...state })

test('a team connection\'s identity is its own: another team saving the same provider never reaches it', () => {
  assert.equal(identity().issuer, 'sso:c1')
  assert.equal(identity().connectionId, 'c1')
  const linkedElsewhere = { _id: 'u', orgId: 'team1', services: { sso: { issuer: 'sso:c9', subject: 'okta-1' } }, emails: [{ address: 'ada@acme.com', verified: true }] }
  assert.deepEqual(decide({ byEmail: linkedElsewhere }), { action: 'refuse', reason: 'the account is linked to another single sign-on identity' })
})

test('first sign-in: a Member of the team; an account in no team joins and keeps its slates; another team is refused', () => {
  assert.deepEqual(decide({}), { action: 'create' })
  const alone = { _id: 'u1', emails: [{ address: 'ada@acme.com', verified: true }] }
  assert.deepEqual(decide({ byEmail: alone }), { action: 'link', userId: 'u1', join: true })
  assert.deepEqual(decide({ byEmail: { ...alone, orgId: 'team1' } }), { action: 'link', userId: 'u1', join: false })
  assert.deepEqual(decide({ byEmail: { ...alone, orgId: 'team2' } }), { action: 'refuse', reason: accounts.OTHER_TEAM })
  assert.equal(decide({ byEmail: { ...alone, isAnonymous: true } }).action, 'refuse')
  assert.equal(decide({ byEmail: { ...alone, isDisabled: true } }).action, 'refuse')
  // an address Slatebox never verified, on an account someone uses, is not handed over
  assert.equal(decide({ byEmail: { _id: 'u1', emails: [{ address: 'ada@acme.com' }], services: { password: { bcrypt: 'x' } } } }).action, 'refuse')
  const linked = { _id: 'u1', orgId: 'team1', services: { sso: { issuer: 'sso:c1', subject: 'okta-1' } } }
  assert.deepEqual(decide({ bySubject: linked }), { action: 'login', userId: 'u1', join: false })
  assert.deepEqual(decide({ bySubject: { ...linked, orgId: 'team2' } }), { action: 'refuse', reason: accounts.OTHER_TEAM })
  assert.deepEqual(decide({ bySubject: { ...linked, orgId: undefined } }), { action: 'login', userId: 'u1', join: true })
})

test('invited people only: an invitation (an account already in the team) gets in, nobody else', () => {
  const connection = okta({ policy: { ...connections.DEFAULT_POLICY, joinRule: 'invited-only' } })
  assert.deepEqual(decide({}, connection), { action: 'refuse', reason: accounts.INVITE_ONLY })
  const invited = { _id: 'inv', orgId: 'team1', emails: [{ address: 'ada@acme.com', verified: false }] }
  assert.deepEqual(decide({ byEmail: invited }, connection), { action: 'link', userId: 'inv', join: false })
  assert.deepEqual(decide({ byEmail: { _id: 'u', emails: [{ address: 'ada@acme.com', verified: true }] } }, connection), { action: 'refuse', reason: accounts.INVITE_ONLY })
})

test('break-glass accounts keep their password and passkeys when linked; everyone else loses them', async () => {
  const owner = { _id: 'o', orgId: 'team1', isOrgOwner: true, emails: [{ address: 'ada@acme.com' }] }
  assert.equal(accounts.isBreakGlass(owner, okta()), true)
  assert.equal(accounts.isBreakGlass({ _id: 'a2', orgId: 'team1' }, okta({ policy: { ...connections.DEFAULT_POLICY, breakGlass: ['a2'] } })), true)
  assert.equal(accounts.isBreakGlass({ _id: 'm', orgId: 'team1' }, okta()), false)
  assert.equal(accounts.isBreakGlass({ ...owner, orgId: 'team2' }, okta()), false, 'the owner of another team')
  assert.equal(accounts.linkModifier(owner, identity(), undefined, NOW, { keepPassword: true }).$unset, undefined)
  assert.deepEqual(accounts.linkModifier(owner, identity(), undefined, NOW).$unset, { 'services.password': '' })
  const removed = []
  const store = (name) => ({ updateAsync: async () => removed.push(`${name}:update`), removeAsync: async () => removed.push(`${name}:remove`) })
  await accounts.revokeCredentials({ apiTokens: store('tokens'), loginLinks: store('links'), apiLinks: store('apiLinks'), passkeys: store('passkeys') }, 'o', NOW, { keepPasskeys: true })
  assert.ok(!removed.includes('passkeys:remove'))
})

// ---- require single sign-on, sessions ----

test('"Require single sign-on" covers team members at a verified domain, never contractors, guests or break-glass accounts', () => {
  const connection = okta({ policy: { ...connections.DEFAULT_POLICY, requireSso: true } })
  const cover = (user, breakGlass = false) => policy.requireSsoCovers(user, connection, { domains: ['acme.com'], breakGlass })
  const member = { _id: 'm', orgId: 'team1', emails: [{ address: 'bo@acme.com' }] }
  assert.equal(cover(member), true)
  assert.equal(cover({ ...member, emails: [{ address: 'bo@contractor.com' }] }), false, 'a contractor')
  assert.equal(cover({ ...member, orgId: 'team2' }), false, 'someone in another team')
  assert.equal(cover({ ...member, isAnonymous: true }), false, 'a guest')
  assert.equal(cover(member, true), false, 'break-glass')
  assert.equal(policy.requireSsoCovers(member, okta(), { domains: ['acme.com'] }), false, 'not required')
  const refuse = (attempt, covered = true) => policy.teamPolicyRefusal(attempt, { covered })
  assert.equal(refuse({ type: 'password' }), policy.REQUIRE_SSO_MESSAGE)
  assert.equal(refuse({ type: 'passkey' }), policy.REQUIRE_SSO_MESSAGE)
  assert.equal(refuse({ type: 'password', methodName: 'resetPassword' }), policy.REQUIRE_SSO_MESSAGE)
  assert.equal(refuse({ type: 'sso' }), null)
  assert.equal(refuse({ type: 'resume' }), null)
  assert.equal(refuse({ type: 'password' }, false), null)
  // the linked-account rule lets a break-glass account use its password
  const linked = { user: { services: { sso: { issuer: 'sso:c1' } } }, type: 'password' }
  assert.ok(policy.loginRefusal(linked, null))
  assert.equal(policy.loginRefusal(linked, null, { breakGlass: true }), null)
})

test('a session a team connection made ends after the team\'s session length', () => {
  const loginToken = { ssoConnectionId: 'c1', when: new Date(NOW - 9 * 3600_000) }
  assert.equal(policy.ssoSessionExpired({ loginToken, sessionHours: 8, now: NOW }), true)
  assert.equal(policy.ssoSessionExpired({ loginToken, sessionHours: 24, now: NOW }), false)
  assert.equal(policy.ssoSessionExpired({ loginToken: { when: new Date(0) }, sessionHours: 8, now: NOW }), false, 'a password session')
})

test('tickets live in shared storage: issued on one server, redeemed once on another', async () => {
  const shared = tickets.memoryTicketStorage()
  const podA = tickets.createTicketStore({ storage: shared })
  const podB = tickets.createTicketStore({ storage: shared })
  const verifier = tickets.newVerifier()
  const ticket = await podA.issue('u1', tickets.bindingFor(verifier), { connectionId: 'c1' })
  assert.deepEqual(await podB.take(ticket, verifier), { userId: 'u1', connectionId: 'c1' })
  assert.equal(await podA.take(ticket, verifier), null, 'once')
  // only the ticket's hash is stored
  const stored = []
  const spy = { put: async (doc) => stored.push(doc), take: async () => null }
  const another = await tickets.createTicketStore({ storage: spy }).issue('u', 'b')
  assert.notEqual(stored[0]._id, another)
  // the Mongo storage takes in one atomic step, on drivers that answer the document or { value }
  for (const answer of [{ _id: 'h', userId: 'u' }, { ok: 1, value: { _id: 'h', userId: 'u' } }]) {
    const storage = tickets.mongoTicketStorage({ insertOne: async () => {}, findOneAndDelete: async () => answer })
    assert.equal((await storage.take('h')).userId, 'u')
  }
})

// ---- the admin service ----

function fakeStore({ teams = { team1: { admins: [{ _id: 'owner', isOrgOwner: true, email: 'o@acme.com' }, { _id: 'adm', email: 'a@acme.com' }] } } } = {}) {
  const docs = new Map()
  const claims = new Map()
  const people = new Map([
    ['owner', { _id: 'owner', orgId: 'team1', isOrgOwner: true, emails: [{ address: 'o@acme.com' }] }],
    ['adm', { _id: 'adm', orgId: 'team1', emails: [{ address: 'a@acme.com' }] }],
    ['mem', { _id: 'mem', orgId: 'team1', emails: [{ address: 'm@acme.com' }] }],
    ['contractor', { _id: 'contractor', orgId: 'team1', emails: [{ address: 'c@outside.org' }] }],
  ])
  const ended = []
  return {
    docs, claims, people, ended,
    store: {
      connections: {
        forTeam: async (orgId) => [...docs.values()].filter((d) => d.orgId === orgId),
        byId: async (id) => docs.get(id) || null,
        insert: async (doc) => docs.set(doc._id, structuredClone(doc)),
        async set(id, $set, unset = []) {
          const doc = docs.get(id)
          for (const [k, v] of Object.entries($set)) {
            if (k.includes('.')) { const [a, b] = k.split('.'); doc[a] = { ...doc[a], [b]: v } } else doc[k] = v
          }
          for (const k of unset) delete doc[k]
        },
        remove: async (id) => docs.delete(id),
        pushDomain: async (id, entry) => docs.get(id).domains.push(entry),
        setDomain: async (id, domain, entry) => { const d = docs.get(id); d.domains = d.domains.map((x) => (x.domain === domain ? entry : x)) },
        pullDomain: async (id, domain) => { const d = docs.get(id); d.domains = d.domains.filter((x) => x.domain !== domain) },
      },
      claims: {
        async claim(domain, value) {
          if (claims.has(domain)) return claims.get(domain).connectionId === value.connectionId
          claims.set(domain, value)
          return true
        },
        release: async (domain, connectionId) => { if (claims.get(domain)?.connectionId === connectionId) claims.delete(domain) },
        owner: async (domain) => claims.get(domain) || null,
      },
      people: {
        teamAdmins: async (orgId) => teams[orgId]?.admins || [],
        person: async (id) => people.get(id),
        teamMembers: async (orgId) => [...people.values()].filter((p) => p.orgId === orgId),
        endSessions: async (ids) => ended.push(...ids),
        unlinkConnection: async (id) => ended.push(`unlinked:${id}`),
      },
    },
  }
}

const master = { key: Buffer.alloc(32, 7), keyId: 'testkey1' }
let counter = 0
function service({ cloud = true, gate = true, resolveTxt, serverAdmin = false, record, ...rest } = {}) {
  const fake = fakeStore(rest)
  const sso = createTeamSso({
    store: fake.store,
    env: {
      cloud, master, origin: 'https://app.slatebox.test', now: () => NOW, newId: () => `id${++counter}`, gate: async () => gate,
      resolveTxt: resolveTxt || (async () => [['slatebox-domain-verification=never']]), serverAdmin: async () => serverAdmin, discover: async () => {},
      ...(record && { record }),
    },
  })
  return { sso, ...fake }
}
const ownerCaller = { _id: 'owner', orgId: 'team1', isOrgOwner: true, isAdmin: true }
const memberCaller = { _id: 'mem', orgId: 'team1', isOrgOwner: false, isAdmin: false }

test('only team owners and admins change sign-in; the secret is sealed for this team and connection, and never shown', async () => {
  const { sso, docs } = service()
  await assert.rejects(sso.saveConnection(memberCaller, { preset: 'okta', issuer: 'https://acme.okta.com', clientId: 'cid', clientSecret: 'shh' }), { status: 403 })
  const out = await sso.saveConnection(ownerCaller, { preset: 'okta', issuer: 'https://acme.okta.com', clientId: 'cid', clientSecret: 'shh-very-secret' })
  const doc = docs.get(out.connectionId)
  assert.doesNotMatch(JSON.stringify(out), /shh-very-secret/)
  assert.doesNotMatch(JSON.stringify(doc), /shh-very-secret/)
  assert.equal(open({ master, owner: { ownerType: 'team', ownerId: 'team1', provider: `sso:${doc._id}` }, cipher: doc.oidc.secret }), 'shh-very-secret')
  assert.throws(() => open({ master, owner: { ownerType: 'team', ownerId: 'team2', provider: `sso:${doc._id}` }, cipher: doc.oidc.secret }), 'a copy for another team does not open')
  // turning it off sends only what changes; the rest, the secret included, stays
  await sso.saveConnection(ownerCaller, { id: doc._id, enabled: false })
  assert.equal(docs.get(doc._id).enabled, false)
  assert.equal(docs.get(doc._id).oidc.clientId, 'cid')
  assert.deepEqual(docs.get(doc._id).oidc.secret, doc.oidc.secret)
  // members read; another team's connection is not reachable
  assert.equal((await sso.get(memberCaller)).connections.length, 1)
  await assert.rejects(sso.removeConnection({ ...ownerCaller, orgId: 'team2' }, { connectionId: doc._id }), { status: 404 })
})

test('removing a connection unlinks the accounts it signed in, so none is left without a way in', async () => {
  const { sso, docs, ended } = service()
  const { connectionId } = await sso.saveConnection(ownerCaller, { preset: 'okta', issuer: 'https://acme.okta.com', clientId: 'cid', clientSecret: 's' })
  await sso.removeConnection(ownerCaller, { connectionId })
  assert.equal(docs.has(connectionId), false)
  assert.deepEqual(ended, [`unlinked:${connectionId}`])
})

test('with the switch on "business", a Cloud team without Business cannot change sign-in (but nothing locks it out)', async () => {
  const { sso } = service({ gate: false })
  await assert.rejects(sso.saveConnection(ownerCaller, { preset: 'saml', idpEntityId: 'e', ssoUrl: 'https://idp/sso', certificate: 'A'.repeat(400) }), { status: 403 })
  assert.equal((await sso.get(ownerCaller)).available, false)
  assert.equal(TEAM_SECURITY.cloudPlan, 'business', 'Business on Cloud, free on self-host (owner, 2026-11-27)')
  const cloud = { public: { edition: 'cloud' } }
  assert.equal(teamSecurityOn({ settings: cloud, org: {} }), false, 'Cloud without Business: off by default')
  assert.equal(teamSecurityOn({ settings: cloud, org: {}, plan: 'free' }), true)
  assert.equal(teamSecurityOn({ settings: cloud, org: {}, plan: 'business' }), false)
  assert.equal(teamSecurityOn({ settings: cloud, org: { business: { status: 'active' } }, plan: 'business' }), true)
  assert.equal(teamSecurityOn({ settings: { public: { edition: 'self-host' } }, org: {}, plan: 'business' }), true, 'self-host: always')
})

test('a domain is verified by DNS, belongs to one team, and only a self-hosted server\'s administrator skips DNS', async () => {
  let record = 'nothing'
  const { sso, docs, claims } = service({ resolveTxt: async () => [[record]] })
  const { connectionId } = await sso.saveConnection(ownerCaller, { preset: 'okta', issuer: 'https://acme.okta.com', clientId: 'cid', clientSecret: 's' })
  await assert.rejects(sso.addDomain(ownerCaller, { connectionId, domain: 'gmail.com' }), /public mail/)
  await sso.addDomain(ownerCaller, { connectionId, domain: 'Acme.com' })
  const entry = docs.get(connectionId).domains[0]
  assert.equal(entry.domain, 'acme.com')
  assert.equal((await sso.checkDomain(ownerCaller, { connectionId, domain: 'acme.com' })).status, 'missing')
  assert.equal(claims.size, 0)
  record = `slatebox-domain-verification=${entry.token}`
  const checked = await sso.checkDomain(ownerCaller, { connectionId, domain: 'acme.com' })
  assert.equal(checked.status, 'found')
  assert.equal(checked.connections[0].domains[0].verified, true)
  assert.equal(claims.get('acme.com').orgId, 'team1')
  await assert.rejects(sso.checkDomain(ownerCaller, { connectionId, domain: 'acme.com', withoutDns: true }), { status: 403 }, 'not in Cloud')

  // another team cannot add a domain that is verified here
  const other = service({ teams: { team2: { admins: [{ _id: 'o2', isOrgOwner: true }] } } })
  other.claims.set('acme.com', { orgId: 'team1', connectionId })
  const caller2 = { _id: 'o2', orgId: 'team2', isOrgOwner: true, isAdmin: true }
  const { connectionId: c2 } = await other.sso.saveConnection(caller2, { preset: 'okta', issuer: 'https://evil.okta.com', clientId: 'x', clientSecret: 's' })
  await assert.rejects(other.sso.addDomain(caller2, { connectionId: c2, domain: 'acme.com' }), { status: 409 })

  // a self-hosted server's administrator may verify without DNS
  const selfHost = service({ cloud: false, serverAdmin: true })
  const { connectionId: c3 } = await selfHost.sso.saveConnection(ownerCaller, { preset: 'okta', issuer: 'https://idp.corp.internal.test', clientId: 'x', clientSecret: 's' })
  await selfHost.sso.addDomain(ownerCaller, { connectionId: c3, domain: 'corp.test' })
  const out = await selfHost.sso.checkDomain(ownerCaller, { connectionId: c3, domain: 'corp.test', withoutDns: true })
  assert.equal(out.connections[0].domains[0].verifiedBy, 'server-admin')

  // removing the domain releases it
  await sso.removeDomain(ownerCaller, { connectionId, domain: 'acme.com' })
  assert.equal(claims.size, 0)
})

test('requiring single sign-on needs a verified domain and an admin it works for; members it covers are signed out once', async () => {
  const { sso, docs, people, ended } = service({ resolveTxt: async () => [] })
  const { connectionId } = await sso.saveConnection(ownerCaller, { preset: 'okta', issuer: 'https://acme.okta.com', clientId: 'cid', clientSecret: 's' })
  await assert.rejects(sso.setPolicy(ownerCaller, { connectionId, requireSso: true }), /Verify a domain/)
  docs.get(connectionId).domains.push(verified('acme.com'))
  // an admin who is not break-glass and never signed in with it is stopped (no lock-out by a broken connection)
  const adminCaller = { _id: 'adm', orgId: 'team1', isOrgOwner: false, isAdmin: true }
  await assert.rejects(sso.setPolicy(adminCaller, { connectionId, requireSso: true }), /Sign in with this connection once first/)
  await assert.rejects(sso.setPolicy(ownerCaller, { connectionId, breakGlass: ['mem'] }), /Only team admins/)
  await assert.rejects(sso.setPolicy(ownerCaller, { connectionId, breakGlass: ['adm', 'x', 'y'] }), /at most 2/)
  await assert.rejects(sso.setPolicy(ownerCaller, { connectionId, sessionHours: 3 }), /8 hours/)
  const out = await sso.setPolicy(ownerCaller, { connectionId, requireSso: true, breakGlass: ['adm'], sessionHours: 8 })
  assert.equal(out.connections[0].policy.requireSso, true)
  assert.deepEqual(out.connections[0].policy.breakGlass, ['adm'])
  assert.deepEqual(ended, ['mem'], 'the member at acme.com; not the contractor, the owner or the break-glass admin')
  assert.equal(people.get('contractor').orgId, 'team1')
  // removing the last verified domain turns the requirement off
  docs.get(connectionId).domains = [verified('acme.com')]
  await sso.removeDomain(ownerCaller, { connectionId, domain: 'acme.com' })
  assert.equal(docs.get(connectionId).policy.requireSso, false)
})

test('the managed Keycloak connection is shown read-only', async () => {
  const { sso, docs } = service({ cloud: false })
  docs.set('keycloak', { ...connections.managedConnection({ issuer: 'https://b/auth/realms/s', clientId: 'slatebox' }, 'team1') })
  const view = await sso.get(ownerCaller)
  assert.equal(view.connections[0].managed, 'keycloak')
  await assert.rejects(sso.saveConnection(ownerCaller, { id: 'keycloak', enabled: false }), { status: 403 })
  await assert.rejects(sso.removeConnection(ownerCaller, { connectionId: 'keycloak' }), { status: 403 })
  assert.ok(new TeamSsoError('x', 'y') instanceof Error)
})

// ---- the app's wiring ----

test('the server serves one set of routes for every connection, and keeps no ticket in memory', () => {
  const index = read('server/sso/index.js')
  for (const route of ['/sso/discover', '/sso/start', '/sso/callback', '/sso/saml', '/sso/oidc']) assert.match(index, new RegExp(`'${route}'`), route)
  assert.doesNotMatch(index, /'\/sso\/login'/, 'one start route')
  assert.match(index, /mongoTicketStorage\(SsoTickets\.rawCollection\(\)\)/)
  assert.match(index, /takeLease\(/, 'background jobs run under a lease')
  assert.match(index, /cloud \? createPublicFetch\(\)/, 'Cloud reaches providers at public addresses only')
})

test('Team settings has a Sign-in & security section for admins, and the sign-in page finds a team\'s SSO by address', () => {
  const page = read('imports/ui/pages/TeamSettings.jsx')
  assert.match(page, /active === 'security'/)
  assert.match(page, /<SignInSecurity noun=\{noun\} \/>/)
  const login = read('imports/ui/pages/Login.jsx')
  assert.match(login, /<SsoForAddress email=\{typed\}/)
  assert.match(login, /ssoRequired \? null/)
  const client = read('imports/ui/sso/sso.jsx')
  assert.match(client, /fetch\('\/sso\/discover'/)
  assert.match(client, /'\/sso\/start\?'/)
  for (const file of ['imports/ui/components/teams/security/SsoConnectionsCard.jsx', 'imports/ui/components/teams/security/DomainsCard.jsx', 'imports/ui/components/teams/security/RequireSsoCard.jsx']) {
    const text = read(file)
    assert.doesNotMatch(text, /\bAI\b/, `${file}: "agent", not "AI"`)
    assert.doesNotMatch(text, /\b(colour|organisation|behaviour|licence)\b/i, `${file}: US spelling`)
    assert.doesNotMatch(text, /\$\d|per month|subscription|upgrade/i, `${file}: no payment words`)
    // Business on Cloud, free on self-host (owner 2026-11-27): the card never promises it free; BusinessGate says where it comes from
    assert.doesNotMatch(text, /free for every/i, `${file}: no "free for every team" beside the Business notice`)
  }
  assert.equal(model.requireBlocker({ enabled: true, domains: [] }), 'Verify a domain first: single sign-on is required for the addresses of verified domains.')
  assert.deepEqual(model.SESSION_CHOICES.map((c) => c.hours), connections.SESSION_HOURS)
  assert.deepEqual(model.PRESET_CHOICES.map((p) => p.id), Object.keys(connections.PRESETS))
  for (const p of model.PRESET_CHOICES) assert.equal(p.console, connections.PRESETS[p.id].console, p.id)
})

// ---- the activity log, and what the security review closed ----

test('every sign-in change is an entry in the team\'s activity log, with names and ids only, never a secret', async () => {
  const entries = []
  let txt = []
  const { sso, docs } = service({ record: async (entry) => entries.push(entry), resolveTxt: async () => txt })
  const { buildEntry } = await import(app + 'server/audit/events.mjs')
  const { connectionId } = await sso.saveConnection(ownerCaller, { preset: 'okta', label: 'Acme Okta', issuer: 'https://acme.okta.com', clientId: 'cid', clientSecret: 'shh-very-secret' })
  await sso.addDomain(ownerCaller, { connectionId, domain: 'acme.com' })
  txt = [[`slatebox-domain-verification=${docs.get(connectionId).domains[0].token}`]]
  await sso.checkDomain(ownerCaller, { connectionId, domain: 'acme.com' })
  await sso.checkDomain(ownerCaller, { connectionId, domain: 'acme.com' })
  await sso.setPolicy(ownerCaller, { connectionId, requireSso: true, breakGlass: ['adm'] })
  await sso.removeDomain(ownerCaller, { connectionId, domain: 'acme.com' })
  await sso.removeConnection(ownerCaller, { connectionId })
  assert.deepEqual(entries.map((e) => e.action), ['sso.connectionSaved', 'sso.domainAdded', 'sso.domainVerified', 'sso.policyChanged', 'sso.domainRemoved', 'sso.connectionRemoved'],
    'a second check of a verified domain is not a second verification')
  for (const entry of entries) {
    assert.equal(entry.orgId, 'team1')
    assert.deepEqual(entry.target, { type: 'connection', id: connectionId, name: 'Acme Okta' })
    // every entry passes the log's own builder (its catalogue, target types and detail keys)
    buildEntry({ scope: 'team1', at: new Date(NOW), actor: { kind: 'person', userId: 'owner' }, via: 'app', ...entry })
  }
  assert.equal(entries[2].details.domain, 'acme.com')
  assert.equal(entries[3].details.mode, 'required')
  assert.doesNotMatch(JSON.stringify(entries), /shh-very-secret|slatebox-domain-verification/)
  // a log that fails never fails the change
  const broken = service({ record: async () => { throw new Error('down') } })
  await broken.sso.saveConnection(ownerCaller, { preset: 'okta', issuer: 'https://acme.okta.com', clientId: 'cid', clientSecret: 's' })
})

test('a domain verified while single sign-on is already required ends the other ways in of the members it now covers', async () => {
  let txt = []
  const { sso, docs, ended } = service({ resolveTxt: async () => txt })
  const { connectionId } = await sso.saveConnection(ownerCaller, { preset: 'okta', issuer: 'https://acme.okta.com', clientId: 'cid', clientSecret: 's' })
  docs.get(connectionId).domains.push(verified('acme.org'))
  await sso.setPolicy(ownerCaller, { connectionId, requireSso: true })
  assert.deepEqual(ended, [], 'nobody at acme.org yet')
  await sso.addDomain(ownerCaller, { connectionId, domain: 'acme.com' })
  txt = [[`slatebox-domain-verification=${docs.get(connectionId).domains.find((d) => d.domain === 'acme.com').token}`]]
  await sso.checkDomain(ownerCaller, { connectionId, domain: 'acme.com' })
  assert.deepEqual(ended, ['adm', 'mem'], 'covered now: the admin and the member at acme.com (the owner is break-glass; the contractor is not covered)')
})

test('a session single sign-on did not make is refused for an account that signs in only with it', () => {
  assert.equal(policy.resumeRefusal({ hashedToken: 'h' }, { teamSsoOnly: true }), policy.REQUIRE_SSO_MESSAGE, 'an emailed or API sign-in link')
  assert.equal(policy.resumeRefusal({ hashedToken: 'h', ssoConnectionId: 'c1' }, { teamSsoOnly: true }), null)
  assert.equal(policy.resumeRefusal({ hashedToken: 'h' }, { teamSsoOnly: false }), null, 'everyone else keeps their sessions')
  assert.equal(policy.resumeRefusal(null, { teamSsoOnly: true }), null, 'an unknown token is refused by Meteor itself')
  // the Meteor side asks it on every resume, and require single sign-on ends API tokens and links too
  const index = read('server/sso/index.js')
  const resume = index.slice(index.indexOf("if (attempt.type === 'resume') {"), index.indexOf('return attempt.allowed'))
  assert.match(resume, /resumeRefusal\(loginToken, \{ teamSsoOnly: await teamSsoOnly\(user\) \}\)/)
  const endSessions = index.slice(index.indexOf('async endSessions('), index.indexOf('env: {'))
  assert.match(endSessions, /revokeCredentials\(credentials, userId, Date\.now\(\), \{ keepPasskeys: true \}\)/)
  const only = index.slice(index.indexOf('async function teamSsoOnly('), index.indexOf('async function breakGlassFor('))
  assert.match(only, /isBreakGlass\(user, linked\)/, 'break-glass accounts keep their password sessions')
  assert.match(only, /requiredConnectionFor\(user\)/)
})

test('a rate limit keys on the address the proxy saw, never one the caller wrote', () => {
  const req = (xff, peer = '10.0.0.5') => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: peer } })
  assert.equal(policy.requestAddress(req('1.2.3.4'), 0), '10.0.0.5', 'no proxy: the peer, whatever the header says')
  assert.equal(policy.requestAddress(req('6.6.6.6, 203.0.113.9'), 1), '203.0.113.9', 'one proxy: the hop it added, not the forged left-most one')
  assert.equal(policy.requestAddress(req(undefined), 1), '10.0.0.5')
  const index = read('server/sso/index.js')
  assert.doesNotMatch(index, /split\(','\)\[0\]/, 'nothing takes the left-most X-Forwarded-For entry')
  for (const limited of ["'/sso/discover'", "'/sso/start'", "'/sso/oidc'"]) {
    const from = index.indexOf(`handlers.use(${limited}`)
    assert.match(index.slice(from, from + 600), /tooMany(Starts|Logouts)?\(req\)/, `${limited} is rate limited`)
  }
  assert.doesNotMatch(index, /asked\.clear\(\)/, 'a full table never resets every limit')
})

test('break-glass sign-ins and domains that stop routing are in the activity log', () => {
  const index = read('server/sso/index.js')
  const breakGlass = index.slice(index.indexOf('A break-glass sign-in (the owner'), index.indexOf('if (sso?.only) ssoOnlyOnTheServer()'))
  assert.match(breakGlass, /action: 'signin\.breakGlass'/)
  const recheck = index.slice(index.indexOf('async function recheckDomains('), index.indexOf('function every('))
  assert.match(recheck, /action: 'sso\.domainLost'/)
  assert.match(index, /record: \(entry\) => audit\.record\(entry\)/, 'the admin service writes to the log')
  for (const id of ['saveConnection', 'removeConnection', 'addDomain', 'checkDomain', 'removeDomain', 'setPolicy']) {
    const actions = read('server/actions/team-sso.mjs')
    const at = actions.indexOf(`id: 'teamSso.${id}'`)
    assert.match(actions.slice(at - 40, at), /\.\.\.recorded,/, `teamSso.${id} says its entry is recorded inside`)
  }
})
