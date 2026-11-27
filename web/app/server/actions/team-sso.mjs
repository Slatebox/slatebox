// A team's single sign-on, for its owners and admins in Team settings > Sign-in & security. People
// only, in the app: no token, agent or tool changes how a team signs in. The rules live in
// server/sso/admin.mjs; deps.teamSso is that service, deps.teamPerson who the caller is in their team.
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'

const id = { type: 'string', pattern: '^[A-Za-z0-9]{1,40}$' }
const domain = { type: 'string', minLength: 3, maxLength: 253 }
const view = {
  type: 'object',
  description: 'The team\'s connections (never a secret), its admins (for the break-glass list) and whether this server offers single sign-on to the team.',
  properties: {
    available: { type: 'boolean' },
    cloud: { type: 'boolean' },
    canChange: { type: 'boolean' },
    serverAdmin: { type: 'boolean' },
    secretsAvailable: { type: 'boolean' },
    you: { type: 'object' },
    admins: { type: 'array', items: { type: 'object' } },
    connections: { type: 'array', items: { type: 'object' } },
    connectionId: { type: 'string' },
    status: { type: 'string', enum: ['found', 'missing', 'unknown'] },
  },
}
const failure = { code: 'sso_failed', message: 'That could not be saved. Try again.' }

async function caller(principal, deps) {
  const person = await deps.teamPerson(principal.userId)
  if (!person) throw problem(403, 'forbidden', 'Sign in first.')
  return person
}
const run = (name) => async (principal, input, { deps }) => deps.teamSso[name](await caller(principal, deps), input)

const common = { toolset: 'team', principals: ['person'], mounts: { ddp: true }, failure }
// server/sso/admin.mjs records each change in the activity log itself (sso.*), with the domain or
// connection it changed, so the registry records nothing more.
const recorded = { audit: { inside: 'server/sso/admin.mjs records the sso.* entry for this change' } }

const get = defineAction({
  ...common,
  id: 'teamSso.get',
  title: 'Read single sign-on settings',
  description: 'The team\'s single sign-on connections, their domains and policy, for a member of the team. Secrets are never returned.',
  kind: 'read',
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: view,
  handler: async (principal, _input, { deps }) => deps.teamSso.get(await caller(principal, deps)),
})

const saveConnection = defineAction({
  ...common,
  ...recorded,
  id: 'teamSso.saveConnection',
  title: 'Save a single sign-on connection',
  description: 'For a team admin: add or change one connection (Okta, Entra ID, Google Workspace, any OpenID Connect provider, or SAML 2.0). The client secret is write-only.',
  kind: 'write',
  successStatus: 200,
  input: {
    type: 'object',
    properties: {
      id,
      preset: { type: 'string', enum: ['okta', 'entra', 'google', 'oidc', 'saml'] },
      label: { type: 'string', maxLength: 60 },
      enabled: { type: 'boolean' },
      issuer: { type: 'string', maxLength: 500 },
      tenantId: { type: 'string', maxLength: 64 },
      clientId: { type: 'string', maxLength: 300 },
      clientSecret: { type: 'string', maxLength: 2000 },
      idpEntityId: { type: 'string', maxLength: 500 },
      ssoUrl: { type: 'string', maxLength: 1000 },
      certificate: { type: 'string', maxLength: 20000 },
      emailAttribute: { type: 'string', maxLength: 200 },
    },
    additionalProperties: false,
  },
  output: view,
  handler: run('saveConnection'),
})

const removeConnection = defineAction({
  ...common,
  ...recorded,
  id: 'teamSso.removeConnection',
  title: 'Remove a single sign-on connection',
  description: 'For a team admin: remove a connection and release its domains. People it signed in keep their accounts and sign in another way.',
  kind: 'write',
  destructive: true,
  successStatus: 200,
  input: { type: 'object', properties: { connectionId: id }, required: ['connectionId'], additionalProperties: false },
  output: view,
  handler: run('removeConnection'),
})

