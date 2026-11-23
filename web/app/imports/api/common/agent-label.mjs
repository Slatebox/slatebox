// How an agent is named on a slate, for the server that writes it and the pages that show it.
// The owner's first name comes from their account; a client name an MCP client reported is
// cleaned and only ever shown after "{name}'s agent ·".

export const CLIENT_NAME_CHARS = 40
export const STEP_CHARS = 80

// Control characters, bidirectional overrides and isolates, zero-width characters, line and\n// paragraph separators, and blank symbols that draw nothing (the blank braille pattern).
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u206f\u2800\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufff8]/gu

/**
 * The name an MCP client reported, as it may be shown: NFKC, no invisible or direction
 * characters, only letters, digits, spaces and . - _ ( ), whitespace collapsed, at most 40
 * characters. Null when nothing is left.
 */
export function sanitizeClientName(raw) {
  if (typeof raw !== 'string') return null
  const cleaned = clean(raw)
  // A client name never claims to be Slatebox, staff or a person.
  if (cleaned && CLAIMS.test(fold(cleaned))) return null
  return cleaned
}

// Letters from other scripts that look like Latin ones, as the Latin letter: "Аda" (Cyrillic А)
// reads as "Ada". Enough of Unicode's confusables list for names and words in a label.
const CONFUSABLE = new Map(Object.entries({
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y', І: 'I', Ј: 'J', Ѕ: 'S',
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', һ: 'h', ԁ: 'd', ԛ: 'q', ԝ: 'w', ɑ: 'a',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
  ο: 'o', ν: 'v', ι: 'i', κ: 'k', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ϲ: 'c', ı: 'i', ℓ: 'l',
}))
/** A word as it looks: every letter that passes for a Latin one, as that Latin letter. */
export const skeleton = (text) => [...String(text ?? '')].map((char) => CONFUSABLE.get(char) ?? char).join('')

// A word as it reads, loosely: look-alike letters as Latin ones, lower case, and i, l, 1 and |
// (and o and 0) as one letter each, so "S\u0406atebox" or "0fficial" still reads as the word.
const fold = (text) => skeleton(text).toLowerCase().replace(/[il1|]/g, 'l').replace(/0/g, 'o')
// Words a client's name may not use: it would read as Slatebox itself, its staff, or a person.
const CLAIM_WORDS = ['slatebox', 'official', 'verified', 'admin', 'administrator', 'moderator', 'staff', 'support', 'system', 'person', 'human', 'owner']
const CLAIMS = new RegExp('(?:^|[^a-z0-9])(?:' + CLAIM_WORDS.map(fold).join('|') + ')(?:$|[^a-z0-9])')


function clean(raw) {
  const cleaned = raw
    .slice(0, 400)
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(/[^\p{L}\p{N} ._\-()]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CLIENT_NAME_CHARS)
    .trim()
  return cleaned || null
}

/** Plain step text: one line, no invisible characters, 1 to 80 characters. */
export function cleanStepText(raw) {
  if (typeof raw !== 'string') return ''
  return raw.normalize('NFKC').replace(INVISIBLE, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, STEP_CHARS).trim()
}

const word = (text) => (typeof text === 'string' ? text.normalize('NFKC').replace(INVISIBLE, '').trim().split(/[\s._+\-@]+/)[0] : '')
const capital = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text)

/** The owner's first name: the profile's, or the first word of the email's local part. */
export function firstNameOf(user) {
  const profile = user?.profile || {}
  const name = word(profile.firstName) || word(profile.name) || word(user?.name)
  const email = user?.emails?.[0]?.address || user?.email || ''
  const fromEmail = typeof email === 'string' ? capital(word(email.split('@')[0])) : ''
  const chosen = (name || fromEmail).replace(/[^\p{L}\p{N}'’-]/gu, '').slice(0, 24)
  // A name that mixes Latin with letters that pass for Latin ("Аda") is shown as it reads.
  const latin = /\p{Script=Latin}/u.test(chosen) && /[^\p{Script=Latin}\p{N}'’-]/u.test(chosen) ? skeleton(chosen) : chosen
  return latin || 'Someone'
}

/** An initial that tells two people of one first name apart: the last name's, else the email's second word's, else its domain's. */
export function initialOf(user) {
  const profile = user?.profile || {}
  const email = user?.emails?.[0]?.address || user?.email || ''
  const [local = '', domain = ''] = typeof email === 'string' ? email.split('@') : []
  const candidates = [profile.lastName, word(String(profile.name || '').split(/\s+/).slice(1).join(' ')), local.split(/[._+\-]+/)[1], domain]
  const found = candidates.map((text) => skeleton(word(text || '')).replace(/[^\p{L}\p{N}]/gu, '')).find(Boolean)
  return found ? found.charAt(0).toUpperCase() : ''
}

/** Whether two first names read the same on screen. */
export const sameName = (a, b) => skeleton(a).toLowerCase() === skeleton(b).toLowerCase()

/** "Ada's agent", or "Ada's agent · Client" when the MCP client reported a name. */
export function agentLabel(firstName, client) {
  const owner = firstName + "'s agent"
  const name = sanitizeClientName(client)
  return name ? owner + ' · ' + name : owner
}


