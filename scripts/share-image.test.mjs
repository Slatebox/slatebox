// A public slate's share link (og:image) shows a picture of its board, not the generic logo: the PNG the
// editor's page uploads as the slate's preview (options.staticImage). Only a public slate's, and only a
// PNG on the app's own image store. Private and unlisted slates, and a slate with no preview yet, keep the logo.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { publicSlate, slateShareImage, slateShareText } from '../web/app/server/common/share-image.mjs'

const store = 'https://files.example.com'
const png = `${store}/2026/11/s1_1763900000000.png`
const slate = (options) => ({ shareId: 'abc', options: { id: 's1', name: 'Hiring plan', isPublic: true, staticImage: png, ...options } })
const app = (path) => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')

test('a public slate shows its preview PNG; any other slate, or any other picture, does not', () => {
  assert.equal(slateShareImage(slate(), store), png)
  assert.equal(publicSlate(slate()), true)
  for (const options of [{ isPublic: false }, { isPrivate: true }, { isUnlisted: true }]) assert.equal(slateShareImage(slate(options), store), null, JSON.stringify(options))
  // Not a preview of this slate on the store: another host, http, an SVG, another slate's picture, a query.
  for (const staticImage of ['https://evil.example/2026/11/s1_1.png', 'http://files.example.com/2026/11/s1_1.png', `${store}/2026/11/s1_1.svg`,
    `${store}/2026/11/s2_1.png`, `${png}?x=1`, 'javascript:alert(1)', undefined]) {
    assert.equal(slateShareImage(slate({ staticImage }), store), null, String(staticImage))
  }
  // An install with no image store (self-host without one): the logo.
  assert.equal(slateShareImage(slate(), undefined), null)
})

test('the card says the slate\'s name and description; an untitled slate says nothing of its own', () => {
  assert.deepEqual(slateShareText(slate({ description: '  Q1   hires ' })), { title: 'Hiring plan', description: 'Q1 hires' })
  assert.equal(slateShareText(slate({ name: 'Untitled slate' })), null)
  assert.equal(slateShareText(slate({ isPrivate: true })), null)
})

test('the canvas page\'s head uses it for a public slate, and the editor\'s page uploads the preview of a public slate, sized for crawlers', () => {
  const startup = app('server/startup.js')
  assert.match(startup, /pathType === 'canvas'[\s\S]*?Slates\.findOneAsync\(\s*\{ shareId: slateId, 'options\.isPublic': true, 'options\.isPrivate': \{ \$ne: true \}, 'options\.isUnlisted': \{ \$ne: true \} \}/)
  assert.match(startup, /presentation\?\.imageUrl \|\|\s*boardImage \|\|\s*'https:\/\/files\.slatebox\.com\/slatebox_small_logo\.svg'/)
  assert.match(startup, /'twitter:card': 'summary_large_image'/)
  const canvas = app('imports/ui/pages/Canvas.jsx')
  assert.match(canvas, /isPublic && !isPrivate && !isUnlisted &&\s*!publishedTemplate && !isEmbedded && accessLevel\.current\?\.isEditable\) \{\s*sharePreviewLater\(\)/)
  assert.match(canvas, /CONSTANTS\.methods\.utils\.getCloudLink, o\.id, base64, false, false, false, true\)/)
  assert.match(canvas, /const SHARE_PREVIEW_QUIET = 20_000\nconst SHARE_PREVIEW_EVERY = 5 \* 60_000/)
  assert.match(app('server/methods/googleDocs.js'), /if \(forShare === true\) picture\.resize\(\{ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true \}\)/)
})
