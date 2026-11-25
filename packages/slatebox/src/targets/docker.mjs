// Install, change, upgrade and run Slatebox on a Docker host: this computer
// (the default) or a Linux server over SSH. One flow for both:
//
//   preflight -> image -> plan -> confirm -> secrets -> files -> start -> health
//   -> (rollback on failure) -> first account -> backup schedule -> record
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { EXIT, InstallError } from '../errors.mjs'
import { firstAdmin, makeSetupLink, setupState, stillWaiting } from '../setup-link.mjs'
import { checkArch, checkCpu, DEFAULT_IMAGE, FALLBACK_CAPABILITIES, inspectImage, isPinnedImage, knownCapabilities, normalArch, pinImage, probeImage, refreshTag, resolveImage } from '../image.mjs'
import { emptyPlan } from '../plan.mjs'
import { installDir, recordText, writeRecord } from '../record.mjs'
import { COMPOSE_FILE, hostPort, ports, renderCompose, SECRETS_FILE, SETTINGS_FILE } from '../render/compose.mjs'
import { settingsFor } from '../render/settings.mjs'
import { shq } from '../runner.mjs'
import { secretValues } from '../secret-values.mjs'
import { envFileText, parseEnvFile } from '../secrets.mjs'
import { firstFreePort, localHost, MARKER, parseKeyValues, portFree, remotePreflightScript, sshHost, which } from './hosts.mjs'
import { checkTeamAddress, ensureTeamAddress, TUNNEL_TOKEN } from './address.mjs'
import { credentialsPath } from '../cloud.mjs'

const SLATEBOX = '/opt/slatebox/bin/slatebox'
const KEPT_FILE = 'secrets.kept.env'
const BACKUP_SCRIPT = 'backup.sh'

export function hostFor(ctx, answers) {
  if (answers.target === 'ssh') return sshHost(ctx, answers.ssh, { name: answers.name, home: ctx.home })
  return localHost(ctx, { dir: installDir(ctx.home, answers.name), name: answers.name })
}

// The folder is stored absolute (answers.mjs makes it so once), so it never
// depends on the directory the installer runs from.
export const backupsDir = (host, answers) =>
  answers.backups.to === 'default' || answers.backups.to === 'off' || answers.backups.to.startsWith('s3://')
    ? join(host.dir, 'backups')
    : answers.backups.to

const KEK = 'SLATEBOX_KEY_ENCRYPTION_KEY'
const PENDING_TOKEN = 'pending-team-address-claim'

/** Native Windows has no sh, crontab or file modes; Docker Desktop's WSL 2 integration is the way there. */
export function refuseWindows(ctx) {
  if ((ctx.platform || process.platform) === 'win32') {
    throw new InstallError(EXIT.PRECONDITION, 'Native Windows is not supported for installs on this computer or over SSH. Run the installer inside WSL 2 (Ubuntu) with Docker Desktop\'s WSL integration on, or use --target export or --target k8s.')
  }
}

const lastLine = text => text.trim().split('\n').filter(Boolean).pop() || ''

/** The port a local install should use when nothing says otherwise. */
export async function defaultLocalPort() {
  return (await firstFreePort(7070)) ?? 7070
}

// ------------------------------------------------------------------ preflight

/**
 * What to do when this computer has no docker command. Nothing is installed
 * for the person here: Docker Desktop, OrbStack and Podman need their own
 * installers and, on Linux, root.
 */
export function dockerMissing(ctx) {
  const lines = ['Docker is not installed on this computer, and Slatebox runs in one Docker container. Nothing was changed.']
  const platform = ctx.platform || process.platform
  if (which('podman', ctx.env.PATH)) {
    lines.push('Podman is installed: turn on its Docker compatibility so the docker command works (the podman-docker package on Linux, or Docker compatibility in Podman Desktop), make sure `docker compose version` answers, then run this again.')
  } else if (platform === 'darwin') {
    lines.push('Install Docker Desktop (https://docs.docker.com/desktop/setup/install/mac-install/) or OrbStack (https://orbstack.dev), start it, then run this again.')
  } else if (platform === 'linux') {
    lines.push('Install Docker Engine (https://docs.docker.com/engine/install/), for example: curl -fsSL https://get.docker.com | sudo sh. Then run this again.')
  } else {
    lines.push('Install Docker (https://docs.docker.com/get-started/get-docker/), start it, then run this again.')
  }
  lines.push('To install on another machine instead, run npx slatebox there, or: npx slatebox install ssh <user@host>.')
  return lines.join(' ')
}

async function preflightLocal(ctx, host) {
  const version = await host.docker(['version', '--format', '{{.Server.Version}}'])
  if (version.code === 127) throw new InstallError(EXIT.PRECONDITION, dockerMissing(ctx), { docker: 'missing', podman: Boolean(which('podman', ctx.env.PATH)) })
  if (version.code !== 0) {
    throw new InstallError(EXIT.PRECONDITION, `Docker is not running on this computer (${lastLine(version.stderr) || 'docker version failed'}). Start Docker Desktop, OrbStack, Podman or the Docker service, then run this again.`, { docker: 'stopped' })
  }
  const compose = await host.docker(['compose', 'version', '--short'])
  if (compose.code !== 0) throw new InstallError(EXIT.PRECONDITION, 'Docker Compose v2 (`docker compose`) is missing. Install the compose plugin, then run this again.')
  const arch = await host.docker(['version', '--format', '{{.Server.Arch}}'])
  // cron runs with PATH=/usr/bin:/bin; Docker Desktop and OrbStack live elsewhere.
  return { docker: version.stdout.trim(), compose: compose.stdout.trim(), arch: arch.code === 0 ? arch.stdout.trim() : null, docker_path: which('docker', ctx.env.PATH), aws_path: which('aws', ctx.env.PATH) }
}

async function checkPorts(host, answers, facts, existing) {
  if (existing.container.exists) return // the install already holds its ports
  const publish = ports(answers).map(hostPort)
  let taken
  if (host.kind === 'local') {
    taken = []
    for (const port of publish) if (!(await portFree(port))) taken.push(port)
  } else {
    const listening = new Set((facts.listening || '').split(/\s+/).filter(Boolean).map(Number))
    taken = publish.filter(port => listening.has(port))
  }
  if (taken.length) {
    throw new InstallError(EXIT.PRECONDITION, `Port ${taken.join(' and ')} on ${host.where} ${taken.length > 1 ? 'are' : 'is'} taken. Free ${taken.length > 1 ? 'them' : 'it'}, or choose another port with --port <number>.`, { field: 'address.port' })
  }
}

async function hostKeyHelp(ctx, ssh, where) {
  const scan = await ctx.run('ssh-keyscan', ['-p', String(ssh.port), '--', ssh.host], { timeout: 20_000 }).catch(() => null)
  const prints = scan?.code === 0 && scan.stdout.trim() ? await ctx.run('ssh-keygen', ['-lf', '-'], { input: scan.stdout }).catch(() => null) : null
  const lines = prints?.code === 0 ? prints.stdout.trim().split('\n').map(line => `  ${line}`) : []
  const login = `ssh ${ssh.port !== 22 ? `-p ${ssh.port} ` : ''}${where}`
  return `${where} is not in your known_hosts yet, so ssh refused to connect (Host key verification failed). Nothing was changed.\n` +
    (lines.length ? `The server offers these host keys:\n${lines.join('\n')}\nCheck one against what your provider or the server's console shows (ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub on the server), then ` : 'Then ') +
    `connect once yourself and accept the key: ${login}\nRun the installer again afterwards.`
}

