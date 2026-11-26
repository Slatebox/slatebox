// POST /licenses/key on Slatebox Cloud: a self-hosted server asks for an enterprise license key
// (issuer.mjs) with the token its administrator's device sign-in gave it (client 'slatebox-server',
// scope license:trial, bound to /licenses). A plain route, not a registry action, on purpose:
// nothing here is an MCP tool or an exec call, and no personal token ever carries the scope.
// Off Cloud, or without Cloud's signing key, it answers 404. Errors are {error:{code,message}}.
// MIT, runs without Meteor (scripts/license-issuer.test.mjs).
import { Buffer } from 'node:buffer'
import { LicenseIssueError } from './issuer.mjs'

export const LICENSE_KEY_PATH = '/licenses/key'
const BODY_LIMIT = 2048

const send = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}
const fail = (res, status, code, message, retryAfter) => {
  if (retryAfter !== undefined) res.setHeader('Retry-After', String(retryAfter))
  send(res, status, { error: { code, message, ...(retryAfter !== undefined && { retryAfter }) } })
}

function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body)
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new LicenseIssueError(413, 'payload_too_large', 'The request body is too large.'))
        req.destroy?.()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return reject(new LicenseIssueError(400, 'invalid_request', 'Send the request fields as one JSON object.'))
        return resolve(parsed)
      } catch {
        return reject(new LicenseIssueError(400, 'invalid_json', 'The request body is not valid JSON.'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * @param {object} app  an Express app
 * @param {object} options
 * @param {() => boolean} options.gate                      Cloud key and the signing key, checked live
 * @param {() => ReturnType<import('./issuer.mjs').createLicenseIssuer>} options.issuer
 * @param {(req) => Promise<{ _id: string, email?: string|null, deviceGrantId?: string|null }|null>} options.authenticate
 *   the owner of a device token with license:trial bound to this resource, or null
 * @param {(caller: object, outcome: { ok: boolean, code?: string, message: string }) => Promise<void>|void} [options.report]
 *   tells the /device page that approved the sign-in what came of it
 */
export function mountLicenseRoutes(app, { gate, issuer, authenticate, report = () => {}, log = () => {} }) {
  app.post(LICENSE_KEY_PATH, async (req, res) => {
    if (!gate()) return fail(res, 404, 'unknown_route', 'There is no such route.')
    let caller = null
    try {
      caller = await authenticate(req)
      if (!caller) return fail(res, 401, 'unauthorized', 'Sign in to Slatebox Cloud from your server first.')
      const body = await readJson(req)
      const issued = await issuer().issue({
        userId: caller._id,
        email: caller.email || null,
        host: body.host,
        installId: typeof body.installId === 'string' ? body.installId.slice(0, 64) : null,
      })
      await Promise.resolve(report(caller, { ok: true, message: issued.trial ? `Your free trial key for ${issued.hosts[0]} was sent to your server.` : 'Your license key was sent to your server.' })).catch(() => {})
      return send(res, 200, issued)
    } catch (error) {
      if (error instanceof LicenseIssueError) {
        if (caller) await Promise.resolve(report(caller, { ok: false, code: error.code, message: error.message })).catch(() => {})
        return fail(res, error.status, error.code, error.message, error.retryAfter)
      }
      log(`license issue failed: ${error?.message || error}`)
      return fail(res, 500, 'internal_error', 'The request could not be completed.')
    }
  })
}
