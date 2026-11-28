// XJ-1 Release map from Linear and GitHub, through the real recipes runtime with the real Linear
// vendor over a faked Linear GraphQL and a GitHub session over recorded releases and compares: a
// frame per release with the Linear issues its commits name, each project's progress before → after,
// the "Shipped but not closed in Linear" board emptying as Linear closes them, a release read once,
// another team's look-alike ids (UTF-8) never read, and GitHub's release event as its trigger.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-linear-release-map.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import XJ1 from '../enterprise/recipes/linear-release-map/index.mjs'
import { validateManifest } from '../enterprise/common/recipes/manifest.mjs'
import { matchFor } from '../enterprise/server/recipes/service.mjs'
import { createVendor } from '../enterprise/server/recipes/vendors/linear/index.mjs'
import { triggerOf as githubTriggerOf } from '../enterprise/server/recipes/vendors/github/routes.mjs'
import { createGithubClient } from '../enterprise/server/recipes/vendors/github/client.mjs'
import { identifiersIn } from '../enterprise/recipes/_linear/workgraph.mjs'
import { ORG, P, PROJECTS, TEAMS, NOW, RELEASE_ISSUES } from '../enterprise/recipes/_linear/fixtures/acme.mjs'
import { fakeLinear } from './fakes/linear-api.mjs'
import { createRecipeWorld } from './fakes/recipe-world.mjs'

const REPO = 'acme/platform'
const RELEASES = [
  { tag: 'v1.5.0', name: 'v1.5.0', publishedAt: '2026-11-25T10:00:00Z', url: 'https://github.com/acme/platform/releases/tag/v1.5.0', prerelease: false },
  { tag: 'v1.4.0', name: 'v1.4.0', publishedAt: '2026-11-18T10:00:00Z', url: 'https://github.com/acme/platform/releases/tag/v1.4.0', prerelease: false },
  { tag: 'v1.3.0', name: 'v1.3.0', publishedAt: '2026-11-10T10:00:00Z', url: 'https://github.com/acme/platform/releases/tag/v1.3.0', prerelease: false },
]
const COMMITS = {
  'v1.4.0...v1.5.0': ['Merge pull request #41 from acme/eng-202-rules-ui', 'WEB-31: checkout button', 'Bump UTF-8 handling', 'Fixes WEB-77'],
  'v1.3.0...v1.4.0': ['ENG-201 fraud rule engine', 'PAY-11 ledger hook (#38)'],
}

function setup({ releases = RELEASES, commits = COMMITS } = {}) {
  const issues = structuredClone(RELEASE_ISSUES)
  const projects = structuredClone(PROJECTS)
  const fake = fakeLinear({ issues, projects })
  const linear = createVendor({ accountOf: async () => ({ status: 'active', organizationId: ORG }), tokenFor: async () => 'tok', fetch: fake.fetch, deliveries: { claim: async () => true }, later: (fn) => fn() })
  const gh = { calls: [], list: releases }
  const github = {
    releases: async (repo) => { gh.calls.push(['releases', repo]); return structuredClone(gh.list) },
    compare: async (repo, base, head, options) => { gh.calls.push(['compare', `${base}...${head}`, options]); return { commits: (commits[`${base}...${head}`] || []).map((message, n) => ({ sha: String(n).repeat(40), message })) } },
  }
  const w = createRecipeWorld({ recipes: [XJ1], realVendors: { linear }, vendors: { github }, now: NOW })
  const drive = w.projects.addDrive({ ownerId: 'ana', name: 'Releases' })
  const ana = w.person('ana')
  let id = null
  const start = async (config = {}) => {
    const { recipe } = await w.service.create(ana, drive, { recipeId: 'linear-release-map', config: { repos: [REPO], teams: [TEAMS.ENG.id, TEAMS.WEB.id, TEAMS.PAY.id], ...config } })
    id = recipe.instanceId
    await w.service.activate(ana, id)
    return (await w.drain())[0]
  }
  const again = async () => {
    w.advance(60_000)
    await w.service.runNow(ana, id)
    return (await w.drain())[0]
  }
  const slateId = async () => (await w.store.instances.findOne({ _id: id })).slateMap.releases
  return { w, fake, gh, issues, projects, start, again, slateId, id: () => id }
}

test('the manifest reads Linear and GitHub, writes nothing, and runs on GitHub\'s release event', () => {
  assert.equal(validateManifest(XJ1.manifest), null)
  assert.deepEqual(Object.keys(XJ1.manifest.needs), ['linear', 'github'])
  assert.deepEqual(XJ1.manifest.writes, [])
  assert.equal(XJ1.manifest.triggers.find((t) => t.default).event, 'github.release')
  assert.deepEqual(matchFor(XJ1.manifest, { repos: [REPO], teams: [TEAMS.ENG.id] }), { linear: { organizationId: null, teams: [TEAMS.ENG.id] }, github: { installationId: null, repos: [REPO] } }, 'GitHub\'s events find it by repository too')
})