async function preflightSsh(ctx, host, answers) {
  const publish = ports(answers).map(hostPort)
  const result = await host.remote('sh -s', { input: remotePreflightScript(publish), timeout: 60_000 })
  if (result.code !== 0 && /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(result.stderr)) {
    if (/HAS CHANGED/i.test(result.stderr)) throw new InstallError(EXIT.PRECONDITION, `The host key of ${host.where} has CHANGED since you last connected. That can mean someone is in the middle. Nothing was changed; find out why before you remove the old key (ssh-keygen -R ${answers.ssh.host}).`)
    throw new InstallError(EXIT.PRECONDITION, await hostKeyHelp(ctx, answers.ssh, host.where), { needs: 'host-key' })
  }
  if (result.code !== 0 && !result.stdout) {
    throw new InstallError(EXIT.PRECONDITION, `Cannot reach ${host.where} over SSH: ${lastLine(result.stderr)}. Check the host, user and key (ssh ${host.where} must work without a password prompt).`)
  }
  const facts = parseKeyValues(result.stdout)
  if (facts.uid !== '0') {
    if (facts.sudo !== 'yes' || answers.ssh.sudo === 'no') {
      throw new InstallError(EXIT.PRECONDITION, `${host.where} is not root and has no passwordless sudo. Connect as root, or allow this user to run sudo without a password.`)
    }
    host.sudo = 'sudo -n '
  }
  if (!['x86_64', 'aarch64', 'arm64'].includes(facts.arch)) {
    throw new InstallError(EXIT.PRECONDITION, `${host.where} is ${facts.arch}; Slatebox runs on 64-bit Intel/AMD (x86_64) or ARM (aarch64).`)
  }
  if (facts.docker_path?.includes('/snap/')) {
    throw new InstallError(EXIT.PRECONDITION, `Docker on ${host.where} is the snap package, which cannot run Slatebox's volume and restart settings reliably. Remove it (snap remove docker) and install Docker Engine from docs.docker.com.`)
  }
  facts.needsDocker = !facts.docker_path || !facts.docker_server
  if (facts.needsDocker && !answers.ssh.installDocker) {
    throw new InstallError(EXIT.PRECONDITION,
      `Docker is not ${facts.docker_path ? 'running' : 'installed'} on ${host.where}. Nothing was changed. To let the installer install Docker Engine from get.docker.com, run again with --install-docker.`,
      { needs: 'install-docker' })
  }
  if (!facts.needsDocker && !facts.compose) throw new InstallError(EXIT.PRECONDITION, `Docker Compose v2 is missing on ${host.where}. Install docker-compose-plugin, then run again.`)
  const diskGb = Number(facts.disk_kb || 0) / 1024 / 1024
  if (facts.disk_kb && diskGb < 5) throw new InstallError(EXIT.PRECONDITION, `${host.where} has ${diskGb.toFixed(1)} GB free; Slatebox needs at least 5 GB.`)
  return facts
}

// ------------------------------------------------------------------ state

async function existingState(host, answers) {
  const files = {}
  for (const file of [COMPOSE_FILE, SETTINGS_FILE, SECRETS_FILE, KEPT_FILE, BACKUP_SCRIPT]) files[file] = await host.readFile(join(host.dir, file))
  let container = { exists: false }
  const inspected = await host.docker(['inspect', '--format', '{{json .}}', answers.name])
  if (inspected.code === 0) {
    const info = JSON.parse(inspected.stdout)
    container = { exists: true, running: info.State?.Running, health: info.State?.Health?.Status, image: info.Image }
  }
  // The data volume outlives the container and this computer's files (uninstall keeps it).
  const volume = (await host.docker(['volume', 'inspect', `${answers.name}-data`])).code === 0
  return { files, container, volume }
}

/**
 * A new key encryption key over existing data would make every key people
 * saved unreadable, and the app cannot tell. So: never, unless asked for.
 */
function guardKey(ctx, host, answers, stored, secrets, existing) {
  if (!(KEK in secrets) || secrets[KEK] !== 'generate' || stored[KEK]) return
  if (!existing.volume && !existing.container.exists) return
  if (ctx.flags['new-encryption-key']) return
  const path = join(host.dir, SECRETS_FILE)
  throw new InstallError(EXIT.PRECONDITION,
    `The data volume ${answers.name}-data on ${host.where} already holds a Slatebox, but ${path} has no SLATEBOX_KEY_ENCRYPTION_KEY for it. ` +
    'A new key would make every AI and call key people saved unreadable. Nothing was changed.\n' +
    `Put the original secrets.env back at ${path} (from where you backed it up, or from the home or user that installed it: --home <dir>), then run again. ` +
    'To start over with a new key and lose the saved keys, add --new-encryption-key.',
    { needs: 'encryption-key', path })
}

// ------------------------------------------------------------------ health

async function start(host, timeout) {
  const up = await host.compose(['up', '-d', '--wait', '--wait-timeout', String(timeout)], { timeout: (timeout + 120) * 1000 })
  return up.code === 0 ? { ok: true } : { ok: false, why: lastLine(up.stderr) || 'docker compose up failed' }
}

async function health(ctx, host, answers) {
  const deep = await host.docker(['exec', answers.name, SLATEBOX, 'health', '--deep', '--wait', '60'], { timeout: 120_000 })
  if (deep.code !== 0) return { ok: false, why: lastLine(deep.stderr) || 'slatebox health failed' }
  if (answers.address.team) return teamHealth(ctx, host, answers)
  // From outside, the way a browser asks.
  const url = `${answers.address.url}/readyz`
  let outside = false
  for (let attempt = 0; attempt < 10 && !outside; attempt++) {
    try {
      const response = await ctx.fetch(url, { signal: AbortSignal.timeout(5000) })
      outside = response.ok && (await response.json().catch(() => null))?.ok === true
    } catch { /* retry */ }
    if (!outside) await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!outside) {
    const why = `Slatebox is healthy inside the container, but ${url} does not answer from here.`
    if (host.kind === 'local' && answers.address.port !== null) return { ok: false, why }
    return { ok: true, warning: `${why} Check DNS, the firewall and that ports ${ports(answers).map(p => p.split(':')[0]).join('/')} are open.` }
  }
  return { ok: true }
}

/** The tunnel's connections, from inside the container; null when the image cannot say. */
export async function tunnelState(host, name, wait = 0) {
  const result = await host.docker(['exec', name, SLATEBOX, 'tunnel', '--json', ...(wait ? ['--wait', String(wait)] : [])], { timeout: (wait + 30) * 1000 })
  try { return JSON.parse(lastLine(result.stdout)) } catch { return null }
}

/**
 * A team address is healthy when the container's cloudflared holds connections and the address
 * answers from here through Cloudflare. A tunnel that is slow to come up is a warning, not a
 * rollback: Slatebox itself is healthy, and the tunnel keeps trying on its own.
 */
