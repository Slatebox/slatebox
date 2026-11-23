// The Custom Behavior dialog (More > Note behaviour…) is retired (owner, 2026-11-21: "i don't know
// if we have a use for this behavior screen anymore? it was used primarily with templates").
// What it set that a live feature still reads is plain note data that chat and exec set through
// the operations contract: templateCategory (isCategory + categoryName) and hiddenControls (the showXTab
// flags the style bar reads). Lock (More > Locked, operations key locked) keeps a note in place.
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('../web/app/', import.meta.url))

async function sources(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === 'generated') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await sources(path))
    else if (/\.(m?js|jsx|ts|tsx)$/.test(entry.name)) out.push(path)
  }
  return out
}

test('the dialog, its settings list and its orphaned copy are gone', () => {
  for (const file of ['imports/ui/components/node/NodeBehavior.jsx', 'imports/ui/components/node/defaultBehaviors.js', 'imports/ui/components/IconPacks.jsx']) {
    assert.equal(existsSync(join(appDir, file)), false, `${file} should be deleted`)
  }
})

test('no app code opens it, sends its package or writes its dead flags', async () => {
  const retired = /NodeBehavior|defaultBehaviors|onNodeBehaviorChanged|behaviorChanges|setBehaviourOpen|disableMenuAsTemplate\s*=|disableDrag\s*=|showRelationship(Connector|Delete|Properties|Reassign)\s*:|showAddAndDeleteConditionally|spaceBetweenNodesWhenAdding/
  const found = []
  for (const dir of ['imports', 'server', 'client']) {
    for (const file of await sources(join(appDir, dir))) {
      const text = await readFile(file, 'utf8')
      text.split('\n').forEach((line, i) => { if (retired.test(line) && !/^\s*(\/\/|\*)/.test(line)) found.push(`${file.slice(appDir.length)}:${i + 1}: ${line.trim()}`) })
    }
  }
  assert.deepEqual(found, [])
})

test('chat and exec can set what is kept: templateCategory and hiddenControls are update_nodes changes in the generated contract', async () => {
  const contract = await readFile(join(appDir, 'server/actions/generated/contract.json'), 'utf8')
  for (const key of ['"templateCategory"', '"hiddenControls"', '"locked"']) assert.ok(contract.includes(key), `contract should offer ${key}`)
  // Review M1: a bare "category" key invites "group these into categories" to make template buckets.
  assert.doesNotMatch(contract, /"category"\s*:/)
  const client = await readFile(join(appDir, 'server/actions/generated/slatebox.d.ts'), 'utf8')
  assert.match(client, /hiddenControls/)
  assert.match(client, /templateCategory/)
  assert.doesNotMatch(client, /\bcategory\??:/)
})

test('greenfield: no commented-out remains of the retired flags, and the collaboration examples do not document the retired package', async () => {
  const ai = await readFile(join(appDir, 'imports/api/common/ai.js'), 'utf8')
  assert.doesNotMatch(ai, /disableDrag/)
  // The collaboration examples were private notes and left the repository; any doc that lists
  // collaboration event types must still not document the retired package.
  const { spawnSync } = await import('node:child_process')
  const grep = spawnSync('git', ['grep', '-l', '-E', 'onNodeBehaviorChanged|behaviorChanges', '--', '*.md', '*.json'], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' })
  assert.equal(grep.status, 1, `documented in: ${grep.stdout}${grep.stderr}`)
})
