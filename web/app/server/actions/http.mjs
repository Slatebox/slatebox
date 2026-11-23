// Mounts every action that declares an HTTP route under /api/v1, plus the generated OpenAPI
// document. Each request is turned into (principal, input, key) and handed to registry.run.
import { ActionError, errorBody, problem } from './errors.mjs'
import { pathParams } from './registry.mjs'
import { buildOpenApi } from './openapi.mjs'
import { declaredProperty, resolveRef } from './schema.mjs'
import { principalFromVisitor } from './principal.mjs'

export const API_BASE = '/api/v1'
const expressPath = (path) => path.replace(/\{([A-Za-z0-9]+)\}/g, ':$1')
const hasBody = (req) =>
  Number(req.get('content-length')) > 0 || Boolean(req.get('transfer-encoding'))

function coerceQuery(schema, value, components) {
  const s = resolveRef(schema, components) || {}
  if (typeof value !== 'string') return value
  if (s.type === 'integer' && /^-?\d+$/.test(value)) return Number(value)
  if (s.type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true'
  return value
}

// Express routes ignore case, so the JSON body parser must skip /API/V1 as well as /api/v1.
export const isApiPath = (path) => /^\/api\/v1(\/|$)/i.test(path)

// An own data property whatever the name: `input.__proto__ = value` would set the prototype
// instead, hiding the field from validation while every read of input could still find it.
const put = (input, name, value) =>
  Object.defineProperty(input, name, { value, enumerable: true, writable: true, configurable: true })

export function readHttpInput(action, req, components) {
  const { method, path } = action.mounts.http
  const params = pathParams(path)
  const input = {}
  for (const name of params) put(input, name, req.params[name])
  const query = req.query || {}
  const takesBody = !['GET', 'DELETE'].includes(method)
  for (const [name, value] of Object.entries(query)) {
    const declared = declaredProperty(action.input, name)
    if (takesBody || !declared || params.includes(name))
      throw problem(400, 'invalid_request', `The query parameter ${name} is not accepted here.`)
    put(input, name, coerceQuery(declared, value, components))
  }
  if (!takesBody) {
    if (hasBody(req)) throw problem(400, 'invalid_request', 'This request takes no body.')
    return input
  }
  const body = req.body === undefined ? {} : req.body
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw problem(400, 'invalid_request', 'Send the request fields as one JSON object.')
  for (const [name, value] of Object.entries(body)) {
    if (params.includes(name))
      throw problem(400, 'invalid_request', `${name} belongs in the address, not the body.`)
    put(input, name, value)
  }
  return input
}

function sendError(res, error) {
  const failure = error instanceof ActionError ? error : problem(500, 'internal_error', 'The request could not be completed.')
  if (failure.retryAfter !== undefined) res.setHeader('Retry-After', String(failure.retryAfter))
  return res.status(failure.status).json(errorBody(failure))
}

function setRateHeaders(res, rateLimit) {
  if (!rateLimit) return
  res.setHeader('RateLimit-Limit', String(rateLimit.limit))
  res.setHeader('RateLimit-Remaining', String(rateLimit.remaining))
  res.setHeader('RateLimit-Reset', String(rateLimit.resetSeconds))
}

// The address a visitor is counted by. Behind proxies the socket peer is the nearest proxy, the
// same for every reader, so the address comes from X-Forwarded-For, as many hops from the right
// as there are proxies the operator runs (HTTP_FORWARDED_COUNT, the setting Meteor reads for
// the same purpose). Entries further left were written by the caller and are never trusted.
// With no proxies (0) the peer is the reader. A request that came through fewer proxies than
// configured skipped one; it is counted by its own peer.
export function clientAddress(req, forwardedCount = 0) {
  const peer = req.socket?.remoteAddress
  if (!forwardedCount) return peer
  const header = req.get('x-forwarded-for')
  const hops = typeof header === 'string' ? header.split(',').map((hop) => hop.trim()).filter(Boolean) : []
  return hops.length >= forwardedCount ? hops[hops.length - forwardedCount] : peer
}

// authenticate(req) -> principal or null. express is passed in so this module loads without it.
// forwardedCount: the number of proxies in front of the app (see clientAddress).
export function mountHttp(app, registry, { express, authenticate, forwardedCount = 0 }) {
  const router = express.Router()
  const openApi = buildOpenApi(registry)
  router.get('/openapi.json', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json(openApi)
  })
  for (const action of registry.list()) {
    const http = action.mounts.http
    if (!http) continue
    const parse = express.json({ limit: action.bodyLimit })
    router[http.method.toLowerCase()](expressPath(http.path), parse, async (req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      let principal = null
      try {
        principal = await authenticate(req)
        // A request that sends no credentials at all may read what a visitor may (a public
        // slate). One that sends a token that does not authenticate is refused, never demoted.
        if (!principal && !req.get('authorization') && action.principals.includes('visitor'))
          principal = principalFromVisitor(clientAddress(req, forwardedCount))
        // Authentication answers first, so a stranger learns nothing about the request shape.
        if (!principal) throw problem(401, 'unauthorized', 'A valid Slatebox API token is required.')
        const input = readHttpInput(action, req, registry.components)
        const key = req.get('idempotency-key')
        // A call from a local exec script carries Slatebox-Exec-* headers; the gated registry
        // (mount.js) sends it through the exec gate. Without them an agent's save still meets the
        // gate's holds (gate.directCall), and a person's call is an ordinary call.
        const x = (name) => req.get('slatebox-exec-' + name)
        const exec = x('id') === undefined ? undefined
          : { id: x('id'), key: x('key'), call: x('call'), codeSha256: x('code-sha256'), mode: x('mode'), intent: x('intent'), confirm: x('confirm') }
        // An agent's save the gate held is sent again, once the person agreed, with the
        // confirmation id it answered with.
        const confirm = req.get('slatebox-confirm')
        const result = await registry.run(principal, action.id, input, {
          idempotencyKey: key === undefined ? undefined : key.trim(),
          ...(exec && { exec }),
          ...(confirm !== undefined && { confirm: confirm.trim() }),
        })
        setRateHeaders(res, result.meta?.rateLimit)
        if (result.meta?.replayed) res.setHeader('Idempotent-Replayed', 'true')
        return res.status(result.status).json(result.body)
      } catch (error) {
        setRateHeaders(res, error.meta?.rateLimit)
        if (error.meta?.execHeld) res.setHeader('Slatebox-Exec-Held', error.meta.execHeld)
        return sendError(res, error)
      }
    })
  }
  router.use((_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    sendError(res, problem(404, 'unknown_route', 'There is no such API route. See /api/v1/openapi.json.'))
  })
  // Body parsing failures arrive here, in the same error shape as everything else.
  router.use((error, _req, res, _next) => {
    res.setHeader('Cache-Control', 'no-store')
    if (error?.type === 'entity.too.large')
      return sendError(res, problem(413, 'payload_too_large', 'The request body is too large.'))
    if (error?.type === 'entity.parse.failed')
      return sendError(res, problem(400, 'invalid_json', 'The request body is not valid JSON.'))
    return sendError(res, error)
  })
  app.use(API_BASE, router)
  return router
}
