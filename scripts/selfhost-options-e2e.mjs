// Runs the browser spec for the header's Move to Cloud (scripts/selfhost-options.spec.mjs) end to
// end on this computer: a stand-in Slatebox Cloud (scripts/fake-slatebox-cloud.mjs) and a local
// self-hosted Meteor app (integrations on, with no key), then the same app told it is Slatebox
// Cloud. Local only: its own Meteor database, no outside service.
//
// The app's address is http://roscoe.test:<port>; the browser maps roscoe.test to this computer
// (--host-resolver-rules).
//
//   node scripts/selfhost-options-e2e.mjs [--dir <work dir>] [--shots <folder>] [--port 3730] [--cloud-port 3741] [--serve]
// --serve starts both and keeps them running (for running the spec by hand), printing its environment.
//
// The app runs from a copy of web/app in the work dir. Needs Meteor, mongosh and Playwright's
// Chromium (npx playwright install chromium).
import { spawn, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { testSigner } from './fake-slatebox-cloud.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : fallback
}
const dir = resolve(flag('dir', join(tmpdir(), 'slatebox-selfhost-e2e')))
const shots = flag('shots', '') ? resolve(flag('shots')) : ''
const port = Number(flag('port', 3730))
const cloudPort = Number(flag('cloud-port', 3741))
const HOST = 'roscoe.test'
const origin = `http://${HOST}:${port}`
const cloud = `http://127.0.0.1:${cloudPort}`
const log = (text) => console.log(`[e2e] ${text}`)

mkdirSync(dir, { recursive: true })
if (shots) mkdirSync(shots, { recursive: true })

// 1. The stand-in Cloud's test signing key (it signs nothing this run needs; the stand-in takes one).
const signer = testSigner('test-cloud-e2e')
const keyFile = join(dir, 'cloud-key.json')
writeFileSync(keyFile, JSON.stringify({ kid: signer.kid, privateKey: signer.privatePem, spki: signer.spki }), { mode: 0o600 })

// 2. The app copy: the same code.
const app = join(dir, 'app')
const source = join(root, 'web/app')
log(`copying the app to ${app}`)
mkdirSync(app, { recursive: true })
for (const entry of ['client', 'imports', 'server', 'public', 'private', 'api', 'assets', 'package.json', 'package-lock.json', '.meteor']) {
  const from = join(source, entry)
  if (!existsSync(from)) continue
  rmSync(join(app, entry), { recursive: true, force: true })
  cpSync(from, join(app, entry), { recursive: true, filter: (path) => !path.includes(`${join(source, '.meteor', 'local')}`) })
}
for (const [name, target] of [['node_modules', realpathSync(join(source, 'node_modules'))], ['enterprise', join(root, 'enterprise')]]) {
  rmSync(join(app, name), { recursive: true, force: true })
  symlinkSync(target, join(app, name))
}

// 3. Settings: a self-hosted install whose Slatebox Cloud is the stand-in.
const settingsFor = (edition, { name = edition } = {}) => {
  const settings = JSON.parse(readFileSync(join(source, 'settings.example.json'), 'utf8'))
  settings.public = { ...settings.public, env: edition === 'cloud' ? 'dev' : 'selfhost', edition, baseUrl: origin, instanceName: 'Roscoe' }
  settings.cloud = { origin: cloud }
  const path = join(dir, `settings.${name}.json`)
  writeFileSync(path, JSON.stringify(settings, null, 2))
  return path
}

