// What the terminal can show, and the Slatebox look in it: colors by role (text in the terminal's
// own color, accents that follow the background), glyphs (Unicode or ASCII), widths, and links.
// No dependencies.

// Brand colors: 24-bit, the nearest of the 256, and the 16-color fallback (SGR numbers). Text that
// must be read (questions, answers, the plan, the setup link, commands) is never painted in these:
// it is the terminal's own foreground, bold where it matters, so it reads on light and dark
// backgrounds alike. Colors are for accents (pointers, step marks, tags, warnings), and which
// accents depend on the background: gold on dark, deep green on light, and mid tones that keep at
// least 3:1 on both when the background is not known.
const PALETTE = {
  green: { rgb: [0x2f, 0x5d, 0x50], c256: 29, c16: 32 },
  deep: { rgb: [0x1f, 0x3d, 0x34], c256: 23, c16: 32 },
  gold: { rgb: [0xe9, 0xb9, 0x49], c256: 179, c16: 33 },
  cream: { rgb: [0xf5, 0xef, 0xe0], c256: 230, c16: 37 },
  // Accents on a light background: 7.5:1 and 5.9:1 on white.
  pine: { rgb: [0x2f, 0x5d, 0x50], c256: 23, c16: 32 },
  amber: { rgb: [0x8a, 0x5a, 0x00], c256: 94, c16: 33 },
  // Accents when the background is not known: 4.2:1 on white and 5.0:1 on black; 4.5:1 and 4.7:1.
  sage: { rgb: [0x3a, 0x8a, 0x6a], c256: 29, c16: 32 },
  ochre: { rgb: [0x9a, 0x6f, 0x12], c256: 136, c16: 33 },
}
const ACCENTS = {
  dark: { accent: 'gold', warn: 'gold' },
  light: { accent: 'pine', warn: 'amber' },
  unknown: { accent: 'sage', warn: 'ochre' },
}

/**
 * The terminal's background from what it says without being asked: SLATEBOX_THEME=light|dark, or
 * COLORFGBG ("15;0": the last number is the background; 7 and 9-15 are light).
 * @returns {'light'|'dark'|'unknown'}
 */
export function backgroundFromEnv(env) {
  const theme = String(env.SLATEBOX_THEME || '').toLowerCase()
  if (theme === 'light' || theme === 'dark') return theme
  const fgbg = /(?:^|;)(\d+)$/.exec(String(env.COLORFGBG || ''))
  if (fgbg) {
    const n = Number(fgbg[1])
    return n === 7 || (n >= 9 && n <= 15) ? 'light' : 'dark'
  }
  return 'unknown'
}

/** light or dark from an OSC 11 answer ("rgb:ffff/ffff/ffff"), by relative luminance. */
export function backgroundFromRgb(answer) {
  const m = /rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i.exec(String(answer))
  if (!m) return 'unknown'
  const [r, g, b] = m.slice(1, 4).map(hex => parseInt(hex, 16) / (16 ** hex.length - 1))
  const lin = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.4 ? 'light' : 'dark'
}

/**
 * Ask the terminal for its background (OSC 11), followed by a device-attributes query (DA1) that
 * nearly every terminal answers: when DA1 comes back first, the terminal does not answer OSC 11
 * and the wait ends at once. At most `timeout` ms; anything else typed meanwhile is dropped.
 * Only for the real terminal, in raw mode, before the first question.
 * @returns {Promise<'light'|'dark'|'unknown'>}
 */
export function queryBackground(input, output, { timeout = 300 } = {}) {
  if (!input?.isTTY || typeof input.setRawMode !== 'function' || !output?.isTTY) return Promise.resolve('unknown')
  return new Promise(resolve => {
    let buffer = ''
    let settled = false
    const wasRaw = Boolean(input.isRaw)
    const finish = answer => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      input.off('data', onData)
      try { input.setRawMode(wasRaw) } catch { /* closed */ }
      input.pause()
      resolve(answer)
    }
    const onData = chunk => {
      buffer += String(chunk)
      const osc = /\x1b\]11;([^\x07\x1b]*)(?:\x07|\x1b\\)/.exec(buffer)
      if (osc) return finish(backgroundFromRgb(osc[1]))
      if (/\x1b\[\?[\d;]*c/.test(buffer)) finish('unknown')
    }
    // Not unref'd: a terminal that never answers is given `timeout` ms, then the run goes on.
    const timer = setTimeout(() => finish('unknown'), timeout)
    try {
      input.setRawMode(true)
      input.on('data', onData)
      input.resume()
      output.write('\x1b]11;?\x1b\\\x1b[c')
    } catch { finish('unknown') }
  })
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
export function detectTerm(env, stream, platform = process.platform, background = backgroundFromEnv(env)) {
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
  return { depth, unicode, hyperlinks, glyphs: unicode ? UNICODE : ASCII, stream, background: ACCENTS[background] ? background : 'unknown' }
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
 * paint(role, text). Text roles use the terminal's own foreground: title and value (bold), link
 * (bold, underlined), dim, bold, inverse. Accent roles follow the background: accent (pointers,
 * step marks, tags), warn (▲), red, ok (the ✓ badge). Fills: fill:<color> (a background) with
 * cream text, or fill:<color>/<color> for background/text (the logo).
 */
export function makePaint(term) {
  const { depth } = term
  const accents = ACCENTS[term.background] || ACCENTS.unknown
  return function paint(role, text) {
    if (!depth || text === '') return text
    switch (role) {
      // A ✓ is a small badge: cream on green reads on any background.
      case 'ok': return `${bg(depth, 'green')}${fg(depth, 'cream')}${text}\x1b[0m`
      case 'accent': return `${fg(depth, accents.accent)}${text}\x1b[39m`
      case 'warn': return `${fg(depth, accents.warn)}${text}\x1b[39m`
      case 'title':
      case 'value': return `\x1b[1m${text}\x1b[22m`
      case 'link': return `\x1b[1;4m${text}\x1b[22;24m`
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

/**
 * Words wrapped to n cells (plain text). A word longer than a line (a path, a URL) is broken after
 * a slash where it can be, else at the edge; nothing is cut off.
 */
export function wrap(text, n) {
  const lines = []
  const pieces = word => {
    const out = []
    let rest = word
    while (width(rest) > n) {
      let cut = ''
      for (const char of rest) { if (width(cut + char) > n) break; cut += char }
      const slash = cut.lastIndexOf('/')
      if (slash > 0 && slash < cut.length - 1) cut = cut.slice(0, slash + 1)
      out.push(cut)
      rest = rest.slice(cut.length)
    }
    out.push(rest)
    return out
  }
  for (const paragraph of String(text).split('\n')) {
    let line = ''
    for (const whole of paragraph.split(' ')) {
      for (const word of n > 0 ? pieces(whole) : [whole]) {
        if (line && width(line) + 1 + width(word) > n) { lines.push(line); line = word } else line = line ? `${line} ${word}` : word
      }
    }
    lines.push(line)
  }
  return lines
}