async function teamHealth(ctx, host, answers) {
  const tunnel = await tunnelState(host, answers.name, 60)
  if (tunnel?.ready) ctx.out.step('tunnel', 'ok', `Secure tunnel connected (${tunnel.connections} connection${tunnel.connections === 1 ? '' : 's'})`)
  // A refused tunnel stays down until it gets a new token: no point probing the address.
  if (tunnel?.state === 'failed') {
    return { ok: true, warning: `Slatebox is healthy on this computer, but Cloudflare refused its secure tunnel (a revoked token or a suspended address), so ${answers.address.url} does not reach it. See slatebox status and slatebox logs --service tunnel; slatebox address rotate gets a new token.` }
  }

  const url = `${answers.address.url}/readyz`
  const attempts = ctx.teamHealthAttempts ?? 30
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await ctx.fetch(url, { signal: AbortSignal.timeout(8000) })
      if (response.ok && (await response.json().catch(() => null))?.ok === true) {
        ctx.out.step('address', 'ok', `${answers.address.url} answers`)
        return { ok: true }
      }
    } catch { /* retry */ }
    if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, ctx.teamHealthDelay ?? 2000))
  }
  const why = tunnel?.ready ? `${answers.address.url} does not answer from here yet` : 'the secure tunnel has not connected yet'
  return { ok: true, warning: `Slatebox is healthy on this computer, but ${why}. It keeps trying by itself; check with slatebox status and slatebox logs --service tunnel.` }
}

async function startAndCheck(ctx, host, answers) {
  const started = await start(host, ctx.healthTimeout)
  if (!started.ok) return started
  return health(ctx, host, answers)
}

// ------------------------------------------------------------------ backups

function backupScript(ctx, host, answers, facts) {
  const to = answers.backups.to
  const s3 = to.startsWith('s3://')
  const dir = backupsDir(host, answers)
  const bucket = `${to.replace(/\/$/, '')}/`
  return `#!/bin/sh
# Written by the slatebox installer: one backup of the Slatebox "${answers.name}",
# keeping the last ${answers.backups.keep}. Run by ${host.kind === 'ssh' ? 'a systemd timer or cron' : usesLaunchd(ctx, host, answers) ? 'a launchd agent' : 'cron'}; safe to run by hand.
set -u
umask 077
docker=${shq(facts.docker_path || 'docker')}
stamp=$(date -u +%Y%m%d-%H%M%S)
${s3 ? `aws=${shq(facts.aws_path || 'aws')}
bucket=${shq(bucket)}
"$docker" exec ${shq(answers.name)} ${SLATEBOX} backup | "$aws" s3 cp - "$bucket"slatebox-"$stamp".gz || exit 1
echo "backup written to $bucket""slatebox-$stamp.gz (keep old ones with a bucket lifecycle rule)"` : `dir=${shq(dir)}
mkdir -p "$dir"
file="$dir/slatebox-$stamp.gz"
if "$docker" exec ${shq(answers.name)} ${SLATEBOX} backup > "$file.part"; then
  mv "$file.part" "$file"
  echo "backup written to $file"
else
  rm -f "$file.part"
  echo "the backup failed; earlier backups are kept" >&2
  exit 1
fi
ls -1t "$dir"/slatebox-*.gz 2>/dev/null | tail -n +${answers.backups.keep + 1} | while read -r old; do rm -f "$old"; done`}
`
}

const MARK = name => `# slatebox-installer:${name}`

// Every scheduler command gets this long. On macOS `crontab -` can wait for a permission prompt
// that a terminal never shows; nothing the installer runs after "healthy" may hang on it.
export const SCHEDULER_TIMEOUT_MS = 30_000

/** Why a scheduler command failed, in words: never an empty reason. */
function schedulerFailure(command, result, ctx) {
  if (result.code === 124) {
    const mac = (ctx.platform || process.platform) === 'darwin'
    return `${command} did not finish within ${(ctx.schedulerTimeout ?? SCHEDULER_TIMEOUT_MS) / 1000}s and was stopped${mac ? ' (macOS may be waiting for permission for your terminal to change the crontab)' : ''}`
  }
  if (result.code === 127) return `${command} is not installed on this computer`
  const said = lastLine(result.stderr) || lastLine(result.stdout)
  return `${command} exited with code ${result.code}${said ? `: ${said}` : ' without saying why'}`
}

const schedulerRun = (ctx, cmd, args, options = {}) => ctx.run(cmd, args, { ...options, timeout: ctx.schedulerTimeout ?? SCHEDULER_TIMEOUT_MS })

// ---- macOS: a launchd agent, not cron. It needs no permission prompt (cron's crontab does, and can
// block on it), and a run missed while the Mac sleeps happens when it wakes.
export const launchAgentLabel = name => `com.slatebox.${name}.backup`
export const launchAgentPath = (ctx, name) => join(ctx.env?.HOME || homedir(), 'Library', 'LaunchAgents', `${launchAgentLabel(name)}.plist`)

/** A cron schedule launchd can say (each field * or one number), as StartCalendarInterval keys; else null. */
export function launchdInterval(schedule) {
  const fields = String(schedule || '').trim().split(/\s+/)
  if (fields.length !== 5) return null
  const keys = ['Minute', 'Hour', 'Day', 'Month', 'Weekday']
  const out = {}
  for (const [i, field] of fields.entries()) {
    if (field === '*') continue
    if (!/^\d{1,2}$/.test(field)) return null
    out[keys[i]] = Number(field)
  }
  return 'Minute' in out ? out : null
}

const xml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function launchAgentText(label, script, log, interval) {
  const calendar = Object.entries(interval).map(([key, value]) => `      <key>${key}</key><integer>${value}</integer>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Written by the slatebox installer: the backup schedule of a Slatebox on this Mac. -->
<plist version="1.0">
  <dict>
    <key>Label</key><string>${xml(label)}</string>
    <key>ProgramArguments</key>
    <array><string>/bin/sh</string><string>${xml(script)}</string></array>
    <key>StartCalendarInterval</key>
    <dict>
${calendar}
    </dict>
    <key>StandardOutPath</key><string>${xml(log)}</string>
    <key>StandardErrorPath</key><string>${xml(log)}</string>
  </dict>
</plist>
`
}

/** Backups on this Mac go to launchd when the schedule fits it (a daily one always does). */
export const usesLaunchd = (ctx, host, answers) =>
  host.kind === 'local' && (ctx.platform || process.platform) === 'darwin' && Boolean(launchdInterval(answers.backups.schedule))

/** Take the installer's own cron line out, if there is one (an install from before launchd). Never writes a crontab otherwise. */
async function removeCronLine(ctx, name) {
  const listed = await schedulerRun(ctx, 'crontab', ['-l'])
  if (listed.code !== 0 || !listed.stdout.split('\n').some(line => line.endsWith(MARK(name)))) return false
  const others = listed.stdout.split('\n').filter(line => !line.endsWith(MARK(name)))
  while (others.length && others.at(-1) === '') others.pop()
  const written = await schedulerRun(ctx, 'crontab', ['-'], { input: others.length ? `${others.join('\n')}\n` : '' })
  if (written.code !== 0) throw new Error(schedulerFailure('crontab', written, ctx))
  return true
}

async function scheduleLaunchd(ctx, host, answers) {
  const label = launchAgentLabel(answers.name)
  const path = launchAgentPath(ctx, answers.name)
  const domain = `gui/${ctx.uid ?? process.getuid?.() ?? 501}`
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (answers.backups.to === 'off') {
    if (existing !== null) {
      await schedulerRun(ctx, 'launchctl', ['bootout', `${domain}/${label}`])
      rmSync(path, { force: true })
    }
    const cron = await removeCronLine(ctx, answers.name).catch(() => false)
    return existing !== null || cron ? 'removed' : 'unchanged'
  }
  const text = launchAgentText(label, join(host.dir, BACKUP_SCRIPT), join(host.dir, 'backup.log'), launchdInterval(answers.backups.schedule))
  const cron = await removeCronLine(ctx, answers.name).catch(() => false)
  if (existing === text && !cron) return 'unchanged'
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text, { mode: 0o644 })
  // Load it again so a changed schedule takes effect; "not loaded" from bootout is fine.
  await schedulerRun(ctx, 'launchctl', ['bootout', `${domain}/${label}`])
  const loaded = await schedulerRun(ctx, 'launchctl', ['bootstrap', domain, path])
  if (loaded.code !== 0) throw new Error(schedulerFailure('launchctl bootstrap', loaded, ctx))
  return `a launchd agent (${label}; a run missed while the Mac sleeps happens when it wakes)`
}

