// Picture search for a note: on the server, with the search key kept there. The method runs it
// inside a metered AI request (images.js), and the provider search charges each Google query to
// that request: the included amount (Pro credits), then the balance; an own AI key never covers it. `deps` keeps the
// search provider replaceable (and testable): search({ query, page, limit }) asks the provider.

export const PICTURE_PAGE = 9
export const PICTURE_PAGES = 3

export class PictureSearchRefused extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export async function searchImagesForNote(deps, user, opts = {}) {
  if (!user || user.isAnonymous) {
    throw new PictureSearchRefused('register', 'Register (it takes a second) to search for pictures.')
  }
  const query = String(opts.query ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!query) throw new PictureSearchRefused('invalid', 'Type what to search for.')
  const page = Number.isInteger(opts.page) ? opts.page : 0
  if (page < 0 || page >= PICTURE_PAGES) throw new PictureSearchRefused('invalid', 'There are no more pictures for this search.')
  const res = await deps.search({ query, page, limit: PICTURE_PAGE })
  const items = (res?.items ?? []).filter((item) => typeof item?.link === 'string' && /^https:\/\//.test(item.link)).map((item) => ({
    link: item.link,
    title: String(item.title ?? '').slice(0, 200),
    thumbnail: item.image?.thumbnailLink ?? item.link,
    width: item.image?.width,
    height: item.image?.height,
  }))
  return { items, more: Boolean(res?.queries?.nextPage?.length) && page + 1 < PICTURE_PAGES }
}
