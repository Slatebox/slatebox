/* eslint-disable no-underscore-dangle */
/* eslint-disable no-undef */
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import { WebApp } from 'meteor/webapp'
import { onPageLoad } from 'meteor/server-render'
import app from './expressApp'
import { presentationMeta } from './common/presentationMeta.mjs'
import { slateShareImage, slateShareText } from './common/share-image.mjs'
import { libraryItemHead, librarySlugOf } from './library/item-meta.mjs'
import { LibraryItems } from '../imports/api/common/models'
import setup from './email/setup'
import { storedFileBase } from './common/fileStore'
import { onCreateUser } from './common/accounts'
import { ensureLibraryIndexes, migrateCommunitySlates, seedLibraryBuiltins, seedLibraryShowcase } from './library/meteor'
import { slateSaveCore } from './slate-save'
import { wearStyledDecks } from './migrations/slate-style-001.mjs'
import './bootstrap/all'
import {
  IconPacks,
  Projects,
  ProjectAccess,
  Slates,
  SlatePresentations,
  SlateApiTokens,
  SlateOperationRuns,
  SystemSettings,
} from '../imports/api/common/models'

function appendDefaults(sink) {
  const defaultHead = `
    <style>
    .active-font,
    .dropdown-button,
    .font-list {
      color: #112c44 !important;
      z-index: 9 !important;
    }
    .font-button:hover {
      color: #112c44 !important;
    }
    div[id^='font-picker'].expanded ul {
      max-height: 150px !important;
    }
    body,
    html {
      overscroll-behavior-x: none;
    }
    .resp-sharing-button__icon,
    .resp-sharing-button__link {
      display: inline-block;
    }
    .resp-sharing-button__link {
      text-decoration: none;
      color: #fff;
      margin: 0.5em;
    }
    .resp-sharing-button {
      border-radius: 5px;
      transition: 25ms ease-out;
      padding: 4px;
      font-family: Helvetica Neue, Helvetica, Arial, sans-serif;
    }
    .resp-sharing-button__icon svg {
      width: 1em;
      height: 1em;
      margin-right: 0.4em;
      vertical-align: top;
    }
    .resp-sharing-button--small svg {
      margin: 0;
      vertical-align: middle;
    }
    .resp-sharing-button__icon {
      stroke: #fff;
      fill: none;
    }
    .resp-sharing-button__icon--solid,
    .resp-sharing-button__icon--solidcircle {
      fill: #fff;
      stroke: none;
    }
    .resp-sharing-button--pinterest {
      background-color: #bd081c;
    }
    .resp-sharing-button--pinterest:hover {
      background-color: #8c0615;
    }
    .resp-sharing-button--tumblr {
      background-color: #35465c;
    }
    .resp-sharing-button--tumblr:hover {
      background-color: #222d3c;
    }
    .resp-sharing-button--reddit {
      background-color: #5f99cf;
    }
    .resp-sharing-button--reddit:hover {
      background-color: #3a80c1;
    }
    .resp-sharing-button--google {
      background-color: #dd4b39;
    }
    .resp-sharing-button--google:hover {
      background-color: #c23321;
    }
    .resp-sharing-button--xing {
      background-color: #1a7576;
    }
    .resp-sharing-button--xing:hover {
      background-color: #114c4c;
    }
    .resp-sharing-button--whatsapp {
      background-color: #25d366;
    }
    .resp-sharing-button--whatsapp:hover {
      background-color: #1da851;
    }
    .resp-sharing-button--hackernews {
      background-color: #f60;
    }
    .resp-sharing-button--hackernews:focus,
    .resp-sharing-button--hackernews:hover {
      background-color: #fb6200;
    }
    .resp-sharing-button--vk {
      background-color: #507299;
    }
    .resp-sharing-button--vk:hover {
      background-color: #43648c;
    }
    .resp-sharing-button--facebook {
      background-color: #3b5998;
      border-color: #3b5998;
    }
    .resp-sharing-button--facebook:active,
    .resp-sharing-button--facebook:hover {
      background-color: #2d4373;
      border-color: #2d4373;
    }
    .resp-sharing-button--twitter {
      background-color: #55acee;
      border-color: #55acee;
    }
    .resp-sharing-button--twitter:active,
    .resp-sharing-button--twitter:hover {
      background-color: #2795e9;
      border-color: #2795e9;
    }
    .resp-sharing-button--email {
      background-color: #777;
      border-color: #777;
    }
    .resp-sharing-button--email:active,
    .resp-sharing-button--email:hover {
      background-color: #5e5e5e;
      border-color: #5e5e5e;
    }
    .resp-sharing-button--linkedin {
      background-color: #0077b5;
      border-color: #0077b5;
    }
    .resp-sharing-button--linkedin:active,
    .resp-sharing-button--linkedin:hover {
      background-color: #046293;
      border-color: #046293;
    }
  </style>
  `
  sink.appendToHead(defaultHead)
  if (Meteor.settings.public.env === 'selfhost') return
  sink.appendToHead(`  <link
    href="https://unpkg.com/dropzone@6.0.0-beta.1/dist/dropzone.css"
    rel="stylesheet"
    type="text/css"
  />`)

  // chatwoot load — per-env kill switch: set "public":{"chatWoot":{"enabled":false}}
  // in METEOR_SETTINGS and the widget SDK is never served (test config-off,
  // ledger iter30). Absent key = ENABLED, so prod behavior is unchanged by
  // this code until a settings edit opts out.
  // The widget's website token is public by design (every page carries it) but it is
  // per-installation, so it lives in settings: public.chatWoot.websiteToken. Without one
  // the widget is not served.
  const chatWootWebsiteToken = Meteor.settings?.public?.chatWoot?.websiteToken
  if (Meteor.settings?.public?.chatWoot?.enabled !== false && typeof chatWootWebsiteToken === 'string' && /^[A-Za-z0-9_-]+$/.test(chatWootWebsiteToken)) {
  sink.appendToBody(`
    <script>
      window.chatwootSettings = {
        hideMessageBubble: true,
      }
      ;(function (d, t) {
        var BASE_URL = 'https://app.chatwoot.com'
        var g = d.createElement(t),
          s = d.getElementsByTagName(t)[0]
        g.src = BASE_URL + '/packs/js/sdk.js'
        g.defer = true
        g.async = true
        s.parentNode.insertBefore(g, s)
        g.onload = function () {
          window.chatwootSDK.run({
            websiteToken: ${JSON.stringify(chatWootWebsiteToken)},
            baseUrl: BASE_URL,
          })
        }
      })(document, 'script')
    </script>
  `)
  }
}

