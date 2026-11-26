// The enterprise/ carve-out: outside agent connections (integrations) live in enterprise/ under
// enterprise/LICENSE (source-available, not MIT). Integrations are free everywhere (owner decision
// 2026-11-26): they run on Slatebox Cloud by Cloud's own key, and on every self-hosted install with
// no key at all; a build without the code still runs, without them.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { generateKeyPairSync } from 'node:crypto'
import { agentInviteKilled, agentInviteOn, editionOf, enterpriseState, isCloudEdition } from '../web/app/imports/api/common/edition.mjs'
import { createEnterpriseHost, EnterpriseLocked, loadEnterprise } from '../web/app/server/enterprise-loader.mjs'
import { enterpriseAccess, signLicense } from '../web/app/server/enterprise-license.mjs'
import { createSlots, loadEnterpriseClient } from '../web/app/imports/api/client/enterprise-slots.mjs'
import { actions as baseActions, createAppRegistry } from '../web/app/server/actions/index.mjs'
import { defineAction } from '../web/app/server/actions/registry.mjs'
import { checkAbsent, checkPresent, copy, ENTERPRISE_MARKER, enterpriseFilesUnder, stub } from './enterprise-stage.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const selfHost = { public: { env: 'selfhost', edition: 'self-host' } }

// A test signing key (never Slatebox LLC's), and an on-prem key it signed (what Cloud's issuer still
// makes; no self-hosted install reads one any more).
const testKeyPair = generateKeyPairSync('ed25519')
const testKeys = { 'test-key': testKeyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }
const testLicense = await signLicense({ id: 'lic_test', licensee: 'Test Co', issuedAt: '2026-01-01', expiresAt: '2099-12-31' }, { kid: 'test-key', privateKey: testKeyPair.privateKey })
// Cloud proves itself with its own key (kind 'cloud', bound to Cloud's host), signed by the same test key.
const testCloudKey = await signLicense({ id: 'cloud_test', licensee: 'Slatebox Cloud', kind: 'cloud', hosts: ['app.slatebox.com'], issuedAt: '2026-01-01', expiresAt: '2099-12-31' }, { kid: 'test-key', privateKey: testKeyPair.privateKey })
const cloud = (extra = {}) => ({ public: { edition: 'cloud', baseUrl: 'https://app.slatebox.com', ...extra }, enterprise: { license: testCloudKey } })
// The loader's access check with the test key in place of Slatebox LLC's (the app's own uses only Slatebox LLC's).
const accessWith = (settings, keys = testKeys) => (now) => enterpriseAccess({ settings, env: {}, keys, now })
const cloudAccess = accessWith(cloud())

// A stand-in for the enterprise module that registers one of everything.
function fakeEnterprise() {
  const calls = { loaded: 0, context: null }
  const action = defineAction({
    id: 'connectors.probe',
    title: 'Probe a connector',
    description: 'Test action from a fake enterprise module.',
    toolset: 'connectors',
    kind: 'read',
    input: { type: 'object', properties: {}, additionalProperties: false },
    output: { type: 'object' },
    handler: async () => ({}),
  })
  const mod = {
    manifest: { name: 'fake-enterprise' },
    register(api, context) {
      calls.context = context
      api.addActions([action])
      api.addMethods({ 'connectors.ping': () => 'pong' })
      api.addRoute({ method: 'GET', path: '/connectors/oauth/callback', handler: () => {} })
      api.onStartup(() => {})
    },
  }
  return { calls, load: () => (calls.loaded++, mod), action }
}

test('the edition is self-host unless settings say cloud', () => {
  assert.equal(editionOf(undefined), 'self-host')
  assert.equal(editionOf({}), 'self-host')
  assert.equal(editionOf({ public: {} }), 'self-host')
  assert.equal(editionOf({ public: { edition: 'Cloud' } }), 'self-host')
  assert.equal(editionOf({ public: { edition: 'enterprise' } }), 'self-host')
  assert.equal(editionOf(selfHost), 'self-host')
  assert.equal(editionOf(cloud()), 'cloud')
  assert.equal(isCloudEdition(cloud()), true)
  assert.equal(isCloudEdition(selfHost), false)
})

