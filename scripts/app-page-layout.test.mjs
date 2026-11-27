// One page layout for every page (owner, 2026-11-25: "we should use the same spacing layout for
// every page — manage team should use the full width like the other pages"). Every page the app
// routes renders inside AppPage (web/app/imports/ui/common/AppPage.jsx), so the title and the
// content start on the same left edge and run to the same right edge everywhere; no page keeps a
// centered column or side gutters of its own. A new page has to choose: AppPage, or a reason here.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = (path) => readFileSync(new URL(`../web/app/imports/ui/${path}`, import.meta.url), 'utf8')
const repo = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// page → the files that draw it (the first one renders <AppPage>; the rest render inside it)
const LAYOUT = {
  MySlates: ['components/DisplaySlates.jsx'],
  TeamSlates: ['components/DisplaySlates.jsx'],
  Team: ['pages/Team.jsx', 'components/teams/ManageOrganization.jsx', 'components/teams/BusinessPanel.jsx', 'components/teams/CreateOrganization.jsx'],
  Profile: ['pages/Profile.jsx'],
  GetPro: ['pages/GetPro.jsx'],
  TeamSettings: ['pages/TeamSettings.jsx'],
  BrandingSettings: ['pages/BrandingSettings.jsx'],
  AdminTools: ['pages/AdminTools.jsx', 'pages/admin/AdminOverview.jsx'],
  AIControl: ['pages/admin/ai/AIControl.jsx'],
  LibraryReview: ['pages/LibraryReview.jsx'],
  LibraryIntegrationReview: ['pages/LibraryIntegrationReview.jsx'],
  Updates: ['pages/admin/updates/Updates.jsx'],
  Growth: ['pages/admin/Growth.jsx'],
  Library: ['pages/Library.jsx'],
  MyLibrary: ['pages/MyLibrary.jsx'],
  LibraryItem: ['pages/LibraryItem.jsx'],
  Integrations: ['pages/Integrations.jsx'],
  NotFound: ['pages/NotFound.jsx'],
  // outside the app's frame (client/main.jsx): pads 24px as the main area does, then AppPage
  TeamMoveJoin: ['pages/TeamMoveJoin.jsx'],
}

// Routed pages that are not pages of the app's own: each says why.
const EXEMPT = {
  Canvas: 'the slate itself: the canvas runs edge to edge',
  AIPassthrough: 'a hand-off that shows a loading picture, then opens a slate',
  VerifyEmail: 'a sign-in card, centered as /login is',
  LoginLink: 'a sign-in card, centered as /login is',
  ResetPassword: 'a sign-in card, centered as /login is',
  RecoverPassword: 'a sign-in card, centered as /login is',
  SignUp: 'starts a guest and goes to My slates',
}

const routed = () => {
  const routes = ui('SBRoutes.jsx')
  const names = new Set()
  for (const [, name] of routes.matchAll(/import (\w+) from '\.\/pages\/[\w/]+'/g)) names.add(name)
  for (const [, name] of routes.matchAll(/const (\w+) = lazy\(\(\) => import\('\.\/pages\/[\w/]+'\)\)/g)) names.add(name)
  return names
}

test('every page the app routes is drawn by AppPage, or says why not', () => {
  const names = routed()
  assert.ok(names.size >= 20, `read ${names.size} routed pages from SBRoutes.jsx`)
  for (const name of names) {
    assert.ok(LAYOUT[name] || EXEMPT[name], `${name} is routed: render it in <AppPage> (common/AppPage.jsx) and list it here`)
  }
  assert.match(repo('web/app/client/main.jsx'), /path="\/team-move\/join" element={<TeamMoveJoin \/>}/)
  for (const [name, [file]] of Object.entries(LAYOUT)) {
    assert.match(ui(file), /<AppPage\b/, `${name}: ${file} renders <AppPage>`)
    assert.match(ui(file), /import AppPage(, \{[^}]*\})? from '(\.\.\/)+common\/AppPage'/, `${name}: ${file} imports the shared layout`)
  }
  // the slates pages are the two that use DisplaySlates
  assert.match(ui('pages/MySlates.jsx'), /<DisplaySlates type="mine" \/>/)
  assert.match(ui('pages/TeamSlates.jsx'), /<DisplaySlates type="team" \/>/)
})

