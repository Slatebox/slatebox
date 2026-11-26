// Every test file is in a group, so something runs it (2026-11-26: 95 test files were in no package.json
// script; two of them had caught real regressions that nobody saw). The post-ship suite and CI run the
// groups, so a file in no group is a file that never runs.
//
// A *.test.mjs in scripts/ or self-host/tests/ must be named by a test:* script in the root or web/app
// package.json. A *.spec.mjs (Playwright, against a running app) runs through test:specs.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'

const read = path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'))
const groups = [read('package.json'), read('web/app/package.json')]
  .flatMap(pkg => Object.entries(pkg.scripts).filter(([name]) => name.startsWith('test')).map(([, command]) => command))
  .join('\n')

test('every scripts/*.test.mjs and self-host/tests/*.test.mjs is in a test group', () => {
  const missing = []
  for (const dir of ['scripts', 'self-host/tests'])
    for (const file of readdirSync(new URL('../' + dir, import.meta.url)).filter(name => name.endsWith('.test.mjs')))
      if (!groups.includes(dir + '/' + file)) missing.push(dir + '/' + file)
  assert.deepEqual(missing, [], 'add each to a test:* group in package.json (or a new group the post-ship suite runs)')
})

test('the browser specs run through test:specs', () => {
  assert.match(read('package.json').scripts['test:specs'], /playwright test -c scripts\/playwright\.config\.mjs/)
  const config = readFileSync(new URL('playwright.config.mjs', import.meta.url), 'utf8')
  assert.match(config, /testMatch: '\*\.spec\.mjs'/)
})
