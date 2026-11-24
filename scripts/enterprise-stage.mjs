// Puts the right thing at web/app/enterprise, the path the app loads enterprise code from
// ('/enterprise/server', '/enterprise/client'). Meteor builds only web/app, and the repository's
// enterprise/ directory (enterprise/LICENSE, not MIT) sits outside it.
//
// Every image carries enterprise/: Slatebox Cloud runs it, and a self-hosted install runs it only
// once a license key unlocks it (web/app/server/enterprise-license.mjs).
//
//   node scripts/enterprise-stage.mjs link                 local development: web/app/enterprise → ../../enterprise
//   node scripts/enterprise-stage.mjs copy <meteor app>    a build context: a real copy of enterprise/
//   node scripts/enterprise-stage.mjs check-present <dir>  fails unless <dir> holds the real enterprise code
//   node scripts/enterprise-stage.mjs stub <meteor app>    a stub with no enterprise code (tests, MIT-only builds)
//   node scripts/enterprise-stage.mjs check-absent <dir>   fails when anything from enterprise/ is under <dir>
//
// web/app/enterprise is git-ignored, so `git archive HEAD:web` never contains it: builds add it.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const enterpriseRoot = join(repoRoot, 'enterprise')
export const appRoot = join(repoRoot, 'web/app')

// Every enterprise file names its license in its first lines; enterprise/LICENSE starts with its title.
export const ENTERPRISE_MARKER = 'Licensed under the Slatebox Enterprise License'
const LICENSE_TITLE = 'Slatebox Enterprise License'

const STUB = `// MIT (LICENSE.md). Self-host build: Slatebox Cloud's enterprise code is not part of this build.
// The app requires this path only on Slatebox Cloud (web/app/server/enterprise-loader.mjs).
export const selfHostStub = true
`
export const STUB_FILES = ['server/index.js', 'client/index.js']

const clear = (target) => {
  if (existsSync(target) || isLink(target)) rmSync(target, { recursive: true, force: true })
}
const isLink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

export function link(app = appRoot) {
  const target = join(app, 'enterprise')
  clear(target)
  symlinkSync(relative(app, enterpriseRoot), target, 'dir')
  return target
}

export function copy(app) {
  const target = join(app, 'enterprise')
  clear(target)
  cpSync(enterpriseRoot, target, { recursive: true, dereference: true })
  return target
}

export function stub(app) {
  const target = join(app, 'enterprise')
  clear(target)
  for (const file of STUB_FILES) {
    mkdirSync(dirname(join(target, file)), { recursive: true })
    writeFileSync(join(target, file), STUB)
  }
  return target
}

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) return [path]
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(path)
    return [path]
  })

/** Every path under `dir` that carries enterprise code or the enterprise license. */
export function enterpriseFilesUnder(dir) {
  const found = []
  for (const path of walk(dir)) {
    if (isLink(path)) {
      // a link into enterprise/ (the development link) counts as enterprise code
      if (/(^|[\\/])enterprise([\\/]|$)/.test(readlinkSync(path))) found.push(path)
      continue
    }
    const head = readFileSync(path).subarray(0, 4096).toString('utf8')
    if (head.includes(ENTERPRISE_MARKER) || head.startsWith(LICENSE_TITLE)) found.push(path)
  }
  // the stub folder may hold only the stub files
  const slot = join(dir, 'enterprise')
  if (existsSync(slot) && !isLink(slot)) {
    for (const path of walk(slot)) {
      const rel = relative(slot, path).split('\\').join('/')
      if (!STUB_FILES.includes(rel) || readFileSync(path, 'utf8') !== STUB) found.push(path)
    }
  }
  return [...new Set(found)]
}

export function checkAbsent(dir) {
  const found = enterpriseFilesUnder(dir)
  if (found.length) {
    throw new Error(`Enterprise code found in a self-host build:\n${found.map((path) => '  ' + relative(dir, path)).join('\n')}`)
  }
}

/** Fails unless the build context holds the real enterprise code at app/enterprise (or enterprise/ for a Meteor app dir). */
export function checkPresent(dir) {
  const candidates = [join(dir, 'app', 'enterprise'), join(dir, 'enterprise')]
  const slot = candidates.find((path) => existsSync(join(path, 'server', 'index.js')))
  const real = slot && readFileSync(join(slot, 'server', 'index.js'), 'utf8').includes(ENTERPRISE_MARKER) && existsSync(join(slot, 'client', 'index.jsx')) &&
    existsSync(join(slot, 'LICENSE')) && readFileSync(join(slot, 'LICENSE'), 'utf8').startsWith(LICENSE_TITLE)
  if (!real) throw new Error(`There is no enterprise code in this build under ${dir} (node scripts/enterprise-stage.mjs copy <meteor app>)`)
  return slot
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, dir] = process.argv.slice(2)
  try {
    if (command === 'link') console.log(`linked ${link()}`)
    else if (command === 'copy' && dir) console.log(`copied enterprise/ to ${copy(resolve(dir))}`)
    else if (command === 'check-present' && dir) console.log(`enterprise code is at ${checkPresent(resolve(dir))}`)
    else if (command === 'stub' && dir) console.log(`wrote the self-host stub at ${stub(resolve(dir))}`)
    else if (command === 'check-absent' && dir) {
      checkAbsent(resolve(dir))
      console.log(`no enterprise code under ${resolve(dir)}`)
    } else {
      console.error('Usage: node scripts/enterprise-stage.mjs link | copy <meteor app> | check-present <dir> | stub <meteor app> | check-absent <dir>')
      process.exit(2)
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
