// A stand-in for a self-hosted Slatebox's setup endpoint (GET and POST /setup/<token>), made from
// the server's own logic (web/app/server/self-host-setup/core.mjs: the token check, the form's
// rules and the pages), with FakeDocker's container as its database: the token is the last link
// the fake image made, and a created admin marks the container set up (so `setup-link --check`
// says so too).
import { formErrors, linkProblemPage, linkState, newLinkRecord, parseForm, parseSetupPath, setupFormPage, signedInPage } from '../../../web/app/server/self-host-setup/core.mjs'

export const LOGIN_TOKEN = 'browser-login-token-never-printed-0123456789'

/**
 * @param {object} docker FakeDocker
 * @param {{name?: string, down?: string[], claimed?: boolean, ssoOnly?: boolean, onGet?: (n: number) => void, fallback?: Function}} [options]
 */
export function setupServer(docker, { name = 'slatebox', down = [], claimed = false, ssoOnly = false, onGet, fallback } = {}) {
  const calls = []
  let gets = 0
  const state = { claimed }
  const fetch = async (url, init = {}) => {
    const u = new URL(url)
    if (!u.pathname.startsWith('/setup/')) {
      if (fallback) return fallback(url, init)
      // Everything else (the health checks) answers as the CLI's test default does.
      return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '{"ok":true}' }
    }
    if (down.includes(u.origin)) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    const method = init.method || 'GET'
    calls.push({ origin: u.origin, method, body: init.body ? String(init.body) : '' })
    const container = docker.containers.get(name)
    const current = docker.setupLinks.at(-1)
    const doc = container?.setUp ? { completedAt: new Date() } : { ...newLinkRecord(current), ...(state.claimed ? { claimedAt: new Date() } : {}) }
    const { token } = parseSetupPath(u.pathname)
    const answer = (status, html) => ({ status, ok: status < 300, text: async () => html })
    const linked = linkState(doc, token)
    if (method === 'GET') {
      gets++
      onGet?.(gets)
      // The page as it is after onGet (which may have made the admin).
      const after = docker.containers.get(name)?.setUp ? 'set-up' : linked
      if (after !== 'ok') return answer(after === 'set-up' ? 200 : 410, linkProblemPage(after))
      return answer(200, setupFormPage({ token }))
    }
    if (linked !== 'ok') return answer(linked === 'set-up' ? 200 : 410, linkProblemPage(linked))
    const values = parseForm(init.body)
    if (ssoOnly) return answer(400, setupFormPage({ token, values, sso: { only: true }, problem: 'This Slatebox uses single sign-on only. Continue with single sign-on.' }))
    const errors = formErrors(values)
    if (Object.keys(errors).length) return answer(400, setupFormPage({ token, values, errors }))
    container.setUp = true
    state.admin = values
    return answer(200, signedInPage({ userId: 'admin-user-id', token: LOGIN_TOKEN, expires: Date.now() + 86_400_000, nonce: 'nonce' }))
  }
  return { fetch, calls, state, gets: () => gets }
}
