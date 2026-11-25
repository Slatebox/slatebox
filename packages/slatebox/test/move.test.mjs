// slatebox migrate / import / export (src/move.mjs) against two fake Slatebox servers: the
// archive downloaded from one is the archive uploaded to the other, encrypted with a passphrase
// made here; each token goes only to its own server and is never printed; nothing is confirmed
// without a yes; invitations only when asked; the archive is removed once the move is live.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cli, sandbox } from './fakes.mjs'

const OWN = 'https://boards.acme.test'
const CLOUD = 'http://127.0.0.1:3999'
const OWN_TOKEN = 'sbx_own_token_0123456789abcdef'
const CLOUD_TOKEN = 'sbx_cloud_token_0123456789abcdef'
const DEVICE_TOKEN = 'sbo_device_move_token_0123456789'
const ARCHIVE = Buffer.from('fake archive bytes '.repeat(2000))
const REPORT = {
  team: { name: 'Acme' },
  sections: { slates: { created: 2 }, presentations: { created: 1 }, comments: { created: 1 } },
  files: { created: 3 },
  people: [{ name: 'Alice A', email: 'alice@acme.test', owner: true }, { name: 'Bob B', email: 'bob@acme.test' }],
  library: [{ title: 'Launch board', kind: 'component', was: 'published' }],
  ai: { imported: [{ name: 'ours', provider: 'openai-compatible', needsKey: true }] },
  tokens: [{ person: 'Alice A', name: 'CI bot', scopes: ['slates:read'] }],
  skipped: [],
}

// One fake server: the team export and move actions, and the two one-time addresses.
function fakeServer(origin, token, { into = 'new_team', refuse = {}, pending = null, deviceScope = null } = {}) {
  const state = { requests: [], uploaded: null, uploadPassphrase: null, downloadPassphrase: null, confirmed: null, discarded: [], moves: pending ? [pending] : [], deviceScope: null }
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  state.handle = async (url, init = {}) => {
    const u = new URL(url)
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([key, value]) => [key.toLowerCase(), value]))
    const route = `${init.method || 'GET'} ${u.pathname}`
    state.requests.push({ route, headers })
    if (route === 'POST /oauth/device_authorization') {
      state.deviceScope = new URLSearchParams(init.body).get('scope')
      if (deviceScope === 'refuse') return json(400, { error: 'invalid_scope', error_description: 'This client may ask for team-addresses only.' })
      return json(200, { device_code: 'device-code-0123456789abcdef', user_code: 'WDJB-MJHT', verification_uri: `${origin}/device`, expires_in: 600, interval: 1 })
    }
    if (route === 'POST /oauth/token') return json(200, { access_token: DEVICE_TOKEN, token_type: 'Bearer', expires_in: 900 })
    if (u.pathname.startsWith('/api/v1/')) {
      const bearer = headers.authorization?.replace(/^Bearer /, '')
      if (bearer !== token && bearer !== DEVICE_TOKEN) return json(401, { error: { code: 'unauthorized', message: 'A valid Slatebox API token is required.' } })
      if (refuse[route]) return json(403, { error: { code: refuse[route], message: 'Refused.' } })
      if (route === 'POST /api/v1/team/export') return json(200, { downloadUrl: `https://internal.example/team-transfer/export/${'e'.repeat(43)}`, method: 'POST', expiresAt: 'x', team: { name: 'Acme' }, members: 2, slates: 2 })
      if (route === 'POST /api/v1/team/moves') {
        if (state.moves.some((move) => move.state === 'pending')) return json(409, { error: { code: 'move_pending', message: 'You have a move waiting.' } })
        return json(200, { uploadUrl: `${origin}/team-transfer/move/${'m'.repeat(43)}`, method: 'POST', expiresAt: 'x', maxBytes: 2 ** 31, into })
      }
      if (route === 'GET /api/v1/team/moves') return json(200, { moves: state.moves })
      const confirm = /^POST \/api\/v1\/team\/moves\/([^/]+)\/confirm$/.exec(route)
      if (confirm) {
        state.confirmed = { importId: confirm[1], invite: JSON.parse(init.body).invite }
        return json(200, { importId: confirm[1], state: 'confirmed', teamId: 'T1', merged: into === 'your_team', seats: { mover: 'Alice A', matched: [] }, invited: { sent: state.confirmed.invite ? 1 : 0, needsConsent: [], mailDisabled: 0, unverified: [] } })
      }
      const discard = /^POST \/api\/v1\/team\/moves\/([^/]+)\/discard$/.exec(route)
      if (discard) {
        state.discarded.push(discard[1])
        state.moves = state.moves.filter((move) => move.importId !== discard[1])
        return json(200, { importId: discard[1], state: 'discarded' })
      }
    }
    if (route === `POST /team-transfer/export/${'e'.repeat(43)}`) {
      state.downloadPassphrase = headers['slatebox-export-passphrase']
      return new Response(ARCHIVE, { status: 200, headers: { 'content-type': 'application/octet-stream' } })
    }
    if (route === `POST /team-transfer/move/${'m'.repeat(43)}`) {
      state.uploaded = Buffer.from(await new Response(init.body).arrayBuffer())
      state.uploadPassphrase = Buffer.from(headers['slatebox-export-passphrase-base64'], 'base64url').toString('utf8')
      return json(201, { importId: 'MOVE1', state: 'pending', report: REPORT })
    }
    return json(404, { error: { code: 'unknown_route', message: route } })
  }
  return state
}

