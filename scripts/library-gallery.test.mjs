// The library gallery (library spec §7.1, §7.6): what /library and /library/<slug> read and do, through the same
// library.* actions the pages call. The list filters by kind and category; a visitor sees published items only; a
// guest's copy is a private slate that remembers where it came from; a component goes on a new slate or beside a
// slate's boards (a preview first, at most 8 boards); every use is counted; slatebox.com's ?copy=1 runs once. Also
// the gallery's words (galleryCopy.mjs) and the item page's head for share previews (server/library/item-meta.mjs).
// scripts/library-gallery.spec.mjs runs the same flows in a browser.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { makeExecWorld } from './exec-test-world.mjs'
import { principalFromUser } from '../web/app/server/actions/principal.mjs'
import { API_TOKEN_SCOPES } from '../web/app/server/api-token-core.mjs'
import {
  authorLine, CATEGORY_CHIPS, countLine, forkErrorText, galleryQuery, KIND_TABS, licenseLine, listInput, provenanceLine, readCopyRequest,
  readGalleryQuery, usesLine, versionLine,
} from '../web/app/imports/ui/components/library/gallery/galleryCopy.mjs'
import { libraryItemHead, librarySlugOf } from '../web/app/server/library/item-meta.mjs'

const visitor = { kind: 'visitor', userId: null, scopes: [] }

async function setup(t) {
  const world = makeExecWorld()
  t.after(() => world.close())
  await world.libraryReady
  world.users.docs.push({ _id: 'guest1', isAnonymous: true })
  const person = userId => principalFromUser(world.users.docs.find(user => user._id === userId), API_TOKEN_SCOPES)
  const run = (principal, id, input, options) => world.registry.run(principal, id, input, options).then(result => result.body)
  return { world, person, run }
}

// Ada's slate published to the library (submitted, then approved by the administrator).
async function publishedSlate(env, { shareId = 'demo', summary = 'A welcome note and a second one', category = 'plan' } = {}) {
  const ada = env.person('owner')
  const { itemId } = await env.run(ada, 'library.submit', { kind: 'slate', shareId, summary, category }, { confirmed: true })
  await env.run(env.person('admin'), 'library.review.open', { itemId })
  await env.run(env.person('admin'), 'library.review.approve', { itemId }, { confirmed: true })
  return itemId
}

test('the list filters by kind and category, and a visitor sees published items only', async (t) => {
  const env = await setup(t)
  const slateId = await publishedSlate(env)
  // A submission waiting for review is in nobody's gallery.
  await env.run(env.person('owner'), 'library.submit', { kind: 'slate', shareId: 'many', summary: 'Many notes' }, { confirmed: true })

  const all = await env.run(visitor, 'library.list', listInput({}))
  assert.equal(all.total, 20)
  const slates = await env.run(visitor, 'library.list', listInput({ kind: 'slate' }))
  assert.deepEqual(slates.items.map(item => item.id), [slateId])
  const decide = await env.run(visitor, 'library.list', listInput({ kind: 'component', category: 'decide' }))
  assert.ok(decide.items.length > 0)
  assert.ok(decide.items.every(item => item.kind === 'component' && item.category === 'decide'))
  assert.ok(decide.items.some(item => item.slug === 'pros-cons'))
  const plan = await env.run(visitor, 'library.list', listInput({ category: 'plan' }))
  assert.ok(plan.items.some(item => item.id === slateId) && plan.items.some(item => item.kind === 'component'))
  const found = await env.run(visitor, 'library.list', listInput({ q: 'pros' }))
  assert.ok(found.items.some(item => item.slug === 'pros-cons'))
  // The item page: a published item reads; anything else is not found for a visitor.
  const page = await env.run(visitor, 'library.get', { itemId: 'pros-cons' })
  assert.equal(page.version.content.kind, 'component')
  assert.equal(page.item.status, undefined)
  const waiting = env.world.library.items.docs.find(doc => doc.status === 'submitted')
  await assert.rejects(env.run(visitor, 'library.get', { itemId: waiting.slug }), { status: 404 })
  // The count line reads the stats.
  assert.equal(countLine(await env.run(visitor, 'library.stats', {})), '19 smart components, 1 slate, 0 presentations')
})

test('a guest opens a copy of a published slate: a private slate of theirs, its provenance kept; copies count once per signed-in person', async (t) => {
  const env = await setup(t)
  const itemId = await publishedSlate(env)
  const guest = env.person('guest1')
  const made = await env.run(guest, 'library.fork', { itemId })
  const copy = env.world.slate(made.shareId)
  assert.equal(copy.userId, 'guest1')
  assert.equal(copy.options.isPrivate, true)
  assert.notEqual(copy.options.isPublic, true)
  assert.deepEqual(copy.libraryOrigin, { itemId, version: 2, kind: 'slate', title: 'Demo' })
  assert.equal(copy.library, undefined)
  assert.equal((await env.run(visitor, 'library.get', { itemId })).item.counts.copies, 0, 'a guest is never counted')
  const ben = env.person('other')
  await env.run(ben, 'library.fork', { itemId })
  await env.run(ben, 'library.fork', { itemId })
  assert.equal((await env.run(visitor, 'library.get', { itemId })).item.counts.copies, 1, 'one person counts once, however often they copy')
  // The visitor's page makes them a guest before it forks; a visitor principal itself is refused.
  await assert.rejects(env.run(visitor, 'library.fork', { itemId }), err => err.status === 401 || err.status === 403)
})

