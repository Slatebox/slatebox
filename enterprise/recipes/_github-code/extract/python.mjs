// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Python imports: import a.b, from a.b import c, and relative from . import x. Resolved against
// the package roots (the repository root, src/, and the folders pyproject/setup.cfg name).
import { dirname, joinPath } from './paths.mjs'

export const match = (path) => path.endsWith('.py')

export function extract(path, text) {
  const imports = new Set()
  const source = text.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, '')
  for (const m of source.matchAll(/^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm))
    for (const name of m[1].split(',')) imports.add(name.trim().split(/\s+as\s+/)[0])
  for (const m of source.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+\(?([\w*, \t]+)/gm)) {
    const names = m[2].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]).filter((n) => n && n !== '*')
    imports.add(m[1])
    for (const name of names) imports.add(`${m[1]}${m[1].endsWith('.') ? '' : '.'}${name}`)
  }
  return { lang: 'python', imports: [...imports].filter(Boolean).sort() }
}

const STDLIB = new Set(['os', 'sys', 're', 'json', 'typing', 'datetime', 'time', 'logging', 'collections', 'itertools', 'functools', 'pathlib', 'subprocess', 'asyncio', 'dataclasses', 'enum', 'abc', 'math', 'random', 'uuid', 'unittest', 'io', 'contextlib', 'copy', 'hashlib', 'base64', 'urllib', 'http', 'threading', 'tempfile', 'shutil', 'argparse', 'inspect', 'traceback', 'decimal', 'string', 'textwrap', 'warnings', 'weakref', 'socket', 'csv', 'pickle', 'glob', 'operator', 'types', '__future__'])

export function resolve(spec, from, { exists, context }) {
  let dotted = spec
  let roots = ['', 'src', ...(context?.pythonRoots || [])]
  if (spec.startsWith('.')) {
    const ups = spec.match(/^\.+/)[0].length
    let base = dirname(from)
    for (let k = 1; k < ups; k += 1) base = dirname(base)
    dotted = spec.slice(ups)
    roots = [base]
  } else if (STDLIB.has(spec.split('.')[0])) return null
  const rel = dotted.replace(/\./g, '/')
  for (const root of roots) {
    for (const candidate of rel ? [`${rel}.py`, `${rel}/__init__.py`] : ['__init__.py']) {
      const path = joinPath(root, candidate)
      if (exists(path)) return { path }
    }
  }
  // "from a.b import c" also names a.b itself; an unknown name is an outside package only at the top.
  if (spec.startsWith('.')) return null
  return { pkg: spec.split('.')[0] }
}
