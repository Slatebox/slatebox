// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The REST calls the GitHub recipes make, under one installation token, and nothing else. Every call:
//   - counts against the run's vendor budget (budget.spend('vendorCalls', 1) === false ends it: code budget)
//   - passes the per-installation gate: 5,000 calls an hour shared by every recipe on that
//     installation, and what GitHub says is left (x-ratelimit-remaining) with a reserve of 100
//   - takes the run's AbortSignal and a 20 s timeout
//   - refreshes the token once on a 401
// Errors carry { status, code, retryable } and never a token, a body or file contents.
import { readTarball } from './tar.mjs'
import { GITHUB_API, USER_AGENT } from './app.mjs'

export const GITHUB_LIMITS = Object.freeze({
  perInstallationHour: 5000, reserve: 100, timeoutMs: 20000, tarballBytes: 300 * 1024 * 1024,
  filePages: 30, commentPages: 10, pageSize: 100, compareFiles: 300,
})
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/

export class GithubError extends Error {
  constructor(message, { status = 502, code = 'github_failed', retryable = false } = {}) {
    super(message)
    this.name = 'GithubError'
    this.status = status
    this.code = code
    this.retryable = retryable
  }
}

/** One gate per process: a rolling hour of calls per installation, and GitHub's own count. */
export function createInstallationGate({ now = () => Date.now(), limit = GITHUB_LIMITS.perInstallationHour, reserve = GITHUB_LIMITS.reserve } = {}) {
  const windows = new Map()
  const reported = new Map()
  return {
    take(installationId) {
      const key = String(installationId)
      const at = now()
      const w = (windows.get(key) || []).filter((t) => at - t < 3600 * 1000)
      const told = reported.get(key)
      if (told && at < told.reset && told.remaining <= reserve) return false
      if (w.length >= limit - reserve) {
        windows.set(key, w)
        return false
      }
      w.push(at)
      windows.set(key, w)
      return true
    },
    observe(installationId, headers) {
      const remaining = Number(headers?.get?.('x-ratelimit-remaining'))
      const reset = Number(headers?.get?.('x-ratelimit-reset')) * 1000
      if (Number.isFinite(remaining) && Number.isFinite(reset)) reported.set(String(installationId), { remaining, reset })
    },
  }
}

const seg = (path) => `${path}`.split('/').map(encodeURIComponent).join('/')
const checkRepo = (repo) => {
  if (!REPO.test(`${repo}`)) throw new GithubError('That is not a repository name (owner/name).', { status: 400, code: 'invalid_repo' })
  return repo
}

/**
 * deps: { fetch, apiBase?, installationId, token() → string, refresh() → string, gate, budget?, signal?, now? }
 */