function world(options = {}) {
  const own = fakeServer(OWN, OWN_TOKEN, options.own)
  const cloud = fakeServer(CLOUD, CLOUD_TOKEN, options.cloud)
  const fetch = async (url, init) => {
    const { origin } = new URL(url)
    if (origin === OWN || origin === 'https://internal.example') return own.handle(url.replace('https://internal.example', OWN), init)
    if (origin === CLOUD) return cloud.handle(url, init)
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
  }
  return { own, cloud, fetch, home: sandbox() }
}

const run = (w, argv, { env = {}, ...rest } = {}) =>
  cli(argv, { home: w.home, fetch: w.fetch, env: { SLATEBOX_CLOUD_URL: CLOUD, ...env }, io: { sleep: async () => {}, deviceLabel: 'test-box', openBrowser: () => {} }, ...rest })

test('migrate --to cloud: the archive downloaded from your server is the one Cloud gets, encrypted, confirmed, and removed afterwards', async () => {
  const w = world()
  const result = await run(w, ['migrate', '--to', 'cloud', '--from', OWN, '--yes', '--json'], { env: { SLATEBOX_API_TOKEN: OWN_TOKEN, SLATEBOX_CLOUD_TOKEN: CLOUD_TOKEN } })
  assert.equal(result.code, 0, result.stderr)
  assert.ok(w.cloud.uploaded.equals(ARCHIVE), 'the same bytes arrive')
  assert.ok(w.own.downloadPassphrase && w.own.downloadPassphrase.length >= 24, 'encrypted with a passphrase made here')
  assert.equal(w.cloud.uploadPassphrase, w.own.downloadPassphrase)
  assert.deepEqual(w.cloud.confirmed, { importId: 'MOVE1', invite: false }, 'nobody is invited unless asked')
  // Each token went only to its own server, and the one-time addresses got no token at all.
  for (const request of w.own.requests) if (request.headers.authorization) assert.equal(request.headers.authorization, `Bearer ${OWN_TOKEN}`)
  for (const request of w.cloud.requests) if (request.headers.authorization) assert.equal(request.headers.authorization, `Bearer ${CLOUD_TOKEN}`)
  for (const request of [...w.own.requests, ...w.cloud.requests].filter((r) => r.route.includes('/team-transfer/'))) assert.equal(request.headers.authorization, undefined)
  // The download address the server named by another host was fetched from the server's own origin.
  assert.ok(w.own.requests.some((r) => r.route.startsWith('POST /team-transfer/export/')))
  // Never printed: the tokens, the passphrase.
  for (const secret of [OWN_TOKEN, CLOUD_TOKEN, w.own.downloadPassphrase]) assert.equal((result.stdout + result.stderr).includes(secret), false)
  const done = result.events.find((event) => event.event === 'done')
  assert.deepEqual([done.moved, done.importId, done.from, done.to], [true, 'MOVE1', OWN, CLOUD])
  assert.ok(result.events.some((event) => event.event === 'move' && event.report.team.name === 'Acme'))
  assert.deepEqual(readdirSync(join(w.home, 'moves')), [], 'the archive and its key are gone once the move is live')
})

