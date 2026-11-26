// The wizard on a real pseudo-terminal (test/pty/drive.py: python3's standard pty module, no
// native npm module): rich mode is chosen, arrow keys and Enter answer, Ctrl-C exits 7 and gives
// the terminal back (stty shows icanon and echo, and the cursor is shown again), a resize redraws,
// and --plain is today's transcript. Skipped with a note when python3 (with its Unix-only pty
// module) is not there, as on Windows.
// SLATEBOX_UPDATE_GOLDEN=1 rewrites the plain transcript.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// drive.py needs python3 with the pty, termios and fcntl modules: not on Windows.
const PYTHON = spawnSync('python3', ['-c', 'import pty, termios, fcntl'], { stdio: 'ignore' }).status === 0 ? 'python3' : null
const skip = (process.platform === 'win32' && 'pseudo-terminals need a Unix python3') || (!PYTHON && 'python3 with the pty module is not installed')
const DRIVE = fileURLToPath(new URL('./pty/drive.py', import.meta.url))
const BIN = fileURLToPath(new URL('../bin/slatebox.mjs', import.meta.url))
const HARNESS = fileURLToPath(new URL('./pty/harness.mjs', import.meta.url))
const GOLDEN = fileURLToPath(new URL('./golden/transcripts/pty-plain-export.txt', import.meta.url))
const AGENTS = ['AI_AGENT', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_SANDBOX', 'CODEX_CI', 'GEMINI_CLI', 'CURSOR_AGENT', 'CLINE_ACTIVE', 'AIDER_MODEL', 'OPENCODE', 'CI', 'NO_COLOR', 'FORCE_COLOR', 'SLATEBOX_PLAIN']
const DOWN = '\x1b[B'
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

function drive(cmd, steps, { cols = 100, rows = 40, env = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'sbx-pty-'))
  const spec = {
    cmd, cols, rows, cwd: home, timeout: 30, steps,
    env: { ...Object.fromEntries(AGENTS.map(name => [name, null])), HOME: home, SLATEBOX_INSTALL_HOME: home, TERM: 'xterm-256color', LANG: 'en_US.UTF-8', ...env },
  }
  const result = spawnSync(PYTHON, [DRIVE], { input: JSON.stringify(spec), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr)
  const out = JSON.parse(result.stdout)
  return { ...out, home, text: out.output.replace(ANSI, '') }
}

const EXPORT_STEPS = [
  { wait: 'Which files' }, { send: DOWN }, { send: DOWN }, { sleep: 50 }, { send: '\r' },
  { wait: 'Write them to' }, { send: '\r' },
  { wait: 'How does traffic reach it' }, { send: DOWN }, { send: DOWN }, { sleep: 50 }, { send: '\r' },
  { wait: 'Admin email' }, { send: 'ops@example.com\r' },
  { wait: 'Agents for drafts' }, { send: '\r' },
  { wait: 'Single sign-on with' }, { send: '\r' },
  { wait: 'usual settings' }, { send: '\r' },
  { wait: 'Wrote \\d+ files' },
]

test('pty: a real terminal gets the wizard; arrows and Enter answer; the terminal is given back', { skip }, () => {
  const run = drive(['node', BIN, 'install', '--target', 'export'], EXPORT_STEPS)
  assert.equal(run.failedStep, null, `step ${run.failedStep}: ${run.text.slice(-1500)}`)
  assert.equal(run.code, 0, run.text.slice(-1500))
  assert.match(run.text, /Slatebox installer \d+\.\d+\.\d+/)
  assert.match(run.text, /◇ {2}Files {2}Helm chart/, 'two downs chose the Helm chart')
  assert.match(run.text, /◇ {2}Traffic {2}Nothing for now/)
  assert.ok(readdirSync(join(run.home, 'slatebox-deploy'), { recursive: true }).some(file => String(file).endsWith('Chart.yaml')), 'the Helm chart was written')
  assert.ok(run.icanon && run.echo, 'stty shows icanon and echo again')
  assert.ok(run.output.includes('\x1b[?25h'), 'the cursor was shown again')
})

test('pty: Ctrl-C in a question exits 7, says nothing was changed, and restores the terminal', { skip }, () => {
  const run = drive(['node', BIN, 'install', '--target', 'export'], [{ wait: 'Which files' }, { sleep: 50 }, { send: '\x03' }])
  assert.equal(run.code, 7, run.text.slice(-1500))
  assert.match(run.text, /Canceled\. Nothing was changed\./)
  assert.ok(!existsSync(join(run.home, 'slatebox-deploy')), 'no files were written')
  assert.ok(run.icanon && run.echo, 'stty shows icanon and echo again')
  assert.ok(run.output.lastIndexOf('\x1b[?25h') > run.output.lastIndexOf('\x1b[?25l'), 'the cursor was shown after it was hidden')
})

test('pty: a resize while a question is open redraws it and the run goes on', { skip }, () => {
  const steps = [...EXPORT_STEPS]
  steps.splice(1, 0, { resize: [72, 30] }, { sleep: 100 }, { resize: [120, 40] }, { sleep: 100 })
  const run = drive(['node', BIN, 'install', '--target', 'export'], steps)
  assert.equal(run.failedStep, null, `step ${run.failedStep}: ${run.text.slice(-1500)}`)
  assert.equal(run.code, 0, run.text.slice(-1500))
  assert.ok(run.icanon && run.echo)
})

test('pty: the whole local install with a team address against the stand-ins (Docker, Slatebox Cloud)', { skip }, () => {
  const run = drive(['node', HARNESS, 'install'], [
    { wait: 'Where should Slatebox run' }, { send: '\r' },
    { wait: 'Where should your team open' }, { send: '\r' },
    { wait: 'Team address' }, { send: 'support\r' },
    { wait: 'Pick a free address' }, { send: '\r' },
    { wait: 'Admin email' }, { send: '\r' },
    { wait: 'Agents for drafts' }, { send: '\r' },
    { wait: 'Single sign-on with' }, { send: '\r' },
    { wait: 'usual settings' }, { send: '\r' },
    { wait: 'Change a section' }, { sleep: 50 }, { send: '\r' },
    { wait: 'Open it in your browser' }, { send: 'n' },
    { wait: 'Next' },
  ])
  assert.equal(run.failedStep, null, run.text.slice(-2500))
  assert.equal(run.code, 0, run.text.slice(-2500))
  assert.match(run.text, /✓ support-team\.slatebox\.team is available/)
  assert.match(run.text, /✦ Slatebox is running at https:\/\/support-team\.slatebox\.team/)
  // The setup link, whole, on one line.
  assert.match(run.text, /https:\/\/box\.example\/setup\/SetupToken\S{20,}/)
  assert.ok(run.icanon && run.echo)
})

test('pty: --plain is today\'s plain transcript, byte for byte', { skip }, () => {
  // Each answer is typed once its prompt has been written in full, as a person would.
  const run = drive(['node', BIN, 'install', '--target', 'export', '--plain'], [
    { wait: 'Choose 1-3 \\(Enter for the default\\): ' }, { send: '3\n' },
    { wait: 'Write them to \\(\\./slatebox-deploy\\): ' }, { send: '\n' },
    { wait: 'Choose 1-3 \\(Enter for the default\\): ' }, { send: '3\n' },
    { wait: 'Admin email.*\\(Enter skips\\): ' }, { send: 'ops@example.com\n' },
    { wait: 'Choose 1-4: ' }, { send: '1\n' },
    { wait: 'Single sign-on.*\\[y/N\\]: ' }, { send: '\n' },
    { wait: 'Choose 1-2 \\(Enter for the default\\): ' }, { send: '\n' },
    { wait: 'Choose 1-3 \\(Enter for the default\\): ' }, { send: '\n' },
    { wait: 'Mail:.*\\(Enter skips\\): ' }, { send: '\n' },
    { wait: 'Wrote \\d+ files' },
  ])
  assert.equal(run.failedStep, null, `step ${run.failedStep}: ${run.text.slice(-1500)}`)
  assert.equal(run.code, 0, run.text.slice(-1500))
  assert.ok(!run.output.includes('\x1b['), 'no escape codes in plain mode')
  const transcript = run.output.replace(/\r\n/g, '\n').split(run.home).join('<HOME>').replace(/\/private<HOME>/g, '<HOME>')
  if (process.env.SLATEBOX_UPDATE_GOLDEN === '1' || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, transcript)
    if (process.env.SLATEBOX_UPDATE_GOLDEN !== '1') assert.fail('pty-plain-export.txt had no golden file; one was written. Run again.')
  }
  assert.equal(transcript, readFileSync(GOLDEN, 'utf8'))
})