onPageLoad(async (sink) => {
  const { url } = sink.request

  // Meteor 3.5 (server-render 0.4.4) moved the request path to sink.request.path;
  // sink.request.url is now just { query }, so the old `url.path` was undefined and
  // .match() threw. Prefer sink.request.path, with string/pathname fallbacks.
  const urlPath =
    sink.request.path ||
    (typeof url === 'string' ? url : url?.path || url?.pathname || '')

  const pathname = urlPath.split('?')[0].replace(/\/+$/, '')

  // A library item's page: its title, summary and author for share previews, and the marketing site's copy as the
  // canonical page (server/library/item-meta.mjs). Unpublished or unknown items are noindex.
  const librarySlug = librarySlugOf(pathname)
  if (librarySlug) {
    appendDefaults(sink)
    try {
      const item = await LibraryItems.findOneAsync({ slug: librarySlug, status: 'published' },
        { fields: { slug: 1, status: 1, kind: 1, origin: 1, title: 1, summary: 1, authorName: 1, publishedAt: 1 } })
      const appOrigin = Meteor.settings.public.baseUrl || Meteor.absoluteUrl().replace(/\/$/, '')
      const siteOrigin = Meteor.settings.public.env === 'selfhost' ? null : (Meteor.settings.public.marketingOrigin || 'https://slatebox.com')
      sink.appendToHead(libraryItemHead(item, { appOrigin, siteOrigin }))
    } catch {
      sink.appendToHead('<meta name="robots" content="noindex">')
    }
    return
  }

  // Extract path type and ID using regex
  const match = urlPath.match(/\/(canvas|present)\/([^/?]+)/)

  if (match) {
    const [, pathType, slateId] = match

    const presentation =
      pathType === 'present'
        ? await SlatePresentations.findOneAsync(
            { slateShareId: slateId, isPublished: true },
            {
              fields: {
                name: 1,
                description: 1,
                imageUrl: 1,
                imageWidth: 1,
                imageHeight: 1,
                author: 1,
                created: 1,
                updated: 1,
              },
            }
          )
        : null

    // A public slate's link shows a picture of its board, with its name (share-image.mjs); any other, the logo.
    const shared =
      pathType === 'canvas' && /^[A-Za-z0-9_-]{1,80}$/.test(slateId)
        ? await Slates.findOneAsync(
            { shareId: slateId, 'options.isPublic': true, 'options.isPrivate': { $ne: true }, 'options.isUnlisted': { $ne: true } },
            { fields: { 'options.id': 1, 'options.name': 1, 'options.description': 1, 'options.isPublic': 1, 'options.isPrivate': 1, 'options.isUnlisted': 1, 'options.staticImage': 1 } }
          ).catch(() => null)
        : null
    const boardImage = shared && slateShareImage(shared, storedFileBase())
    const sharedText = shared && slateShareText(shared)

    const imageUrl =
      presentation?.imageUrl ||
      boardImage ||
      'https://files.slatebox.com/slatebox_small_logo.svg'

    const appOrigin = Meteor.settings.public.baseUrl || Meteor.absoluteUrl().replace(/\/$/, '')
    const ogUrl =
      pathType === 'present'
        ? `${appOrigin}/present/${slateId}`
        : `${appOrigin}/canvas/${slateId}`

    sink.appendToHead(presentationMeta({
      'og:title': presentation?.name || sharedText?.title || 'Slatebox - visualize everything',
      'og:description': presentation?.description || sharedText?.description || 'Your data has a story, unlock it.',
      'og:image': imageUrl,
      'og:url': ogUrl,
      'og:type': 'website',
      'fb:app_id': Meteor.settings.public.facebookAppId ?? '',
      // A board picture's size is its own (the crawler reads it): only a published deck's is known here.
      ...(!boardImage || presentation?.imageUrl ? {
        'og:image:width': presentation?.imageWidth || '800',
        'og:image:height': presentation?.imageHeight || '600',
      } : {}),
      'og:locale': 'en_US',
      'og:image:alt': boardImage && !presentation?.imageUrl ? (sharedText?.title ? sharedText.title + ', a board on Slatebox' : 'A board on Slatebox') : 'Slatebox - visualize everything',
      'article:published_time': presentation?.created ? new Date(presentation.created).toISOString() : '',
      'og:updated_time': presentation?.updated ? new Date(presentation.updated).toISOString() : '',
    }))
    sink.appendToHead(presentationMeta({ author: presentation?.author || 'Slatebox', ...(boardImage && !presentation?.imageUrl && { 'twitter:card': 'summary_large_image' }) }, 'name'))
    if (!presentation) {
      appendDefaults(sink)
    }
  } else {
    appendDefaults(sink)
  }
})

