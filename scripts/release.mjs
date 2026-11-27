#!/usr/bin/env node
// Cut a release of one artifact: bump its version, write its changelog section
// from Conventional Commits (git-cliff + cliff.toml), commit
// "chore(release): <tag>" and create an annotated tag. Nothing is pushed: the
// ship script pushes main and the tag together (`ship --release <artifact>:<bump>`),
// and .github/workflows/release.yml turns the pushed tag into a GitHub Release.
// See docs/releasing.md.
//
//   node scripts/release.mjs <artifact> <major|minor|patch|X.Y.Z[-pre]> [options]
//   node scripts/release.mjs notes <tag>          print the changelog section of a tag
//   node scripts/release.mjs current <artifact>   print the artifact's current version
//
// Options:
//   --dry-run            show the version, files and changelog section; change nothing
//   --since <ref>        start of the commit range when the artifact has no earlier tag
//   --date <YYYY-MM-DD>  release date (default: today, UTC)
//   --any-branch         allow a release from a branch other than main
//   --no-tag             commit only, no tag
//   --engine <sha>       app releases: the SlateboxJS commit the ship's engine build used
//   --relay <sha>        app releases: the relay (y-websocket) commit
//   --engine-dir <dir>   the SlateboxJS checkout to check --engine against (default ../slateboxjs-v2)
//   --relay-dir <dir>    the relay checkout (default ../y-websocket)
//
// An app release writes self-host/sources.json (the engine and relay commits) into its
// chore(release) commit, so the tag alone says what the self-host image is built from
// (.github/workflows/selfhost-image.yml). Each commit must be on its repository's main.
//
// The last line printed on success is RELEASE_TAG=<tag> (the ship script reads it).

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REPO_URL = 'https://github.com/Slatebox/slatebox'
export const SOURCES_FILE = 'self-host/sources.json'
export const SOURCE_REPOS = Object.freeze({ engine: 'https://github.com/Slatebox/slateboxjs', relay: 'https://github.com/Slatebox/y-websocket' })
const FULL_SHA = /^[0-9a-f]{40}$/
const GIT_CLIFF_VERSION = '2.14.2'

export const ARTIFACTS = {
  app: {
    title: 'Slatebox',
    tagPrefix: 'v',
    changelog: 'CHANGELOG.md',
    // web/app/imports/ui/common/release.json gives the app its own version (What's new in Help and support).
    versionFiles: [{ file: 'package.json', keys: [['version']] }, { file: 'web/app/imports/ui/common/release.json', keys: [['version']] }],
    lockKeys: [['version'], ['packages', '', 'version']],
    // The app is everything except the separately versioned npm packages. The root
    // package-lock.json only moves with those packages' versions and dependencies. The
    // release tooling itself is not part of what people run (cliff.toml also skips any
    // commit scoped `release`).
    excludePaths: ['packages/slatebox/**', 'packages/slatebox-mcp/**', 'packages/create-slatebox/**', 'package-lock.json',
      'cliff.toml', 'scripts/release.mjs', 'scripts/release.test.mjs', 'docs/releasing.md'],
    includePaths: [],
    latest: true,
  },
  slatebox: {
    title: 'slatebox (installer and CLI)',
    tagPrefix: 'slatebox@',
    changelog: 'packages/slatebox/CHANGELOG.md',
    versionFiles: [{ file: 'packages/slatebox/package.json', keys: [['version']] }],
    lockKeys: [['packages', 'packages/slatebox', 'version']],
    includePaths: ['packages/slatebox/**', 'packages/create-slatebox/**'],
    // A commit that only edits the changelog (an [Unreleased] note) is not a package change.
    excludePaths: ['packages/slatebox/CHANGELOG.md'],
    // create-slatebox follows slatebox: its pin moves to the new version and its
    // own patch version goes up (it is not published to npm yet).
    companions: [{ file: 'packages/create-slatebox/package.json', pin: ['dependencies', 'slatebox'], bumpPatch: true,
      lockPath: 'packages/create-slatebox' }],
    // The installer runs one exact slatebox-mcp. That pin moves in the slatebox-mcp release's
    // chore(release) commit, which git-cliff skips, so the notes get a line for it instead.
    runs: [{ name: 'slatebox-mcp', file: 'packages/slatebox/package.json', pin: ['dependencies', 'slatebox-mcp'],
      tagPrefix: 'slatebox-mcp@' }],
    latest: false,
  },
  'slatebox-mcp': {
    title: 'slatebox-mcp (MCP server)',
    tagPrefix: 'slatebox-mcp@',
    changelog: 'packages/slatebox-mcp/CHANGELOG.md',
    versionFiles: [
      { file: 'packages/slatebox-mcp/package.json', keys: [['version']] },
      // The MCP registry entry carries the version twice.
      { file: 'packages/slatebox-mcp/server.json', keys: [['version'], ['packages', 0, 'version']] },
    ],
    lockKeys: [['packages', 'packages/slatebox-mcp', 'version']],
    includePaths: ['packages/slatebox-mcp/**'],
    excludePaths: ['packages/slatebox-mcp/CHANGELOG.md'],
    // The installer runs one exact slatebox-mcp (packages/slatebox/test/publish-pin.test.mjs), so its
    // pin and lock entry move with every slatebox-mcp release. The installer's own version does
    // not: `npx slatebox mcp` serves the new MCP server once slatebox is released too
    // (`--release slatebox-mcp:<bump> --release slatebox:patch` in one ship; the ship runs
    // slatebox-mcp first whatever the order typed, so the slatebox tag carries the new pin;
    // docs/releasing.md).
    companions: [{ file: 'packages/slatebox/package.json', pin: ['dependencies', 'slatebox-mcp'], lockPath: 'packages/slatebox' }],
    latest: false,
  },
}

