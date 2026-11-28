// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The changes the GitHub recipes may make outside Slatebox, each only after the runtime's
// permission check said allow (a standing grant the person gave this recipe) or a person approved
// its action card:
//   github.check_run      a neutral check on a pushed commit ("Slatebox architecture")
//   github.pr_comment     one comment on a pull request, found again by its marker and edited in place
//   github.pull_request   commits to a slatebox/* branch (Git Data API) and one open pull request from it
// Hard limits no grant lifts (checkHardLimits, and again against GitHub's answers here):
//   - never the default branch, never a protected branch, only refs/heads/slatebox/...
//   - never merge, never delete, never force a branch back (a ref only moves forward)
//   - only the paths the grant names, never a path with .. or a leading /
//   - only the repositories the grant names
import { matchAny } from '../../../../recipes/_github-code/glob.mjs'

export const GITHUB_WRITE_KINDS = Object.freeze(['github.check_run', 'github.pr_comment', 'github.pull_request'])
export const BRANCH_PREFIX = 'slatebox/'
export const COMMENT_MARKER = (marker) => `<!-- slatebox:${`${marker}`.replace(/[^\w:.#/-]/g, '')} -->`
const LIMITS = Object.freeze({ files: 40, fileBytes: 512 * 1024, commentChars: 60000, titleChars: 200, bodyChars: 60000 })

