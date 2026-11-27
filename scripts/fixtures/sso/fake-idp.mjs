// A fake OpenID Connect provider for the unit tests: its own signing key, a discovery document, a
// JWKS and a token endpoint, all answered by a fetch() the code under test is handed. Nothing
// listens on a port. Tokens are really signed (RS256), so the signature check is exercised.
import { generateKeyPair, exportJWK, SignJWT } from 'jose'

export async function fakeIdp({ issuer = 'https://idp.acme.test', clientId = 'slatebox', kid = 'k1' } = {}) {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' }
  const other = await generateKeyPair('RS256', { extractable: true })
  const endpoints = {
    issuer,
    authorizationEndpoint: `${issuer}/authorize`,
    tokenEndpoint: `${issuer}/token`,
    jwksUri: `${issuer}/jwks`,
    endSessionEndpoint: `${issuer}/logout`,
  }
  const discovery = {
    issuer,
    authorization_endpoint: endpoints.authorizationEndpoint,
    token_endpoint: endpoints.tokenEndpoint,
    jwks_uri: endpoints.jwksUri,
    end_session_endpoint: endpoints.endSessionEndpoint,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    backchannel_logout_supported: true,
  }
  const state = { token: { status: 200, body: {} }, calls: [], discovery, jwks: { keys: [jwk] } }

  /** A signed JWT. wrongKey: signed by a key the JWKS does not hold. */
  async function sign(claims, { wrongKey = false, header = {}, typ = 'JWT' } = {}) {
    return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid, typ, ...header }).sign(wrongKey ? other.privateKey : privateKey)
  }
  const unsigned = (claims) => `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`

  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  async function fetch(input, init = {}) {
    const url = String(input?.href ?? input?.url ?? input)
    if (url === `${issuer}/.well-known/openid-configuration`) return json(200, state.discovery)
    if (url === endpoints.jwksUri) return json(200, state.jwks)
    if (url === endpoints.tokenEndpoint) {
      const body = new URLSearchParams(typeof init.body === 'string' ? init.body : init.body?.toString())
      state.calls.push({ url, method: init.method, body, headers: init.headers })
      const reply = typeof state.token === 'function' ? await state.token(body) : state.token
      return json(reply.status ?? 200, reply.body)
    }
    return json(404, { error: 'not_found' })
  }
  return {
    issuer, clientId, endpoints, discovery, state, fetch, sign, unsigned, jwk,
    /** The ID token claims a good sign-in carries. */
    claims: (nonce, extra = {}, now = Date.now()) => ({
      iss: issuer, aud: clientId, azp: clientId, sub: 'user-1', nonce,
      exp: Math.floor(now / 1000) + 300, iat: Math.floor(now / 1000) - 5,
      email: 'ada@acme.test', email_verified: true, given_name: 'Ada', family_name: 'Lovelace', ...extra,
    }),
  }
}
