// "@Slatebox …" in a comment or chat line asks the Slatebox agent. The request is the line
// without the mention; null when the line does not mention it or asks nothing.
const MENTION = /(^|[\s(])@slatebox\b[:,]?/i

export function slateboxRequest(text) {
  if (typeof text !== 'string' || !MENTION.test(text)) return null
  const request = text.replace(MENTION, '$1').replace(/\s+/g, ' ').trim().slice(0, 500)
  return request.length >= 2 ? request : null
}
