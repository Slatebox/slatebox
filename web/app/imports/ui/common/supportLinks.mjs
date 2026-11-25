// Where Help and support goes (Main.jsx, components/HelpMenu.jsx). One list, so the menu, its tests and the docs page
// "Getting help" (docs.slatebox.com/using-slatebox/getting-help/) agree.
//
// The bug report opens GitHub's bug form (.github/ISSUE_TEMPLATE/bug_report.yml) with two fields filled in: the app's
// version and the browser. Nothing else about the person goes along: no name, email, user id, slate id, URL or
// hostname, and a self-hosted Slatebox is named only as "Self-hosted".
export const REPO = 'https://github.com/Slatebox/slatebox'
export const HELP_CENTER = 'https://docs.slatebox.com/'
export const COMMUNITY = 'https://support.slatebox.com/'
export const CONTACT = 'https://slatebox.com/contact/'
export const CLOUD_HOST = 'app.slatebox.com'

// "Chrome 131 on macOS" from a user agent string: the browser's name and major version, and the system's name only.
export function describeBrowser(userAgent = '') {
  const ua = String(userAgent)
  const pick = [
    ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/], ['Opera', /OPR\/(\d+)/], ['Samsung Internet', /SamsungBrowser\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/], ['Chrome', /(?:Chrome|CriOS)\/(\d+)/], ['Safari', /Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari\//],
  ].find(([, re]) => re.test(ua))
  const browser = pick ? `${pick[0]} ${ua.match(pick[1])[1]}` : 'Unknown browser'
  const system = [['iOS', /iPhone|iPad|iPod/], ['Android', /Android/], ['ChromeOS', /CrOS/], ['macOS', /Mac OS X|Macintosh/], ['Windows', /Windows/], ['Linux', /Linux/]]
    .find(([, re]) => re.test(ua))?.[0]
  return system ? `${browser} on ${system}` : browser
}

// The app's version: the commit it was built from (Meteor.gitCommitHash), shortened, or "unknown".
export function appVersion(commit) {
  return /^[0-9a-f]{7,40}$/i.test(String(commit || '')) ? String(commit).slice(0, 12) : 'unknown'
}

export function bugReportUrl({ commit, userAgent, host } = {}) {
  const params = new URLSearchParams({
    template: 'bug_report.yml',
    version: `${host === CLOUD_HOST ? 'app.slatebox.com' : 'Self-hosted'}, build ${appVersion(commit)}`,
    browser: describeBrowser(userAgent),
  })
  return `${REPO}/issues/new?${params.toString()}`
}

// The menu, in order. Each opens in a new tab so a slate in progress stays where it is.
export function helpLinks(context = {}) {
  return [
    { id: 'docs', label: 'Help center', detail: 'Guides at docs.slatebox.com', href: HELP_CENTER },
    { id: 'community', label: 'Ask the community', detail: 'Questions and ideas at support.slatebox.com', href: COMMUNITY },
    { id: 'bug', label: 'Report a bug', detail: 'Fills in the app version and your browser', href: bugReportUrl(context) },
    { id: 'contact', label: 'Contact us', detail: 'Private questions, answered by a person', href: CONTACT },
  ]
}
