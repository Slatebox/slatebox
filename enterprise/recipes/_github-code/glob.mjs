// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Path globs as people write them in config and CODEOWNERS: * (within a folder), ** (any folders),
// ?, {a,b}, a leading / (from the repository root) and a trailing / (a folder and all under it).
// A pattern with no slash matches a name at any depth (CODEOWNERS and .gitignore read it so).

const cache = new Map()

function toRegex(pattern) {
  let p = `${pattern}`.trim()
  const anchored = p.startsWith('/') || p.slice(0, -1).includes('/')
  p = p.replace(/^\//, '')
  if (p.endsWith('/')) p += '**'
  let out = ''
  for (let i = 0; i < p.length; i += 1) {
    const ch = p[i]
    if (ch === '*') {
      if (p[i + 1] === '*') {
        const slash = p[i + 2] === '/'
        out += slash ? '(?:.*/)?' : '.*'
        i += slash ? 2 : 1
      } else out += '[^/]*'
    } else if (ch === '?') out += '[^/]'
    else if (ch === '{') {
      const end = p.indexOf('}', i)
      if (end < 0) out += '\\{'
      else {
        out += `(?:${p.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`
        i = end
      }
    } else out += ch.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  // A folder pattern also matches what is under it.
  return new RegExp(`${anchored ? '^' : '(?:^|/)'}${out}(?:/.*)?$`)
}

/** Whether a repository path matches a glob. */
export function matchGlob(pattern, path) {
  if (!cache.has(pattern)) {
    if (cache.size > 2000) cache.clear()
    cache.set(pattern, toRegex(pattern))
  }
  return cache.get(pattern).test(path)
}

/** Whether a path matches any of the globs. */
export const matchAny = (patterns, path) => (patterns || []).some((pattern) => matchGlob(pattern, path))
