// Single sign-on with the bundled Keycloak, end to end through the one published port:
// SLATEBOX_SSO=keycloak, a person made in Keycloak signs in to Slatebox in a real browser,
// gets an account and a slate, is disabled in Keycloak and loses access. Also SCIM provisioning,
// sign-in events, "SSO only", a restart, and SSO staying off by default.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { cleanup, docker, freePort, healthy, logs, ok, remove, start, waitFor } from './lib.mjs'
import { closeChrome, createSlate, notes, person, writeNote } from './slate.mjs'

const REALM = 'slatebox'
let box, adminPassword

const exec = (id, ...args) => ok(['exec', id, 'slatebox', ...args])

/** Keycloak's admin REST API, as an operator reaches it: through the published port, with the generated admin. */
async function admin(target, password) {
  const base = `${target.url}/auth`
  const token = (await (await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'admin', password }),
  })).json()).access_token
  assert.ok(token, 'the generated admin signs in to the master realm')
  // Paths are under the slatebox realm; `realm` picks another one, and '' the list of realms.
  return async (method, path, body, { realm = REALM } = {}) => {
    const response = await fetch(`${base}/admin/realms${realm ? `/${realm}` : ''}${path}`, {
      method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    assert.ok(response.ok, `${method} ${path}: HTTP ${response.status} ${await response.clone().text()}`)
    const text = await response.text()
    return text ? JSON.parse(text) : null
  }
}

async function makeUser(call, { username, email, password, firstName = 'Test', lastName = 'Person' }) {
  await call('POST', '/users', {
    username, email, firstName, lastName, enabled: true, emailVerified: true,
    credentials: [{ type: 'password', value: password, temporary: false }],
  })
  return (await call('GET', `/users?exact=true&username=${encodeURIComponent(username)}`))[0].id
}

/** Sign in through "Sign in with SSO" and Keycloak's own sign-in page. */
async function ssoSignIn(page, url, username, password) {
  await page.goto(`${url}/login`)
  await page.locator('#ssoSignIn').click()
  await page.waitForURL(/\/auth\/realms\/slatebox\/protocol\/openid-connect\/auth/, { timeout: 60_000 })
  await page.locator('#username').fill(username)
  await page.locator('#password').fill(password)
  await page.locator('#kc-login').click()
}

/** Sign in through "Sign in with SSO", then the company provider `alias` that Keycloak offers. */
async function companySignIn(page, url, alias, username, password) {
  await page.goto(`${url}/login`)
  await page.locator('#ssoSignIn').click()
  await page.waitForURL(/\/auth\/realms\/slatebox\/protocol\/openid-connect\/auth/, { timeout: 60_000 })
  await page.locator(`#social-${alias}`).click()
  await page.waitForURL(new RegExp(`/auth/realms/${alias}/`), { timeout: 60_000 })
  await page.locator('#username').fill(username)
  await page.locator('#password').fill(password)
  await page.locator('#kc-login').click()
}

/** Run a script against Slatebox's database inside the container; `db` is the slatebox database. */
async function database(id, script) {
  return ok(['exec', id, 'node', '--input-type=module', '-e', `
    import { mongodb, mongoUrl, readSecrets } from '/opt/slatebox/lib/common.mjs'
    const client = new (mongodb().MongoClient)(mongoUrl('root', readSecrets().mongoRootPassword, { database: '', authSource: 'admin' }))
    await client.connect()
    const db = client.db('slatebox')
    try { console.log(JSON.stringify(await (async () => { ${script} })())) } finally { await client.close() }`])
}

/** A SCIM client as the company's identity provider runs one: client credentials, then /scim/v2. */
async function scimClient(target, id) {
  const secret = await exec(id, 'sso', 'scim-secret')
  const issuer = `${target.url}/auth/realms/${REALM}`
  const token = (await (await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'scim', client_secret: secret }),
  })).json()).access_token
  assert.ok(token, 'the SCIM client gets a token')
  return async (method, path, body) => {
    const response = await fetch(`${issuer}/scim/v2${path}`, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/scim+json' }, body: body && JSON.stringify(body),
    })
    assert.ok(response.ok, `SCIM ${method} ${path}: HTTP ${response.status} ${await response.clone().text()}`)
    return response.status === 204 ? null : response.json()
  }
}

