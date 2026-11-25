// A new Slatebox has no accounts and takes none, not even a guest, until its first admin uses the
// one-time setup link (`slatebox setup-link`): that person becomes the server administrator and
// the owner of the first team. One installation lives through these tests, in order.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, test } from 'node:test'
import { cleanup, docker, healthy, logs, ok, setupLink, start } from './lib.mjs'
import { closeChrome, person } from './slate.mjs'

let box
const tokens = []
const get = (url, init) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000), ...init })
const post = (url, form) => get(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) })
const local = link => {
  const { pathname } = new URL(link)
  tokens.push(pathname.split('/').pop())
  return box.url + pathname
}

/** Slatebox's own database, read inside the container. */
async function database(script) {
  return JSON.parse(await ok(['exec', box.id, 'node', '--input-type=module', '-e', `
    import { mongodb, mongoUrl, readSecrets } from '/opt/slatebox/lib/common.mjs'
    const client = new (mongodb().MongoClient)(mongoUrl('root', readSecrets().mongoRootPassword, { database: '', authSource: 'admin' }))
    await client.connect()
    const db = client.db('slatebox')
    try { console.log(JSON.stringify(await (async () => { ${script} })())) } finally { await client.close() }`]))
}

/** Methods called over Meteor's own DDP WebSocket, the way any browser or script can call them. */
async function ddp(calls) {
  const socket = new WebSocket(`${box.url.replace(/^http/, 'ws')}/websocket`)
  const results = {}
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no DDP answer: ${JSON.stringify(results)}`)), 30_000)
    socket.onerror = () => reject(new Error('DDP connection failed'))
    socket.onopen = () => socket.send(JSON.stringify({ msg: 'connect', version: '1', support: ['1'] }))
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.msg === 'connected') {
        calls.forEach(([method, ...params], index) => socket.send(JSON.stringify({ msg: 'method', id: String(index), method, params })))
      } else if (message.msg === 'ping') {
        socket.send(JSON.stringify({ msg: 'pong' }))
      } else if (message.msg === 'result') {
        results[calls[Number(message.id)][0]] = message.error ? { error: message.error.reason || message.error.message } : { ok: true }
        if (Object.keys(results).length === calls.length) {
          clearTimeout(timer)
          resolve()
        }
      }
    }
  })
  socket.close()
  return results
}

const SIGN_UP = ['createUser', { email: 'early@example.test', password: { digest: createHash('sha256').update('early bird 42').digest('hex'), algorithm: 'sha-256' } }]

before(async () => {
  box = await start()
  await healthy(box.id)
})

after(async () => {
  await closeChrome()
  await cleanup()
})

test('before setup: every page says it isn\'t set up yet, with no sign-up form; health still answers', async () => {
  for (const path of ['/', '/login', '/signup', '/canvas/abc123', '/start']) {
    const response = await get(box.url + path)
    assert.equal(response.status, 200, path)
    const html = await response.text()
    assert.match(html, /This Slatebox isn't set up yet/, path)
    assert.match(html, /slatebox setup-link/, path)
    assert.doesNotMatch(html, /__meteor_runtime_config__|<form|<input/, path)
  }
  assert.deepEqual(await (await get(`${box.url}/readyz`)).json(), { ok: true, service: 'slatebox-app' })
  assert.equal((await docker(['exec', box.id, 'slatebox', 'health', '--deep'])).code, 0)
  assert.deepEqual(JSON.parse(await ok(['exec', box.id, 'slatebox', 'setup-link', '--check'])), { setUp: false, linkExpiresAt: null })
})

test('before setup the server makes no account of any kind: no sign-up, no guest', async () => {
  const refused = await ddp([['users.createAnonymous', {}], SIGN_UP])
  for (const [method, result] of Object.entries(refused)) assert.match(String(result.error), /isn't set up yet/, method)
  assert.equal(await database("return db.collection('users').countDocuments()"), 0)
})

test('a new link ends the one before; an expired link says so; neither shows the form', async () => {
  const first = local(await setupLink(box))
  const second = local(await setupLink(box))
  assert.notEqual(first, second)
  const ended = await get(first)
  assert.equal(ended.status, 410)
  assert.match(await ended.text(), /This setup link doesn't work/)
  // Only the hash is kept.
  const stored = await database("return db.collection('systemSettings').findOne({ _id: 'selfHostSetup' })")
  assert.equal(stored.tokenHash, createHash('sha256').update(tokens[1]).digest('hex'))
  assert.ok(!JSON.stringify(stored).includes(tokens[1]))
  await database("return (await db.collection('systemSettings').updateOne({ _id: 'selfHostSetup' }, { $set: { expiresAt: new Date(Date.now() - 1000) } })).modifiedCount")
  const expired = await get(second)
  assert.equal(expired.status, 410)
  const page = await expired.text()
  assert.match(page, /This setup link has expired/)
  assert.doesNotMatch(page, /<form/)
})

test('the setup link: a form that says what it makes; mistakes are sent back; the link still works after them', async () => {
  const link = local(await setupLink(box))
  const form = await get(link)
  assert.equal(form.status, 200)
  assert.equal(form.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(form.headers.get('cache-control'), 'no-store')
  const html = await form.text()
  assert.match(html, /Set up Slatebox/)
  assert.match(html, /server's administrator and the owner of its first team/)
  const wrong = await post(link, { firstName: 'Ada', email: 'not an email', password: 'short', team: '' })
  assert.equal(wrong.status, 400)
  const again = await wrong.text()
  assert.match(again, /Enter your email address\./)
  assert.match(again, /Choose a password of at least 8 characters\./)
  assert.match(again, /Give your team a name\./)
  assert.equal(await database("return db.collection('users').countDocuments()"), 0)
  assert.equal((await get(link)).status, 200, 'still good')
})

test('the first admin opens the link in a browser, is signed in, and is the server administrator and team owner', async () => {
  const link = local(await setupLink(box))
  const ada = await person()
  try {
    await ada.page.goto(link)
    await ada.page.getByLabel('First name').fill('Ada')
    await ada.page.getByLabel('Last name').fill('Lovelace')
    await ada.page.getByLabel('Email').fill('ada@example.test')
    await ada.page.getByLabel('Password').fill('analytical engine 1843')
    await ada.page.getByLabel('Team name').fill('Engines')
    await ada.page.getByRole('button', { name: 'Create the admin account' }).click()
    await ada.page.waitForURL(url => !url.pathname.startsWith('/setup/'), { timeout: 60_000 })
    const user = await ada.page.waitForFunction(() => window.Meteor?.user()?.emails?.[0]?.address, null, { timeout: 90_000 })
    assert.equal(await user.jsonValue(), 'ada@example.test')
  } finally {
    await ada.close()
  }
  const roles = await database(`
    const user = await db.collection('users').findOne({ 'emails.address': 'ada@example.test' })
    const org = await db.collection('organizations').findOne({ _id: user.orgId })
    const setup = await db.collection('systemSettings').findOne({ _id: 'selfHostSetup' })
    return {
      admin: await db.collection('permissions').countDocuments({ userId: user._id, claimId: 'uberMensch' }),
      teamAdmin: await db.collection('permissions').countDocuments({ userId: user._id, orgId: user.orgId, claimId: 'admin' }),
      owner: user.isOrgOwner === true, team: org.name, guest: user.isAnonymous,
      setup: { via: setup.via, done: Boolean(setup.completedAt), admin: setup.adminUserId === user._id, hash: 'tokenHash' in setup },
    }`)
  assert.deepEqual(roles, { admin: 1, teamAdmin: 1, owner: true, team: 'Engines', guest: false, setup: { via: 'password', done: true, admin: true, hash: false } })
  // The link was single use.
  const reused = await post(link, { firstName: 'Mallory', email: 'mallory@example.test', password: 'mallory password 1', team: 'Mine' })
  assert.equal(reused.status, 200)
  assert.match(await reused.text(), /This Slatebox is already set up/)
  assert.equal(await database("return db.collection('users').countDocuments({ 'emails.address': 'mallory@example.test' })"), 0)
})

test('after setup: no more links, the app is served, and people sign up and use guests as usual', async () => {
  const more = await docker(['exec', box.id, 'slatebox', 'setup-link'])
  assert.equal(more.code, 3)
  assert.match(more.stderr, /already set up/)
  assert.equal(more.stdout, '')
  assert.deepEqual(JSON.parse(await ok(['exec', box.id, 'slatebox', 'setup-link', '--check'])), { setUp: true, linkExpiresAt: null })
  assert.match(await (await get(`${box.url}/`)).text(), /__meteor_runtime_config__/)
  assert.deepEqual(await ddp([['users.createAnonymous', {}], SIGN_UP]), { 'users.createAnonymous': { ok: true }, createUser: { ok: true } })
  // Only the first account is the server administrator.
  assert.equal(await database("return db.collection('permissions').countDocuments({ claimId: 'uberMensch' })"), 1)
})

test('a restart stays set up, and no setup link was ever written to the log', async () => {
  await ok(['restart', box.id])
  await healthy(box.id)
  assert.match(await (await get(`${box.url}/`)).text(), /__meteor_runtime_config__/)
  const log = await logs(box.id)
  assert.ok(tokens.length >= 4)
  for (const token of tokens) assert.ok(!log.includes(token), 'a setup token appears in docker logs')
  assert.match(log, /\[setup\] the first administrator was created \(password\)/)
})
