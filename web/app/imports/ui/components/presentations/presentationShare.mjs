// The public link a presentation is shared by, and the share links built from it. A presentation
// has a public link only once a version is published; until then there is nothing to share.

export function presentationShareUrl(presentations, { baseUrl, slateShareId } = {}) {
  const published = (presentations || []).find((p) => p?.isPublished)
  if (!published) return null
  const app = new URL(baseUrl || globalThis.location?.origin)
  if (typeof published.url === 'string' && published.url.trim()) {
    try {
      const url = new URL(published.url, app)
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href
    } catch {
      // Fall back to the slate's present link below.
    }
  }
  const shareId = published.slateShareId || slateShareId
  if (!shareId) return null
  return new URL(`present/${encodeURIComponent(shareId)}`, `${app.href.replace(/\/$/, '')}/`).href
}

export function presentationShareLinks(url, name) {
  if (!url) return null
  const link = encodeURIComponent(url)
  const title = typeof name === 'string' && name.trim() ? `"${name.trim()}"` : 'my presentation'
  const subject = encodeURIComponent(`Check out ${title} on Slatebox`)
  const body = encodeURIComponent(`Here's ${title}: ${url}`)
  return {
    copy: url,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${link}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${link}`,
    email: `mailto:?subject=${subject}&body=${body}`,
  }
}