async function scheduleBackups(ctx, host, answers, facts) {
  const script = join(host.dir, BACKUP_SCRIPT)
  if (host.kind === 'local' && (ctx.platform || process.platform) === 'darwin' && (answers.backups.to === 'off' || usesLaunchd(ctx, host, answers))) {
    return scheduleLaunchd(ctx, host, answers)
  }
  if (host.kind === 'local') {
    const listed = await schedulerRun(ctx, 'crontab', ['-l'])
    if (listed.code === 124) throw new Error(schedulerFailure('crontab -l', listed, ctx))
    const current = listed.code === 0 ? listed.stdout : ''
    const lines = current.split('\n')
    const ours = lines.filter(line => line.endsWith(MARK(answers.name)))
    const want = answers.backups.to === 'off' ? [] : [`${answers.backups.schedule} /bin/sh ${shq(script)} >> ${shq(join(host.dir, 'backup.log'))} 2>&1 ${MARK(answers.name)}`]
    // Only the installer's own line is ever touched; the rest of the crontab stays byte for byte.
    if (ours.length === want.length && ours.every((line, i) => line === want[i])) return 'unchanged'
    const others = lines.filter(line => !line.endsWith(MARK(answers.name)))
    while (others.length && others.at(-1) === '') others.pop()
    const next = [...others, ...want].length ? `${[...others, ...want].join('\n')}\n` : ''
    const written = await schedulerRun(ctx, 'crontab', ['-'], { input: next })
    if (written.code !== 0) throw new Error(schedulerFailure('crontab', written, ctx))
    return answers.backups.to === 'off' ? 'removed' : 'cron'
  }
  const unit = `slatebox-${answers.name}-backup`
  const daily = /^(\d+) (\d+) \* \* \*$/.exec(answers.backups.schedule)
  if (answers.backups.to === 'off') {
    await host.sh(`systemctl disable --now ${unit}.timer 2>/dev/null; rm -f /etc/systemd/system/${unit}.service /etc/systemd/system/${unit}.timer /etc/cron.d/${unit}; systemctl daemon-reload 2>/dev/null; true`)
    return 'removed'
  }
  if (facts?.systemd === 'yes' && daily) {
    // ssh.dir is checked in answers.mjs (letters, digits, . _ - /), so the path needs no quoting here.
    const service = `[Unit]\nDescription=Back up Slatebox ${answers.name}\n\n[Service]\nType=oneshot\nExecStart=/bin/sh ${script}\n`
    const timer = `[Unit]\nDescription=Back up Slatebox ${answers.name} daily\n\n[Timer]\nOnCalendar=*-*-* ${daily[2].padStart(2, '0')}:${daily[1].padStart(2, '0')}:00\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`
    await host.writeFile(`/etc/systemd/system/${unit}.service`, service, 0o644)
    await host.writeFile(`/etc/systemd/system/${unit}.timer`, timer, 0o644)
    const enabled = await host.sh(`systemctl daemon-reload && systemctl enable --now ${unit}.timer`)
    if (enabled.code !== 0) throw new Error(`systemctl: ${lastLine(enabled.stderr)}`)
    return 'systemd timer'
  }
  await host.writeFile(`/etc/cron.d/${unit}`, `# Written by the slatebox installer\n${answers.backups.schedule} root /bin/sh ${shq(script)} >> ${shq(join(host.dir, 'backup.log'))} 2>&1\n`, 0o644)
  return facts?.cron === 'yes' ? 'cron' : 'cron (no cron daemon found: install cron for the schedule to run)'
}

// ------------------------------------------------------------------ apply

/**
 * Install, change or upgrade. Returns the done event's fields.
 * @param {object} options {record?: object, planOnly?: boolean, imageRef?: string, action?: 'install'|'upgrade'|'change'}
 */
export async function applyDocker(ctx, answers, options = {}) {
  refuseWindows(ctx)
  const host = hostFor(ctx, answers)
  try {
    return await applyOn(ctx, host, answers, options)
  } finally {
    await host.close?.()
  }
}

