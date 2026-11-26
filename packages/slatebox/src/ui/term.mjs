// What the terminal can show, and the Slatebox look in it: colors by role (greens, gold, cream),
// glyphs (Unicode or ASCII), widths, and links. No dependencies.

// Brand colors: 24-bit, the nearest of the 256, and the 16-color fallback (SGR numbers).
const PALETTE = {
  green: { rgb: [0x2f, 0x5d, 0x50], c256: 29, c16: 32 },
  deep: { rgb: [0x1f, 0x3d, 0x34], c256: 23, c16: 32 },
  gold: { rgb: [0xe9, 0xb9, 0x49], c256: 179, c16: 33 },
  lightGold: { rgb: [0xf2, 0xc8, 0x79], c256: 222, c16: 33 },
  cream: { rgb: [0xf5, 0xef, 0xe0], c256: 230, c16: 37 },
}

const UNICODE = {
  active: '◆', done: '◇', gutter: '│', end: '└', pointer: '›', on: '●', off: '○',
  ok: '✓', warn: '▲', fail: '✗', stop: '■', star: '✦', dot: '·', ellipsis: '…', arrows: '↑↓',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  box: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
  cursor: '▌',
}
const ASCII = {
  active: '*', done: 'o', gutter: '|', end: '`', pointer: '>', on: '(*)', off: '( )',
  ok: '+', warn: '!', fail: 'x', stop: 'x', star: '*', dot: '-', ellipsis: '...', arrows: 'up/down',
  spinner: ['|', '/', '-', '\\'],
  box: { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' },
  cursor: '_',
}

/**
 * Color depth (0 = none, 4, 8 or 24 bits), glyphs and width for a stream.
 * NO_COLOR or FORCE_COLOR=0: no color codes at all (layout, symbols and keys stay).
 * FORCE_COLOR=1|2|3: 16, 256 or 16 million colors. Otherwise what the stream says.
 */
export function detectTerm(env, stream, platform = process.platform) {
  let depth
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') depth = 0
  else if (env.FORCE_COLOR === '0' || env.FORCE_COLOR === 'false') depth = 0
  else if (['1', '2', '3'].includes(env.FORCE_COLOR)) depth = { 1: 4, 2: 8, 3: 24 }[env.FORCE_COLOR]
  else {
    const said = typeof stream?.getColorDepth === 'function' ? stream.getColorDepth(env) : 4
    depth = said <= 1 ? 0 : said
  }
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || ''
  const unicode = Boolean(env.WT_SESSION || env.TERM_PROGRAM || /UTF-?8/i.test(locale) || platform === 'darwin')
  const hyperlinks = ['iTerm.app', 'WezTerm', 'vscode', 'ghostty'].includes(env.TERM_PROGRAM) || Boolean(env.WT_SESSION || env.VTE_VERSION)
  return { depth, unicode, hyperlinks, glyphs: unicode ? UNICODE : ASCII, stream }
}

/** The terminal's width now (it changes on resize); 80 when it cannot tell. */
export function columns(term) {
  const n = Number(term.stream?.columns)
  return n > 0 ? n : 80
}

function fg(depth, color) {
  const c = PALETTE[color]
  if (depth >= 24) return `\x1b[38;2;${c.rgb.join(';')}m`
  if (depth >= 8) return `\x1b[38;5;${c.c256}m`
  return `\x1b[${c.c16}m`
}
function bg(depth, color) {
  const c = PALETTE[color]
  if (depth >= 24) return `\x1b[48;2;${c.rgb.join(';')}m`
  if (depth >= 8) return `\x1b[48;5;${c.c256}m`
  return `\x1b[${c.c16 + 10}m`
}

/**
 * paint(role, text). Roles: ok (✓ marks), gold, lightGold, cream, dim, red, bold, and fills:
 * fill:<color> (a background) with cream text, or fill:<color>/<color> for background/text.
 */
export function makePaint(term) {
  const { depth } = term
  return function paint(role, text) {
    if (!depth || text === '') return text
    switch (role) {
      // A ✓ is a small green badge: green as a fill, never as text on a dark terminal.
      case 'ok': return `${bg(depth, 'green')}${fg(depth, 'cream')}${text}\x1b[0m`
      case 'gold': return `${fg(depth, 'gold')}${text}\x1b[39m`
      case 'lightGold': return `${fg(depth, 'lightGold')}${text}\x1b[39m`
      case 'cream': return `${fg(depth, 'cream')}${text}\x1b[39m`
      case 'title': return `\x1b[1m${fg(depth, 'cream')}${text}\x1b[0m`
      case 'dim': return `\x1b[2m${text}\x1b[22m`
      case 'red': return `\x1b[31m${text}\x1b[39m`
      case 'bold': return `\x1b[1m${text}\x1b[22m`
      case 'inverse': return `\x1b[7m${text}\x1b[27m`
      default: {
        const fill = /^fill:(\w+)(?:\/(\w+))?$/.exec(role)
        if (fill) return `${bg(depth, fill[1])}${fg(depth, fill[2] || 'cream')}${text}\x1b[0m`
        return text
      }
    }
  }
}

// CSI sequences, and OSC sequences ended by BEL or ST (OSC 8 links).
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
export const strip = text => String(text).replace(ANSI, '')

// East Asian wide and fullwidth characters, and emoji, take two cells.
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1f64f}\u{1f900}-\u{1f9ff}\u{20000}-\u{3fffd}]/u
/** Cells a string takes on screen, without its escape codes. */
export function width(text) {
  let n = 0
  for (const char of strip(text)) {
    const code = char.codePointAt(0)
    if (code < 32 || (code >= 0x300 && code <= 0x36f) || code === 0x200b) continue
    n += WIDE.test(char) ? 2 : 1
  }
  return n
}

/** text cut to at most n cells, ending in an ellipsis when it was longer (plain text only). */
export function truncate(text, n, ellipsis = '…') {
  if (width(text) <= n) return text
  let out = ''
  for (const char of text) {
    if (width(out + char) > n - width(ellipsis)) break
    out += char
  }
  return out + ellipsis
}

/** Pad to n cells (ANSI-aware). */
export const pad = (text, n) => text + ' '.repeat(Math.max(0, n - width(text)))

/** A link the terminal can open: OSC 8 where it is known to work, else the URL as it is. */
export function link(term, url, text = url) {
  return term.hyperlinks ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : text
}

/** Words wrapped to n cells (plain text). */
export function wrap(text, n) {
  const lines = []
  for (const paragraph of String(text).split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      if (line && width(line) + 1 + width(word) > n) { lines.push(line); line = word } else line = line ? `${line} ${word}` : word
    }
    lines.push(line)
  }
  return lines
}
