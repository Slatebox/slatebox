// The fields dashboard search reads (options.searchName, searchDescription, searchText). The
// server builds them on every save (server/slate-save-core.mjs); no browser sends them.

// Edge n-grams: "Review" -> "Rev Revi Revie Review", so a partial word finds the slate.
// (After https://stackoverflow.com/questions/44833817/mongodb-full-and-partial-text-search)
// Bounded, because a note's text is the writer's to choose (the API contract allows 10000
// characters): a word gives its prefixes up to GRAM_LIMIT characters, and itself whole when it is
// at most WORD_LIMIT long; a field stops at FIELD_LIMIT characters. Unbounded, one 6000-character
// word made 18 MB of search text, over MongoDB's 16 MB document limit, and no save could land.
export const GRAM_LIMIT = 20
export const WORD_LIMIT = 64
export const FIELD_LIMIT = 100000

export function edgeNGrams(text) {
  if (typeof text !== 'string') return ''
  if (text.length <= 3) return text
  const parts = []
  let length = -1
  const add = (part) => {
    if (length + 1 + part.length > FIELD_LIMIT) return false
    parts.push(part)
    length += 1 + part.length
    return true
  }
  for (const token of text.split(' ')) {
    if (token.length <= 3) {
      if (!add(token)) break
      continue
    }
    let full = true
    for (let i = 3; i <= Math.min(token.length, GRAM_LIMIT) && full; i += 1) full = add(token.slice(0, i))
    if (full && token.length > GRAM_LIMIT && token.length <= WORD_LIMIT) full = add(token)
    if (!full) break
  }
  return parts.join(' ')
}

export const searchName = (name) => edgeNGrams(name)
export const searchDescription = (description) => edgeNGrams(description)
export const searchText = (nodes) =>
  edgeNGrams((Array.isArray(nodes) ? nodes : []).map((node) => node?.options?.text ?? '').join(' '))

export const SEARCH_FIELDS = ['searchName', 'searchDescription', 'searchText']

// Every search field of a whole slate document, for a slate being created.
export function searchFieldsOf({ options = {}, nodes = [] }) {
  return {
    searchName: searchName(options.name),
    searchDescription: searchDescription(options.description),
    searchText: searchText(nodes),
  }
}
