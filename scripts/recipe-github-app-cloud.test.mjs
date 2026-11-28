// The Slatebox GitHub App on Slatebox Cloud and on a self-hosted install: Cloud's manifest flow
// makes ONE public App ("Slatebox", "Slatebox (test)" on the test server) in the Slatebox
// organization, homepage slatebox.com; a self-hosted install makes its own private App. Both ask
// for the same least permissions. The admin card's words (github-app-model.mjs), GitHub's return
// to Admin › Integration apps, and the recipe catalog's one-click Connect (the install screen).
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-github-app-cloud.test.mjs
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { APP_DESCRIPTION, CLOUD_ORG, appIdentity, appManifest } from '../enterprise/server/recipes/vendors/github/app-settings.mjs'
import { ADMIN_BACK, createVendor } from '../enterprise/server/recipes/vendors/github/index.mjs'
import { memoryCollection } from '../enterprise/server/recipes/vendors/github/store.mjs'
import { createRecipeService } from '../enterprise/server/recipes/service.mjs'
import { manifestFor } from '../enterprise/common/recipes/catalog.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'
import { defaultOrgOf, githubAppStatus, manifestFormFields, orgProblem, returnedNote } from '../web/app/imports/ui/pages/admin/ai/github-app-model.mjs'

const NOW = Date.parse('2026-11-27T12:00:00Z')
const LEAST = { metadata: 'read', contents: 'write', pull_requests: 'write', checks: 'write' }

function world({ edition = () => ({}), settings = {} } = {}) {
  const collections = { installations: memoryCollection(), deliveries: memoryCollection(), appSettings: memoryCollection(), flows: memoryCollection() }
  const master = loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
  return createVendor({ collections, master, settings: () => settings, now: () => NOW, origin: () => 'https://test.slatebox.com', edition })
}

test('Cloud makes one public App named Slatebox, homepage slatebox.com, with this server\'s addresses and the least permissions', () => {
  const m = appManifest('https://app.slatebox.com', { cloud: true })
  assert.equal(m.public, true)
  assert.equal(m.name, 'Slatebox')
  assert.equal(m.url, 'https://slatebox.com')
  assert.equal(m.description, APP_DESCRIPTION)
  assert.equal(m.hook_attributes.url, 'https://app.slatebox.com/integrations/github/events')
  assert.equal(m.redirect_url, 'https://app.slatebox.com/integrations/github/manifest/callback')
  assert.deepEqual(m.callback_urls, ['https://app.slatebox.com/integrations/github/installed'])
  assert.equal(m.setup_url, 'https://app.slatebox.com/integrations/github/installed')
  assert.deepEqual(m.default_permissions, LEAST)
  assert.deepEqual(m.default_events, ['push', 'pull_request'])
  const t = appManifest('https://test.slatebox.com', { cloud: true, test: true })
  assert.equal(t.name, 'Slatebox (test)')
  assert.equal(t.public, true)
  assert.equal(t.hook_attributes.url, 'https://test.slatebox.com/integrations/github/events')
  assert.deepEqual(appIdentity({ cloud: true }), { public: true, name: 'Slatebox', defaultOrg: CLOUD_ORG, homepage: 'https://slatebox.com' })
})

test('a self-hosted install still makes its own private App, homepage this server, same permissions', () => {
  for (const m of [appManifest('https://slate.acme.dev'), appManifest('https://slate.acme.dev', { cloud: false, test: true })]) {
    assert.equal(m.public, false)
    assert.equal(m.name, 'Slatebox')
    assert.equal(m.url, 'https://slate.acme.dev')
    assert.deepEqual(m.default_permissions, LEAST)
  }
  assert.equal(appIdentity({}).defaultOrg, null)
})

test('the App\'s description says only what Slatebox does on GitHub', () => {
  assert.match(APP_DESCRIPTION, /only the repositories you pick/)
  assert.match(APP_DESCRIPTION, /slatebox\/ branch/)
  assert.match(APP_DESCRIPTION, /never merges/)
  assert.doesNotMatch(APP_DESCRIPTION, /\bAI\b/, 'agent, not AI')
})

test('Cloud\'s manifest flow posts to the Slatebox organization by default; another org only when named', async () => {
  const v = world({ edition: () => ({ cloud: true, test: true }) })
  const form = await v.appSettings.manifestFor({ actor: { userId: 'admin' } })
  assert.match(form.action, /^https:\/\/github\.com\/organizations\/Slatebox\/settings\/apps\/new\?state=[\w-]+$/)
  assert.equal(form.org, 'Slatebox')
  const manifest = JSON.parse(form.manifest)
  assert.equal(manifest.public, true)
  assert.equal(manifest.name, 'Slatebox (test)')
  assert.equal(manifest.setup_url, 'https://test.slatebox.com/integrations/github/installed')
  const other = await v.appSettings.manifestFor({ actor: { userId: 'admin' }, org: 'acme' })
  assert.match(other.action, /\/organizations\/acme\/settings\/apps\/new\?/)
  const view = await v.appSettings.view()
  assert.deepEqual(view.makes, { name: 'Slatebox (test)', public: true, defaultOrg: 'Slatebox' })
  assert.equal(view.ready, false)
  assert.equal(view.installUrl, null)
})