/** An API token of the signed-in account, made the way the account page makes one. */
const apiToken = page => page.evaluate(() => window.Meteor.callAsync('apiTokens.create', { name: 'test', scopes: ['slates:read', 'slates:write'] })).then(made => made.token)
const apiRead = (url, shareId, token) => fetch(`${url}/api/v1/slates/${shareId}`, { headers: { authorization: `Bearer ${token}` } }).then(response => response.status)

const signedInUser = page => page.evaluate(() => {
  const user = window.Meteor.user()
  return user ? { id: user._id, email: user.emails?.[0]?.address, verified: user.emails?.[0]?.verified, anonymous: !!user.isAnonymous, firstName: user.profile?.firstName } : null
})

before(async () => {
  box = await start({ env: { SLATEBOX_SSO: 'keycloak' } })
  await healthy(box.id)
  adminPassword = await exec(box.id, 'sso', 'admin-password')
})

after(async () => {
  await closeChrome()
  await cleanup()
})

test('Keycloak answers under /auth on the one port, its data is in the volume, and no secret is in the log', async () => {
  const discovery = await (await fetch(`${box.url}/auth/realms/${REALM}/.well-known/openid-configuration`)).json()
  assert.equal(discovery.issuer, `${box.url}/auth/realms/${REALM}`)
  assert.ok(discovery.code_challenge_methods_supported.includes('S256'))
  const console = await fetch(`${box.url}/auth/admin/`, { redirect: 'manual' })
  assert.ok([200, 302, 303].includes(console.status), `the admin console answers (${console.status})`)
  // Only the front proxy listens beyond loopback, Keycloak included.
  const listening = await ok(['exec', box.id, 'sh', '-c', "cat /proc/net/tcp /proc/net/tcp6 | awk '$4==\"0A\"{print $2}'"])
  for (const address of listening.split('\n')) {
    const [host, port] = address.split(':')
    const loopback = /^0100007F$|^0000000000000000FFFF00000100007F$|^00000000000000000000000001000000$/.test(host)
    assert.ok(loopback || [7070, 80, 443].includes(parseInt(port, 16)), `${address} listens beyond loopback`)
  }
  assert.match(await ok(['exec', box.id, 'ls', '/data/keycloak/h2']), /keycloakdb\.mv\.db/)
  const secrets = JSON.parse(await ok(['exec', box.id, 'cat', '/data/secrets/secrets.json']))
  for (const name of ['keycloakAdminPassword', 'keycloakInitSecret', 'ssoClientSecret', 'ssoStateKey', 'scimClientSecret']) {
    assert.match(secrets[name], /^[0-9a-f]{64}$/, name)
  }
  const log = await logs(box.id)
  for (const name of Object.keys(secrets)) assert.ok(!log.includes(secrets[name]), `${name} is not in the log`)
  assert.match(log, /admin console is at .*\/auth\/admin\/ \(user "admin"\)/)
  assert.match(log, /slatebox sso admin-password/)
  assert.match(log, /SSO: +on, Keycloak 26\.\d+\.\d+/)
  const status = await exec(box.id, 'sso')
  assert.match(status, new RegExp(`SCIM 2\\.0: +${box.url}/auth/realms/${REALM}/scim/v2`))
  // The admin console signs in through the master realm: password guessing there is slowed and recorded.
  const call = await admin(box, adminPassword)
  const master = await call('GET', '', undefined, { realm: 'master' })
  assert.equal(master.bruteForceProtected, true, 'brute-force protection in the master realm')
  const events = await call('GET', '/events/config', undefined, { realm: 'master' })
  assert.equal(events.eventsEnabled, true, 'sign-in events in the master realm')
  assert.equal(events.adminEventsEnabled, true, 'admin events in the master realm')
  // The first-login flow that links people provisioned ahead (SCIM, LDAP) is there to choose.
  assert.ok((await call('GET', '/authentication/flows')).some(flow => flow.alias === 'link by trusted email'))
})