test('invited agents are on wherever enterprise code runs; no public switch hides them', () => {
  // What the server tells browsers (server/enterprise.js): the only source the browser reads.
  assert.deepEqual(enterpriseState({ public: { enterprise: { unlocked: true, via: 'cloud', features: ['agents.invite'] } } }), { unlocked: true, via: 'cloud', features: ['agents.invite'] })
  assert.equal(agentInviteOn({ public: { enterprise: { unlocked: true, via: 'self-host', features: ['agents.invite'] } } }), true)
  assert.equal(enterpriseState({ public: { enterprise: { unlocked: true, via: 'license', features: [] } } }).via, null, 'no such edition any more')
  assert.equal(agentInviteOn({ public: { enterprise: { unlocked: false, features: ['agents.invite'] } } }), false)
  assert.equal(agentInviteOn(cloud()), false, 'nothing is on until the server says so')
  // The old public feature switch does nothing now, either way.
  assert.equal(agentInviteOn(cloud({ agents: { invite: true } })), false)
  // The kill switch is server-side and on unless set to exactly true.
  assert.equal(agentInviteKilled({}), false)
  assert.equal(agentInviteKilled({ connectors: { off: 'yes' } }), false)
  assert.equal(agentInviteKilled({ connectors: { off: true } }), true)
  const fake = fakeEnterprise()
  const result = loadEnterprise({ settings: cloud(), access: cloudAccess, load: fake.load, host: createEnterpriseHost() })
  assert.deepEqual(result.features, ['agents.invite'])
  assert.equal(fake.calls.context.agentInvite, true)
  const killed = fakeEnterprise()
  assert.deepEqual(loadEnterprise({ settings: { ...cloud(), connectors: { off: true } }, access: cloudAccess, load: killed.load, host: createEnterpriseHost() }).features, [])
  assert.equal(killed.calls.context.agentInvite, false)
})

test('every self-hosted install loads the enterprise module with no key (free, owner 2026-11-26), and nothing ends it', async () => {
  const otherKey = generateKeyPairSync('ed25519')
  const foreign = { 'test-key': otherKey.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }
  // No key, an old on-prem key, a garbled or foreign key, or a Cloud key: a self-hosted install runs it all the same, as self-host.
  const withKey = (license) => ({ ...selfHost, enterprise: { license } })
  const cases = [selfHost, {}, { public: { agents: { invite: true } } }, withKey(testLicense), withKey('not a license'), withKey(testCloudKey), { ...selfHost, public: { ...selfHost.public, baseUrl: 'https://app.slatebox.com' }, enterprise: { license: testCloudKey } }]
  for (const settings of cases) {
    for (const access of [accessWith(settings), accessWith(settings, foreign), undefined]) {
      const fake = fakeEnterprise()
      const host = createEnterpriseHost()
      const result = loadEnterprise({ settings, load: fake.load, host, ...(access && { access }) })
      assert.equal(result.loaded, true)
      assert.equal(result.edition, 'self-host')
      assert.equal(result.access.via, 'self-host', 'never Cloud: a Cloud key on a self-hosted install does not make it Cloud')
      assert.equal(result.access.reason, 'self_host')
      assert.deepEqual(result.features, ['agents.invite'])
      assert.equal(fake.calls.context.via, 'self-host')
      assert.equal(fake.calls.context.edition, 'self-host')
      const registry = createAppRegistry({ extraActions: host.actions })
      assert.equal(registry.list().length, baseActions.length + 1)
      assert.equal(host.methods['connectors.ping'](), 'pong')
    }
  }
  // Years later, and with the loader's hourly re-check passed, every entry point still answers: there is no key to end.
  const fake = fakeEnterprise()
  const host = createEnterpriseHost()
  loadEnterprise({ settings: selfHost, load: fake.load, host })
  const realNow = Date.now
  Date.now = () => realNow() + 5 * 365 * 86_400_000
  try {
    assert.equal(fake.calls.context.isUnlocked(), true)
    assert.deepEqual(await host.actions[0].handler({}, {}, {}), {})
    assert.equal(host.methods['connectors.ping'](), 'pong')
    const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } }
    let reached = false
    const routes = createEnterpriseHost()
    loadEnterprise({ settings: selfHost, load: () => ({ register: (api) => api.addRoute({ method: 'GET', path: '/x', handler: () => { reached = true } }) }), host: routes })
    routes.routes[0].handler({}, res, () => {})
    assert.equal(reached, true)
    assert.equal(res.statusCode, 0, 'never refused')
  } finally {
    Date.now = realNow
  }
})

