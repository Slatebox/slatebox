// The huddle client is a daily-js release Daily still supports, the React bindings accept it, and
// the app creates its call object without options the new client deprecates.
// Daily warns (and later refuses) clients older than its support window: 0.72.2 was refused in
// November 2026 with "daily-js version 0.72.2 is no longer supported".
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const app = new URL('../web/app/', import.meta.url)
const json = async path => JSON.parse(await readFile(new URL(path, app), 'utf8'))
const source = path => readFile(new URL(path, app), 'utf8')
const parse = version => version.replace(/^[^\d]*/, '').split('.').map(Number)
const atLeast = (version, floor) => {
  const [a, b] = [parse(version), parse(floor)]
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return true
}
// The release the app was upgraded to (daily-js 0.95.0, 7 November 2026). Raise it with each upgrade.
const SUPPORTED_FLOOR = '0.95.0'

test('the app depends on a daily-js release inside Daily’s support window', async () => {
  const manifest = await json('package.json')
  const lock = await json('package-lock.json')
  const wanted = manifest.dependencies['@daily-co/daily-js']
  const locked = lock.packages['node_modules/@daily-co/daily-js']?.version
  assert.ok(locked, 'daily-js is in the lock file')
  assert.ok(atLeast(parse(wanted).join('.'), SUPPORTED_FLOOR), `package.json asks for ${wanted}`)
  assert.ok(atLeast(locked, SUPPORTED_FLOOR), `the lock file installs ${locked}`)
})

test('the React bindings are a release that accepts that daily-js', async () => {
  const lock = await json('package-lock.json')
  const react = lock.packages['node_modules/@daily-co/daily-react']
  const locked = lock.packages['node_modules/@daily-co/daily-js'].version
  assert.ok(atLeast(react.version, '0.26.1'), `daily-react ${react.version}`)
  const range = react.peerDependencies['@daily-co/daily-js']
  const [, low, high] = /^>=\s*([\d.]+)\s*<\s*([\d.]+)$/.exec(range) ?? []
  assert.ok(low && atLeast(locked, low) && !atLeast(locked, high), `daily-react accepts ${range}; installed ${locked}`)
  assert.equal(lock.packages['node_modules/@daily-co/daily-react/node_modules/@daily-co/daily-js'], undefined, 'one daily-js in the bundle')
})

test('the call object is made without options the client deprecates, once per page', async () => {
  const appSource = await source('imports/ui/App.jsx')
  assert.match(appSource, /DailyIframe\.getCallInstance\(\)/)
  assert.match(appSource, /DailyIframe\.createCallObject\(/)
  // "All calls use v2CamAndMic": the option is deprecated and will be removed.
  assert.doesNotMatch(appSource, /v2CamAndMic|dailyConfig/)
})

test('nothing but the page’s one call object imports daily-js', async () => {
  const { readdir } = await import('node:fs/promises')
  const files = []
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
      if (entry.isDirectory()) await walk(path)
      else if (/\.(m?js|jsx)$/.test(entry.name)) files.push(path)
    }
  }
  await walk(new URL('imports/', app))
  await walk(new URL('server/', app))
  const importing = []
  for (const file of files) if (/from '@daily-co\/daily-js'/.test(await readFile(file, 'utf8'))) importing.push(file.pathname.split('/web/app/')[1])
  assert.deepEqual(importing, ['imports/ui/App.jsx'])
})
