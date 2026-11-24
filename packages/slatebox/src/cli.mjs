// `slatebox`: install and run your own Slatebox, and (delegated to the
// slatebox-mcp package) work with slates. main() takes its streams and
// environment as arguments and returns the exit code, so tests run it in
// process.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { AGENT_PROMPT } from './agent-prompt.mjs'
import { aiEnv, aiTestScript, normalizeProvider } from './ai/settings-adapter.mjs'
import { ANSWER_FLAGS, collect, flagsFromEnv, parseProviderSpec, resolveAnswers } from './answers.mjs'
import { EXIT, InstallError } from './errors.mjs'
import { interview } from './interview.mjs'
import { Output } from './output.mjs'
import { DEFAULT_IMAGE, DEFAULT_REPOSITORY, isTag } from './image.mjs'
import { formatPlan } from './plan.mjs'
import { createPrompt } from './prompt.mjs'
import { listRecords, readRecord, slateboxHome, writeRecord } from './record.mjs'
import { makeRunner } from './runner.mjs'
import { Redactor } from './secrets.mjs'
import { applyDocker, backupDocker, defaultLocalPort, execNode, readSecretDocker, restoreDocker, statusDocker, uninstallDocker } from './targets/docker.mjs'
import { exportFiles } from './targets/export.mjs'
import { applyK8s, backupK8s, execNodeK8s, readSecretK8s, restoreK8s, statusK8s, uninstallK8s } from './targets/k8s.mjs'
import { parse as parseYaml } from './yaml.mjs'

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const INSTALLER_COMMANDS = ['install', 'plan', 'status', 'upgrade', 'backup', 'restore', 'uninstall', 'ai', 'secrets', 'agent-prompt', 'installs', 'help']

export const HELP = `slatebox ${PKG.version}: run your own Slatebox.

  npx slatebox                           on the machine of your choice: asks a few questions,
                                         shows a plan, installs (the same as slatebox install)
  npx slatebox --dry-run                 the questions and the plan only; nothing changes
  npx slatebox agent-prompt              instructions for a coding agent to do it for you

Install and run:
  slatebox install [local|ssh <user@host>|k8s|export] [flags]
  slatebox plan    [same flags]          print the plan only; changes nothing
  slatebox status                        address, version, health, AI and SSO, last backup
  slatebox upgrade [--to <image>]        fetch the install's image tag again (or --to), back up,
                                         upgrade, check health, roll back on failure
  slatebox backup  [--to <dir>]          a complete backup now
  slatebox restore <file.gz>
  slatebox uninstall [--delete-data --confirm <name>]   data is kept unless you say otherwise
  slatebox ai list | add "<spec>" | remove <id> | use <id> | off | test [id]
  slatebox secrets path | reveal <NAME>  where secrets are kept; reveal prints one to a terminal
  slatebox installs                      the installs this computer made
  slatebox agent-prompt

Install flags (each also SLATEBOX_INSTALL_<NAME> in the environment; flags win,
then --answers, then the environment. Consent never comes from the environment:
--yes, --install-docker and --new-encryption-key are typed each time):
  --name <id>             several installs can live side by side (default slatebox)
  --answers <file>        YAML or JSON answers (see agent-prompt); never holds secrets
  --target local|ssh|k8s|export     --host user@host  --ssh-port N  --identity <key>
  --ssh-option <opt>      passed to ssh -o (repeatable)  --install-docker  (only with consent)
  --domain <name>         HTTPS with automatic certificates   --url <address>   --port <n>
  --listen <ip>           this computer only: 127.0.0.1 (default) or 0.0.0.0 for every interface
  --admin-email <email>
  --ai none | --ai-provider "kind=<openai|anthropic|deepinfra|openrouter|groq|together|mistral|ollama|lmstudio|openai-compatible>,model=<m>,url=<endpoint>,key=env:<VAR>"
                          (repeat for several, then --ai-default <id>; there is no default provider)
  --sso  --sso-only  --sso-admin open|closed
  --backups default|<dir>|s3://bucket/prefix|off  --backup-schedule "0 3 * * *"  --backup-keep 14
  --size small|team|large   --mail-url-from env:<VAR>  --mail-from "Slatebox <b@example.com>"
  --k8s-context <ctx> --namespace <ns> --route none|ingress|gateway --ingress-class <c>
  --gateway-ref <ns/name> --tls-issuer ClusterIssuer/<name> --storage-class <sc>
  --format compose|manifests|helm --out <dir>          (target export)
  --image <ref> --image-archive <file.tar>             (a local build instead of the public image)

  --new-encryption-key    replace a lost SLATEBOX_KEY_ENCRYPTION_KEY over existing data
                          (keys people saved become unreadable; refused without it)

Global: --yes (after a person approved the plan)  --json (NDJSON events on stdout)
        --agent auto|yes|no  --debug  --health-timeout <seconds> (default 600)

Exit codes: 0 done or nothing to change; 2 bad flags or answers; 3 an answer or a
confirmation is needed and nobody can be asked; 4 a precondition failed;
5 the change failed and was rolled back; 6 the rollback failed too (commands
attached); 7 cancelled.

Slates (from slatebox-mcp, fetched when first used): slatebox exec | describe
`

