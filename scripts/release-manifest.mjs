#!/usr/bin/env node
// Release manifests and the update feed for self-hosted Slatebox (docs/releasing.md, "Self-host
// updates"). Run by .github/workflows/selfhost-image.yml after an image is published, by
// update-feed-refresh.yml every day, and by the owner once for a key.
//
//   node scripts/release-manifest.mjs keygen --id slatebox-rel-2026-11 --out <dir>
//       a new Ed25519 pair: <dir>/<id>.pem (private, 0600: the GitHub "release" environment
//       secret SLATEBOX_RELEASE_KEY) and the public half to add to RELEASE_KEYS in
//       packages/slatebox/src/updater/verify.mjs (and its copy in web/app/server/updates/).
//   node scripts/release-manifest.mjs build --version 2.1.0 --index sha256:.. --platform linux/amd64=sha256:.. \
//       --platform linux/arm64=sha256:.. [--repository ghcr.io/slatebox/slatebox] [--commit <sha>] [--sources self-host/sources.json] \
//       [--notes-file notes.md] [--min-upgrade-from 2.0.0] [--downgrade-safe-to 2.0.3] [--major] [--released-at <iso>] --out release-manifest.json
//   node scripts/release-manifest.mjs sign <file>              writes <file>.sig (SLATEBOX_RELEASE_KEY, SLATEBOX_RELEASE_KEY_ID)
//   node scripts/release-manifest.mjs verify <file> [--keys <json file>]   checks <file>.sig
//   node scripts/release-manifest.mjs feed --base <releases/download URL> [--previous channels.json] \
//       [--stable 2.1.0 --stable-manifest <file>] [--preview 2.2.0-rc.1 --preview-manifest <file>] [--yank 2.0.4=reason] \
//       [--expires-days 30] --out channels.json
//   node scripts/release-manifest.mjs check-keys               the signing key id is in the production RELEASE_KEYS
import { createHash, generateKeyPairSync } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { canonicalJson, RELEASE_KEYS, signDocument, verifyDocument } from '../packages/slatebox/src/updater/verify.mjs'
import { checkManifest, PRODUCT } from '../packages/slatebox/src/updater/feed.mjs'
import { compareVersions, isPreview, parseVersion } from '../packages/slatebox/src/updater/policy.mjs'

export const DEFAULT_REPOSITORY = 'ghcr.io/slatebox/slatebox'
export const NOTES_MAX = 8 * 1024
const DIGEST = /^sha256:[a-f0-9]{64}$/

export class ReleaseError extends Error {}
const fail = message => { throw new ReleaseError(message) }

/** A release manifest (feed.mjs checkManifest reads it back). */
export function buildManifest({ version, repository = DEFAULT_REPOSITORY, index, platforms, commit = null, sources = null, notes = '', notesUrl, minUpgradeFrom = null, downgradeSafeTo = [], migrations = [], major = null, releasedAt = new Date().toISOString(), previousStable = null }) {
  const v = parseVersion(version)
  if (!v) fail(`--version ${version} is not X.Y.Z or X.Y.Z-pre`)
  if (!DIGEST.test(index || '')) fail('--index is the image index digest (sha256:...)')
  const plats = Object.fromEntries(Object.entries(platforms || {}).sort())
  if (Object.keys(plats).join(',') !== 'linux/amd64,linux/arm64') fail('--platform linux/amd64=... and linux/arm64=... are both needed (and no others)')
  for (const digest of Object.values(plats)) if (!DIGEST.test(digest)) fail(`${digest} is not a digest`)
  if (minUpgradeFrom && !parseVersion(minUpgradeFrom)) fail('--min-upgrade-from is a version')
  const trimmed = Buffer.byteLength(notes) > NOTES_MAX ? `${Buffer.from(notes).subarray(0, NOTES_MAX - 40).toString('utf8').replace(/�*$/, '')}\n\n(trimmed: see the release on GitHub)` : notes
  const manifest = {
    schema: 1, product: PRODUCT, version: v.text, channel: isPreview(v.text) ? 'preview' : 'stable', tag: `v${v.text}`,
    commit, sources, image: { repository, index, platforms: plats }, releasedAt,
    major: major ?? Boolean(previousStable && parseVersion(previousStable) && v.major > parseVersion(previousStable).major),
    minUpgradeFrom: minUpgradeFrom || null, updaterProtocol: 1, downgradeSafeTo, migrations,
    notesUrl: notesUrl || `https://github.com/Slatebox/slatebox/releases/tag/v${v.text}`, notes: trimmed,
  }
  return checkManifest(JSON.parse(canonicalJson(manifest)))
}