test('GitHub\'s release event: published releases only; drafts and edits are not one', () => {
  const body = (action, draft = false) => ({ action, release: { tag_name: 'v2.0.0', draft, prerelease: false }, repository: { full_name: REPO }, installation: { id: 42 } })
  assert.deepEqual(githubTriggerOf('release', body('published')).trigger, { kind: 'vendor', event: 'github.release', repo: REPO, tag: 'v2.0.0', prerelease: false })
  assert.equal(githubTriggerOf('release', body('edited')), null)
  assert.equal(githubTriggerOf('release', body('published', true)), null)
})

test('the GitHub client reads releases (no drafts, https links only)', async () => {
  const fetch = async (url) => {
    assert.match(String(url), /\/repos\/acme\/platform\/releases\?per_page=20$/)
    return new Response(JSON.stringify([{ tag_name: 'v2', name: null, published_at: '2026-11-01T00:00:00Z', html_url: 'https://github.com/acme/platform/releases/tag/v2', prerelease: false, draft: false }, { tag_name: 'v3', draft: true }]), { status: 200 })
  }
  const client = createGithubClient({ fetch, installationId: '42', token: async () => 't' })
  assert.deepEqual(await client.releases(REPO), [{ tag: 'v2', name: 'v2', publishedAt: '2026-11-01T00:00:00Z', url: 'https://github.com/acme/platform/releases/tag/v2', prerelease: false }])
})

test('issue ids are read from commit messages and merged branch names, only for the picked teams', () => {
  assert.deepEqual(identifiersIn(COMMITS['v1.4.0...v1.5.0'], { teams: ['ENG', 'WEB', 'PAY'] }), ['ENG-202', 'WEB-31', 'WEB-77'])
  assert.deepEqual(identifiersIn(['UTF-8 and ENG-0 and ENG-12345678'], { teams: ['UTF', 'ENG'] }), ['UTF-8'], 'ENG-0 and an 8-digit number are not ids')
})

test('a frame per release with its issues and each project\'s progress; the drift board holds what is still open', async () => {
  const s = setup()
  const first = await s.start()
  assert.equal(first.state, 'done', JSON.stringify(first.run?.log))
  const slateId = await s.slateId()
  s.w.slates.keepAll(slateId)
  const texts = s.w.slates.notesOf(slateId).map((n) => n.text)
  assert.ok(texts.includes('acme/platform v1.4.0 · Nov 18'))
  assert.ok(texts.includes('acme/platform v1.5.0 · Nov 25'))
  assert.ok(texts.includes('acme/platform v1.3.0 · Nov 10'))
  assert.ok(texts.includes('The first release here: nothing to compare it with.'))
  assert.ok(texts.includes('ENG-201 Issue ENG-201\nFraud rules'))
  assert.ok(texts.includes('ENG-202 Issue ENG-202\nFraud rules\nnot closed in Linear'))
  assert.ok(texts.includes('WEB-77 Issue WEB-77\nnot closed in Linear'), 'an issue with no project')
  assert.ok(texts.includes('Fraud rules: progress at this release not recorded'), 'releases already out when the recipe is added: their progress then is not known')
  assert.ok(!texts.some((t) => /Fraud rules: \d+%/.test(t)), 'never today\'s progress shown as then')
  const board = [...s.w.slates.boards.entries()].find(([k]) => k.startsWith(`${slateId}:`))[1]
  assert.equal(board.title, 'Shipped but not closed in Linear')
  assert.deepEqual(board.cards.map((c) => c.label).sort(), ['ENG-202 Issue ENG-202 · v1.5.0', 'WEB-77 Issue WEB-77 · v1.5.0'])
  assert.deepEqual(board.lanes.map((l) => l.label), ['Not started', 'In progress'])
  assert.deepEqual(s.gh.calls.filter((c) => c[0] === 'compare').map((c) => c[1]).sort(), ['v1.3.0...v1.4.0', 'v1.4.0...v1.5.0'])
  assert.equal(s.fake.mutations.length, 0, 'it never writes to Linear')
  assert.deepEqual(first.result.emitted.filter((e) => e.type === 'release_map.drift').map((e) => e.data.issue).sort(), ['ENG-202', 'WEB-77'])
})

test('a release is read once; Linear closing an issue takes it off the board and turns its note grey', async () => {
  const s = setup()
  await s.start()
  const compares = s.gh.calls.filter((c) => c[0] === 'compare').length
  s.issues['ENG-202'].done = true
  const out = await s.again()
  assert.equal(out.state, 'done')
  assert.equal(s.gh.calls.filter((c) => c[0] === 'compare').length, compares, 'no compare again for a release already read')
  const slateId = await s.slateId()
  const board = [...s.w.slates.boards.entries()].find(([k]) => k.startsWith(`${slateId}:`))[1]
  assert.deepEqual(board.cards.map((c) => c.label), ['WEB-77 Issue WEB-77 · v1.5.0'])
})

