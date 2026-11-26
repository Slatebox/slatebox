// Every name the app imports from the engine exists in the engine it is built with.
//
// 2026-11-26: app main imported normalizePlan (server/actions/slate-operations.mjs) and groupPlanErrors,
// planErrorHints and planErrorsOf (server/methods/ai/exec-chat.mjs) from 'slateboxjs/operations', which only
// an unmerged engine branch had. Under plain Node every importer failed with a SyntaxError; under Meteor
// the binding was undefined, so every in-app conversation edit threw a TypeError on prod. Nothing ran the
// root groups that would have caught it. This test reads every static `import { … } from 'slateboxjs…'`
// (and `export { … } from`) in the app, the enterprise code and the packages, loads each engine entry
// and checks that each named binding is one of its exports.
//
// By default it checks the engine installed in node_modules. SLATEBOX_ENGINE_DIR=<engine checkout> checks
// that build instead (the ship's preflight points it at the engine it is about to pack):
//   SLATEBOX_ENGINE_DIR=~/Projects/node/slateboxjs-v2 node --test scripts/engine-imports.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const SOURCES = ['web/app/server', 'web/app/imports', 'web/app/client', 'enterprise', 'packages/slatebox/src', 'packages/slatebox-mcp/src']
const SKIP = new Set(['node_modules', '.meteor', 'generated', 'dist'])

function* files(dir) {
  let entries
  try { entries = readdirSync(dir) } catch { return }
  for (const name of entries) {
    if (SKIP.has(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (/\.(m?js|jsx|ts|tsx)$/.test(name)) yield path
  }
}

/** [{ file, specifier, names }] for each static named import or re-export from the engine. */
export function engineImports(source) {
  const found = []
  const pattern = /\b(import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*['"](slateboxjs(?:\/[\w/-]+)?)['"]/g
  for (const [, , typeOnly, list, specifier] of source.matchAll(pattern)) {
    if (typeOnly) continue
    const names = list.split(',').map(part => part.trim()).filter(Boolean)
      .filter(part => !part.startsWith('type '))
      .map(part => part.split(/\s+as\s+/)[0].trim())
    if (names.length) found.push({ specifier, names })
  }
  return found
}

function engineEntry(specifier) {
  const dir = process.env.SLATEBOX_ENGINE_DIR
  if (!dir) return import(specifier)
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const subpath = '.' + specifier.slice('slateboxjs'.length)
  const target = pkg.exports?.[subpath]
  const file = typeof target === 'string' ? target : target?.import ?? target?.default
  assert.ok(file, `${specifier}: the engine at ${dir} exports no ${subpath}`)
  return import(pathToFileURL(join(dir, file)).href)
}

test('the parser reads named imports, aliases and re-exports, and leaves type-only imports out', () => {
  assert.deepEqual(engineImports(`import { a, b as c,\n  d } from 'slateboxjs/operations'\nimport type { T } from 'slateboxjs'\nexport { e } from "slateboxjs/catalog"\nimport { type U, f } from 'slateboxjs'`),
    [{ specifier: 'slateboxjs/operations', names: ['a', 'b', 'd'] }, { specifier: 'slateboxjs/catalog', names: ['e'] }, { specifier: 'slateboxjs', names: ['f'] }])
})

test('every named import from slateboxjs exists in the engine build', async () => {
  const wanted = new Map()
  for (const base of SOURCES)
    for (const file of files(join(root, base)))
      for (const { specifier, names } of engineImports(readFileSync(file, 'utf8')))
        for (const name of names) {
          const key = specifier + '\0' + name
          if (!wanted.has(key)) wanted.set(key, { specifier, name, files: [] })
          wanted.get(key).files.push(relative(root, file))
        }
  assert.ok(wanted.size > 50, `read ${wanted.size} engine imports from the app`)
  const modules = new Map()
  const missing = []
  for (const { specifier, name, files: where } of wanted.values()) {
    if (!modules.has(specifier)) modules.set(specifier, await engineEntry(specifier))
    if (!(name in modules.get(specifier))) missing.push(`${name} from '${specifier}' (${where.join(', ')})`)
  }
  assert.deepEqual(missing, [], `the engine${process.env.SLATEBOX_ENGINE_DIR ? ' at ' + process.env.SLATEBOX_ENGINE_DIR : ''} lacks:\n  ${missing.join('\n  ')}`)
})