test('Cloud loads the enterprise module once and its actions join the one registry', () => {
  const fake = fakeEnterprise()
  const host = createEnterpriseHost()
  const result = loadEnterprise({ settings: cloud(), access: cloudAccess, load: fake.load, host })
  assert.equal(result.loaded, true)
  assert.equal(result.edition, 'cloud')
  assert.equal(result.name, 'fake-enterprise')
  assert.equal(result.access.via, 'cloud')
  assert.equal(fake.calls.loaded, 1)
  assert.equal(fake.calls.context.edition, 'cloud')
  assert.equal(fake.calls.context.agentInvite, true)
  assert.deepEqual(Object.keys(host.methods), ['connectors.ping'])
  assert.deepEqual(host.routes.map((r) => `${r.method} ${r.path}`), ['GET /connectors/oauth/callback'])
  const registry = createAppRegistry({ extraActions: host.actions })
  assert.equal(registry.list().length, baseActions.length + 1)
  // The same action, its handler wrapped in the key check (Cloud's key is checked on each call too).
  const joined = registry.get('connectors.probe')
  assert.deepEqual({ ...joined, handler: null }, { ...fake.action, handler: null })
  assert.notEqual(joined.handler, fake.action.handler)
})

test('saying Cloud in settings is not Cloud: Cloud needs its own signed key, and no other key will do', async () => {
  const onPremOnCloud = { public: { edition: 'cloud', baseUrl: 'https://app.slatebox.com' }, enterprise: { license: testLicense } }
  const cloudKeyElsewhere = cloud({ baseUrl: 'https://slatebox.example.com' })
  const unbound = await signLicense({ id: 'cloud_x', licensee: 'Me', kind: 'cloud', issuedAt: '2026-01-01', expiresAt: '2099-12-31' }, { kid: 'test-key', privateKey: testKeyPair.privateKey })
  const cases = [
    [{ public: { edition: 'cloud' } }, 'cloud_no_key'],
    [{ public: { edition: 'cloud', baseUrl: 'https://app.slatebox.com' }, pro: { status: 'active' } }, 'cloud_no_key'],
    [onPremOnCloud, 'wrong_kind'],
    [cloudKeyElsewhere, 'wrong_host'],
    // a Cloud key that names no host is refused, so no Cloud key works on any install
    [{ ...cloud(), enterprise: { license: unbound } }, 'wrong_kind'],
  ]
  for (const [settings, reason] of cases) {
    const fake = fakeEnterprise()
    const host = createEnterpriseHost()
    const result = loadEnterprise({ settings, load: fake.load, host, access: accessWith(settings) })
    assert.equal(result.loaded, false, reason)
    assert.equal(result.access.reason, reason)
    assert.equal(fake.calls.loaded, 0)
    assert.ok(host.isEmpty())
  }
  // The app's own check (Slatebox LLC's keys only): a settings file that says cloud stays locked.
  const fake = fakeEnterprise()
  const own = loadEnterprise({ settings: { public: { edition: 'cloud', baseUrl: 'https://app.slatebox.com' } }, load: fake.load, host: createEnterpriseHost() })
  assert.equal(own.loaded, false)
  assert.equal(own.access.reason, 'cloud_no_key')
  assert.equal(loadEnterprise({ settings: cloud(), load: fake.load, host: createEnterpriseHost() }).access.reason, 'unknown_key', 'a test Cloud key is not Slatebox LLC\'s')
  assert.equal(fake.calls.loaded, 0)
})

test('Cloud\'s key is checked again on every call too, and context.isUnlocked says so for what the api does not carry', async () => {
  const fake = fakeEnterprise()
  const host = createEnterpriseHost()
  let valid = true
  const good = cloudAccess()
  const access = () => (valid ? good : { ...good, unlocked: false, via: null, reason: 'expired' })
  assert.equal(loadEnterprise({ settings: cloud(), load: fake.load, host, access }).loaded, true)
  assert.equal(fake.calls.context.via, 'cloud')
  assert.equal(fake.calls.context.isUnlocked(), true)
  valid = false
  const realNow = Date.now
  Date.now = () => realNow() + 2 * 3_600_000
  try {
    assert.equal(fake.calls.context.isUnlocked(), false)
    await assert.rejects(async () => host.actions[0].handler({}, {}, {}), (error) => error instanceof EnterpriseLocked)
    assert.throws(() => host.methods['connectors.ping'](), EnterpriseLocked)
  } finally {
    Date.now = realNow
  }
})

