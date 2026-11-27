import express from 'express'
import { isApiPath } from './actions/http.mjs'
import { isMcpPath } from './mcp/endpoint.mjs'
import { isScimPath } from './scim/routes.mjs'

const app = express()

// JSON bodies. /api/v1 routes parse their own, with each action's body limit and the API's
// error shape for a body that is too large or not JSON (server/actions/http.mjs).
const json = express.json()
// /mcp parses its own too (server/mcp/endpoint.mjs), with room for a 64 KiB script, and /scim/v2
// its application/scim+json (server/scim/routes.mjs).
app.use((req, res, next) => (isApiPath(req.path) || isMcpPath(req.path) || isScimPath(req.path) ? next() : json(req, res, next)))

const nonCacheableHttpCodes = process.env.SB_NON_CACHEABLE_HTTP_CODES?.split(
  ','
).map((c) => parseInt(c, 10)) ?? [404, 500]

// ensure 404s are not cached
app.use((req, res, next) => {
  if (nonCacheableHttpCodes.includes(res.statusCode)) {
    console.log(
      'setting cache-control to no-store, no-cache, must-revalidate',
      { statusCode: res.statusCode }
    )
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  }
  next()
})

app.get('/livez', (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({ ok: true, service: 'slatebox-app' })
})

export default app
