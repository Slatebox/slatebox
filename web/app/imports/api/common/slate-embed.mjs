// Embed codes, built the same way wherever they are shown or read: the Board settings embed
// dialog, the workshop publish dialog and every read of a slate.
const attribute = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** The published picture of a board, served at /embed/<shareId> by the viewer origin. */
export function boardEmbed(viewerOrigin, shareId) {
  const url = new URL('/embed/' + encodeURIComponent(shareId), viewerOrigin).href
  return {
    url,
    code: `<iframe title="Published Slatebox board" src="${attribute(url)}" width="100%" height="480" loading="lazy" referrerpolicy="no-referrer"></iframe>`,
  }
}

/** A published presentation at its viewer address, as the publish dialog copies it. */
export function presentationEmbedCode(url, name) {
  const title = typeof name === 'string' && name.trim() ? `Slatebox presentation — ${name.trim()}` : 'Slatebox presentation'
  return {
    url,
    code: `<iframe src="${attribute(url)}" title="${attribute(title)}" width="960" height="540" style="display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; border: 0;" allowfullscreen=""></iframe>`,
  }
}
