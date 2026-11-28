// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// CODEOWNERS (root, .github/ or docs/): the rules in order; the last that matches a path wins, as
// GitHub reads them. A module's owner is the owner most of its files have.
import { matchGlob } from '../glob.mjs'

export const match = (path) => /^(?:\.github\/|docs\/)?CODEOWNERS$/.test(path)

export function parseCodeowners(text) {
  const rules = []
  for (const raw of `${text ?? ''}`.split('\n')) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim()
    if (!line) continue
    const [pattern, ...owners] = line.split(/\s+/)
    rules.push({ pattern, owners: owners.filter((o) => /^@|@/.test(o)).slice(0, 5) })
  }
  return rules
}

/** The owners of a path (the last matching rule), or []. */
export function ownersOf(rules, path) {
  let owners = []
  for (const rule of rules || []) if (matchGlob(rule.pattern, path)) owners = rule.owners
  return owners
}

/** The owner most of these files have, or null. */
export function moduleOwner(rules, files) {
  const counts = new Map()
  for (const file of files) {
    const owner = ownersOf(rules, file)[0]
    if (owner) counts.set(owner, (counts.get(owner) || 0) + 1)
  }
  let best = null
  for (const [owner, n] of counts) if (!best || n > best[1] || (n === best[1] && owner < best[0])) best = [owner, n]
  return best ? best[0] : null
}
