// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// JavaScript and TypeScript imports: import/export ... from, require(), dynamic import(). The raw
// specifiers are the file's facts; resolve() turns one into a repository path or an outside package
// using the workspace packages and tsconfig paths (context.mjs).
import { dirname, joinPath, normalize } from './paths.mjs'

export const match = (path) => /\.(?:[cm]?[jt]sx?)$/.test(path) && !/\.d\.[cm]?ts$/.test(path)

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1')

export function extract(path, text) {
  const source = stripComments(text)
  const found = new Set()
  const patterns = [
    /(?:^|[^\w$.])(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"\n]+)['"]/g,
    /(?:^|[^\w$.])require\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /(?:^|[^\w$.])import\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  ]
  for (const re of patterns) for (const m of source.matchAll(re)) found.add(m[1])
  return { lang: 'js', imports: [...found].sort() }
}

const BUILTINS = new Set(['assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dns', 'events', 'fs', 'http', 'http2', 'https', 'net', 'os', 'path', 'perf_hooks', 'process', 'querystring', 'readline', 'stream', 'string_decoder', 'timers', 'tls', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib'])
const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs']

function resolveFile(base, exists) {
  for (const ext of EXTENSIONS) {
    const candidate = normalize(base + ext)
    if (exists(candidate)) return candidate
  }
  return null
}

/**
 * A specifier from `from`. → { path } (a file in the repository), { pkg } (an outside package),
 * { dir } (a workspace package's folder, when its entry file is not known) or null (a builtin).
 */
export function resolve(spec, from, { exists, context }) {
  if (spec.startsWith('node:') || BUILTINS.has(spec.split('/')[0])) return null
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const path = resolveFile(spec.startsWith('/') ? spec.slice(1) : joinPath(dirname(from), spec), exists)
    return path ? { path } : { dir: normalize(joinPath(dirname(from), spec)) }
  }
  for (const [alias, targets] of Object.entries(context?.tsPaths || {})) {
    const star = alias.endsWith('*')
    const head = star ? alias.slice(0, -1) : alias
    if (star ? spec.startsWith(head) : spec === alias) {
      for (const target of targets) {
        const filled = star ? target.replace('*', spec.slice(head.length)) : target
        const path = resolveFile(normalize(joinPath(context.tsBase || '', filled)), exists)
        if (path) return { path }
      }
    }
  }
  const parts = spec.split('/')
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  const pkg = (context?.packages || []).find((p) => p.name === name)
  if (pkg) {
    const rest = spec.slice(name.length).replace(/^\//, '')
    const path = rest ? resolveFile(joinPath(pkg.dir, rest), exists) || resolveFile(joinPath(pkg.dir, `src/${rest}`), exists) : null
    return path ? { path } : { dir: pkg.dir }
  }
  return { pkg: name }
}
