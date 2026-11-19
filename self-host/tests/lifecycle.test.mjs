// Starting, stopping, failing and replacing the container.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  IMAGE, cleanup, docker, freePort, healthy, inspect, logs, name, ok, remove, removeVolume, secrets, start, volume, waitFor,
} from './lib.mjs'
import { closeChrome, expectSlate, seedSlate } from './slate.mjs'

const get = (url, headers) => fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
const exited = id => waitFor(async () => (await inspect(id, '{{.State.Status}}')) === 'exited', { timeout: 180, what: `${id} to exit` })

// Kill the process whose command line matches, as a crash would.
const kill = (id, pattern) => ok(['exec', id, 'sh', '-c',
  `for p in /proc/[0-9]*; do if tr '\\0' ' ' < $p/cmdline 2>/dev/null | grep -q '${pattern}'; then kill -KILL \${p#/proc/}; fi; done`])

// One installation lives through the first group of tests, in order, the way
// a real one lives through its first day.
let box, firstSecrets, slate

before(async () => {
  box = await start({ args: ['--restart', 'unless-stopped'] })
})

after(async () => {
  await closeChrome()
  await cleanup()
})

test('first start: one command, one port, healthy when a slate can be opened', async () => {
  const seconds = await healthy(box.id)
  console.log(`first start was healthy after ${seconds.toFixed(0)}s`)

  const log = await logs(box.id)
  assert.match(log, new RegExp(`\\[slatebox\\] Ready\\. Open ${box.url}`))
  assert.match(log, /Secrets: +created for this new installation/)

  // The app, with its database behind it, and the relay answer on the same port.
  const page = await get(box.url + '/')
  assert.equal(page.status, 200)
  assert.match(await page.text(), /__meteor_runtime_config__/)
  assert.deepEqual(await (await get(box.url + '/readyz')).json(), { ok: true, service: 'slatebox-app' })
  assert.match(await (await get(box.url + '/live/')).text(), /Websocket/)

  // The check a browser's live-editing connection depends on.
  assert.equal((await docker(['exec', box.id, 'slatebox', 'health', '--deep'])).code, 0)

  // Nothing runs as root.
  const users = (await ok(['exec', box.id, 'sh', '-c', 'for p in /proc/[0-9]*; do stat -c %u $p; done | sort -u'])).split('\n')
  assert.deepEqual(users, ['10001'])
})

test('secrets are generated on first start, kept private, and never shown', async () => {
  firstSecrets = await secrets(box.id)
  const values = Object.values(firstSecrets)
  assert.equal(values.length, 7)
  assert.equal(new Set(values).size, 7, 'every secret is distinct')
  for (const value of values) assert.ok(value.length >= 40, 'secrets are long random values')
  assert.equal(await ok(['exec', box.id, 'stat', '-c', '%a %U', '/data/secrets', '/data/secrets/secrets.json', '/data/secrets/mongo.key']),
    '700 slatebox\n600 slatebox\n400 slatebox')
  // Neither the log nor the container's configuration contains one.
  const visible = (await logs(box.id)) + await ok(['inspect', box.id])
  for (const [key, value] of Object.entries(firstSecrets)) assert.ok(!visible.includes(value), `${key} does not appear in the log or in docker inspect`)
})

test('while the app is down, the port answers with a waiting page and the health check is red', async () => {
  // Pause the app and relay the way a restore does.
  const signal = name => ok(['exec', box.id, 'sh', '-c', `kill -${name} "$(cat /run/slatebox/init.pid)"`])
  await signal('USR1')
  await waitFor(async () => (await docker(['exec', box.id, 'test', '-e', '/run/slatebox/paused'])).code === 0, { timeout: 60, what: 'the pause' })
  const response = await get(box.url + '/')
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('retry-after'), '3')
  assert.match(await response.text(), /Slatebox is starting/)
  const health = await docker(['exec', box.id, 'slatebox', 'health'])
  assert.equal(health.code, 1)
  assert.match(health.stderr, /paused while a backup is restored/)
  // Resume: the same container becomes healthy again without a restart.
  await signal('USR2')
  await waitFor(async () => (await docker(['exec', box.id, 'slatebox', 'health', '--deep'])).code === 0, { timeout: 300, every: 2000, what: 'the app to come back' })
  assert.equal(await inspect(box.id, '{{.RestartCount}}'), '0')
  assert.equal((await get(box.url + '/')).status, 200)
})

