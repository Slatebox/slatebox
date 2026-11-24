import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyDeclaredSlateboxPackage } from './slatebox-package-source.mjs'
import { checkPresent as checkEnterprisePresent, copy as copyEnterprise } from './enterprise-stage.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const webRoot = resolve(projectRoot, 'web')
const libraryRoot = resolve(
  process.env.SLATEBOX_LIBRARY_DIR || resolve(projectRoot, '../slateboxjs-v2')
)
// Settings are never tracked: SLATEBOX_APP_SETTINGS, else a local web/app/settings.dev.json,
// else the maintainers' private copy under SLATEBOX_PRIVATE_DIR.
const localSettings = resolve(webRoot, 'app/settings.dev.json')
const privateSettings = resolve(
  process.env.SLATEBOX_PRIVATE_DIR || resolve(homedir(), '.config/slatebox-private'),
  'settings/settings.dev.json'
)
const settingsPath = resolve(
  process.env.SLATEBOX_APP_SETTINGS ||
    (existsSync(localSettings) || !existsSync(privateSettings) ? localSettings : privateSettings)
)
const imageTag = process.env.SLATEBOX_PORT_IMAGE || 'slatebox-port:meteor-3.5'
const imagePlatform = process.env.SLATEBOX_PORT_PLATFORM?.trim() || ''
const mongoImage = process.env.SLATEBOX_MONGO_IMAGE || 'mongo:7.0'
const librarySource = process.env.SLATEBOX_LIBRARY_SOURCE?.trim() || 'packed'
const expectedLibraryVersion = process.env.SLATEBOX_LIBRARY_VERSION?.trim() || ''
const expectedLibraryIntegrity =
  process.env.SLATEBOX_LIBRARY_INTEGRITY?.trim() || ''
const expectedLibraryRevision =
  process.env.SLATEBOX_LIBRARY_REVISION?.trim() || ''
const buildOnly = process.argv.includes('--build-only')
const keepContext = process.env.SLATEBOX_KEEP_BUILD_CONTEXT === 'true'
const suffix = `${process.pid}-${Date.now()}`
const networkName = `slatebox-port-${suffix}`
const mongoName = `slatebox-port-mongo-${suffix}`
const appName = `slatebox-port-app-${suffix}`
const temporaryRoot = mkdtempSync(join(tmpdir(), 'slatebox-port-container-'))
const buildContext = resolve(temporaryRoot, 'web')

