// The enterprise/ carve-out: Slatebox Cloud's outside agent connections live in enterprise/ under
// enterprise/LICENSE (not MIT), load only when settings.public.edition is 'cloud', and never reach
// a self-host image.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { agentInviteEnabled, editionOf, isCloudEdition } from '../web/app/imports/api/common/edition.mjs'
import { createEnterpriseHost, loadEnterprise } from '../web/app/server/enterprise-loader.mjs'
import { createSlots, loadEnterpriseClient } from '../web/app/imports/api/client/enterprise-slots.mjs'
import { actions as baseActions, createAppRegistry } from '../web/app/server/actions/index.mjs'
import { defineAction } from '../web/app/server/actions/registry.mjs'
import { checkAbsent, copy, ENTERPRISE_MARKER, enterpriseFilesUnder, stub } from './enterprise-stage.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const cloud = (extra = {}) => ({ public: { edition: 'cloud', ...extra } })
const selfHost = { public: { env: 'selfhost', edition: 'self-host' } }

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

test('inviting agents is off by default, on only on Cloud with agents.invite true', () => {
  assert.equal(agentInviteEnabled(cloud()), false)
  assert.equal(agentInviteEnabled(cloud({ agents: {} })), false)
  assert.equal(agentInviteEnabled(cloud({ agents: { invite: 'yes' } })), false)
  assert.equal(agentInviteEnabled(cloud({ agents: { invite: true } })), true)
  assert.equal(agentInviteEnabled({ public: { agents: { invite: true } } }), false)
  assert.equal(agentInviteEnabled({ public: { edition: 'self-host', agents: { invite: true } } }), false)
})

test('self-host never loads the enterprise module and registers no methods, routes or actions', () => {
  for (const settings of [selfHost, {}, { public: { agents: { invite: true } } }]) {
    const fake = fakeEnterprise()
    const host = createEnterpriseHost()
    const result = loadEnterprise({ settings, load: fake.load, host })
    assert.deepEqual(result, { edition: 'self-host', loaded: false, reason: 'self-host' })
    assert.equal(fake.calls.loaded, 0, 'the enterprise module is not even required')
    assert.ok(host.isEmpty())
    assert.deepEqual(host.actions, [])
    assert.deepEqual(host.methods, {})
    assert.deepEqual(host.routes, [])
    const registry = createAppRegistry({ extraActions: host.actions })
    assert.equal(registry.list().length, baseActions.length)
    assert.equal(registry.get('connectors.probe'), undefined)
  }
})

test('Cloud loads the enterprise module once and its actions join the one registry', () => {
  const fake = fakeEnterprise()
  const host = createEnterpriseHost()
  const result = loadEnterprise({ settings: cloud({ agents: { invite: true } }), load: fake.load, host })
  assert.deepEqual(result, { edition: 'cloud', loaded: true, name: 'fake-enterprise' })
  assert.equal(fake.calls.loaded, 1)
  assert.equal(fake.calls.context.edition, 'cloud')
  assert.equal(fake.calls.context.agentInvite, true)
  assert.deepEqual(Object.keys(host.methods), ['connectors.ping'])
  assert.deepEqual(host.routes.map((r) => `${r.method} ${r.path}`), ['GET /connectors/oauth/callback'])
  const registry = createAppRegistry({ extraActions: host.actions })
  assert.equal(registry.list().length, baseActions.length + 1)
  assert.equal(registry.get('connectors.probe'), fake.action)
})

test('Cloud settings with no enterprise code (or the self-host stub) register nothing', () => {
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

test('the browser loads the enterprise chunk on Cloud only', async () => {
  let requested = 0
  const component = () => null
  const load = async () => (requested++, { register: (api) => api.fill('agents.invite', component) })
  const selfHostSlots = createSlots()
  assert.equal((await loadEnterpriseClient({ settings: selfHost, load, slots: selfHostSlots })).loaded, false)
  assert.equal(requested, 0)
  assert.deepEqual(selfHostSlots.names(), [])
  const cloudSlots = createSlots()
  assert.equal((await loadEnterpriseClient({ settings: cloud(), load, slots: cloudSlots })).loaded, true)
  assert.equal(requested, 1)
  assert.equal(cloudSlots.get('agents.invite'), component)
  const failing = await loadEnterpriseClient({ settings: cloud(), load: async () => { throw new Error('chunk missing') }, slots: createSlots() })
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

test('a self-host build context contains no enterprise code; a Cloud one does', () => {
  const work = mkdtempSync(join(tmpdir(), 'slatebox-enterprise-'))
  try {
    // what self-host/build-images.sh stages: the committed web/ tree (git archive HEAD:web)
    const web = join(work, 'web')
    cpSync(join(root, 'web'), web, {
      recursive: true,
      filter: (source) => {
        const rel = relative(join(root, 'web'), source).split(sep)
        return !rel.includes('node_modules') && !rel.includes('.meteor') && rel.join('/') !== 'app/enterprise'
      },
    })
    stub(join(web, 'app'))
    assert.doesNotThrow(() => checkAbsent(web))
    assert.ok(existsSync(join(web, 'app/enterprise/server/index.js')))
    // a planted copy is caught
    copy(join(web, 'app'))
    assert.throws(() => checkAbsent(web), /Enterprise code found/)
    assert.ok(enterpriseFilesUnder(web).some((p) => p.endsWith(join('enterprise', 'LICENSE'))))
    // a changed stub is caught too
    stub(join(web, 'app'))
    cpSync(join(root, 'enterprise/server/index.js'), join(web, 'app/enterprise/server/index.js'))
    assert.throws(() => checkAbsent(web), /server\/index\.js/)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test('the build scripts stage enterprise/ correctly for each edition', () => {
  const ignored = execFileSync('git', ['check-ignore', '--no-index', 'web/app/enterprise'], { cwd: root, encoding: 'utf8' })
  assert.match(ignored, /web\/app\/enterprise/)
  const tracked = execFileSync('git', ['ls-files', 'web/app/enterprise'], { cwd: root, encoding: 'utf8' })
  assert.equal(tracked.trim(), '')
  const selfHostBuild = read('self-host/build-images.sh')
  const stubAt = selfHostBuild.indexOf('enterprise-stage.mjs" stub "$stage/app/app"')
  const checkAt = selfHostBuild.indexOf('enterprise-stage.mjs" check-absent "$stage/app"')
  const dockerAt = selfHostBuild.indexOf('docker build')
  assert.ok(stubAt > 0 && checkAt > stubAt && dockerAt > checkAt, 'self-host stubs and checks before building the image')
  assert.ok(selfHostBuild.indexOf('archive "$app_sha:web"') < stubAt)
  const cloudBuild = read('scripts/test-port-container.mjs')
  assert.match(cloudBuild, /copyEnterprise\(appContext\)/)
  assert.match(cloudBuild, /SLATEBOX_EDITION === 'self-host'/)
})

test('settings: self-host by default, invite off by default', () => {
  const example = JSON.parse(read('web/app/settings.example.json'))
  assert.equal(example.public.edition, 'self-host')
  assert.equal(example.public.agents.invite, false)
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
  assert.equal(JSON.parse(read('package.json')).license, 'SEE LICENSE IN LICENSE.md')
  assert.equal(JSON.parse(read('web/app/package.json')).license, 'MIT')
  assert.equal(JSON.parse(read('packages/slatebox-mcp/package.json')).license, 'MIT')
})
