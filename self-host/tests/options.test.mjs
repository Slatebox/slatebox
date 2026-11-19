// The optional settings: each one off by default and plain about it, and
// each one working when set. Outside services are stood in for by small
// servers in this process; nothing leaves the machine.
import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { after, afterEach, test } from 'node:test'
import { cleanup, docker, freePort, healthy, inspect, logs, name, network, ok, start, waitFor } from './lib.mjs'
import { closeChrome, createSlate, notes, person, savedNotes, writeNote } from './slate.mjs'

// Each test removes what it started, so only a few containers ever run at once.
afterEach(cleanup)
after(closeChrome)

// Let's Encrypt's own ACME test server.
const PEBBLE_IMAGE = process.env.PEBBLE_IMAGE || 'ghcr.io/letsencrypt/pebble:2.8.0'

// Lets a container reach servers in this test process, on Linux as on Docker Desktop.
const hostAccess = ['--add-host', 'host.docker.internal:host-gateway']

/** Call one of the app's methods as the person on this page. */
const call = (page, method, ...args) => page.evaluate(async ([method, args]) => {
  try {
    return { result: await window.Meteor.callAsync(method, ...args) }
  } catch (error) {
    return { error: error.error, reason: error.reason }
  }
}, [method, args])

/** A guest who has just given a name and an email address. */
async function registered(page, address, email) {
  await createSlate(page, address)
  return call(page, 'users.identify', { firstName: 'Ada', lastName: 'Lovelace', email })
}

/** A mail server that accepts everything and keeps it. */
async function mailSink() {
  const messages = []
  const server = createTcpServer(socket => {
    let buffer = '', data = null
    socket.write('220 sink ESMTP\r\n')
    socket.on('error', () => {})
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8')
      for (;;) {
        if (data !== null) {
          const end = buffer.indexOf('\r\n.\r\n')
          if (end < 0) return
          messages.push(data + buffer.slice(0, end))
          buffer = buffer.slice(end + 5)
          data = null
          socket.write('250 kept\r\n')
          continue
        }
        const line = buffer.indexOf('\r\n')
        if (line < 0) return
        const command = buffer.slice(0, line).toUpperCase()
        buffer = buffer.slice(line + 2)
        if (command.startsWith('EHLO') || command.startsWith('HELO')) socket.write('250 sink\r\n')
        else if (command.startsWith('DATA')) { data = ''; socket.write('354 go on\r\n') }
        else if (command.startsWith('QUIT')) { socket.write('221 bye\r\n'); socket.end() }
        else socket.write('250 ok\r\n')
      }
    })
  })
  const port = await freePort()
  await new Promise(resolve => server.listen(port, '0.0.0.0', resolve))
  return { port, messages, close: () => new Promise(resolve => server.close(resolve)) }
}

test('without mail settings, sign-up still works and says that no mail is sent', async () => {
  const box = await start()
  await healthy(box.id)
  assert.match(await logs(box.id), /Mail: +off/)
  const guest = await person()
  try {
    const identified = await registered(guest.page, box.url, 'ada@example.test')
    assert.deepEqual(identified, { result: { verificationEmailSent: false } })
    assert.deepEqual(await call(guest.page, 'users.verificationMailAvailable'), { result: false })
    // The account is saved and the slate keeps working.
    await writeNote(guest.page, 'No mail needed')
    await waitFor(async () => (await savedNotes(guest.page)).includes('No mail needed'), { timeout: 30, what: 'the note to be saved' })
  } finally {
    await guest.close()
  }
})

test('SLATEBOX_MAIL_URL sends verification mail with links to the configured address', async () => {
  const sink = await mailSink()
  try {
    const box = await start({ env: { SLATEBOX_MAIL_URL: `smtp://host.docker.internal:${sink.port}` }, args: hostAccess })
    await healthy(box.id)
    assert.match(await logs(box.id), /Mail: +on/)
    const guest = await person()
    try {
      assert.deepEqual(await registered(guest.page, box.url, 'ada@example.test'), { result: true })
      const mail = await waitFor(() => sink.messages.find(message => /^To: .*ada@example\.test/im.test(message)), { timeout: 60, what: 'the verification mail' })
      const text = mail.replace(/=\r\n/g, '').replace(/=3D/g, '=')
      assert.ok(text.includes(`${box.url}/verify-email/`), 'the link in the mail uses SLATEBOX_URL')
      console.log(`verification mail was sent from ${mail.match(/^From: (.*)$/im)?.[1]?.trim()}`)
    } finally {
      await guest.close()
    }
  } finally {
    await sink.close()
  }
})

