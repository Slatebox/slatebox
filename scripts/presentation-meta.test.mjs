import assert from 'node:assert/strict'
import test from 'node:test'
import { presentationMeta } from '../web/app/server/common/presentationMeta.mjs'

test('authored deck titles and credit stay within their own share-preview attributes', () => {
  assert.equal(presentationMeta({ 'og:title': 'Room "A" <Rain & Glass>' }),
    '<meta property="og:title" content="Room &quot;A&quot; &lt;Rain &amp; Glass&gt;">')
  assert.equal(presentationMeta({ author: 'Arts & Sciences' }, 'name'),
    '<meta name="author" content="Arts &amp; Sciences">')
})
