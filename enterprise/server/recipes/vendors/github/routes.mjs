// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The two addresses GitHub calls:
//   POST /integrations/github/events     the App's webhook: push, pull_request, release (published),
//                                        installation, installation_repositories. Checked first (X-Hub-Signature-256
//                                        over the raw body, verify.mjs); one that fails gets 401 and
//                                        nothing else. Each X-GitHub-Delivery is handled once (an hour).
//                                        The answer comes at once (GitHub waits 10 s); the work after:
//                                        a matching recipe gets a debounced trigger, never a run inline.
//   GET  /integrations/github/installed  where GitHub sends a person back after "Install Slatebox on
//                                        GitHub" (and after changing its repositories). The state is
//                                        Slatebox's own, signed, naming the person; the code GitHub adds
//                                        (the App asks for the person's authorization on install) is
//                                        exchanged for their token, and only an installation that token
//                                        can see is linked to them. The token is not kept.
// No route echoes what GitHub sent; logs carry the event name, never names or contents.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { githubHeaders, readRawBody, verifyGithubSignature } from './verify.mjs'
import { userInstallations } from './app.mjs'

export const GITHUB_PATHS = Object.freeze({ events: '/integrations/github/events', installed: '/integrations/github/installed' })
const STATE_MINUTES = 30
const clip = (text, n) => `${text ?? ''}`.slice(0, n)

/** A short signed value for the install link's state: who asked, for which project, when. */
export function signState(secret, value) {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url')
  const mac = createHmac('sha256', `github-install-state:${secret}`).update(body).digest('base64url')
  return `${body}.${mac}`
}
export function openState(secret, text, now = Date.now()) {
  if (typeof text !== 'string' || text.length > 1000 || !secret) return null
  const [body, mac] = text.split('.')
  if (!body || !mac) return null
  const expected = createHmac('sha256', `github-install-state:${secret}`).update(body).digest('base64url')
  const a = Buffer.from(expected)
  const b = Buffer.from(mac)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    return value && typeof value.at === 'number' && now - value.at < STATE_MINUTES * 60 * 1000 ? value : null
  } catch {
    return null
  }
}