// Agents that announce themselves in the environment.
const AGENT_ENV = ['AI_AGENT', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_SANDBOX', 'CODEX_CI', 'GEMINI_CLI', 'CURSOR_AGENT', 'CLINE_ACTIVE', 'AIDER_MODEL', 'OPENCODE']

export function detectAgent(env) {
  return AGENT_ENV.some(name => env[name] && env[name] !== '0' && env[name] !== 'false')
}

function parse(argv) {
  const options = {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
    yes: { type: 'boolean', short: 'y' }, json: { type: 'boolean' }, agent: { type: 'string' }, debug: { type: 'boolean' },
    answers: { type: 'string' }, home: { type: 'string' }, 'image-archive': { type: 'string' }, 'health-timeout': { type: 'string' },
    'dry-run': { type: 'boolean' }, 'show-secrets': { type: 'boolean' }, 'delete-data': { type: 'boolean' }, confirm: { type: 'string' },
    to: { type: 'string' }, 'force-stdout': { type: 'boolean' }, 'new-encryption-key': { type: 'boolean' },
  }
  for (const [flag, type] of Object.entries(ANSWER_FLAGS)) {
    options[flag] = type === 'multiple' ? { type: 'string', multiple: true } : { type }
  }
  return parseArgs({ args: argv, options, allowPositionals: true, allowNegative: true, strict: true })
}

// The slate commands (exec, describe, ...) belong to the slatebox-mcp package.
// It is not a dependency: both packages name a `slatebox` command, and npx
// would link two. A sibling checkout or an installed copy is used when there
// is one; otherwise npx fetches this exact version (a range would install
// whatever 0.3.x is newest on first use, unasked).
export const SLATE_PACKAGE = 'slatebox-mcp@0.3.5'

function slateCli() {
  try { return createRequire(import.meta.url).resolve('slatebox-mcp/src/slatebox.js') } catch { /* not installed */ }
  const sibling = fileURLToPath(new URL('../../slatebox-mcp/src/slatebox.js', import.meta.url))
  return existsSync(sibling) ? sibling : null
}

function delegate(argv, io) {
  const path = slateCli()
  const [cmd, args] = path ? [process.execPath, [path, ...argv]] : [process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', '--package', SLATE_PACKAGE, 'slatebox', ...argv]]
  return new Promise(resolve => {
    const child = spawn(cmd, args, { env: io.env, stdio: ['pipe', 'pipe', 'pipe'] })
    child.on('error', () => {
      io.stderr.write(`Unknown command ${argv[0]}. See slatebox --help. (Slate commands need ${SLATE_PACKAGE}: npx -p ${SLATE_PACKAGE} slatebox ${argv[0]})\n`)
      resolve(EXIT.USAGE)
    })
    child.stdout.on('data', chunk => io.stdout.write(chunk))
    child.stderr.on('data', chunk => io.stderr.write(chunk))
    if (io.stdin && io.stdin !== process.stdin) io.stdin.pipe?.(child.stdin)
    else if (io.stdin === process.stdin && !process.stdin.isTTY) process.stdin.pipe(child.stdin)
    else child.stdin.end()
    child.on('close', code => resolve(code ?? 1))
  })
}

function readAnswersFile(path) {
  if (!path) return undefined
  let text
  try { text = readFileSync(path, 'utf8') } catch (error) { throw new InstallError(EXIT.USAGE, `Cannot read the answers file ${path}: ${error.code || error.message}`) }
  try {
    const parsed = parseYaml(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('it is not a map of answers')
    if (parsed.version !== undefined && parsed.version !== 1) throw new Error(`version ${parsed.version} is not supported (this installer reads version 1)`)
    return parsed
  } catch (error) {
    throw new InstallError(EXIT.USAGE, `The answers file ${path} is not valid: ${error.message}`)
  }
}

/**
 * @param {string[]} argv arguments after "slatebox"
 * @param {{env?: object, stdin?: any, stdout?: any, stderr?: any, run?: Function, fetch?: Function}} io
 * @returns {Promise<number>} exit code
 */
export async function main(argv, io = {}) {
  io = { env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, ...io }
  io.platform ??= process.platform
  io.cwd ??= process.cwd()
  const [command] = argv
  if (command && !command.startsWith('-') && !INSTALLER_COMMANDS.includes(command)) return delegate(argv, io)
  let parsed
  try {
    parsed = parse(argv)
  } catch (error) {
    io.stderr.write(`${error.message}\nSee slatebox --help.\n`)
    if (argv.includes('--json')) io.stdout.write(JSON.stringify({ event: 'error', id: 'usage', status: 'failed', exitCode: EXIT.USAGE, message: error.message }) + '\n')
    return EXIT.USAGE
  }
  const envFlags = flagsFromEnv(io.env)
  const flags = { ...envFlags, ...parsed.values }
  const positionals = parsed.positionals
  if (flags.version) { io.stdout.write(`${PKG.version}\n`); return 0 }
  if (flags.help || positionals[0] === 'help') { io.stdout.write(HELP); return 0 }
  // Plain `npx slatebox` is the guided install on this machine.
  if (!positionals.length) positionals.unshift('install')

  const agentMode = flags.agent === 'yes' || (flags.agent !== 'no' && detectAgent(io.env))
  const tty = Boolean(io.stdin.isTTY && io.stderr.isTTY)
  const interactive = tty && !agentMode
  const json = flags.json ?? agentMode
  const redactor = new Redactor()
  const out = new Output({ stdout: io.stdout, stderr: io.stderr, json, debug: Boolean(flags.debug), redactor })
  const ctx = {
    env: io.env, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, flags, version: PKG.version,
    home: slateboxHome(io.env, flags.home), redactor, out, run: io.run || makeRunner(out), fetch: io.fetch || globalThis.fetch,
    interactive, tty, agentMode, json, yes: Boolean(flags.yes), healthTimeout: Number(flags['health-timeout'] || 600),
    cliFlags: parsed.values, platform: io.platform, cwd: io.cwd,
  }
  if (interactive) ctx.prompt = createPrompt({ input: io.stdin, output: io.stderr })
  ctx.emitPlan = plan => {
    out.event({ event: 'plan', ...plan })
    const text = formatPlan(plan)
    if (json) io.stderr.write(redactor.redact(text) + '\n')
    else out.say(`\n${text}\n`)
  }
  ctx.confirm = async plan => {
    if (ctx.yes) return
    if (ctx.interactive) {
      const local = plan.target === 'local' || plan.target === 'export'
      if (await ctx.prompt.confirm('Apply this plan?', { default: local })) return
      throw new InstallError(EXIT.CANCELLED, 'Cancelled; nothing was changed.')
    }
    throw new InstallError(EXIT.NEEDS_INPUT, 'This plan needs a yes. Show it to the person; once they agree, run the same command with --yes.', { needsConfirmation: true })
  }

  try {
    const result = await dispatch(ctx, positionals, flags)
    ctx.prompt?.close()
    return result ?? 0
  } catch (error) {
    ctx.prompt?.close()
    if (!(error instanceof InstallError)) {
      out.event({ event: 'error', id: 'internal', status: 'failed', exitCode: 1, message: error.message })
      io.stderr.write(redactor.redact(`✗ ${error.message}\n${flags.debug ? `${error.stack}\n` : ''}`))
      return 1
    }
    const name = Object.entries(EXIT).find(([, code]) => code === error.exitCode)?.[0]?.toLowerCase().replace(/_/g, '-') || 'error'
    out.event({ event: 'error', id: name, status: 'failed', exitCode: error.exitCode, message: error.message, ...error.details })
    io.stderr.write(redactor.redact(`${error.exitCode === EXIT.NEEDS_INPUT ? '?' : '✗'} ${error.message}\n`))
    if (error.details?.missing?.length && !json) {
      for (const item of error.details.missing) io.stderr.write(`  - ${item.field}: ${item.question}${item.flag ? `  (${item.flag})` : ''}\n`)
    }
    if (error.details?.fields?.length && !json) {
      for (const item of error.details.fields) io.stderr.write(`  - ${item.field}: ${item.message}\n`)
    }
    return error.exitCode
  }
}

function requireRecord(ctx, flags) {
  const name = flags.name || 'slatebox'
  const record = readRecord(ctx.home, name)
  if (!record) {
    const known = listRecords(ctx.home).map(item => item.name)
    throw new InstallError(EXIT.PRECONDITION, `There is no install named "${name}" made from this computer.${known.length ? ` Installs here: ${known.join(', ')} (use --name).` : ' Run slatebox install first.'}`)
  }
  return record
}

/**
 * The image an upgrade goes to: --to, else this package's release image for an
 * install of the public image, else the install's own tag fetched again (a
 * private registry stays a private registry).
 */
function upgradeImage(record, flags) {
  if (flags.to || flags.image) return flags.to || flags.image
  const current = record.imageRef || record.image
  if (!current || current.startsWith(`${DEFAULT_REPOSITORY}:`) || current.startsWith(`${DEFAULT_REPOSITORY}@`)) return DEFAULT_IMAGE
  if (isTag(current)) return current
  throw new InstallError(EXIT.USAGE, `"${record.name}" runs ${current}, which is pinned and cannot get newer by itself. Name the new image: slatebox upgrade --to <image>.`)
}

function finish(ctx, done, lines = []) {
  ctx.out.event({ event: 'done', ...done })
  for (const line of lines) ctx.out.say(line)
  return 0
}

async function prepareAnswers(ctx, flags, positionals) {
  const target = positionals[1] && ['local', 'ssh', 'k8s', 'export'].includes(positionals[1]) ? positionals[1] : undefined
  const host = target === 'ssh' ? positionals[2] : undefined
  const file = readAnswersFile(flags.answers)
  // Only flags typed on the command line here; collect() adds the environment below the answers file.
  const cliFlags = { ...Object.fromEntries(Object.entries(ctx.cliFlags).filter(([key]) => key in ANSWER_FLAGS)), ...(target ? { target } : {}), ...(host ? { host } : {}) }
  const name = cliFlags.name || file?.name || flags.name || 'slatebox'
  const record = readRecord(ctx.home, name)
  let partial = collect({ record, env: ctx.env, file, flags: cliFlags })
  if (ctx.interactive) {
    const kube = await ctx.run('kubectl', ['config', 'current-context']).catch(() => null)
    ctx.currentContext = kube?.code === 0 ? kube.stdout.trim() : null
    ctx.freePort = partial.address?.port ?? await defaultLocalPort()
    partial = await interview(ctx, partial)
  }
  const freePort = (partial.target ?? 'local') === 'local' && partial.address?.port === undefined && !partial.address?.url ? await defaultLocalPort() : undefined
  const { answers, missing, errors } = resolveAnswers(partial, { freePort, cwd: ctx.cwd, home: ctx.env.HOME })
  if (errors.length) throw new InstallError(EXIT.USAGE, `Some answers are not valid: ${errors.map(error => error.field).join(', ')}.`, { fields: errors })
  if (missing.length) throw new InstallError(EXIT.NEEDS_INPUT, `Some answers are needed: ${missing.map(item => item.field).join(', ')}.`, { missing })
  return { answers, record, explicitContext: Boolean(cliFlags['k8s-context'] || file?.k8s?.context || record?.k8s?.context) }
}

async function applyTarget(ctx, answers, options) {
  if (answers.target === 'k8s') return applyK8s(ctx, answers, options)
  if (answers.target === 'export') return exportFiles(ctx, answers, options)
  return applyDocker(ctx, answers, { ...options, archive: ctx.flags['image-archive'] })
}

function closing(ctx, done) {
  if (done.nothingToChange) return [`Nothing to change: ${done.name} is running at ${done.address}.`]
  if (done.target === 'export') return [`Wrote ${done.files.length} files to ${done.dir}. Nothing was applied.`]
  const lines = ['', `Slatebox is running at ${done.address}`]
  if (done.keyGenerated) {
    lines.push('', `Your key encryption key is stored in ${done.secretsFile}. Back it up with your password manager now.`,
      'Backups do not contain it, and without it people\'s saved AI keys cannot be read after a restore.')
  }
  lines.push(`Install record: ${done.installRecord}`, `Day two: slatebox status | upgrade | backup | ai --name ${done.name}`)
  return lines
}

async function showSecretOnce(ctx, record, name) {
  if (ctx.json || !(ctx.stdout.isTTY || ctx.flags['force-stdout'])) {
    throw new InstallError(EXIT.USAGE, 'Secrets are printed only to a terminal, never with --json or into a pipe (add --force-stdout if you really mean to).')
  }
  const value = record.target === 'k8s' ? await readSecretK8s(ctx, record, name) : await readSecretDocker(ctx, record, name)
  if (!value) throw new InstallError(EXIT.PRECONDITION, `${name} is not set for "${record.name}".`)
  ctx.stdout.write(`${value}\n`)
}

async function dispatch(ctx, positionals, flags) {
  const [command, sub, ...rest] = positionals
  switch (command) {
    case 'agent-prompt':
      ctx.stdout.write(AGENT_PROMPT)
      return 0
    case 'installs': {
      const records = listRecords(ctx.home)
      ctx.out.event({ event: 'done', installs: records.map(record => ({ name: record.name, target: record.target, address: record.address?.url, state: record.state })) })
      if (!ctx.json) for (const record of records) ctx.out.say(`${record.name.padEnd(16)} ${String(record.target).padEnd(7)} ${record.address?.url || ''} ${record.state === 'installed' ? '' : `(${record.state})`}`)
      if (!records.length) ctx.out.say('No installs made from this computer yet.')
      return 0
    }
    case 'plan':
    case 'install': {
      const { answers, record, explicitContext } = await prepareAnswers(ctx, flags, positionals)
      const planOnly = command === 'plan' || Boolean(flags['dry-run'])
      const done = await applyTarget(ctx, answers, { record, planOnly, explicitContext })
      if (done.planned) {
        ctx.out.event({ event: 'done', planned: true, name: answers.name, target: answers.target })
        if (!ctx.json) ctx.out.say(`Nothing was changed. To apply: slatebox install ${flags.answers ? `--answers ${flags.answers} ` : ''}... (the same answers)${ctx.interactive ? '' : ' --yes'}`)
        return 0
      }
      finish(ctx, done, closing(ctx, done))
      if (flags['show-secrets'] && done.keyGenerated) await showSecretOnce(ctx, ctx.record, 'SLATEBOX_KEY_ENCRYPTION_KEY')
      return 0
    }
    case 'upgrade': {
      const record = requireRecord(ctx, flags)
      const { answers, errors } = resolveAnswers(collect({ record }), {})
      if (errors.length) throw new InstallError(EXIT.USAGE, 'The install record is not valid.', { fields: errors })
      const imageRef = upgradeImage(record, flags)
      const done = await applyTarget(ctx, answers, { record, imageRef, explicitContext: true, refresh: true })
      return finish(ctx, done, done.nothingToChange ? [`Already up to date: ${done.name} runs ${done.imageDigest}.`] : ['', `Upgraded. Slatebox is running at ${done.address} (${done.imageDigest}).`])
    }
    case 'status': {
      const record = requireRecord(ctx, flags)
      const status = record.target === 'k8s' ? await statusK8s(ctx, record) : await statusDocker(ctx, record)
      ctx.out.event({ event: 'done', ...status })
      if (!ctx.json) {
        for (const [label, value] of Object.entries({ Name: status.name, Where: status.where, Address: status.address, Health: status.health, Version: status.version ? `app ${status.version.app}, engine ${status.version.engine}` : '-', Image: status.imageDigest, AI: status.ai, SSO: status.sso, 'Last backup': status.lastBackup || 'none yet' })) {
          ctx.out.say(`${label.padEnd(12)} ${value}`)
        }
      }
      return status.health === 'healthy' ? 0 : EXIT.PRECONDITION
    }
    case 'backup': {
      const record = requireRecord(ctx, flags)
      const result = record.target === 'k8s' ? await backupK8s(ctx, record, { to: flags.to }) : await backupDocker(ctx, record, { to: flags.to })
      return finish(ctx, { name: record.name, ...result }, [`Backup written to ${result.file}${result.where === 'this computer' ? '' : ` on ${result.where}`}.`, 'It does not contain SLATEBOX_KEY_ENCRYPTION_KEY: keep that with it (slatebox secrets path).'])
    }
    case 'restore': {
      const record = requireRecord(ctx, flags)
      const archive = sub
      if (!archive || !existsSync(archive)) throw new InstallError(EXIT.USAGE, 'Name the backup file: slatebox restore <file.gz>')
      const where = record.target === 'k8s' ? `context ${record.k8s.context}, namespace ${record.k8s.namespace}` : record.target === 'ssh' ? record.ssh.host : 'this computer'
      const plan = { action: 'restore', target: record.target, name: record.name, where, address: record.address.url, files: [{ path: archive, note: 'the backup to restore' }], commands: [`slatebox restore < ${archive} (inside the ${record.target === 'k8s' ? 'pod' : 'container'})`], objects: [], ports: [], secretsLocation: record.secretsLocation, warnings: [`This replaces every slate, account and stored file of "${record.name}" with the contents of ${archive}. Anything made since that backup is lost. Take a backup first (slatebox backup) if you may want it back.`], notes: ['The backup does not hold SLATEBOX_KEY_ENCRYPTION_KEY: saved keys are readable only if this install still has the key it had when the backup was taken.'], changes: [] }
      ctx.emitPlan(plan)
      await ctx.confirm(plan)
      const result = record.target === 'k8s' ? await restoreK8s(ctx, record, archive) : await restoreDocker(ctx, record, archive)
      return finish(ctx, { name: record.name, ...result }, [`Restored ${archive}. Slatebox is ready.`])
    }
    case 'uninstall': {
      const record = requireRecord(ctx, flags)
      const deleteData = Boolean(flags['delete-data'])
      if (deleteData) {
        let typed = flags.confirm
        if (!typed && ctx.interactive) typed = await ctx.prompt.text(`This deletes every slate and account of "${record.name}". Type its name to confirm`, { optional: true })
        if (typed !== record.name) throw new InstallError(ctx.interactive ? EXIT.CANCELLED : EXIT.NEEDS_INPUT, `Deleting data needs the install's name typed back: --confirm ${record.name}. Nothing was changed.`, { needsConfirmation: true })
      }
      const plan = { action: 'uninstall', target: record.target, name: record.name, where: record.target === 'ssh' ? record.ssh.host : record.target === 'k8s' ? record.k8s.context : 'this computer', address: record.address.url, files: [], commands: [], objects: [], ports: [], secretsLocation: record.secretsLocation, warnings: deleteData ? ['Data, secrets and backups next to the install will be deleted.'] : [], notes: deleteData ? [] : ['The data volume and the secrets are kept; install again with the same --name to get it back.'], changes: [] }
      ctx.emitPlan(plan)
      await ctx.confirm(plan)
      const result = record.target === 'k8s' ? await uninstallK8s(ctx, record, { deleteData }) : await uninstallDocker(ctx, record, { deleteData })
      if (deleteData) {
        const { rmSync } = await import('node:fs')
        const { installDir } = await import('./record.mjs')
        rmSync(installDir(ctx.home, record.name), { recursive: true, force: true })
      } else {
        writeRecord(ctx.home, { ...record, state: 'uninstalled' })
      }
      return finish(ctx, { name: record.name, ...result }, [deleteData ? `Removed "${record.name}" and its data.` : `Removed "${record.name}". Kept: ${result.volume} and ${result.secretsFile}. To delete them too: slatebox uninstall --name ${record.name} --delete-data --confirm ${record.name}`])
    }
    case 'ai':
      return aiCommand(ctx, flags, sub, rest)
    case 'secrets': {
      const record = requireRecord(ctx, flags)
      if (sub === 'reveal') {
        if (!rest[0]) throw new InstallError(EXIT.USAGE, 'Name the secret: slatebox secrets reveal SLATEBOX_KEY_ENCRYPTION_KEY')
        await showSecretOnce(ctx, record, rest[0])
        return 0
      }
      ctx.out.event({ event: 'done', name: record.name, secretsLocation: record.secretsLocation, secrets: Object.keys(record.secretRefs || {}) })
      if (!ctx.json) ctx.out.say(`${record.secretsLocation}\nHolds: ${Object.keys(record.secretRefs || {}).join(', ')}`)
      return 0
    }
    default:
      throw new InstallError(EXIT.USAGE, `Unknown command ${command}. See slatebox --help.`)
  }
}

// ------------------------------------------------------------------ ai

async function aiCommand(ctx, flags, sub, rest) {
  const record = requireRecord(ctx, flags)
  const ai = structuredClone(record.ai)
  const providers = ai.mode === 'providers' ? ai.providers : []
  if (!sub || sub === 'list') {
    ctx.out.event({ event: 'done', name: record.name, ai: record.ai })
    if (!ctx.json) {
      if (!providers.length) ctx.out.say('AI is off. Add a provider: slatebox ai add "kind=openai,model=gpt-5-mini,key=env:OPENAI_API_KEY"')
      for (const provider of providers) ctx.out.say(`${provider.id === ai.default ? '*' : ' '} ${provider.id.padEnd(14)} ${provider.kind.padEnd(18)} ${provider.model || ''} ${provider.baseUrl || ''} key: ${provider.keyFrom}`)
    }
    return 0
  }
  if (sub === 'test') {
    const chosen = rest[0] ? providers.find(provider => provider.id === rest[0]) : providers.find(provider => provider.id === ai.default) || providers[0]
    if (!chosen) throw new InstallError(EXIT.PRECONDITION, rest[0] ? `No AI provider "${rest[0]}".` : 'AI is off for this install.')
    const multi = Object.keys(record.secretRefs || {}).some(name => name.startsWith('SLATEBOX_AI_KEY_')) || providers.length > 1
    const located = aiEnv({ mode: 'providers', providers: [chosen], default: chosen.id }, multi ? { settings: ['SLATEBOX_AI_PROVIDERS'] } : null, { target: record.target })
    const provider = normalizeProvider(chosen)
    const baseUrl = provider.kind === 'deepinfra' ? 'https://api.deepinfra.com/v1/openai' : multi ? JSON.parse(located.env.SLATEBOX_AI_PROVIDERS)[0].baseUrl : located.env.SLATEBOX_AI_URL
    const keyEnv = provider.keyFrom === 'none' ? '' : multi ? Object.keys(located.secrets)[0] : 'SLATEBOX_AI_KEY'
    ctx.out.step('ai-test', 'start', `Testing ${chosen.id} from inside the container (${baseUrl})`)
    const run = record.target === 'k8s' ? execNodeK8s : execNode
    const result = await run(ctx, record, aiTestScript(), [baseUrl, provider.model || '', keyEnv])
    let report
    try { report = JSON.parse(result.stdout.trim().split('\n').pop()) } catch { throw new InstallError(EXIT.PRECONDITION, `The test could not run in the container: ${result.stderr.trim().split('\n').pop()}`) }
    ctx.out.event({ event: 'done', name: record.name, provider: chosen.id, ...report })
    if (!ctx.json) {
      ctx.out.say(`Endpoint:     ${report.baseUrl}`)
      ctx.out.say(`Models:       ${Array.isArray(report.models) ? report.models.slice(0, 8).join(', ') || '(none listed)' : report.models}`)
      ctx.out.say(`Tool calls:   ${report.toolCalls === null ? '-' : report.toolCalls ? 'yes' : 'no'}`)
      ctx.out.say(`tool_choice:  ${report.toolChoiceHonoured === null ? '-' : report.toolChoiceHonoured ? 'honoured' : 'ignored (Slatebox falls back to plain text for this model)'}`)
      ctx.out.say(`Latency:      ${report.latencyMs ?? '-'} ms`)
      if (report.error) ctx.out.say(`Problem:      ${report.error}`)
    }
    return report.error ? EXIT.PRECONDITION : 0
  }
  if (sub === 'add') {
    if (!rest[0]) throw new InstallError(EXIT.USAGE, 'Usage: slatebox ai add "kind=openai,model=gpt-5-mini,key=env:OPENAI_API_KEY"')
    const added = parseProviderSpec(rest[0])
    if (providers.some(provider => provider.id === added.id)) throw new InstallError(EXIT.USAGE, `There is already a provider "${added.id}"; give another id=.`)
    ai.mode = 'providers'
    ai.providers = [...providers, added]
    if (flags['ai-default']) ai.default = flags['ai-default']
    else if (ai.providers.length === 1) ai.default = added.id
  } else if (sub === 'remove') {
    if (!providers.some(provider => provider.id === rest[0])) throw new InstallError(EXIT.USAGE, `No AI provider "${rest[0]}".`)
    ai.providers = providers.filter(provider => provider.id !== rest[0])
    if (!ai.providers.length) { ai.mode = 'none'; delete ai.providers; delete ai.default }
    else if (ai.default === rest[0]) ai.default = ai.providers.length === 1 ? ai.providers[0].id : undefined
  } else if (sub === 'use') {
    if (!providers.some(provider => provider.id === rest[0])) throw new InstallError(EXIT.USAGE, `No AI provider "${rest[0]}".`)
    ai.default = rest[0]
  } else if (sub === 'off') {
    ai.mode = 'none'
    delete ai.providers
    delete ai.default
  } else {
    throw new InstallError(EXIT.USAGE, 'Usage: slatebox ai list | add "<spec>" | remove <id> | use <id> | off | test [id]')
  }
  const { answers, errors } = resolveAnswers(collect({ record: { ...record, ai } }), {})
  if (errors.length) throw new InstallError(EXIT.USAGE, `That AI change is not valid: ${errors.map(error => `${error.field} (${error.message})`).join('; ')}`, { fields: errors })
  // Same image, new settings: the change path, with its plan, health check and rollback.
  const done = await applyTarget(ctx, answers, { record, imageRef: record.imageRef, explicitContext: true })
  return finish(ctx, done, done.nothingToChange ? ['Nothing to change.'] : [`AI is now ${answers.ai.mode === 'none' ? 'off' : `${answers.ai.providers.map(provider => provider.id).join(', ')} (default ${answers.ai.default})`} for ${answers.name}.`])
}
