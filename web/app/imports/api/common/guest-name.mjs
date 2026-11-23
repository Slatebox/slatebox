// A person on a slate is known to their peers by a key (server/common/person-key.mjs). Their colour,
// and a guest's name, follow from that key alone, so every viewer, every cursor and every tab of
// theirs shows the same: "Teal Otter (guest)" is the same person whoever is looking.

import { personColor } from './agent-colors.mjs'

// FNV-1a, 32 bits: no secret is needed, the key is already opaque.
function hash(text, salt) {
  let h = 0x811c9dc5
  for (const ch of `${salt}:${text}`) {
    h ^= ch.codePointAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

// Twelve names, one for each 30° of hue, so a guest's name says the colour of their ring and pointer.
const COLOURS = ['Red', 'Rust', 'Olive', 'Moss', 'Green', 'Jade', 'Teal', 'Blue', 'Indigo', 'Violet', 'Plum', 'Rose']
const ANIMALS = ['Otter', 'Heron', 'Badger', 'Fox', 'Lynx', 'Owl', 'Hare', 'Wren', 'Seal', 'Moose', 'Crane', 'Bison',
  'Robin', 'Gecko', 'Koala', 'Panda', 'Raven', 'Tiger', 'Whale', 'Yak', 'Llama', 'Finch', 'Ibis', 'Marten']

const hueOf = (key) => hash(String(key), 'hue') % 360

/** A guest's name, from their key: the same for every viewer. */
export function guestNameFor(key) {
  return `${COLOURS[Math.floor(hueOf(key) / 30)]} ${ANIMALS[hash(String(key), 'animal') % ANIMALS.length]} (guest)`
}

/**
 * A person's colour, from their key: readable under white text and the same on each of their tabs.
 * `lightness` (0 to 1) keeps the hue, for a colour that would be mistaken for an agent's.
 */
export function personColour(key, lightness = 0.38) {
  const hue = hueOf(key)
  // HSL at 45% saturation and 38% lightness (by default), as #rrggbb.
  const s = 0.45
  const l = lightness
  const k = (n) => (n + hue / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return `#${[f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`
}

// Lightness tried for a person's cursor colour when the hue at 38% is near an agent's: only the
// same or darker, so the colour reads on white (a cursor's name is drawn in it on a white box) and
// white text on it stays readable. Every hue finds one of these that is not near an agent's.
const PERSON_SHADES = [0.38, 0.32, 0.28, 0.24, 0.2, 0.16, 0.12]

/**
 * A person's cursor colour, from their key: their hue (the one their guest name says), as light as
 * 38% and darker where that is near an agent's colour (agent-colors.mjs). The same on every tab.
 */
export function personCursorColour(key) {
  const shades = [...PERSON_SHADES]
  return personColor(() => personColour(key, shades.length > 1 ? shades.shift() : shades[0]))
}