// ---- versions -----------------------------------------------------------------

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

export function parseSemver(v) {
  const m = SEMVER.exec(v)
  if (!m) throw new Error(`Not a semantic version: ${v}`)
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] }
}

export function compareSemver(a, b) {
  const x = parseSemver(a), y = parseSemver(b)
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q)
    if (pn && qn && +p !== +q) return +p < +q ? -1 : 1
    if (pn !== qn) return pn ? -1 : 1
    if (p !== q) return p < q ? -1 : 1
  }
  return 0
}

export function nextVersion(current, spec) {
  if (SEMVER.test(spec)) {
    if (compareSemver(spec, current) <= 0) throw new Error(`${spec} is not above the current version ${current}`)
    return spec
  }
  const v = parseSemver(current)
  const released = !v.pre.length
  switch (spec) {
    case 'major': return v.minor === 0 && v.patch === 0 && !released ? `${v.major}.0.0` : `${v.major + 1}.0.0`
    case 'minor': return v.patch === 0 && !released ? `${v.major}.${v.minor}.0` : `${v.major}.${v.minor + 1}.0`
    case 'patch': return released ? `${v.major}.${v.minor}.${v.patch + 1}` : `${v.major}.${v.minor}.${v.patch}`
    default: throw new Error(`Bump must be major, minor, patch or a version like 1.2.3, not "${spec}"`)
  }
}

export function artifactForTag(tag) {
  // Longest prefix first, so slatebox-mcp@ is not read as slatebox@.
  const entries = Object.entries(ARTIFACTS).sort((a, b) => b[1].tagPrefix.length - a[1].tagPrefix.length)
  for (const [name, a] of entries) {
    if (tag.startsWith(a.tagPrefix) && SEMVER.test(tag.slice(a.tagPrefix.length))) {
      return { name, artifact: a, version: tag.slice(a.tagPrefix.length) }
    }
  }
  throw new Error(`Not a release tag: ${tag} (expected vX.Y.Z, slatebox@X.Y.Z or slatebox-mcp@X.Y.Z)`)
}

// ---- changelog text -------------------------------------------------------------

const UNRELEASED = /^## \[Unreleased\][^\n]*\n/m