export function createGithubClient({ fetch = globalThis.fetch, apiBase = GITHUB_API, installationId, token, refresh = token, gate, budget = null, signal = null }) {
  const stats = { calls: 0 }

  async function call(method, path, { query, body, accept = 'application/vnd.github+json', raw = false, allow404 = false, retried = false } = {}) {
    if (budget?.spend && budget.spend('vendorCalls', 1) === false) throw new GithubError('This run used its GitHub calls.', { status: 429, code: 'budget' })
    if (gate && !gate.take(installationId)) throw new GithubError('GitHub calls for this installation are used up for the hour.', { status: 429, code: 'rate_limited', retryable: true })
    stats.calls += 1
    const url = new URL(`${apiBase}${path}`)
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    const timeout = AbortSignal.timeout(GITHUB_LIMITS.timeoutMs)
    const signals = signal ? AbortSignal.any([signal, timeout]) : timeout
    let res
    try {
      res = await fetch(url.href, {
        method,
        signal: signals,
        redirect: 'follow',
        headers: {
          authorization: `Bearer ${retried ? await refresh() : await token()}`,
          accept,
          'x-github-api-version': '2022-11-28',
          'user-agent': USER_AGENT,
          ...(body !== undefined && { 'content-type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      })
    } catch (error) {
      if (signal?.aborted) throw new GithubError('The run was stopped.', { status: 499, code: 'aborted' })
      throw new GithubError('GitHub could not be reached.', { status: 503, code: error?.name === 'TimeoutError' ? 'timeout' : 'network', retryable: true })
    }
    gate?.observe?.(installationId, res.headers)
    if (res.status === 401 && !retried) return call(method, path, { query, body, accept, raw, allow404, retried: true })
    if (res.status === 404 && allow404) return null
    if ((res.status === 403 || res.status === 429) && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.get('retry-after')))
      throw new GithubError('GitHub asked Slatebox to slow down.', { status: 429, code: 'rate_limited', retryable: true })
    if (res.status === 401) throw Object.assign(new GithubError('The GitHub App installation no longer answers. Install Slatebox on GitHub again.', { status: 401, code: 'sign_in_needed' }), { name: 'SignInNeeded' })
    if (!res.ok) throw new GithubError(`GitHub answered ${res.status}.`, { status: res.status, code: res.status === 404 ? 'not_found' : res.status === 422 ? 'github_refused' : 'github_failed', retryable: res.status >= 500 })
    if (raw) return new Uint8Array(await res.arrayBuffer())
    return res.status === 204 ? null : res.json()
  }

  const paged = async (path, query, pages, pick = (d) => d) => {
    const out = []
    for (let page = 1; page <= pages; page += 1) {
      const items = pick(await call('GET', path, { query: { ...query, per_page: GITHUB_LIMITS.pageSize, page } })) || []
      out.push(...items)
      if (items.length < GITHUB_LIMITS.pageSize) break
    }
    return out
  }

  return {
    // No raw call, no merge and no delete: a recipe reaches GitHub only through the calls below.
    stats,
    installationId,
    /** { defaultBranch, sha, private } of the default branch's head. */
    async head(repo) {
      const info = await call('GET', `/repos/${seg(checkRepo(repo))}`)
      const branch = await call('GET', `/repos/${seg(repo)}/branches/${seg(info.default_branch)}`)
      return { defaultBranch: info.default_branch, sha: branch.commit.sha, private: Boolean(info.private), protected: Boolean(branch.protected) }
    },
    repo: async (repo) => call('GET', `/repos/${seg(checkRepo(repo))}`),
    branch: async (repo, name) => call('GET', `/repos/${seg(checkRepo(repo))}/branches/${seg(name)}`, { allow404: true }),
    /**
     * compare base...head: files (up to 300) and commit messages. GitHub pages a compare's commits
     * oldest first, so the first page of 100 drops the newest of a bigger range; newest: true asks with
     * no paging at all, which GitHub answers with up to 250 commits ending at the newest (one call).
     */
    async compare(repo, base, head, { newest = false } = {}) {
      const data = await call('GET', `/repos/${seg(checkRepo(repo))}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, newest ? {} : { query: { per_page: 100 } })
      return {
        status: data.status,
        truncated: (data.files || []).length >= GITHUB_LIMITS.compareFiles,
        files: (data.files || []).map((f) => ({ path: f.filename, status: f.status, previous: f.previous_filename ?? null })),
        commits: (data.commits || []).map((c) => ({ sha: c.sha, message: `${c.commit?.message ?? ''}`.slice(0, 2000), parents: (c.parents || []).length, parent: c.parents?.[0]?.sha ?? null })),
      }
    },
    /** A file's text at a ref, or null when it is not there (or is not a file). */
    async contents(repo, path, ref) {
      const data = await call('GET', `/repos/${seg(checkRepo(repo))}/contents/${seg(path)}`, { query: { ref }, allow404: true })
      if (!data || Array.isArray(data) || data.type !== 'file' || typeof data.content !== 'string') return null
      if (data.size > 1024 * 1024) return null
      return Buffer.from(data.content, 'base64').toString('utf8')
    },
    /** The repository at a ref, only the paths want() keeps (1 call). */
    async tarball(repo, ref, { want, maxFileBytes } = {}) {
      const bytes = await call('GET', `/repos/${seg(checkRepo(repo))}/tarball/${encodeURIComponent(ref)}`, { raw: true, accept: 'application/vnd.github+json' })
      if (bytes.length > GITHUB_LIMITS.tarballBytes) throw new GithubError('The repository is too large to read at once.', { status: 413, code: 'too_large' })
      return readTarball(bytes, { want, maxFileBytes })
    },
    pull: async (repo, number) => call('GET', `/repos/${seg(checkRepo(repo))}/pulls/${Number(number)}`),
    /** The newest published releases (20 at most, drafts left out): { tag, name, publishedAt, url, prerelease }. */
    async releases(repo) {
      const list = (await call('GET', `/repos/${seg(checkRepo(repo))}/releases`, { query: { per_page: 20 } })) || []
      return list.filter((r) => !r.draft && r.tag_name).map((r) => ({
        tag: `${r.tag_name}`.slice(0, 100), name: `${r.name || r.tag_name}`.slice(0, 200), publishedAt: r.published_at || null,
        url: typeof r.html_url === 'string' && r.html_url.startsWith('https://') ? r.html_url : null, prerelease: Boolean(r.prerelease),
      }))
    },
    pullFiles: async (repo, number) =>
      paged(`/repos/${seg(checkRepo(repo))}/pulls/${Number(number)}/files`, {}, GITHUB_LIMITS.filePages).then((files) =>
        files.map((f) => ({ path: f.filename, status: f.status, previous: f.previous_filename ?? null }))),
    issueComments: async (repo, number) => paged(`/repos/${seg(checkRepo(repo))}/issues/${Number(number)}/comments`, {}, GITHUB_LIMITS.commentPages),
    createComment: async (repo, number, body) => call('POST', `/repos/${seg(checkRepo(repo))}/issues/${Number(number)}/comments`, { body: { body } }),
    updateComment: async (repo, id, body) => call('PATCH', `/repos/${seg(checkRepo(repo))}/issues/comments/${Number(id)}`, { body: { body } }),
    createCheckRun: async (repo, run) => call('POST', `/repos/${seg(checkRepo(repo))}/check-runs`, { body: run }),
    ref: async (repo, branch) => call('GET', `/repos/${seg(checkRepo(repo))}/git/ref/heads/${seg(branch)}`, { allow404: true }),
    commit: async (repo, sha) => call('GET', `/repos/${seg(checkRepo(repo))}/git/commits/${encodeURIComponent(sha)}`),
    createTree: async (repo, tree) => call('POST', `/repos/${seg(checkRepo(repo))}/git/trees`, { body: tree }),
    createCommit: async (repo, commit) => call('POST', `/repos/${seg(checkRepo(repo))}/git/commits`, { body: commit }),
    createRef: async (repo, branch, sha) => call('POST', `/repos/${seg(checkRepo(repo))}/git/refs`, { body: { ref: `refs/heads/${branch}`, sha } }),
    // force is never sent: a branch only moves forward.
    updateRef: async (repo, branch, sha) => call('PATCH', `/repos/${seg(checkRepo(repo))}/git/refs/heads/${seg(branch)}`, { body: { sha, force: false } }),
    openPulls: async (repo, owner, branch) => call('GET', `/repos/${seg(checkRepo(repo))}/pulls`, { query: { head: `${owner}:${branch}`, state: 'open' } }),
    createPull: async (repo, pr) => call('POST', `/repos/${seg(checkRepo(repo))}/pulls`, { body: pr }),
    updatePull: async (repo, number, pr) => call('PATCH', `/repos/${seg(checkRepo(repo))}/pulls/${Number(number)}`, { body: pr }),
    requestReviewers: async (repo, number, reviewers) => call('POST', `/repos/${seg(checkRepo(repo))}/pulls/${Number(number)}/requested_reviewers`, { body: { reviewers } }),
  }
}