function requirePath(path, label) {
  if (!existsSync(path)) throw new Error(`${label} not found: ${path}`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || projectRoot,
    env: options.env || process.env,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !options.allowFailure) {
    if (options.capture && result.stderr) process.stderr.write(result.stderr)
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})`)
  }
  return result
}

function appImageRunArgs(args) {
  return [
    'run',
    ...(imagePlatform ? ['--platform', imagePlatform] : []),
    ...args,
  ]
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close(() => {
        if (port) resolvePort(port)
        else reject(new Error('Unable to allocate a local port'))
      })
    })
  })
}

function waitFor(label, check, attempts = 120, interval = 1000) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (check()) return
    if (attempt < attempts) sleep(interval)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

function copyBuildContext() {
  cpSync(webRoot, buildContext, {
    recursive: true,
    filter(source) {
      const path = relative(webRoot, source)
      if (!path) return true
      const parts = path.split(sep)
      if (parts.includes('node_modules') || parts.includes('.DS_Store')) {
        return false
      }
      // web/app/enterprise is a development link or an old copy: staged fresh below
      if (path === `app${sep}enterprise`) return false
      return !path.startsWith(`app${sep}.meteor${sep}local`)
    },
  })
  // Every image carries enterprise/: Slatebox Cloud runs it (settings.public.edition 'cloud'), and
  // a self-hosted install runs it only with a license key (web/app/server/enterprise-license.mjs).
  const appContext = resolve(buildContext, 'app')
  copyEnterprise(appContext)
  checkEnterprisePresent(buildContext)
}

function stageLibraryArtifact() {
  run('npm', ['run', 'build'], { cwd: libraryRoot })
  const result = run(
    'npm',
    ['pack', '--json', '--pack-destination', resolve(buildContext, 'app')],
    { cwd: libraryRoot, capture: true }
  )
  const [{ filename }] = JSON.parse(result.stdout)
  const appRoot = resolve(buildContext, 'app')
  const packagePath = resolve(appRoot, 'package.json')
  const lockPath = resolve(appRoot, 'package-lock.json')
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
  packageJson.dependencies.slateboxjs = `file:./${filename}`
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)

  // The tracked lock still describes the sibling checkout. Generate a clean,
  // self-contained candidate lock for the packed artifact instead of asking
  // npm to incrementally reconcile two different file dependency layouts.
  rmSync(lockPath, { force: true })

  run(
    'meteor',
    [
      'npm',
      'install',
      '--package-lock-only',
      '--legacy-peer-deps=false',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    { cwd: appRoot }
  )

  const lock = JSON.parse(
    readFileSync(lockPath, 'utf8')
  )
  const libraryPackage = JSON.parse(
    readFileSync(resolve(libraryRoot, 'package.json'), 'utf8')
  )
  const lockedLibrary = lock.packages?.['node_modules/slateboxjs']
  if (lockedLibrary?.version !== libraryPackage.version) {
    throw new Error(
      `Candidate lock contains SlateboxJS ${lockedLibrary?.version || 'unknown'}; expected ${libraryPackage.version}`
    )
  }
  return libraryPackage.version
}

function useDeclaredRegistryArtifact() {
  const appRoot = resolve(buildContext, 'app')
  return verifyDeclaredSlateboxPackage({
    packageJson: JSON.parse(
      readFileSync(resolve(appRoot, 'package.json'), 'utf8')
    ),
    lock: JSON.parse(readFileSync(resolve(appRoot, 'package-lock.json'), 'utf8')),
    expectedVersion: expectedLibraryVersion,
    expectedIntegrity: expectedLibraryIntegrity,
  })
}

function buildImage(libraryVersion, libraryRevision) {
  const appRevision = run('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    capture: true,
  }).stdout.trim()

  run('docker', [
    'build',
    ...(imagePlatform ? ['--platform', imagePlatform] : []),
    '--progress=plain',
    '--tag',
    imageTag,
    '--label',
    `com.slatebox.app-revision=${appRevision}`,
    '--label',
    `com.slatebox.library-revision=${libraryRevision}`,
    '--label',
    `com.slatebox.library-version=${libraryVersion}`,
    buildContext,
  ])

  if (imagePlatform) {
    const actualPlatform = run(
      'docker',
      ['image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', imageTag],
      { capture: true }
    ).stdout.trim()
    if (actualPlatform !== imagePlatform) {
      throw new Error(
        `Candidate image uses ${actualPlatform}; expected ${imagePlatform}`
      )
    }
  }

  const nodeVersion = run(
    'docker',
    appImageRunArgs(['--rm', '--entrypoint', 'node', imageTag, '--version']),
    { capture: true }
  ).stdout.trim()
  if (nodeVersion !== 'v24.15.0') {
    throw new Error(`Candidate image uses ${nodeVersion}; expected v24.15.0`)
  }

  const bundledLibraryVersion = run(
    'docker',
    appImageRunArgs([
      '--rm',
      '--entrypoint',
      'node',
      imageTag,
      '--print',
      "require('/opt/bundle/bundle/programs/server/npm/node_modules/slateboxjs/package.json').version",
    ]),
    { capture: true }
  ).stdout.trim()
  if (bundledLibraryVersion !== libraryVersion) {
    throw new Error(
      `Candidate image contains SlateboxJS ${bundledLibraryVersion}; expected ${libraryVersion}`
    )
  }

  const bcryptRoot =
    '/opt/bundle/bundle/programs/server/npm/node_modules/meteor/accounts-password/node_modules'
  const bundledBcryptCheck = run(
    'docker',
    appImageRunArgs([
      '--rm',
      '--entrypoint',
      'node',
      imageTag,
      '--eval',
      `const bcrypt = require('${bcryptRoot}/bcrypt'); const argon2 = require('${bcryptRoot}/argon2'); const hash = bcrypt.hashSync('slatebox-runtime-check', 4); argon2.hash('slatebox-runtime-check').then((argonHash) => argon2.verify(argonHash, 'slatebox-runtime-check')).then((argonValid) => process.stdout.write(require('${bcryptRoot}/bcrypt/package.json').version + ':' + require('${bcryptRoot}/argon2/package.json').version + ':' + bcrypt.compareSync('slatebox-runtime-check', hash) + ':' + argonValid))`,
    ]),
    { capture: true }
  ).stdout.trim()
  if (bundledBcryptCheck !== '6.0.0:0.41.1:true:true') {
    throw new Error(
      `Candidate image password runtime check returned ${bundledBcryptCheck}; expected 6.0.0:0.41.1:true:true`
    )
  }
}

async function smokeImage() {
  const port = process.env.SLATEBOX_PORT || String(await freePort())
  const appUrl = `http://127.0.0.1:${port}`
  const settings = readFileSync(settingsPath, 'utf8')

  run('docker', ['network', 'create', networkName])
  run('docker', [
    'run',
    '--detach',
    '--name',
    mongoName,
    '--network',
    networkName,
    '--network-alias',
    'mongo',
    mongoImage,
    '--replSet',
    'rs0',
    '--bind_ip_all',
  ])

  waitFor('MongoDB', () => {
    const result = run(
      'docker',
      [
        'exec',
        mongoName,
        'mongosh',
        '--quiet',
        '--eval',
        'db.adminCommand({ ping: 1 }).ok',
      ],
      { capture: true, allowFailure: true }
    )
    return result.status === 0 && result.stdout.trim() === '1'
  })

  run('docker', [
    'exec',
    mongoName,
    'mongosh',
    '--quiet',
    '--eval',
    "rs.initiate({_id:'rs0',members:[{_id:0,host:'mongo:27017'}]}).ok",
  ])
  waitFor('MongoDB replica set', () => {
    const result = run(
      'docker',
      ['exec', mongoName, 'mongosh', '--quiet', '--eval', 'rs.status().ok'],
      { capture: true, allowFailure: true }
    )
    return result.status === 0 && result.stdout.trim() === '1'
  })

  run(
    'docker',
    appImageRunArgs([
      '--detach',
      '--name',
      appName,
      '--network',
      networkName,
      '--publish',
      `${port}:3000`,
      '--env',
      `ROOT_URL=${appUrl}`,
      '--env',
      'MONGO_URL=mongodb://mongo:27017/slatebox?replicaSet=rs0',
      '--env',
      'PORT=3000',
      '--env',
      'METEOR_SETTINGS',
      imageTag,
    ]),
    { env: { ...process.env, METEOR_SETTINGS: settings } }
  )

  try {
    waitFor('Slatebox readiness', () => {
      const result = run(
        'curl',
        ['--fail', '--silent', '--show-error', `${appUrl}/readyz`],
        { capture: true, allowFailure: true }
      )
      return result.status === 0
    }, 180)

    run('curl', ['--fail', '--silent', '--show-error', `${appUrl}/livez`], {
      capture: true,
    })
    run('curl', ['--fail', '--silent', '--show-error', `${appUrl}/`], {
      capture: true,
    })
    run(
      'npx',
      ['playwright', 'test', '--config', 'playwright.app.config.ts'],
      {
        cwd: libraryRoot,
        env: {
          ...process.env,
          CI: 'true',
          SLATEBOX_APP_EXTERNAL: 'true',
          SLATEBOX_APP_URL: appUrl,
        },
      }
    )
  } catch (error) {
    run('docker', ['logs', '--tail', '250', appName], { allowFailure: true })
    throw error
  }
}

