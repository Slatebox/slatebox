import { isApiSignatureValid } from './methods/auth'
import { createApiLoginLink } from './methods/users'
/* eslint-disable no-console */
/* eslint-disable no-underscore-dangle */
import { Meteor } from 'meteor/meteor'
import app from './expressApp'
import { storedFileBase } from './common/fileStore'
import {
  APILinks,
  SlatePresentations,
} from '../imports/api/common/models'
import { mountActions } from './actions/mount'
import { mountMcp } from './mcp/meteor'
import { mountOAuth } from './oauth/meteor'
import { mountLicenses } from './licenses/meteor'
import { mountAppLinks } from './mobile/app-links.mjs'

// /.well-known/apple-app-site-association and assetlinks.json: links and sign-ins for the Slatebox
// viewer app (settings.mobile), 404 JSON until it is set up; ahead of the app's page.
mountAppLinks(app, { settings: () => Meteor.settings })
// Every /api/v1 route, its OpenAPI document and the matching Meteor methods come from the
// action registry (server/actions).
mountActions(app)
mountMcp(app) // POST /mcp: the hosted MCP endpoint (exec, describe and one typed tool per client method)
mountOAuth(app) // /oauth/* and /.well-known/oauth-*: how an MCP app signs a person in to /mcp
mountLicenses(app) // POST /licenses/key: Slatebox Cloud's enterprise keys for self-hosted servers (Cloud only)

if (Meteor.settings.public.env === 'selfhost') {
  app.get('/embed/:shareId', async (request, response) => {
    response.set('Cache-Control', 'no-store, no-transform')
    response.set('Referrer-Policy', 'no-referrer')
    response.set('X-Content-Type-Options', 'nosniff')
    const { shareId } = request.params
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(shareId)) return response.sendStatus(404)
    const presentation = await SlatePresentations.findOneAsync({
      slateShareId: shareId, isPublished: true,
    }, { fields: { imageUrl: 1 } })
    if (!presentation?.imageUrl) return response.sendStatus(404)
    let image
    try {
      // The board's image is one of this instance's stored files (fileStore.js).
      image = new URL(presentation.imageUrl)
      const assets = new URL(`${storedFileBase()}/`)
      if (image.origin !== assets.origin || !image.pathname.startsWith(assets.pathname) ||
        image.username || image.password || !/\/present_[A-Za-z0-9_-]+\.png$/.test(image.pathname)) {
        return response.sendStatus(404)
      }
    } catch {
      return response.sendStatus(404)
    }
    response.set('Content-Security-Policy', `default-src 'none'; img-src ${image.origin}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`)
    const src = image.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
    return response.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Slatebox board</title><style>body{margin:0}img{display:block;width:100vw;height:100vh;object-fit:contain}</style><img alt="Published Slatebox board" src="${src}"></html>`)
  })
}

app.get('/slates/createOrDisplay', async (req, res) => {
  const { bearer, dateString, userId, promptHash, prompt } = req.query
  res.setHeader('content-type', 'application/json')
  if (bearer && dateString) {
    const auth = await isApiSignatureValid({ bearer, dateString })
    if (auth) {
      // check for potential APILinks where this promptHash already exists
      const existingLinks = await APILinks.find({
        userId,
        promptHash,
      }).fetchAsync()
      const existingLink =
        existingLinks.length > 1
          ? existingLinks.find((l) => l.imageUrl !== null)
          : existingLinks[0]
      // console.log(
      //   'getting existing',
      //   existingLink,
      //   userId,
      //   promptHash,
      //   prompt,
      //   !!existingLink
      // )
      if (existingLink && existingLink.imageUrl) {
        res.writeHead(200)
        res.write(JSON.stringify({ imageUrl: existingLink.imageUrl }))
      } else {
        const token = await createApiLoginLink({ userId, promptHash, prompt })
        // console.log('got token', token)
        res.writeHead(200)
        res.write(JSON.stringify({ token }))
      }
    } else {
      // no access
      res.writeHead(504)
      res.write(JSON.stringify({ unauthorized: true }))
    }
  } else {
    res.writeHead(504)
    res.write(JSON.stringify({ unauthorized: true }))
  }
  res.end()
})
