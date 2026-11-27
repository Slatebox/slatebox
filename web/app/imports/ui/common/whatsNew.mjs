// What's new in Help and support (components/HelpMenu.jsx): a link to the public changelog at slatebox.com/changelog,
// which scripts/build-changelog.mjs in the site repository builds from the Highlights in this repository's CHANGELOG.md.
//
// The unread dot is about release lines, not every patch: every minor or major release carries Highlights (see
// docs/releasing.md), so a person who opened What's new on 2.1 sees the dot again at 2.2, not at 2.1.5. The line
// they last saw is kept in this browser only (localStorage); nothing is sent anywhere, and the version comes from
// release.json, which scripts/release.mjs moves with package.json.
export const CHANGELOG_URL = 'https://slatebox.com/changelog/'
export const SEEN_KEY = 'slatebox.whatsNew.seen'

/** "2.1" from "2.1.4"; '' for anything that is not a version. */
export function releaseLine(version) {
  const m = /^(\d+)\.(\d+)\.\d+(?:-[0-9A-Za-z.-]+)?$/.exec(String(version || ''))
  return m ? `${m[1]}.${m[2]}` : ''
}

/** The changelog, opened at this release line's newest entry (the site gives each line an id like v2-1). */
export function whatsNewUrl(version) {
  const line = releaseLine(version)
  return line ? `${CHANGELOG_URL}#v${line.replace('.', '-')}` : CHANGELOG_URL
}

/** True while the person has not opened What's new on this release line. */
export function isUnread(seen, version) {
  const line = releaseLine(version)
  return Boolean(line) && seen !== line
}

export function readSeen(storage) {
  try { return storage?.getItem(SEEN_KEY) || '' } catch { return '' }
}

export function markSeen(storage, version) {
  const line = releaseLine(version)
  try { if (line) storage?.setItem(SEEN_KEY, line) } catch { /* private window or blocked storage: the dot stays */ }
}
