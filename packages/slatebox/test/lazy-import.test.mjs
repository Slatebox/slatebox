// The wizard costs nothing outside it: no module in src/ imports @clack/core or the wizard's
// modules statically (only src/ui/mode.mjs loads them, and only for a rich run), and --version,
// --help, --json and a pipe never resolve them.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import module from 'node:module'
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const BIN = fileURLToPath(new URL('../bin/slatebox.mjs', import.meta.url))
const HOOK = fileURLToPath(new URL('./pty/watch-imports.mjs', import.meta.url))
const files = dir => readdirSync(dir).flatMap(name => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]))
const STATIC = /^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm

test('no module in src/ statically imports @clack/core or the wizard (only the wizard itself uses @clack/core)', () => {
  const found = []
  for (const file of files(SRC).filter(path => path.endsWith('.mjs'))) {
    const relative = file.slice(SRC.length)
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(STATIC)) {
      if (specifier === '@clack/core' && relative !== join('ui', 'rich-prompt.mjs')) found.push(`${relative}: ${specifier}`)
      if (/(^|\/)ui\/rich-/.test(specifier) || (/^\.\/rich-/.test(specifier) && relative.startsWith('ui'))) found.push(`${relative}: ${specifier}`)
      if (/(^|\/)(ui\/)?(term|keys)\.mjs$/.test(specifier) && !relative.startsWith('ui')) found.push(`${relative}: ${specifier}`)
    }
  }
  assert.deepEqual(found, [])
})

test('--version, --help, --json and a pipe never resolve @clack/core or the wizard', { skip: typeof module.registerHooks !== 'function' && 'this Node.js has no module.registerHooks' }, () => {
  const home = mkdtempSync(join(tmpdir(), 'sbx-lazy-'))
  const env = { PATH: process.env.PATH, HOME: home, SLATEBOX_INSTALL_HOME: home }
  for (const args of [['--version'], ['--help'], ['plan', '--target', 'export', '--ai', 'none', '--json'], ['install', '--target', 'export', '--ai', 'none', '--yes', '--out', join(home, 'out')]]) {
    const result = spawnSync(process.execPath, ['--import', HOOK, BIN, ...args], { env, cwd: home, encoding: 'utf8' })
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`)
    assert.doesNotMatch(result.stderr, /\[resolved\]/, `${args.join(' ')} loaded the wizard`)
  }
  // The watch itself works: importing the wizard is seen.
  const control = spawnSync(process.execPath, ['--import', HOOK, '--input-type=module', '-e', `await import(${JSON.stringify(join(SRC, 'ui', 'rich-prompt.mjs'))})`], { env, encoding: 'utf8' })
  assert.match(control.stderr, /\[resolved\] @clack\/core/)
})