test('a component goes on a new slate, or beside a slate\'s boards after a preview, at most 8 boards; each person\'s adds count once', async (t) => {
  const env = await setup(t)
  const ada = env.person('owner')
  const before = (await env.run(visitor, 'library.get', { itemId: 'pros-cons' })).item.counts.adds
  // A new slate holding the board alone.
  const fresh = await env.run(ada, 'library.fork', { itemId: 'pros-cons' })
  assert.equal(fresh.boardId, 'main')
  const made = env.world.slate(fresh.shareId)
  assert.equal(made.creative.model.workshop.title, 'Pros and cons')
  assert.equal(made.libraryOrigin.itemId, 'builtin-pros-cons')
  // Beside the boards of that slate: a preview (nothing saved) with the ghost's place, then the save.
  const preview = await env.run(ada, 'library.fork', { itemId: 'retro', targetShareId: fresh.shareId, mode: 'preview' })
  assert.equal(preview.boardId, 'b2')
  assert.ok(preview.canvas.workshop && Number.isFinite(preview.canvas.origin.x))
  assert.equal(Object.keys(env.world.slate(fresh.shareId).boards ?? {}).length, 0)
  const saved = await env.run(ada, 'library.fork', { itemId: 'retro', targetShareId: fresh.shareId, expectedRevision: preview.revision })
  assert.equal(saved.boardId, 'b2')
  assert.equal(Object.keys(env.world.slate(fresh.shareId).boards).length, 1)
  // Up to 8 boards; the ninth is refused with the sentence the page shows.
  for (let i = 0; i < 6; i++) await env.run(ada, 'library.fork', { itemId: 'triage', targetShareId: fresh.shareId })
  const full = await env.run(ada, 'library.fork', { itemId: 'triage', targetShareId: fresh.shareId }).catch(err => err)
  assert.equal(full.code, 'component_opens_new_slate')
  assert.match(full.message, /This slate holds 8 boards/)
  assert.match(forkErrorText({ error: full.code, reason: full.message }), /This slate holds 8 boards/)
  assert.equal((await env.run(visitor, 'library.get', { itemId: 'pros-cons' })).item.counts.adds, before + 1)
  assert.equal((await env.run(visitor, 'library.get', { itemId: 'triage' })).item.counts.adds, 1, 'six adds by one person count once')
})

