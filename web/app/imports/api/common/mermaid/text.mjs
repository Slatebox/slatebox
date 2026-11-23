// Text and names in Mermaid source. A label is always written in double quotes, with every
// character Mermaid could read as syntax written as an entity code (#quot; #35; ...), so any
// note text survives: quotes, brackets, pipes, semicolons, markup, backticks, line breaks and
// any Unicode. Reading reverses it, and also takes the forms people write by hand.

// Mermaid's own spellings of the characters that end or change a quoted label. `#` comes first:
// every other code starts with it.
const CODES = [
  ['#', '#35;'],
  ['"', '#quot;'],
  ['&', '#amp;'],
  ['<', '#lt;'],
  ['>', '#gt;'],
  ['`', '#96;'],
  ['|', '#124;'],
  ['%', '#37;'],
  ['\\', '#92;'],
]

/** A note's text as the inside of a quoted Mermaid label. */
export function encodeLabel(text) {
  let out = `${text ?? ''}`.replace(/\r\n?/g, '\n')
  for (const [from, to] of CODES) out = out.split(from).join(to)
  out = out.replace(/\n/g, '<br>')
  // Mermaid drops the last ; of any line holding the word style or classDef, a colon and an
  // entity code (it guards its own style lines that way), which would cut a label's last code.
  out = out.replace(/style/g, '#115;tyle').replace(/classDef/g, '#99;lassDef')
  // Mermaid trims a label; a label of nothing but spaces (or nothing) is not valid, a space is.
  return out.trim() === '' ? ' ' : out
}

/** A quoted label: "...". */
export const quoted = (text) => `"${encodeLabel(text)}"`

const NAMED = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ', num: '#', hash: '#' }

/** Entity codes (Mermaid's #quot; #35; and HTML's &amp; &#35; &#x23;) back to characters. */
export function decodeEntities(text) {
  return `${text}`.replace(
    /&#x([0-9a-fA-F]{1,6});|&#([0-9]{1,7});|&([A-Za-z]{2,8});|#([0-9]{1,7});|#([A-Za-z]{2,8});/g,
    (whole, hex, htmlNumber, htmlName, number, name) => {
      if (hex) return codePoint(parseInt(hex, 16), whole)
      if (htmlNumber || number) return codePoint(Number(htmlNumber || number), whole)
      const key = (htmlName || name).toLowerCase()
      return Object.hasOwn(NAMED, key) ? NAMED[key] : whole
    }
  )
}

// A code that names no printable character is left as it was written.
const codePoint = (n, fallback) =>
  Number.isInteger(n) && n <= 0x10ffff && (n >= 32 || n === 9 || n === 10) && !(n >= 0xd800 && n <= 0xdfff)
    ? String.fromCodePoint(n)
    : fallback

/** A label as written in Mermaid source back to plain text. */
export function decodeLabel(raw) {
  let text = `${raw ?? ''}`.trim()
  // "...": quoted. "`...`": a Markdown string; its words are kept as written.
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1)
  if (text.length >= 2 && text.startsWith('`') && text.endsWith('`')) text = text.slice(1, -1)
  text = text.replace(/<br\s*\/?>/gi, '\n')
  return decodeEntities(text).trim()
}

// Words Mermaid reads as keywords where a name is expected.
const RESERVED = new Set([
  'end', 'graph', 'flowchart', 'subgraph', 'style', 'linkstyle', 'classdef', 'class', 'click', 'call',
  'href', 'default', 'direction', 'interpolate', 'mindmap', 'gantt', 'section', 'title', 'td', 'tb', 'bt',
  'rl', 'lr',
])

// Letters, digits and _, with single dashes or dots inside (my-step, v1.2) as Mermaid reads them.
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_]*(?:[-.][A-Za-z0-9_]+)*$/

/** Whether a note id can be written as a Mermaid name unchanged. */
export const isSafeId = (id) => SAFE_ID.test(id) && !RESERVED.has(id.toLowerCase()) && !RESERVED.has(id.split(/[-.]/)[0].toLowerCase())

/**
 * Names for a set of ids: the id itself where Mermaid accepts it, otherwise a cleaned form,
 * each unique (and never one another id already uses).
 */
export function idNamer(prefix = 'n') {
  const used = new Set()
  const given = new Map()
  return function name(id) {
    if (given.has(id)) return given.get(id)
    let base = `${id ?? ''}`
    if (!isSafeId(base)) {
      base = base.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
      if (!base || !/^[A-Za-z_]/.test(base) || RESERVED.has(base.toLowerCase())) base = `${prefix}_${base || 'x'}`
    }
    // Never the words style or classDef inside a name (see encodeLabel): Mermaid's guard for
    // its own style lines would cut the line's last code.
    base = base.replace(/style/g, 'Style').replace(/classDef/g, 'ClassDef')
    let out = base
    for (let i = 2; used.has(out); i += 1) out = `${base}_${i}`
    used.add(out)
    given.set(id, out)
    return out
  }
}
