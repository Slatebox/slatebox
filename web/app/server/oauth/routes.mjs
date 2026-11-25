// The OAuth endpoints, mounted on the app's express: the MCP SDK's own handlers (authorize,
// token, register, revoke, metadata) over Slatebox's provider (core.mjs). The consent page
// itself is the app's /oauth/consent route; it answers through Meteor methods (meteor.js).
//
// handlers: { authorizationHandler, tokenHandler, clientRegistrationHandler, revocationHandler,
// metadataHandler } from @modelcontextprotocol/sdk/server/auth/handlers/*. rateLimit is passed to
// each handler (express-rate-limit options, or false); the app keys it by the caller's address.
import { hashApiToken } from '../api-token-core.mjs'
import { OAUTH_PATHS, authorizationServerMetadata, protectedResourceMetadata } from './core.mjs'
import { DEVICE_GRANT, DEVICE_PATHS, deviceErrorBody, regionFrom } from './device.mjs'

// Only the hash of a client secret is stored, so the secret a client sends is hashed before the
// SDK compares it with the stored one.
function hashClientSecret(express) {
  const form = express.urlencoded({ extended: false })
  return (req, res, next) =>
    form(req, res, (error) => {
      if (error) return next(error)
      if (req.body && typeof req.body.client_secret === 'string') req.body.client_secret = hashApiToken(req.body.client_secret)
      return next()
    })
}

const notFound = (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.status(404).json({ error: 'not_found', error_description: 'Nothing is published at this address.' })
}

// Device-code sign-in (device.mjs): the device authorization endpoint, and the device_code grant
// on the token endpoint, answered here before the SDK's token handler (which knows only
// authorization_code and refresh_token). address(req) is the caller's own address.
export function mountDeviceFlow(app, { express, device, address = (req) => req.socket?.remoteAddress }) {
  const form = express.urlencoded({ extended: false, limit: '4kb' })
  const answer = (res, error) => {
    const { status, body, retryAfter } = deviceErrorBody(error)
    if (retryAfter !== undefined) res.setHeader('Retry-After', String(retryAfter))
    res.status(status).json(body)
  }
  app.post(DEVICE_PATHS.authorization, form, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    try {
      const body = req.body || {}
      res.json(await device.authorize({ clientId: body.client_id, scope: body.scope, label: body.device_label, ip: address(req), region: regionFrom(req.headers) }))
    } catch (error) {
      answer(res, error)
    }
  })
  app.use(OAUTH_PATHS.token, form, async (req, res, next) => {
    if (req.method !== 'POST' || req.body?.grant_type !== DEVICE_GRANT) return next()
    res.setHeader('Cache-Control', 'no-store')
    try {
      return res.json(await device.poll({ clientId: req.body.client_id, deviceCode: req.body.device_code }))
    } catch (error) {
      return answer(res, error)
    }
  })
}

export function mountOAuth(app, { express, handlers, core, rateLimit, scopes = undefined, device = undefined, address = undefined }) {
  const { authorizationHandler, tokenHandler, clientRegistrationHandler, revocationHandler, metadataHandler } = handlers
  const { provider, urls } = core
  const limit = rateLimit === undefined ? {} : { rateLimit }

  const resourceMetadata = metadataHandler(protectedResourceMetadata(urls, scopes))
  app.use(OAUTH_PATHS.resourceMetadata, resourceMetadata)
  app.use('/.well-known/oauth-protected-resource', (req, res, next) => (req.path === '/' ? resourceMetadata(req, res, next) : notFound(req, res)))
  app.use('/.well-known/oauth-authorization-server', (req, res, next) =>
    req.path === '/' ? next() : notFound(req, res)
  )
  app.use('/.well-known/oauth-authorization-server', metadataHandler(authorizationServerMetadata(urls, scopes)))
  // Any other OAuth or OpenID discovery address: a JSON 404 a client can read, not the app's page.
  app.use('/.well-known', (req, res, next) => (/^\/(oauth-|openid-)/.test(req.path) ? notFound(req, res) : next()))

  // The consent page is the app's own page; before it renders, forbid every frame (clickjacking),
  // beside the page's own script check (OAuthConsent.jsx).
  app.use(OAUTH_PATHS.consent, (req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'")
    next()
  })
  if (device) mountDeviceFlow(app, { express, device, ...(address && { address }) })
  app.use(OAUTH_PATHS.authorize, authorizationHandler({ provider, ...limit }))
  app.use(OAUTH_PATHS.token, hashClientSecret(express), tokenHandler({ provider, ...limit }))
  app.use(OAUTH_PATHS.revoke, hashClientSecret(express), revocationHandler({ provider, ...limit }))
  // A registered client's secret does not lapse (0): clients do not re-register on their own.
  app.use(OAUTH_PATHS.register, clientRegistrationHandler({ clientsStore: provider.clientsStore, clientSecretExpirySeconds: 0, ...limit }))
}
