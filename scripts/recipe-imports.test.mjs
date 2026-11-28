// What recipe code may import. A built-in recipe (enterprise/recipes/<id>/) sees the world only
// through its context (enterprise/server/recipes/context.mjs): it may import the common recipe
// modules, the MIT Mermaid modules (by the app's root path, /imports/..., as the Meteor build
// resolves it: enterprise/ is staged at web/app/enterprise), the engine's operations and
// workshops, its own folder, and the shared recipe folders (enterprise/recipes/_<name>/, such as
// _slack-ledger, the channel ledger four Slack recipes read);
// never the registry, Mongo, Meteor, fetch libraries or the app's server. And the runtime's pure
// modules stay pure: only meteor.js touches Meteor.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = (dir, out = []) => {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, out)
    else if (/\.m?js$/.test(name)) out.push(path)
  }
  return out
}
const importsOf = (text) => [...text.matchAll(/(?:^|\n)\s*(?:import|export)[^'"`]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] || m[2])

/** Whether a recipe file may import this specifier. */
export function recipeMayImport(file, specifier) {
  if (specifier === 'slateboxjs/operations' || specifier === 'slateboxjs/workshops') return true
  if (specifier.startsWith('node:')) return ['node:crypto', 'node:zlib', 'node:path'].includes(specifier)
  if (/^\/imports\/api\/common\/mermaid\/[\w-]+\.mjs$/.test(specifier)) return true
  if (!specifier.startsWith('.')) return false
  const target = resolve(dirname(file), specifier)
  const rel = relative(root, target)
  if (rel.startsWith('enterprise/common/')) return true
  if (rel.startsWith('web/app/imports/api/common/mermaid/')) return true
  const own = relative(root, file).split('/').slice(0, 3).join('/') // enterprise/recipes/<id>
  return rel.startsWith(own + '/') || /^enterprise\/recipes\/_[a-z0-9-]+\//.test(rel)
}

test('the rule itself', () => {
  const file = join(root, 'enterprise/recipes/github-architecture/run.mjs')
  assert.equal(recipeMayImport(file, '../../common/recipes/manifest.mjs'), true)
  assert.equal(recipeMayImport(file, './extract/compose.mjs'), true)
  assert.equal(recipeMayImport(file, '../../../web/app/imports/api/common/mermaid/export.mjs'), true)
  assert.equal(recipeMayImport(file, 'slateboxjs/operations'), true)
  assert.equal(recipeMayImport(file, '../../server/recipes/store.mjs'), false)
  assert.equal(recipeMayImport(file, '../github-pr-impact/run.mjs'), false)
  assert.equal(recipeMayImport(file, '/server/actions/registry.mjs'), false)
  assert.equal(recipeMayImport(file, 'meteor/mongo'), false)
  assert.equal(recipeMayImport(file, 'node-fetch'), false)
  assert.equal(recipeMayImport(file, 'node:http'), false)
  assert.equal(recipeMayImport(file, '/imports/api/common/mermaid/parse.mjs'), true, 'the Mermaid modules by the app\'s root path')
  assert.equal(recipeMayImport(file, '/imports/api/common/models.js'), false)
  assert.equal(recipeMayImport(file, '../_slack-ledger/fold.mjs'), true, 'a shared recipe folder')
  const shared = join(root, 'enterprise/recipes/_slack-ledger/fold.mjs')
  assert.equal(recipeMayImport(shared, '../_shared/text.mjs'), true)
  assert.equal(recipeMayImport(shared, '../slack-decision-log/run.mjs'), false, 'a shared folder never reaches into a recipe')
  assert.equal(recipeMayImport(shared, '../../server/recipes/vendors/slack/session.mjs'), false)
})

test('every built-in recipe imports only what it may', () => {
  const bad = []
  for (const file of files(join(root, 'enterprise/recipes'))) {
    for (const specifier of importsOf(readFileSync(file, 'utf8'))) if (!recipeMayImport(file, specifier)) bad.push(`${relative(root, file)}: ${specifier}`)
    if (/\bfetch\s*\(|globalThis\.fetch|process\.env/.test(readFileSync(file, 'utf8'))) bad.push(`${relative(root, file)}: calls fetch or reads the environment`)
  }
  assert.deepEqual(bad, [])
})

test('the runtime\'s modules are pure: only meteor.js touches Meteor; common/ is browser-safe', () => {
  for (const file of files(join(root, 'enterprise/server/recipes'))) {
    if (file.endsWith('meteor.js')) continue
    const specifiers = importsOf(readFileSync(file, 'utf8'))
    assert.ok(!specifiers.some((s) => s.startsWith('meteor/')), relative(root, file))
    assert.ok(!specifiers.some((s) => /models|\/server\/methods\//.test(s)), relative(root, file))
  }
  for (const file of files(join(root, 'enterprise/common/recipes'))) {
    const specifiers = importsOf(readFileSync(file, 'utf8'))
    assert.ok(specifiers.every((s) => s.startsWith('./') || s.startsWith('../')), relative(root, file))
  }
})