test('a person made in Keycloak signs in with SSO, gets an account and a slate; disabled, they lose access', async () => {
  const call = await admin(box, adminPassword)
  const kcId = await makeUser(call, { username: 'ada', email: 'ada.sso@example.test', password: 'ada keycloak password 1', firstName: 'Ada' })
  const ada = await person()
  try {
    await ssoSignIn(ada.page, box.url, 'ada', 'ada keycloak password 1')
    await ada.page.waitForURL(url => url.origin === box.url && !url.pathname.startsWith('/sso'), { timeout: 60_000 })
    const user = await waitFor(() => signedInUser(ada.page), { timeout: 60, what: 'the Slatebox session' })
    assert.deepEqual({ ...user, id: undefined }, { id: undefined, email: 'ada.sso@example.test', verified: true, anonymous: false, firstName: 'Ada' })

    // A slate of her own, saved.
    const slate = await createSlate(ada.page, `${box.url}/new`)
    await writeNote(ada.page, 'Written after single sign-on')
    await waitFor(async () => (await notes(ada.page)).includes('Written after single sign-on'), { timeout: 30, what: 'the note' })
    assert.equal((await signedInUser(ada.page)).id, user.id, 'the slate was made by the SSO account, not a guest')
    assert.ok(slate.startsWith(`${box.url}/canvas/`))
    const shareId = new URL(slate).pathname.split('/')[2]
    const token = await apiToken(ada.page)
    assert.equal(await apiRead(box.url, shareId, token), 200, 'her API token reads her slate')

    // Signing in again lands in the same account.
    const again = await person()
    try {
      await ssoSignIn(again.page, box.url, 'ada', 'ada keycloak password 1')
      assert.equal((await waitFor(() => signedInUser(again.page), { timeout: 60, what: 'the second session' })).id, user.id)
    } finally { await again.close() }

    // The administrator disables her in Keycloak. Within the session check (60 s) her open tab is signed out.
    const disabledAt = Date.now()
    await call('PUT', `/users/${kcId}`, { enabled: false })
    await waitFor(async () => (await ada.page.evaluate(() => window.Meteor?.userId())) !== user.id, { timeout: 150, every: 2000, what: 'the session to be revoked' })
      .catch(async error => { console.log((await logs(box.id)).split('\n').filter(line => /sso/.test(line)).join('\n')); throw error })
    console.log(`access revoked ${Math.round((Date.now() - disabledAt) / 1000)} s after the user was disabled`)
    // Her API token ends with her sessions.
    assert.equal(await apiRead(box.url, shareId, token), 401, 'her API token no longer works')
    await ada.page.reload()
    await ada.page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
    assert.notEqual(await ada.page.evaluate(() => window.Meteor.userId()), user.id, 'a reload does not bring the session back')
    // And she cannot sign in again: Keycloak refuses a disabled account.
    await ssoSignIn(ada.page, box.url, 'ada', 'ada keycloak password 1')
    await ada.page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
    assert.match(ada.page.url(), /\/auth\/realms\/slatebox\//, 'she stays on the Keycloak page')
    assert.match(await ada.page.locator('body').innerText(), /disabled/i)
    // Nothing she typed, and not her address, reached the container log.
    const log = await logs(box.id)
    for (const text of ['ada.sso@example.test', 'ada keycloak password 1', 'Written after single sign-on']) assert.ok(!log.includes(text), `${text} in the log`)
    assert.match(log, /\[app\] sso: account \w+ created at first sign-in/)
    assert.match(log, /\[app\] sso: account \w+ signed out: the identity provider refused its session; its API tokens are revoked/)
  } finally {
    await ada.close()
  }
})

test('an address Slatebox never verified does not hand its account to the person with that address (no pre-sign-in takeover)', async () => {
  const mallory = await person()
  const victim = await person()
  try {
    // Mallory has her own account, puts her colleague's address on it, and makes an API token.
    await createSlate(mallory.page, box.url)
    await mallory.page.evaluate(() => window.Meteor.callAsync('users.identify', { firstName: 'Mal', email: 'vic@example.test', password: 'mallory password 42' }))
    const squatter = await signedInUser(mallory.page)
    assert.equal(squatter.verified, false)
    const token = await apiToken(mallory.page)
    // The colleague signs in with SSO for the first time: not into Mallory's account.
    const call = await admin(box, adminPassword)
    await makeUser(call, { username: 'vic', email: 'vic@example.test', password: 'vic keycloak password 1' })
    await ssoSignIn(victim.page, box.url, 'vic', 'vic keycloak password 1')
    await victim.page.waitForURL(url => url.pathname === '/login' && url.searchParams.get('sso') === 'account', { timeout: 60_000 })
    assert.equal(await victim.page.evaluate(() => window.Meteor.userId()), null, 'the colleague is not signed in to anything')
    const stored = JSON.parse(await database(box.id, `return db.collection('users').findOne({ _id: ${JSON.stringify(squatter.id)} }, { projection: { 'services.sso': 1 } })`))
    assert.equal(stored.services?.sso, undefined, "Mallory's account was not linked to the colleague's identity")
    assert.equal(await apiRead(box.url, 'none', token), 404, "Mallory's token is still only Mallory's")
    assert.match(await logs(box.id), /sso: sign-in refused \(account: an account with this address exists, but Slatebox never verified the address\)/)
  } finally {
    await mallory.close()
    await victim.close()
  }
})

test('an account whose address Slatebox verified is linked; its password, sessions and API tokens end there', async () => {
  const bo = await person()
  try {
    // Bo has used Slatebox with a password before SSO arrived, and confirmed his address.
    const slate = await createSlate(bo.page, box.url)
    await bo.page.evaluate(() => window.Meteor.callAsync('users.identify', { firstName: 'Bo', email: 'bo@example.test', password: 'bo password 42' }))
    const before = await signedInUser(bo.page)
    // Stands in for following the verification link Slatebox mailed (this test has no mailbox).
    await database(box.id, `return (await db.collection('users').updateOne({ _id: ${JSON.stringify(before.id)} }, { $set: { 'emails.0.verified': true } })).modifiedCount`)
    const shareId = new URL(slate).pathname.split('/')[2]
    const token = await apiToken(bo.page)
    assert.equal(await apiRead(box.url, shareId, token), 200)
    await bo.page.evaluate(() => new Promise(resolve => window.Meteor.logout(resolve)))
    const call = await admin(box, adminPassword)
    await makeUser(call, { username: 'bob', email: 'Bo@Example.test', password: 'bo keycloak password 1' })
    await ssoSignIn(bo.page, box.url, 'bob', 'bo keycloak password 1')
    const after = await waitFor(() => signedInUser(bo.page), { timeout: 60, what: 'the SSO session' })
    assert.equal(after.id, before.id, 'the same account')
    assert.equal(after.verified, true)
    // From now on Bo signs in with SSO only.
    assert.equal(await apiRead(box.url, shareId, token), 401, 'the API token made before the link is revoked')
    const password = await bo.page.evaluate(() => new Promise(resolve => window.Meteor.loginWithPassword('bo@example.test', 'bo password 42', error => resolve(error ? error.reason || error.message : 'signed in'))))
    assert.notEqual(password, 'signed in', 'the old password no longer signs in')
  } finally {
    await bo.close()
  }
})

test('a sign-in ticket works only in the browser that started the sign-in (no login CSRF)', async () => {
  const eve = await person()
  const other = await person()
  try {
    // Eve signs in, but keeps the address /sso/callback sends her to instead of following it.
    let done
    await eve.page.route('**/sso/callback**', async route => {
      const response = await route.fetch({ maxRedirects: 0 })
      done = response.headers().location
      await route.fulfill({ status: 204, body: '' })
    })
    await ssoSignIn(eve.page, box.url, 'bob', 'bo keycloak password 1')
    await waitFor(() => done, { timeout: 60, what: 'the /sso/done address' })
    assert.match(done, /^\/sso\/done#ticket=/)
    // She sends it to someone else, whose browser opens it: not signed in to Eve's account.
    await other.page.goto(`${box.url}${done}`)
    await other.page.waitForURL(url => url.pathname === '/login', { timeout: 60_000 })
    assert.equal(await other.page.evaluate(() => window.Meteor.userId()), null)
    assert.equal(new URL(other.page.url()).searchParams.get('sso'), 'no-sign-in')
  } finally {
    await eve.close()
    await other.close()
  }
})

test('SCIM provisions a person ahead; they sign in through the company provider and are linked; deactivated over SCIM, they lose access', async () => {
  const call = await admin(box, adminPassword)
  // The company's own identity provider, here a second realm of the same Keycloak, offering OpenID Connect.
  await call('POST', '', { realm: 'corp', enabled: true, sslRequired: 'external' }, { realm: '' })
  const corp = async (method, path, body) => call(method, path, body, { realm: 'corp' })
  await corp('POST', '/clients', {
    clientId: 'slatebox-broker', publicClient: false, secret: 'corp broker secret', standardFlowEnabled: true,
    redirectUris: [`${box.url}/auth/realms/${REALM}/broker/corp/endpoint`],
  })
  await corp('POST', '/users', {
    username: 'cy.corp', email: 'cy@example.test', firstName: 'Cy', lastName: 'Scim', enabled: true, emailVerified: true,
    credentials: [{ type: 'password', value: 'cy corp password 1', temporary: false }],
  })
  // Added the way the guide says: OpenID Connect, Trust Email on, first login flow "link by trusted email".
  await call('POST', '/identity-provider/instances', {
    alias: 'corp', displayName: 'Corp', providerId: 'oidc', enabled: true, trustEmail: true, firstBrokerLoginFlowAlias: 'link by trusted email',
    config: {
      clientId: 'slatebox-broker', clientSecret: 'corp broker secret', clientAuthMethod: 'client_secret_post',
      authorizationUrl: `${box.url}/auth/realms/corp/protocol/openid-connect/auth`,
      // The broker reaches this stand-in on the container's loopback, as it would reach a real provider over the network.
      tokenUrl: 'http://127.0.0.1:7080/auth/realms/corp/protocol/openid-connect/token',
      issuer: `${box.url}/auth/realms/corp`, validateSignature: 'false', defaultScope: 'openid email profile', syncMode: 'IMPORT',
    },
  })
  // The company provisions Cy over SCIM before Cy has ever signed in.
  const scim = await scimClient(box, box.id)
  const made = await scim('POST', '/Users', {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'cyd', active: true,
    name: { givenName: 'Cy', familyName: 'Scim' }, emails: [{ value: 'cy@example.test', primary: true }],
  })
  const cy = await person()
  try {
    await companySignIn(cy.page, box.url, 'corp', 'cy.corp', 'cy corp password 1')
    const user = await waitFor(() => signedInUser(cy.page), { timeout: 60, what: 'the SSO session' })
      .catch(async error => { throw new Error(`${error.message}: ${cy.page.url()} ${(await cy.page.locator('body').innerText()).slice(0, 300)}`) })
    assert.equal(user.email, 'cy@example.test')
    // Linked to the SCIM-provisioned person, not a second one.
    const people = await call('GET', '/users?email=cy@example.test&exact=true')
    assert.equal(people.length, 1)
    assert.equal(people[0].id, made.id)
    await scim('PATCH', `/Users/${made.id}`, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', path: 'active', value: false }],
    })
    await waitFor(async () => (await cy.page.evaluate(() => window.Meteor.userId())) !== user.id, { timeout: 150, every: 2000, what: 'the session to be revoked' })
  } finally {
    await cy.close()
  }
})

test('sign-in events are kept in Keycloak and listed by slatebox sso events', async () => {
  const lines = (await exec(box.id, 'sso', 'events', '200')).split('\n').map(line => JSON.parse(line))
  assert.ok(lines.some(event => event.type === 'LOGIN' && event.user === 'ada' && event.client === 'slatebox'), 'a LOGIN event for ada')
  assert.ok(lines.some(event => event.type === 'LOGIN_ERROR' && event.error === 'user_disabled'), 'the refused sign-in of a disabled user')
})

test('a restart keeps the realm, its people and its secrets', async () => {
  const before = await ok(['exec', box.id, 'cat', '/data/secrets/secrets.json'])
  await ok(['restart', box.id])
  await healthy(box.id)
  assert.equal(await ok(['exec', box.id, 'cat', '/data/secrets/secrets.json']), before)
  const bo = await person()
  try {
    await ssoSignIn(bo.page, box.url, 'bob', 'bo keycloak password 1')
    assert.equal((await waitFor(() => signedInUser(bo.page), { timeout: 60, what: 'the SSO session' })).email, 'bo@example.test')
  } finally {
    await bo.close()
  }
  assert.doesNotMatch(await logs(box.id), /admin console is at[\s\S]*admin console is at/, 'the admin hint is shown once')
})

test('a backup carries Keycloak: restored into a new installation, the same people sign in to the same accounts', async () => {
  const bo = await person()
  let boId
  try {
    await ssoSignIn(bo.page, box.url, 'bob', 'bo keycloak password 1')
    boId = (await waitFor(() => signedInUser(bo.page), { timeout: 60, what: 'the SSO session' })).id
  } finally { await bo.close() }
  const backup = await ok(['exec', box.id, 'slatebox', 'backup'], { encoding: null })
  assert.ok(backup.length > 1000)
  const fresh = await start({ env: { SLATEBOX_SSO: 'keycloak' } })
  await healthy(fresh.id)
  const restored = await docker(['exec', '-i', fresh.id, 'slatebox', 'restore'], { input: backup })
  assert.equal(restored.code, 0, restored.stderr)
  assert.match(restored.stderr, /Single sign-on \(Keycloak\) data restored\./)
  await healthy(fresh.id)
  const again = await person()
  try {
    await ssoSignIn(again.page, fresh.url, 'bob', 'bo keycloak password 1')
    assert.equal((await waitFor(() => signedInUser(again.page), { timeout: 60, what: 'the SSO session after the restore' })).id, boId)
  } finally { await again.close() }
  // SCIM answers at the new address: the company's provider can still remove people.
  const scim = await scimClient(fresh, fresh.id)
  assert.ok((await scim('GET', '/Users?filter=' + encodeURIComponent('userName eq "bob"'))).totalResults >= 1)
  await remove(fresh.id)
  // The copy of Keycloak's database that travelled in the archive is not left in the restored data.
  const leftover = await docker(['exec', fresh.id, 'sh', '-c', 'ls /data/tmp'])
  assert.equal(leftover.stdout.trim(), '')
})

test('a new address keeps SCIM working; with SLATEBOX_SSO_ADMIN=closed the admin console is not on the published port', async () => {
  // The same volume, recreated at another address (a new SLATEBOX_URL), with the console closed.
  await remove(box.id)
  const moved = await start({ data: box.data, port: await freePort(), env: { SLATEBOX_SSO: 'keycloak', SLATEBOX_SSO_ADMIN: 'closed' } })
  await healthy(moved.id)
  const scim = await scimClient(moved, moved.id)
  assert.ok((await scim('GET', '/Users?filter=' + encodeURIComponent('userName eq "bob"'))).totalResults >= 1, 'SCIM answers at the new address')
  for (const path of ['/auth/admin/', '/auth/admin/master/console/', '/auth/realms/master/protocol/openid-connect/token', '/auth/realms/master/.well-known/openid-configuration']) {
    const response = await fetch(`${moved.url}${path}`, { redirect: 'manual', method: path.endsWith('/token') ? 'POST' : 'GET' })
    assert.equal(response.status, 404, `${path} is closed`)
  }
  assert.match(await exec(moved.id, 'sso'), /Admin console: +closed on this address/)
  const bo = await person()
  try {
    await ssoSignIn(bo.page, moved.url, 'bob', 'bo keycloak password 1')
    assert.equal((await waitFor(() => signedInUser(bo.page), { timeout: 60, what: 'the SSO session at the new address' })).email, 'bo@example.test')
  } finally {
    await bo.close()
  }
})

test('SSO only: no guest, no password, every page leads to "Sign in with SSO"', async () => {
  const strict = await start({ env: { SLATEBOX_SSO: 'keycloak', SLATEBOX_SSO_ONLY: 'true' } })
  await healthy(strict.id)
  const call = await admin(strict, await exec(strict.id, 'sso', 'admin-password'))
  await makeUser(call, { username: 'dee', email: 'dee@example.test', password: 'dee keycloak password 1' })
  const dee = await person()
  try {
    await dee.page.goto(strict.url)
    await dee.page.waitForURL(url => url.pathname === '/login', { timeout: 60_000 })
    await dee.page.locator('#ssoSignIn').waitFor()
    assert.equal(await dee.page.locator('#password').count(), 0, 'no password field')
    assert.equal(await dee.page.getByText('Start now').count(), 0, 'no guest start')
    // The server refuses what the page no longer offers.
    const refused = await dee.page.evaluate(async () => {
      const attempt = promise => promise.then(() => 'allowed', error => error.reason || error.message)
      return {
        guest: await attempt(window.Meteor.callAsync('users.createAnonymous', {})),
        password: await attempt(new Promise((resolve, reject) => window.Meteor.loginWithPassword('dee@example.test', 'dee keycloak password 1', error => (error ? reject(error) : resolve())))),
        signUp: await attempt(new Promise((resolve, reject) => window.Package['accounts-base'].Accounts.createUser({ email: 'eve@example.test', password: 'eve password 42' }, error => (error ? reject(error) : resolve())))),
        forgot: await attempt(window.Meteor.callAsync('forgotPassword', { email: 'dee@example.test' })),
      }
    }).catch(error => ({ error: error.message }))
    for (const [what, reason] of Object.entries(refused)) assert.match(String(reason), /single sign-on/i, what)
    await ssoSignIn(dee.page, strict.url, 'dee', 'dee keycloak password 1')
    const user = await waitFor(() => signedInUser(dee.page), { timeout: 60, what: 'the SSO session' })
    assert.equal(user.email, 'dee@example.test')
    const slate = await createSlate(dee.page, `${strict.url}/new`)
    await writeNote(dee.page, 'Only through SSO')
    await waitFor(async () => (await notes(dee.page)).includes('Only through SSO'), { timeout: 30, what: 'the note' })
    // Dee makes the slate public. Someone without a session still cannot read it: the server, not
    // only the sign-in page, refuses them.
    const shareId = new URL(slate).pathname.split('/')[2]
    await database(strict.id, `return (await db.collection('slates').updateOne({ shareId: ${JSON.stringify(shareId)} }, { $set: { 'options.isPublic': true } })).modifiedCount`)
    const visitor = await person()
    try {
      await visitor.page.goto(`${strict.url}/login`)
      await visitor.page.locator('#ssoSignIn').waitFor()
      const anonymous = await visitor.page.evaluate(async (id) => {
        const attempt = promise => promise.then(result => `allowed: ${JSON.stringify(result)?.slice(0, 80)}`, error => error.reason || error.message)
        return {
          slate: await attempt(window.Meteor.callAsync('slates.get', { shareId: id })),
          reset: await attempt(window.Meteor.callAsync('users.resetPassword', { email: 'dee@example.test' })),
        }
      }, shareId)
      for (const [what, reason] of Object.entries(anonymous)) assert.match(String(reason), /single sign-on/i, what)
    } finally {
      await visitor.close()
    }
    for (const path of [`/embed/${shareId}`, '/api/public-presentations']) {
      const response = await fetch(`${strict.url}${path}`)
      assert.equal(response.status, 404, `${path} is closed under SSO only`)
      assert.match(await response.text(), /single sign-on/i, `${path} is closed by the SSO-only rule`)
    }
  } finally {
    await dee.close()
  }
})

test('without SLATEBOX_SSO, Keycloak is not started and the sign-in page has no SSO button', async () => {
  const plain = await start()
  await healthy(plain.id)
  const processes = await ok(['exec', plain.id, 'sh', '-c', 'cat /proc/[0-9]*/cmdline | tr "\\0" " "'])
  assert.doesNotMatch(processes, /java|keycloak/i)
  assert.doesNotMatch(await ok(['exec', plain.id, 'cat', '/data/secrets/secrets.json']), /keycloak|sso/i)
  assert.equal((await docker(['exec', plain.id, 'test', '-e', '/data/keycloak'])).code, 1, 'no Keycloak data')
  const response = await fetch(`${plain.url}/auth/realms/${REALM}/.well-known/openid-configuration`)
  assert.ok(!(response.headers.get('content-type') || '').includes('application/json'), '/auth is the app, not Keycloak')
  assert.match(await logs(plain.id), /SSO: +off/)
  const visitor = await person()
  try {
    await visitor.page.goto(`${plain.url}/login`)
    await visitor.page.locator('#password').waitFor()
    assert.equal(await visitor.page.locator('#ssoSignIn').count(), 0)
  } finally {
    await visitor.close()
  }
  const status = await docker(['exec', plain.id, 'slatebox', 'sso'])
  assert.equal(status.code, 1)
  assert.match(status.stderr, /Single sign-on is off/)
})