test('migrate --to cloud without --yes and nobody to ask stops before anything is downloaded', async () => {
  const w = world()
  const result = await run(w, ['migrate', '--to', 'cloud', '--from', OWN, '--json'], { env: { SLATEBOX_API_TOKEN: OWN_TOKEN, SLATEBOX_CLOUD_TOKEN: CLOUD_TOKEN } })
  assert.equal(result.code, 3)
  assert.ok(result.events.some((event) => event.event === 'plan' && event.team === 'Acme' && event.into === 'new_team'))
  assert.equal(w.own.downloadPassphrase, null)
  assert.equal(w.cloud.uploaded, null)
})

test('at a terminal: the plan, then the yes, then the choice to invite', async () => {
  const w = world({ cloud: { into: 'your_team' } })
  const result = await run(w, ['migrate', '--to', 'cloud', '--from', OWN], { tty: true, input: 'y\ny\ny\n', env: { SLATEBOX_API_TOKEN: OWN_TOKEN, SLATEBOX_CLOUD_TOKEN: CLOUD_TOKEN } })
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /into the team you own there/)
  assert.match(result.stdout, /Library: +1 item \(arrive as drafts/)
  assert.match(result.stdout, /Agent keys: +add the keys again for ours/)
  assert.match(result.stderr, /Email an invitation to the other people/)
  assert.deepEqual(w.cloud.confirmed, { importId: 'MOVE1', invite: true })
  assert.match(result.stdout, /Invitations sent: 1/)
})

test('Cloud signs in with a code for team:export and team:move when no token is given', async () => {
  const w = world()
  const result = await run(w, ['import', '--from', 'cloud', '--to', OWN, '--yes', '--json'], { env: { SLATEBOX_API_TOKEN: OWN_TOKEN } })
  assert.equal(result.code, 0, result.stderr)
  assert.equal(w.cloud.deviceScope, 'team:export team:move')
  assert.ok(w.own.uploaded.equals(ARCHIVE))
  assert.match(result.stderr, /WDJB-MJHT/)
  assert.equal((result.stdout + result.stderr).includes(DEVICE_TOKEN), false)
})

test('a Cloud that cannot sign in for a move says how to use a token instead', async () => {
  const w = world({ cloud: { deviceScope: 'refuse' } })
  const result = await run(w, ['import', '--from', 'cloud', '--to', OWN, '--yes'], { env: { SLATEBOX_API_TOKEN: OWN_TOKEN } })
  assert.equal(result.code, 4)
  assert.match(result.stderr, /SLATEBOX_CLOUD_TOKEN/)
  assert.equal(w.own.uploaded, null)
})

test('your own server\'s token is needed: asked for at a terminal (hidden), refused with the reason in a script', async () => {
  const w = world()
  const script = await run(w, ['migrate', '--to', 'cloud', '--from', OWN, '--yes'], { env: { SLATEBOX_CLOUD_TOKEN: CLOUD_TOKEN } })
  assert.equal(script.code, 3)
  assert.match(script.stderr, /SLATEBOX_API_TOKEN/)
  const asked = await run(w, ['migrate', '--to', 'cloud', '--from', OWN, '--yes'], { tty: true, input: `${OWN_TOKEN}\n`, env: { SLATEBOX_CLOUD_TOKEN: CLOUD_TOKEN } })
  assert.equal(asked.code, 0, asked.stderr)
  assert.equal((asked.stdout + asked.stderr).includes(OWN_TOKEN), false)
})

