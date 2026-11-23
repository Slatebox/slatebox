// Reading what a person wrote about the things on a workshop: names as people write them
// (“the Now lane”, “Customer calls” for “Customer calls · $50 per call”, “this”), numbers as
// words, and the politeness around a request. Shared by the lane and map conversations.

export const said = text => '“' + text + '”'
export const listed = names => names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names.at(-1)
const escaped = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const unquoted = text => text.trim().replace(/^["'“‘](.+)["'”’]$/, '$1').trim()
// A sentence ends in a full stop; the name it gives something does not. Quotes keep one that is meant.
const stopless = text => text.trim().replace(/([^.…])[.!]$/, '$1')
/** The name a person gave something: without the sentence's full stop or the quotes around it. */
export const named = text => unquoted(stopless(text))
/** Match a whole message, with or without its closing full stop. */
export const whole = message => pattern => {
  const form = new RegExp('^' + pattern + '$', 'i')
  return form.exec(message) ?? form.exec(stopless(message))
}

const numberWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']
export const N = '(\\d+|' + numberWords.join('|') + '|an?|a single)'
export const count = text => /^\d+$/.test(text) ? Number(text) : /^an?$|^a single$/i.test(text) ? 1 : numberWords.indexOf(text.toLowerCase())
export const atMost = '(?:up to |at most |only |just |a maximum of |a max of |no more than |as many as )?'
export const things = '(?:\\s+(?:cards?|points?|items?|things?|notes?|tokens?))?'

// The ways a person may refer to one lane or card: its name, with or without “the”, the word
// “lane” or “card”, or quotes around it.
function spellings(reference, noun) {
  const seen = new Set()
  const add = text => { const name = unquoted(text); if (name) seen.add(name) }
  add(reference)
  add(stopless(reference))
  for (const text of [...seen]) add(text.replace(/^(?:the|my|our)\s+/i, ''))
  for (const text of [...seen]) add(text.replace(new RegExp('^(?:' + noun + ')\\s+(?:(?:called|named)\\s+)?', 'i'), ''))
  for (const text of [...seen]) add(text.replace(new RegExp('\\s+(?:' + noun + ')$', 'i'), ''))
  return [...seen]
}

export const pointing = /^(?:this|it|that|here|there|this one|that one|(?:this|that|the selected|the current) (?:lane|column|card|feature|step|station|stop|token|one))$/i
const wordEdge = '[^\\p{L}\\p{N}]'
// From the most exact reading to the loosest. The first reading that picks anything decides.
const readings = [
  (label, name) => label === name,
  // “Customer calls” for “Customer calls · $50 per call”.
  (label, name) => label.startsWith(name + ' · '),
  (label, name) => name.length > 1 && new RegExp('^' + escaped(name) + '(?:$|' + wordEdge + ')', 'u').test(label),
  (label, name) => name.length > 2 && new RegExp('(?:^|' + wordEdge + ')' + escaped(name) + '(?:$|' + wordEdge + ')', 'u').test(label),
]

const ordinals = ['first', 'second', 'third', 'fourth', 'fifth']
// “the first lane”, “lane 2”, “the last step”: a place in the row, for things that have one.
function placed(items, reference, noun) {
  const found = new RegExp('^(?:the\\s+)?(?:(' + ordinals.join('|') + '|last)\\s+(?:' + noun + ')|(?:' + noun + ')\\s+(\\d|one|two|three|four|five))$', 'i').exec(unquoted(stopless(reference)))
  if (!found) return null
  const word = (found[1] ?? found[2]).toLowerCase()
  const index = word === 'last' ? items.length - 1 : found[1] ? ordinals.indexOf(word) : count(word) - 1
  return items[index] ?? null
}

/** The one item a reference picks: `{ item }`, `{ several }` when it picks more than one, or `{}`. */
function lookUp(items, reference, noun, selectedId, ordered) {
  const names = spellings(reference, noun)
  if (names.some(name => pointing.test(name))) {
    const selected = selectedId && items.find(item => item.id === selectedId)
    return selected ? { item: selected, rank: 0 } : { pointing: true }
  }
  for (const name of names) {
    if (!name.startsWith('@')) continue
    const item = items.find(item => item.id === name.slice(1))
    if (item) return { item, rank: 0 }
  }
  for (const [rank, reading] of readings.entries()) {
    for (const name of names) {
      const matches = items.filter(item => reading(item.label.toLowerCase(), name.toLowerCase()))
      if (matches.length === 1) return { item: matches[0], rank }
      if (matches.length > 1) return { several: matches }
    }
  }
  // Nothing is called that. In a row of lanes or steps it may be a place: “the first lane”.
  const item = ordered ? placed(items, reference, noun) : null
  return item ? { item, rank: readings.length } : {}
}

/**
 * Looks things up by what a person called them. `find` throws a sentence for the person when the
 * name picks nothing or more than one thing; `attempt` returns null instead.
 */
export function finder(items, noun, what, selectedId, ordered = false) {
  const attempt = reference => lookUp(items, reference, noun, selectedId, ordered).item ?? null
  // How exactly a reference names something here: 0 for its whole name, more for a looser reading.
  const rank = reference => lookUp(items, reference, noun, selectedId, ordered).rank ?? Infinity
  const find = reference => {
    const found = lookUp(items, reference, noun, selectedId, ordered)
    if (found.item) return found.item
    const name = spellings(reference, noun).at(-1)
    if (found.pointing) throw Error('Select a ' + what + ' on the canvas first, or use its name.')
    if (found.several) {
      const labels = [...new Set(found.several.map(item => item.label))]
      throw Error(labels.length === 1
        ? found.several.length + ' ' + what + 's are called ' + said(labels[0]) + '. Select the one you mean on the canvas and say “this ' + what + '”.'
        : 'More than one ' + what + ' matches ' + said(name) + ': ' + listed(labels.slice(0, 6)) + '. Use the whole name.')
    }
    const labels = items.map(item => item.label)
    throw Error('There is no ' + what + ' called ' + said(name) + ' here.' + (labels.length && labels.length <= 6
      ? ' The ' + what + 's are ' + listed(labels) + '.' : labels.length ? '' : ' There are no ' + what + 's yet.'))
  }
  return { find, attempt, rank }
}

// Every way of cutting “LEFT word RIGHT” in two, for names that hold the word themselves
// (“Listen to the tide”), in the order they appear.
export function cuts(text, words) {
  const pattern = new RegExp('\\s+(?:(?:back|up|down|over|forward|across|straight)\\s+)?(?:' + words + ')\\s+', 'gi')
  const out = []
  for (let found; (found = pattern.exec(text));) {
    out.push([text.slice(0, found.index), text.slice(found.index + found[0].length)])
    pattern.lastIndex = found.index + 1
  }
  return out
}

export function several(text, find) {
  const whole = text.split(/\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+|\s*&\s*/).filter(Boolean)
  try { return whole.map(find) } catch (problem) {
    // A name may hold “and” itself. Commas alone then separate the names.
    const byComma = text.split(/\s*,\s*/).filter(Boolean)
    if (byComma.length === whole.length) throw problem
    return byComma.map(find)
  }
}

// “Please” and “can you …?” are how people ask. They are not part of what is asked.
export function plainRequest(message) {
  let text = message.trim().replace(/\s+/g, ' ')
  const asked = /^(?:(?:please|hey|hi|ok(?:ay)?)[,:]?\s+)*(?:can|could|would|will) you\s/i.test(text)
  for (let before; before !== text;) {
    before = text
    text = text.replace(/^(?:please|pls|kindly|now|then|and|ok(?:ay)?|hey|hi|slatebox)[,:]?\s+/i, '')
      .replace(/^(?:can|could|would|will) you\s+/i, '')
      .replace(/^(?:i(?: would|'d|’d) like(?: you)? to|i want(?: you)? to|i need(?: you)? to|let(?:'|’)s|we should|you should)\s+/i, '')
  }
  text = text.replace(/,?\s+(?:please|pls|thanks|thank you|for me)([.!?]?)$/i, '$1')
  if (asked) text = text.replace(/\?$/, '')
  return text.trim()
}