async function applyOn(ctx, host, answers, { record, planOnly = false, imageRef, archive, refresh = false }) {
  const { out } = ctx
  out.step('preflight', 'start', `Checking ${host.where}`)
  const facts = host.kind === 'ssh' ? await preflightSsh(ctx, host, answers) : await preflightLocal(ctx, host)
  const existing = facts.needsDocker
    ? { files: {}, container: { exists: false }, volume: false }
    : await existingState(host, answers)
  await checkPorts(host, answers, facts, existing)
  out.step('preflight', 'ok', `${host.where}: Docker ${facts.docker || facts.docker_server || '(to be installed)'}`)
  // Docker first, then the name: nobody claims a name on a machine that cannot run Slatebox.
  const team = answers.address.team ? await checkTeamAddress(ctx, answers) : null

  // The image. Before a yes, only what is already on the host is looked at:
  // nothing is pulled or loaded (an upgrade fetches its tag first, because
  // whether it is newer is the question the plan answers). An image that is not
  // here yet is planned with what it is known to accept (this release's pinned
  // image: its own list), and nothing is refused on a guess: after the yes it is
  // pulled and probed first, and only then checked, before any claim or file.
  const dockerMissing = host.kind === 'ssh' && facts.needsDocker
  const wanted = imageRef || answers.image || DEFAULT_IMAGE
  let image = { ref: wanted, pinned: wanted, id: null }
  let caps = archive ? FALLBACK_CAPABILITIES : knownCapabilities(wanted)
  let imageReady = false
  const ready = async () => {
    caps = await probeImage(host.docker, image.id)
    await checkCpu(host.docker, image.id)
    checkArch(image, facts.arch, host.where)
    imageReady = true
  }
  if (!dockerMissing && !archive) {
    if (refresh) await refreshTag(host.docker, wanted, out.step.bind(out))
    const info = await inspectImage(host.docker, wanted)
    if (info) {
      image = pinImage(wanted, info)
      await ready()
    }
  }

  const stored = { ...parseEnvFile(existing.files[KEPT_FILE] || ''), ...parseEnvFile(existing.files[SECRETS_FILE] || '') }
  let settings, composeText, settingsText, scriptText, secretsText, generated, kept
  const render = async () => {
    settings = settingsFor(answers, caps, { deferred: !imageReady })
    guardKey(ctx, host, answers, stored, settings.secrets, existing)
    composeText = renderCompose(answers, { image: image.pinned, hostGateway: settings.hostGateway })
    settingsText = envFileText(settings.env, `Settings for the Slatebox "${answers.name}", written by the slatebox installer. No secrets.`)
    scriptText = answers.backups.to === 'off' ? null : backupScript(ctx, host, answers, facts)
    // The key encryption key is made once and then kept; referenced keys are read now. Before
    // the plan is approved, a team address that is still to be claimed has no token: the plan
    // shows a stand-in, and nothing is written until the claim has brought the real one.
    const pending = team && !ctx.tunnelToken && !stored[TUNNEL_TOKEN]
    const secrets = await secretValues(pending ? { ...ctx, tunnelToken: PENDING_TOKEN } : ctx, settings.secrets, stored)
    generated = secrets.generated
    kept = Object.fromEntries(Object.entries(stored).filter(([name]) => !(name in secrets.values) && name === KEK))
    secretsText = envFileText(secrets.values, `Secrets for the Slatebox "${answers.name}". Keep a copy of SLATEBOX_KEY_ENCRYPTION_KEY with your backups.`)
  }
  await render()
  const previousImage = existing.container.image
  const changedFrom = () => Boolean(existing.container.exists && image.id && previousImage && previousImage !== image.id)
  let imageChanged = changedFrom()
  const secretsPath = join(host.dir, SECRETS_FILE)

  const changes = []
  if (!existing.container.exists) changes.push(existing.files[COMPOSE_FILE] ? 'start the stopped install again' : existing.volume ? `create the container on the existing data volume ${answers.name}-data` : 'create the container and its data volume')
  if (imageChanged) changes.push(`new image (${previousImage.slice(7, 19)} -> ${image.id.slice(7, 19)})`)
  if (!imageReady && existing.container.exists) changes.push(`the image ${archive ? `from ${archive}` : wanted}, if it differs from the running one`)
  if (existing.files[COMPOSE_FILE] !== null && existing.files[COMPOSE_FILE] !== undefined && existing.files[COMPOSE_FILE] !== composeText) changes.push(`${COMPOSE_FILE} changes`)
  if (existing.files[SETTINGS_FILE] !== null && existing.files[SETTINGS_FILE] !== undefined && existing.files[SETTINGS_FILE] !== settingsText) changes.push(`${SETTINGS_FILE} changes`)
  if (existing.container.exists && !existing.container.running) changes.push('start the stopped container')
  if (existing.files[SECRETS_FILE] && existing.files[SECRETS_FILE] !== secretsText) changes.push(`${SECRETS_FILE} changes (a key was added, removed or changed)`)
  if ((existing.files[BACKUP_SCRIPT] ?? null) !== scriptText) changes.push(scriptText ? 'backup schedule' : 'remove the backup schedule')

  const fresh = !existing.files[COMPOSE_FILE] && !existing.container.exists
  const nothing = imageReady && !fresh && !changes.length && existing.container.running && existing.container.health === 'healthy'
  const action = nothing ? 'nothing' : fresh ? 'install' : imageChanged || (!imageReady && refresh) ? 'upgrade' : 'change'
  const plan = emptyPlan({
    action, target: answers.target, name: answers.name, where: host.where, address: answers.address.url,
    image: { ref: image.ref, pinned: image.pinned, previous: previousImage },
    ports: ports(answers),
    secretsLocation: `${secretsPath} on ${host.where} (mode 0600${host.kind === 'ssh' ? ', root' : ''})`,
    warnings: [...settings.warnings], notes: [...settings.notes], changes: fresh ? [] : changes,
  })
  if (dockerMissing) {
    plan.commands.push(`install Docker Engine on ${host.where}: curl -fsSL https://get.docker.com | sh`)
    plan.warnings.push(`--install-docker runs Docker's install script from get.docker.com as root on ${host.where}, as it is on the day you run it (it is not pinned or checked by this installer). To install Docker yourself instead, see https://docs.docker.com/engine/install/ and run this again without --install-docker.`)
  }
  if (!imageReady) {
    plan.commands.push(archive ? `docker load < ${archive} (on ${host.where}, after you confirm)` : `docker pull ${wanted} (on ${host.where}, after you confirm)`)
    plan.notes.push(`${archive ? `The image is loaded from ${archive}` : `${wanted} is not on ${host.where} yet: it is downloaded`} after you confirm, and checked before anything is claimed, written or started. ${isPinnedImage(wanted) && !archive ? 'The plan uses the settings this release\'s image accepts.' : 'Until then the plan assumes the current image\'s settings.'}`)
    if (settings.unchecked.length) plan.notes.push(`Checked once the image is here: that it supports ${settings.unchecked.join(', ')}.`)
  }
  if (!nothing) {
    plan.files.push(
      { path: secretsPath, note: existing.files[SECRETS_FILE] ? 'kept; only changed keys are rewritten' : `new: SLATEBOX_KEY_ENCRYPTION_KEY${ctx.flags['new-encryption-key'] && existing.volume ? ' (a NEW key: keys saved with the old one become unreadable)' : ''} and any keys you referenced` },
      { path: join(host.dir, SETTINGS_FILE) }, { path: join(host.dir, COMPOSE_FILE) },
      ...(scriptText ? [{ path: join(host.dir, BACKUP_SCRIPT), note: `${answers.backups.schedule}, keeps ${answers.backups.keep}, into ${answers.backups.to.startsWith('s3://') ? answers.backups.to : backupsDir(host, answers)}` }] : []),
      { path: join(host.dir, 'install.yaml'), note: 'the install record, no secrets' },
    )
    if (imageChanged && existing.container.running) plan.commands.push(`back up first: ${join(backupsDir(host, answers), `pre-upgrade-${previousImage.slice(7, 19)}-${image.id.slice(7, 19)}.gz`)}`)
    if ((imageChanged || (!imageReady && existing.container.exists)) && !existing.container.running) {
      plan.warnings.push(`The container is not running, so no backup can be taken before the ${imageChanged ? 'upgrade' : 'change'}: if it fails there is no copy to roll the data back to. Take one yourself first if you have an older backup to restore from (slatebox restore <file>).`)
    }
    plan.commands.push(`docker compose -p ${answers.name} up -d --wait`, `docker exec ${answers.name} slatebox health --deep`)
    if (scriptText) {
      if (usesLaunchd(ctx, host, answers)) {
        plan.files.push({ path: launchAgentPath(ctx, answers.name), note: `the launchd agent that runs ${BACKUP_SCRIPT} (${answers.backups.schedule})` })
        plan.commands.push(`launchctl bootstrap gui/<you> ${launchAgentPath(ctx, answers.name)}`)
      } else plan.commands.push(host.kind === 'local' ? `crontab: ${answers.backups.schedule} ${join(host.dir, BACKUP_SCRIPT)}` : `systemd timer (or /etc/cron.d) slatebox-${answers.name}-backup`)
    }
    if (answers.address.port === null) plan.notes.push(`HTTPS: Slatebox gets and renews a certificate for ${new URL(answers.address.url).hostname} itself; point its DNS here and open ports 80 and 443.`)
    else if (answers.address.url.startsWith('http:') && host.kind === 'ssh') plan.warnings.push('Plain HTTP: anyone on the network path can read what people type. Give --domain for HTTPS.')
    if (host.kind === 'local' && answers.address.port !== null && ['0.0.0.0', '::'].includes(answers.address.listen)) {
      plan.warnings.push(`Published on every network interface (--listen ${answers.address.listen}) over plain HTTP: anyone who can reach this computer can open the first-account page, and Docker's port rules bypass firewalls such as ufw.`)
    }
    if (host.kind === 'local' && scriptText) {
      if (usesLaunchd(ctx, host, answers)) plan.notes.push('Backups run from a launchd agent (no permission prompt); a run missed while this Mac sleeps happens when it wakes. `slatebox status` says when the last backup is late.')
      else if ((ctx.platform || process.platform) === 'darwin') plan.notes.push('Backups run from cron, which skips a run while this computer sleeps; `slatebox status` says when the last backup is late.')
      if (ctx.env.WSL_DISTRO_NAME) plan.warnings.push('WSL usually has no cron daemon running: start it (sudo service cron start) or scheduled backups will not run.')
    }
    if (host.kind === 'ssh' && (facts.ufw === 'active' || facts.firewalld === 'running')) {
      plan.warnings.push(`A firewall (${facts.ufw === 'active' ? 'ufw' : 'firewalld'}) is on. Allow ${ports(answers).map(hostPort).join(', ')}/tcp yourself; the installer does not change firewall rules.`)
    }
  }
  if (team) {
    if (team.claim) {
      plan.notes.unshift(`After you confirm, you sign in to Slatebox in your browser to claim ${team.host} for your account. Slatebox Cloud then sets up its secure tunnel and sends this install the tunnel token.`)
      plan.files.push({ path: credentialsPath(ctx.home, answers.name), note: 'the team-address credential (mode 0600); it stays on this computer' })
    } else if (!stored[TUNNEL_TOKEN] && !nothing) {
      plan.notes.unshift(`The tunnel token for ${team.host} is fetched again from Slatebox Cloud with this computer's install credential.`)
    }
  }
  if (nothing) plan.notes.push('The running install already matches these answers.')
  ctx.emitPlan(plan)
  if (planOnly) return { planned: true, plan }
  if (nothing) {
    await saveRecord(ctx, host, answers, image, settings, caps, record, true)
    if (caps.commands.includes('setup-link')) await stillWaiting(ctx, args => host.docker(['exec', answers.name, SLATEBOX, ...args]))
    return done(ctx, host, answers, image, { nothing: true })
  }
  await ctx.confirm(plan)

  if (dockerMissing) {
    out.step('docker', 'start', `Installing Docker Engine on ${host.where} (get.docker.com)`)
    const installed = await host.remote(`${host.sudo}sh -c ${shq('curl -fsSL https://get.docker.com | sh')}`, { timeout: 20 * 60_000 })
    const check = await host.docker(['version', '--format', '{{.Server.Version}}'])
    if (installed.code !== 0 || check.code !== 0) throw new InstallError(EXIT.PRECONDITION, `Docker could not be installed or started on ${host.where}: ${lastLine(installed.stderr || check.stderr)}`)
    out.step('docker', 'ok', `Docker ${check.stdout.trim()} on ${host.where}`)
  }
  // The image first: nobody claims a name, and nothing is written, for an image that cannot be
  // had (offline) or that does not support what was asked for (render() refuses it now).
  if (!imageReady) {
    image = await resolveImage(host.docker, { ref: imageRef || answers.image, archive, loadArchive: host.loadArchive, step: out.step.bind(out) })
    await ready()
    await render()
    imageChanged = changedFrom()
    if (existing.container.exists && !imageChanged && previousImage === image.id && !changes.some(change => !change.startsWith('the image '))) {
      await saveRecord(ctx, host, answers, image, settings, caps, record, true)
      if (caps.commands.includes('setup-link')) await stillWaiting(ctx, args => host.docker(['exec', answers.name, SLATEBOX, ...args]))
      return done(ctx, host, answers, image, { nothing: true })
    }
  }
  if (team && !ctx.tunnelToken && !stored[TUNNEL_TOKEN]) {
    // The claim is kept if anything after this fails: the next run reuses it.
    await ensureTeamAddress(ctx, answers, team, stored)
    await render()
  }

  // Before an upgrade, a backup the rollback can restore.
  let preUpgrade = null
  if (imageChanged && existing.container.running) {
    preUpgrade = join(backupsDir(host, answers), `pre-upgrade-${previousImage.slice(7, 19)}-${image.id.slice(7, 19)}.gz`)
    out.step('backup', 'start', `Backing up before the upgrade to ${preUpgrade}`)
    const backup = await host.backupToFile(answers.name, preUpgrade)
    if (backup.code !== 0) throw new InstallError(EXIT.PRECONDITION, `The backup before the upgrade failed, so nothing was changed: ${lastLine(backup.stderr)}`)
    out.step('backup', 'ok', `Backed up to ${preUpgrade}`)
  }

  if (secretsText.includes(PENDING_TOKEN)) throw new Error('internal: the team address has no tunnel token yet')
  const previous = { ...existing.files }
  out.step('files', 'start', `Writing ${host.dir}`)
  await host.writeFile(join(host.dir, MARKER), `${answers.name}\n`, 0o600)
  await host.writeFile(secretsPath, secretsText, 0o600)
  if (Object.keys(kept).length) await host.writeFile(join(host.dir, KEPT_FILE), envFileText(kept, 'Kept from an earlier image that accepted them.'), 0o600)
  await host.writeFile(join(host.dir, SETTINGS_FILE), settingsText, 0o600)
  await host.writeFile(join(host.dir, COMPOSE_FILE), composeText, 0o600)
  if (scriptText) await host.writeFile(join(host.dir, BACKUP_SCRIPT), scriptText, 0o700)
  out.step('files', 'ok', `Wrote ${host.dir}`)

  out.step('start', 'start', `Starting Slatebox and waiting until it is healthy (up to ${ctx.healthTimeout}s)`)
  const result = await startAndCheck(ctx, host, answers)
  if (!result.ok) await rollback(ctx, host, answers, { fresh, previous, preUpgrade, why: result.why })
  if (result.warning) out.step('health', 'warn', result.warning)
  out.step('start', 'ok', answers.address.team ? `Slatebox is healthy on ${host.where}` : `Slatebox is healthy at ${answers.address.url}`)

  // The first admin comes from the image's one-time setup link; an image without one keeps the old advice.
  const inImage = args => host.docker(['exec', answers.name, SLATEBOX, ...args])
  const linked = caps.commands.includes('setup-link') && await firstAdmin(ctx, inImage)
  if (!linked && fresh) await firstAccount(ctx, host, answers, caps)
  // The address and the setup link are what the person waits for: they are printed now, before
  // the backup schedule, which only ever warns (and gives up after a timeout) if it cannot be set.
  ctx.announce?.(done(ctx, host, answers, image, { generated, fresh }))
  if (scriptText || previous[BACKUP_SCRIPT]) {
    try {
      const how = await scheduleBackups(ctx, host, answers, facts)
      if (how !== 'unchanged') out.step('backups', 'ok', answers.backups.to === 'off' ? 'Backup schedule removed' : `Daily backups by ${how}`)
    } catch (error) {
      out.step('backups', 'warn', `The backup schedule could not be set up (${error.message}). Run ${join(host.dir, BACKUP_SCRIPT)} from your own scheduler.`)
    }
  }
  await saveRecord(ctx, host, answers, image, settings, caps, record, false, previousImage)
  return done(ctx, host, answers, image, { generated, fresh })
}