/** The next channel feed: sequence one higher, expiring in `expiresDays`, channels and withdrawals updated. */
export function buildFeed({ previous = null, base, stable = null, preview = null, yank = [], expiresDays = 30, now = Date.now() }) {
  if (!/^https?:\/\/\S+\/releases\/download$/.test(base || '') && !/^https?:\/\/\S+$/.test(base || '')) fail('--base is the releases/download address')
  const entry = item => (item ? { version: parseVersion(item.version).text, manifest: `${base}/v${parseVersion(item.version).text}/release-manifest.json`, sha256: item.sha256 } : null)
  const next = {
    schema: 1, sequence: (previous?.sequence || 0) + 1, generatedAt: new Date(now).toISOString(), expiresAt: new Date(now + expiresDays * 86_400_000).toISOString(),
    stable: entry(stable) || previous?.stable || null, preview: entry(preview) || previous?.preview || null,
    yanked: [...(previous?.yanked || [])],
  }
  for (const { version, reason } of yank) {
    if (!parseVersion(version)) fail(`--yank ${version}: not a version`)
    if (!next.yanked.some(item => compareVersions(item.version, version) === 0)) next.yanked.push({ version: parseVersion(version).text, reason: reason || 'withdrawn' })
  }
  // A preview older than the stable release offers nothing more.
  if (next.preview && next.stable && compareVersions(next.preview.version, next.stable.version) <= 0) next.preview = null
  if (!next.stable) delete next.stable
  if (!next.preview) delete next.preview
  return JSON.parse(canonicalJson(next))
}

export const sha256 = text => createHash('sha256').update(text).digest('hex')

function signingKey(env = process.env) {
  const pem = env.SLATEBOX_RELEASE_KEY
  const keyId = env.SLATEBOX_RELEASE_KEY_ID
  if (!pem || !keyId) fail('Set SLATEBOX_RELEASE_KEY (the private key, PEM) and SLATEBOX_RELEASE_KEY_ID.')
  return { privateKeyPem: pem, keyId }
}