test('a self-hosted install\'s flow goes to the admin\'s own account unless an org is named, and makes a private App', async () => {
  const v = world()
  const form = await v.appSettings.manifestFor({ actor: { userId: 'admin' } })
  assert.match(form.action, /^https:\/\/github\.com\/settings\/apps\/new\?state=/)
  assert.equal(form.org, null)
  assert.equal(JSON.parse(form.manifest).public, false)
  assert.deepEqual((await v.appSettings.view()).makes, { name: 'Slatebox', public: false, defaultOrg: null })
})

test('once made, the view gives the App\'s page and its plain install link', async () => {
  const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' })
  const v = world({ edition: () => ({ cloud: true }), settings: { appId: '9', slug: 'slatebox', clientId: 'Iv1.x', clientSecret: 'cs_x', privateKey: pem, webhookSecret: 'whsec_x' } })
  const view = await v.appSettings.view()
  assert.equal(view.ready, true)
  assert.equal(view.appUrl, 'https://github.com/apps/slatebox')
  assert.equal(view.installUrl, 'https://github.com/apps/slatebox/installations/new')
  assert.match(await v.installUrl('ana', 'p1'), /^https:\/\/github\.com\/apps\/slatebox\/installations\/new\?state=/, 'a person\'s Connect carries Slatebox\'s signed state')
})

test('GitHub sends the admin back to a page that exists: AI control, Integration apps tab', () => {
  assert.equal(ADMIN_BACK('ready'), '/admin/ai?tab=integration-apps&github=ready')
  assert.equal(returnedNote('?tab=integration-apps&github=ready').severity, 'success')
  assert.equal(returnedNote('?github=failed').severity, 'warning')
  assert.equal(returnedNote('?tab=integration-apps'), null)
})

test('the admin card: Create the GitHub App while not set up, status and install link once ready', () => {
  assert.equal(githubAppStatus(null).state, 'loading')
  const none = githubAppStatus({ ready: false, makes: { name: 'Slatebox', public: true, defaultOrg: 'Slatebox' } })
  assert.equal(none.state, 'none')
  assert.match(none.lines[0], /"Slatebox", a public GitHub App any GitHub account can install/)
  assert.match(none.lines[1], /metadata \(read\), contents \(write, used only for the diagram pull requests/)
  const ready = githubAppStatus({ ready: true, slug: 'slatebox', appId: '9', source: 'admin', appUrl: 'https://github.com/apps/slatebox', installUrl: 'https://github.com/apps/slatebox/installations/new', makes: {} })
  assert.equal(ready.state, 'ready')
  assert.equal(ready.title, 'GitHub App ready: slatebox')
  assert.equal(ready.installUrl, 'https://github.com/apps/slatebox/installations/new')
  assert.equal(githubAppStatus({ ready: false, appId: '9', makes: {} }).state, 'partial')
  assert.equal(defaultOrgOf({ makes: { defaultOrg: 'Slatebox' } }), 'Slatebox')
  assert.equal(defaultOrgOf({ makes: { defaultOrg: null } }), '')
  assert.equal(orgProblem(''), '')
  assert.equal(orgProblem('Slatebox'), '')
  assert.match(orgProblem('not an org!'), /letters, numbers and dashes/)
  assert.deepEqual(manifestFormFields({ action: 'https://github.com/organizations/Slatebox/settings/apps/new?state=s', manifest: '{}' }), { action: 'https://github.com/organizations/Slatebox/settings/apps/new?state=s', fields: { manifest: '{}' } })
  assert.equal(manifestFormFields({ action: 'javascript:alert(1)', manifest: '{}' }), null)
})

test('the recipe catalog gives GitHub recipes a one-click Connect: the App\'s install screen, until connected', async () => {
  const manifests = [manifestFor('github-architecture'), manifestFor('project-index')]
  assert.equal(manifests[0].integration, 'github')
  const make = (isConnected) => createRecipeService({
    store: {}, queue: {}, runner: {}, catalog: () => manifests, projects: {}, permissions: {}, outbound: {}, sealer: {},
    switches: { serverOff: async () => false, installEnabled: async () => true },
    connected: async () => isConnected,
    connectUrl: async (userId, integration) => (integration === 'github' ? `https://github.com/apps/slatebox/installations/new?state=${userId}` : null),
  })
  const off = await make(false).catalog({ userId: 'ana' })
  const gh = off.recipes.find((r) => r.id === 'github-architecture')
  assert.equal(gh.connected, false)
  assert.equal(gh.connectUrl, 'https://github.com/apps/slatebox/installations/new?state=ana')
  assert.equal(off.recipes.find((r) => r.id === 'project-index').connectUrl, undefined)
  const on = await make(true).catalog({ userId: 'ana' })
  assert.equal(on.recipes.find((r) => r.id === 'github-architecture').connectUrl, undefined, 'connected: nothing to connect')
})
