// Which installer a person gets: the wizard in the terminal (rich), today's line prompts (plain),
// or no questions at all (none: --json, agents, --yes, no terminal). This is the only place the
// mode is decided, and it loads nothing: the wizard and its input library are imported only
// once the answer is rich, so --version, --json, --yes, agents and CI pay nothing for them.

/**
 * The first matching row wins.
 * @param {{json?: boolean, agentMode?: boolean, yes?: boolean, flags?: object}} run
 * @param {object} env
 * @param {{stdin: any, stderr: any}} streams
 * @returns {{mode: 'none'|'plain'|'rich', reason: string}}
 */
export function pickUi(run, env, { stdin, stderr }) {
  const flags = run.flags || {}
  if (run.json || run.agentMode) return { mode: 'none', reason: run.json ? '--json' : 'agent' }
  if (!stdin?.isTTY || !stderr?.isTTY) return { mode: 'none', reason: 'not a terminal' }
  if (run.yes) return { mode: 'none', reason: '--yes' }
  const set = name => env[name] !== undefined && env[name] !== ''
  if (flags.plain) return { mode: 'plain', reason: '--plain' }
  if (set('SLATEBOX_PLAIN') && env.SLATEBOX_PLAIN !== '0') return { mode: 'plain', reason: 'SLATEBOX_PLAIN' }
  if (env.TERM === 'dumb') return { mode: 'plain', reason: 'TERM=dumb' }
  if (set('CI')) return { mode: 'plain', reason: 'CI' }
  if (typeof stdin.setRawMode !== 'function') return { mode: 'plain', reason: 'no raw mode' }
  if (!(Number(stderr.columns) >= 60)) return { mode: 'plain', reason: `${Number(stderr.columns) || 0} columns` }
  return { mode: 'rich', reason: 'terminal' }
}

/**
 * pickUi, then (for rich) the wizard loaded. A wizard that cannot be loaded falls back to the plain
 * prompts, with a note under --debug.
 * @returns {Promise<{mode: string, reason: string, term?: object, rich?: object}>}
 */
export async function resolveUi(run, env, streams, { load = loadRich, platform = process.platform, debug = () => {} } = {}) {
  const picked = pickUi(run, env, streams)
  if (picked.mode !== 'rich') return picked
  try {
    const { rich, term } = await load()
    return { ...picked, rich, term: term.detectTerm(env, streams.stderr, platform), termModule: term }
  } catch (error) {
    debug(`The wizard could not be loaded (${error.code || error.message}); using the plain questions.`)
    return { mode: 'plain', reason: 'wizard not loaded' }
  }
}

async function loadRich() {
  const [rich, term] = await Promise.all([import('./rich-prompt.mjs'), import('./term.mjs')])
  return { rich, term }
}
