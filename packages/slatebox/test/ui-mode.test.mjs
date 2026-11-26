// Which installer a run gets (src/ui/mode.mjs), and what the terminal can show (src/ui/term.mjs):
// the full matrix of flags, environment and terminals, each checked for its mode, color depth and
// glyphs.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickUi, resolveUi } from '../src/ui/mode.mjs'
import { backgroundFromEnv, backgroundFromRgb, detectTerm, makePaint, queryBackground, strip, width } from '../src/ui/term.mjs'

const tty = ({ columns = 100, raw = true, depth = 8 } = {}) => ({
  stdin: { isTTY: true, ...(raw ? { setRawMode() {} } : {}) },
  stderr: { isTTY: true, columns, getColorDepth: () => depth },
})
const run = (extra = {}) => ({ json: false, agentMode: false, yes: false, flags: {}, ...extra })

test('mode: --json, agents, a pipe and --yes ask nothing (none)', () => {
  assert.equal(pickUi(run({ json: true }), {}, tty()).mode, 'none')
  assert.equal(pickUi(run({ agentMode: true }), {}, tty()).mode, 'none')
  assert.equal(pickUi(run(), {}, { stdin: { isTTY: false }, stderr: { isTTY: true, columns: 100 } }).mode, 'none')
  assert.equal(pickUi(run(), {}, { stdin: { isTTY: true, setRawMode() {} }, stderr: { isTTY: false } }).mode, 'none')
  assert.equal(pickUi(run({ yes: true }), {}, tty()).mode, 'none')
  // --json wins over --plain, and a pipe over --plain.
  assert.equal(pickUi(run({ json: true, flags: { plain: true } }), {}, tty()).mode, 'none')
})

test('mode: --plain, SLATEBOX_PLAIN, TERM=dumb, CI, no raw mode and narrow terminals get the plain questions', () => {
  assert.equal(pickUi(run({ flags: { plain: true } }), {}, tty()).mode, 'plain')
  assert.equal(pickUi(run(), { SLATEBOX_PLAIN: '1' }, tty()).mode, 'plain')
  assert.equal(pickUi(run(), { SLATEBOX_PLAIN: '0' }, tty()).mode, 'rich')
  assert.equal(pickUi(run(), { TERM: 'dumb' }, tty()).mode, 'plain')
  assert.equal(pickUi(run(), { CI: 'true' }, tty()).mode, 'plain')
  assert.equal(pickUi(run(), { CI: '' }, tty()).mode, 'rich', 'an empty CI is not set')
  assert.equal(pickUi(run(), {}, tty({ raw: false })).mode, 'plain', 'the fake terminal of the older tests has no setRawMode')
  assert.equal(pickUi(run(), {}, tty({ columns: 0 })).mode, 'plain')
  assert.equal(pickUi(run(), {}, { stdin: { isTTY: true, setRawMode() {} }, stderr: { isTTY: true } }).mode, 'plain', 'no width known')
  assert.equal(pickUi(run(), {}, tty({ columns: 59 })).mode, 'plain')
  assert.equal(pickUi(run(), {}, tty({ columns: 60 })).mode, 'rich')
  assert.equal(pickUi(run(), {}, tty({ columns: 200 })).mode, 'rich')
})

test('mode: a wizard that cannot be loaded falls back to plain, with a --debug note', async () => {
  const notes = []
  const ui = await resolveUi(run(), {}, tty(), { load: async () => { throw Object.assign(new Error('Cannot find package @clack/core'), { code: 'ERR_MODULE_NOT_FOUND' }) }, debug: text => notes.push(text) })
  assert.equal(ui.mode, 'plain')
  assert.match(notes.join('\n'), /could not be loaded \(ERR_MODULE_NOT_FOUND\)/)
  const loaded = await resolveUi(run(), { LANG: 'en_US.UTF-8' }, tty(), { platform: 'linux' })
  assert.equal(loaded.mode, 'rich')
  assert.equal(typeof loaded.rich.createRichPrompt, 'function')
  assert.equal(loaded.term.unicode, true)
})

