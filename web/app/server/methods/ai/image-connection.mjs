// Generating an image through a chosen connection: the OpenAI images API
// (POST <base>/images/generations), which OpenAI and many hosts and local servers serve.
// Only a connection marked as able to make images is called (connections.mjs capabilityGap).
import { authFor, withQuery } from './connection-request.mjs'

const SIZES = [256, 512, 1024]
const nearest = (value) => SIZES.reduce((best, size) => (Math.abs(size - value) < Math.abs(best - value) ? size : best), 512)

export class ImageConnectionError extends Error {}

/** The largest image stored from an endpoint: a 1024px picture fits well inside it. */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024

/** What a buffer holds, by its first bytes: 'png', 'jpeg', 'webp' or null for anything else. */
export function imageKind(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg'
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  return null
}

export const IMAGE_TYPES = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }

/**
 * connection: { baseUrl, model, apiKey? }; request: { prompt, width, height };
 * options: { fetch (one that applies the endpoint rules), timeoutMs }. → Buffer[] of images.
 */
export async function generateImages(connection, { prompt, width = 512, height = 512 }, { fetch: fetcher, timeoutMs = 120000 }) {
  const side = nearest(Math.max(width, height))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    const { headers, query } = authFor(connection)
    response = await fetcher(withQuery(`${connection.baseUrl.replace(/\/+$/, '')}/images/generations`, query), {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // the key as the provider wants it: a bearer key unless an administrator's provider says otherwise
        ...headers,
      },
      body: JSON.stringify({ model: connection.model, prompt: String(prompt).slice(0, 2000), n: 1, size: `${side}x${side}`, response_format: 'b64_json' }),
    })
  } catch (error) {
    if (error.name === 'ResponseTooLarge') throw new ImageConnectionError(error.message)
    throw new ImageConnectionError(error.name === 'AbortError' ? 'The image endpoint did not answer in time.' : 'Slatebox could not reach the image endpoint.')
  } finally {
    clearTimeout(timer)
  }
  let json = null
  try {
    json = await response.json()
  } catch {}
  if (!response.ok) throw new ImageConnectionError(`The image endpoint answered HTTP ${response.status}.`)
  const images = (json?.data || []).map((item) => item?.b64_json).filter((b64) => typeof b64 === 'string' && b64)
  if (!images.length) throw new ImageConnectionError('The image endpoint answered without an image.')
  // one image was asked for: an endpoint that sends more does not get more stored
  const buffer = Buffer.from(images[0], 'base64')
  // only a real picture of a picture's size is stored: an endpoint cannot use Slatebox as file hosting
  if (buffer.length > MAX_IMAGE_BYTES) throw new ImageConnectionError('The image endpoint sent an image that is too large.')
  if (!imageKind(buffer)) throw new ImageConnectionError('The image endpoint answered with something that is not a PNG, JPEG or WebP image.')
  return [buffer]
}
