// What the app's browser bundle weighs as Meteor builds it: the engine's ceilings
// (slateboxjs `check:budget`) measure the engine's own files, but Meteor loads the engine's .cjs
// builds through its stub files and minifies them again into its own bundle, so only a real
// `meteor build` says what a person downloads.
//
//   node scripts/check-client-bundle.mjs [--out DIR] [--record]
//
// Builds web/app into DIR (a new temporary folder by default), then measures, gzip -9:
// - eager: every script a page loads before any dynamic import (web.browser/*.js);
// - boards: the dynamic modules of slateboxjs/boards (the kits, the board layer, Dragology's use);
// - rules: the dynamic modules of slateboxjs/workshops/rules.
// Each is compared with scripts/client-bundle-baseline.json; the check fails when eager grows by
// more than `allowance.eager` bytes over the baseline, or a board chunk is found in the eager scripts.
// --record writes the measurement as the new baseline (after a reviewed, intended change).
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const app = join(root, 'web/app')
const baselinePath = join(root, 'scripts/client-bundle-baseline.json')
const args = process.argv.slice(2)
const record = args.includes('--record')
const outAt = args.indexOf('--out')
const out = outAt >= 0 ? resolve(args[outAt + 1]) : mkdtempSync(join(tmpdir(), 'slatebox-client-bundle-'))

if (!existsSync(join(out, 'bundle/programs/web.browser')) || args.includes('--rebuild')) {
  console.log(`meteor build → ${out}`)
  execFileSync('meteor', ['build', out, '--directory'], { cwd: app, stdio: 'inherit' })
}
const browser = join(out, 'bundle/programs/web.browser')
const gz = file => gzipSync(readFileSync(file), { level: 9 }).length
const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : [path]
})

const eagerFiles = readdirSync(browser).filter(name => name.endsWith('.js')).map(name => join(browser, name))
const dynamicFiles = existsSync(join(browser, 'dynamic')) ? walk(join(browser, 'dynamic')).filter(path => /\.[cm]?js$/.test(path)) : []
const engineFile = (path, entry) => relative(browser, path).includes(`node_modules/slateboxjs/dist/${entry}`)
const sum = files => files.reduce((total, file) => total + gz(file), 0)
const now = {
  eager: sum(eagerFiles),
  boards: sum(dynamicFiles.filter(path => engineFile(path, 'boards.cjs'))),
  rules: sum(dynamicFiles.filter(path => engineFile(path, 'workshop-rules.cjs'))),
}
// A board's kit or rules in the eager scripts: a plain slate would download them.
const eagerText = eagerFiles.map(file => readFileSync(file, 'utf8')).join('\n')
const leaked = ['launchPlanKit', 'pipelineKit', 'budgetKit', 'registerWorkshopRules(budgetRules'].filter(marker => eagerText.includes(marker))

let stamp = null
try { stamp = JSON.parse(readFileSync(join(app, 'node_modules/slateboxjs/dist/BUILD.json'), 'utf8')) } catch { /* An engine built before stamps. */ }
const measured = { ...now, engine: stamp ? { version: stamp.version, commit: stamp.commit } : null }
// A local engine linked in (file-based iteration: node_modules/slateboxjs -> a checkout) brings its own
// node_modules, and with it a second react-dom that the shipped bundle never has (ship installs the engine
// from its packed tarball, which declares react and react-dom as peers). Say so, so the number is read right.
const engineDir = join(app, 'node_modules/slateboxjs')
const ownReactDom = (() => { try { return lstatSync(engineDir).isSymbolicLink() && existsSync(join(realpathSync(engineDir), 'node_modules/react-dom/package.json')) } catch { return false } })()
if (ownReactDom) {
  console.warn('⚠ slateboxjs is a linked checkout with its own node_modules/react-dom: this build carries a second react-dom (about 45 KB gzip) that the shipped bundle, made from the packed engine, does not.')
}
console.table([{ part: 'eager', gzip: now.eager }, { part: 'boards (dynamic)', gzip: now.boards }, { part: 'rules (dynamic)', gzip: now.rules }])

if (record) {
  const allowance = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')).allowance : { eager: 10200 }
  writeFileSync(baselinePath, JSON.stringify({ measured, allowance, recordedAt: new Date().toISOString() }, null, 2) + '\n')
  console.log(`Recorded ${relative(root, baselinePath)}.`)
  process.exit(leaked.length ? 1 : 0)
}
if (!existsSync(baselinePath)) { console.error('No baseline: run with --record first.'); process.exit(1) }
const { measured: base, allowance } = JSON.parse(readFileSync(baselinePath, 'utf8'))
const problems = []
if (now.eager > base.eager + allowance.eager) problems.push(`The eager bundle is ${now.eager - base.eager} B gzip over the baseline (allowed ${allowance.eager}).`)
if (!now.boards) problems.push('No slateboxjs/boards module among the dynamic imports: the boards would be eager or missing.')
if (!now.rules) problems.push('No slateboxjs/workshops/rules module among the dynamic imports.')
if (leaked.length) problems.push(`Board code in the eager bundle: ${leaked.join(', ')}.`)
console.log(`eager ${now.eager - base.eager >= 0 ? '+' : ''}${now.eager - base.eager} B gzip over the baseline (allowed +${allowance.eager}).`)
if (problems.length) { for (const problem of problems) console.error('✗ ' + problem); process.exit(1) }
console.log('✓ The app\'s eager bundle is within its allowance, and the boards and their rules load on demand.')
