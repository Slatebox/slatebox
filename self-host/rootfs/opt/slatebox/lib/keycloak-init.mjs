// Runs at every start with single sign-on on, once Keycloak answers. It creates the "slatebox"
// realm the first time, and at every start:
// - makes the app's client and the SCIM client match this installation: address, secret and the
//   SCIM audience, which follows the address (a new SLATEBOX_URL, or a restore at another one);
// - keeps the "link by trusted email" first-login flow in place for operators to choose;
// - keeps brute-force protection and events on in the master realm, whose sign-in the admin
//   console uses.
// Everything else in the realm is the operator's: identity providers, LDAP, users, policies. It
// never prints a secret.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  KEYCLOAK_MANAGEMENT_PORT, KEYCLOAK_PORT, Plain, RUN, SCIM_CLIENT, SSO_INIT_CLIENT, SSO_PATH, SSO_REALM, fail, readSecrets, sleep,
} from './common.mjs'
import {
  ADMIN_USER, MASTER_EVENTS, MASTER_REALM, TRUSTED_EMAIL_FLOW, TRUSTED_EMAIL_STEPS, appClient, realm, scimClient,
} from './sso.mjs'

const base = `http://127.0.0.1:${KEYCLOAK_PORT}${SSO_PATH}`
const say = line => process.stdout.write(`${line}\n`)

async function waitUntilReady(seconds) {
  const deadline = Date.now() + seconds * 1000
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${KEYCLOAK_MANAGEMENT_PORT}${SSO_PATH}/health/ready`, { signal: AbortSignal.timeout(3000) })
      if (response.ok) return
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Plain('Keycloak did not become ready in time.')
    await sleep(1000)
  }
}

async function adminToken(secrets) {
  const response = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: SSO_INIT_CLIENT, client_secret: secrets.keycloakInitSecret }),
  })
  if (!response.ok) {
    throw new Plain(`Keycloak refused Slatebox's setup client "${SSO_INIT_CLIENT}" in the master realm (HTTP ${response.status}). ` +
      'It was removed or its secret changed; the realm is left as it is.')
  }
  return (await response.json()).access_token
}

