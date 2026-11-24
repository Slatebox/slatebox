// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The three web addresses sign-in needs (Express handlers, registered through api.addRoute):
//   GET /oauth/mcp-client.json        Slatebox's Client ID Metadata Document (CIMD)
//   POST /connectors/oauth/start      from the signed-in Slatebox page (its login token in a
//                                     header, never a cookie): only the flow's owner may claim it;
//                                     ties it to this browser with an HttpOnly cookie and answers
//                                     the server's sign-in address for the popup. There is no GET:
//                                     a link to Slatebox can never start someone's sign-in or send
//                                     a browser on to another site.
//   GET /connectors/oauth/callback    where the server sends the popup back: finishes the sign-in
//                                     and tells the walkthrough (BroadcastChannel; it also polls)
// Pages carry no third-party content, a strict Content-Security-Policy with a nonce for their one
// script, no referrer and no caching. Nothing the outside server sent is ever echoed.
import { randomBytes } from 'node:crypto'
import { CALLBACK_PATH, CLIENT_DOCUMENT_PATH, clientDocument, START_PATH } from './oauth.mjs'

export const COOKIE_PREFIX = 'sb_agent_signin_'
export const CHANNEL = 'slatebox-agent-sign-in'

/** Cookies from a request header (no dependency; values are opaque base64url). */
export function readCookies(header) {
  const out = {}
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=')
    if (at < 1) continue
    const name = part.slice(0, at).trim()
    if (!/^[\w.-]{1,80}$/.test(name)) continue
    out[name] = decodeURIComponent(part.slice(at + 1).trim())
  }
  return out
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
}

/** The small page the popup shows at the end (or on a refusal). message is always Slatebox's own words. */
export function resultPage({ ok, title, message, flowId = null, code = null }) {
  const nonce = randomBytes(16).toString('base64')
  const payload = JSON.stringify({ type: 'agent-sign-in', ok: Boolean(ok), flowId, code }).replace(/</g, '\\u003c')
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Slatebox</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f7f9;color:#1d2330}main{max-width:420px;padding:32px;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08)}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 16px}button{font:inherit;padding:8px 16px;border-radius:8px;border:1px solid #c6cbd4;background:#fff;cursor:pointer}</style>
</head><body><main data-agent-sign-in="${ok ? 'done' : 'failed'}"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><button type="button" id="close">Close this window</button></main>
<script nonce="${nonce}">
(function(){var m=${payload};try{var c=new BroadcastChannel(${JSON.stringify(CHANNEL)});c.postMessage(m);c.close()}catch(e){}
try{localStorage.setItem(${JSON.stringify(CHANNEL)},JSON.stringify(Object.assign({at:Date.now()},m)))}catch(e){}
document.getElementById('close').addEventListener('click',function(){window.close()});
if(m.ok){setTimeout(function(){window.close()},1200)}})();
</script></body></html>`
  return { html, csp: `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` }
}

function sendPage(res, status, page) {
  noStore(res)
  res.setHeader('Content-Security-Policy', page.csp)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.status(status).send(page.html)
}

/**
 * The routes, over a getter for the running sign-in service and this Slatebox's origin.
 * → [{ method, path, handler }] for api.addRoute.
 */
export function signInRoutes({ signIn, origin, userFor = async () => null, log = () => {} }) {
  const secure = () => /^https:/.test(origin())
  const cookie = (flowId, value, maxAge) =>
    `${COOKIE_PREFIX}${flowId}=${value}; Path=/connectors/oauth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure() ? '; Secure' : ''}`

  return [
    {
      method: 'GET',
      path: CLIENT_DOCUMENT_PATH,
      handler(req, res) {
        res.setHeader('Cache-Control', 'public, max-age=3600')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.status(200).json(clientDocument(origin()))
      },
    },
    {
      method: 'POST',
      path: START_PATH,
      async handler(req, res) {
        noStore(res)
        try {
          const service = signIn()
          const userId = await userFor(req).catch(() => null)
          const flowId = typeof req.body?.flow === 'string' ? req.body.flow : ''
          const { authorizeUrl, binding } = await service.begin({ flowId, userId })
          res.setHeader('Set-Cookie', cookie(flowId, binding, 600))
          res.status(200).json({ authorizeUrl })
        } catch (error) {
          log({ kind: 'sign_in_start_refused', code: error?.code || 'error' })
          res.status(error?.code === 'signed_out' ? 401 : 400).json({ error: error?.code || 'error', message: error?.code ? error.message : 'Start the sign-in again from Slatebox.' })
        }
      },
    },
    {
      method: 'GET',
      path: CALLBACK_PATH,
      async handler(req, res) {
        const cookies = readCookies(req.headers?.cookie)
        let result
        try {
          result = await signIn().finish({ query: req.query || {}, bindingFor: (flowId) => cookies[COOKIE_PREFIX + flowId] || null })
        } catch {
          result = { ok: false, code: 'error', message: 'Sign-in didn\'t finish. Try again.' }
        }
        log({ kind: 'sign_in_callback', ok: result.ok, code: result.code || null })
        if (result.flowId) res.setHeader('Set-Cookie', cookie(result.flowId, '', 0))
        if (result.ok) {
          return sendPage(res, 200, resultPage({ ok: true, title: 'Signed in', message: `You're signed in to ${result.host}. You can close this window and go back to your slate.`, flowId: result.flowId }))
        }
        const title = result.code === 'cancelled' ? 'Sign-in was cancelled' : 'Sign-in didn\'t finish'
        return sendPage(res, 400, resultPage({ ok: false, title, message: result.message, flowId: result.flowId, code: result.code }))
      },
    },
  ]
}
