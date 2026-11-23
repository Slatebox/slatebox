import { readFile } from 'node:fs/promises'

export function readReleaseVersion(changelog) {
  const match = changelog.match(/^## \[(\d+\.\d+\.\d+(?:-[^\]]+)?)\]/m)
  if (!match) throw new Error('No semantic release heading found in changelog')
  return match[1]
}

if (process.argv[1] === import.meta.filename) {
  const changelogPath = process.argv[2] || 'CHANGELOG.md'
  const changelog = await readFile(changelogPath, 'utf8')
  console.log(readReleaseVersion(changelog))
}
