import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { readReleaseVersion } from './read-release-version.mjs'

test('ignores Unreleased sections and returns the newest semantic release', () => {
  const changelog = `# Changelog

## [Unreleased]

### Added

- A provider contract.

## [1.3.7] - 2026-07-15

### Changed

- A release.

## [1.3.6] - 2026-07-14
`
  assert.equal(readReleaseVersion(changelog), '1.3.7')
})

test('supports prerelease identifiers', () => {
  assert.equal(readReleaseVersion('## [2.0.0-rc.1]'), '2.0.0-rc.1')
})

test('rejects changelogs without a semantic release heading', () => {
  assert.throws(() => readReleaseVersion('## [Unreleased]'), /No semantic/)
})

test('reads the current application release', async () => {
  const changelog = await readFile(
    new URL('../CHANGELOG.md', import.meta.url),
    'utf8'
  )
  assert.equal(readReleaseVersion(changelog), '1.3.21')
})
