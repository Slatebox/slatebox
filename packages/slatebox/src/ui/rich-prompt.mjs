// The installer's wizard in the terminal: the same questions as prompt.mjs ({text, choose,
// confirm, secret, close}), drawn with Slatebox accents (src/ui/term.mjs), answered with the arrow keys,
// and folded into a one-line record once answered. Key handling (raw mode, paste, wide
// characters, redraw, cancel) is @clack/core's; everything on screen is drawn here. Loaded only
// when src/ui/mode.mjs says the run is rich. Everything it writes goes to stderr through the
// redactor, except the setup link (written past it, as setup-link.mjs does).
//
// @clack/core is pinned exactly (1.6.0) because three things here use its internals, not its
// documented API. Recheck them on any upgrade (test/rich-prompt.test.mjs "clack internals" fails
// when they move):
//   - prompt._subscribers.delete('confirm'): stops ConfirmPrompt's own y/n handler, which moves the
//     cursor before the frame is redrawn and leaves a stray footer behind (confirm()).
//   - prompt.rl, prompt._cursor and prompt._setUserInput(''): Ctrl-U clears the whole answer (text()).
import { ConfirmPrompt, PasswordPrompt, SelectPrompt, TextPrompt, isCancel } from '@clack/core'
import { Writable } from 'node:stream'
import { SIZES as SIZE_NAMES } from '../answers.mjs'
import { EXIT, InstallError } from '../errors.mjs'
import { terminalGuard } from './keys.mjs'
import { qrLines, qrSize } from './qr.mjs'
import { columns, link, makePaint, pad, strip, truncate, width, wrap } from './term.mjs'

const CANCELED = 'Canceled. Nothing was changed.'
const FRAME_MS = 80

/** Thrown by the review's "Change a section…": that section is asked again; nothing has changed yet. */
export class Revise extends Error {
  constructor(section) {
    super(`Change ${section}`)
    this.reviseSection = section
  }
}

// What a single-key answer did, for its folded row.
const KEY_WORDS = { recheck: 'checking this computer again', details: 'every file and command, below' }