const refused = (reason) => ({ decision: 'refused', reason })
const branchOf = (ref) => `${ref ?? ''}`.replace(/^refs\/heads\//, '')
const badPath = (path) => typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').some((p) => p === '..' || p === '.' || p === '') || path.length > 400

/** 'refused' with a reason, or null. Pure: what a write asks, against the rules no grant lifts. */
export function checkHardLimits(write, grant = null) {
  if (!GITHUB_WRITE_KINDS.includes(write?.kind)) return refused('unknown_kind')
  if (write.merge || write.delete || write.body?.merge || write.body?.delete || write.body?.force) return refused('merge_or_delete')
  const repo = write.target?.repo
  if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return refused('bad_repo')
  if (grant?.scope?.repos && !grant.scope.repos.includes(repo)) return refused('repo_outside_grant')
  if (write.kind === 'github.pull_request') {
    const branch = branchOf(write.target.branch)
    if (!branch.startsWith(BRANCH_PREFIX) || branch.length <= BRANCH_PREFIX.length || /\.\.|[~^:?*[\\\s]/.test(branch)) return refused('branch_outside_slatebox')
    if (grant?.scope?.branchPrefix && !branch.startsWith(grant.scope.branchPrefix)) return refused('branch_outside_grant')
    const files = write.body?.files
    if (!Array.isArray(files) || !files.length || files.length > LIMITS.files) return refused('bad_files')
    for (const f of files) {
      if (badPath(f?.path) || typeof f.content !== 'string' || f.content.length > LIMITS.fileBytes) return refused('bad_files')
      if (grant?.scope?.paths && !matchAny(grant.scope.paths, f.path)) return refused('path_outside_grant')
    }
  }
  if (write.kind === 'github.pr_comment' && (!Number.isInteger(write.target?.number) || typeof write.body?.markdown !== 'string')) return refused('bad_comment')
  if (write.kind === 'github.check_run' && !/^[0-9a-f]{40}$/.test(`${write.target?.headSha ?? ''}`)) return refused('bad_commit')
  return null
}

const clip = (text, n) => `${text ?? ''}`.slice(0, n)

async function checkRun(client, write) {
  const out = await client.createCheckRun(write.target.repo, {
    name: clip(write.body?.name || 'Slatebox architecture', 100),
    head_sha: write.target.headSha,
    status: 'completed',
    conclusion: 'neutral',
    ...(write.body?.detailsUrl && /^https:\/\//.test(write.body.detailsUrl) && { details_url: write.body.detailsUrl }),
    output: { title: clip(write.body?.title || 'Architecture', 255), summary: clip(write.body?.summary || '', 65000) },
  })
  return { ref: String(out?.id ?? '') }
}

async function prComment(client, write) {
  const marker = COMMENT_MARKER(write.body.marker || write.key)
  // The slate's address, when the runtime resolved write.body.slate to it.
  const open = typeof write.body.slateUrl === 'string' && /^https:\/\/[^\s()]+$/.test(write.body.slateUrl) ? `\n\n[Open in Slatebox](${write.body.slateUrl})` : ''
  const body = `${clip(write.body.markdown, LIMITS.commentChars - marker.length - open.length - 2)}${open}\n\n${marker}`
  const comments = await client.issueComments(write.target.repo, write.target.number)
  // Ours: the marker, written by an app (a person quoting it is not ours).
  const mine = comments.find((c) => typeof c.body === 'string' && c.body.includes(marker) && (c.performed_via_github_app || c.user?.type === 'Bot'))
  if (mine) {
    if (mine.body === body) return { ref: String(mine.id), unchanged: true }
    await client.updateComment(write.target.repo, mine.id, body)
    return { ref: String(mine.id), edited: true }
  }
  const made = await client.createComment(write.target.repo, write.target.number, body)
  return { ref: String(made.id), created: true }
}

async function pullRequest(client, write) {
  const { repo } = write.target
  const branch = branchOf(write.target.branch)
  const info = await client.repo(repo)
  if (branch === info.default_branch) return { refused: 'default_branch' }
  const existing = await client.branch(repo, branch)
  if (existing?.protected) return { refused: 'protected_branch' }
  let parent = existing?.commit?.sha ?? null
  if (!parent) {
    const base = await client.branch(repo, info.default_branch)
    parent = base.commit.sha
  }
  // Only files whose text differs from the branch head go in the commit.
  const changed = []
  for (const f of write.body.files) {
    const now = await client.contents(repo, f.path, parent)
    if (now !== f.content) changed.push(f)
  }
  const trailer = write.body.trailer ? `\n\n${clip(write.body.trailer, 200)}` : ''
  let commitSha = parent
  if (changed.length) {
    const baseTree = (await client.commit(repo, parent)).tree.sha
    const tree = await client.createTree(repo, { base_tree: baseTree, tree: changed.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) })
    const commit = await client.createCommit(repo, { message: `${clip(write.body.message || 'Update architecture diagrams', 200)}${trailer}`, tree: tree.sha, parents: [parent] })
    commitSha = commit.sha
    if (existing) await client.updateRef(repo, branch, commitSha)
    else await client.createRef(repo, branch, commitSha)
  }
  const owner = repo.split('/')[0]
  const open = await client.openPulls(repo, owner, branch)
  const title = clip(write.body.title || 'Update architecture diagrams', LIMITS.titleChars)
  const body = clip(write.body.body || '', LIMITS.bodyChars)
  let number
  let opened = false
  if (Array.isArray(open) && open.length) {
    number = open[0].number
    if (open[0].title !== title || open[0].body !== body) await client.updatePull(repo, number, { title, body })
  } else if (changed.length) {
    // A pull request a person closed is not opened again for the same files: only for new changes.
    const made = await client.createPull(repo, { title, head: branch, base: info.default_branch, body, maintainer_can_modify: true })
    number = made.number
    opened = true
    const reviewers = (write.body.reviewers || []).filter((r) => /^[\w-]{1,39}$/.test(r)).slice(0, 10)
    if (reviewers.length) await client.requestReviewers(repo, number, reviewers)
  }
  return { ref: number ? String(number) : null, commit: changed.length ? commitSha : null, files: changed.map((f) => f.path), opened, unchanged: !changed.length }
}

/**
 * The write, done. Called only after the runtime's check said allow, or a person approved its card.
 * → { ref, ... } or { refused } (a hard limit GitHub's own answers showed)
 */
export async function performWrite(client, write, { grant = null } = {}) {
  const limit = checkHardLimits(write, grant)
  if (limit) return { refused: limit.reason }
  if (write.kind === 'github.check_run') return checkRun(client, write)
  if (write.kind === 'github.pr_comment') return prComment(client, write)
  return pullRequest(client, write)
}