test('color: NO_COLOR and FORCE_COLOR=0 mean no codes at all; FORCE_COLOR=1..3 sets the depth; else the stream says', () => {
  const stream = { getColorDepth: () => 8 }
  assert.equal(detectTerm({ NO_COLOR: '1' }, stream, 'linux').depth, 0)
  assert.equal(detectTerm({ NO_COLOR: '1', FORCE_COLOR: '3' }, stream, 'linux').depth, 0, 'NO_COLOR wins')
  assert.equal(detectTerm({ FORCE_COLOR: '0' }, stream, 'linux').depth, 0)
  assert.equal(detectTerm({ FORCE_COLOR: '1' }, stream, 'linux').depth, 4)
  assert.equal(detectTerm({ FORCE_COLOR: '2' }, stream, 'linux').depth, 8)
  assert.equal(detectTerm({ FORCE_COLOR: '3' }, stream, 'linux').depth, 24)
  assert.equal(detectTerm({}, stream, 'linux').depth, 8)
  assert.equal(detectTerm({}, { getColorDepth: () => 1 }, 'linux').depth, 0)
  const paint = makePaint(detectTerm({ NO_COLOR: '1' }, stream, 'linux'))
  for (const role of ['ok', 'accent', 'warn', 'title', 'value', 'link', 'dim', 'red', 'fill:green', 'fill:gold/deep']) assert.equal(paint(role, 'x'), 'x', role)
  // On a dark background the accents are the brand gold, at each depth.
  const dark = { SLATEBOX_THEME: 'dark' }
  const truecolor = makePaint(detectTerm({ ...dark, FORCE_COLOR: '3' }, stream, 'linux'))
  assert.equal(truecolor('accent', 'x'), '\x1b[38;2;233;185;73mx\x1b[39m')
  assert.match(truecolor('ok', '✓'), /\x1b\[48;2;47;93;80m/, 'green is a fill')
  assert.equal(makePaint(detectTerm({ ...dark, FORCE_COLOR: '2' }, stream, 'linux'))('accent', 'x'), '\x1b[38;5;179mx\x1b[39m')
  assert.equal(makePaint(detectTerm({ ...dark, FORCE_COLOR: '1' }, stream, 'linux'))('accent', 'x'), '\x1b[33mx\x1b[39m')
})

// WCAG contrast of a 24-bit foreground on a background.
const luminance = rgb => {
  const [r, g, b] = rgb.map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
const rgbOf = code => /38;2;(\d+);(\d+);(\d+)m/.exec(code)?.slice(1, 4).map(Number)

test('light terminals: text is the terminal\'s own color; accents keep contrast on the background they are for', () => {
  const stream = { getColorDepth: () => 24 }
  const WHITE = [255, 255, 255]
  const BLACK = [0, 0, 0]
  for (const background of ['light', 'dark', 'unknown']) {
    const paint = makePaint(detectTerm({ FORCE_COLOR: '3', SLATEBOX_THEME: background === 'unknown' ? '' : background }, stream, 'linux'))
    // Questions, answers, the plan, the setup link and commands: never a foreground color.
    for (const role of ['title', 'value', 'link', 'bold']) assert.doesNotMatch(paint(role, 'x'), /\x1b\[(?:3[0-79]|38;)/, `${background} ${role}`)
    for (const role of ['accent', 'warn']) {
      const rgb = rgbOf(paint(role, 'x'))
      if (background !== 'dark') assert.ok(contrast(rgb, WHITE) >= (background === 'light' ? 4.5 : 3), `${background} ${role} on white: ${contrast(rgb, WHITE).toFixed(2)}`)
      if (background !== 'light') assert.ok(contrast(rgb, BLACK) >= (background === 'dark' ? 4.5 : 3), `${background} ${role} on black: ${contrast(rgb, BLACK).toFixed(2)}`)
    }
  }
})

test('background: SLATEBOX_THEME, then COLORFGBG; an OSC 11 answer by its luminance', () => {
  assert.equal(backgroundFromEnv({}), 'unknown')
  assert.equal(backgroundFromEnv({ SLATEBOX_THEME: 'light', COLORFGBG: '15;0' }), 'light')
  assert.equal(backgroundFromEnv({ COLORFGBG: '0;15' }), 'light')
  assert.equal(backgroundFromEnv({ COLORFGBG: '0;7' }), 'light')
  assert.equal(backgroundFromEnv({ COLORFGBG: '15;0' }), 'dark')
  assert.equal(backgroundFromEnv({ COLORFGBG: '15;default;0' }), 'dark')
  assert.equal(backgroundFromRgb('rgb:ffff/ffff/ffff'), 'light')
  assert.equal(backgroundFromRgb('rgb:ecec/ecec/ecec'), 'light')
  assert.equal(backgroundFromRgb('rgb:1e1e/1e1e/1e1e'), 'dark')
  assert.equal(backgroundFromRgb('rgb:14/25/20'), 'dark')
  assert.equal(backgroundFromRgb('nonsense'), 'unknown')
  assert.equal(detectTerm({ COLORFGBG: '0;15' }, { getColorDepth: () => 8 }, 'linux').background, 'light')
  assert.equal(detectTerm({}, { getColorDepth: () => 8 }, 'linux', 'dark').background, 'dark')
})

test('background query: the OSC 11 answer is read; a DA1 answer alone ends the wait at once', async () => {
  const { PassThrough } = await import('node:stream')
  const make = reply => {
    const input = new PassThrough()
    input.isTTY = true
    input.modes = []
    input.setRawMode = on => { input.isRaw = on; input.modes.push(on) }
    const output = new PassThrough()
    output.isTTY = true
    let asked = ''
    output.on('data', chunk => { asked += chunk; if (reply) setImmediate(() => input.write(reply)) })
    return { input, output, asked: () => asked }
  }
  const light = make('\x1b]11;rgb:ffff/ffff/ffff\x1b\\\x1b[?62;22c')
  assert.equal(await queryBackground(light.input, light.output, { timeout: 2000 }), 'light')
  assert.ok(light.asked().includes('\x1b]11;?'), 'OSC 11 asked')
  assert.deepEqual(light.input.modes, [true, false], 'raw mode on for the answer, then back')
  const silent = make('\x1b[?1;2c')
  const started = Date.now()
  assert.equal(await queryBackground(silent.input, silent.output, { timeout: 2000 }), 'unknown')
  assert.ok(Date.now() - started < 1000, 'DA1 ended the wait')
  const mute = make('')
  assert.equal(await queryBackground(mute.input, mute.output, { timeout: 30 }), 'unknown', 'no answer at all: the timeout')
})

test('glyphs: Unicode in Windows Terminal, named terminals, UTF-8 locales and on macOS; ASCII otherwise', () => {
  const s = {}
  assert.equal(detectTerm({}, s, 'win32').unicode, false)
  assert.equal(detectTerm({ WT_SESSION: 'abc' }, s, 'win32').unicode, true)
  assert.equal(detectTerm({ TERM_PROGRAM: 'vscode' }, s, 'linux').unicode, true)
  assert.equal(detectTerm({ LANG: 'C' }, s, 'linux').unicode, false)
  assert.equal(detectTerm({ LANG: 'en_US.UTF-8' }, s, 'linux').unicode, true)
  assert.equal(detectTerm({ LC_ALL: 'de_DE.utf8', LANG: 'C' }, s, 'linux').unicode, true)
  assert.equal(detectTerm({ LANG: 'C' }, s, 'darwin').unicode, true)
  assert.equal(detectTerm({ LANG: 'C' }, s, 'linux').glyphs.pointer, '>')
  assert.equal(detectTerm({ LANG: 'C.UTF-8' }, s, 'linux').glyphs.pointer, '›')
})

test('links: OSC 8 only in terminals known to open them', () => {
  for (const env of [{ TERM_PROGRAM: 'iTerm.app' }, { TERM_PROGRAM: 'WezTerm' }, { TERM_PROGRAM: 'vscode' }, { TERM_PROGRAM: 'ghostty' }, { WT_SESSION: '1' }, { VTE_VERSION: '7600' }]) {
    assert.equal(detectTerm(env, {}, 'linux').hyperlinks, true, JSON.stringify(env))
  }
  assert.equal(detectTerm({ TERM_PROGRAM: 'Apple_Terminal' }, {}, 'darwin').hyperlinks, false)
  assert.equal(detectTerm({}, {}, 'linux').hyperlinks, false)
})

test('width: escape codes take no cells, wide characters take two', () => {
  assert.equal(width('\x1b[38;2;1;2;3mabc\x1b[39m'), 3)
  assert.equal(width('\x1b]8;;https://x\x1b\\link\x1b]8;;\x1b\\'), 4)
  assert.equal(width('日本'), 4)
  assert.equal(strip('\x1b[1mhi\x1b[22m'), 'hi')
})
