// The enterprise/ carve-out: outside agent connections live in enterprise/ under enterprise/LICENSE
// (not MIT). They run on Slatebox Cloud, and ship in the self-host image locked: only a license key
// signed by Slatebox LLC unlocks them there (owner decision 2026-11-24, "Upgrade on prem").
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
const cloud = (extra = {}) => ({ public: { edition: 'cloud', ...extra } })
const selfHost = { public: { env: 'selfhost', edition: 'self-host' } }

// A test signing key (never Slatebox LLC's) and a license it signed, for a self-hosted install.
const testKeyPair = generateKeyPairSync('ed25519')
const testKeys = { 'test-key': testKeyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }
const testLicense = await signLicense({ id: 'lic_test', licensee: 'Test Co', issuedAt: '2026-01-01', expiresAt: '2099-12-31' }, { kid: 'test-key', privateKey: testKeyPair.privateKey })
const licensed = (extra = {}) => ({ public: { env: 'selfhost', edition: 'self-host' }, enterprise: { license: testLicense }, ...extra })
// The loader's access check with the test key in place of Slatebox LLC's (the app's own uses only Slatebox LLC's).
const accessWith = (settings, keys = testKeys) => (now) => enterpriseAccess({ settings, env: {}, keys, now })

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

test('invited agents are on wherever enterprise code is unlocked; no public switch hides them', () => {
  // What the server tells browsers (server/enterprise.js): the only source the browser reads.
  assert.deepEqual(enterpriseState({ public: { enterprise: { unlocked: true, via: 'cloud', features: ['agents.invite'] } } }), { unlocked: true, via: 'cloud', features: ['agents.invite'] })
  assert.equal(agentInviteOn({ public: { enterprise: { unlocked: true, via: 'license', features: ['agents.invite'] } } }), true)
  assert.equal(agentInviteOn({ public: { enterprise: { unlocked: false, features: ['agents.invite'] } } }), false)
  assert.equal(agentInviteOn(cloud()), false, 'nothing is on until the server says so')
  // The old public feature switch does nothing now, either way.
  assert.equal(agentInviteOn(cloud({ agents: { invite: true } })), false)
  // The kill switch is server-side and on unless set to exactly true.
  assert.equal(agentInviteKilled({}), false)
  assert.equal(agentInviteKilled({ connectors: { off: 'yes' } }), false)
  assert.equal(agentInviteKilled({ connectors: { off: true } }), true)
  const fake = fakeEnterprise()
  const result = loadEnterprise({ settings: cloud(), load: fake.load, host: createEnterpriseHost() })
  assert.deepEqual(result.features, ['agents.invite'])
  assert.equal(fake.calls.context.agentInvite, true)
  const killed = fakeEnterprise()
  assert.deepEqual(loadEnterprise({ settings: { ...cloud(), connectors: { off: true } }, load: killed.load, host: createEnterpriseHost() }).features, [])
  assert.equal(killed.calls.context.agentInvite, false)
})

test('a self-hosted install without a valid license never loads the enterprise module and registers nothing', () => {
  const otherKey = generateKeyPairSync('ed25519')
  const cases = [
    [selfHost, 'no_license'],
    [{}, 'no_license'],
    [{ public: { agents: { invite: true } } }, 'no_license'],
    [licensed({ enterprise: { license: testLicense.slice(0, -4) + 'AAAA' } }), 'bad_signature'],
    [licensed({ enterprise: { license: 'not a license' } }), 'malformed'],
  ]
  for (const [settings, reason] of cases) {
    const fake = fakeEnterprise()
    const host = createEnterpriseHost()
    const result = loadEnterprise({ settings, load: fake.load, host, access: accessWith(settings) })
    assert.equal(result.loaded, false)
    assert.equal(result.reason, 'locked')
    assert.equal(result.access.reason, reason)
    assert.deepEqual(result.features, [])
    assert.equal(fake.calls.loaded, 0, 'the enterprise module is not even required')
    assert.ok(host.isEmpty())
    assert.deepEqual(host.actions, [])
    assert.deepEqual(host.methods, {})
    assert.deepEqual(host.routes, [])
    const registry = createAppRegistry({ extraActions: host.actions })
    assert.equal(registry.list().length, baseActions.length)
    assert.equal(registry.get('connectors.probe'), undefined)
  }
  // A license signed by any key but Slatebox LLC's (here: not the key the check trusts) unlocks nothing.
  const foreign = { 'test-key': otherKey.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }
  const fake = fakeEnterprise()
  assert.equal(loadEnterprise({ settings: licensed(), load: fake.load, host: createEnterpriseHost(), access: accessWith(licensed(), foreign) }).loaded, false)
  assert.equal(fake.calls.loaded, 0)
  // The app's own check trusts only Slatebox LLC's keys: the test license does not unlock it.
  assert.equal(loadEnterprise({ settings: licensed(), load: fake.load, host: createEnterpriseHost() }).access.reason, 'unknown_key')
})

