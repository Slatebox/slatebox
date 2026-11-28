// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// A repository's facts at a commit, as cheaply as GitHub allows (catalog B0):
//   - the same commit as last time: no call
//   - a commit after the last one: 1 compare, then 1 contents call per changed file the scan reads
//     (at most 100), unless a context file changed (package.json, go.mod, CODEOWNERS, ...) or the
//     compare is truncated: then a full scan
//   - otherwise: 1 tarball call, only the paths the scan reads, files over 1 MB skipped
// Facts are paths and names (never file bodies), kept in the recipe's ledger between runs.
import { contextPath, patchContext } from './context.mjs'
import { extractFacts, scanFiles, wantedPath } from './model.mjs'

export const SCAN_LIMITS = Object.freeze({ incrementalFiles: 100 })
export const scanConfigKey = (config = {}) => JSON.stringify({ include: config.include || [], exclude: config.exclude || [], v: 1 })

/**
 * github: ctx.vendor.github; stored: { sha, configKey, facts, context } or null.
 * → { sha, configKey, facts, context, mode: 'same'|'incremental'|'full', changed: [paths], commits: [{ sha, message }], skipped }
 */
export async function factsAt(github, repo, sha, { config = {}, stored = null } = {}) {
  const configKey = scanConfigKey(config)
  if (stored && stored.sha === sha && stored.configKey === configKey) return { ...stored, mode: 'same', changed: [], commits: [], skipped: [] }
  if (stored?.sha && stored.configKey === configKey) {
    const cmp = await github.compare(repo, stored.sha, sha)
    const relevant = cmp.files.filter((f) => wantedPath(f.path, config) || (f.previous && wantedPath(f.previous, config)))
    let context = stored.context
    const contextFiles = relevant.filter((f) => contextPath(f.path) || (f.previous && contextPath(f.previous)))
    if (contextFiles.length && contextFiles.length <= 20 && relevant.length <= SCAN_LIMITS.incrementalFiles && !cmp.truncated) {
      const changes = []
      for (const f of contextFiles) {
        if (f.previous) changes.push({ path: f.previous, text: null })
        changes.push({ path: f.path, text: f.status === 'removed' ? null : await github.contents(repo, f.path, sha) })
      }
      context = patchContext(stored.context, changes)
    }
    if (context && cmp.status !== 'diverged' && !cmp.truncated && relevant.length <= SCAN_LIMITS.incrementalFiles) {
      const facts = { ...stored.facts }
      for (const f of relevant) {
        if (f.previous) delete facts[f.previous]
        if (f.status === 'removed') {
          delete facts[f.path]
          continue
        }
        if (!wantedPath(f.path, config) || (contextPath(f.path) && !extractsFrom(f.path))) continue
        const text = await github.contents(repo, f.path, sha)
        if (text === null) delete facts[f.path]
        else facts[f.path] = extractFacts(f.path, text)
      }
      return { sha, configKey, facts, context, mode: 'incremental', changed: relevant.map((f) => f.path), commits: cmp.commits, skipped: [] }
    }
    const full = await fullScan(github, repo, sha, config)
    return { ...full, configKey, commits: cmp.commits, changed: cmp.files.map((f) => f.path) }
  }
  return { ...(await fullScan(github, repo, sha, config)), configKey, commits: [], changed: [] }
}

async function fullScan(github, repo, sha, config) {
  const { files, skipped } = await github.tarball(repo, sha, { want: (path) => wantedPath(path, config) })
  const { facts, context } = scanFiles(files, config)
  return { sha, facts, context, mode: 'full', skipped: skipped.map((s) => s.path).slice(0, 50) }
}

/** A pull request's head: the base ({ facts, context }) with its changed files read again at the head. → { facts, context, read, unread } */
export async function headFacts(github, repo, base, files, headSha, { config = {}, maxFiles = 60 } = {}) {
  const facts = { ...base.facts }
  const read = []
  const unread = []
  // Context files the pull request changes (a new package.json, CODEOWNERS): read at the head.
  const contextChanges = []
  for (const f of files.filter((x) => contextPath(x.path) || (x.previous && contextPath(x.previous))).slice(0, 20)) {
    if (f.previous) contextChanges.push({ path: f.previous, text: null })
    contextChanges.push({ path: f.path, text: f.status === 'removed' ? null : await github.contents(repo, f.path, headSha) })
  }
  const context = contextChanges.length ? patchContext(base.context, contextChanges) ?? base.context : base.context
  for (const f of files) {
    if (f.previous) delete facts[f.previous]
    if (f.status === 'removed') {
      delete facts[f.path]
      continue
    }
    if (!wantedPath(f.path, config) || contextPath(f.path)) continue
    if (read.length >= maxFiles) {
      // past the cap: the file counts by its path only (its module is touched; its imports unknown)
      unread.push(f.path)
      if (!facts[f.path]) facts[f.path] = extractFacts(f.path, '')
      continue
    }
    const text = await github.contents(repo, f.path, headSha)
    read.push(f.path)
    if (text === null) delete facts[f.path]
    else facts[f.path] = extractFacts(f.path, text)
  }
  return { facts, context, read, unread }
}

const extractsFrom = (path) => Object.keys(extractFacts(path, '')).length > 0
