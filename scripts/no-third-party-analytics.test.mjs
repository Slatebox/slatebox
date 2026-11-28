// The app loads no third-party analytics (owner 2026-11-27: Google Analytics removed; 2026-11-28: Heap
// removed). The only counting is Cloud's own growth funnel (imports/api/common/growth.mjs), kept in Cloud's
// database. This test fails if a loader, a setting or a script address for either comes back.
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const app = join(root, 'web/app')
const SOURCE = /\.(?:m?js|jsx|ts|tsx|html|json)$/
const SKIP = new Set(['node_modules', '.meteor', 'public', 'package-lock.json'])

function files(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...files(path))
    else if (SOURCE.test(name)) out.push(path)
  }
  return out
}

const THIRD_PARTY = [
  /heapanalytics\.com/i,
  /\bheapIOKey\b/,
  /window\.heap\b/,
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /\bgtag\s*\(/,
]

test('no app source loads Heap or Google Analytics', () => {
  const found = []
  for (const dir of ['client', 'imports', 'server']) {
    for (const file of files(join(app, dir))) {
      const text = readFileSync(file, 'utf8')
      for (const pattern of THIRD_PARTY) if (pattern.test(text)) found.push(`${relative(root, file)}: ${pattern}`)
    }
  }
  assert.deepEqual(found, [])
})

test('the Heap loader is gone and the example settings carry no analytics keys', () => {
  assert.equal(existsSync(join(app, 'imports/ui/components/LoadHeap.jsx')), false)
  const settings = JSON.parse(readFileSync(join(app, 'settings.example.json'), 'utf8'))
  assert.equal('heapIOKey' in (settings.public ?? {}), false)
  assert.equal('analytics' in (settings.public ?? {}), false)
})
