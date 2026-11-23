import { presentationEmbedCode } from '../../../api/common/slate-embed.mjs'

export function presentationEmbed(presentation, slate, baseUrl) {
  const appUrl = new URL(baseUrl || window.location.origin)
  const shareId = presentation.slateShareId || slate.shareId
  const fallback = new URL(
    `present/${encodeURIComponent(shareId)}`,
    `${appUrl.href.replace(/\/$/, '')}/`
  )
  let viewer = fallback
  if (typeof presentation.url === 'string' && presentation.url.trim()) {
    try {
      const published = new URL(presentation.url, appUrl)
      if (['http:', 'https:'].includes(published.protocol) && !published.username && !published.password) {
        viewer = published
      }
    } catch {
      // Older saved versions can still be opened by their slate share ID.
    }
  }

  const title = [presentation.name, slate.options?.name].find(
    name => typeof name === 'string' && name.trim()
  )
  return presentationEmbedCode(viewer.href, title).code
}
