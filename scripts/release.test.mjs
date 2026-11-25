import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addGeneratedLine, runsLines, artifactForTag, compareSemver, curatedUnreleased, extractSection, generatedBody, nextVersion,
  sectionBody, tagPattern, ARTIFACTS, writeSection,
} from './release.mjs'

test('bumps follow SemVer, including prereleases', () => {
  assert.equal(nextVersion('0.2.3', 'patch'), '0.2.4')
  assert.equal(nextVersion('0.2.3', 'minor'), '0.3.0')
  assert.equal(nextVersion('0.2.3', 'major'), '1.0.0')
  assert.equal(nextVersion('2.0.0-rc.1', 'major'), '2.0.0')
  assert.equal(nextVersion('2.1.0-rc.1', 'minor'), '2.1.0')
  assert.equal(nextVersion('2.1.3-rc.1', 'patch'), '2.1.3')
  assert.equal(nextVersion('0.2.2', '2.0.0'), '2.0.0')
})

test('an explicit version must be above the current one', () => {
  assert.throws(() => nextVersion('0.2.3', '0.2.3'), /not above/)
  assert.throws(() => nextVersion('0.2.3', '0.1.9'), /not above/)
  assert.throws(() => nextVersion('0.2.3', 'huge'), /Bump must be/)
})

test('prereleases sort below their release', () => {
  assert.equal(compareSemver('2.0.0-rc.1', '2.0.0'), -1)
  assert.equal(compareSemver('2.0.0-rc.2', '2.0.0-rc.10'), -1)
  assert.equal(compareSemver('2.0.0-alpha', '2.0.0-alpha.1'), -1)
  assert.equal(compareSemver('1.3.21', '0.2.2'), 1)
})

test('tags map to their artifact; slatebox-mcp@ is never read as slatebox@', () => {
  assert.equal(artifactForTag('v2.0.0').name, 'app')
  assert.equal(artifactForTag('slatebox@0.2.4').name, 'slatebox')
  assert.deepEqual([artifactForTag('slatebox-mcp@0.4.2').name, artifactForTag('slatebox-mcp@0.4.2').version], ['slatebox-mcp', '0.4.2'])
  assert.throws(() => artifactForTag('v.release.12'), /Not a release tag/)
  assert.ok(!new RegExp(tagPattern(ARTIFACTS.slatebox)).test('slatebox-mcp@0.4.1'))
  assert.ok(new RegExp(tagPattern(ARTIFACTS.app)).test('v2.0.0'))
})

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- A hand-written note.

## [0.2.3] - 2026-11-25

### Fixed

- Older.

[Unreleased]: https://github.com/Slatebox/slatebox/compare/slatebox%400.2.3...HEAD
[0.2.3]: https://github.com/Slatebox/slatebox/compare/slatebox%400.2.2...slatebox%400.2.3
`

test('hand-written Unreleased notes become the highlights of the release', () => {
  assert.equal(curatedUnreleased(CHANGELOG), '### Added\n\n- A hand-written note.')
  const generated = generatedBody('## [0.2.4] - 2026-11-26\n\n### Fixed\n\n- **installer:** A fix ([abc12345](x))\n')
  const body = sectionBody(curatedUnreleased(CHANGELOG), generated)
  const out = writeSection(CHANGELOG, { version: '0.2.4', date: '2026-11-26', body, tag: 'slatebox@0.2.4', prevTag: 'slatebox@0.2.3' })
  assert.match(out, /## \[Unreleased\]\n\n## \[0\.2\.4\] - 2026-11-26\n\n### Highlights\n\n#### Added\n\n- A hand-written note\.\n\n### Fixed\n\n- \*\*installer:\*\* A fix/)
  assert.match(out, /^\[Unreleased\]: .*compare\/slatebox%400\.2\.4\.\.\.HEAD$/m)
  assert.match(out, /^\[0\.2\.4\]: .*compare\/slatebox%400\.2\.3\.\.\.slatebox%400\.2\.4$/m)
  assert.equal(curatedUnreleased(out), '')
  assert.equal(extractSection(out, '0.2.3'), '### Fixed\n\n- Older.')
  assert.match(extractSection(out, '0.2.4'), /^### Highlights/)
})

test('an empty Unreleased section takes the generated notes only', () => {
  const empty = CHANGELOG.replace('### Added\n\n- A hand-written note.\n\n', '')
  assert.equal(curatedUnreleased(empty), '')
  assert.equal(sectionBody('', '### Fixed\n\n- x'), '### Fixed\n\n- x')
  assert.match(sectionBody('', ''), /No user-facing changes/)
})

test('a package changelog edit alone is not a package change', () => {
  assert.ok(ARTIFACTS.slatebox.excludePaths.includes('packages/slatebox/CHANGELOG.md'))
  assert.ok(ARTIFACTS['slatebox-mcp'].excludePaths.includes('packages/slatebox-mcp/CHANGELOG.md'))
  for (const a of Object.values(ARTIFACTS)) {
    for (const p of a.excludePaths) assert.ok(!p.endsWith('/**') || !a.includePaths.includes(p), `${p} is both included and excluded`)
  }
})

test('a slatebox-mcp release moves the installer\'s exact pin; a slatebox release moves create-slatebox', () => {
  const [mcp] = ARTIFACTS['slatebox-mcp'].companions
  assert.deepEqual([mcp.file, mcp.pin, mcp.lockPath], ['packages/slatebox/package.json', ['dependencies', 'slatebox-mcp'], 'packages/slatebox'])
  assert.ok(!mcp.bumpPatch, 'the installer keeps its own version line')
  const [create] = ARTIFACTS.slatebox.companions
  assert.deepEqual([create.file, create.pin, create.bumpPatch], ['packages/create-slatebox/package.json', ['dependencies', 'slatebox'], true])
})

test('the release tooling is not part of the app\'s notes', () => {
  for (const p of ['cliff.toml', 'scripts/release.mjs', 'scripts/release.test.mjs']) assert.ok(ARTIFACTS.app.excludePaths.includes(p), p)
})

test('a moved slatebox-mcp pin is a line in the installer\'s notes', () => {
  const runs = ARTIFACTS.slatebox.runs
  assert.deepEqual(runs.map((r) => [r.name, r.file, r.pin]), [['slatebox-mcp', 'packages/slatebox/package.json', ['dependencies', 'slatebox-mcp']]])
  const lines = runsLines(runs, () => ({ before: '0.4.1', now: '0.4.2' }))
  assert.deepEqual(lines, ['- Runs slatebox-mcp [0.4.2](https://github.com/Slatebox/slatebox/releases/tag/slatebox-mcp%400.4.2) (was 0.4.1).'])
  assert.deepEqual(runsLines(runs, () => ({ before: '0.4.2', now: '0.4.2' })), [])
  // No other changes: the line replaces "No user-facing changes".
  const alone = addGeneratedLine('', 'Changed', lines[0])
  assert.equal(alone, `### Changed\n\n${lines[0]}`)
  assert.doesNotMatch(sectionBody('', alone), /No user-facing changes/)
  // Joins an existing Changed group, or takes its place in Keep a Changelog order.
  assert.equal(addGeneratedLine('### Changed\n\n- a', 'Changed', '- b'), '### Changed\n\n- b\n- a')
  assert.equal(addGeneratedLine('### Added\n\n- a\n\n### Fixed\n\n- f', 'Changed', '- b'), '### Added\n\n- a\n\n### Changed\n\n- b\n\n### Fixed\n\n- f')
  assert.equal(addGeneratedLine('### Added\n\n- a', 'Changed', '- b'), '### Added\n\n- a\n\n### Changed\n\n- b')
})
