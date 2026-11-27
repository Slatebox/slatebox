/* eslint-disable no-underscore-dangle, no-await-in-loop, no-restricted-syntax, no-continue */
// /scim/v2 on the app's Express app. No Meteor import: scripts/scim.test.mjs mounts it on a plain
// Express app with the in-memory store. The team is the token's (tokens.mjs); no team in the address.
//
//   GET  /scim/v2/ServiceProviderConfig, /ResourceTypes, /Schemas   (no token needed: discovery)
//   GET  /scim/v2/Users?filter=&startIndex=&count=    POST /Users
//   GET  /scim/v2/Users/:id   PUT   PATCH   DELETE
//   GET  /scim/v2/Groups?filter=&excludedAttributes=  POST /Groups
//   GET  /scim/v2/Groups/:id  PUT   PATCH   DELETE
import {
  SCHEMA, SCIM_CONTENT_TYPE, ScimError, resourceTypes, schemas, scimError, serviceProviderConfig,
} from './protocol.mjs'
import { SCIM_RATE_PER_MINUTE } from './tokens.mjs'

export const SCIM_BASE = '/scim/v2'
// Express matches paths without regard to case, so the app's JSON parser skips /SCIM/V2 too.
export const isScimPath = (path) => /^\/scim\/v2(\/|$)/i.test(path)
const BODY_LIMIT = '1mb'

const send = (res, status, body) => {
  res.status(status)
  res.setHeader('Cache-Control', 'no-store')
  if (body === null || body === undefined) return res.end()
  res.setHeader('Content-Type', `${SCIM_CONTENT_TYPE}; charset=utf-8`)
  return res.end(JSON.stringify(body))
}

/**
 * app: the Express app. authenticate(authorizationHeader) → { orgId, tokenId } | null.
 * service: createScimService. limiter: { take(tokenId) → { allowed, resetSeconds } } (per token,
 * SCIM_RATE_PER_MINUTE). origin(): this server's address, for the resources' locations.
 * log(line, error?): a failure of this server, logged and answered without its detail.
 */
export function mountScim(app, { express, authenticate, service, limiter = null, origin, log = () => {}, around = (_caller, _req, run) => run() }) {
  const router = express.Router({ caseSensitive: false })
  router.use(express.json({ type: ['application/scim+json', 'application/json'], limit: BODY_LIMIT }))

  const base = () => `${String(origin()).replace(/\/$/, '')}${SCIM_BASE}`

  // Discovery answers without a token: providers read it while an admin sets them up.
  router.get('/ServiceProviderConfig', (req, res) => send(res, 200, serviceProviderConfig(base())))
  router.get('/ResourceTypes', (req, res) => send(res, 200, {
    schemas: [SCHEMA.list], totalResults: 2, startIndex: 1, itemsPerPage: 2, Resources: resourceTypes(base()),
  }))
  router.get('/ResourceTypes/:id', (req, res) => {
    const found = resourceTypes(base()).find((type) => type.id === req.params.id)
    return found ? send(res, 200, found) : send(res, 404, scimError(404, 'Resource type not found.'))
  })
  router.get('/Schemas', (req, res) => {
    const list = schemas(base())
    return send(res, 200, { schemas: [SCHEMA.list], totalResults: list.length, startIndex: 1, itemsPerPage: list.length, Resources: list })
  })
  router.get('/Schemas/:id', (req, res) => {
    const found = schemas(base()).find((schema) => schema.id === req.params.id)
    return found ? send(res, 200, found) : send(res, 404, scimError(404, 'Schema not found.'))
  })

  // Everything else needs the team's token.
  router.use(async (req, res, next) => {
    try {
      const caller = await authenticate(req.get('authorization'))
      if (!caller) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="Slatebox SCIM"')
        return send(res, 401, scimError(401, 'Send a SCIM token from Team settings › Sign-in & security as Authorization: Bearer <token>.'))
      }
      if (limiter) {
        const taken = await limiter.take(caller.tokenId)
        if (!taken.allowed) {
          res.setHeader('Retry-After', String(taken.resetSeconds))
          return send(res, 429, scimError(429, `Too many requests: at most ${SCIM_RATE_PER_MINUTE} a minute per token. Wait and retry.`, 'tooMany'))
        }
      }
      req.scim = caller
      return next()
    } catch (error) {
      return next(error)
    }
  })

  // around(caller, req, run): what each request runs inside (the Meteor side: the activity log's
  // context, so the entries a request makes name its token and address).
  const handle = (run) => async (req, res, next) => {
    try {
      const { status, body } = await around(req.scim, req, () => run(req.scim.orgId, req))
      return send(res, status, body)
    } catch (error) {
      return next(error)
    }
  }
  router.get('/Users', handle((orgId, req) => service.listUsers(orgId, req.query, base())))
  router.post('/Users', handle((orgId, req) => service.createUser(orgId, req.body, base())))
  router.get('/Users/:id', handle((orgId, req) => service.getUser(orgId, req.params.id, base())))
  router.put('/Users/:id', handle((orgId, req) => service.putUser(orgId, req.params.id, req.body, base())))
  router.patch('/Users/:id', handle((orgId, req) => service.patchUser(orgId, req.params.id, req.body, base())))
  router.delete('/Users/:id', handle((orgId, req) => service.deleteUser(orgId, req.params.id)))
  router.get('/Groups', handle((orgId, req) => service.listGroups(orgId, req.query, base())))
  router.post('/Groups', handle((orgId, req) => service.createGroup(orgId, req.body, base())))
  router.get('/Groups/:id', handle((orgId, req) => service.getGroup(orgId, req.params.id, req.query, base())))
  router.put('/Groups/:id', handle((orgId, req) => service.putGroup(orgId, req.params.id, req.body, base())))
  router.patch('/Groups/:id', handle((orgId, req) => service.patchGroup(orgId, req.params.id, req.body)))
  router.delete('/Groups/:id', handle((orgId, req) => service.deleteGroup(orgId, req.params.id)))
  router.use((req, res) => send(res, 404, scimError(404, 'There is no such SCIM endpoint.')))

  // eslint-disable-next-line no-unused-vars
  router.use((error, req, res, _next) => {
    if (error instanceof ScimError) return send(res, error.status, scimError(error.status, error.message, error.scimType))
    if (error?.type === 'entity.parse.failed') return send(res, 400, scimError(400, 'The body is not JSON.', 'invalidSyntax'))
    if (error?.type === 'entity.too.large') return send(res, 413, scimError(413, 'The body is too large.'))
    try { log('scim: request failed', error) } catch { /* the answer below still goes out */ }
    return send(res, 500, scimError(500, 'The request could not be completed.'))
  })

  app.use(SCIM_BASE, router)
  return router
}