async function rollback(ctx, host, answers, { fresh, previous, preUpgrade, why }) {
  const { out } = ctx
  out.step('start', 'fail', `Slatebox did not become healthy: ${why}`)
  if (fresh) {
    await host.compose(['stop'])
    throw new InstallError(EXIT.ROLLED_BACK, `Slatebox did not become healthy (${why}). It is stopped; its files and data volume are kept. See \`docker logs ${answers.name}\`${host.kind === 'ssh' ? ` on ${host.where}` : ''}, then run the installer again or \`slatebox uninstall --name ${answers.name}\`.`, {
      commands: [`docker logs ${answers.name}`, `npx slatebox uninstall --name ${answers.name}`],
    })
  }
  out.step('rollback', 'start', 'Putting the previous version back')
  for (const file of [SECRETS_FILE, SETTINGS_FILE, COMPOSE_FILE, BACKUP_SCRIPT]) {
    if (previous[file]) await host.writeFile(join(host.dir, file), previous[file], file === BACKUP_SCRIPT ? 0o700 : 0o600)
  }
  let back = await startAndCheck(ctx, host, answers)
  if (back.ok && preUpgrade) {
    // The new version may have changed the database before it failed: put back the copy taken just before.
    out.step('rollback', 'start', `Restoring the backup taken before the upgrade (${preUpgrade})`)
    const restored = await host.restoreFromFile(answers.name, preUpgrade)
    back = restored.code === 0 ? await health(ctx, host, answers) : { ok: false, why: lastLine(restored.stderr) }
  }
  const manual = [
    `cd ${shq(host.dir)} && docker compose -p ${answers.name} up -d`,
    ...(preUpgrade ? [`docker exec -i ${answers.name} slatebox restore < ${shq(preUpgrade)}`] : []),
    `docker logs ${answers.name}`,
  ]
  if (!back.ok) {
    throw new InstallError(EXIT.ROLLBACK_FAILED, `The change failed (${why}) and putting the previous version back failed too (${back.why}). Your data volume ${answers.name}-data is untouched${preUpgrade ? ` and ${preUpgrade} holds a backup from just before` : ''}. Run these${host.kind === 'ssh' ? ` on ${host.where}` : ''}:\n  ${manual.join('\n  ')}`, { commands: manual })
  }
  out.step('rollback', 'ok', 'The previous version is running again')
  throw new InstallError(EXIT.ROLLED_BACK, `The change failed (${why}), so the previous version was put back and is healthy.${preUpgrade ? ` Its data is as it was before the upgrade (${preUpgrade}).` : ''}`, { commands: [`docker logs ${answers.name}`] })
}