// The one-time move of community slates, templates and featured presentations into the library.
async function runLibraryMigration() {
  const key = 'library-migration-2026-11'
  try {
    if (await SystemSettings.findOneAsync({ _id: key })) return
    const report = await migrateCommunitySlates()
    console.log('[library] moved', JSON.stringify({ ...report.created, skipped: report.skipped, failed: report.failed }))
    await SystemSettings.upsertAsync({ _id: key }, { $set: { finishedAt: new Date(), report: { ...report.created, skipped: report.skipped, failed: report.failed } } })
  } catch (error) {
    console.error('[library] migration', error?.message)
  }
}

Meteor.startup(async () => {
  // setup mail
  await setup()

  app.get('/readyz', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    try {
      await Slates.rawCollection().findOne({}, { projection: { _id: 1 } })
      res.status(200).json({ ok: true, service: 'slatebox-app' })
    } catch {
      res.status(503).json({ ok: false, service: 'slatebox-app' })
    }
  })

  // Use WebApp to handle the requests through Express
  WebApp.connectHandlers.use(app)

  // swallow debug messages
  Meteor._debug = (function (superMeteorDebug) {
    return function (error, info) {
      if (error !== 'discarding unknown livedata message type') {
        superMeteorDebug(error, info)
      }
    }
  })(Meteor._debug)

  // Only the server chooses a new account's team and guest flag (common/accounts.js).
  Accounts.onCreateUser(onCreateUser)

  async function listIndexesOrEmpty(collection) {
    try {
      return await collection.listIndexes().toArray()
    } catch (error) {
      if (error.code === 26 || error.codeName === 'NamespaceNotFound') return []
      throw error
    }
  }

  async function ensureTextIndices() {
    const slates = Slates.rawCollection()
    const slatePresentations = SlatePresentations.rawCollection()
    const slateIndices = await listIndexesOrEmpty(slates)
    const slatePresentationIndices =
      await listIndexesOrEmpty(slatePresentations)
    /*
      {
        "v" : 2,
        "key" : {
          "_fts" : "text"
      */
    const anySlateTextIndices = slateIndices.some((s) => s.key._fts === 'text')
    if (!anySlateTextIndices) {
      await slates.createIndex({
        'options.searchName': 'text',
        'options.searchDescription': 'text',
        'options.searchText': 'text',
      })
    }

    // Featured presentations are library items now: the old gallery's index goes.
    await slatePresentations.dropIndex('public_presentation_gallery').catch(() => {})

    if (!slatePresentationIndices.some((s) => s.key._fts === 'text')) {
      await slatePresentations.createIndex({
        slateShareId: 'text',
        name: 'text',
        description: 'text',
      })
    }

    if ((await IconPacks.find().countAsync()) > 0) {
      const iconPacks = IconPacks.rawCollection()
      const iconPackIndices = await listIndexesOrEmpty(iconPacks)
      const anyIconPackTextIndices = iconPackIndices.some(
        (s) => s.key._fts === 'text'
      )
      // console.log('iconPackIndices', iconPackIndices, anyIconPackTextIndices)
      if (!anyIconPackTextIndices) {
        await iconPacks.createIndex({
          name: 'text',
          'icons.name': 'text',
        })
      }
    }
  }
  await ensureTextIndices()

  // The shared library: its indexes, and the built-in catalogue entries as published items (a
  // version is added only when an entry's board changed). A failure is logged and never stops the start.
  try {
    await ensureLibraryIndexes()
    const seeded = await seedLibraryBuiltins()
    if (seeded.created.length || seeded.updated.length || seeded.unpublished.length)
      console.log('[library] built-ins', JSON.stringify({ created: seeded.created.length, updated: seeded.updated.length, unpublished: seeded.unpublished.length }))
    // The presentations Slatebox built (the site's six), each with its slate and deck: "Make it yours" copies both.
    // Its own guard, so a failure here never stops the migration below.
    try {
      const shown = await seedLibraryShowcase()
      if (shown.created.length || shown.updated.length || shown.unpublished.length || shown.skipped.length)
        console.log('[library] showcase', JSON.stringify({ created: shown.created.length, updated: shown.updated.length, unpublished: shown.unpublished.length, skipped: shown.skipped }))
    } catch (error) {
      console.error('[library] showcase', error?.message)
    }
    // Community slates, approved templates and featured presentations become library items once
    // (keyed by migratedFrom, so a second run adds nothing). Community slates wait in the review
    // queue. It runs beside the start, never in its way; a finished run is remembered.
    runLibraryMigration()
  } catch (error) {
    console.error('[library] startup', error?.message)
  }
  // slate-style-001: presentations saved with a style before slates wore styles: their slates wear
  // it now (the slate IS the presentation). Beside the start, never in its way; idempotent.
  wearStyledDecks({ presentations: SlatePresentations.rawCollection(), slates: Slates.rawCollection(), saveCore: slateSaveCore })
    .catch((error) => console.error('[slate-style-001]', error?.message))

  // Projects (server/projects): a drive's slates newest first, a drive's folders, who owns which,
  // a team's drives, a drive's grants and a person's or team's, and one drive per link key.
  await Promise.all([
    Slates.rawCollection().createIndex({ projectId: 1, lastSaved: -1 }),
    Projects.rawCollection().createIndex({ rootId: 1 }),
    Projects.rawCollection().createIndex({ ownerId: 1 }),
    Projects.rawCollection().createIndex({ orgId: 1 }),
    ProjectAccess.rawCollection().createIndex({ projectId: 1 }),
    ProjectAccess.rawCollection().createIndex({ userId: 1 }),
    ProjectAccess.rawCollection().createIndex({ orgId: 1, kind: 1 }),
    // Only link rows carry a key (others hold null), so the unique index covers strings only.
    ProjectAccess.rawCollection().createIndex({ accessKey: 1 }, { unique: true, partialFilterExpression: { accessKey: { $type: 'string' } } }),
    ProjectAccess.rawCollection().createIndex({ email: 1 }, { partialFilterExpression: { email: { $type: 'string' } } }),
  ]).catch((error) => console.error('[projects] indexes', error?.message))

  await Promise.all([
    SlateApiTokens.rawCollection().createIndex(
      { tokenHash: 1 },
      { unique: true }
    ),
    SlateApiTokens.rawCollection().createIndex({ userId: 1, createdAt: -1 }),
    SlateOperationRuns.rawCollection().createIndex({
      slateShareId: 1,
      createdAt: 1,
    }),
    // The runs a canvas is sent: those after the revision it loaded (slate-operation-runs.mjs runsSince).
    SlateOperationRuns.rawCollection().createIndex({
      slateShareId: 1,
      revision: 1,
    }),
    // Run receipts expire 90 days after they are saved (slate-operation-runs.mjs runExpiry).
    SlateOperationRuns.rawCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    SlateOperationRuns.rawCollection().createIndex(
      { tokenId: 1, idempotencyKey: 1 },
      {
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: 'string' } },
      }
    ),
  ])

  // Initialize kafka consumer
  // runConsumer().catch((error) => {
  //   console.error('Kafka Error:', error);
  // });
})
