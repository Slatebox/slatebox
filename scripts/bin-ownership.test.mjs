// Two packages of this repository must never name the same command: npm refuses the second
// global install (or, with --force, silently replaces the first one's command). 0.4.0 of
// slatebox-mcp gave the `slatebox` command to the slatebox package; this keeps it that way.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

function manifests() {
  const dir = join(root, 'packages')
  return readdirSync(dir).map(name => join(dir, name, 'package.json')).filter(existsSync).map(path => JSON.parse(readFileSync(path, 'utf8')))
}

const bins = manifest => (typeof manifest.bin === 'string' ? { [manifest.name.split('/').pop()]: manifest.bin } : manifest.bin || {})

test('no two packages claim the same command', () => {
  const owners = new Map()
  for (const manifest of manifests()) {
    for (const command of Object.keys(bins(manifest))) owners.set(command, [...(owners.get(command) || []), manifest.name])
  }
  const clashes = [...owners].filter(([, names]) => names.length > 1)
  assert.deepEqual(clashes, [], clashes.map(([command, names]) => `${command}: ${names.join(', ')}`).join('; '))
})

test('slatebox is the slatebox package\'s command and slatebox-mcp is slatebox-mcp\'s', () => {
  const byName = Object.fromEntries(manifests().map(manifest => [manifest.name, manifest]))
  assert.deepEqual(Object.keys(bins(byName.slatebox)), ['slatebox'])
  assert.deepEqual(Object.keys(bins(byName['slatebox-mcp'])), ['slatebox-mcp'])
})

test('the check itself catches a clash', () => {
  const owners = new Map()
  for (const manifest of [{ name: 'a', bin: { x: 'a.js' } }, { name: 'b', bin: { x: 'b.js' } }]) {
    for (const command of Object.keys(bins(manifest))) owners.set(command, [...(owners.get(command) || []), manifest.name])
  }
  assert.equal([...owners].filter(([, names]) => names.length > 1).length, 1)
})
