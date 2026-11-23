/* eslint-disable no-underscore-dangle */
/* eslint-disable no-undef */
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import { WebApp } from 'meteor/webapp'
import { onPageLoad } from 'meteor/server-render'
import app from './expressApp'
import { presentationMeta } from './common/presentationMeta.mjs'
import { publicTemplateSummary } from './methods/template-directory'
import setup from './email/setup'
import { onCreateUser } from './common/accounts'
import './bootstrap/all'
import {
  IconPacks,
  Slates,
  SlatePresentations,
  SlateApiTokens,
  SlateOperationRuns,
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
  // Google Analytics measurement id is per installation, so it lives in settings:
  // public.analytics.gaId. Without a well-formed id nothing analytics-related is served.
  const gaId = Meteor.settings?.public?.analytics?.gaId
  if (typeof gaId === 'string' && /^G-[A-Z0-9]+$/.test(gaId)) {
    sink.appendToHead(`<script>
    window.dataLayer = window.dataLayer || []
    function gtag() {
      dataLayer.push(arguments)
    }
    gtag('js', new Date())

    gtag('config', ${JSON.stringify(gaId)})
  </script>`)
  }
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
  if (pathname.startsWith('/templates/')) {
    sink.setHeader('Cache-Control', 'no-store')
    appendDefaults(sink)
    // A signed-in author loads the private preview through their own app session.
    if (/^\/templates\/preview\/[^/]+$/.test(pathname)) {
      sink.appendToHead('<meta name="robots" content="noindex">')
      return
    }
    const templatePath = /^\/templates\/(tag\/)?([^/]+)$/.exec(pathname)
    let key
    if (templatePath) {
      try { key = decodeURIComponent(templatePath[2]) } catch { /* Malformed bookmark. */ }
    }
    if (key) {
      try {
        const entry = await publicTemplateSummary(templatePath[1] ? 'tag' : 'slug', key)
        if (entry) {
          sink.appendToHead(presentationMeta({
            'og:title': entry.type === 'tag' ? entry.name + ' templates' : entry.name,
            'og:description': entry.description || '',
          }))
          return
        }
      } catch {
        sink.setStatusCode(503)
        return
      }
    }
    sink.setStatusCode(404)
    sink.appendToHead('<meta name="robots" content="noindex">')
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

    const imageUrl =
      presentation?.imageUrl ||
      'https://files.slatebox.com/slatebox_small_logo.svg'

    const appOrigin = Meteor.settings.public.baseUrl || Meteor.absoluteUrl().replace(/\/$/, '')
    const ogUrl =
      pathType === 'present'
        ? `${appOrigin}/present/${slateId}`
        : `${appOrigin}/canvas/${slateId}`

    sink.appendToHead(presentationMeta({
      'og:title': presentation?.name || 'Slatebox - visualize everything',
      'og:description': presentation?.description || 'Your data has a story, unlock it.',
      'og:image': imageUrl,
      'og:url': ogUrl,
      'og:type': 'website',
      'fb:app_id': Meteor.settings.public.facebookAppId ?? '',
      'og:image:width': presentation?.imageWidth || '800',
      'og:image:height': presentation?.imageHeight || '600',
      'og:locale': 'en_US',
      'og:image:alt': 'Slatebox - visualize everything',
      'article:published_time': presentation?.created ? new Date(presentation.created).toISOString() : '',
      'og:updated_time': presentation?.updated ? new Date(presentation.updated).toISOString() : '',
    }))
    sink.appendToHead(presentationMeta({ author: presentation?.author || 'Slatebox' }, 'name'))
    if (!presentation) {
      appendDefaults(sink)
    }
  } else {
    appendDefaults(sink)
  }
})

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

    await slatePresentations.createIndex({ intentionId: 1, timestamp: -1, _id: 1 }, {
      name: 'public_presentation_gallery',
      partialFilterExpression: { isPublished: true, isPublic: true, isFeatured: true, playOnHover: true, autoplayOnPublish: true },
    })

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
