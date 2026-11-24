// What the image is built from must be in the revision its label names (round-2 review finding 1):
// build-image.sh copies self-host/rootfs, build and licenses from disk, so a git-ignored file
// there (rootfs/opt/slatebox/lib/settings.mjs once was, by the repository's `settings*` rule)
// worked in a local build and was missing from a fresh checkout's image. Every file the image's
// own scripts import must be tracked, and the build refuses ignored files.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
const IMAGE_DIRS = ['self-host/Dockerfile', 'self-host/build', 'self-host/licenses', 'self-host/rootfs']

const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : [path]
})

test('no git-ignored file sits in what the image is built from', () => {
  const ignored = git('ls-files', '--others', '--ignored', '--exclude-standard', '--', ...IMAGE_DIRS).trim()
  assert.equal(ignored, '', `ignored files would reach the image without being committed:\n${ignored}`)
})

test('every relative import of the image\'s scripts is a tracked file', () => {
  const tracked = new Set(git('ls-files', '--', 'self-host/rootfs').split('\n').filter(Boolean))
  const scripts = walk(join(root, 'self-host/rootfs')).filter(p => /\.(mjs|js)$/.test(p))
  assert.ok(scripts.length > 0)
  const missing = []
  for (const file of scripts) {
    const source = readFileSync(file, 'utf8')
    for (const [, spec] of source.matchAll(/(?:^|\n)\s*import\s[^'"]*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = relative(root, resolve(dirname(file), spec))
      if (!existsSync(join(root, target)) || !tracked.has(target)) missing.push(`${relative(root, file)} -> ${target}`)
    }
  }
  assert.deepEqual(missing, [])
  assert.ok(tracked.has('self-host/rootfs/opt/slatebox/lib/settings.mjs'), 'the settings module configure.mjs and ai-config.mjs import is committed')
})

test('build-image.sh refuses git-ignored files under the image\'s own directories', () => {
  const script = readFileSync(join(root, 'self-host/build-image.sh'), 'utf8')
  assert.match(script, /ls-files --others --ignored --exclude-standard -- self-host\/Dockerfile self-host\/build self-host\/licenses self-host\/rootfs/)
})
