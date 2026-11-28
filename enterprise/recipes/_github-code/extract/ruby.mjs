// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Ruby: require_relative 'x' (beside this file) and require 'x' (lib/x.rb when it is ours).
import { dirname, joinPath } from './paths.mjs'

export const match = (path) => path.endsWith('.rb') && !/(?:^|\/)config\/routes\.rb$/.test(path)

export function extract(path, text) {
  const imports = new Set()
  for (const m of text.matchAll(/^\s*require_relative\s+['"]([^'"]+)['"]/gm)) imports.add(`./${m[1]}`)
  for (const m of text.matchAll(/^\s*require\s+['"]([^'"]+)['"]/gm)) imports.add(m[1])
  return { lang: 'ruby', imports: [...imports].sort() }
}

export function resolve(spec, from, { exists }) {
  if (spec.startsWith('./')) {
    const base = joinPath(dirname(from), spec.slice(2))
    const path = base.endsWith('.rb') ? base : `${base}.rb`
    return exists(path) ? { path } : null
  }
  for (const path of [joinPath('lib', `${spec}.rb`), joinPath('app', `${spec}.rb`)]) if (exists(path)) return { path }
  return { pkg: spec.split('/')[0] }
}
