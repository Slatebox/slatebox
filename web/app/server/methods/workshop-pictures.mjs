// A note's picture held in the page itself (a data: address) goes with the card it becomes: before
// the trade is made it is stored with the slate's pictures (the same file store the slate's images
// use), and the card keeps its address, which the note gets back. With no file store there is
// nowhere to keep it, and the note stays a note.

const dataPicture = /^data:(image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$/i
const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' }
const noStore = 'This slate has nowhere to keep a picture held in the page, so the note stays a note.'

const refusal = (reason, at, laneId = null) => Object.assign(new Error(reason), { refused: { reason, laneId }, at })

/** Store one data: picture; its address, or the same src when it is not one. */
async function stored(src, { slateId, store }, at, laneId) {
  const match = typeof src === 'string' && dataPicture.exec(src)
  if (!match) return src
  if (!store) throw refusal(noStore, at, laneId)
  const contentType = match[1].toLowerCase().replace('image/jpg', 'image/jpeg')
  const body = Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
  const key = `workshop-pictures/${slateId}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${extension[contentType]}`
  try {
    const url = await store({ body, contentType, key })
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('no address')
    return url
  } catch {
    throw refusal('The picture could not be stored, so the note stays a note. Try again.', at, laneId)
  }
}

/**
 * The changes of one request with every picture held in the page stored and replaced by its address.
 * `store({ body, contentType, key })` answers the stored picture's address; null when the slate has no file store.
 */
export async function storeTradePictures(changes, { slateId, store }) {
  const out = []
  for (const [at, change] of changes.entries()) {
    const image = change.noteToCard?.asNote?.image
    if (!image?.src || !dataPicture.test(image.src)) { out.push(change); continue }
    const src = await stored(image.src, { slateId, store }, at, change.laneId ?? null)
    out.push({ ...change, noteToCard: { ...change.noteToCard, asNote: { ...change.noteToCard.asNote, image: { ...image, src } } } })
  }
  return out
}

/** A whole workshop (a kept proposal, an undo) with its cards' pictures held in the page stored the same way. */
export async function storeWorkshopPictures(workshop, { slateId, store }) {
  if (!workshop?.cards?.some(card => dataPicture.test(card?.asNote?.image?.src ?? ''))) return workshop
  const cards = []
  for (const card of workshop.cards) {
    const src = card?.asNote?.image?.src
    cards.push(src && dataPicture.test(src)
      ? { ...card, asNote: { ...card.asNote, image: { ...card.asNote.image, src: await stored(src, { slateId, store }, null, card.laneId) } } }
      : card)
  }
  return { ...workshop, cards }
}