test('a restart keeps slates and secrets', async () => {
  slate = await seedSlate(box.url, 'Written on the first day')
  await ok(['restart', box.id])
  await healthy(box.id)
  assert.deepEqual(await secrets(box.id), firstSecrets)
  assert.match(await logs(box.id), /Secrets: +kept from earlier starts/)
  await expectSlate(slate, 'Written on the first day')
})

test('docker stop ends cleanly inside the default ten seconds', async () => {
  await ok(['stop', box.id])
  assert.equal(await inspect(box.id, '{{.State.ExitCode}}'), '0')
  const stamped = (await docker(['logs', '-t', box.id])).stdout.split('\n')
  const at = text => new Date(stamped.findLast(line => line.includes(text)).split(' ')[0]).getTime()
  const took = (at('[slatebox] Stopped.') - at('[slatebox] Stopping.')) / 1000
  console.log(`stop took ${took.toFixed(1)}s inside the container`)
  assert.ok(took < 10, `the ordered stop took ${took}s`)
  // MongoDB empties its lock file only on a clean shutdown.
  const lock = await docker(['run', '--rm', '--network', 'none', '-v', `${box.data}:/data`, '--entrypoint', 'sh', IMAGE, '-c', 'test -f /data/db/mongod.lock && test ! -s /data/db/mongod.lock'])
  assert.equal(lock.code, 0, 'the database was shut down cleanly')
  // A stopped container stays stopped, and starts again when asked.
  assert.equal(await inspect(box.id, '{{.State.Status}}'), 'exited')
  await ok(['start', box.id])
  await healthy(box.id)
  await expectSlate(slate, 'Written on the first day')
})

test('with --restart unless-stopped a dead process means a clean restart with the data intact', async () => {
  const restarts = Number(await inspect(box.id, '{{.RestartCount}}'))
  await kill(box.id, '^node main.js')
  await waitFor(async () => Number(await inspect(box.id, '{{.RestartCount}}')) > restarts, { timeout: 180, what: 'Docker to restart the container' })
  await healthy(box.id)
  assert.equal(Number(await inspect(box.id, '{{.RestartCount}}')), restarts + 1)
  assert.match(await logs(box.id), /\[slatebox\] app stopped unexpectedly \(exit 137\)\. Stopping the container so that Docker can restart it\./)
  assert.deepEqual(await secrets(box.id), firstSecrets)
  await expectSlate(slate, 'Written on the first day')
  await remove(box.id)
  await removeVolume(box.data)
})

test('when any one of the four processes dies, the container exits with status 1', async () => {
  const services = [['app', '^node main.js'], ['relay', '^node bin/server.js'], ['proxy', '^caddy run'], ['mongo', '^mongod --dbpath']]
  const boxes = await Promise.all(services.map(() => start()))
  await Promise.all(boxes.map(each => healthy(each.id)))
  await Promise.all(services.map(async ([service, pattern], index) => {
    const { id, data } = boxes[index]
    await kill(id, pattern)
    await exited(id)
    assert.equal(await inspect(id, '{{.State.ExitCode}}'), '1', `${service}: exit status`)
    const log = await logs(id)
    assert.match(log, new RegExp(`\\[slatebox\\] ${service} stopped unexpectedly`))
    assert.match(log, /\[slatebox\] Stopped\./, `${service}: the others were stopped in order`)
    await remove(id)
    await removeVolume(data)
  }))
})

test('upgrade: a new container from another image on the same volume', async () => {
  const data = await volume()
  const port = await freePort()
  const id = name('upgrade')
  const old = await start({ data, port, containerName: id })
  await healthy(old.id)
  const kept = await seedSlate(old.url, 'Survives an upgrade')
  const before = await secrets(old.id)

  // Stand-in for a newer release: the same image with a different identity.
  const next = `${name('image')}:next`
  const build = await docker(['build', '-t', next, '-'], {
    input: `FROM ${IMAGE}\nUSER root\nRUN sed -i 's/"app":"[^"]*"/"app":"nextrelease0"/' /opt/slatebox/identity.json\nUSER slatebox\n`,
  })
  assert.equal(build.code, 0, build.stderr)
  try {
    // The documented steps: remove the container, run the same command.
    await ok(['rm', '-f', old.id])
    const upgraded = await start({ data, port, containerName: id, image: next })
    await healthy(upgraded.id)
    assert.equal(JSON.parse(await ok(['exec', upgraded.id, 'slatebox', 'version'])).app, 'nextrelease0')
    assert.deepEqual(await secrets(upgraded.id), before)
    assert.match(await logs(upgraded.id), /Secrets: +kept from earlier starts/)
    await expectSlate(kept, 'Survives an upgrade')
    await remove(upgraded.id)
    await removeVolume(data)
  } finally {
    await docker(['rmi', '-f', next])
  }
})

