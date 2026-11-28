// The name under a slate's card: the owner's name the server put on the slate (authorName,
// server/common/slate-authors.mjs). Without one (an older answer) only the viewer's own slate is
// named, after them; someone else's slate is never given the viewer's name.
export function slateAuthorLabel(slate, viewerId, ownName) {
  if (typeof slate?.authorName === 'string' && slate.authorName) return slate.authorName
  if (viewerId && slate?.userId === viewerId && typeof ownName === 'function') return ownName()
  return ''
}

export default slateAuthorLabel