// 4. The promote command the spec runs: a guest becomes a signed-in admin or member of team Roscoe.
const promote = join(dir, 'promote.sh')
writeFileSync(promote, `#!/bin/sh
# e2e only, this app's own Mongo on 127.0.0.1:${port + 1}
ID="$1"; ROLE="$2"
mongosh --quiet "mongodb://127.0.0.1:${port + 1}/meteor" --eval "
const id = '$ID', role = '$ROLE';
db.organizations.updateOne({ _id: 'org-roscoe' }, { \\$setOnInsert: { name: 'Roscoe', createdByUserId: id, createdOn: Date.now() } }, { upsert: true });
db.users.updateOne({ _id: id }, { \\$set: { isAnonymous: false, orgId: 'org-roscoe', isOrgOwner: role === 'admin', emails: [{ address: role + '-' + id.toLowerCase() + '@roscoe.test', verified: true }], profile: { firstName: role === 'admin' ? 'Ada' : 'Max', lastName: 'Roscoe', name: (role === 'admin' ? 'Ada' : 'Max') + ' Roscoe' } } });
db.slates.updateMany({ userId: id }, { \\$set: { orgId: 'org-roscoe' } });
if (role === 'admin') db.permissions.insertMany([{ _id: 'adm-' + id, userId: id, orgId: 'org-roscoe', claimId: 'admin' }, { _id: 'uber-' + id, userId: id, claimId: 'uberMensch' }]);
print('promoted ' + role);
"
`)
chmodSync(promote, 0o755)

const children = []
const stop = () => children.forEach((child) => { try { process.kill(-child.pid, 'SIGTERM') } catch { /* gone */ } })
process.on('exit', stop)
process.on('SIGINT', () => process.exit(130))
process.on('SIGTERM', () => process.exit(143))

function start(cmd, argv, options, ready, name) {
  return new Promise((resolveStart, reject) => {
    const child = spawn(cmd, argv, { ...options, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    const out = []
    const timer = setTimeout(() => reject(new Error(`${name} did not start:\n${out.join('').slice(-4000)}`)), 15 * 60 * 1000)
    const read = (chunk) => {
      const text = chunk.toString()
      out.push(text)
      writeFileSync(join(dir, `${name}.log`), out.join(''))
      if (ready.test(text)) {
        clearTimeout(timer)
        resolveStart(child)
      }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('exit', (code) => reject(new Error(`${name} exited (${code}):\n${out.join('').slice(-4000)}`)))
  })
}

// A fresh database every run (the build cache stays).
rmSync(join(app, '.meteor/local/db'), { recursive: true, force: true })

const meteor = (edition, options = {}) => start('meteor', ['run', '--port', String(port), '--settings', settingsFor(edition, options)], { cwd: app, env: { ...process.env, METEOR_DISABLE_OPTIMISTIC_CACHING: '1' } }, /App running at/, `meteor-${options.name || edition}`)

function spec(phase) {
  log(`browser spec, phase ${phase}`)
  execFileSync(join(root, 'node_modules/.bin/playwright'), ['test', '-c', 'scripts/playwright.config.mjs', 'selfhost-options.spec.mjs'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, SLATEBOX_ORIGIN: origin, SLATEBOX_HOST: HOST, SLATEBOX_CLOUD: cloud, SLATEBOX_PROMOTE: promote, SLATEBOX_PHASE: phase, ...(shots && { SLATEBOX_SHOTS: shots }) },
  })
}

try {
  log(`stand-in Slatebox Cloud on ${cloud}`)
  await start(process.execPath, [join(root, 'scripts/fake-slatebox-cloud.mjs'), String(cloudPort), keyFile, `${HOST}=http://127.0.0.1:${port}`], { cwd: root }, /fake Slatebox Cloud at/, 'cloud')
  log(`self-hosted app on ${origin} (first build takes a few minutes)`)
  let server = await meteor('self-host')
  // Set up already, as the installer's setup link leaves it (each person is then promoted by the spec).
  execFileSync('mongosh', ['--quiet', `mongodb://127.0.0.1:${port + 1}/meteor`, '--eval', "db.systemSettings.updateOne({ _id: 'selfHostSetup' }, { $set: { completedAt: new Date() } }, { upsert: true })"], { stdio: 'inherit' })
  if (args.includes('--serve')) {
    log(`serving: SLATEBOX_ORIGIN=${origin} SLATEBOX_CLOUD=${cloud} SLATEBOX_PROMOTE=${promote}`)
    await new Promise(() => {})
  }
  spec('selfhost')
  try { process.kill(-server.pid, 'SIGTERM') } catch { /* gone */ }
  await new Promise((r) => setTimeout(r, 4000))
  log('the same app, told it is Slatebox Cloud')
  server = await meteor('cloud')
  spec('cloud')
  log('passed')
  process.exit(0)
} catch (error) {
  console.error(error?.message || error)
  process.exit(1)
}