test('reached at another address, it says which setting to change', async () => {
  // Published on a port other than 7070 with no address given.
  const port = await freePort()
  const lost = await start({ port, env: { SLATEBOX_URL: undefined } })
  await healthy(lost.id)
  const response = await get(`http://localhost:${port}/`)
  assert.equal(response.status, 421)
  const body = await response.text()
  assert.match(body, /Slatebox is set up for another address/)
  assert.match(body, /http:\/\/localhost:7070/)
  assert.match(body, /SLATEBOX_URL=/)
  // The fix it gives is one Docker can carry out: a new container, not a restart.
  assert.match(body, /docker rm -f/)
  assert.match(body, /<code>docker start<\/code> cannot add a setting/)
  // The relay path is guarded the same way.
  assert.equal((await get(`http://localhost:${port}/live/`)).status, 421)
  // The same volume, started with its address, serves the app.
  await remove(lost.id)
  const found = await start({ port, data: lost.data })
  await healthy(found.id)
  assert.equal((await get(`http://localhost:${port}/`)).status, 200)
  await remove(found.id)
  await removeVolume(found.data)
})

test('a mistaken setting stops the start with a plain message', async () => {
  const cases = [
    [{ SLATEBOX_URI: 'http://localhost:7070' }, /Unknown setting SLATEBOX_URI\. The settings are: SLATEBOX_URL/],
    [{ SLATEBOX_URL: 'boards.example.com' }, /SLATEBOX_URL is not a valid address/],
    [{ SLATEBOX_URL: 'https://boards.example.com/slatebox' }, /with nothing after the host/],
    [{ SLATEBOX_URL: 'https://localhost' }, /Built-in HTTPS needs a public host name/],
    [{ SLATEBOX_MAIL_URL: 'mail.example.com' }, /SLATEBOX_MAIL_URL is not a valid address/],
    [{ SLATEBOX_AI_URL: 'http://inference.internal:8080/v1' }, /SLATEBOX_AI_URL also needs SLATEBOX_AI_MODEL/],
    [{ SLATEBOX_SETTINGS: '{not json' }, /SLATEBOX_SETTINGS must be a JSON object/],
    // A name in the wrong case is reported, not silently ignored.
    [{ slatebox_url: 'http://localhost:9' }, /Unknown setting slatebox_url\. The settings are: SLATEBOX_URL.*\(in capitals\)/],
    [{ mongo_url: 'mongodb://db.example.com/x' }, /Unknown setting mongo_url\./],
    // Mail needs a sender the operator's mail service accepts.
    [{ SLATEBOX_MAIL_URL: 'smtp://apikey:x@mail.example.com:587' }, /SLATEBOX_MAIL_URL also needs SLATEBOX_MAIL_FROM/],
    [{ SLATEBOX_MAIL_URL: 'smtp://mail.example.com', SLATEBOX_MAIL_FROM: 'boards' }, /SLATEBOX_MAIL_FROM must be an address/],
    [{ SLATEBOX_MAIL_FROM: 'boards@example.com' }, /SLATEBOX_MAIL_FROM only applies together with SLATEBOX_MAIL_URL/],
  ]
  await Promise.all(cases.map(async ([env, message]) => {
    const mistaken = await start({ env: { SLATEBOX_URL: undefined, ...env } })
    await exited(mistaken.id)
    assert.equal(await inspect(mistaken.id, '{{.State.ExitCode}}'), '1')
    const log = await logs(mistaken.id)
    assert.match(log, message)
    assert.doesNotMatch(log, /\n\s+at .*:\d+:\d+\)?/, 'no stack trace for an operator mistake')
    assert.equal(await ok(['run', '--rm', '--network', 'none', '-v', `${mistaken.data}:/data`, '--entrypoint', 'sh', IMAGE, '-c', 'ls /data/secrets 2>/dev/null | wc -l']), '0',
      'nothing was created before the mistake was reported')
    await remove(mistaken.id)
    await removeVolume(mistaken.data)
  }))
})