function api(token) {
  return async (method, path, body) => {
    const response = await fetch(`${base}/admin/realms${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (response.status === 404 && method === 'GET') return null
    if (!response.ok) throw new Plain(`Keycloak answered ${response.status} to ${method} ${path}`)
    const text = await response.text()
    return text ? JSON.parse(text) : null
  }
}

async function ensureClient(call, wanted) {
  const [existing] = await call('GET', `/${SSO_REALM}/clients?clientId=${encodeURIComponent(wanted.clientId)}`) || []
  if (!existing) {
    await call('POST', `/${SSO_REALM}/clients`, wanted)
    return { created: true, id: (await call('GET', `/${SSO_REALM}/clients?clientId=${encodeURIComponent(wanted.clientId)}`))[0].id }
  }
  const { protocolMappers, defaultClientScopes, optionalClientScopes, ...settings } = wanted
  await call('PUT', `/${SSO_REALM}/clients/${existing.id}`, { ...existing, ...settings, attributes: { ...existing.attributes, ...settings.attributes } })
  // Mappers that carry the address (the SCIM audience) are rewritten too.
  if (protocolMappers?.length) {
    const models = `/${SSO_REALM}/clients/${existing.id}/protocol-mappers/models`
    const present = await call('GET', models) || []
    for (const mapper of protocolMappers) {
      const found = present.find(each => each.name === mapper.name)
      if (!found) await call('POST', models, mapper)
      else await call('PUT', `${models}/${found.id}`, { ...found, ...mapper, id: found.id, config: { ...found.config, ...mapper.config } })
    }
  }
  return { created: false, id: existing.id }
}

// The "link by trusted email" first-login flow (see sso.mjs), made once if it is missing.
async function ensureTrustedEmailFlow(call) {
  const flows = `/${SSO_REALM}/authentication/flows`
  if ((await call('GET', flows) || []).some(flow => flow.alias === TRUSTED_EMAIL_FLOW)) return
  const quoted = alias => encodeURIComponent(alias)
  await call('POST', flows, {
    alias: TRUSTED_EMAIL_FLOW, providerId: 'basic-flow', topLevel: true, builtIn: false,
    description: 'First sign-in through a company provider with Trust Email on: a person who already exists with that address is linked, anyone else is created.',
  })
  await call('POST', `${flows}/${quoted(TRUSTED_EMAIL_FLOW)}/executions/execution`, { provider: 'idp-review-profile' })
  await call('POST', `${flows}/${quoted(TRUSTED_EMAIL_FLOW)}/executions/flow`, {
    alias: TRUSTED_EMAIL_STEPS, type: 'basic-flow', provider: 'registration-page-form', description: 'Create the user, or link the one with the same address.',
  })
  await call('POST', `${flows}/${quoted(TRUSTED_EMAIL_STEPS)}/executions/execution`, { provider: 'idp-create-user-if-unique' })
  await call('POST', `${flows}/${quoted(TRUSTED_EMAIL_STEPS)}/executions/execution`, { provider: 'idp-auto-link' })
  const requirement = { 'idp-review-profile': 'REQUIRED', [TRUSTED_EMAIL_STEPS]: 'REQUIRED', 'idp-create-user-if-unique': 'ALTERNATIVE', 'idp-auto-link': 'ALTERNATIVE' }
  for (const execution of await call('GET', `${flows}/${quoted(TRUSTED_EMAIL_FLOW)}/executions`)) {
    const wanted = requirement[execution.providerId] || requirement[execution.displayName]
    if (wanted && execution.requirement !== wanted) {
      await call('PUT', `${flows}/${quoted(TRUSTED_EMAIL_FLOW)}/executions`, { ...execution, requirement: wanted })
    }
    if (execution.providerId === 'idp-review-profile') {
      await call('POST', `/${SSO_REALM}/authentication/executions/${execution.id}/config`, {
        alias: `${TRUSTED_EMAIL_FLOW} review profile`, config: { 'update.profile.on.first.login': 'missing' },
      })
    }
  }
}

// The admin console signs in through the master realm: slow down and record password guessing there.
async function hardenMaster(call) {
  const master = await call('GET', '/master')
  if (!master.bruteForceProtected) await call('PUT', '/master', { ...master, ...MASTER_REALM })
  const events = await call('GET', '/master/events/config')
  if (!events.eventsEnabled || !events.adminEventsEnabled) {
    await call('PUT', '/master/events/config', { ...events, ...MASTER_EVENTS })
  }
}

// The SCIM client's service account may manage users, and nothing else.
async function grantScim(call, clientId) {
  const user = await call('GET', `/${SSO_REALM}/clients/${clientId}/service-account-user`)
  const [management] = await call('GET', `/${SSO_REALM}/clients?clientId=realm-management`)
  const role = await call('GET', `/${SSO_REALM}/clients/${management.id}/roles/manage-users`)
  await call('POST', `/${SSO_REALM}/users/${user.id}/role-mappings/clients/${management.id}`, [role])
}

// Health reports single sign-on ready only once this step has finished: until then the clients
// may still carry an earlier address (the SCIM audience, the redirect).
const READY = join(RUN, 'sso-ready')
const done = () => writeFileSync(READY, `${new Date().toISOString()}\n`)

async function main() {
  rmSync(READY, { force: true })
  const secrets = readSecrets()
  const url = new URL(readFileSync(join(RUN, 'state.env'), 'utf8').match(/^SLATEBOX_PUBLIC_URL='([^']+)'/m)[1])
  await waitUntilReady(Number(process.argv[2] || 300))
  let token
  try {
    token = await adminToken(secrets)
  } catch (error) {
    // An operator may remove the setup client once the realm exists; Slatebox then leaves the realm alone.
    const realmAnswers = await fetch(`${base}/realms/${SSO_REALM}`).then(response => response.ok, () => false)
    if (!realmAnswers) throw error
    say(`Single sign-on: ${error.message}`)
    done()
    return
  }
  const call = api(token)
  const first = !(await call('GET', `/${SSO_REALM}`))
  if (first) await call('POST', '', realm())
  await ensureClient(call, appClient({ url, secrets }))
  const scim = await ensureClient(call, scimClient({ url, secrets }))
  if (scim.created) await grantScim(call, scim.id)
  await ensureTrustedEmailFlow(call)
  await hardenMaster(call)
  if (first) {
    // The one-time hint. The password itself is never printed into the log.
    say(`Single sign-on: Keycloak's admin console is at ${url.origin}${SSO_PATH}/admin/ (user "${ADMIN_USER}").`)
    say('Single sign-on: show the admin password with: docker exec <container> slatebox sso admin-password')
  }
  done()
  say(`Single sign-on: realm "${SSO_REALM}" ready${first ? ' (created)' : ''}, client "slatebox" set to ${url.origin}/sso/callback, SCIM client "${SCIM_CLIENT}".`)
}

main().then(() => process.exit(0), fail)