const addDomain = defineAction({
  ...common,
  ...recorded,
  id: 'teamSso.addDomain',
  title: 'Add a sign-in domain',
  description: 'For a team admin: add an email domain to a connection. It signs people in once the team proves it owns the domain with a DNS TXT record.',
  kind: 'write',
  successStatus: 200,
  input: { type: 'object', properties: { connectionId: id, domain }, required: ['connectionId', 'domain'], additionalProperties: false },
  output: view,
  handler: run('addDomain'),
})

const checkDomain = defineAction({
  ...common,
  ...recorded,
  id: 'teamSso.checkDomain',
  title: 'Check a sign-in domain',
  description: 'For a team admin: look up the domain\'s DNS TXT record now. On a self-hosted server its administrator may verify a domain without DNS (withoutDns).',
  kind: 'write',
  successStatus: 200,
  input: { type: 'object', properties: { connectionId: id, domain, withoutDns: { type: 'boolean' } }, required: ['connectionId', 'domain'], additionalProperties: false },
  output: view,
  handler: run('checkDomain'),
})

const removeDomain = defineAction({
  ...common,
  ...recorded,
  id: 'teamSso.removeDomain',
  title: 'Remove a sign-in domain',
  description: 'For a team admin: remove a domain from a connection. Its addresses stop signing in with that connection.',
  kind: 'write',
  destructive: true,
  successStatus: 200,
  input: { type: 'object', properties: { connectionId: id, domain }, required: ['connectionId', 'domain'], additionalProperties: false },
  output: view,
  handler: run('removeDomain'),
})

const setPolicy = defineAction({
  ...common,
  ...recorded,
  id: 'teamSso.setPolicy',
  title: 'Set the sign-in policy',
  description: 'For a team admin: require single sign-on for the connection\'s domains (with up to two break-glass admins besides the owner), who may join at first sign-in, how long a session lasts, and whether signing out also signs out at the identity provider.',
  kind: 'write',
  successStatus: 200,
  input: {
    type: 'object',
    properties: {
      connectionId: id,
      requireSso: { type: 'boolean' },
      breakGlass: { type: 'array', maxItems: 2, items: id },
      joinRule: { type: 'string', enum: ['member', 'invited-only'] },
      sessionHours: { type: 'integer', enum: [8, 24, 168] },
      signOutOfIdp: { type: 'boolean' },
    },
    required: ['connectionId'],
    additionalProperties: false,
  },
  output: view,
  handler: run('setPolicy'),
})

const tryConnection = defineAction({
  ...common,
  id: 'teamSso.tryConnection',
  title: 'Try a single sign-on connection',
  description: 'For a team admin: an address (10 minutes, once) for a test sign-in in a popup. It shows what the identity provider sent and what Slatebox would do, and signs nobody in.',
  kind: 'write',
  readOnly: true,
  successStatus: 200,
  input: { type: 'object', properties: { connectionId: id }, required: ['connectionId'], additionalProperties: false },
  output: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  async handler(principal, { connectionId }, { deps }) {
    const person = await caller(principal, deps)
    if (!person.isAdmin) throw problem(403, 'forbidden', 'Only team owners and admins can test sign-in.')
    const started = await deps.startSsoTry(person, connectionId)
    if (!started) throw problem(404, 'not_found', 'That connection is not in your team.')
    return started
  },
})

const signOutUrl = defineAction({
  ...common,
  toolset: 'account',
  id: 'sso.signOutUrl',
  title: 'Where to sign out at the identity provider',
  description: 'For the signed-in person: the identity provider\'s sign-out address when their team asks that signing out of Slatebox signs them out there too, else null.',
  kind: 'read',
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object', properties: { url: { type: ['string', 'null'] } }, required: ['url'] },
  handler: async (principal, _input, { deps }) => ({ url: await deps.ssoSignOutUrl(principal.userId) }),
})

export default [signOutUrl, get, saveConnection, removeConnection, addDomain, checkDomain, removeDomain, setPolicy, tryConnection]