test('a malformed address never shows the password it carries', async () => {
  // The password is made up for this test; it must not reach the log.
  const password = `pw${Date.now()}x`
  const cases = [
    [{ SLATEBOX_MAIL_URL: `smtp://mailer:${password}@mail.example.com:notaport` }, /SLATEBOX_MAIL_URL is not a valid address: smtp:\/\/\*\*\*@mail\.example\.com:notaport/],
    [{ MONGO_URL: `mongodb://app:${password}@db.example.com:99999/x` }, /MONGO_URL is not a valid address: mongodb:\/\/\*\*\*@db\.example\.com:99999\/x/],
    [{ SLATEBOX_URL: `https://admin:${password}@boards.example.com` }, /nothing after the host.*received https:\/\/\*\*\*@boards\.example\.com/],
  ]
  await Promise.all(cases.map(async ([env, message]) => {
    const mistaken = await start({ env: { SLATEBOX_URL: undefined, ...env } })
    await exited(mistaken.id)
    assert.equal(await inspect(mistaken.id, '{{.State.ExitCode}}'), '1')
    const log = await logs(mistaken.id)
    assert.match(log, message)
    assert.ok(!log.includes(password), `the password in ${Object.keys(env)[0]} is not in the log`)
    await remove(mistaken.id)
    await removeVolume(mistaken.data)
  }))
})

test('a database without its secrets is refused instead of being re-initialised', async () => {
  const orphan = await start()
  await healthy(orphan.id)
  await ok(['stop', orphan.id])
  await ok(['run', '--rm', '--network', 'none', '-v', `${orphan.data}:/data`, '--entrypoint', 'rm', IMAGE, '-rf', '/data/secrets'])
  await ok(['start', orphan.id])
  await exited(orphan.id)
  assert.equal(await inspect(orphan.id, '{{.State.ExitCode}}'), '1')
  assert.match(await logs(orphan.id), /holds a database but \/data\/secrets\/secrets\.json is missing/)
  await remove(orphan.id)
  await removeVolume(orphan.data)
})

test('a data volume the container cannot write to is reported plainly', async () => {
  const data = await volume()
  await ok(['run', '--rm', '--network', 'none', '--user', '0', '-v', `${data}:/data`, '--entrypoint', 'sh', IMAGE, '-c', 'touch /data/kept && chown 0:0 /data && chmod 755 /data'])
  const locked = await start({ data })
  await exited(locked.id)
  assert.equal(await inspect(locked.id, '{{.State.ExitCode}}'), '1')
  const log = await logs(locked.id)
  assert.match(log, /\/data is not writable by this container's user \(10001:10001\)\. It belongs to 0:0\./)
  assert.match(log, /add --user 0:0 to docker run/)
  await remove(locked.id)
  await removeVolume(data)
})

test('a host folder owned by a person runs with --user set to its owner', async () => {
  // As on a Linux host: a folder made by uid 1000 and mounted at /data.
  const data = await volume()
  await ok(['run', '--rm', '--network', 'none', '--user', '0', '-v', `${data}:/data`, '--entrypoint', 'sh', IMAGE, '-c', 'touch /data/.owner && chown -R 1000:1000 /data && chmod 755 /data'])
  const plain = await start({ data })
  await exited(plain.id)
  assert.match(await logs(plain.id), /It belongs to 1000:1000\.[\s\S]*add --user 1000:1000 to docker run/)
  await remove(plain.id)
  const owned = await start({ data, args: ['--user', '1000:1000'] })
  await healthy(owned.id)
  const processes = (await ok(['exec', owned.id, 'ps', '-eo', 'uid=,comm='])).split('\n').map(line => line.trim().split(/\s+/))
  for (const [uid, command] of processes) assert.equal(uid, '1000', `${command} runs as the folder's owner`)
  const owners = (await ok(['exec', owned.id, 'sh', '-c', 'find /data -mindepth 1 -maxdepth 2 ! -user 1000 | head -5'])).trim()
  assert.equal(owners, '', 'everything Slatebox wrote belongs to the folder\'s owner')
  assert.equal(await ok(['exec', owned.id, 'stat', '-c', '%a', '/data/secrets/secrets.json']), '600')
  // A slate can be opened, and the data survives a restart as that user.
  await ok(['restart', owned.id])
  await healthy(owned.id)
  await remove(owned.id)
  await removeVolume(data)
})