test('a browser told enterprise_locked empties every enterprise slot; other refusals leave them', () => {
  const slots = createSlots()
  const component = () => null
  slots.api.fill('canvas.agents', component)
  let told = 0
  slots.subscribe(() => told++)
  assert.equal(slots.lockIfRefused({ error: 'forbidden' }), false)
  assert.equal(slots.lockIfRefused(null), false)
  assert.equal(slots.get('canvas.agents'), component)
  assert.equal(slots.lockIfRefused({ error: 'enterprise_locked', reason: 'The Slatebox Cloud key has ended.' }), true)
  assert.equal(slots.get('canvas.agents'), null)
  assert.deepEqual(slots.names(), [])
  assert.equal(told, 1)
})

test('a build with no enterprise code (or a stub) registers nothing, and a self-hosted one still starts', () => {
  const missing = () => {
    const error = new Error("Cannot find module '/enterprise/server'")
    error.code = 'MODULE_NOT_FOUND'
    throw error
  }
  const logs = []
  const host = createEnterpriseHost()
  assert.equal(loadEnterprise({ settings: cloud(), access: cloudAccess, load: missing, host, log: (t) => logs.push(t) }).reason, 'missing')
  assert.equal(loadEnterprise({ settings: cloud(), access: cloudAccess, load: () => ({ selfHostStub: true }), host, log: (t) => logs.push(t) }).reason, 'stub')
  assert.ok(host.isEmpty())
  assert.equal(logs.length, 2)
  // A self-hosted install whose image carries no enterprise code: it starts, without integrations.
  const selfHostHost = createEnterpriseHost()
  const bare = loadEnterprise({ settings: selfHost, load: missing, host: selfHostHost, log: (t) => logs.push(t) })
  assert.deepEqual([bare.loaded, bare.reason, bare.edition], [false, 'missing', 'self-host'])
  assert.equal(loadEnterprise({ settings: selfHost, load: () => ({ selfHostStub: true }), host: selfHostHost, log: (t) => logs.push(t) }).reason, 'stub')
  assert.ok(selfHostHost.isEmpty())
  assert.ok(logs.every((line) => /integrations are off/.test(line)), 'the log says what it means')
  // any other failure inside the enterprise module fails the boot
  assert.throws(() => loadEnterprise({ settings: cloud(), access: cloudAccess, load: () => { throw new TypeError('boom') }, host }), /boom/)
})

test('the host refuses malformed registrations', () => {
  const { api } = createEnterpriseHost()
  assert.throws(() => api.addRoute({ method: 'GET', path: 'no-slash', handler() {} }), /start with/)
  assert.throws(() => api.addRoute({ method: 'TRACE', path: '/x', handler() {} }), /not supported/)
  api.addMethods({ 'a.b': () => {} })
  assert.throws(() => api.addMethods({ 'a.b': () => {} }), /twice/)
  assert.throws(() => api.addActions({}), /list/)
})

test('the real enterprise module registers on Cloud through the host api only', async () => {
  const server = await import(pathToFileURL(join(root, 'enterprise/server/index.js')))
  const host = createEnterpriseHost()
  const result = loadEnterprise({ settings: cloud(), access: cloudAccess, load: () => server, host })
  assert.equal(result.loaded, true)
  assert.equal(result.name, 'slatebox-enterprise')
})

test('the browser loads the enterprise chunk only where the server says enterprise code runs', async () => {
  const told = (state) => ({ public: { edition: 'self-host', enterprise: state } })
  let requested = 0
  const component = () => null
  const load = async () => (requested++, { register: (api) => api.fill('agents.invite', component) })
  const selfHostSlots = createSlots()
  for (const settings of [selfHost, cloud(), told({ unlocked: false }), told(undefined)]) {
    assert.equal((await loadEnterpriseClient({ settings, load, slots: selfHostSlots })).loaded, false)
  }
  assert.equal(requested, 0)
  assert.deepEqual(selfHostSlots.names(), [])
  const cloudSlots = createSlots()
  assert.equal((await loadEnterpriseClient({ settings: { public: { edition: 'cloud', enterprise: { unlocked: true, via: 'cloud', features: ['agents.invite'] } } }, load, slots: cloudSlots })).loaded, true)
  assert.equal(requested, 1)
  assert.equal(cloudSlots.get('agents.invite'), component)
  const selfHostedSlots = createSlots()
  assert.equal((await loadEnterpriseClient({ settings: told({ unlocked: true, via: 'self-host', features: ['agents.invite'] }), load, slots: selfHostedSlots })).loaded, true)
  assert.equal(selfHostedSlots.get('agents.invite'), component)
  const failing = await loadEnterpriseClient({ settings: told({ unlocked: true, via: 'self-host', features: [] }), load: async () => { throw new Error('chunk missing') }, slots: createSlots() })
  assert.equal(failing.reason, 'missing')
})

