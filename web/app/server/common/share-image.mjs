// A public slate's share link shows a picture of the board, not the logo: the PNG its editor's page
// last uploaded as the slate's preview (options.staticImage, utils.getCloudLink). Only for a public
// slate (not private, not unlisted: an unlisted link pasted in a chat stays a plain link), and only a
// PNG on the app's own image store, so a share card never points anywhere else or at an SVG (which
// the crawlers refuse).

/** Whether a slate is public: anyone may find and open it. */
export const publicSlate = slate => Boolean(slate?.options?.isPublic && !slate.options.isPrivate && !slate.options.isUnlisted)

/** The board picture a public slate's share card shows, or null (the card then shows the logo). */
export function slateShareImage(slate, cloudUrl) {
  if (!publicSlate(slate) || typeof slate.options.staticImage !== 'string' || !cloudUrl) return null
  try {
    const image = new URL(slate.options.staticImage)
    const store = new URL(cloudUrl)
    if (image.protocol !== 'https:' || image.origin !== store.origin || image.username || image.password || image.search || image.hash) return null
    // The preview getCloudLink stores: <slate id>_<time>.png, under the store's date folders.
    const id = String(slate.options.id ?? '')
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !new RegExp(`/${id}_\\d+\\.png$`).test(image.pathname)) return null
    return image.href
  } catch {
    return null
  }
}

/** What a public slate's share card says beside its picture: its name and description, or none. */
export function slateShareText(slate) {
  if (!publicSlate(slate)) return null
  const plain = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')
  const name = plain(slate.options.name, 120)
  if (!name || /^untitled( slate)?$/i.test(name)) return null
  return { title: name, description: plain(slate.options.description, 300) }
}
