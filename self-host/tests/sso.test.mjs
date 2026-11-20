// Single sign-on with the bundled Keycloak, end to end through the one published port:
// SLATEBOX_SSO=keycloak, a person made in Keycloak signs in to Slatebox in a real browser,
// gets an account and a slate, is disabled in Keycloak and loses access. Also SCIM provisioning,
// sign-in events, "SSO only", a restart, and SSO staying off by default.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { cleanup, docker, healthy, logs, ok, start, waitFor } from './lib.mjs'
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
  return async (method, path, body) => {
    const response = await fetch(`${base}/admin/realms/${REALM}${path}`, {
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

    // Signing in again lands in the same account.
    const again = await person()
    try {
      await ssoSignIn(again.page, box.url, 'ada', 'ada keycloak password 1')
      assert.equal((await waitFor(() => signedInUser(again.page), { timeout: 60, what: 'the second session' })).id, user.id)
    } finally { await again.close() }

    // The administrator disables her in Keycloak. Within the session check (60 s) her open tab is signed out.
    const disabledAt = Date.now()
    await call('PUT', `/users/${kcId}`, { enabled: false })
    await waitFor(async () => (await ada.page.evaluate(() => window.Meteor.userId())) !== user.id, { timeout: 150, every: 2000, what: 'the session to be revoked' })
    console.log(`access revoked ${Math.round((Date.now() - disabledAt) / 1000)} s after the user was disabled`)
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
    assert.match(log, /\[app\] sso: account \w+ signed out: the identity provider refused its session/)
  } finally {
    await ada.close()
  }
})

test('an existing password account is matched by its verified email and keeps its slates', async () => {
  const bo = await person()
  try {
    // Bo has used Slatebox with a password before SSO arrived.
    await createSlate(bo.page, box.url)
    await bo.page.evaluate(() => window.Meteor.callAsync('users.identify', { firstName: 'Bo', email: 'bo@example.test', password: 'bo password 42' }))
    const before = await signedInUser(bo.page)
    await bo.page.evaluate(() => new Promise(resolve => window.Meteor.logout(resolve)))
    const call = await admin(box, adminPassword)
    await makeUser(call, { username: 'bo', email: 'Bo@Example.test', password: 'bo keycloak password 1' })
    await ssoSignIn(bo.page, box.url, 'bo', 'bo keycloak password 1')
    const after = await waitFor(() => signedInUser(bo.page), { timeout: 60, what: 'the SSO session' })
    assert.equal(after.id, before.id, 'the same account')
    assert.equal(after.verified, true)
  } finally {
    await bo.close()
  }
})

test('SCIM provisions a person into Keycloak, who can then sign in; deactivated over SCIM, they lose access', async () => {
  const secret = await exec(box.id, 'sso', 'scim-secret')
  const issuer = `${box.url}/auth/realms/${REALM}`
  const token = (await (await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'scim', client_secret: secret }),
  })).json()).access_token
  const scim = async (method, path, body) => {
    const response = await fetch(`${issuer}/scim/v2${path}`, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/scim+json' }, body: body && JSON.stringify(body),
    })
    assert.ok(response.ok, `SCIM ${method} ${path}: HTTP ${response.status} ${await response.clone().text()}`)
    return response.status === 204 ? null : response.json()
  }
  const made = await scim('POST', '/Users', {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'cy', active: true,
    name: { givenName: 'Cy', familyName: 'Scim' }, emails: [{ value: 'cy@example.test', primary: true }],
  })
  // SCIM cannot carry a password; the person would sign in through a brokered company provider. Here the test sets one.
  const call = await admin(box, adminPassword)
  await call('PUT', `/users/${made.id}`, { emailVerified: true })
  await call('PUT', `/users/${made.id}/reset-password`, { type: 'password', value: 'cy keycloak password 1', temporary: false })
  const cy = await person()
  try {
    await ssoSignIn(cy.page, box.url, 'cy', 'cy keycloak password 1')
    const user = await waitFor(() => signedInUser(cy.page), { timeout: 60, what: 'the SSO session' })
    assert.equal(user.email, 'cy@example.test')
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
    await ssoSignIn(bo.page, box.url, 'bo', 'bo keycloak password 1')
    assert.equal((await waitFor(() => signedInUser(bo.page), { timeout: 60, what: 'the SSO session' })).email, 'bo@example.test')
  } finally {
    await bo.close()
  }
  assert.doesNotMatch(await logs(box.id), /admin console is at[\s\S]*admin console is at/, 'the admin hint is shown once')
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
    await createSlate(dee.page, `${strict.url}/new`)
    await writeNote(dee.page, 'Only through SSO')
    await waitFor(async () => (await notes(dee.page)).includes('Only through SSO'), { timeout: 30, what: 'the note' })
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
