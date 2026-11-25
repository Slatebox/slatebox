// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The team-address HTTP routes under /api/v1/team-addresses (Slatebox Cloud only). They are plain
// routes, never registry actions, on purpose: nothing here is an MCP tool or an exec call, so a
// connector token or an install credential can never come back in an agent's tool result.
//
//   user routes     Bearer: a device-code token (sbo_, scope team-addresses, bound to this
//                   resource) from `npx slatebox install` (web/app/server/oauth/device.mjs)
//   install routes  Bearer: the install credential sbxi_<prefix>_<secret>, for its own claim only
//
// closed() and gate() are checked on every request. On Slatebox Cloud with the Cloudflare settings
// missing or paused (settings.cloudflare.teamClaims absent, incomplete or paused: true), every route
// answers 503 paused with a plain message and nothing reaches Cloudflare. Off Slatebox Cloud (no
// Cloud key, an on-prem license), every route answers the same 404 as an unknown /api/v1 route.
// Every answer is Cache-Control: no-store; errors are {error:{code,message}} like the rest of /api/v1.
import { CLAIM_ID, TeamAddressError } from './claims.mjs'

export const BASE = '/api/v1/team-addresses'
const BODY_LIMIT = 4096

const send = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}
const fail = (res, status, code, message, retryAfter, reason) => {
  if (retryAfter !== undefined) res.setHeader('Retry-After', String(retryAfter))
  send(res, status, { error: { code, message, ...(retryAfter !== undefined && { retryAfter }), ...(reason && { reason }) } })
}
const unknownRoute = (res) => fail(res, 404, 'unknown_route', 'There is no such API route. See /api/v1/openapi.json.')
export const CLOSED_MESSAGE = 'Team addresses are not open on Slatebox Cloud right now. Nothing was changed. Use --domain or --local meanwhile.'
const closedRoute = (res) => fail(res, 503, 'paused', CLOSED_MESSAGE, 3600)

const bearer = (req) => {
  const header = req.headers?.authorization || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1].trim() : null
}

// The app's JSON parser skips /api/v1, so the body is read here, small and JSON only.
export function readJson(req, limit = BODY_LIMIT) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body)
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    const bad = (code, message, status = 400) => reject(Object.assign(new Error(message), { status, code }))
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        bad('payload_too_large', 'The request body is too large.', 413)
        req.destroy?.()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return bad('invalid_request', 'Send the request fields as one JSON object.')
        return resolve(parsed)
      } catch {
        return bad('invalid_json', 'The request body is not valid JSON.')
      }
    })
    req.on('error', reject)
  })
}

/**
 * @param {object} options
 * @param {() => boolean} options.gate                  Cloud key + settings, checked live
 * @param {() => boolean} [options.closed]              Slatebox Cloud, but the settings are missing or paused
 * @param {() => object} options.service                the claim service (claims.mjs)
 * @param {(req) => Promise<{ _id: string }|null>} options.authenticateUser
 * @param {(req) => string|undefined} [options.address]  the caller's own address
 * @param {(line: string) => void} [options.log]
 * @param {(caller: { _id: string, deviceGrantId?: string|null }, outcome: { ok: boolean, code?: string, message: string }) => Promise<void>|void} [options.report]
 *        what came of a signed-in change (claim, rename, new credential, release), for the /device
 *        page that approved the sign-in: it says "Claimed" or why not, never just "Approved"
 * @returns {{ method: string, path: string, handler: Function }[]}
 */
