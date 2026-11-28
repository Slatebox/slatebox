// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Rust: use crate::a::b (a module of the same crate), use other_crate::... (a Cargo workspace
// member, context.crates) and mod x; (a file beside this one).
import { dirname, joinPath } from './paths.mjs'

export const match = (path) => path.endsWith('.rs')

export function extract(path, text) {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const imports = new Set()
  for (const m of source.matchAll(/^\s*(?:pub(?:\([\w ]+\))?\s+)?use\s+([\w:]+)/gm)) imports.add(m[1])
  for (const m of source.matchAll(/^\s*(?:pub(?:\([\w ]+\))?\s+)?mod\s+(\w+)\s*;/gm)) imports.add(`mod:${m[1]}`)
  return { lang: 'rust', imports: [...imports].sort() }
}

const STD = new Set(['std', 'core', 'alloc', 'self', 'super'])

export function resolve(spec, from, { exists, context }) {
  const crate = (context?.crates || []).find((c) => from === c.dir || from.startsWith(`${c.dir}/`) || c.dir === '')
  if (spec.startsWith('mod:')) {
    const name = spec.slice(4)
    const here = dirname(from)
    const own = /(?:^|\/)(?:mod|lib|main)\.rs$/.test(from) ? here : joinPath(here, from.split('/').pop().replace(/\.rs$/, ''))
    for (const path of [joinPath(own, `${name}.rs`), joinPath(own, name, 'mod.rs')]) if (exists(path)) return { path }
    return null
  }
  const parts = spec.split('::')
  if (parts[0] === 'crate' && crate) {
    const src = joinPath(crate.dir, 'src')
    for (let k = parts.length; k > 1; k -= 1) {
      const rel = parts.slice(1, k).join('/')
      for (const path of [joinPath(src, `${rel}.rs`), joinPath(src, rel, 'mod.rs')]) if (exists(path)) return { path }
    }
    return null
  }
  if (STD.has(parts[0])) return null
  const member = (context?.crates || []).find((c) => c.name.replace(/-/g, '_') === parts[0])
  if (member) return { dir: member.dir }
  return { pkg: parts[0] }
}