test('MIT code reaches enterprise/ only through the two loaders', () => {
  const app = join(root, 'web/app')
  const allowed = new Set(['server/enterprise.js', 'client/enterprise.js'])
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      if (['node_modules', '.meteor', 'enterprise'].includes(name)) return []
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : [path]
    })
  for (const path of walk(app).filter((p) => /\.(m?js|jsx|tsx?)$/.test(p))) {
    const source = readFileSync(path, 'utf8')
    const rel = relative(app, path).split(sep).join('/')
    if (/(?:from\s+|import\(\s*|require\(\s*)['"](?:\/|(?:\.\.\/)+)enterprise(?:['"\/]|\.jsx?['"])/.test(source)) {
      assert.ok(allowed.has(rel), `${rel} imports enterprise code directly`)
    }
  }
})

test('every enterprise file carries the enterprise license marker', () => {
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
  for (const path of walk(join(root, 'enterprise'))) {
    const head = readFileSync(path, 'utf8').slice(0, 4096)
    assert.ok(head.includes(ENTERPRISE_MARKER) || head.startsWith('Slatebox Enterprise License'), relative(root, path))
  }
})

test('a self-host build context carries the enterprise code (it runs there, free); the checks catch a missing or stubbed copy', () => {
  const work = mkdtempSync(join(tmpdir(), 'slatebox-enterprise-'))
  try {
    // what self-host/build-images.sh stages: the committed web/ tree (git archive HEAD:web) and enterprise/
    const web = join(work, 'web')
    cpSync(join(root, 'web'), web, {
      recursive: true,
      filter: (source) => {
        const rel = relative(join(root, 'web'), source).split(sep)
        return !rel.includes('node_modules') && !rel.includes('.meteor') && rel.join('/') !== 'app/enterprise'
      },
    })
    assert.throws(() => checkPresent(web), /no enterprise code/)
    copy(join(web, 'app'))
    assert.doesNotThrow(() => checkPresent(web))
    assert.ok(enterpriseFilesUnder(web).some((p) => p.endsWith(join('enterprise', 'LICENSE'))))
    // a stub in its place is caught
    stub(join(web, 'app'))
    assert.throws(() => checkPresent(web), /no enterprise code/)
    // and the absence check still tells a stub from the real code (for builds that must have none)
    assert.doesNotThrow(() => checkAbsent(web))
    copy(join(web, 'app'))
    assert.throws(() => checkAbsent(web), /Enterprise code found/)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test('the build scripts put enterprise/ in every image', () => {
  const ignored = execFileSync('git', ['check-ignore', '--no-index', 'web/app/enterprise'], { cwd: root, encoding: 'utf8' })
  assert.match(ignored, /web\/app\/enterprise/)
  const tracked = execFileSync('git', ['ls-files', 'web/app/enterprise'], { cwd: root, encoding: 'utf8' })
  assert.equal(tracked.trim(), '')
  const selfHostBuild = read('self-host/build-images.sh')
  const copyAt = selfHostBuild.indexOf('archive "$app_sha:enterprise"')
  const checkAt = selfHostBuild.indexOf('enterprise-stage.mjs" check-present "$stage/app"')
  const dockerAt = selfHostBuild.indexOf('docker build')
  assert.ok(copyAt > 0 && checkAt > copyAt && dockerAt > checkAt, 'self-host copies the committed enterprise/ and checks it before building the image')
  assert.ok(!selfHostBuild.includes('enterprise-stage.mjs" stub'), 'no stub in a self-host image')
  // The one-container image carries it the same way: its context is staged by
  // self-host/stage-image.sh (copy, then check), which build-image.sh and the release workflow
  // (.github/workflows/selfhost-image.yml) both run before they build.
  const oneStage = read('self-host/stage-image.sh')
  const oneCopy = oneStage.indexOf('archive "$app_sha:enterprise"')
  const oneCheck = oneStage.indexOf('enterprise-stage.mjs" check-present "$stage/app"')
  assert.ok(oneCopy > 0 && oneCheck > oneCopy, 'the one-container image\'s staging copies and then checks enterprise/')
  assert.ok(!oneStage.includes('enterprise-stage.mjs" stub'), 'no stub in the one-container image')
  for (const builder of ['self-host/build-image.sh', '.github/workflows/selfhost-image.yml']) {
    const text = read(builder)
    const staged = text.indexOf('stage-image.sh')
    const built = Math.max(text.indexOf('docker build '), text.indexOf('uses: docker/build-push-action'))
    assert.ok(staged > 0 && built > staged, `${builder} stages with stage-image.sh before it builds`)
    assert.ok(!text.includes('enterprise-stage.mjs" stub'), `no stub in ${builder}`)
  }
  const cloudBuild = read('scripts/test-port-container.mjs')
  assert.match(cloudBuild, /copyEnterprise\(appContext\)/)
  assert.match(cloudBuild, /checkEnterprisePresent\(buildContext\)/)
  assert.doesNotMatch(cloudBuild, /stubEnterprise\(/)
})

test('settings: self-host by default, no public invite switch, a license key slot and the kill switch', () => {
  const example = JSON.parse(read('web/app/settings.example.json'))
  assert.equal(example.public.edition, 'self-host')
  assert.equal(example.public.agents?.invite, undefined)
  assert.equal(example.enterprise.license, '')
  assert.equal(example.connectors.off, false)
  assert.match(read('self-host/init.mjs'), /edition: 'self-host'/)
  assert.match(read('self-host/rootfs/opt/slatebox/lib/configure.mjs'), /edition: 'self-host'/)
})

test('licenses: MIT except enterprise/', () => {
  // LICENSE is the standard MIT text alone, so GitHub and npm tooling detect MIT; the enterprise/
  // carve-out is stated in LICENSING.md and the README, never inside LICENSE.
  const license = read('LICENSE')
  assert.match(license, /^MIT License\n\nCopyright \(c\) 2026 Slatebox LLC and Slatebox contributors\n\nPermission is hereby granted/)
  assert.doesNotMatch(license, /enterprise/i)
  for (const pkg of ['slatebox', 'slatebox-mcp', 'create-slatebox']) assert.equal(license, read(`packages/${pkg}/LICENSE.md`), pkg)
  const licensing = read('LICENSING.md')
  assert.match(licensing, /`enterprise\/`[\s\S]*Slatebox Enterprise License[\s\S]*enterprise\/LICENSE/)
  assert.match(licensing, /MIT License in\s+\[`LICENSE`\]/)
  assert.match(read('README.md'), /enterprise\/[\s\S]*Slatebox Enterprise License/)
  const enterprise = read('enterprise/LICENSE')
  assert.match(enterprise, /^Slatebox Enterprise License/)
  assert.match(enterprise, /not open source/)
  assert.match(enterprise, /Slatebox LLC/)
  // it points at the root LICENSE that exists (LICENSE.md was renamed to LICENSE)
  assert.match(enterprise, /MIT License in LICENSE at the repository root/)
  // Free use in any Slatebox install, Cloud or self-hosted, at no charge (owner, 2026-11-26): still
  // source-available, never relicensed to MIT.
  assert.match(enterprise, /You may also copy, install and run the Enterprise Software[\s\S]*in\s+production[\s\S]*as part of any\s+install of Slatebox: Slatebox Cloud, or Slatebox installed on your own or\s+anyone else's servers\. This use is free of charge and needs no license\s+key\./)
  // passing on a copy of Slatebox (a mirror, a fork, an install for a client) is not distribution that needs an agreement
  assert.match(enterprise, /This does\s+not limit passing on a copy of Slatebox, with this license kept in\s+it, for someone to run under section 1;/)
  // No paid clones: selling Slatebox as a hosted service needs an agreement; free hosting does not.
  assert.match(enterprise, /d\. offering Slatebox with the Enterprise Software in it to others as a\s+paid hosted service\. Running Slatebox for your own organization, or\s+hosting it for others at no charge, needs no agreement\./)
  assert.doesNotMatch(enterprise, /locked|on-prem license|license check/)
  assert.match(licensing, /free use of `enterprise\/` in any Slatebox install, on\s+Slatebox Cloud or self-hosted, at no charge/)
  assert.match(licensing, /source-available, not open\s+source/)
  assert.equal(JSON.parse(read('package.json')).license, 'SEE LICENSE IN LICENSING.md')
  assert.equal(JSON.parse(read('web/app/package.json')).license, 'MIT')
  assert.equal(JSON.parse(read('packages/slatebox-mcp/package.json')).license, 'MIT')
})