/** A question's folded label: up to its first bracket, colon or question mark, at most 32 cells. */
const shortLabel = question => {
  const cut = String(question).split(/ \(|: |\?/)[0]
  return cut.length > 32 ? `${cut.slice(0, 31)}…` : cut
}

/** 0.4s, 21.4s, 1m 14s. */
export function duration(ms) {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}
/** A running clock: 12s, then 1:05. */
const clock = ms => {
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * @param {{input: any, output: any, term: object, redactor: {redact: (s: string) => string}, version: string, now?: () => number}} options
 */
export function createRichPrompt({ input, output, term, redactor, version = '', home = '', now = Date.now }) {
  // Paths under the home folder are shown as ~/…; image digests are cut to 12 characters.
  const tidy = text => {
    let out = String(text)
    if (home && home.length > 1) out = out.split(`${home}/`).join('~/').split(home).join('~')
    return out.replace(/@sha256:([a-f0-9]{12})[a-f0-9]{52}/g, `@sha256:$1${term.glyphs.ellipsis}`)
  }
  const paint = makePaint(term)
  const g = term.glyphs
  // Redacted before it is wrapped, so that a secret broken across two lines is still caught.
  const wrapR = (text, n) => wrap(redactor.redact(String(text)), n)
  const W = () => Math.max(40, columns(term))
  const lineW = () => Math.min(W(), 100) - 1
  const started = now()
  const guard = terminalGuard({ input, output, onInterrupt: () => api.onInterrupt?.() })

  // ---------------------------------------------------------------- the screen
  // One writer for the terminal. Spinner rows are redrawn in place; anything else written while a
  // spinner runs (the plan, a line from elsewhere in the installer) clears it first.
  const tasks = []
  let drawn = null
  let timer = null
  let frame = 0
  let pendingSection = null
  let lastSection = null
  let sectionTag = ''
  // Step ids whose start and ok rows are not shown (the wizard showed the same check already).
  const quiet = new Set()

  const rawWrite = text => output.write(text)
  const clearDrawn = () => {
    if (drawn) { rawWrite('\r\x1b[2K'); drawn = null }
  }
  const draw = () => {
    const task = tasks.at(-1)
    if (!task || task.parked) return
    const spin = paint('accent', g.spinner[frame % g.spinner.length])
    const right = task.right ? task.right(now() - task.start) : clock(now() - task.start)
    const room = lineW() - 3 - width(right) - 2
    const text = ` ${spin} ${pad(truncate(task.label, room, g.ellipsis), room)}  ${paint('dim', right)}`
    rawWrite(`\r\x1b[2K${redactor.redact(tidy(text))}`)
    drawn = task
  }
  const tick = () => {
    frame++
    draw()
  }
  const startTimer = () => {
    if (timer) return
    timer = setInterval(tick, FRAME_MS)
    timer.unref?.()
  }
  const stopTimer = () => {
    if (!tasks.some(task => !task.parked) && timer) { clearInterval(timer); timer = null }
  }
  let suspended = 0
  /** Stop drawing spinners (a question is open, or other text is written). */
  const suspend = () => {
    suspended++
    clearDrawn()
    if (timer) { clearInterval(timer); timer = null }
  }
  const resume = () => {
    suspended = Math.max(0, suspended - 1)
    if (!suspended && tasks.length && !tasks.at(-1).parked) { draw(); startTimer() }
  }
  /** A finished line, written above any spinner. */
  const line = (text = '') => {
    const live = drawn
    clearDrawn()
    rawWrite(`${redactor.redact(tidy(text))}\n`)
    if (live && !suspended) draw()
  }
  /** Text from elsewhere (ctx.stderr in rich mode): written as it is, above any spinner. */
  const foreign = text => {
    const live = drawn
    clearDrawn()
    rawWrite(String(text))
    if (live && !suspended && String(text).endsWith('\n')) draw()
  }

  // A stream for @clack/core: its frames, redacted, to the terminal, with the terminal's size.
  const promptOut = new Writable({ write(chunk, _encoding, done) { rawWrite(redactor.redact(String(chunk))); done() } })
  Object.defineProperty(promptOut, 'columns', { get: () => output.columns })
  Object.defineProperty(promptOut, 'rows', { get: () => output.rows })
  promptOut.isTTY = true
  const forwardResize = () => promptOut.emit('resize')
  output.on?.('resize', forwardResize)

  // ---------------------------------------------------------------- pieces of a frame
  const bar = paint('dim', g.gutter)
  const head = (state, text) => {
    if (state === 'submit') return ` ${paint('dim', g.done)}  ${text}`
    if (state === 'cancel') return ` ${paint('red', g.stop)}  ${text}`
    return ` ${paint('accent', g.active)}  ${text}`
  }
  const body = text => ` ${bar}  ${text}`
  const foot = ` ${paint('dim', g.end)}`
  const folded = (label, answer) => head('submit', `${paint('dim', label)}  ${answer}`)
  const canceled = label => head('cancel', `${label}  ${paint('dim', 'canceled')}`)
  const questionLines = (question, hint, { tag = true } = {}) => {
    const room = lineW() - 4
    const lines = wrapR(question, room)
    const out = lines.map((text, i) => (i === 0 ? head('active', paint('title', text)) : body(paint('title', text))))
    let last = lines.at(-1)
    if (hint) {
      if (width(last) + 2 + width(hint) <= room) { out[out.length - 1] += `  ${paint('dim', hint)}`; last += `  ${hint}` }
      else for (const text of wrapR(hint, room)) { out.push(body(paint('dim', text))); last = text }
    }
    // The section's place ("2 of 6") ends the question's last line, when it fits there.
    if (tag && sectionTag && width(last) + 3 + width(sectionTag) <= room) out[out.length - 1] += `   ${paint('dim', sectionTag)}`
    return out
  }

  // A new section starts with a blank line; its place ("2 of 6") is shown on its questions, and
  // its name is each answer's folded label, so it is not printed again as a header.
  function openSection() {
    if (!pendingSection) return
    const { i, n } = pendingSection
    pendingSection = null
    sectionTag = `${i} of ${n}`
    line('')
  }

  async function ask(prompt) {
    suspend()
    openSection()
    guard.arm()
    try {
      const value = await prompt.prompt()
      if (isCancel(value)) throw new InstallError(EXIT.CANCELLED, CANCELED)
      return value
    } finally {
      guard.restore()
      resume()
    }
  }

  // ---------------------------------------------------------------- questions
  async function text(question, { default: fallback = '', validate, optional = false, label, title, hint, suffix = '', normalize = value => value } = {}) {
    const name = label || shortLabel(question)
    const check = raw => {
      const answer = normalize(String(raw ?? '').trim() || fallback)
      if (!answer && optional) return undefined
      if (!answer) return 'An answer is needed.'
      return validate?.(answer) || undefined
    }
    const display = p => {
      const value = p.userInput
      const at = Math.min(p.cursor ?? value.length, value.length)
      if (!value && fallback) return `${term.depth ? paint('inverse', ' ') : g.cursor}${paint('dim', fallback)}`
      if (!term.depth) return `${value.slice(0, at)}${g.cursor}${value.slice(at)}`
      return `${value.slice(0, at)}${paint('inverse', value[at] ?? ' ')}${value.slice(at + 1)}`
    }
    const prompt = new TextPrompt({
      input, output: promptOut,
      validate: check,
      render() {
        if (this.state === 'submit') {
          const answer = normalize(String(this.value ?? '').trim() || fallback)
          return folded(name, answer ? paint('value', `${answer}${suffix}`) : paint('dim', 'skipped'))
        }
        if (this.state === 'cancel') return canceled(name)
        const lines = questionLines(title || question, hint ?? (optional && !fallback ? 'Enter skips' : fallback ? `Enter for ${fallback}` : ''))
        let entry = `${display(this)}${suffix ? paint('dim', suffix) : ''}`
        const live = this.state === 'error' ? this.error : (this.userInput.trim() ? (validate?.(normalize(this.userInput.trim())) || '') : '')
        if (live) {
          const note = `${paint('warn', g.warn)} ${live}`
          if (width(entry) + 3 + width(note) <= lineW() - 4) entry += `   ${note}`
          else {
            // One ▲ for one message; its other lines line up under its text.
            lines.push(body(entry)); entry = null
            wrapR(live, lineW() - 7).forEach((piece, i) => lines.push(body(`${i ? ' '.repeat(width(g.warn)) : paint('warn', g.warn)} ${piece}`)))
          }
        }
        if (entry !== null) lines.push(body(entry))
        lines.push(foot)
        return lines.join('\n')
      },
    })
    // Ctrl-U clears the whole answer (readline's own Ctrl-U keeps what is right of the cursor).
    prompt.on('key', (_char, info) => {
      if (info?.ctrl && info.name === 'u' && prompt.rl) {
        prompt.rl.write(null, { ctrl: true, name: 'e' })
        prompt.rl.write(null, { ctrl: true, name: 'u' })
        prompt._cursor = 0
        prompt._setUserInput('')
      }
    })
    const value = await ask(prompt)
    return normalize(String(value ?? '').trim() || fallback)
  }

  /**
   * Choices keep their `label` (the plain prompt's text) and may add `title`, `hint`,
   * `recommended` and `disabled`. keys: extra single keys that answer at once ({ r: 'recheck' }).
   */
  async function choose(question, choices, { default: fallback = null, initial, label, title, keys = {}, horizontal = false, help } = {}) {
    const name = label || shortLabel(question)
    const items = choices.map(choice => ({ ...choice, title: choice.title || choice.label }))
    const start = items.findIndex(item => item.recommended && !item.disabled)
    const want = start >= 0 ? items[start].value : initial ?? fallback
    const enabled = items.filter(item => !item.disabled)
    if (!enabled.length) throw new InstallError(EXIT.PRECONDITION, `Nothing can be chosen for "${question}".`)
    const initialValue = items.some(item => item.value === want && !item.disabled) ? want : enabled[0].value
    const prompt = new SelectPrompt({
      input, output: promptOut, options: items, initialValue,
      render() {
        const chosen = items[this.cursor]
        if (this.state === 'submit') {
          if (this.value && Object.values(keys).includes(this.value)) return folded(name, paint('dim', KEY_WORDS[this.value] || this.value))
          return folded(name, paint('value', chosen?.title ?? ''))
        }
        if (this.state === 'cancel') return canceled(name)
        if (horizontal) {
          const row = items.map((item, i) => (i === this.cursor ? `${paint('accent', g.pointer)} ${paint('title', item.title)}` : `  ${paint('dim', item.title)}`)).join('   ')
          if (!(title || question)) return head('active', row)
          const lines = questionLines(title || question, help, { tag: false })
          lines[lines.length - 1] += `   ${row}`
          return lines.join('\n')
        }
        const lines = questionLines(title || question, help)
        const wide = W() >= 80
        const titleW = Math.max(...items.map(item => width(item.title)))
        // The tag stays whole: it is the cue for the choice the wizard suggests.
        const tagged = item => item.recommended && !item.disabled
        const hintLines = (item, room) => {
          const words = [item.hint, tagged(item) ? 'recommended' : null].filter(Boolean).join(` ${g.dot} `)
          return words ? wrapR(words, room).map(piece => (tagged(item) && piece.endsWith('recommended')
            ? `${paint('dim', piece.slice(0, -'recommended'.length))}${paint('accent', 'recommended')}`
            : paint('dim', piece))) : []
        }
        items.forEach((item, i) => {
          const active = i === this.cursor
          const pointer = active ? paint('accent', g.pointer) : ' '
          const shown = item.disabled ? paint('dim', item.title) : active ? paint('title', item.title) : item.title
          if (wide) {
            // The hint in a column after the titles, wrapped inside that column.
            const hints = hintLines(item, lineW() - 6 - titleW - 2)
            lines.push(body(`${pointer} ${hints.length ? pad(shown, titleW) : shown}${hints.length ? `  ${hints[0]}` : ''}`))
            for (const piece of hints.slice(1)) lines.push(body(`  ${' '.repeat(titleW)}  ${piece}`))
          } else {
            lines.push(body(`${pointer} ${shown}`))
            for (const piece of hintLines(item, lineW() - 8)) lines.push(body(`    ${piece}`))
          }
        })
        lines.push(foot)
        return lines.join('\n')
      },
    })
    prompt.on('key', char => {
      if (!char) return
      if (/^[1-9]$/.test(char)) {
        const index = Number(char) - 1
        if (items[index] && !items[index].disabled) { prompt.cursor = index; prompt.changeValue() }
        return
      }
      if (keys[char]) {
        prompt.value = keys[char]
        prompt.state = keys[char] === 'cancel' ? 'cancel' : 'submit'
      }
    })
    const value = await ask(prompt)
    return value
  }

  async function confirm(question, { default: fallback = false, label, title, help, yes = 'Yes', no = 'No', order } = {}) {
    const name = label || shortLabel(question)
    const options = order === 'no-first' ? [[false, no], [true, yes]] : [[true, yes], [false, no]]
    const prompt = new ConfirmPrompt({
      input, output: promptOut, active: yes, inactive: no, initialValue: fallback,
      render() {
        if (this.state === 'submit') return folded(name, paint('value', this.value ? yes : no))
        if (this.state === 'cancel') return canceled(name)
        const lines = questionLines(title || question, undefined, { tag: false })
        const row = options.map(([value, text]) => (this.value === value ? `${paint('accent', g.on)} ${paint('title', text)}` : `${paint('dim', g.off)} ${paint('dim', text)}`)).join('  ')
        const tag = sectionTag ? `   ${paint('dim', sectionTag)}` : ''
        // The toggle after the question when the whole line fits, else on its own line below it.
        if (width(lines.at(-1)) + 3 + width(row) + width(tag) <= lineW()) lines[lines.length - 1] += `   ${row}${tag}`
        else if (width(lines.at(-1)) + 3 + width(row) <= lineW()) lines[lines.length - 1] += `   ${row}`
        else lines.push(body(`${row}${width(row) + 3 + width(tag) + 4 <= lineW() ? tag : ''}`))
        for (const piece of help ? wrapR(help, lineW() - 4) : []) lines.push(body(paint('dim', piece)))
        lines.push(foot)
        return lines.join('\n')
      },
    })
    // y and n answer at once. @clack/core's own y/n handler moves the cursor up before its frame is
    // redrawn, which leaves our footer behind, so ours answers through the normal submit path.
    prompt._subscribers?.delete('confirm')
    prompt.on('key', char => {
      const key = String(char || '').toLowerCase()
      if (key === 'y' || key === 'n') { prompt.value = key === 'y'; prompt.state = 'submit' }
    })
    return Boolean(await ask(prompt))
  }

  /** Hidden input: nothing is echoed, not even a mask. */
  async function secret(question, { label } = {}) {
    const name = label || shortLabel(question)
    const prompt = new PasswordPrompt({
      input, output: promptOut, mask: '',
      render() {
        if (this.state === 'submit') return folded(name, this.value ? `${paint('ok', g.ok)} ${paint('value', 'received (hidden)')}` : paint('dim', 'none'))
        if (this.state === 'cancel') return canceled(name)
        return [...questionLines(question), body(paint('dim', 'typing is hidden; Enter when done')), foot].join('\n')
      },
    })
    const value = await ask(prompt)
    return value || undefined
  }

  // ---------------------------------------------------------------- rows and notes
  const MARK = { ok: () => paint('ok', g.ok), warn: () => paint('warn', g.warn), fail: () => paint('red', g.fail), stop: () => paint('red', g.stop), info: () => paint('dim', g.dot), skip: () => paint('dim', '–') }

  function note(kind, message) {
    const lines = wrapR(tidy(message), lineW() - 4)
    lines.forEach((text, i) => line(i === 0 ? ` ${MARK[kind]?.() ?? ' '} ${kind === 'info' ? paint('dim', text) : text}` : `   ${kind === 'info' ? paint('dim', text) : text}`))
  }

  // Times under a second are not shown: a column of 0.0s says nothing.
  // A row that does not fit wraps under its text (the time stays on its first line); never cut.
  const row = (kind, label, ms) => {
    const right = ms === undefined || ms < 1000 ? '' : duration(ms)
    const room = lineW() - 3 - (right ? width(right) + 2 : 0)
    const [first, ...rest] = wrapR(tidy(label), room)
    return [` ${MARK[kind]()} ${right ? `${pad(first, room)}  ${paint('dim', right)}` : first}`, ...rest.map(text => `   ${text}`)].join('\n')
  }

  /** A spinner row that settles into a final row with its time. */
  function task(label, { id, right } = {}) {
    for (const other of tasks) if (!other.parked && other !== tasks.at(-1)) other.parked = true
    if (tasks.length) { clearDrawn(); tasks.at(-1).parked = true }
    openSection()
    const t = { id, label: tidy(label), start: now(), right, parked: false }
    tasks.push(t)
    if (!suspended) { draw(); startTimer() }
    const settle = (kind, text) => {
      const index = tasks.indexOf(t)
      if (index < 0) return
      if (drawn === t) clearDrawn()
      tasks.splice(index, 1)
      if (kind) line(row(kind, text ?? t.label, now() - t.start))
      const top = tasks.at(-1)
      if (top) top.parked = false
      if (!suspended && top) { draw(); startTimer() } else stopTimer()
    }
    return {
      id,
      get label() { return t.label },
      update(text) { t.label = tidy(text); if (drawn === t) draw() },
      ok: text => settle('ok', text),
      warn: text => settle('warn', text),
      fail: text => settle('fail', text),
      skip: text => settle('skip', text),
      info: text => settle('info', text),
      clear: () => settle(null),
    }
  }

  /** fn() with a spinner that disappears afterwards (its own rows say how it went). */
  async function during(label, fn) {
    const t = task(label)
    try { return await fn() } finally { t.clear() }
  }

  /** A check row of the machine check: label, then what was found, with its time. */
  async function probe(label, fn, { done = String, failed } = {}) {
    const start = now()
    const t = task(`${pad(label, 16)}checking`)
    try {
      const result = await fn()
      t.clear()
      line(row('ok', `${pad(label, 16)}${done(result)}`, now() - start))
      return result
    } catch (error) {
      t.clear()
      const said = failed?.(error) || { short: error.message }
      line(row('fail', `${pad(label, 16)}${said.short}`, now() - start))
      for (const text of said.hint ? wrapR(said.hint, lineW() - 8) : []) line(`     ${paint('dim', text)}`)
      throw error
    }
  }

  // Output's listener: steps become spinner rows that settle into final rows.
  const open = new Map()
  // Steps' words, shorter for a row: the download, and the start with its clock against the limit.
  const stepLabel = detail => String(detail)
    .replace(/^(Downloading \S+) \(about 1 GB the first time;.*\)$/, '$1 (about 1 GB the first time)')
  const startLimit = detail => {
    const m = /^Starting Slatebox and waiting until it is healthy \(up to (\d+)s\)$/.exec(detail)
    return m ? Number(m[1]) * 1000 : null
  }
  const listener = {
    step(id, status, rawDetail) {
      const current = open.get(id)
      // A row shows one time, its own: "Downloaded the image in 2s" loses its "in 2s".
      const detail = stepLabel(rawDetail).replace(current ? / in \d+(?:\.\d+)?s$/ : /$^/, '')
      // A check the wizard already showed (the machine check, the address) is not shown again
      // while the plan is made; a warning or a failure still is.
      if (quiet.has(id) && (status === 'start' || status === 'ok')) {
        if (status === 'ok' && current) { open.delete(id); current.clear() }
        return
      }
      if (status === 'start') {
        if (current) {
          // The same step again: "Still downloading …" only moves the clock on.
          if (!/^Still /.test(detail)) current.update(detail)
          return
        }
        const limit = startLimit(detail)
        open.set(id, limit ? task('Starting and waiting until healthy', { id, right: ms => `${clock(ms)} / up to ${clock(limit).replace(/^(\d+)s$/, '0:$1')}` }) : task(detail, { id }))
        return
      }
      const kind = { ok: 'ok', warn: 'warn', fail: 'fail', skip: 'skip' }[status] || 'info'
      if (current) {
        open.delete(id)
        current[kind](detail)
        // A warning on a step that goes on (the health step's tunnel note) keeps a spinner running.
        if (kind === 'warn' && id === 'health') return
        return
      }
      line(row(kind, detail))
    },
    say(textLine) {
      for (const piece of String(textLine).replace(/\n$/, '').split('\n')) line(piece ? ` ${piece}` : '')
    },
    warn(message) { note('warn', message) },
  }

  // ---------------------------------------------------------------- screens
  function intro() {
    const wide = W() >= 80
    const lines = []
    if (wide) {
      const grid = Array.from({ length: 5 }, () => Array.from({ length: 10 }, () => null))
      const cards = [['deep', 0, 0], ['green', 1, 2], ['gold', 2, 4]]
      for (const [color, r, c] of cards) {
        const shape = [`${g.box.tl}${g.box.h.repeat(4)}${g.box.tr}`, `${g.box.v}    ${g.box.v}`, `${g.box.bl}${g.box.h.repeat(4)}${g.box.br}`]
        shape.forEach((text, dr) => [...text].forEach((char, dc) => { grid[r + dr][c + dc] = { char, color } }))
      }
      const logo = grid.map(cells => cells.map(cell => {
        if (!cell) return ' '
        if (!term.depth) return cell.char
        return paint(cell.color === 'gold' ? 'fill:gold/deep' : `fill:${cell.color}`, cell.char)
      }).join(''))
      const side = [
        '',
        paint('title', `Slatebox installer ${version}`),
        "Your team's canvas on your own machine. Free and open source.",
        '',
        paint('dim', `${g.arrows} move ${g.dot} Enter choose ${g.dot} Ctrl-C stops, nothing changes`),
        paint('dim', 'Using a screen reader? Press Ctrl-C and run again with --plain'),
      ]
      line('')
      for (let i = 0; i < 6; i++) line(`  ${logo[i] ?? ' '.repeat(10)}     ${side[i] ?? ''}`)
    } else {
      line('')
      line(` ${paint('fill:green', ' Slatebox ')} ${paint('title', `installer ${version}`)}`)
      for (const text of wrap("Your team's canvas on your own machine. Free and open source.", lineW() - 2)) line(` ${paint('dim', text)}`)
      line(` ${paint('dim', `${g.arrows} move ${g.dot} Enter choose ${g.dot} Ctrl-C stops`)}`)
      line(` ${paint('dim', 'Screen reader? Ctrl-C, then run again with --plain')}`)
    }
  }

  function heading(text) {
    line('')
    line(` ${paint('title', text)}`)
  }

  const boxInner = () => Math.min(W() - 6, 94)

  /** A box; rows are plain or painted strings that fit (planBox wraps its own). Returns the lines. */
  function box(title, rows, footer) {
    // A row is the inner width plus 5 cells; it stays under the terminal's width so it never wraps.
    const inner = boxInner()
    const b = g.box
    const edge = (left, label, right) => {
      const text = label ? `${b.h} ${label} ` : ''
      return `${left}${text}${b.h.repeat(Math.max(0, inner + 2 - width(text)))}${right}`
    }
    const shownTitle = title && width(title) > inner - 2 ? truncate(title, inner - 2, g.ellipsis) : title
    const out = [` ${shownTitle ? `${paint('dim', `${b.tl}${b.h} `)}${paint('title', shownTitle)}${paint('dim', ` ${b.h.repeat(Math.max(0, inner - width(shownTitle) - 1))}${b.tr}`)}` : paint('dim', edge(b.tl, '', b.tr))}`]
    for (const raw of rows) {
      const text = tidy(raw)
      const fitted = width(text) > inner ? truncate(strip(text), inner, g.ellipsis) : text
      out.push(` ${paint('dim', b.v)} ${pad(fitted, inner)} ${paint('dim', b.v)}`)
    }
    out.push(` ${footer ? `${paint('dim', `${b.bl}${b.h} `)}${paint('dim', footer)}${paint('dim', ` ${b.h.repeat(Math.max(0, inner - width(footer) - 1))}${b.br}`)}` : paint('dim', edge(b.bl, '', b.br))}`)
    return out
  }

  /**
   * The review: the plan in a box, built from the same plan object formatPlan prints. Long values
   * wrap under their key, never cut. footer: false when no review follows (a plan only run).
   */
  function planBox(plan, answers = {}, { footer = true } = {}) {
    const where = plan.where === 'this computer' ? 'on this computer' : `on ${plan.where}`
    const title = plan.action === 'install' ? `Plan: install "${plan.name}" ${where}` : plan.action === 'export' ? `Plan: write the files for "${plan.name}"` : `Plan: ${plan.action} "${plan.name}" ${where}`
    const inner = boxInner()
    const KEY_W = 10
    const key = text => paint('dim', pad(text, KEY_W))
    const rows = []
    /** key, then the value wrapped in the room after it (role paints each piece). */
    const kv = (label, value, role) => {
      wrapR(tidy(value), inner - KEY_W).forEach((piece, i) => rows.push(`${i ? ' '.repeat(KEY_W) : key(label)}${role ? paint(role, piece) : piece}`))
    }
    const pair = (a, av, b, bv) => {
      if (W() >= 90 && b && width(av) <= 30 && KEY_W + 31 + KEY_W + width(bv) <= inner) rows.push(`${key(a)}${pad(av, 30)} ${key(b)}${bv}`)
      else { kv(a, av); if (b) kv(b, bv) }
    }
    if (plan.address) {
      kv('Address', plan.address, 'value')
      if (answers.address?.team && answers.target === 'local' && answers.address?.port) kv('', `also http://localhost:${answers.address.port} on this computer`, 'dim')
    }
    if (plan.image) kv('Image', plan.image.ref)
    const runs = answers.target === 'k8s' ? `Kubernetes, namespace ${answers.k8s?.namespace || 'slatebox'}` : answers.target === 'export' ? `files only (${answers.export?.format || 'compose'}), nothing is applied` : `one container (app, live editing, database) ${g.dot} docker run`
    kv('Runs as', runs)
    const ai = answers.ai?.mode === 'providers' ? (answers.ai.providers || []).map(item => item.id).join(', ') || 'none' : 'none for now'
    pair('Admin', answers.adminEmail || 'from the setup link', 'Agents', ai)
    const sso = answers.sso?.enabled
    pair('Sign-in', sso && answers.sso?.only ? 'single sign-on only' : 'passwords and guests', 'SSO', sso ? 'on (bundled Keycloak)' : 'off until you turn it on')
    const backups = answers.backups?.to === 'off' ? 'off' : answers.backups?.to === 'default' || !answers.backups?.to ? 'daily 03:00, keep 14' : `daily to ${answers.backups.to}`
    const size = typeof answers.size === 'string' ? answers.size : answers.size ? (Object.entries(SIZE_NAMES).find(([, s]) => s.cpu === answers.size.cpu && s.storage === answers.size.storage)?.[0] || `${answers.size.memory}, ${answers.size.cpu} CPU`) : 'small'
    pair('Backups', backups, 'Size', size)
    if (plan.secretsLocation) kv('Secrets', plan.secretsLocation)
    for (const change of plan.changes || []) kv('Change', change)
    line('')
    for (const text of box(title, rows, footer ? 'd shows every file and command' : '')) line(text)
    for (const warning of plan.warnings || []) note('warn', warning)
  }

  /**
   * Every file and command (formatPlan's text) in the wizard's look: wrapped to the screen, each
   * wrapped line under the start of its item, headings bold. Shown once; asked again, it points up.
   */
  let detailsShown = null
  function details(text) {
    if (detailsShown === text) { note('info', 'Every file and command is listed above.'); return }
    detailsShown = text
    const room = lineW() - 4
    line('')
    // Tidied (~/…, short digests) before it is wrapped, so lines break where the shown text does.
    tidy(String(text || '')).split('\n').forEach((raw, i) => {
      if (!raw.trim()) { line(` ${bar}`); return }
      if (i === 0) { line(` ${bar}  ${paint('title', raw)}`); return }
      const indent = raw.match(/^ */)[0].length
      const item = /^(\s*- )/.exec(raw)
      const lead = item ? item[1].length : indent
      const heading = /^\s+\w[\w ]*:$/.test(raw)
      const keyed = /^(\s+[A-Z][\w-]*:\s+)/.exec(raw)
      const hang = keyed ? keyed[1].length : lead
      wrapR(raw.slice(indent), room - indent - (hang - indent)).forEach((piece, j) => {
        const textPart = j === 0 ? `${' '.repeat(indent)}${piece}` : `${' '.repeat(hang)}${piece}`
        line(` ${bar}  ${heading ? paint('bold', textPart) : textPart}`)
      })
    })
    line(` ${paint('dim', g.end)}`)
  }

  /** Install, change a section, or cancel; d shows the full plan. */
  async function review(plan, answers, { defaultAction = 'install', revisable = true, details: full } = {}) {
    const choices = [
      { value: 'install', label: plan.action === 'install' ? 'Install' : plan.action === 'export' ? 'Write the files' : plan.action === 'claim' ? 'Sign in and claim' : 'Apply' },
      ...(revisable ? [{ value: 'change', label: 'Change a section…' }] : []),
      { value: 'cancel', label: 'Cancel' },
    ]
    for (;;) {
      const chosen = await choose('', choices, { default: defaultAction, initial: defaultAction, label: 'Review', horizontal: true, keys: { d: 'details', q: 'cancel' } })
      if (chosen === 'details') {
        details(full)
        continue
      }
      if (chosen === 'cancel') throw new InstallError(EXIT.CANCELLED, CANCELED)
      if (chosen === 'change') {
        const section = await choose('Which section?', [
          { value: 'where', label: 'Where' }, { value: 'address', label: 'Address' }, { value: 'admin', label: 'Admin' },
          { value: 'agents', label: 'Agents' }, { value: 'signin', label: 'Sign-in, backups, size and mail' },
          { value: 'back', label: 'Back to the plan' },
        ], { default: 'address', label: 'Change' })
        if (section === 'back') { planBox(plan, answers); continue }
        throw new Revise(section)
      }
      // The checks shown before the review were for the plan; what runs now is shown again.
      quiet.clear()
      if (plan.action !== 'claim') heading('Installing')
      return true
    }
  }

  /** The device sign-in: the code, the page, and a countdown while the browser approves. */
  function signInBox({ purpose, page, code }) {
    line('')
    for (const text of box(`Sign in to Slatebox to ${purpose}`, [`${paint('dim', pad('Code', 8))}${paint('title', code)}`, `${paint('dim', pad('Open', 8))}${paint('link', link(term, page))}`])) line(text)
  }
  function waitForApproval(deadline) {
    return task('Waiting for approval in the browser', { right: () => `expires in ${clock(Math.max(0, deadline - now()))}` })
  }

  /**
   * The end: where Slatebox runs, the one-time setup link (never wrapped: in a box only when it
   * fits, else on its own line), and what to do next. writeLink writes past the redactor. The
   * wizard draws it in two parts around the first admin (outroHeadline, then outroTail).
   */
  function outro({ headline, link: setup, pending, lines: extra = [], next }) {
    outroHeadline(headline)
    if (setup) setupLinkBox(setup)
    outroTail({ pending: setup ? null : pending, lines: extra, next })
  }

  function outroHeadline(headline) {
    // What follows (the first admin) is not one of the six sections.
    sectionTag = ''
    pendingSection = null
    line('')
    const took = `set up in ${duration(now() - started)}`
    if (width(headline) + 6 + took.length <= lineW()) line(` ${paint('accent', g.star)} ${paint('title', headline)}   ${paint('dim', took)}`)
    else { line(` ${paint('accent', g.star)} ${paint('title', headline)}`); line(`   ${paint('dim', took)}`) }
  }

  /** The one-time setup link in a box (or on its own line when the box would not fit it). */
  function setupLinkBox(setup) {
    const url = setup.url
    const shown = paint('link', link(term, url))
    const b = g.box
    line('')
    // Drawn in a box only when the whole URL fits in it; it is never wrapped or cut.
    if (W() >= url.length + 8) {
      const inner = Math.min(W() - 6, Math.max(url.length + 23, 72))
      const titleText = truncate('Create the first account (the server administrator)', inner - 2, g.ellipsis)
      const only = '(this terminal only)'
      const sameLine = inner >= url.length + 3 + only.length
      line(` ${paint('dim', `${b.tl}${b.h} `)}${paint('title', titleText)}${paint('dim', ` ${b.h.repeat(Math.max(0, inner - width(titleText) - 1))}${b.tr}`)}`)
      // The link line goes straight to the terminal, past the redactor (as setupLines does).
      clearDrawn()
      rawWrite(` ${paint('dim', b.v)} ${shown}${sameLine ? `${' '.repeat(inner - url.length - only.length)}${paint('dim', only)}` : ' '.repeat(inner - url.length)} ${paint('dim', b.v)}\n`)
      const rest = `${sameLine ? '' : 'This terminal only. '}Works once, expires in 24 hours. Lost it? slatebox setup-link`
      for (const piece of wrapR(rest, inner)) line(` ${paint('dim', b.v)} ${pad(piece, inner)} ${paint('dim', b.v)}`)
      line(` ${paint('dim', `${b.bl}${b.h.repeat(inner + 2)}${b.br}`)}`)
    } else {
      line(` ${paint('title', 'Create the first account (the server administrator):')}`)
      clearDrawn()
      rawWrite(`${shown}\n`)
      for (const piece of wrapR('This terminal only. Works once, expires in 24 hours. Lost it? slatebox setup-link', lineW() - 2)) line(` ${paint('dim', piece)}`)
    }
  }

  function outroTail({ pending, lines: extra = [], next }) {
    if (pending) {
      line('')
      for (const text of pending) line(` ${text}`)
    }
    for (const text of extra) {
      if (!text) { line(''); continue }
      // { warn }: the one thing to do now, set apart with a ▲ and in bold.
      if (typeof text === 'object' && text.warn) {
        line('')
        wrapR(tidy(text.warn), lineW() - 4).forEach((piece, i) => line(`${i ? '   ' : ` ${paint('warn', g.warn)} `}${paint('bold', piece)}`))
        line('')
        continue
      }
      wrapR(tidy(text), lineW() - 3).forEach((piece, i) => line(`${i ? '   ' : ' '}${piece}`))
    }
    if (next) {
      // The commands, as many to a line as fit, each whole.
      const rows = [[]]
      for (const item of next) {
        const current = rows.at(-1)
        if (current.length && width(`${current.join('   ')}   ${item}`) > lineW() - 8) rows.push([item])
        else current.push(item)
      }
      rows.forEach((items, i) => line(` ${paint('dim', i ? '    ' : 'Next')}   ${items.map(item => paint('bold', item)).join('   ')}`))
    }
  }

  /**
   * A QR code for url, with a caption, when the terminal is wide enough for it: black on white
   * where there is color (it scans on light and dark terminals), in full cells when the terminal
   * has the rows and columns for it (backgrounds only: no gaps whatever the line spacing), else
   * half blocks, or ASCII, as the terminal allows (src/ui/qr.mjs). It holds no text, so it is
   * written as it is.
   */
  function qr(url, caption = 'Scan it with a phone') {
    const size = qrSize(url)
    const full = term.depth > 0 && (output.rows || 0) >= size + 10 && size * 2 + 4 <= W()
    const rows = full ? qrLines(url, { unicode: false, color: true }) : qrLines(url, { unicode: term.unicode, color: term.depth > 0 })
    if (width(rows[0]) + 4 > W()) { note('info', 'The terminal is too narrow for a QR code; widen it to see one.'); return }
    line('')
    line(`   ${paint('dim', caption)}`)
    clearDrawn()
    for (const text of rows) rawWrite(`   ${text}\n`)
  }

  /**
   * A link that has to be opened on another device: the sentence (no browser here, or the
   * browser did not open), the link (past the redactor when it is the setup link), and a QR code
   * (or, for a link only this computer can open, the hint saying how to reach it instead).
   */
  function elsewhere({ sentence, url, secret = false, hint = '', qr: withQr = true }) {
    line('')
    for (const [i, piece] of wrapR(sentence, lineW() - 4).entries()) line(i ? `   ${piece}` : ` ${paint('accent', g.pointer)} ${piece}`)
    const shown = `   ${paint('link', link(term, url))}`
    if (secret) { clearDrawn(); rawWrite(`${shown}\n`) } else line(shown)
    for (const piece of hint ? wrapR(hint, lineW() - 4) : []) line(`   ${paint('dim', piece)}`)
    if (withQr) qr(url)
  }

  /**
   * Single keys while no question is open (waiting on the setup link): resolves 'enter' for Enter,
   * q or Esc, and 'stop' for Ctrl-C (which here only ends the wait: Slatebox is installed).
   * stop() puts the terminal back.
   */
  function watchKeys() {
    if (!input?.isTTY || typeof input.setRawMode !== 'function') return { pressed: new Promise(() => {}), stop() {} }
    let resolveKey
    const pressed = new Promise(resolve => { resolveKey = resolve })
    const onData = chunk => {
      const text = String(chunk)
      if (text.includes('\x03')) resolveKey('stop')
      else if (/[\r\nq]/.test(text) || text === '\x1b') resolveKey('enter')
    }
    guard.arm()
    try { input.setRawMode(true) } catch { /* closed */ }
    input.on('data', onData)
    input.resume?.()
    return {
      pressed,
      stop() {
        input.off('data', onData)
        guard.restore()
        input.pause?.()
      },
    }
  }

  /** The run stopped: one plain sentence, and the exit code. */
  function fatal(error) {
    const running = tasks.at(-1)
    suspend()
    // The step that was running is closed with a ■, so no frozen spinner row stays behind.
    if (running) line(row('stop', running.label, now() - running.start))
    for (const t of [...tasks]) tasks.splice(tasks.indexOf(t), 1)
    for (const t of open.values()) t.clear?.()
    open.clear()
    const lines = wrapR(error.message, lineW() - 4)
    line(` ${paint('red', g.stop)} ${lines[0]}`)
    for (const text of lines.slice(1)) line(`   ${text}`)
    if (error.exitCode !== EXIT.CANCELLED) line(` ${paint('dim', `${g.end} exit ${error.exitCode ?? 1}`)}`)
  }

  const api = {
    rich: true,
    text, choose, confirm, secret,
    section(name, i, n) { if (name !== lastSection) { pendingSection = { name, i, n }; lastSection = name } },
    note, task, during, probe, listener, intro, heading, review, planBox, details, signInBox, waitForApproval, outro, fatal,
    outroHeadline, setupLinkBox, outroTail, qr, elsewhere, watchKeys,
    line,
    /** Steps (by id) whose start and ok rows are not shown until the review is answered. */
    quiet(ids) { for (const id of ids) quiet.add(id) },
    /** ctx.stderr in rich mode: other modules' lines land above any spinner. */
    stderr: {
      write: text => { foreign(text); return true },
      get isTTY() { return true },
      get columns() { return output.columns },
      get rows() { return output.rows },
      on: (...args) => output.on?.(...args),
      off: (...args) => output.off?.(...args),
    },
    onInterrupt: null,
    close() {
      for (const t of [...tasks]) tasks.splice(tasks.indexOf(t), 1)
      clearDrawn()
      if (timer) { clearInterval(timer); timer = null }
      output.off?.('resize', forwardResize)
      guard.dispose()
    },
  }
  return api
}
