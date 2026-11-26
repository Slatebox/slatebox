// The signed update feed on GitHub, read and checked. Shared, byte for byte, by the installer (and
// so the host updater inside the image) and the app (web/app/server/updates/feed-core.mjs).
//
//   https://github.com/Slatebox/slatebox/releases/download/update-feed/channels.json  (+ .sig)
//   https://github.com/Slatebox/slatebox/releases/download/v<version>/release-manifest.json  (+ .sig)
//
// Reading release assets through github.com/.../releases/download is not the REST API, so it has
// no hourly limit, and nothing about the install is sent (GitHub sees an address, nothing else).
// The fetch is injected: the app passes its safe fetch (an allowlist of GitHub's hosts), the
// updater passes Node's. Every check here is on bytes that were signed.
import { createHash } from 'node:crypto'
import { verifyDocument, SignatureError } from './verify.mjs'
import { compareVersions, isMajorStep, offered, parseVersion } from './policy.mjs'

export const DEFAULT_FEED_URL = 'https://github.com/Slatebox/slatebox/releases/download/update-feed/channels.json'
export const FEED_HOSTS = Object.freeze(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'])
export const MAX_DOCUMENT_BYTES = 256 * 1024
export const PRODUCT = 'slatebox-selfhost'
export const MAX_CHAIN = 6
const DIGEST = /^sha256:[a-f0-9]{64}$/
const REPOSITORY = /^[a-z0-9.-]+(?::\d+)?(?:\/[a-z0-9._-]+)+$/

export class FeedError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/** Where a version's manifest is, next to the feed (the feed's folder is "update-feed"). */
export function manifestUrl(feedUrl, version) {
  const base = String(feedUrl).replace(/\/update-feed\/channels\.json$/, '')
  if (base === feedUrl) throw new FeedError('feed-url', 'The feed address must end in /update-feed/channels.json.')
  return `${base}/v${version}/release-manifest.json`
}

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

/**
 * The body of a fetch Response, read at most `max` bytes: a larger one is refused as it streams
 * (and by its Content-Length first), never downloaded whole before the size is checked.
 */
export async function readCapped(response, max = MAX_DOCUMENT_BYTES) {
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > max) throw new FeedError('too-large', `${response.url || 'The answer'} is larger than an update document may be.`)
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > max) throw new FeedError('too-large', `${response.url || 'The answer'} is larger than an update document may be.`)
    return bytes
  }
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) {
      await reader.cancel().catch(() => {})
      throw new FeedError('too-large', `${response.url || 'The answer'} is larger than an update document may be.`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/** A fetch that returns bytes or throws: { bytes } for 200. `get(url)` is the injected transport. */
async function fetchBytes(get, url) {
  let result
  try {
    result = await get(url)
  } catch (error) {
    if (error instanceof FeedError) throw error
    throw new FeedError('offline', `Could not reach ${new URL(url).host}: ${error?.message || error}`)
  }
  if (!result?.bytes) throw new FeedError('fetch', `${url} did not answer with a file.`)
  if (result.bytes.length > MAX_DOCUMENT_BYTES) throw new FeedError('too-large', `${url} is larger than an update document may be.`)
  return result.bytes
}

/** One signed document: the bytes, then its .sig, checked before the JSON is read. */
export async function fetchSigned(get, url, { keys } = {}) {
  const bytes = await fetchBytes(get, url)
  const sig = (await fetchBytes(get, `${url}.sig`)).toString('utf8')
  try {
    return { ...verifyDocument(bytes, sig, keys ? { keys } : undefined), bytes }
  } catch (error) {
    if (error instanceof SignatureError) throw new FeedError(`signature-${error.code}`, error.message)
    throw error
  }
}

/** A release manifest's shape, after its signature checked out. Throws FeedError('manifest'). */
export function checkManifest(manifest, { version } = {}) {
  const bad = why => { throw new FeedError('manifest', `The release manifest ${why}.`) }
  if (!manifest || typeof manifest !== 'object') bad('is empty')
  if (manifest.schema !== 1) bad('has a schema this Slatebox does not read')
  if (manifest.product !== PRODUCT) bad('is not for a self-hosted Slatebox')
  if (!parseVersion(manifest.version)) bad('has no version')
  if (version && compareVersions(manifest.version, version) !== 0) bad(`is for ${manifest.version}, not ${version}`)
  if (manifest.tag !== `v${manifest.version}`) bad('names another tag')
  if (!REPOSITORY.test(manifest.image?.repository || '')) bad('names no image repository')
  if (!DIGEST.test(manifest.image?.index || '')) bad('names no image digest')
  const platforms = manifest.image?.platforms || {}
  if (!Object.keys(platforms).length || Object.values(platforms).some(digest => !DIGEST.test(digest))) bad('names no image for each processor')
  if (manifest.minUpgradeFrom && !parseVersion(manifest.minUpgradeFrom)) bad('has an unreadable minUpgradeFrom')
  if (!Number.isFinite(Date.parse(manifest.releasedAt))) bad('has no release date')
  return manifest
}

/**
 * Read the feed and the manifests it names, all checked.
 * @returns {{ feed, manifests: {[version]: manifest}, expired: boolean, sequence: number }}
 */
export async function readFeed({ get, url = DEFAULT_FEED_URL, keys, lastSequence = 0, now = Date.now() }) {
  const { document: feed } = await fetchSigned(get, url, { keys })
  if (feed?.schema !== 1 || !Number.isInteger(feed.sequence)) throw new FeedError('feed', 'The update feed has a shape this Slatebox does not read.')
  // An older feed than one already seen: someone is replaying it to hold this server back.
  if (feed.sequence < lastSequence) throw new FeedError('replay', `The update feed is older than one already seen (${feed.sequence} < ${lastSequence}).`)
  const expired = !(Date.parse(feed.expiresAt) > now)
  const manifests = {}
  for (const channel of ['stable', 'preview']) {
    const entry = feed[channel]
    if (!entry?.version) continue
    if (!parseVersion(entry.version) || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')) throw new FeedError('feed', `The ${channel} entry of the update feed is incomplete.`)
    const where = entry.manifest || manifestUrl(url, entry.version)
    const { document, bytes } = await fetchSigned(get, where, { keys })
    if (sha256(bytes) !== entry.sha256) throw new FeedError('manifest-hash', `The ${entry.version} manifest is not the one the feed names.`)
    manifests[parseVersion(entry.version).text] = checkManifest(document, { version: entry.version })
  }
  return { feed, manifests, expired, sequence: feed.sequence }
}

/**
 * The versions to go through from `current` to the release, oldest first: one step, or more when
 * the release needs a newer starting point (minUpgradeFrom). `getManifest(version)` reads and
 * checks one manifest.
 */
export async function upgradeChain({ current, target, getManifest, manifests = {} }) {
  const chain = []
  let manifest = manifests[target] || await getManifest(target)
  for (let depth = 0; depth < MAX_CHAIN; depth++) {
    chain.unshift(manifest)
    const min = manifest.minUpgradeFrom
    if (!min || compareVersions(current, min) >= 0) return chain
    manifest = manifests[parseVersion(min).text] || await getManifest(parseVersion(min).text)
    if (compareVersions(manifest.version, current) <= 0) throw new FeedError('chain', `${target} needs ${min} first, and ${min} is not newer than ${current}.`)
  }
  throw new FeedError('chain', `Too many steps from ${current} to ${target}.`)
}

/**
 * The host's check of what the app asked for: the version must be one the signed data names (the
 * newest on the channel, or a step on the way there), newer, not withdrawn; a major release only
 * with an approval. Returns the manifest to apply now (the first step).
 */
export async function resolveTarget({ current, requested, channel = 'stable', feedResult, getManifest, approved = false }) {
  const { feed, manifests } = feedResult
  const release = offered(feed, channel)
  if (!release) throw new FeedError('no-release', 'The update feed offers no release.')
  if (!parseVersion(requested)) throw new FeedError('target', 'No version was asked for.')
  const yanked = version => (feed.yanked || []).some(item => compareVersions(item.version, version) === 0)
  const chain = await upgradeChain({ current, target: parseVersion(release.version).text, getManifest, manifests })
  const step = chain.find(manifest => compareVersions(manifest.version, requested) === 0)
  if (!step) throw new FeedError('not-signed', `${requested} is not a release the signed feed offers from ${current}.`)
  if (compareVersions(step.version, current) <= 0) throw new FeedError('downgrade', `${requested} is not newer than ${current}.`)
  // Every version on the way is checked, not only the one asked for: chain[0] is what is installed
  // now, and a release that needs a newer starting point must never go through a withdrawn one.
  const path = chain.slice(0, chain.indexOf(step) + 1)
  for (const manifest of path) {
    if (!yanked(manifest.version)) continue
    throw new FeedError('yanked', manifest === step ? `${requested} was withdrawn.` : `${requested} has to be reached through ${manifest.version}, which was withdrawn.`)
  }
  const major = path.some(manifest => manifest.major === true || isMajorStep(current, manifest.version))
  if (major && !approved) throw new FeedError('needs-approval', `${requested} is a major release and was not approved.`)
  return { manifest: chain[0], chain: path }
}

/** The image reference to pull: by the index digest, so the bytes are the signed ones. */
export const imageRefFor = manifest => `${manifest.image.repository}@${manifest.image.index}`