export function teamAddressRoutes({ gate, closed = () => false, service, authenticateUser, address = (req) => req.socket?.remoteAddress, log = () => {}, report = () => {} }) {
  const context = (req) => ({ ip: address(req), ua: req.headers?.['user-agent'] })

  const wrap = (fn) => async (req, res) => {
    if (closed()) return closedRoute(res)
    if (!gate()) return unknownRoute(res)
    try {
      const { status = 200, body } = await fn(req, res)
      return send(res, status, body)
    } catch (error) {
      if (error instanceof TeamAddressError) return fail(res, error.status, error.code, error.message, error.retryAfter, error.details?.reason)
      if (Number.isInteger(error?.status) && error.status < 500 && typeof error.code === 'string') return fail(res, error.status, error.code, error.message)
      log(`[team-addresses] ${req.method} failed: ${error?.name || 'Error'}`)
      return fail(res, 500, 'internal_error', 'The request could not be completed.')
    }
  }

  const user = async (req, { optional = false } = {}) => {
    const found = bearer(req) ? await authenticateUser(req) : null
    if (!found && (!optional || bearer(req))) throw new TeamAddressError('unauthorized', 'Sign in with `npx slatebox install` (or a token with the team-addresses scope).')
    return found
  }
  const install = async (req) => {
    const claim = await service().authenticateInstall(bearer(req))
    if (!claim) throw new TeamAddressError('unauthorized', 'This install credential is not valid. Sign in again with `slatebox install`.')
    return claim
  }
  // The outcome of a signed-in change goes back to the sign-in that allowed it. Reporting never
  // changes the answer: a failure to record it is logged and the request answers as it would.
  const reported = async (caller, fn, success) => {
    const tell = async (outcome) => {
      try {
        await report(caller, outcome)
      } catch (error) {
        log(`[team-addresses] outcome not recorded: ${error?.name || 'Error'}`)
      }
    }
    try {
      const result = await fn()
      await tell({ ok: true, message: success(result) })
      return result
    } catch (error) {
      if (error instanceof TeamAddressError) await tell({ ok: false, code: error.code, message: error.message, ...(error.details?.reason && { reason: error.details.reason }) })
      else await tell({ ok: false, code: 'internal_error', message: 'The request could not be completed.' })
      throw error
    }
  }
  const claimId = (req) => {
    const id = req.params?.id
    if (typeof id !== 'string' || !CLAIM_ID.test(id)) throw new TeamAddressError('not_found', 'No such team address on your account.')
    return id
  }

  return [
    {
      method: 'GET',
      path: `${BASE}/availability`,
      handler: wrap(async (req) => {
        const caller = await user(req, { optional: true })
        const name = req.query?.name
        return { body: await service().availability({ name: typeof name === 'string' ? name : '', user: caller, ...context(req) }) }
      }),
    },
    {
      method: 'GET',
      path: `${BASE}/self`,
      handler: wrap(async (req) => ({ body: service().self({ claim: await install(req) }) })),
    },
    {
      method: 'POST',
      path: `${BASE}/self/connector-token`,
      handler: wrap(async (req) => {
        const claim = await install(req)
        const body = await readJson(req)
        return { body: await service().connectorToken({ claim, rotate: body.rotate === true, ...context(req) }) }
      }),
    },
    {
      method: 'POST',
      path: `${BASE}/self/rename-complete`,
      handler: wrap(async (req) => ({ body: await service().renameComplete({ claim: await install(req), ...context(req) }) })),
    },
    {
      method: 'DELETE',
      path: `${BASE}/self`,
      handler: wrap(async (req) => service().releaseSelf({ claim: await install(req), ...context(req) })),
    },
    {
      method: 'GET',
      path: BASE,
      handler: wrap(async (req) => ({ body: await service().list({ user: await user(req) }) })),
    },
    {
      method: 'POST',
      path: BASE,
      handler: wrap(async (req) => {
        const caller = await user(req)
        const body = await readJson(req)
        return reported(
          caller,
          () =>
            service().claim({
              user: caller,
              name: body.name,
              clientKey: typeof body.clientKey === 'string' ? body.clientKey : '',
              label: body.label,
              idempotencyKey: req.headers?.['idempotency-key'],
              ...context(req),
            }),
          (result) => `Claimed ${result.body?.claim?.host || 'the team address'}. Your terminal continues on its own.`
        )
      }),
    },
    {
      method: 'POST',
      path: `${BASE}/:id/rename`,
      handler: wrap(async (req) => {
        const caller = await user(req)
        const id = claimId(req)
        const body = await readJson(req)
        return reported(caller, async () => ({ body: await service().rename({ user: caller, id, name: body.name, ...context(req) }) }), (result) => `Renamed to ${result.body?.claim?.host || 'the new name'}. Your terminal continues on its own.`)
      }),
    },
    {
      method: 'DELETE',
      path: `${BASE}/:id`,
      handler: wrap(async (req) => {
        const caller = await user(req)
        return reported(caller, () => service().releaseByOwner({ user: caller, id: claimId(req), ...context(req) }), () => 'Released the team address.')
      }),
    },
    {
      method: 'POST',
      path: `${BASE}/:id/install-credential`,
      handler: wrap(async (req) => {
        const caller = await user(req)
        return reported(caller, async () => ({ status: 201, body: await service().mintInstallCredential({ user: caller, id: claimId(req), ...context(req) }) }), (result) => `Reconnected ${result.body?.claim?.host || 'the team address'}. Your terminal continues on its own.`)
      }),
    },
  ]
}