test('a licensed self-hosted install loads the enterprise module, and every entry point checks the license again', async () => {
  const fake = fakeEnterprise()
  const host = createEnterpriseHost()
  let now = Date.parse('2027-06-01T00:00:00Z')
  const settings = licensed()
  const access = () => enterpriseAccess({ settings, env: {}, keys: testKeys, now })
  const result = loadEnterprise({ settings, load: fake.load, host, access })
  assert.equal(result.loaded, true)
  assert.equal(result.access.via, 'license')
  assert.equal(result.access.license.licensee, 'Test Co')
  assert.equal(fake.calls.context.edition, 'self-host')
  assert.equal(fake.calls.context.via, 'license')
  const registry = createAppRegistry({ extraActions: host.actions })
  assert.equal(registry.list().length, baseActions.length + 1)
  assert.deepEqual(await registry.get('connectors.probe').handler({}, {}, {}), {})
  assert.equal(host.methods['connectors.ping'](), 'pong')
})

test('a licensed install whose license is no longer valid refuses each call', async () => {
  const fake = fakeEnterprise()
  const host = createEnterpriseHost()
  let valid = true
  const good = enterpriseAccess({ settings: licensed(), env: {}, keys: testKeys })
  const access = () => (valid ? good : { ...good, unlocked: false, via: null, reason: 'expired' })
  const result = loadEnterprise({ settings: licensed(), load: fake.load, host, access })
  assert.equal(result.loaded, true)
  valid = false
  // The loader re-reads the license at most hourly: step its clock past that.
  const realNow = Date.now
  Date.now = () => realNow() + 2 * 3_600_000
  try {
    await assert.rejects(async () => host.actions[0].handler({}, {}, {}), (error) => error instanceof EnterpriseLocked && error.status === 403 && error.code === 'enterprise_locked')
    assert.throws(() => host.methods['connectors.ping'](), EnterpriseLocked)
    const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } }
    host.routes[0].handler({}, res, () => {})
    assert.equal(res.statusCode, 403)
    assert.match(res.body, /enterprise_locked/)
  } finally {
    Date.now = realNow
  }
})

test('Cloud loads the enterprise module once and its actions join the one registry', () => {
  const fake = fakeEnterprise()
  const host = createEnterpriseHost()
  const result = loadEnterprise({ settings: cloud(), load: fake.load, host })
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
  assert.equal(registry.get('connectors.probe'), fake.action)
})

test('an unlocked install with no enterprise code (or a stub) registers nothing', () => {
  const missing = () => {
    const error = new Error("Cannot find module '/enterprise/server'")
    error.code = 'MODULE_NOT_FOUND'
    throw error
  }
  const logs = []
  const host = createEnterpriseHost()
  assert.equal(loadEnterprise({ settings: cloud(), load: missing, host, log: (t) => logs.push(t) }).reason, 'missing')
  assert.equal(loadEnterprise({ settings: cloud(), load: () => ({ selfHostStub: true }), host, log: (t) => logs.push(t) }).reason, 'stub')
  assert.ok(host.isEmpty())
  assert.equal(logs.length, 2)
  // any other failure inside the enterprise module fails the boot
  assert.throws(() => loadEnterprise({ settings: cloud(), load: () => { throw new TypeError('boom') }, host }), /boom/)
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
  const result = loadEnterprise({ settings: cloud(), load: () => server, host })
  assert.equal(result.loaded, true)
  assert.equal(result.name, 'slatebox-enterprise')
})

test('the browser loads the enterprise chunk only where the server says enterprise code is unlocked', async () => {
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
  const licensedSlots = createSlots()
  assert.equal((await loadEnterpriseClient({ settings: told({ unlocked: true, via: 'license', features: ['agents.invite'] }), load, slots: licensedSlots })).loaded, true)
  assert.equal(licensedSlots.get('agents.invite'), component)
  const failing = await loadEnterpriseClient({ settings: told({ unlocked: true, via: 'license', features: [] }), load: async () => { throw new Error('chunk missing') }, slots: createSlots() })
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

test('a self-host build context carries the enterprise code (locked until licensed); the checks catch a missing or stubbed copy', () => {
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
})

test('licenses: MIT except enterprise/', () => {
  const license = read('LICENSE.md')
  assert.match(license, /"enterprise\/"[\s\S]*enterprise\/LICENSE/)
  assert.match(license, /MIT License/)
  const enterprise = read('enterprise/LICENSE')
  assert.match(enterprise, /^Slatebox Enterprise License/)
  assert.match(enterprise, /not open source/)
  assert.match(enterprise, /Slatebox LLC/)
  assert.match(enterprise, /self-hosted Slatebox images[\s\S]*include the\s+Enterprise Software, locked/)
  assert.match(enterprise, /on-prem license\s+key/)
  assert.equal(JSON.parse(read('package.json')).license, 'SEE LICENSE IN LICENSE.md')
  assert.equal(JSON.parse(read('web/app/package.json')).license, 'MIT')
  assert.equal(JSON.parse(read('packages/slatebox-mcp/package.json')).license, 'MIT')
})
