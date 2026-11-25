// The team-address tunnel in a running container. cloudflared is replaced by a stand-in (mounted
// over /opt/slatebox/bin/cloudflared) so nothing reaches Cloudflare: one that stays connected,
// with a ready endpoint like cloudflared's, and one that Cloudflare "refuses" (it exits at once).
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { cleanup, docker, healthy, IMAGE, logs, ok, start, waitFor } from './lib.mjs'

after(cleanup)

const SECRET = randomBytes(32).toString('base64')
const TOKEN = Buffer.from(JSON.stringify({ a: 'a'.repeat(32), t: '7d3c1b2a-0000-4000-8000-000000000001', s: SECRET })).toString('base64')
const env = { SLATEBOX_URL: 'https://e2e-test.slatebox.team', SLATEBOX_TUNNEL_TOKEN: TOKEN, SLATEBOX_HTTPS: 'off' }

function standIn(script) {
  const dir = mkdtempSync(join(tmpdir(), 'sbx-cfd-'))
  const file = join(dir, 'cloudflared')
  writeFileSync(file, `#!/usr/bin/env bash\n${script}\n`)
  chmodSync(dir, 0o755)
  chmodSync(file, 0o755)
  return file
}

// Answers /ready on the metrics address the way cloudflared does, and records its arguments.
const CONNECTED = standIn(`printf '%s\\n' "$*" > /run/slatebox/cloudflared.args
exec node -e "require('http').createServer((q,s)=>{s.writeHead(200,{'content-type':'application/json'});s.end(JSON.stringify({status:200,readyConnections:4}))}).listen(7085,'127.0.0.1')"`)
const REFUSED = standIn('echo "ERR Unauthorized: Invalid tunnel secret" >&2; exit 1')

test('with a token: cloudflared runs with the token file, connections are reported, and no other process or log line has the token', async () => {
  const box = await start({ env, args: ['-v', `${CONNECTED}:/opt/slatebox/bin/cloudflared:ro`] })
  await healthy(box.id)
  const args = await ok(['exec', box.id, 'cat', '/run/slatebox/cloudflared.args'])
  assert.match(args, /tunnel --no-autoupdate --loglevel info --metrics 127\.0\.0\.1:7085 --protocol auto run --token-file \/run\/slatebox\/tunnel\.token/)
  const tunnel = JSON.parse(await ok(['exec', box.id, '/opt/slatebox/bin/slatebox', 'tunnel', '--json']))
  assert.deepEqual({ ...tunnel, since: undefined }, { configured: true, ready: true, connections: 4, state: 'connected', since: undefined })
  // Every service runs without the token in its environment. Left out: tini and the init, which
  // Docker started with it, and this check's own processes (docker exec gives them Docker's env).
  const environ = await ok(['exec', '--user', '0', box.id, 'sh', '-c', `for p in /proc/[0-9]*; do n=$(cat $p/comm 2>/dev/null); case "$n" in tini|slatebox-init|sh|cat|tr|grep) continue;; esac; tr '\\0' '\\n' < $p/environ 2>/dev/null | grep -q '^SLATEBOX_TUNNEL_TOKEN=' && echo "$n"; done; true`])
  assert.equal(environ.trim(), '', `processes with the token in their environment: ${environ}`)
  const log = await logs(box.id)
  assert.ok(!log.includes(TOKEN) && !log.includes(SECRET), 'the token is not in the log')
  assert.match(log, /Tunnel: +on, Cloudflare Tunnel 7d3c1b2a-0000-4000-8000-000000000001/)
})

test('a refused tunnel: three exits, then Slatebox keeps serving without it and health says degraded, not unhealthy', async () => {
  const box = await start({ env, args: ['-v', `${REFUSED}:/opt/slatebox/bin/cloudflared:ro`] })
  await waitFor(async () => (await logs(box.id)).includes('The team address connection was refused'), { timeout: 600, what: 'the tunnel to be given up' })
  await healthy(box.id)
  const health = await docker(['exec', box.id, '/opt/slatebox/bin/slatebox', 'health', '--json'])
  assert.equal(health.code, 0, health.stderr)
  assert.match(health.stderr, /degraded/)
  assert.equal(JSON.parse(health.stdout).tunnel.state, 'failed')
  assert.equal((await docker(['inspect', '--format', '{{.RestartCount}} {{.State.Running}}', box.id])).stdout.trim(), '0 true')
  const response = await fetch(`http://localhost:${box.port}/readyz`, { headers: { host: 'e2e-test.slatebox.team' } }).catch(() => null)
  assert.ok(response === null || response.status < 500, 'the app still answers')
})

test('no token: no tunnel process at all, as before', async () => {
  const box = await start({})
  await healthy(box.id)
  const processes = await ok(['exec', box.id, 'sh', '-c', 'cat /proc/[0-9]*/comm 2>/dev/null | sort -u'])
  assert.doesNotMatch(processes, /cloudflared/)
  assert.equal(JSON.parse(await ok(['exec', box.id, '/opt/slatebox/bin/slatebox', 'health', '--json'])).tunnel.configured, false)
  const version = await ok(['run', '--rm', '--network', 'none', '--entrypoint', '/opt/slatebox/bin/cloudflared', IMAGE, '--version'])
  assert.match(version, /cloudflared version \d{4}\.\d+\.\d+ /)
})