export async function main(argv, { env = process.env, out = process.stdout } = {}) {
  const [command, ...rest] = argv
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true, strict: true,
    options: {
      id: { type: 'string' }, out: { type: 'string' }, version: { type: 'string' }, index: { type: 'string' }, platform: { type: 'string', multiple: true },
      repository: { type: 'string' }, commit: { type: 'string' }, sources: { type: 'string' }, 'notes-file': { type: 'string' },
      'min-upgrade-from': { type: 'string' }, 'downgrade-safe-to': { type: 'string', multiple: true }, major: { type: 'boolean' }, 'released-at': { type: 'string' },
      'previous-stable': { type: 'string' }, keys: { type: 'string' }, base: { type: 'string' }, previous: { type: 'string' },
      stable: { type: 'string' }, 'stable-manifest': { type: 'string' }, preview: { type: 'string' }, 'preview-manifest': { type: 'string' },
      yank: { type: 'string', multiple: true }, 'expires-days': { type: 'string' },
    },
  })
  const say = line => out.write(`${line}\n`)
  switch (command) {
    case 'keygen': {
      if (!values.id || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(values.id)) fail('--id is 3-64 lowercase letters, digits and hyphens (slatebox-rel-2026-11)')
      if (!values.out) fail('--out <dir> for the private key (keep it off the repository)')
      const { publicKey, privateKey } = generateKeyPairSync('ed25519')
      mkdirSync(values.out, { recursive: true, mode: 0o700 })
      const path = join(values.out, `${values.id}.pem`)
      if (existsSync(path)) fail(`${path} exists; a key is never overwritten`)
      writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
      chmodSync(path, 0o600)
      say(`Private key: ${path} (the GitHub environment "release" secret SLATEBOX_RELEASE_KEY; SLATEBOX_RELEASE_KEY_ID=${values.id})`)
      say(`Public half, for RELEASE_KEYS: '${values.id}': '${publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}',`)
      return 0
    }
    case 'build': {
      const platforms = Object.fromEntries((values.platform || []).map(item => item.split('=')))
      const sources = values.sources ? JSON.parse(readFileSync(values.sources, 'utf8')) : null
      const manifest = buildManifest({
        version: values.version, repository: values.repository || DEFAULT_REPOSITORY, index: values.index, platforms, commit: values.commit || null,
        sources: sources ? { engine: sources.engine?.commit || null, relay: sources.relay?.commit || null } : null,
        notes: values['notes-file'] ? readFileSync(values['notes-file'], 'utf8') : '', minUpgradeFrom: values['min-upgrade-from'] || null,
        downgradeSafeTo: values['downgrade-safe-to'] || [], major: values.major ? true : null, releasedAt: values['released-at'] || new Date().toISOString(),
        previousStable: values['previous-stable'] || null,
      })
      const text = canonicalJson(manifest)
      if (values.out) writeFileSync(values.out, text)
      else say(text)
      return 0
    }
    case 'sign': {
      const file = positionals[0] || fail('Name the file to sign.')
      const document = JSON.parse(readFileSync(file, 'utf8'))
      const text = readFileSync(file, 'utf8')
      if (text !== canonicalJson(document)) fail(`${file} is not canonical JSON (write it with this script)`)
      writeFileSync(`${file}.sig`, `${signDocument(document, signingKey(env))}\n`)
      say(`Signed ${file} -> ${file}.sig`)
      return 0
    }
    case 'verify': {
      const file = positionals[0] || fail('Name the file to verify.')
      const keys = values.keys ? JSON.parse(readFileSync(values.keys, 'utf8')) : RELEASE_KEYS
      const { keyId } = verifyDocument(readFileSync(file), readFileSync(`${file}.sig`, 'utf8'), { keys })
      say(`${file}: good signature (${keyId})`)
      return 0
    }
    case 'feed': {
      if (!values.out) fail('--out channels.json')
      const previous = values.previous && existsSync(values.previous) ? JSON.parse(readFileSync(values.previous, 'utf8')) : null
      const item = (version, file) => (version ? { version, sha256: sha256(readFileSync(file || fail(`--${isPreview(version) ? 'preview' : 'stable'}-manifest <file> for ${version}`))) } : null)
      const feed = buildFeed({
        previous, base: values.base, stable: item(values.stable, values['stable-manifest']), preview: item(values.preview, values['preview-manifest']),
        yank: (values.yank || []).map(spec => { const [version, ...reason] = spec.split('='); return { version, reason: reason.join('=') } }),
        expiresDays: Number(values['expires-days'] || 30),
      })
      writeFileSync(values.out, canonicalJson(feed))
      say(`Wrote ${values.out}: sequence ${feed.sequence}, stable ${feed.stable?.version || '-'}, preview ${feed.preview?.version || '-'}, expires ${feed.expiresAt}`)
      return 0
    }
    case 'check-keys': {
      const { keyId } = signingKey(env)
      if (!RELEASE_KEYS[keyId]) fail(`The signing key ${keyId} is not in RELEASE_KEYS (packages/slatebox/src/updater/verify.mjs): images would refuse what it signs.`)
      say(`${keyId} is a production release key.`)
      return 0
    }
    default:
      process.stderr.write('Usage: node scripts/release-manifest.mjs keygen | build | sign | verify | feed | check-keys (see the top of this file)\n')
      return 2
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(code => process.exit(code), error => {
    process.stderr.write(`${error instanceof ReleaseError ? error.message : error.stack}\n`)
    process.exit(1)
  })
}
