// A request for ordinary notes, said in plain words: “add two notes”, “can you add a couple more
// regular notes”, “add a note called Call the printer”, “add notes: Budget, Venue and Catering”.
// Such a request is drawn as it stands, with no drafting. Notes about something (“add notes about
// our onboarding risks”) have to be thought up, and are not read here.

const numbers = new Map([
  ['a', 1], ['an', 1], ['one', 1], ['another', 1], ['a new', 1], ['one more', 1], ['a couple', 2], ['a couple of', 2], ['couple', 2],
  ['a pair of', 2], ['two', 2], ['three', 3], ['a few', 3], ['few', 3], ['four', 4], ['five', 5], ['six', 6], ['seven', 7],
  ['eight', 8], ['nine', 9], ['ten', 10], ['eleven', 11], ['twelve', 12],
])
// Numbers past what one request adds, said in words.
const tooMany = '(?:thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|a hundred|hundreds of|dozens of|a dozen|lots of|many|loads of)'
const mostNotes = 12
const politely = /^(?:(?:can|could|would|will) you(?: please)?\s+|please\s+|i(?:'|’)?d like (?:you to\s+)?|i want (?:you to\s+)?|let(?:'|’)?s\s+)/i
const kinds = '(?:(?:more|new|other|extra|regular|ordinary|plain|blank|empty|normal|simple|sticky)\\s+)*'
const nouns = '(?:sticky notes?|stickies|notes?|post-?its?)'
const where = '(?:\\s+(?:to|on|onto|in)\\s+(?:the\\s+|this\\s+|my\\s+)?(?:slate|canvas|board|drawing|page))?'

// What follows the verb of a plain request for notes (“two notes”, “a note called X”), or null.
function requested(message) {
  let words = typeof message === 'string' ? message.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '') : ''
  if (!words || /[→\n]|->/.test(words)) return null
  words = words.replace(politely, '').replace(politely, '')
  const verb = /^(?:add|make|create|put|draw|write|give me|drop|place|start)\s+(.+)$/i.exec(words)
  return verb ? verb[1] : null
}

/**
 * Why a plain request for notes can't be drawn as it stands (too many at once, or markup in their
 * words), as a sentence to answer with; null when there is nothing wrong with it, or it is not one.
 */
export function noteRequestProblem(message) {
  const rest = requested(message)
  if (!rest || noteRequest(message)) return null
  const counted = new RegExp('^(\\d+|' + tooMany + ')\\s+(?:more\\s+)?' + kinds + nouns + where + '$', 'i').exec(rest)
  if (counted && (!/^\d+$/.test(counted[1]) || Number(counted[1]) > mostNotes)) return 'I can add up to ' + mostNotes + ' notes at a time.'
  const named = new RegExp('^(?:(?:a|an|one|another|a new|new|some|two|three|four|five|\\d+)\\s+)?(?:more\\s+)?' + kinds + nouns +
    '(?:\\s+(?:called|named|titled|saying|that says?|reading)\\s+|\\s*:\\s*)(.+)$', 'i').exec(rest)
  if (named && /[<>]/.test(named[1])) return 'A note holds plain words: leave out < and >.'
  if (named && named[1].split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*;\s*/).filter(Boolean).length > mostNotes) return 'I can add up to ' + mostNotes + ' notes at a time.'
  return null
}

/** The notes a message asks for: `{ labels }`, or null when it is not a plain request for notes. */
export function noteRequest(message) {
  const rest = requested(message)
  if (!rest) return null
  // Notes by name: “a note called X”, “notes: X, Y and Z”.
  const named = new RegExp('^(?:(?:a|an|one|another|a new|new|some|two|three|four|five|\\d+)\\s+)?(?:more\\s+)?' + kinds + nouns +
    '(?:\\s+(?:called|named|titled|saying|that says?|reading)\\s+|\\s*:\\s*)(.+)$', 'i').exec(rest)
  if (named) {
    const labels = named[1].replace(new RegExp(where + '$', 'i'), '').split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*;\s*/)
      .map(label => label.trim().replace(/^[“"'‘]|[”"'’]$/g, '').trim()).filter(Boolean)
    return labels.length && labels.length <= mostNotes && labels.every(label => label.length <= 200 && !/[<>]/.test(label)) ? { labels } : null
  }
  // Notes by number: “two notes”, “a couple more regular notes”, “3 sticky notes on the canvas”.
  const counted = new RegExp('^(?:(\\d+|' + [...numbers.keys()].sort((a, b) => b.length - a.length).join('|') + ')\\s+)?(?:more\\s+)?' + kinds + '(' + nouns + ')' + where + '$', 'i').exec(rest)
  if (!counted) return null
  const amount = counted[1] === undefined ? (/s$/i.test(counted[2]) ? 2 : 1) : /^\d+$/.test(counted[1]) ? Number(counted[1]) : numbers.get(counted[1].toLowerCase())
  if (!amount || amount < 1 || amount > mostNotes) return null
  return { labels: Array.from({ length: amount }, () => 'New note') }
}
