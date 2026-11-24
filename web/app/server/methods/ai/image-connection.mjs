// Generating an image through a chosen connection: the OpenAI images API
// (POST <base>/images/generations), which OpenAI and many hosts and local servers serve.
// Only a connection marked as able to make images is called (connections.mjs capabilityGap).
import { authFor, withQuery } from './connection-request.mjs'

const SIZES = [256, 512, 1024]
const nearest = (value) => SIZES.reduce((best, size) => (Math.abs(size - value) < Math.abs(best - value) ? size : best), 512)

export class ImageConnectionError extends Error {}

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
  return images.slice(0, 1).map((b64) => Buffer.from(b64, 'base64'))
}