test('slatebox.com\'s ?copy=1 runs once: the page reads the flag, then puts the URL back without it', () => {
  assert.deepEqual(readCopyRequest('?copy=1'), { copy: true, rest: '' })
  assert.deepEqual(readCopyRequest('?copy=1&utm=site'), { copy: true, rest: '?utm=site' })
  assert.deepEqual(readCopyRequest(''), { copy: false, rest: '' })
  assert.deepEqual(readCopyRequest('?copy=0'), { copy: false, rest: '' })
  const page = readFileSync(new URL('../web/app/imports/ui/pages/LibraryItem.jsx', import.meta.url), 'utf8')
  // The flag is read once (a ref), cleared before the copy runs, and the URL replaced so Back never copies again.
  assert.match(page, /const copyAsked = useRef\(readCopyRequest\(location\.search\)\.copy\)/)
  assert.match(page, /copyAsked\.current = false\n\s*navigate\(\{ search: readCopyRequest\(location\.search\)\.rest \}, \{ replace: true \}\)\n\s*use\(null\)/)
  // A visitor becomes a guest first (libraryApi.fork), never a sign-up wall.
  const client = readFileSync(new URL('../web/app/imports/api/client/library.js', import.meta.url), 'utf8')
  assert.match(client, /fork: async \(input\) => \{\n\s*await asSomeone\(\)/)
})

test('the gallery\'s words: tabs, chips, author, provenance, uses, license, version, and the URL its filters live in', () => {
  assert.deepEqual(KIND_TABS.map(tab => tab.label), ['All', 'Smart components', 'Slates', 'Presentations'])
  assert.deepEqual(CATEGORY_CHIPS.map(chip => chip.label), ['All', 'Plan', 'Decide', 'Meetings', 'Track', 'Map'])
  assert.equal(countLine({ components: { total: 1 }, slates: 2, presentations: 1 }), '1 smart component, 2 slates, 1 presentation')
  assert.equal(authorLine({ origin: 'builtin', authorName: 'Slatebox' }), 'Built by Slatebox')
  assert.equal(authorLine({ origin: 'user', authorName: 'Ada Lee' }), 'By Ada Lee')
  assert.deepEqual(provenanceLine({ provenance: { branchedFrom: { itemId: 'builtin-retro', version: 1, title: 'Retro' } } }), { text: 'Branched from', title: 'Retro', itemId: 'builtin-retro' })
  assert.deepEqual(provenanceLine({ provenance: { forkedFrom: { itemId: 'x', version: 2, title: 'Plan' } } }), { text: 'Forked from', title: 'Plan', itemId: 'x' })
  assert.equal(provenanceLine({ provenance: {} }), null)
  assert.equal(usesLine({ kind: 'component', counts: { adds: 3, branches: 1 } }), 'Added to slates 3 times · branched once')
  assert.equal(usesLine({ kind: 'component', counts: { adds: 0, branches: 2 } }), 'Branched twice')
  assert.equal(usesLine({ kind: 'slate', counts: { copies: 1 } }), 'Copied once')
  assert.equal(usesLine({ kind: 'slate', counts: {} }), '')
  assert.equal(licenseLine({ origin: 'user', authorName: 'Ada Lee' }), 'Free to use, change and share under CC BY 4.0, crediting Ada Lee.')
  assert.equal(versionLine({ publishedAt: '2026-11-23T12:00:00Z' }, { n: 2 }), 'Version 2 · published 23 Nov 2026')
  assert.deepEqual(readGalleryQuery('?kind=slate&category=plan&q=retro&sort=popular'), { kind: 'slate', category: 'plan', sort: 'popular', q: 'retro' })
  assert.deepEqual(readGalleryQuery('?kind=nope&category=all&sort=old'), { kind: null, category: null, sort: 'new', q: '' })
  assert.equal(galleryQuery({ kind: 'component', category: null, sort: 'new', q: ' ' }), '?kind=component')
  assert.equal(galleryQuery({}), '')
  assert.deepEqual(listInput({ kind: 'slate', sort: 'popular' }, '24'), { kind: 'slate', sort: 'popular', limit: 24, cursor: '24' })
  // Plain words, no vendor names.
  const words = readFileSync(new URL('../web/app/imports/ui/components/library/gallery/galleryCopy.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(words, /OpenAI|Anthropic|Claude|GPT|Gemini|Llama|DeepInfra|Mongo|Meteor\b/)
})

test('an item page\'s head: share-preview tags, the marketing site\'s copy as canonical, noindex for anything unpublished', () => {
  assert.equal(librarySlugOf('/library/pros-cons'), 'pros-cons')
  assert.equal(librarySlugOf('/library/pros-cons/'), 'pros-cons')
  assert.equal(librarySlugOf('/library/mine'), null)
  assert.equal(librarySlugOf('/library'), null)
  assert.equal(librarySlugOf('/library/a/b'), null)
  assert.equal(librarySlugOf('/library/%E0%A4%A'), null)
  const item = { status: 'published', slug: 'weekly-retro-abc123', kind: 'component', origin: 'user', title: 'Weekly "retro"', summary: 'Three <columns>', authorName: 'Ada', publishedAt: new Date('2026-11-23T12:00:00Z') }
  const head = libraryItemHead(item, { appOrigin: 'https://app.slatebox.com/', siteOrigin: 'https://slatebox.com' })
  assert.match(head, /<meta property="og:title" content="Weekly &quot;retro&quot; · Smart component · Slatebox library">/)
  assert.match(head, /<meta property="og:description" content="Three &lt;columns&gt;">/)
  assert.match(head, /<meta property="og:url" content="https:\/\/app\.slatebox\.com\/library\/weekly-retro-abc123">/)
  assert.match(head, /<link rel="canonical" href="https:\/\/slatebox\.com\/gallery\/weekly-retro-abc123\/">/)
  assert.match(head, /<meta name="author" content="Ada">/)
  // A self-hosted install has no marketing site: its own page is canonical.
  assert.match(libraryItemHead(item, { appOrigin: 'https://boards.example', siteOrigin: null }), /<link rel="canonical" href="https:\/\/boards\.example\/library\/weekly-retro-abc123">/)
  assert.equal(libraryItemHead(null, { appOrigin: 'x' }), '<meta name="robots" content="noindex">')
  assert.equal(libraryItemHead({ ...item, status: 'submitted' }, { appOrigin: 'x' }), '<meta name="robots" content="noindex">')
})

test('the nav names the library, for everyone, in place of community slates', () => {
  const main = readFileSync(new URL('../web/app/imports/ui/Main.jsx', import.meta.url), 'utf8')
  assert.match(main, /title: 'Library',\n\s*path: '\/library',\n\s*icon: <LibraryBooksIcon \/>,\n\s*show: true,/)
  assert.doesNotMatch(main, /Community slates/)
})