test('a refusal comes before anything is downloaded, with what to do', async () => {
  const w = world({ cloud: { refuse: { 'POST /api/v1/team/moves': 'team_owner_required' } } })
  const result = await run(w, ['migrate', '--to', 'cloud', '--from', OWN, '--yes'], { env: { SLATEBOX_API_TOKEN: OWN_TOKEN, SLATEBOX_CLOUD_TOKEN: CLOUD_TOKEN } })
  assert.equal(result.code, 4)
  assert.match(result.stderr, /Only the owner of your team there can move a team into it/)
  assert.equal(w.own.downloadPassphrase, null)
})

test('a move already waiting is discarded only with --replace-waiting', async () => {
  const pending = { importId: 'OLD1', state: 'pending', teamName: 'Acme' }
  const w = world({ cloud: { pending } })
  const env = { SLATEBOX_API_TOKEN: OWN_TOKEN, SLATEBOX_CLOUD_TOKEN: CLOUD_TOKEN }
  const refused = await run(w, ['migrate', '--to', 'cloud', '--from', OWN, '--yes'], { env })
  assert.equal(refused.code, 4)
  assert.match(refused.stderr, /--replace-waiting/)
  assert.deepEqual(w.cloud.discarded, [])
  const replaced = await run(w, ['migrate', '--to', 'cloud', '--from', OWN, '--yes', '--replace-waiting'], { env })
  assert.equal(replaced.code, 0, replaced.stderr)
  assert.deepEqual(w.cloud.discarded, ['OLD1'])
})

test('export then import: a file in between, its passphrase from the environment', async () => {
  const w = world()
  const out = join(w.home, 'acme.sbxteam')
  const exported = await run(w, ['export', '--from', OWN, '--out', out, '--passphrase', 'env:MOVE_PASSPHRASE'], { env: { SLATEBOX_API_TOKEN: OWN_TOKEN, MOVE_PASSPHRASE: 'correct horse battery staple' } })
  assert.equal(exported.code, 0, exported.stderr)
  assert.ok(existsSync(out))
  assert.equal(statSync(out).mode & 0o077, 0, 'readable by this user only')
  assert.equal(w.own.downloadPassphrase, 'correct horse battery staple')
  const imported = await run(w, ['import', out, '--to', 'cloud', '--passphrase', 'env:MOVE_PASSPHRASE', '--yes'], { env: { SLATEBOX_CLOUD_TOKEN: CLOUD_TOKEN, MOVE_PASSPHRASE: 'correct horse battery staple' } })
  assert.equal(imported.code, 0, imported.stderr)
  assert.ok(w.cloud.uploaded.equals(ARCHIVE))
  assert.equal(w.cloud.uploadPassphrase, 'correct horse battery staple')
  assert.equal((exported.stdout + exported.stderr + imported.stdout + imported.stderr).includes('correct horse battery staple'), false)
})

test('a failed upload keeps the archive and says how to finish', async () => {
  const w = world({ cloud: { refuse: {} } })
  const original = w.cloud.handle
  w.cloud.handle = async (url, init) => (new URL(url).pathname.startsWith('/team-transfer/move/') ? new Response(JSON.stringify({ error: { code: 'too_large', message: 'Too large.' } }), { status: 413 }) : original(url, init))
  const result = await run(w, ['migrate', '--to', 'cloud', '--from', OWN, '--yes'], { env: { SLATEBOX_API_TOKEN: OWN_TOKEN, SLATEBOX_CLOUD_TOKEN: CLOUD_TOKEN } })
  assert.equal(result.code, 4)
  const kept = readdirSync(join(w.home, 'moves'))
  assert.equal(kept.filter((name) => name.endsWith('.sbxteam')).length, 1)
  assert.equal(kept.filter((name) => name.endsWith('.key')).length, 1)
  assert.match(result.stderr, /slatebox import .*\.sbxteam --to cloud/)
})

test('migrate needs a direction, and an http address that is not this computer is refused', async () => {
  const w = world()
  assert.equal((await run(w, ['migrate'])).code, 2)
  const plain = await run(w, ['migrate', '--to', 'cloud', '--from', 'http://boards.acme.test'], { env: { SLATEBOX_API_TOKEN: OWN_TOKEN } })
  assert.equal(plain.code, 2)
  assert.match(plain.stderr, /https/)
  writeFileSync(join(w.home, 'x'), '')
  assert.equal((await run(w, ['import'])).code, 2)
})
