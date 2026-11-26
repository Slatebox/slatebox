// What a self-hosted Slatebox server asks of Slatebox Cloud for the header button on a self-hosted install (owner,
// 2026-11-25). MIT, runs without Meteor (scripts/selfhost-options.test.mjs, against an in-process
// Cloud built from the same code: scripts/fake-slatebox-cloud.mjs).
//
//   device sign-in   RFC 8628 on Cloud's /oauth/device_authorization and /oauth/token, as client
//                    'slatebox-server' ("Your Slatebox server"); a Cloud that does not know that
//                    client yet answers invalid_client, and a move then signs in as 'slatebox-cli'
//                    (the installer's client, which Cloud has offered moves to since 0.2).
//   licenses         POST /licenses/key: a trial key bound to this server's host, or the account's
//                    own license (server/licenses on Cloud).
//   moves            the /api/v1 team move actions the CLI's `slatebox migrate --to cloud` uses, and
//                    the one-time upload address they hand out.
// Every answer that is not a success becomes a CloudError with Cloud's own code and words.
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'

export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
export const SERVER_CLIENT = 'slatebox-server'
export const CLI_CLIENT = 'slatebox-cli'
export const LICENSE_SCOPE = 'license:trial'
export const MOVE_SCOPE = 'team:export team:move'
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

export class CloudError extends Error {
  constructor(code, message, status = 0, extra = {}) {
    super(message)
    this.code = code
    this.status = status
    Object.assign(this, extra)
  }
}

/** Cloud's origin: https, or plain http on this computer only (a local test Cloud). */
export function cloudOrigin(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new CloudError('bad_cloud_url', `The Slatebox Cloud address is not a URL: ${raw}`)
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname)))
    throw new CloudError('bad_cloud_url', `The Slatebox Cloud address must be https:// (${url.origin}).`)
  if (url.username || url.password) throw new CloudError('bad_cloud_url', 'The Slatebox Cloud address must not carry a user name or password.')
  return url.origin
}

/**
 * @param {{ origin: string, fetch?: typeof fetch, userAgent?: string, timeoutMs?: number }} options
 */
export function createCloudClient({ origin, fetch: fetchImpl = globalThis.fetch, userAgent = 'slatebox-server', timeoutMs = 120_000 }) {
  const base = cloudOrigin(origin)
  const reach = (error) => new CloudError('unreachable', `Slatebox Cloud (${new URL(base).host}) can't be reached: ${error?.cause?.code || error?.code || error?.name || 'no answer'}.`)
  async function readJson(response) {
    const text = await response.text().catch(() => '')
    try {
      return text ? JSON.parse(text) : {}
    } catch {
      return {}
    }
  }
  // OAuth answers { error, error_description }; the API { error: { code, message } }.
  const refusal = (response, data) => {
    if (typeof data?.error === 'string') return new CloudError(data.error, data.error_description || data.error, response.status)
    const error = data?.error && typeof data.error === 'object' ? data.error : {}
    return new CloudError(error.code || `http_${response.status}`, error.message || `Slatebox Cloud answered ${response.status}.`, response.status, { details: error.details, retryAfter: error.retryAfter })
  }
  async function send(path, { method = 'POST', form, json, bearer, headers = {}, body, duplex } = {}) {
    let response
    try {
      response = await fetchImpl(new URL(path, base).href, {
        method,
        headers: {
          accept: 'application/json',
          'user-agent': userAgent,
          ...(form && { 'content-type': 'application/x-www-form-urlencoded' }),
          ...(json !== undefined && { 'content-type': 'application/json' }),
          ...(bearer && { authorization: `Bearer ${bearer}` }),
          ...headers,
        },
        ...(form && { body: new URLSearchParams(form).toString() }),
        ...(json !== undefined && { body: JSON.stringify(json) }),
        ...(body !== undefined && { body, duplex: duplex || 'half' }),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw reach(error)
    }
    const data = await readJson(response)
    if (!response.ok) throw refusal(response, data)
    return { status: response.status, data }
  }
  // An /api/v1 action: writes carry an Idempotency-Key (the same key for a retried step), and a
  // call Cloud holds for a yes is sent again once with its confirmation: the administrator already
  // said yes in the panel (the CLI does the same with --yes).
  async function action(method, path, token, body, { key = method === 'GET' ? null : randomUUID() } = {}) {
    let confirm = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return (await send('/api/v1' + path, { method, bearer: token, ...(body !== undefined && { json: body }), headers: { ...(key && { 'idempotency-key': key }), ...(confirm && { 'slatebox-confirm': confirm }) } })).data
      } catch (error) {
        if (error.code === 'confirmation_required' && !confirm && error.details?.confirmationId) {
          confirm = error.details.confirmationId
          continue
        }
        throw error
      }
    }
    throw new CloudError('not_confirmed', 'Slatebox Cloud did not take the confirmation.')
  }
  // A one-time address Cloud handed out is used only on Cloud's own origin.
  const own = (address) => {
    const url = new URL(address, base)
    if (url.origin !== base) throw new CloudError('bad_address', 'Slatebox Cloud handed out an address that is not its own.')
    return url.href
  }

  return {
    origin: base,
    deviceAuthorize: ({ clientId = SERVER_CLIENT, scope, label }) => send('/oauth/device_authorization', { form: { client_id: clientId, scope, ...(label && { device_label: label }) } }).then((r) => r.data),
    deviceToken: ({ clientId = SERVER_CLIENT, deviceCode }) => send('/oauth/token', { form: { grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: clientId } }).then((r) => r.data),
    licenseKey: (token, { host, installId }) => send('/licenses/key', { bearer: token, json: { host, installId } }).then((r) => r.data),
    startMove: (token, key) => action('POST', '/team/moves', token, {}, { key }),
    listMoves: (token) => action('GET', '/team/moves', token),
    getMove: (token, id) => action('GET', `/team/moves/${encodeURIComponent(id)}`, token),
    confirmMove: (token, id, invite, key) => action('POST', `/team/moves/${encodeURIComponent(id)}/confirm`, token, { invite: Boolean(invite) }, { key }),
    discardMove: (token, id) => action('POST', `/team/moves/${encodeURIComponent(id)}/discard`, token, {}),
    /** The archive (a Node stream) to a move's upload address; answers the import's report. */
    async upload(address, stream, passphrase) {
      const { data } = await send(own(address), {
        headers: { 'content-type': 'application/octet-stream', ...(passphrase && { 'slatebox-export-passphrase-base64': Buffer.from(passphrase, 'utf8').toString('base64url') }) },
        body: Readable.toWeb(stream),
      })
      return data
    },
  }
}