test('without an AI key, drafting says who can turn it on', async () => {
  const box = await start()
  await healthy(box.id)
  assert.match(await logs(box.id), /AI drafts: +off/)
  const guest = await person()
  try {
    await registered(guest.page, box.url, 'ada@example.test')
    assert.deepEqual(await call(guest.page, 'workshops.account'), { result: { canGenerate: false } })
    assert.deepEqual(await call(guest.page, 'workshops.draft', 'Decide which launch tasks we do this week', 'lanes'), {
      error: 'plan-required', reason: 'Ask your administrator to enable workshop generation for this instance.',
    })
  } finally {
    await guest.close()
  }
})

test('SLATEBOX_AI_URL sends drafts to your own endpoint with your model and key', async () => {
  const requests = []
  const draft = {
    version: 1, title: 'Launch week',
    lanes: [{ id: 'this-week', label: 'This week' }, { id: 'later', label: 'Later' }],
    cards: [
      { id: 'pricing', label: 'Publish pricing', laneId: 'this-week' },
      { id: 'docs', label: 'Finish the install guide', laneId: 'this-week' },
      { id: 'video', label: 'Record a demo', laneId: 'later' },
      { id: 'forum', label: 'Open the forum', laneId: 'later' },
    ],
  }
  const server = createHttpServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      requests.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(body) })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        id: 'chatcmpl-test', object: 'chat.completion', model: 'slatebox-local',
        choices: [{
          index: 0, finish_reason: 'tool_calls',
          message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'draft_workshop', arguments: JSON.stringify(draft) } }] },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }))
    })
  })
  const port = await freePort()
  await new Promise(resolve => server.listen(port, '0.0.0.0', resolve))
  try {
    const box = await start({
      env: { SLATEBOX_AI_URL: `http://host.docker.internal:${port}/v1`, SLATEBOX_AI_MODEL: 'slatebox-local', SLATEBOX_AI_KEY: 'test-endpoint-token' },
      args: hostAccess,
    })
    await healthy(box.id)
    assert.match(await logs(box.id), new RegExp(`AI drafts: +on, using host\\.docker\\.internal:${port}`))
    assert.ok(!(await logs(box.id)).includes('test-endpoint-token'), 'the key is not logged')
    const guest = await person()
    try {
      await registered(guest.page, box.url, 'ada@example.test')
      assert.deepEqual(await call(guest.page, 'workshops.account'), { result: { canGenerate: true } })
      const drafted = await call(guest.page, 'workshops.draft', 'Decide which launch tasks we do this week', 'lanes')
      assert.equal(drafted.error, undefined, drafted.reason)
      assert.equal(drafted.result.title, 'Launch week')
      assert.equal(requests.length, 1)
      assert.equal(requests[0].url, '/v1/chat/completions')
      assert.equal(requests[0].authorization, 'Bearer test-endpoint-token')
      assert.equal(requests[0].body.model, 'slatebox-local')
    } finally {
      await guest.close()
    }
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('SLATEBOX_AI_KEY alone turns drafting on with the default provider', async () => {
  // The provider itself is not called here; this proves the switch and that the key reaches only the app.
  const box = await start({ env: { SLATEBOX_AI_KEY: 'test-provider-key' } })
  await healthy(box.id)
  assert.match(await logs(box.id), /AI drafts: +on, using DeepInfra/)
  assert.ok(!(await logs(box.id)).includes('test-provider-key'))
  const environment = await ok(['exec', box.id, 'sh', '-c', `for p in /proc/[0-9]*; do if tr '\\0' ' ' < $p/cmdline | grep -q '^node main.js'; then tr '\\0' '\\n' < $p/environ | grep -c '^API_KEY_DEEP_INFRA=test-provider-key$'; fi; done`])
  assert.equal(environment, '1', 'the app process received the key')
  const guest = await person()
  try {
    await registered(guest.page, box.url, 'ada@example.test')
    assert.deepEqual(await call(guest.page, 'workshops.account'), { result: { canGenerate: true } })
  } finally {
    await guest.close()
  }
})

test('without a Daily key, a call says that calls are unavailable; SLATEBOX_SETTINGS supplies the key', async () => {
  const join = async address => {
    const guest = await person()
    try {
      const shareId = new URL(await createSlate(guest.page, address)).pathname.split('/')[2]
      return await call(guest.page, 'daily.join', { shareId })
    } finally {
      await guest.close()
    }
  }
  const off = await start()
  await healthy(off.id)
  assert.deepEqual(await join(off.url), {
    error: 'huddle-unconfigured', reason: 'Calls are unavailable. Ask your administrator to configure the Daily provider for this instance.',
  })

  // With a key in SLATEBOX_SETTINGS the app's server settings carry it and the
  // browser's do not. Daily's API is pointed at this container so that the
  // made-up key never leaves the machine: the call path now gets as far as
  // the provider and reports that it could not be reached.
  const on = await start({
    env: { SLATEBOX_SETTINGS: JSON.stringify({ daily: { apiKey: 'test-daily-key' }, public: { baseUrl: 'http://elsewhere.invalid' } }) },
    args: ['--add-host', 'api.daily.co:127.0.0.1'],
  })
  await healthy(on.id)
  const page = await (await fetch(on.url + '/')).text()
  const runtime = JSON.parse(decodeURIComponent(page.match(/__meteor_runtime_config__ = JSON\.parse\(decodeURIComponent\("([^"]+)"\)\)/)[1]))
  assert.ok(!JSON.stringify(runtime).includes('test-daily-key'), 'the key is not sent to browsers')
  // The address wiring cannot be overridden through SLATEBOX_SETTINGS.
  assert.equal(runtime.PUBLIC_SETTINGS.baseUrl, on.url)
  assert.equal(runtime.PUBLIC_SETTINGS.wsUrl, on.url.replace(/^http/, 'ws') + '/live')
  assert.equal(runtime.PUBLIC_SETTINGS.env, 'selfhost')
  assert.deepEqual(await join(on.url), { error: 'huddle-unavailable', reason: 'The call could not be opened. Please try again.' })
  assert.ok(!(await logs(on.id)).includes('test-daily-key'), 'the key is not logged')
})

test('MONGO_URL uses an external database and leaves the bundled one off', async () => {
  const net = await network()
  const database = name('mongo')
  // An ordinary single-member replica set, as an operator would run it.
  await ok(['run', '-d', '--name', database, '--network', net, 'mongo:8.0.17', '--replSet', 'ext0', '--bind_ip_all'])
  try {
    await waitFor(async () => (await docker(['exec', database, 'mongosh', '--quiet', '--eval',
      `try { rs.status().ok } catch (e) { rs.initiate({ _id: 'ext0', members: [{ _id: 0, host: '${database}:27017' }] }).ok }`])).code === 0, { timeout: 120, what: 'the external database' })
    await waitFor(async () => (await docker(['exec', database, 'mongosh', '--quiet', '--eval', 'db.hello().isWritablePrimary'])).stdout.trim() === 'true', { timeout: 120, what: 'a primary' })

    const url = `mongodb://${database}:27017/slatebox?replicaSet=ext0`
    const box = await start({ env: { MONGO_URL: url, MONGO_OPLOG_URL: `mongodb://${database}:27017/local?replicaSet=ext0` }, args: ['--network', net] })
    await healthy(box.id)
    assert.match(await logs(box.id), /Database: +external \(MONGO_URL\)/)
    const processes = await ok(['exec', box.id, 'sh', '-c', `for p in /proc/[0-9]*; do tr '\\0' ' ' < $p/cmdline; echo; done`])
    assert.doesNotMatch(processes, /mongod/, 'the bundled database is not running')
    assert.equal((await docker(['exec', box.id, 'test', '-e', '/data/db'])).code, 1, 'no local database directory is created')

    const author = await person()
    try {
      await createSlate(author.page, box.url)
      await writeNote(author.page, 'Stored in an external database')
      await waitFor(async () => (await savedNotes(author.page)).includes('Stored in an external database'), { timeout: 30, what: 'the note to be saved' })
      assert.ok((await notes(author.page)).includes('Stored in an external database'))
    } finally {
      await author.close()
    }
    const stored = await ok(['exec', database, 'mongosh', '--quiet', 'slatebox', '--eval', 'db.slates.countDocuments()'])
    assert.ok(Number(stored) >= 1, 'the slate is in the external database')

    // Backups belong to whoever runs the database.
    const backup = await docker(['exec', box.id, 'slatebox', 'backup'])
    assert.equal(backup.code, 1)
    assert.equal(backup.stdout, '')
    assert.match(backup.stderr, /uses an external database \(MONGO_URL\)/)
  } finally {
    await docker(['rm', '-f', '-v', database])
  }
})

test('SLATEBOX_HTTPS=off: an https address behind your own proxy, on the one upstream port', async () => {
  const net = await network()
  const host = 'boards.slatebox-one.test'
  const port = await freePort()
  const address = `https://${host}:${port}`
  const box = await start({ env: { SLATEBOX_URL: address, SLATEBOX_HTTPS: 'off' }, args: ['--network', net], publish: [] })
  await healthy(box.id)
  assert.match(await logs(box.id), /HTTPS: +handled by your proxy/)
  // The operator's proxy: terminates TLS with its own certificate and forwards to the single upstream.
  const proxy = name('edge')
  await ok(['run', '-d', '--name', proxy, '--network', net, '-p', `${port}:443`, 'caddy:2.11.9',
    'caddy', 'reverse-proxy', '--from', `${host}:443`, '--to', `${box.id}:7070`, '--internal-certs'])
  try {
    // Wait for the proxy to hold its certificate and pass a request through.
    const { request } = await import('node:https')
    await waitFor(() => new Promise(resolve => {
      const probe = request({ host: '127.0.0.1', port, servername: host, path: '/readyz', headers: { host: `${host}:${port}` }, rejectUnauthorized: false, timeout: 5000 },
        response => { response.resume(); resolve(response.statusCode === 200) })
      probe.on('error', () => resolve(false))
      probe.on('timeout', () => probe.destroy())
      probe.end()
    }), { timeout: 90, what: 'the proxy in front' })
    const author = await person({ ignoreHTTPSErrors: true })
    try {
      await createSlate(author.page, address)
      await writeNote(author.page, 'Behind a proxy')
      await waitFor(async () => (await savedNotes(author.page)).includes('Behind a proxy'), { timeout: 30, what: 'the note to be saved' })
      assert.ok(author.sockets.some(url => url.startsWith(`wss://${host}:${port}/live/`)), 'live editing goes through the proxy as wss')
    } finally {
      await author.close()
    }
  } finally {
    await docker(['rm', '-f', proxy])
  }
  assert.equal(await inspect(box.id, '{{.State.Status}}'), 'running')
})

test('an https address turns on built-in HTTPS with an automatically issued certificate', async t => {
  // A local ACME certificate authority (Pebble, Let's Encrypt's test server)
  // stands in for Let's Encrypt. It validates the name the way the real one
  // does: by calling the container on ports 80 and 443.
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const work = mkdtempSync(join(tmpdir(), 'slatebox-one-acme-'))
  t.after(() => rmSync(work, { recursive: true, force: true }))

  const net = await network()
  const host = 'boards.slatebox-one.test'
  const authority = name('pebble')
  writeFileSync(join(work, 'pebble.json'), JSON.stringify({ pebble: {
    listenAddress: '0.0.0.0:14000', managementListenAddress: '0.0.0.0:15000',
    certificate: 'test/certs/localhost/cert.pem', privateKey: 'test/certs/localhost/key.pem',
    httpPort: 80, tlsPort: 443, ocspResponderURL: '', externalAccountBindingRequired: false,
  } }))
  await ok(['run', '-d', '--name', authority, '--network', net, '--network-alias', 'pebble',
    '-e', 'PEBBLE_VA_NOSLEEP=1', '-e', 'PEBBLE_WFE_NONCEREJECT=0',
    '-v', `${join(work, 'pebble.json')}:/config.json:ro`, PEBBLE_IMAGE, '-config', '/config.json'])
  t.after(() => docker(['rm', '-f', '-v', authority]))
  // Slatebox must trust the authority's own API certificate, as it trusts Let's Encrypt's.
  writeFileSync(join(work, 'ca.pem'), await ok(['exec', authority, 'cat', '/test/certs/pebble.minica.pem']).catch(async () =>
    (await ok(['cp', `${authority}:/test/certs/pebble.minica.pem`, '-'], { encoding: 'latin1' })).replace(/^[\s\S]*?(-----BEGIN)/, '$1').replace(/(-----END CERTIFICATE-----)[\s\S]*$/, '$1\n')))

  const port = await freePort()
  const box = await start({
    env: { SLATEBOX_URL: `https://${host}`, SLATEBOX_ACME_CA: 'https://pebble:14000/dir', SSL_CERT_FILE: '/run/acme-ca.pem' },
    args: ['--network', net, '--network-alias', host, '-v', `${join(work, 'ca.pem')}:/run/acme-ca.pem:ro`],
    publish: [`${port}:443`],
  })
  await healthy(box.id)
  assert.match(await logs(box.id), new RegExp(`HTTPS: +built in, certificates for ${host}`))

  // From inside the network, as a visitor resolving the public name would:
  // the certificate comes from the authority, HTTP redirects to HTTPS, and a
  // signed live-editing connection works over wss on 443.
  const probe = await waitFor(async () => {
    const result = await docker(['exec', '-e', 'NODE_TLS_REJECT_UNAUTHORIZED=0', '-e', 'NODE_NO_WARNINGS=1', box.id, 'node', '--input-type=module', '-e', `
      import tls from 'node:tls'
      import { readSecrets, relaySignature } from '/opt/slatebox/lib/common.mjs'
      const certificate = await new Promise((resolve, reject) => {
        const socket = tls.connect({ host: '${host}', port: 443, servername: '${host}', rejectUnauthorized: false }, () => {
          resolve(socket.getPeerCertificate()); socket.end()
        })
        socket.on('error', reject)
      })
      const ready = await (await fetch('https://${host}/readyz')).json()
      const redirect = await fetch('http://${host}/start', { redirect: 'manual' })
      const { apiPublicKey, apiSecretKey } = readSecrets()
      const live = await new Promise(resolve => {
        const socket = new WebSocket('wss://${host}/live/tls-check?' + new URLSearchParams(relaySignature(apiPublicKey, apiSecretKey)))
        socket.binaryType = 'arraybuffer'
        socket.onmessage = event => { resolve(typeof event.data === 'string' ? event.data : 'synced'); socket.close() }
        socket.onerror = () => resolve('failed')
      })
      console.log(JSON.stringify({ issuer: certificate.issuer.CN, names: certificate.subjectaltname, ready, redirect: [redirect.status, redirect.headers.get('location')], live }))`])
    if (result.code !== 0) return null
    const seen = JSON.parse(result.stdout)
    return /Pebble Intermediate CA/.test(seen.issuer) ? seen : null
  }, { timeout: 180, every: 2000, what: 'a certificate from the ACME authority' })
  assert.equal(probe.names, `DNS:${host}`)
  assert.deepEqual(probe.ready, { ok: true, service: 'slatebox-app' })
  assert.deepEqual(probe.redirect, [308, `https://${host}/start`])
  assert.equal(probe.live, 'synced')
  // The certificate is kept on the data volume, so a new container does not ask for another.
  assert.match(await ok(['exec', box.id, 'sh', '-c', 'find /data/caddy -name "*.crt"']), new RegExp(`${host.replaceAll('.', '\\.')}\\.crt`))

  // And a real browser, sent to this machine's published port for that name, uses the app over HTTPS only.
  const { browser } = await import('./lib.mjs')
  const chromeForName = await browser([`--host-resolver-rules=MAP ${host}:443 127.0.0.1:${port}`])
  try {
    const context = await chromeForName.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1300, height: 900 } })
    const page = await context.newPage()
    const sockets = []
    page.on('websocket', socket => sockets.push(socket.url()))
    await createSlate(page, `https://${host}`)
    await writeNote(page, 'Served over built-in HTTPS')
    await waitFor(async () => (await savedNotes(page)).includes('Served over built-in HTTPS'), { timeout: 30, what: 'the note to be saved' })
    assert.ok(sockets.some(url => url.startsWith(`wss://${host}/live/`)), 'live editing uses wss on the same name')
    assert.deepEqual(sockets.filter(url => !url.startsWith(`wss://${host}/`)), [])
  } finally {
    await chromeForName.close()
  }
})
