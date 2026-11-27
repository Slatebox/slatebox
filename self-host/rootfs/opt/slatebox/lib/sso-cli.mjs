// `slatebox sso …`: what an operator needs to run single sign-on. Output goes to the operator's
// terminal through docker exec, never into the container log.
//
//   slatebox sso                   where the admin console, the issuer and the app's SCIM are
//   slatebox sso admin-password    the generated password of Keycloak's first admin, "admin"
//   slatebox sso events [N]        the last N sign-in events of the slatebox realm (default 50)
//   slatebox sso sessions [--json] the app's last session check: accounts due, checked and signed
//                                  out, and a warning when more were due than one pass checks
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KEYCLOAK_PORT, Plain, RUN, SSO_CLIENT, SSO_INIT_CLIENT, SSO_PATH, SSO_REALM, fail, mongodb, readSecrets } from './common.mjs'
import { ADMIN_USER, SESSION_CHECK_ID, sessionCheckSummary } from './sso.mjs'

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

// Needs the app's database connection (MONGO_URL): the in-image slatebox runs this with app.env.
async function sessions(json) {
  if (!process.env.MONGO_URL) throw new Plain('Slatebox is still starting. Try again in a moment.')
  const { MongoClient } = mongodb()
  const client = new MongoClient(process.env.MONGO_URL)
  try {
    await client.connect()
    const summary = sessionCheckSummary(await client.db().collection('systemSettings').findOne({ _id: SESSION_CHECK_ID }))
    if (json) return out(JSON.stringify(summary))
    out(`Session check:   ${summary.line}`)
    if (summary.warning) process.stderr.write(`${summary.warning}\n`)
  } finally {
    await client.close()
  }
}

async function main() {
  load()
  const [command, argument] = process.argv.slice(2)
  if (command === 'admin-password') return out(secrets.keycloakAdminPassword)
  if (command === 'events') {
    const limit = Number(argument || 50)
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Plain('Give the number of events, for example: slatebox sso events 100')
    return events(limit)
  }
  if (command === 'sessions') return sessions(argument === '--json')
  if (command) throw new Plain('Usage: slatebox sso [admin-password | events [N] | sessions [--json]]')
  const issuer = `${origin}${SSO_PATH}/realms/${SSO_REALM}`
  const closed = /^SLATEBOX_SSO_ADMIN='closed'$/m.test(readFileSync(join(RUN, 'state.env'), 'utf8'))
  out(closed
    ? 'Admin console:   closed on this address (SLATEBOX_SSO_ADMIN=closed); start the container without it to use the console'
    : `Admin console:   ${origin}${SSO_PATH}/admin/  (user "${ADMIN_USER}"; slatebox sso admin-password)`)
  out(`Realm:           ${SSO_REALM}`)
  out(`Issuer:          ${issuer}`)
  out(`App client:      ${SSO_CLIENT}, redirect ${origin}/sso/callback`)
  out(`Broker redirect: ${issuer}/broker/<alias>/endpoint  (give this to Entra ID, Okta or Google when you add them)`)
  out(`SCIM 2.0:        ${origin}/scim/v2  (Slatebox's own; a team admin makes the token in Team settings › Sign-in & security)`)
  out('Sign-in events:  slatebox sso events [N], or Events in the admin console')
  out('Session check:   slatebox sso sessions')
}

main().then(() => process.exit(0), fail)
