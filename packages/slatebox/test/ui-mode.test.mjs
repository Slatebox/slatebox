// Which installer a run gets (src/ui/mode.mjs), and what the terminal can show (src/ui/term.mjs):
// the full matrix of flags, environment and terminals, each checked for its mode, color depth and
// glyphs.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickUi, resolveUi } from '../src/ui/mode.mjs'
import { detectTerm, makePaint, strip, width } from '../src/ui/term.mjs'

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
  for (const role of ['ok', 'gold', 'lightGold', 'cream', 'title', 'dim', 'red', 'fill:green', 'fill:gold/deep']) assert.equal(paint(role, 'x'), 'x', role)
  const truecolor = makePaint(detectTerm({ FORCE_COLOR: '3' }, stream, 'linux'))
  assert.equal(truecolor('gold', 'x'), '\x1b[38;2;233;185;73mx\x1b[39m')
  assert.match(truecolor('ok', '✓'), /\x1b\[48;2;47;93;80m/, 'green is a fill')
  assert.equal(makePaint(detectTerm({ FORCE_COLOR: '2' }, stream, 'linux'))('gold', 'x'), '\x1b[38;5;179mx\x1b[39m')
  assert.equal(makePaint(detectTerm({ FORCE_COLOR: '1' }, stream, 'linux'))('gold', 'x'), '\x1b[33mx\x1b[39m')
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
