// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Go imports, resolved through go.mod's module path (context.goModules): an import under the
// module is a folder of the repository; the standard library (no dot in the first part) is left out.

export const match = (path) => path.endsWith('.go') && !path.endsWith('_test.go') && !path.endsWith('.pb.go')

export function extract(path, text) {
  const imports = new Set()
  const source = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  for (const m of source.matchAll(/^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm)) imports.add(m[1])
  for (const block of source.matchAll(/^\s*import\s*\(([\s\S]*?)\)/gm))
    for (const m of block[1].matchAll(/(?:^|\n)\s*(?:[\w.]+\s+)?"([^"]+)"/g)) imports.add(m[1])
  return { lang: 'go', imports: [...imports].sort() }
}

export function resolve(spec, from, { context }) {
  if (!spec.split('/')[0].includes('.')) return null
  for (const mod of context?.goModules || []) {
    if (spec === mod.module || spec.startsWith(`${mod.module}/`)) {
      const rel = spec.slice(mod.module.length).replace(/^\//, '')
      const dir = [mod.dir, rel].filter(Boolean).join('/')
      return { dir }
    }
  }
  return { pkg: spec.split('/').slice(0, 3).join('/') }
}