test('no page keeps a centered column, a page-wide max width or gutters of its own', () => {
  const files = new Set([...Object.values(LAYOUT).flat(), 'pages/MySlates.jsx', 'pages/TeamSlates.jsx'])
  for (const file of files) {
    const source = ui(file)
    assert.doesNotMatch(source, /<Container\b/, `${file}: a MUI Container centers and pads the page; AppPage owns the edges`)
    assert.doesNotMatch(source, /\bmx: 'auto'|margin: '0 auto'|marginLeft: 'auto', marginRight: 'auto'/, `${file}: no centered column`)
    assert.doesNotMatch(source, /\bmx: \{ xs: -/, `${file}: no page-level negative gutter`)
    for (const [, width] of source.matchAll(/maxWidth: (\d+|COLUMN_WIDTH)\b/g)) {
      assert.ok(width !== 'COLUMN_WIDTH' && Number(width) < 760, `${file}: maxWidth ${width} narrows the page (fields and lines may stay narrow; the page may not)`)
    }
    assert.doesNotMatch(source, /minmax\(0, \d+px\)/, `${file}: a capped content column`)
  }
})

test('the title row is the shared one: one h1, drawn by AppPageHeader', () => {
  // The 404 is a message in the middle of the page (as an empty list's is), so its h1 is its own;
  // it still sits in AppPage's edges.
  const pages = Object.values(LAYOUT).flat().filter((file) => file !== 'pages/NotFound.jsx')
  for (const file of new Set(pages)) {
    assert.doesNotMatch(ui(file), /component="h1"/, `${file}: the h1 comes from AppPage's title row (title=, or AppPageHeader)`)
  }
  // pages whose title row is drawn further down render AppPageHeader there, inside AppPage
  assert.match(ui('components/teams/ManageOrganization.jsx'), /<AppPageHeader\b/)
  assert.match(repo('enterprise/client/IntegrationsPage.jsx'), /<AppPageHeader\b/)
  assert.doesNotMatch(repo('enterprise/client/IntegrationsPage.jsx'), /component="h1"/)
  // the slates pages pass their own bar (title, search, paging) as the header
  assert.match(ui('components/DisplaySlates.jsx'), /<AppPage\s+fill[\s\S]*?header=\{/)
})

test('AppPage: full width, the slates pages\' edge, one rhythm; maxWidth only when asked', () => {
  const page = ui('common/AppPage.jsx')
  assert.match(page, /export const PAGE_GUTTER = 1\b/)
  assert.match(page, /px: PAGE_GUTTER, pt: PAGE_GUTTER/)
  assert.match(page, /width: '100%'/)
  assert.match(page, /\.\.\.\(maxWidth \? \{ maxWidth \} : \{\}\)/)
  assert.doesNotMatch(page, /mx: 'auto'/)
  assert.match(page, /header: 3,/)
  assert.match(page, /component="h1"/)
  // the main area around every page pads 24px; AppPage's 8px makes the 32px edge
  assert.match(ui('components/MainPaper.jsx'), /p: isOnCanvas \|\| embeddedSlate \? 0 : 3/)
  // outside the frame the join page pads the same 24px itself
  assert.match(ui('pages/TeamMoveJoin.jsx'), /<Box sx=\{\{ p: 3 \}\}>\s*<AppPage/)
})

test('Manage team stretches its cards across the page like Team slates\' grid', () => {
  const team = ui('pages/Team.jsx')
  assert.doesNotMatch(team, /maxWidth/)
  assert.match(team, /<AppPage data-team-route=""/)
  const manage = ui('components/teams/ManageOrganization.jsx')
  assert.match(manage, /data-team-page="" sx=\{\{ display: 'grid'/)
  assert.doesNotMatch(manage, /data-team-page=""[^>]*maxWidth/)
})
