// Runs at every start with single sign-on on, once Keycloak answers. It creates the "slatebox"
// realm the first time, and at every start makes the app's client match this installation (its
// address and its secret) and keeps the SCIM client in place. Everything else in the realm is the
// operator's: identity providers, LDAP, users, policies. It never prints a secret.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  KEYCLOAK_MANAGEMENT_PORT, KEYCLOAK_PORT, Plain, RUN, SCIM_CLIENT, SSO_INIT_CLIENT, SSO_PATH, SSO_REALM, fail, readSecrets, sleep,
} from './common.mjs'
import { ADMIN_USER, appClient, realm, scimClient } from './sso.mjs'

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
  return { created: false, id: existing.id }
}

// The SCIM client's service account may manage users, and nothing else.
async function grantScim(call, clientId) {
  const user = await call('GET', `/${SSO_REALM}/clients/${clientId}/service-account-user`)
  const [management] = await call('GET', `/${SSO_REALM}/clients?clientId=realm-management`)
  const role = await call('GET', `/${SSO_REALM}/clients/${management.id}/roles/manage-users`)
  await call('POST', `/${SSO_REALM}/users/${user.id}/role-mappings/clients/${management.id}`, [role])
}

async function main() {
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
    return
  }
  const call = api(token)
  const first = !(await call('GET', `/${SSO_REALM}`))
  if (first) await call('POST', '', realm())
  await ensureClient(call, appClient({ url, secrets }))
  const scim = await ensureClient(call, scimClient({ url, secrets }))
  if (scim.created) await grantScim(call, scim.id)
  if (first) {
    // The one-time hint. The password itself is never printed into the log.
    say(`Single sign-on: Keycloak's admin console is at ${url.origin}${SSO_PATH}/admin/ (user "${ADMIN_USER}").`)
    say('Single sign-on: show the admin password with: docker exec <container> slatebox sso admin-password')
  }
  say(`Single sign-on: realm "${SSO_REALM}" ready${first ? ' (created)' : ''}, client "slatebox" set to ${url.origin}/sso/callback, SCIM client "${SCIM_CLIENT}".`)
}

main().then(() => process.exit(0), fail)