try {
  requirePath(resolve(webRoot, 'Dockerfile'), 'Slatebox app Dockerfile')
  requirePath(settingsPath, 'Meteor settings')

  if (!['packed', 'registry'].includes(librarySource)) {
    throw new Error(
      `SLATEBOX_LIBRARY_SOURCE must be packed or registry; received ${librarySource}`
    )
  }
  if (librarySource === 'packed' || !buildOnly) {
    requirePath(resolve(libraryRoot, 'package.json'), 'SlateboxJS library')
  }
  if (
    librarySource === 'registry' &&
    !/^[0-9a-f]{40}$/.test(expectedLibraryRevision)
  ) {
    throw new Error(
      'SLATEBOX_LIBRARY_REVISION must be the full 40-character library commit when SLATEBOX_LIBRARY_SOURCE=registry'
    )
  }

  run('npm', ['run', 'test:image-palette'], {
    cwd: resolve(webRoot, 'app'),
  })
  run('npm', ['run', 'test:dependency-contracts'], {
    cwd: resolve(webRoot, 'app'),
  })
  run('npm', ['run', 'test:guest-registration'], {
    cwd: resolve(webRoot, 'app'),
  })
  copyBuildContext()
  const libraryVersion =
    librarySource === 'registry'
      ? useDeclaredRegistryArtifact()
      : stageLibraryArtifact()
  const libraryRevision =
    librarySource === 'registry'
      ? expectedLibraryRevision
      : run('git', ['rev-parse', 'HEAD'], {
          cwd: libraryRoot,
          capture: true,
        }).stdout.trim()
  buildImage(libraryVersion, libraryRevision)
  if (!buildOnly) await smokeImage()
  console.log(
    `Verified ${imageTag}: Meteor 3.5 build, Node 24.15.0 runtime${
      buildOnly ? '' : ', Mongo replica-set readiness, and real-host app invariants'
    }${imagePlatform ? ` on ${imagePlatform}` : ''}.`
  )
} finally {
  run('docker', ['rm', '--force', appName], { allowFailure: true, capture: true })
  run('docker', ['rm', '--force', mongoName], {
    allowFailure: true,
    capture: true,
  })
  run('docker', ['network', 'rm', networkName], {
    allowFailure: true,
    capture: true,
  })
  if (!keepContext) rmSync(temporaryRoot, { recursive: true, force: true })
  else console.log(`Preserved build context: ${temporaryRoot}`)
}
