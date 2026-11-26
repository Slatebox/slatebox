// Test releases for the updater: a test signing key (never a release key), signed manifests and a
// signed channel feed, served by an in-memory "GitHub" (a get(url) function).
import { createHash, generateKeyPairSync } from 'node:crypto'
import { canonicalJson, signDocument } from '../src/updater/verify.mjs'

export const FEED_URL = 'https://github.com/Slatebox/slatebox/releases/download/update-feed/channels.json'
export const REPO = 'localhost:5055/slatebox'

export function testKey(id = 'test-key-1') {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    id,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    spki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    get keys() { return { [id]: this.spki } },
  }
}

export const digest = tag => `sha256:${createHash('sha256').update(tag).digest('hex')}`

export function manifest(version, extra = {}) {
  return {
    schema: 1, product: 'slatebox-selfhost', version, channel: version.includes('-') ? 'preview' : 'stable', tag: `v${version}`,
    commit: 'a'.repeat(40), sources: { engine: 'b'.repeat(40), relay: 'c'.repeat(40) },
    image: { repository: REPO, index: digest(`index-${version}`), platforms: { 'linux/amd64': digest(`amd64-${version}`), 'linux/arm64': digest(`arm64-${version}`) } },
    releasedAt: '2026-11-01T00:00:00.000Z', major: false, minUpgradeFrom: '0.0.0', updaterProtocol: 1, downgradeSafeTo: [], migrations: [],
    notesUrl: `https://github.com/Slatebox/slatebox/releases/tag/v${version}`, notes: `## ${version}\n- better`, ...extra,
  }
}

/** A fake GitHub: files by URL; `release(version)` publishes a signed manifest; `publishFeed()` the signed feed. */
export class FakeGitHub {
  constructor(key = testKey(), { base = FEED_URL.replace(/\/update-feed\/channels\.json$/, '') } = {}) {
    this.key = key
    this.base = base
    this.files = new Map()
    this.requests = []
    this.sequence = 0
    this.offline = false
  }

  put(url, text) { this.files.set(url, Buffer.from(text)) }

  release(version, extra = {}) {
    const doc = manifest(version, extra)
    const text = canonicalJson(doc)
    const url = `${this.base}/v${version}/release-manifest.json`
    this.put(url, text)
    this.put(`${url}.sig`, signDocument(doc, { keyId: this.key.id, privateKeyPem: this.key.privateKeyPem }))
    return { doc, url, sha256: createHash('sha256').update(text).digest('hex') }
  }

  publishFeed({ stable, preview, yanked = [], expiresAt = '2099-01-01T00:00:00.000Z', sequence = ++this.sequence } = {}) {
    const entry = version => {
      const url = `${this.base}/v${version}/release-manifest.json`
      return { version, manifest: url, sha256: createHash('sha256').update(this.files.get(url)).digest('hex') }
    }
    const feed = { schema: 1, sequence, generatedAt: '2026-11-25T00:00:00.000Z', expiresAt, ...(stable ? { stable: entry(stable) } : {}), ...(preview ? { preview: entry(preview) } : {}), yanked }
    const url = `${this.base}/update-feed/channels.json`
    this.put(url, canonicalJson(feed))
    this.put(`${url}.sig`, signDocument(feed, { keyId: this.key.id, privateKeyPem: this.key.privateKeyPem }))
    return feed
  }

  get = async url => {
    this.requests.push(url)
    if (this.offline) throw new Error('getaddrinfo ENOTFOUND github.com')
    const bytes = this.files.get(url)
    if (!bytes) throw new Error(`github.com answered 404 for ${url}`)
    return { bytes }
  }
}
