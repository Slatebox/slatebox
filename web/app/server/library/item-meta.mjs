// The head of /library/<slug> for a share preview and a search engine (library spec §7.1): the published item's
// title, summary and author as og:* tags, beside presentationMeta's /present ones. The canonical URL is the
// marketing site's copy (https://slatebox.com/gallery/<slug>/), the one search engines index; a self-hosted
// install has no marketing site and names none. Anything not published is noindex and says nothing about itself.
import { presentationMeta } from '../common/presentationMeta.mjs'

export const LIBRARY_PATH = /^\/library\/([^/]+)$/

/** The slug a request path names, or null (/library, /library/mine and anything deeper are not an item page). */
export function librarySlugOf(pathname) {
  const match = LIBRARY_PATH.exec(String(pathname ?? '').split('?')[0].replace(/\/+$/, ''))
  if (!match) return null
  let slug
  try { slug = decodeURIComponent(match[1]) } catch { return null }
  return slug === 'mine' || !/^[a-z0-9-]{1,120}$/.test(slug) ? null : slug
}

const KIND_NAME = { component: 'Smart component', slate: 'Slate', presentation: 'Presentation' }

/**
 * The tags for an item page. `item` is the published row or null; `appOrigin` the app's address; `siteOrigin` the
 * marketing site's (null on a self-hosted install).
 */
export function libraryItemHead(item, { appOrigin, siteOrigin }) {
  if (!item || item.status !== 'published') return '<meta name="robots" content="noindex">'
  const app = String(appOrigin || '').replace(/\/$/, '')
  const author = item.origin === 'builtin' ? 'Slatebox' : item.authorName || 'A Slatebox user'
  const title = `${item.title} · ${KIND_NAME[item.kind] ?? 'Library'} · Slatebox library`
  const description = item.summary || ''
  const canonical = siteOrigin ? `${String(siteOrigin).replace(/\/$/, '')}/gallery/${item.slug}/` : `${app}/library/${item.slug}`
  return [
    presentationMeta({ description, author }, 'name'),
    presentationMeta({
      'og:title': title, 'og:description': description, 'og:type': 'article', 'og:url': `${app}/library/${item.slug}`,
      'og:site_name': 'Slatebox', 'og:locale': 'en_US',
      ...(item.publishedAt && { 'article:published_time': new Date(item.publishedAt).toISOString() }),
    }),
    `<link rel="canonical" href="${canonical.replaceAll('"', '&quot;')}">`,
  ].join('\n')
}
