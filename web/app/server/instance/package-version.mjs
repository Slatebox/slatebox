// The version of an installed package, read from the package.json above one of its entry
// files (packages that declare exports do not export package.json itself).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

export function packageVersion(entryPath, name) {
  if (typeof entryPath !== 'string' || !isAbsolute(entryPath) || !existsSync(entryPath)) return null
  for (let dir = dirname(entryPath); dir !== dirname(dir); dir = dirname(dir)) {
    const file = join(dir, 'package.json')
    if (!existsSync(file)) continue
    try {
      const pkg = JSON.parse(readFileSync(file, 'utf8'))
      if (pkg.name === name) return typeof pkg.version === 'string' ? pkg.version : null
    } catch {
      return null
    }
  }
  return null
}