/** The hand-written text under "## [Unreleased]", up to the next "## " heading. */
export function curatedUnreleased(changelog) {
  const m = UNRELEASED.exec(changelog)
  if (!m) return ''
  const rest = changelog.slice(m.index + m[0].length)
  const end = rest.search(/^## |^\[[^\]]+\]: /m)
  return (end === -1 ? rest : rest.slice(0, end)).trim()
}

/** Drop git-cliff's own "## [x] - date" heading; keep the groups. */
export function generatedBody(cliffOutput) {
  return cliffOutput.replace(/^\s*## \[[^\]]*\][^\n]*\n/, '').trim()
}

const GROUP_ORDER = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']

/** Add one line to a generated group ("### Changed"), making the group in Keep a Changelog order if needed. */
export function addGeneratedLine(generated, group, line) {
  const groups = generated.trim() ? generated.trim().split(/\n(?=### )/) : []
  const i = groups.findIndex((g) => g.startsWith(`### ${group}\n`))
  if (i !== -1) {
    groups[i] = groups[i].replace(/^(### [^\n]*\n\n)/, `$1${line}\n`)
  } else {
    const rank = (g) => { const r = GROUP_ORDER.indexOf(g.slice(4).split('\n')[0].trim()); return r === -1 ? GROUP_ORDER.length : r }
    const at = groups.findIndex((g) => rank(g) > GROUP_ORDER.indexOf(group))
    groups.splice(at === -1 ? groups.length : at, 0, `### ${group}\n\n${line}`)
  }
  return groups.map((g) => g.trim()).join('\n\n')
}

/** Lines for pinned artifacts whose pin moved since `from` ("Runs slatebox-mcp 0.4.2"). */
export function runsLines(runs, pinAt) {
  const lines = []
  for (const r of runs || []) {
    const { before, now } = pinAt(r)
    if (!now || before === now) continue
    const link = `${REPO_URL}/releases/tag/${encodeURIComponent(r.tagPrefix + now)}`
    lines.push(`- Runs ${r.name} [${now}](${link})${before ? ` (was ${before})` : ''}.`)
  }
  return lines
}

/**
 * Every minor or major app release carries hand-written Highlights (owner rule, 2026-11-26): they are what
 * slatebox.com/changelog and the app's What's new show. A missing one is a reminder, never a failure, so it never
 * stops a ship. Returns the reminder to print, or '' when none is due.
 */
export function highlightsReminder({ name, current, version, curated }) {
  if (name !== 'app' || curated) return ''
  const from = parseSemver(current), to = parseSemver(version)
  if (to.pre.length || (from.major === to.major && from.minor === to.minor)) return ''
  return `reminder: ${version} is a ${from.major === to.major ? 'minor' : 'major'} release with no Highlights. ` +
    'Write a few plain sentences under ## [Unreleased] in CHANGELOG.md for slatebox.com/changelog and What\'s new ' +
    '(see docs/releasing.md). Releasing anyway: this is a reminder, not a stop.'
}

export function sectionBody(curated, generated) {
  const parts = []
  if (curated) parts.push('### Highlights\n\n' + curated.replace(/^### /gm, '#### '))
  if (generated) parts.push(generated)
  if (!parts.length) parts.push('No user-facing changes are recorded in Conventional Commits for this release.')
  return parts.join('\n\n')
}

function compareUrl(prevTag, tag) {
  const e = encodeURIComponent
  return prevTag ? `${REPO_URL}/compare/${e(prevTag)}...${e(tag)}` : `${REPO_URL}/releases/tag/${e(tag)}`
}

/** Replace the Unreleased block with an empty Unreleased plus the new section; keep link references current. */
export function writeSection(changelog, { version, date, body, tag, prevTag }) {
  const heading = `## [${version}] - ${date}`
  const section = `## [Unreleased]\n\n${heading}\n\n${body}\n\n`
  let out
  const m = UNRELEASED.exec(changelog)
  if (m) {
    const rest = changelog.slice(m.index + m[0].length)
    const end = rest.search(/^## |^\[[^\]]+\]: /m)
    out = changelog.slice(0, m.index) + section + (end === -1 ? '' : rest.slice(end))
  } else {
    const first = changelog.search(/^## /m)
    out = first === -1 ? changelog.trimEnd() + '\n\n' + section : changelog.slice(0, first) + section + changelog.slice(first)
  }
  const unreleasedRef = `[Unreleased]: ${REPO_URL}/compare/${encodeURIComponent(tag)}...HEAD`
  const versionRef = `[${version}]: ${compareUrl(prevTag, tag)}`
  if (/^\[Unreleased\]: .*$/m.test(out)) {
    out = out.replace(/^\[Unreleased\]: .*$/m, `${unreleasedRef}\n${versionRef}`)
  } else {
    out = out.trimEnd() + `\n\n${unreleasedRef}\n${versionRef}\n`
  }
  return out.replace(/\n{3,}/g, '\n\n')
}

/** The body of "## [version]" in a changelog (used for the GitHub Release text). */
export function extractSection(changelog, version) {
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`^## \\[${esc}\\][^\\n]*\\n`, 'm').exec(changelog)
  if (!m) throw new Error(`No "## [${version}]" section in the changelog`)
  const rest = changelog.slice(m.index + m[0].length)
  const end = rest.search(/^## |^\[[^\]]+\]: /m)
  return (end === -1 ? rest : rest.slice(0, end)).trim()
}

// ---- JSON version files ----------------------------------------------------------

function getIn(obj, keys) { return keys.reduce((o, k) => (o == null ? undefined : o[k]), obj) }
function setIn(obj, keys, value) {
  const parent = getIn(obj, keys.slice(0, -1))
  if (parent == null || !(keys.at(-1) in parent)) return false
  parent[keys.at(-1)] = value
  return true
}
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'))
const jsonText = (o) => JSON.stringify(o, null, 2) + '\n'

// ---- git and git-cliff -----------------------------------------------------------

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
}

function previousTag(artifact) {
  const r = spawnSync('git', ['describe', '--tags', '--abbrev=0', '--match', `${artifact.tagPrefix}[0-9]*`, 'HEAD'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

function cliffCommand() {
  if (process.env.GIT_CLIFF) return [process.env.GIT_CLIFF, []]
  if (spawnSync('git-cliff', ['--version'], { stdio: 'ignore' }).status === 0) return ['git-cliff', []]
  return ['npx', ['--yes', `git-cliff@${GIT_CLIFF_VERSION}`]]
}

export function tagPattern(artifact) {
  return '^' + artifact.tagPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[0-9]+\\.[0-9]+\\.[0-9]+'
}

function runCliff(artifact, tag, range) {
  const [cmd, pre] = cliffCommand()
  const args = [...pre, '--config', 'cliff.toml', '--tag-pattern', tagPattern(artifact), '--unreleased', '--tag', tag, '--strip', 'all']
  for (const p of artifact.includePaths) args.push('--include-path', p)
  for (const p of artifact.excludePaths) args.push('--exclude-path', p)
  args.push(range)
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  if (r.status !== 0) throw new Error(`git-cliff failed:\n${r.stderr}`)
  return r.stdout
}

// ---- release ------------------------------------------------------------------------

/** self-host/sources.json: the engine and relay commits an app release's image is built from. */
export function sourcesText({ engine, relay }) {
  for (const [name, sha] of Object.entries({ engine, relay })) {
    if (!FULL_SHA.test(sha || '')) throw new Error(`An app release needs --${name} <full 40-character commit> (the ship script passes the commits its engine build used)`)
  }
  return `${JSON.stringify({ engine: { repo: SOURCE_REPOS.engine, commit: engine }, relay: { repo: SOURCE_REPOS.relay, commit: relay } }, null, 2)}\n`
}

/** Each pinned commit must be on its repository's default branch (main for the engine, master for the relay; a checkout to ask: --engine-dir / --relay-dir). */
export function checkSourceCommits({ engine, relay, engineDir, relayDir, run = (dir, args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }) }) {
  for (const [name, sha, dir] of [['engine', engine, engineDir], ['relay', relay, relayDir]]) {
    if (!existsSync(dir)) throw new Error(`--${name}-dir ${dir} is not a checkout; the ${name} commit cannot be checked`)
    // The remote's default branch (HEAD): main for SlateboxJS, master for the relay.
    run(dir, ['fetch', '--quiet', 'origin', 'HEAD'])
    const onMain = ['FETCH_HEAD', 'origin/HEAD', 'origin/main', 'origin/master', 'main', 'master'].some((ref) => run(dir, ['merge-base', '--is-ancestor', sha, ref]).status === 0)
    if (!onMain) throw new Error(`The ${name} commit ${sha} is not on the default branch of ${dir}`)
  }
}

function parseArgs(argv) {
  const opts = { dryRun: false, since: '', date: new Date().toISOString().slice(0, 10), anyBranch: false, tag: true, positional: [], engine: '', relay: '', engineDir: '../slateboxjs-v2', relayDir: '../y-websocket' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') opts.dryRun = true
    else if (a === '--since') opts.since = argv[++i]
    else if (a === '--date') opts.date = argv[++i]
    else if (a === '--any-branch') opts.anyBranch = true
    else if (a === '--no-tag') opts.tag = false
    else if (a === '--engine') opts.engine = argv[++i]
    else if (a === '--relay') opts.relay = argv[++i]
    else if (a === '--engine-dir') opts.engineDir = argv[++i]
    else if (a === '--relay-dir') opts.relayDir = argv[++i]
    else if (a === '-h' || a === '--help') opts.help = true
    else if (a.startsWith('-')) throw new Error(`Unknown option ${a}`)
    else opts.positional.push(a)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) throw new Error('--date must be YYYY-MM-DD')
  return opts
}

function currentVersion(artifact) {
  const v = getIn(readJson(artifact.versionFiles[0].file), artifact.versionFiles[0].keys[0])
  if (!v) throw new Error(`${artifact.versionFiles[0].file} has no version`)
  return v
}

function release(name, spec, opts) {
  const artifact = ARTIFACTS[name]
  if (!artifact) throw new Error(`Unknown artifact "${name}" (app, slatebox or slatebox-mcp)`)
  if (!existsSync('cliff.toml')) throw new Error('Run from the repository root (cliff.toml not found)')

  if (!opts.dryRun) {
    const dirty = git(['status', '--porcelain', '--untracked-files=no'])
    if (dirty) throw new Error(`The tree has uncommitted changes:\n${dirty}`)
    const branch = git(['branch', '--show-current'])
    if (branch !== 'main' && !opts.anyBranch) throw new Error(`Releases are cut on main (this is "${branch || 'detached HEAD'}"); --any-branch overrides`)
  }

  const current = currentVersion(artifact)
  const version = nextVersion(current, spec)
  const tag = artifact.tagPrefix + version
  if (spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]).status === 0) throw new Error(`Tag ${tag} already exists`)

  const prevTag = previousTag(artifact)
  const from = opts.since || prevTag
  if (!from) throw new Error(`No earlier ${artifact.tagPrefix}* tag is reachable from HEAD; pass --since <ref> (or run the tag backfill first)`)
  const range = `${from}..HEAD`

  let generated = generatedBody(runCliff(artifact, tag, range))
  const pinAt = (r) => {
    const shown = spawnSync('git', ['show', `${from}:${r.file}`], { encoding: 'utf8' })
    const before = shown.status === 0 ? getIn(JSON.parse(shown.stdout), r.pin) : undefined
    return { before, now: getIn(readJson(r.file), r.pin) }
  }
  for (const line of runsLines(artifact.runs, pinAt)) generated = addGeneratedLine(generated, 'Changed', line)
  const changelogPath = artifact.changelog
  const before = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '# Changelog\n\n## [Unreleased]\n'
  const curated = curatedUnreleased(before)
  const reminder = highlightsReminder({ name, current, version, curated })
  if (reminder) console.warn(reminder)
  const body = sectionBody(curated, generated)
  const after = writeSection(before, { version, date: opts.date, body, tag, prevTag: prevTag || '' })

  // Version files, lock file and companions.
  const writes = new Map([[changelogPath, after]])
  if (name === 'app') {
    writes.set(SOURCES_FILE, sourcesText({ engine: opts.engine, relay: opts.relay }))
    if (!opts.dryRun) checkSourceCommits({ engine: opts.engine, relay: opts.relay, engineDir: opts.engineDir, relayDir: opts.relayDir })
  }
  for (const vf of artifact.versionFiles) {
    const json = readJson(vf.file)
    for (const keys of vf.keys) if (!setIn(json, keys, version)) throw new Error(`${vf.file}: no ${keys.join('.')} to update`)
    writes.set(vf.file, jsonText(json))
  }
  const lock = existsSync('package-lock.json') ? readJson('package-lock.json') : null
  if (lock) for (const keys of artifact.lockKeys) setIn(lock, keys, version)
  for (const c of artifact.companions || []) {
    const json = readJson(c.file)
    if (!setIn(json, c.pin, version)) throw new Error(`${c.file}: no ${c.pin.join('.')} to update`)
    if (c.bumpPatch) {
      json.version = nextVersion(json.version, 'patch')
      if (lock) setIn(lock, ['packages', c.lockPath, 'version'], json.version)
    }
    if (lock && getIn(lock, ['packages', c.lockPath, ...c.pin]) !== undefined) setIn(lock, ['packages', c.lockPath, ...c.pin], version)
    writes.set(c.file, jsonText(json))
  }
  if (lock) writes.set('package-lock.json', jsonText(lock))

  console.log(`${artifact.title}: ${current} -> ${version} (tag ${tag}, commits ${range})`)
  console.log(`files: ${[...writes.keys()].join(', ')}`)
  if (opts.dryRun) {
    console.log(`\n--- ${changelogPath}: new section ---\n## [${version}] - ${opts.date}\n\n${body}\n--- end ---`)
    console.log('dry run: nothing written, committed or tagged')
    return
  }

  for (const [file, text] of writes) writeFileSync(file, text)
  git(['add', '--', ...writes.keys()])
  git(['commit', '--quiet', '-m', `chore(release): ${tag}`, '-m', `${artifact.title} ${version}. Notes: ${changelogPath}.`])
  if (opts.tag) {
    const dir = mkdtempSync(path.join(tmpdir(), 'slatebox-release-'))
    try {
      const msgFile = path.join(dir, 'TAG_MSG')
      writeFileSync(msgFile, `${artifact.title} ${version}\n\n${extractSection(after, version)}\n`)
      git(['tag', '--annotate', '--cleanup=verbatim', '--file', msgFile, tag])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  console.log(`committed chore(release): ${tag}${opts.tag ? ' and tagged it' : ''}; nothing pushed`)
  console.log(`RELEASE_TAG=${tag}`)
}

function usage() {
  return readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 20).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')
}

if (process.argv[1] === import.meta.filename) {
  try {
    const opts = parseArgs(process.argv.slice(2))
    const [cmd, arg] = opts.positional
    if (opts.help || !cmd) console.log(usage())
    else if (cmd === 'notes') {
      if (!arg) throw new Error('usage: release.mjs notes <tag>')
      const { artifact, version } = artifactForTag(arg)
      console.log(extractSection(readFileSync(artifact.changelog, 'utf8'), version))
    } else if (cmd === 'current') {
      if (!ARTIFACTS[arg]) throw new Error('usage: release.mjs current <app|slatebox|slatebox-mcp>')
      console.log(currentVersion(ARTIFACTS[arg]))
    } else {
      if (!arg) throw new Error('usage: release.mjs <artifact> <major|minor|patch|X.Y.Z>')
      release(cmd, arg, opts)
    }
  } catch (err) {
    console.error(`release: ${err.message}`)
    process.exit(1)
  }
}
