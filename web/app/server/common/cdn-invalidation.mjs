// Removed files leave the CDN in front of the file store (Slatebox Cloud's files.slatebox.com is a
// CloudFront distribution over the image bucket): a copy it cached is served until it expires. Two
// things bound that:
//   - every file the app stores in the bucket is sent with UPLOAD_CACHE_CONTROL (s3Utils.js), so no
//     cached copy outlives a day, whatever the CDN or a browser would otherwise guess;
//   - the upload-removal queue (upload-removal.mjs) asks the CDN to drop the files it removed, with
//     one CloudFront invalidation per batch of paths, when the settings name the distribution
//     (aws.cloudFrontDistributionId; the IAM user of aws.accessKey needs cloudfront:CreateInvalidation).
// Without a distribution (a self-host, a bucket served directly) nothing is asked and nothing changes.
// A failed invalidation is logged and not retried: the file is already gone from the bucket, and
// the cached copy expires within the day.
//
// MIT, runs without Meteor (scripts/upload-removal.test.mjs). The Meteor glue is upload-removal.js.
import { randomBytes } from 'node:crypto'

/** How long a stored file may be cached, by the CDN or a browser. */
export const UPLOAD_CACHE_CONTROL = 'public, max-age=86400'

/** The most paths one invalidation names (CloudFront takes up to 3000 file paths in progress at a time). */
export const PATHS_PER_INVALIDATION = 1000

// A distribution id: capital letters and digits (E2ABC3DEF4GHIJ).
const DISTRIBUTION = /^[A-Z0-9]{8,32}$/

/** The distribution id the settings name, or null (no CDN to tell). */
export function cdnDistributionOf(settings) {
  const id = settings?.aws?.cloudFrontDistributionId
  return typeof id === 'string' && DISTRIBUTION.test(id.trim()) ? id.trim() : null
}

/**
 * The path a stored file's key is served at on the CDN: the file store's address (aws.cloudUrl)
 * may carry a path of its own (https://cdn.example/files), which comes first.
 */
export function cdnPathOf(key, cloudUrl) {
  let base = ''
  try {
    base = new URL(String(cloudUrl)).pathname.replace(/\/+$/, '')
  } catch {
    base = ''
  }
  // Keys are plain names (fileStore.js isStoredFileKey); each part is encoded all the same.
  return `${base}/${String(key).split('/').map(encodeURIComponent).join('/')}`
}

/**
 * @param {object} deps
 * @param deps.distributionId  the CloudFront distribution, or null for none
 * @param deps.cloudUrl        the file store's address (aws.cloudUrl)
 * @param deps.send            ({ DistributionId, InvalidationBatch }) -> the CreateInvalidation answer
 * @param deps.now             the clock, for each request's CallerReference
 * @param deps.log             (message, details): details never hold a key or a path
 */
export function createCdnInvalidator({ distributionId, cloudUrl, send, now = Date.now, log = () => {}, perRequest = PATHS_PER_INVALIDATION }) {
  // CloudFront takes each CallerReference once: the time, this server's own id and a count keep
  // two servers' requests in the same millisecond apart.
  const server = randomBytes(4).toString('hex')
  let sent = 0
  /** Ask the CDN to drop these removed files. Never throws. Returns how many paths were asked for. */
  async function invalidate(keys) {
    if (!distributionId || typeof send !== 'function') return 0
    const paths = [...new Set([...(keys || [])].filter((key) => typeof key === 'string' && key).map((key) => cdnPathOf(key, cloudUrl)))]
    let asked = 0
    for (let at = 0; at < paths.length; at += perRequest) {
      const Items = paths.slice(at, at + perRequest)
      sent += 1
      try {
        // one request at a time: CloudFront limits the invalidations in progress
        // eslint-disable-next-line no-await-in-loop
        await send({
          DistributionId: distributionId,
          InvalidationBatch: { CallerReference: `slatebox-removal-${now()}-${server}-${sent}`, Paths: { Quantity: Items.length, Items } },
        })
        asked += Items.length
      } catch (error) {
        log('CDN invalidation failed; the cached copies expire within a day', {
          paths: Items.length,
          name: typeof error?.name === 'string' ? error.name.slice(0, 60) : 'Error',
          ...(Number.isInteger(error?.$metadata?.httpStatusCode) && { status: error.$metadata.httpStatusCode }),
        })
      }
    }
    if (asked) log('CDN asked to drop removed files', { paths: asked })
    return asked
  }
  return { invalidate }
}
