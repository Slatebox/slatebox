import assert from 'node:assert/strict'
import test from 'node:test'
import { presentationShareUrl, presentationShareLinks } from '../web/app/imports/ui/components/presentations/presentationShare.mjs'

const base = 'https://app.slatebox.com'

test('an unpublished presentation has no share URL and no share links', () => {
  const drafts = [{ version: 1 }, { version: 2, isPublished: false }]
  assert.equal(presentationShareUrl(drafts, { baseUrl: base, slateShareId: 'abc' }), null)
  assert.equal(presentationShareUrl([], { baseUrl: base, slateShareId: 'abc' }), null)
  assert.equal(presentationShareUrl(undefined, { baseUrl: base, slateShareId: 'abc' }), null)
  assert.equal(presentationShareLinks(null), null)
  assert.equal(presentationShareLinks(undefined), null)
})

test('a published presentation shares its public URL', () => {
  const versions = [{ version: 1 }, { version: 2, isPublished: true, url: `${base}/present/abc123` }]
  assert.equal(presentationShareUrl(versions, { baseUrl: base, slateShareId: 'abc123' }), `${base}/present/abc123`)
})

test('a published version saved without a URL falls back to the slate present link', () => {
  const versions = [{ version: 1, isPublished: true, slateShareId: 'a b/c' }]
  assert.equal(presentationShareUrl(versions, { baseUrl: `${base}/`, slateShareId: 'ignored' }), `${base}/present/a%20b%2Fc`)
  const unsafe = [{ version: 1, isPublished: true, url: 'javascript:alert(1)' }]
  assert.equal(presentationShareUrl(unsafe, { baseUrl: base, slateShareId: 'xyz' }), `${base}/present/xyz`)
})

test('every share control uses the same, correctly encoded public URL', () => {
  const url = `${base}/present/abc123?x=1&y=2`
  const links = presentationShareLinks(url, 'Room & Rain')
  const enc = encodeURIComponent(url)
  assert.equal(links.copy, url)
  assert.equal(links.facebook, `https://www.facebook.com/sharer/sharer.php?u=${enc}`)
  assert.equal(links.linkedin, `https://www.linkedin.com/sharing/share-offsite/?url=${enc}`)
  assert.match(links.email, /^mailto:\?subject=[^&]+&body=/)
  const params = new URLSearchParams(links.email.slice('mailto:?'.length))
  assert.ok(params.get('body').includes(url), 'email body carries the public URL')
  assert.ok(params.get('subject').includes('Room & Rain'))
  for (const link of [links.facebook, links.linkedin, links.email]) {
    assert.ok(!link.includes('undefined'))
    assert.ok(!link.includes(url), 'the URL is encoded inside each share link')
  }
  assert.equal(new URL(links.facebook).searchParams.get('u'), url)
  assert.equal(new URL(links.linkedin).searchParams.get('url'), url)
})
