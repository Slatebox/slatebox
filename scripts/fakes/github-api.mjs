// A GitHub REST API in memory, for the GitHub recipe tests (MIT, test support). It answers the
// calls the recipes and the vendor make with GitHub's own response shapes (as recorded from
// api.github.com, 2026-11: repos, branches, compare, contents, tarball, pulls, pulls/files, issue
// comments, check-runs, the Git Data API, app installation tokens), over repositories whose
// commits are file maps. Every request is recorded (method, path, query, body) so a test can assert
// exactly which calls happened, and that no write happened.
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { writeTarball } from '../../enterprise/server/recipes/vendors/github/tar.mjs'

const sha1 = (text) => createHash('sha1').update(text).digest('hex')

export function createFakeGithub({ now = () => Date.parse('2026-11-27T12:00:00Z') } = {}) {
  const repos = new Map()
  const calls = []
  let ids = 1000

  function addRepo(fullName, { files, defaultBranch = 'main', sha, message = 'Initial commit', isPrivate = true } = {}) {
    const root = sha || sha1(`${fullName}:root`)
    const repo = {
      fullName, defaultBranch, private: isPrivate,
      commits: new Map([[root, { sha: root, files: new Map(Object.entries(files)), message, parents: [] }]]),
      branches: new Map([[defaultBranch, root]]),
      protected: new Set([defaultBranch]),
      pulls: new Map(),
      comments: new Map(),
      checkRuns: [],
      trees: new Map(),
    }
    repos.set(fullName, repo)
    return root
  }

  /** A new commit on a branch: the parent's files with changes (null deletes). → sha */
  function commit(fullName, { branch, changes, message = 'Change', sha }) {
    const repo = repos.get(fullName)
    const parent = repo.branches.get(branch ?? repo.defaultBranch)
    const files = new Map(repo.commits.get(parent).files)
    for (const [path, text] of Object.entries(changes)) {
      if (text === null) files.delete(path)
      else files.set(path, text)
    }
    const id = sha || sha1(`${parent}:${message}:${JSON.stringify(changes)}`)
    repo.commits.set(id, { sha: id, files, message, parents: [parent] })
    repo.branches.set(branch ?? repo.defaultBranch, id)
    return id
  }

  function openPull(fullName, { number, title, body = '', head, base, draft = false, labels = [] }) {
    const repo = repos.get(fullName)
    repo.pulls.set(number, { number, title, body, head: { ref: head, sha: repo.branches.get(head) }, base: { ref: base ?? repo.defaultBranch, sha: repo.branches.get(base ?? repo.defaultBranch) }, draft, labels: labels.map((name) => ({ name })), state: 'open', merged: false })
  }

  const json = (status, data, headers = {}) =>
    new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': String(Math.floor(now() / 1000) + 3600), ...headers } })
  const notFound = () => json(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest' })

  function diff(repo, base, head) {
    const a = repo.commits.get(base)?.files
    const b = repo.commits.get(head)?.files
    const files = []
    for (const [path, text] of b) {
      if (!a.has(path)) files.push({ filename: path, status: 'added' })
      else if (a.get(path) !== text) files.push({ filename: path, status: 'modified' })
    }
    for (const path of a.keys()) if (!b.has(path)) files.push({ filename: path, status: 'removed' })
    return files.sort((x, y) => (x.filename < y.filename ? -1 : 1))
  }
  function between(repo, base, head) {
    const out = []
    for (let at = head; at && at !== base; at = repo.commits.get(at)?.parents[0]) out.unshift(repo.commits.get(at))
    return out
  }
  const resolveRef = (repo, ref) => (repo.commits.has(ref) ? ref : repo.branches.get(ref) ?? null)

  async function handle(method, url, body) {
    const path = decodeURIComponent(url.pathname)
    let m
    if ((m = path.match(/^\/app\/installations\/(\d+)\/access_tokens$/)) && method === 'POST')
      return json(201, { token: `ghs_test_${m[1]}_${ids++}`, expires_at: new Date(now() + 3600 * 1000).toISOString(), permissions: { contents: 'write' } })
    if ((m = path.match(/^\/app\/installations\/(\d+)$/))) return json(200, { id: Number(m[1]), account: { login: 'acme', type: 'Organization' }, repository_selection: 'selected', suspended_at: null })
    if (path === '/installation/repositories') return json(200, { total_count: repos.size, repositories: [...repos.keys()].map((full_name) => ({ full_name })) })
    if (!(m = path.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/))) return notFound()
    const repo = repos.get(m[1])
    if (!repo) return notFound()
    const rest = m[2] || ''
    if (rest === '' && method === 'GET') return json(200, { full_name: repo.fullName, default_branch: repo.defaultBranch, private: repo.private })
    if ((m = rest.match(/^\/branches\/(.+)$/))) {
      const sha = repo.branches.get(m[1])
      return sha ? json(200, { name: m[1], commit: { sha }, protected: repo.protected.has(m[1]) }) : notFound()
    }
    if ((m = rest.match(/^\/compare\/([^.]+)\.\.\.(.+)$/))) {
      const base = resolveRef(repo, m[1])
      const head = resolveRef(repo, m[2])
      if (!base || !head) return notFound()
      const commits = between(repo, base, head)
      return json(200, { status: commits.length ? 'ahead' : 'identical', ahead_by: commits.length, files: diff(repo, base, head), commits: commits.map((c) => ({ sha: c.sha, commit: { message: c.message }, parents: c.parents.map((p) => ({ sha: p })) })) })
    }
    if ((m = rest.match(/^\/contents\/(.+)$/))) {
      const ref = resolveRef(repo, url.searchParams.get('ref') || repo.defaultBranch)
      const text = repo.commits.get(ref)?.files.get(m[1])
      if (text === undefined) return notFound()
      return json(200, { type: 'file', path: m[1], size: Buffer.byteLength(text), encoding: 'base64', content: Buffer.from(text).toString('base64').replace(/(.{60})/g, '$1\n') })
    }
    if ((m = rest.match(/^\/tarball\/(.+)$/))) {
      const ref = resolveRef(repo, m[1])
      if (!ref) return notFound()
      const tar = gzipSync(writeTarball(repo.commits.get(ref).files, { top: `${repo.fullName.replace('/', '-')}-${ref.slice(0, 7)}/` }))
      return new Response(tar, { status: 200, headers: { 'content-type': 'application/x-gzip', 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': String(Math.floor(now() / 1000) + 3600) } })
    }
    if ((m = rest.match(/^\/pulls\/(\d+)\/files$/))) {
      const pr = repo.pulls.get(Number(m[1]))
      if (!pr) return notFound()
      const page = Number(url.searchParams.get('page') || 1)
      const all = diff(repo, pr.base.sha, pr.head.sha)
      return json(200, all.slice((page - 1) * 100, page * 100))
    }
    if ((m = rest.match(/^\/pulls\/(\d+)$/))) {
      const pr = repo.pulls.get(Number(m[1]))
      if (!pr) return notFound()
      if (method === 'PATCH') {
        Object.assign(pr, body)
        return json(200, pr)
      }
      return json(200, pr)
    }
    if ((m = rest.match(/^\/pulls\/(\d+)\/requested_reviewers$/))) return json(201, {})
    if (rest === '/pulls') {
      if (method === 'POST') {
        const number = Math.max(0, ...repo.pulls.keys()) + 1
        const pr = { number, title: body.title, body: body.body, head: { ref: body.head, sha: repo.branches.get(body.head) }, base: { ref: body.base, sha: repo.branches.get(body.base) }, state: 'open', draft: false, labels: [], merged: false }
        repo.pulls.set(number, pr)
        return json(201, pr)
      }
      const head = url.searchParams.get('head')?.split(':')[1]
      return json(200, [...repo.pulls.values()].filter((p) => p.state === 'open' && (!head || p.head.ref === head)))
    }
    if ((m = rest.match(/^\/issues\/(\d+)\/comments$/))) {
      const list = repo.comments.get(Number(m[1])) || []
      if (method === 'POST') {
        const comment = { id: ids++, body: body.body, user: { login: 'slatebox[bot]', type: 'Bot' }, performed_via_github_app: { slug: 'slatebox' } }
        list.push(comment)
        repo.comments.set(Number(m[1]), list)
        return json(201, comment)
      }
      const page = Number(url.searchParams.get('page') || 1)
      return json(200, list.slice((page - 1) * 100, page * 100))
    }
    if ((m = rest.match(/^\/issues\/comments\/(\d+)$/)) && method === 'PATCH') {
      for (const list of repo.comments.values()) {
        const c = list.find((x) => x.id === Number(m[1]))
        if (c) {
          c.body = body.body
          return json(200, c)
        }
      }
      return notFound()
    }
    if (rest === '/check-runs' && method === 'POST') {
      const run = { id: ids++, ...body }
      repo.checkRuns.push(run)
      return json(201, run)
    }
    if ((m = rest.match(/^\/git\/ref\/heads\/(.+)$/))) {
      const sha = repo.branches.get(m[1])
      return sha ? json(200, { ref: `refs/heads/${m[1]}`, object: { sha, type: 'commit' } }) : notFound()
    }
    if ((m = rest.match(/^\/git\/commits\/(\w+)$/))) {
      const c = repo.commits.get(m[1])
      return c ? json(200, { sha: c.sha, tree: { sha: `tree-${c.sha}` }, message: c.message, parents: c.parents.map((sha) => ({ sha })) }) : notFound()
    }
    if (rest === '/git/trees' && method === 'POST') {
      const base = repo.commits.get(`${body.base_tree}`.replace(/^tree-/, ''))
      const files = new Map(base.files)
      for (const entry of body.tree) files.set(entry.path, entry.content)
      const id = `t${ids++}`
      repo.trees.set(id, files)
      return json(201, { sha: id })
    }
    if (rest === '/git/commits' && method === 'POST') {
      const id = sha1(`${body.tree}:${body.message}`)
      repo.commits.set(id, { sha: id, files: repo.trees.get(body.tree), message: body.message, parents: body.parents })
      return json(201, { sha: id })
    }
    if (rest === '/git/refs' && method === 'POST') {
      const name = body.ref.replace(/^refs\/heads\//, '')
      if (repo.branches.has(name)) return json(422, { message: 'Reference already exists' })
      repo.branches.set(name, body.sha)
      return json(201, { ref: body.ref, object: { sha: body.sha } })
    }
    if ((m = rest.match(/^\/git\/refs\/heads\/(.+)$/)) && method === 'PATCH') {
      const current = repo.branches.get(m[1])
      // GitHub refuses a non-fast-forward without force.
      let at = body.sha
      let ok = false
      while (at) {
        if (at === current) {
          ok = true
          break
        }
        at = repo.commits.get(at)?.parents[0]
      }
      if (!ok && !body.force) return json(422, { message: 'Update is not a fast forward' })
      repo.branches.set(m[1], body.sha)
      return json(200, { ref: `refs/heads/${m[1]}`, object: { sha: body.sha } })
    }
    return notFound()
  }

  async function fetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const method = (init.method || 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, auth: init.headers?.authorization ?? null })
    return handle(method, url, body)
  }

  return {
    fetch,
    calls,
    repos,
    addRepo,
    commit,
    openPull,
    writes: () => calls.filter((c) => c.method !== 'GET' && !c.path.startsWith('/app/')),
    reset: () => calls.splice(0, calls.length),
  }
}