/** A push or pull request as the trigger a recipe gets (names and shas, no contents). */
export function triggerOf(event, body) {
  const repo = body.repository?.full_name
  const installationId = body.installation?.id
  if (!repo || !installationId) return null
  if (event === 'push') {
    const branch = `${body.ref ?? ''}`.replace(/^refs\/heads\//, '')
    if (!body.ref?.startsWith('refs/heads/') || branch !== body.repository.default_branch || body.deleted) return null
    const paths = new Set()
    for (const c of body.commits || []) for (const p of [...(c.added || []), ...(c.modified || []), ...(c.removed || [])]) if (paths.size < 300) paths.add(p)
    return {
      match: { vendor: 'github', event: 'github.push', installationId: String(installationId), repo },
      trigger: {
        kind: 'vendor', event: 'github.push', repo, before: body.before, after: body.after, branch,
        commits: (body.commits || []).slice(-20).map((c) => ({ sha: c.id, message: clip(c.message, 500) })),
        paths: [...paths].sort(),
      },
    }
  }
  if (event === 'release') {
    // a published release (a release map draws what it shipped); drafts and edits are not one
    if (body.action !== 'published' || !body.release?.tag_name || body.release.draft) return null
    return {
      match: { vendor: 'github', event: 'github.release', installationId: String(installationId), repo },
      trigger: { kind: 'vendor', event: 'github.release', repo, tag: clip(body.release.tag_name, 100), prerelease: Boolean(body.release.prerelease) },
    }
  }
  if (event === 'pull_request') {
    const action = body.action
    if (!['opened', 'synchronize', 'reopened', 'ready_for_review', 'closed'].includes(action)) return null
    const pr = body.pull_request || {}
    return {
      match: { vendor: 'github', event: 'github.pull_request', installationId: String(installationId), repo },
      trigger: {
        kind: 'vendor', event: 'github.pull_request', repo, action, number: pr.number, headSha: pr.head?.sha ?? null, baseRef: pr.base?.ref ?? null,
        draft: Boolean(pr.draft), merged: Boolean(pr.merged), labels: (pr.labels || []).map((l) => clip(l.name, 50)).slice(0, 20),
      },
    }
  }
  return null
}

/**
 * deps: {
 *   secret()            → the App's webhook secret
 *   stores              createGithubStores(...)
 *   installationInfo(id) → GitHub's record of an installation (App JWT) and its repositories
 *   oauth               { exchange(code) → userToken } (the App's client id and secret)
 *   fetch, apiBase, stateSecret(), later(fn), log(entry), now()
 * }
 * → [{ method, path, raw, handler(req, res, { trigger, pause }) }]
 */
export function githubRoutes(deps) {
  const { stores, later = (fn) => setImmediate(fn), log = () => {}, now = () => Date.now() } = deps
  const after = (what, fn) => later(() => Promise.resolve().then(fn).catch((error) => log({ kind: 'github_failed', what, code: error?.code ?? null, status: error?.status ?? null })))

  async function events(req, res, hooks) {
    let raw
    try {
      raw = await readRawBody(req)
    } catch {
      return res.status(413).end()
    }
    const secret = await Promise.resolve(deps.secret()).catch(() => null)
    const { event, delivery, signature } = githubHeaders(req)
    if (!raw || !verifyGithubSignature({ secret, signature, raw })) {
      log({ kind: 'github_unsigned' })
      return res.status(401).end()
    }
    let body
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch {
      return res.status(400).end()
    }
    if (typeof delivery !== 'string' || !/^[\w-]{1,80}$/.test(delivery)) return res.status(400).end()
    const first = await stores.deliveries.claim(delivery, new Date(now() + 3600 * 1000)).catch(() => false)
    res.status(202).end()
    if (!first) return undefined
    log({ kind: 'github_event', event: clip(event, 40), action: clip(body.action, 40) || null })
    const installationId = body.installation?.id ? String(body.installation.id) : null
    if (event === 'installation' && installationId) {
      return after('installation', async () => {
        if (body.action === 'deleted' || body.action === 'suspend') {
          if (body.action === 'deleted') await stores.installations.remove(installationId)
          else await stores.installations.upsert(installationId, { suspended: true })
          await hooks.pause?.({ vendor: 'github', installationId }, 'needs_sign_in')
          return
        }
        await stores.installations.upsert(installationId, {
          account: clip(body.installation.account?.login, 100), accountType: clip(body.installation.account?.type, 20),
          suspended: false, allRepos: body.installation.repository_selection === 'all',
          ...(Array.isArray(body.repositories) && { repos: body.repositories.map((r) => r.full_name).filter(Boolean) }),
        })
      })
    }
    if (event === 'installation_repositories' && installationId) {
      return after('installation_repositories', async () => {
        const removed = (body.repositories_removed || []).map((r) => r.full_name).filter(Boolean)
        await stores.installations.setRepos(installationId, { added: (body.repositories_added || []).map((r) => r.full_name).filter(Boolean), removed })
        for (const repo of removed) await hooks.pause?.({ vendor: 'github', installationId, repo }, 'blocked_access')
      })
    }
    const got = triggerOf(event, body)
    if (got) after(event, () => hooks.trigger(got.match, got.trigger))
    return undefined
  }

  async function installed(req, res) {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams)
    const state = openState(await deps.stateSecret(), q.state, now())
    const installationId = /^\d{1,20}$/.test(`${q.installation_id ?? ''}`) ? String(q.installation_id) : null
    const back = (status) => res.redirect(302, `${state?.projectId ? `/projects/${encodeURIComponent(state.projectId)}` : '/projects'}?github=${status}`)
    if (!state?.userId || !installationId) return back('refused')
    if (typeof q.code !== 'string' || !/^[\w-]{1,100}$/.test(q.code)) return back('refused')
    try {
      const userToken = await deps.oauth.exchange(q.code)
      const visible = await userInstallations({ fetch: deps.fetch, apiBase: deps.apiBase, userToken })
      if (!visible.some((i) => String(i.id) === installationId)) {
        log({ kind: 'github_install_not_visible' })
        return back('refused')
      }
      const info = await deps.installationInfo(installationId)
      await stores.installations.upsert(installationId, {
        account: clip(info.account, 100), accountType: clip(info.accountType, 20), suspended: Boolean(info.suspended), allRepos: Boolean(info.allRepos), repos: info.repos || [],
      })
      await stores.installations.linkUser(installationId, state.userId)
      log({ kind: 'github_installed' })
      return back('installed')
    } catch (error) {
      log({ kind: 'github_install_failed', code: error?.code ?? null, status: error?.status ?? null })
      return back('failed')
    }
  }

  return [
    { method: 'POST', path: GITHUB_PATHS.events, raw: true, handler: events },
    { method: 'GET', path: GITHUB_PATHS.installed, raw: false, handler: installed },
  ]
}
