// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// What changed since a recipe's last run, from a compact signature per key kept in its cursor (the
// cursor stays well under its 64 KB). A recipe emits its own events from this, so an event fires
// once, for the instance it belongs to, whichever recipe folded the source.

export const SEEN_LIMIT = 1500

/** prev: { key: signature } from the cursor; next: Map(key → signature). → { added, changed, removed, seen } */
export function diffSeen(prev = {}, next) {
  const added = []
  const changed = []
  for (const [key, sig] of next) {
    if (!(key in prev)) added.push(key)
    else if (prev[key] !== sig) changed.push({ key, from: prev[key], to: sig })
  }
  const removed = Object.keys(prev).filter((key) => !next.has(key))
  const seen = Object.fromEntries([...next].slice(-SEEN_LIMIT))
  return { added, changed, removed, seen }
}
