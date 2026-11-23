// The OAuth endpoints, mounted on the app's express: the MCP SDK's own handlers (authorize,
// token, register, revoke, metadata) over Slatebox's provider (core.mjs). The consent page
// itself is the app's /oauth/consent route; it answers through Meteor methods (meteor.js).
//
// handlers: { authorizationHandler, tokenHandler, clientRegistrationHandler, revocationHandler,
// metadataHandler } from @modelcontextprotocol/sdk/server/auth/handlers/*. rateLimit is passed to
// each handler (express-rate-limit options, or false); the app keys it by the caller's address.
import { hashApiToken } from '../api-token-core.mjs'
import { OAUTH_PATHS, authorizationServerMetadata, protectedResourceMetadata } from './core.mjs'

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

// eslint-disable-next-line import/prefer-default-export
export function mountOAuth(app, { express, handlers, core, rateLimit }) {
  const { authorizationHandler, tokenHandler, clientRegistrationHandler, revocationHandler, metadataHandler } = handlers
  const { provider, urls } = core
  const limit = rateLimit === undefined ? {} : { rateLimit }

  const resourceMetadata = metadataHandler(protectedResourceMetadata(urls))
  app.use(OAUTH_PATHS.resourceMetadata, resourceMetadata)
  app.use('/.well-known/oauth-protected-resource', (req, res, next) => (req.path === '/' ? resourceMetadata(req, res, next) : notFound(req, res)))
  app.use('/.well-known/oauth-authorization-server', (req, res, next) =>
    req.path === '/' ? next() : notFound(req, res)
  )
  app.use('/.well-known/oauth-authorization-server', metadataHandler(authorizationServerMetadata(urls)))
  // Any other OAuth or OpenID discovery address: a JSON 404 a client can read, not the app's page.
  app.use('/.well-known', (req, res, next) => (/^\/(oauth-|openid-)/.test(req.path) ? notFound(req, res) : next()))

  // The consent page is the app's own page; before it renders, forbid every frame (clickjacking),
  // beside the page's own script check (OAuthConsent.jsx).
  app.use(OAUTH_PATHS.consent, (req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'")
    next()
  })
  app.use(OAUTH_PATHS.authorize, authorizationHandler({ provider, ...limit }))
  app.use(OAUTH_PATHS.token, hashClientSecret(express), tokenHandler({ provider, ...limit }))
  app.use(OAUTH_PATHS.revoke, hashClientSecret(express), revocationHandler({ provider, ...limit }))
  // A registered client's secret does not lapse (0): clients do not re-register on their own.
  app.use(OAUTH_PATHS.register, clientRegistrationHandler({ clientsStore: provider.clientsStore, clientSecretExpirySeconds: 0, ...limit }))
}
