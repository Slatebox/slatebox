// `slatebox sso …`: what an operator needs to run single sign-on. Output goes to the operator's
// terminal through docker exec, never into the container log.
//
//   slatebox sso                   where the admin console, the issuer and SCIM are
//   slatebox sso admin-password    the generated password of Keycloak's first admin, "admin"
//   slatebox sso scim-secret       the secret of the SCIM client, for your identity provider
//   slatebox sso events [N]        the last N sign-in events of the slatebox realm (default 50)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KEYCLOAK_PORT, Plain, RUN, SCIM_CLIENT, SSO_CLIENT, SSO_INIT_CLIENT, SSO_PATH, SSO_REALM, fail, readSecrets } from './common.mjs'
import { ADMIN_USER } from './sso.mjs'

let origin, secrets
function load() {
  const state = readFileSync(join(RUN, 'state.env'), 'utf8')
  if (!/^SLATEBOX_SSO='keycloak'$/m.test(state)) {
    throw new Plain('Single sign-on is off. Start the container with -e SLATEBOX_SSO=keycloak to turn it on.')
  }
  origin = state.match(/^SLATEBOX_PUBLIC_URL='([^']+)'/m)[1]
  secrets = readSecrets()
}
const base = `http://127.0.0.1:${KEYCLOAK_PORT}${SSO_PATH}`
const out = line => process.stdout.write(`${line}\n`)

async function events(limit) {
  const tokenResponse = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: SSO_INIT_CLIENT, client_secret: secrets.keycloakInitSecret }),
  })
  if (!tokenResponse.ok) throw new Plain(`Keycloak refused the setup client (HTTP ${tokenResponse.status}). Read the events in the admin console under Events.`)
  const { access_token: token } = await tokenResponse.json()
  const response = await fetch(`${base}/admin/realms/${SSO_REALM}/events?max=${limit}`, { headers: { authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Plain(`Keycloak answered ${response.status} for the events.`)
  for (const event of await response.json()) {
    out(JSON.stringify({
      time: new Date(event.time).toISOString(), type: event.type, user: event.details?.username, userId: event.userId,
      client: event.clientId, ip: event.ipAddress, ...(event.error ? { error: event.error } : {}),
    }))
  }
}

async function main() {
  load()
  const [command, argument] = process.argv.slice(2)
  if (command === 'admin-password') return out(secrets.keycloakAdminPassword)
  if (command === 'scim-secret') return out(secrets.scimClientSecret)
  if (command === 'events') {
    const limit = Number(argument || 50)
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Plain('Give the number of events, for example: slatebox sso events 100')
    return events(limit)
  }
  if (command) throw new Plain('Usage: slatebox sso [admin-password | scim-secret | events [N]]')
  const issuer = `${origin}${SSO_PATH}/realms/${SSO_REALM}`
  out(`Admin console:   ${origin}${SSO_PATH}/admin/  (user "${ADMIN_USER}"; slatebox sso admin-password)`)
  out(`Realm:           ${SSO_REALM}`)
  out(`Issuer:          ${issuer}`)
  out(`App client:      ${SSO_CLIENT}, redirect ${origin}/sso/callback`)
  out(`Broker redirect: ${issuer}/broker/<alias>/endpoint  (give this to Entra ID, Okta or Google when you add them)`)
  out(`SCIM 2.0:        ${issuer}/scim/v2  (OAuth 2.0 client credentials: client "${SCIM_CLIENT}", token ${issuer}/protocol/openid-connect/token; slatebox sso scim-secret)`)
  out('Sign-in events:  slatebox sso events [N], or Events in the admin console')
}

main().then(() => process.exit(0), fail)