async function firstAccount(ctx, host, answers, caps) {
  if (!answers.adminEmail) {
    ctx.out.say(`\nOpen ${answers.address.url} and create the first account.`)
    return
  }
  if (caps.commands.includes('admin')) {
    const made = await host.docker(['exec', answers.name, SLATEBOX, 'admin', 'create', answers.adminEmail])
    if (made.code === 0 && made.stdout.trim()) {
      ctx.redactor.add(made.stdout.trim())
      if (ctx.tty && !ctx.json) {
        ctx.out.step('admin', 'ok', `Admin account ${answers.adminEmail} created; its one-time set-password link is printed below for this terminal only.`)
        ctx.stderr.write(`\n  Set your password: ${made.stdout.trim()}\n\n`)
      } else {
        // The link is a password: it never goes into JSON or a log. The person makes a fresh one at a terminal.
        ctx.out.step('admin', 'ok', `Admin account ${answers.adminEmail} created. To set its password, run this at a terminal and open the link it prints: ${host.kind === 'ssh' ? `ssh ${host.where} ` : ''}docker exec ${answers.name} slatebox password-link ${answers.adminEmail}`)
      }
      return
    }
  }
  ctx.out.say(`\nOpen ${answers.address.url} and create the first account with ${answers.adminEmail}.`)
  ctx.out.say(`If anyone loses their password later: ${host.kind === 'ssh' ? `ssh ${host.where} ` : ''}docker exec ${answers.name} slatebox password-link <email>`)
}

async function saveRecord(ctx, host, answers, image, settings, caps, record, unchanged, previousImage) {
  const now = new Date().toISOString()
  const next = {
    ...answers,
    image: image.ref,
    installedVersion: ctx.version,
    imageRef: image.ref,
    imageDigest: image.pinned,
    imageId: image.id,
    previousImageDigest: unchanged ? (record?.previousImageDigest ?? null) : (previousImage && previousImage !== image.id ? previousImage : record?.previousImageDigest ?? null),
    secretRefs: settings.secrets,
    secretsLocation: `${host.kind === 'ssh' ? `${host.where}:` : ''}${join(host.dir, SECRETS_FILE)}`,
    lastHealthy: now,
    installedAt: record?.installedAt || now,
    state: 'installed',
  }
  if (host.kind === 'ssh') await host.writeFile(join(host.dir, 'install.yaml'), recordText(next), 0o600)
  ctx.recordFile = writeRecord(ctx.home, next)
  ctx.record = next
  return ctx.recordFile
}

function done(ctx, host, answers, image, { nothing = false, generated = [], fresh = false } = {}) {
  const secretsFile = `${host.kind === 'ssh' ? `${host.where}:` : ''}${join(host.dir, SECRETS_FILE)}`
  return {
    address: answers.address.url, name: answers.name, target: answers.target, version: image.labels?.['org.opencontainers.image.version'] || null,
    imageDigest: image.pinned, installRecord: ctx.recordFile, secretsFile, nothingToChange: nothing,
    keyGenerated: generated.includes('SLATEBOX_KEY_ENCRYPTION_KEY'), fresh,
    ...(answers.address.team ? { teamAddress: answers.address.url, localAddress: `http://localhost:${answers.address.port}` } : {}),
  }
}

// ------------------------------------------------------------------ day two

/** How old a backup may get before status calls it late: a day and a bit for a daily schedule, else a week and a bit. */
export function backupLate(record, lastBackup, now = Date.now()) {
  if (record.backups.to === 'off' || record.backups.to.startsWith('s3://')) return null
  const match = /^slatebox-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.gz$/.exec(lastBackup || '')
  if (!match) return null
  const at = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6])
  const [, , dom, month, dow] = record.backups.schedule.split(' ')
  const allowed = (dom === '*' && month === '*' && dow === '*' ? 26 : 8 * 24) * 3600_000
  return { late: now - at > allowed, ageHours: Math.round((now - at) / 3600_000) }
}

export async function statusDocker(ctx, record) {
  refuseWindows(ctx)
  const host = hostFor(ctx, record)
  try {
    if (host.kind === 'ssh') {
      const probe = await host.remote(remoteSudoProbe())
      if (probe.stdout.includes('sudo')) host.sudo = 'sudo -n '
    }
    const inspected = await host.docker(['inspect', '--format', '{{json .State}}', record.name])
    const state = inspected.code === 0 ? JSON.parse(inspected.stdout) : null
    const version = state?.Running ? await host.docker(['exec', record.name, SLATEBOX, 'version']) : null
    let lastBackup = null
    if (host.kind === 'ssh') {
      const list = `ls -1t ${shq(backupsDir(host, record))} 2>/dev/null | grep '^slatebox-.*\\.gz$' | head -1`
      lastBackup = (await host.remote(`${host.sudo}sh -c ${shq(list)}`)).stdout.trim() || null
    } else {
      const dir = backupsDir(host, record)
      // File names carry the UTC time they were taken, so the newest sorts last.
      lastBackup = existsSync(dir) ? readdirSync(dir).filter(file => /^slatebox-\d{8}-\d{6}\.gz$/.test(file)).sort().pop() || null : null
    }
    const tunnel = record.address?.team && state?.Running ? await tunnelState(host, record.name) : null
    const setup = state?.Running ? await setupState(args => host.docker(['exec', record.name, SLATEBOX, ...args])) : null
    const age = backupLate(record, lastBackup)
    if (age?.late) ctx.out.warn(`The last backup is ${age.ageHours} hours old, older than the schedule "${record.backups.schedule}" allows. See ${join(host.dir, 'backup.log')}${host.kind === 'ssh' ? ` on ${host.where}` : ''}.`)
    return {
      name: record.name, target: record.target, where: host.where, address: record.address.url,
      running: Boolean(state?.Running), health: state?.Health?.Status || (state ? state.Status : 'missing'),
      version: version?.code === 0 ? JSON.parse(version.stdout) : null, imageDigest: record.imageDigest,
      ai: record.ai.mode === 'none' ? 'off' : record.ai.providers.map(provider => provider.id).join(', '),
      sso: record.sso.enabled ? (record.sso.only ? 'on (only)' : 'on') : 'off',
      lastBackup, backupLate: age ? age.late : null,
      ...(record.address?.team ? { tunnel } : {}),
      setup: setup ? (setup.setUp ? 'done' : 'waiting for the first admin') : null,
    }
  } finally {
    await host.close?.()
  }
}

