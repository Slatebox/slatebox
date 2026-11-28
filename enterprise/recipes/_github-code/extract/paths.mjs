// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Repository paths (forward slashes, no leading slash), with no dependency on node:path.

export function normalize(path) {
  const out = []
  for (const part of `${path}`.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}
export const dirname = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
export const basename = (path) => path.slice(path.lastIndexOf('/') + 1)
export const joinPath = (...parts) => normalize(parts.filter((p) => p !== '' && p != null).join('/'))

/** The 1-based line a character offset sits on. */
export function lineAt(text, offset) {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1
  return line
}
