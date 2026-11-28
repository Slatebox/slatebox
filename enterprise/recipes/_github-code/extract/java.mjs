// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Java and Kotlin: each file's package, and the packages it imports (import a.b.C names a.b).

export const match = (path) => /\.(java|kt)$/.test(path)

export function extract(path, text) {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const pkg = source.match(/^\s*package\s+([\w.]+)/m)?.[1] ?? null
  const imports = new Set()
  for (const m of source.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+)(\.\*)?\s*;?/gm)) {
    const parts = m[1].split('.')
    // A class (Capitalized) names its package; a static member names its class's package.
    while (parts.length > 1 && /^[A-Z_]/.test(parts[parts.length - 1])) parts.pop()
    imports.add(parts.join('.'))
  }
  return { lang: 'java', package: pkg, imports: [...imports].sort() }
}

export function resolve(spec, from, { packages }) {
  if (/^(java|javax|kotlin|kotlinx)\./.test(spec) || ['java', 'javax', 'kotlin'].includes(spec)) return null
  const files = packages.get(spec)
  if (files?.length) return { path: files[0], files }
  return { pkg: spec.split('.').slice(0, 2).join('.') }
}
