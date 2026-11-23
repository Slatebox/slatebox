/**
 * One line naming the engine build this server runs, from its identity stamp (slateboxjs/build.json):
 * version, source commit, and whether that tree had uncommitted changes. An engine built before
 * stamps says so.
 */
export function engineIdentity(read) {
  let stamp
  try { stamp = read() } catch { return 'slateboxjs: no identity stamp (built before dist/BUILD.json).' }
  const commit = typeof stamp?.commit === 'string' ? stamp.commit.slice(0, 12) : 'unknown commit'
  return `slateboxjs ${stamp?.version ?? '?'} built from ${commit}${stamp?.branch ? ' (' + stamp.branch + ')' : ''}` +
    `${stamp?.dirty ? ' with uncommitted changes' : ''} at ${stamp?.builtAt ?? 'an unknown time'}.`
}