test('a new release adds its frame; the oldest past the limit leaves', async () => {
  const s = setup()
  await s.start({ releases: 3 })
  s.gh.list = [{ tag: 'v1.6.0', name: 'v1.6.0', publishedAt: '2026-11-27T09:00:00Z', url: null, prerelease: false }, ...RELEASES]
  const out = await s.again()
  assert.equal(out.state, 'done')
  assert.deepEqual(s.gh.calls.filter((c) => c[0] === 'compare').map((c) => c[1]).slice(-1), ['v1.5.0...v1.6.0'])
  const slateId = await s.slateId()
  s.w.slates.keepAll(slateId)
  const texts = s.w.slates.notesOf(slateId).map((n) => n.text)
  assert.ok(texts.includes('acme/platform v1.6.0 · Nov 27'))
  assert.ok(texts.includes('No Linear issues named in its commits.'))
  assert.equal(out.result.emitted.filter((e) => e.type === 'release_map.updated').length, 1)
})

test('progress is recorded for releases published after the recipe was added, and compared release to release', async () => {
  const commits = { ...COMMITS, 'v1.5.0...v1.6.0': ['ENG-202 rules ui'], 'v1.6.0...v1.7.0': ['ENG-201 rule engine follow-up'] }
  const s = setup({ commits })
  await s.start()
  s.gh.list = [{ tag: 'v1.6.0', name: 'v1.6.0', publishedAt: '2026-11-27T11:00:00Z', url: null, prerelease: false }, ...RELEASES]
  await s.again()
  s.projects.find((p) => p.id === P.p5).progress = 0.55
  s.w.advance(86400000)
  s.gh.list = [{ tag: 'v1.7.0', name: 'v1.7.0', publishedAt: '2026-11-28T11:00:00Z', url: null, prerelease: false }, ...s.gh.list]
  const out = await s.again()
  assert.equal(out.state, 'done')
  const slateId = await s.slateId()
  s.w.slates.keepAll(slateId)
  const texts = s.w.slates.notesOf(slateId).map((n) => n.text)
  assert.ok(texts.includes('Fraud rules: 40% done'), 'v1.6.0: its progress then, nothing recorded before it')
  assert.ok(texts.includes('Fraud rules: 40% → 55% done'), 'v1.7.0 against v1.6.0')
})

test('a commit naming an issue Linear does not have (a typo, deleted) leaves the release recorded with the rest', async () => {
  const commits = { ...COMMITS, 'v1.4.0...v1.5.0': [...COMMITS['v1.4.0...v1.5.0'], 'ENG-99999 typo in the id'] }
  const s = setup({ commits })
  const first = await s.start()
  assert.equal(first.state, 'done', JSON.stringify(first.run?.log))
  const slateId = await s.slateId()
  s.w.slates.keepAll(slateId)
  const texts = s.w.slates.notesOf(slateId).map((n) => n.text)
  assert.ok(texts.includes('ENG-202 Issue ENG-202\nFraud rules\nnot closed in Linear'))
  assert.ok(!texts.some((t) => t.startsWith('ENG-99999')))
  const compares = s.gh.calls.filter((c) => c[0] === 'compare').length
  assert.equal((await s.again()).state, 'done')
  assert.equal(s.gh.calls.filter((c) => c[0] === 'compare').length, compares, 'recorded once, not read again')
})

test('a release\'s commits are read newest first: the compare asks GitHub with no paging (250, ending at the newest)', async () => {
  const s = setup()
  await s.start()
  for (const c of s.gh.calls.filter((x) => x[0] === 'compare')) assert.deepEqual(c[2], { newest: true })
  const urls = []
  const fetch = async (url) => {
    urls.push(String(url))
    return new Response(JSON.stringify({ status: 'ahead', files: [], commits: Array.from({ length: 180 }, (_, n) => ({ sha: String(n).padStart(40, '0'), commit: { message: `ENG-${n + 1} change` }, parents: [{}] })) }), { status: 200 })
  }
  const client = createGithubClient({ fetch, installationId: '42', token: async () => 't' })
  const got = await client.compare(REPO, 'v1.4.0', 'v1.5.0', { newest: true })
  assert.equal(got.commits.length, 180)
  assert.ok(!urls[0].includes('per_page'), urls[0])
  await client.compare(REPO, 'v1.4.0', 'v1.5.0')
  assert.match(urls[1], /per_page=100/, 'other callers keep their page of 100')
})