const remoteSudoProbe = () => `[ "$(id -u)" = 0 ] && echo root || echo sudo`

async function withHost(ctx, record, fn) {
  refuseWindows(ctx)
  const host = hostFor(ctx, record)
  try {
    if (host.kind === 'ssh') {
      const probe = await host.remote(remoteSudoProbe())
      if (probe.code !== 0) throw new InstallError(EXIT.PRECONDITION, `Cannot reach ${host.where}: ${lastLine(probe.stderr)}`)
      if (probe.stdout.includes('sudo')) host.sudo = 'sudo -n '
    }
    return await fn(host)
  } finally {
    await host.close?.()
  }
}

export function backupDocker(ctx, record, { to }) {
  return withHost(ctx, record, async host => {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
    if (to) {
      const file = join(to.startsWith('/') ? to : join(process.cwd(), to), `slatebox-${stamp}.gz`)
      const { mkdirSync, rmSync } = await import('node:fs')
      mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 })
      const result = await host.docker(['exec', record.name, SLATEBOX, 'backup'], { outputFile: file, timeout: 60 * 60_000 })
      if (result.code !== 0) { rmSync(file, { force: true }); throw new InstallError(EXIT.PRECONDITION, `The backup failed: ${lastLine(result.stderr)}`) }
      return { file, where: 'this computer' }
    }
    const file = join(backupsDir(host, record), `slatebox-${stamp}.gz`)
    const result = await host.backupToFile(record.name, file)
    if (result.code !== 0) throw new InstallError(EXIT.PRECONDITION, `The backup failed: ${lastLine(result.stderr)}`)
    return { file, where: host.where }
  })
}

export function restoreDocker(ctx, record, archive) {
  return withHost(ctx, record, async host => {
    const result = await host.restoreFromLocal(record.name, archive)
    if (result.code !== 0) throw new InstallError(EXIT.PRECONDITION, `The restore failed: ${lastLine(result.stderr)}`)
    return { restored: archive }
  })
}

export function uninstallDocker(ctx, record, { deleteData }) {
  return withHost(ctx, record, async host => {
    if (deleteData && host.kind === 'ssh') {
      // Only a folder this installer made for this install, and only its own files in it.
      const marker = await host.readMarker()
      if (marker !== record.name) {
        throw new InstallError(EXIT.PRECONDITION, `${host.dir} on ${host.where} has no ${MARKER} naming "${record.name}", so the installer will not delete anything in it. Nothing was changed. Remove the container, the volume ${record.name}-data and the files yourself if this really is the install.`)
      }
    }
    const down = await host.compose(['down'])
    if (down.code !== 0 && !/no such file|not found|no configuration/i.test(down.stderr)) {
      await host.docker(['rm', '-f', record.name])
    }
    const removed = { ...record, backups: { ...record.backups, to: 'off' } }
    try { await scheduleBackups(ctx, host, removed, { systemd: 'yes' }) } catch { /* nothing scheduled */ }
    if (deleteData) {
      const volume = await host.docker(['volume', 'rm', `${record.name}-data`])
      if (volume.code !== 0 && !/no such volume/i.test(volume.stderr)) throw new InstallError(EXIT.PRECONDITION, `The data volume could not be removed: ${lastLine(volume.stderr)}`)
      const defaultBackups = record.backups.to === 'default' || record.backups.to === 'off' || record.backups.to.startsWith('s3://')
      await host.removeInstall({ backups: defaultBackups ? join(host.dir, 'backups') : null })
      return { dataDeleted: true }
    }
    return { dataDeleted: false, volume: `${record.name}-data`, secretsFile: join(host.dir, SECRETS_FILE) }
  })
}

// The services' log lines carry their name: [app], [relay], [mongo], [proxy], [tunnel], [sso], [slatebox].
export const LOG_SERVICES = ['app', 'relay', 'mongo', 'proxy', 'tunnel', 'sso', 'slatebox']

/** docker logs for the install, optionally only one service's lines, optionally following. */
export function logsDocker(ctx, record, { follow = false, service, since } = {}) {
  return withHost(ctx, record, async host => {
    const args = ['logs', ...(since ? ['--since', since] : []), ...(follow ? ['--follow'] : ['--tail', '500']), record.name]
    const keep = line => !service || line.startsWith(`[${service}] `) || (service === 'sso' && line.startsWith('[sso-setup] '))
    const write = text => {
      for (const line of text.split('\n')) if (line && keep(line)) ctx.stdout.write(`${ctx.redactor.redact(line)}\n`)
    }
    if (follow) {
      if (host.kind !== 'local') throw new InstallError(EXIT.USAGE, `Following logs on ${host.where}: ssh ${host.where} ${host.sudo || ''}docker logs -f ${record.name}`)
      // Streamed as it comes, each line through the redactor, until Ctrl-C.
      const { spawn } = await import('node:child_process')
      return new Promise(resolve => {
        const child = (ctx.spawn || spawn)('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
        let rest = ''
        const onData = chunk => {
          const text = rest + chunk
          const cut = text.lastIndexOf('\n')
          rest = cut < 0 ? text : text.slice(cut + 1)
          if (cut >= 0) write(text.slice(0, cut))
        }
        child.stdout.on('data', onData)
        child.stderr.on('data', onData)
        child.on('error', () => resolve({ lines: false }))
        child.on('close', () => { if (rest) write(rest); resolve({ lines: true }) })
      })
    }
    const result = await host.docker(args, { timeout: 120_000 })
    if (result.code !== 0) throw new InstallError(EXIT.PRECONDITION, `docker logs failed: ${lastLine(result.stderr)}`)
    // docker logs puts the container's stdout and stderr on its own two streams.
    write(`${result.stdout}${result.stderr}`)
    return { lines: true }
  })
}

/** Run a script inside the container with node, the script on standard input (never in the arguments). */
export function execNode(ctx, record, script, args = []) {
  return withHost(ctx, record, host => host.docker(['exec', '-i', record.name, 'node', '--input-type=module', '-', ...args], { input: script, timeout: 120_000 }))
}

/** A fresh one-time setup link from the install's container (setup-link.mjs makeSetupLink). */
export function setupLinkDocker(ctx, record) {
  return withHost(ctx, record, host => makeSetupLink(ctx, args => host.docker(['exec', record.name, SLATEBOX, ...args])))
}

export function readSecretDocker(ctx, record, name) {
  return withHost(ctx, record, async host => parseEnvFile(await host.readFile(join(host.dir, SECRETS_FILE)) || '')[name])
}
