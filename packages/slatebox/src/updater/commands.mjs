// `slatebox updates`: automatic updates from GitHub releases, from the computer that installed it.
//
//   slatebox updates                    what this server runs, what is available, what happens next
//   slatebox updates enable             put the host updater in place (updater.sh, every five minutes)
//   slatebox updates disable            take it away (Slatebox then only tells admins about releases)
//   slatebox updates check              read the signed feed now
//   slatebox updates apply [--to X.Y.Z] update now (the newest release, or that one), then run the updater
//   slatebox updates auto on|off        turn automatic applying on or off (Admin › Updates says the same)
//   slatebox updates run                run the host updater once now
//
// The schedule, the policy and the history live on the server; this only sets up the host side and
// asks the container (docker exec), the same way updater.sh does.
import { join } from 'node:path'
import { EXIT, InstallError } from '../errors.mjs'
import { writeRecord } from '../record.mjs'
import { shq } from '../runner.mjs'
import { backupsDir, hostFor } from '../targets/docker.mjs'
import { which } from '../targets/hosts.mjs'
import { DOCKER_SOCKET, LOCK_DIR, SLATEBOX_BIN, UPDATER_SCRIPT, updaterScript } from './host-script.mjs'
import { withUpdateLock } from './lock.mjs'
import { hostFeedUrl } from './run.mjs'
import { removeUpdater, scheduleUpdater, schedulerFor } from './schedule.mjs'

export const UPDATES_USAGE = 'updates [enable | disable | check | apply [--to X.Y.Z] | auto on|off | run]'
const last = text => String(text || '').trim().split('\n').filter(Boolean).pop() || ''

/** A Docker host for the record, with sudo found on a server (as targets/docker.mjs withHost does). */
async function openHost(ctx, record) {
  const host = hostFor(ctx, record)
  if (host.kind === 'ssh') {
    const probe = await host.remote(`[ "$(id -u)" = 0 ] && echo root || echo sudo`)
    if (probe.code !== 0) { await host.close?.(); throw new InstallError(EXIT.PRECONDITION, `Cannot reach ${host.where}: ${last(probe.stderr)}`) }
    if (probe.stdout.includes('sudo')) host.sudo = 'sudo -n '
  }
  return host
}

async function withRecordHost(ctx, record, fn) {
  if (record.target === 'k8s' || record.target === 'export') {
    throw new InstallError(EXIT.USAGE, record.target === 'k8s'
      ? `"${record.name}" runs on Kubernetes. Admin › Updates tells you about each release and shows the exact upgrade command (npx slatebox upgrade --name ${record.name} --to <image>); automatic applying on Kubernetes comes later.`
      : `"${record.name}" is files only (--target export): nothing runs for the updater to update.`)
  }
  const host = await openHost(ctx, record)
  try { return await fn(host) } finally { await host.close?.() }
}

/** Does the running image have `slatebox updates`? (2.1.0 on.) */
export async function imageHasUpdates(host, name) {
  const said = await host.docker(['exec', name, SLATEBOX_BIN, 'settings', '--json'])
  if (said.code !== 0) return false
  try { return JSON.parse(last(said.stdout)).commands?.includes('updates') === true } catch { return false }
}

/**
 * The Docker socket the updater container gets, on a Linux host: the one the docker CLI talks to
 * (rootless Docker's is under $XDG_RUNTIME_DIR). Podman, or a Docker reached over TCP or SSH, has
 * no socket the updater can drive this way: refused with what to do instead.
 */
export async function dockerSocket(host, record) {
  const upgrade = `npx slatebox upgrade${record.name === 'slatebox' ? '' : ` --name ${record.name}`}`
  const platform = await host.docker(['version', '--format', '{{.Server.Platform.Name}}'])
  if (/podman/i.test(`${platform.stdout} ${platform.stderr}`)) {
    throw new InstallError(EXIT.PRECONDITION, `Automatic updates need Docker Engine: the host updater drives Docker through its socket, and this host runs Podman. Update by hand with ${upgrade} (Admin › Updates tells you about each release), or move to Docker Engine.`)
  }
  const context = await host.docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
  const endpoint = context.code === 0 ? String(context.stdout).trim() : ''
  if (!endpoint) return DOCKER_SOCKET
  if (!endpoint.startsWith('unix://')) {
    throw new InstallError(EXIT.PRECONDITION, `Automatic updates need Docker's own socket on this host, and docker talks to ${endpoint}. Update by hand with ${upgrade}, or run the installer where Docker runs.`)
  }
  return endpoint.slice('unix://'.length) || DOCKER_SOCKET
}

/** How updater.sh should run on this host. */
export async function scriptOptions(ctx, host, record, { feedUrl = null } = {}) {
  const mac = host.kind === 'local' && (ctx.platform || process.platform) === 'darwin'
  // On a Mac the socket is the Docker VM's own, at the usual path inside it.
  const socket = mac ? DOCKER_SOCKET : await dockerSocket(host, record)
  let docker = 'docker'
  let facts = {}
  if (host.kind === 'local') docker = which('docker', ctx.env.PATH) || 'docker'
  else {
    const probe = await host.sh('command -v docker; [ -d /run/systemd/system ] && echo systemd=yes || echo systemd=no; [ -d /etc/cron.d ] && echo cron=yes || echo cron=no')
    const lines = String(probe.stdout).split('\n').map(line => line.trim()).filter(Boolean)
    docker = lines.find(line => line.startsWith('/')) || 'docker'
    facts = { systemd: lines.includes('systemd=yes') ? 'yes' : 'no', cron: lines.includes('cron=yes') ? 'yes' : 'no' }
  }
  const keep = backupsDir(host, record)
  const port = record.address?.port
  return {
    facts,
    options: {
      name: record.name, dir: host.dir, docker,
      backups: keep.startsWith(`${host.dir}/`) || keep === host.dir ? null : keep,
      hostNetwork: !mac,
      outsideUrl: mac && port ? `http://host.docker.internal:${port}` : null,
      feedUrl: feedUrl || record.updates?.feedUrl || null,
      scheduler: schedulerFor(ctx, host, facts),
      // Rootless Docker (its own socket) maps the container's root to the folder's owner already.
      socket, asOwner: !mac && socket === DOCKER_SOCKET,
    },
  }
}

/** Put the host updater in place. → { scheduler, how } */
export async function enableUpdater(ctx, record, { feedUrl = null, quiet = false } = {}) {
  return withRecordHost(ctx, record, async host => {
    if (!(await imageHasUpdates(host, record.name))) {
      throw new InstallError(EXIT.PRECONDITION, `The image "${record.name}" runs has no automatic updates yet (they came with 2.1.0). Run slatebox upgrade${record.name === 'slatebox' ? '' : ` --name ${record.name}`} first (npx slatebox@latest upgrade: it sets up the host updater too).`)
    }
    if (feedUrl) {
      try { hostFeedUrl(feedUrl) } catch (error) { throw new InstallError(EXIT.USAGE, `--feed-url: ${error.message}`) }
    }
    const { facts, options } = await scriptOptions(ctx, host, record, { feedUrl })
    const scheduled = await scheduleUpdater(ctx, host, record, updaterScript(options), { facts })
    // Check in now, so Admin › Updates shows the updater at once (and reads the feed).
    await host.docker(['exec', record.name, SLATEBOX_BIN, 'updates', 'heartbeat', '--updater', '1', '--scheduler', scheduled.scheduler, ...(options.feedUrl ? ['--feed-url', options.feedUrl] : [])])
    writeRecord(ctx.home, { ...record, updates: { enabled: true, scheduler: scheduled.scheduler, ...(options.feedUrl ? { feedUrl: options.feedUrl } : {}) } })
    if (!quiet) ctx.out.step('updates', 'ok', `Automatic updates: the host updater runs by ${scheduled.how}. Choose when updates are applied in Admin › Updates.`)
    // A server with data from before the updater only tells admins about releases: say how to turn applying on.
    const said = await host.docker(['exec', record.name, SLATEBOX_BIN, 'updates', 'status', '--json'], { timeout: 120_000 })
    let auto = null
    try { auto = said.code === 0 ? JSON.parse(last(said.stdout)).policy?.auto ?? null : null } catch { auto = null }
    if (auto === false) {
      scheduled.next = `Updates are not applied by themselves yet on this server (it had data before). Turn that on in Admin › Updates, or run: npx slatebox updates auto on${record.name === 'slatebox' ? '' : ` --name ${record.name}`}`
      if (!quiet) ctx.out.say(scheduled.next)
    }
    return scheduled
  })
}

/** After a successful install or upgrade: the updater too, unless --no-auto-updates (only warns). */
export async function ensureUpdater(ctx, record, flags = {}) {
  if (!record || flags['auto-updates'] === false || record.target === 'k8s' || record.target === 'export') return null
  if (record.updates?.enabled === false && flags['auto-updates'] !== true) return null
  try {
    return await enableUpdater(ctx, record, { feedUrl: flags['feed-url'] || null })
  } catch (error) {
    if (error instanceof InstallError && error.exitCode === EXIT.PRECONDITION && /no automatic updates yet/.test(error.message)) {
      ctx.out.step('updates', 'warn', `This image has no automatic updates yet (they come with 2.1.0), so no host updater was set up. To get them: npx slatebox@latest upgrade${record.name === 'slatebox' ? '' : ` --name ${record.name}`}`)
      return null
    }
    ctx.out.step('updates', 'warn', `The host updater could not be set up (${error.message}). Run slatebox updates enable to try again.`)
    return null
  }
}

/** For `slatebox upgrade`: never beside a running automatic update (the same lock as updater.sh). */
export async function withRecordLock(ctx, record, fn) {
  if (record.target === 'k8s' || record.target === 'export') return fn()
  const host = await openHost(ctx, record)
  try {
    return await withUpdateLock(host, fn)
  } finally {
    await host.close?.()
  }
}

async function inContainer(host, record, args) {
  const result = await host.docker(['exec', record.name, SLATEBOX_BIN, 'updates', ...args], { timeout: 120_000 })
  if (result.code !== 0) throw new InstallError(EXIT.PRECONDITION, last(result.stderr) || `slatebox updates ${args[0]} failed in the container (is "${record.name}" running an image from 2.1.0 on? slatebox upgrade)`)
  return result.stdout
}

const runNow = (host, record) => host.sh(`/bin/sh ${shq(join(host.dir, UPDATER_SCRIPT))}`, { timeout: 60 * 60_000 })

export async function updatesCommand(ctx, record, sub, rest, flags) {
  const say = text => (ctx.json ? null : ctx.out.say(text))
  switch (sub ?? 'status') {
    case 'status':
      return withRecordHost(ctx, record, async host => {
        const status = JSON.parse(last(await inContainer(host, record, ['status', '--json'])))
        ctx.out.event({ event: 'done', name: record.name, ...status, hostUpdater: record.updates?.enabled ? record.updates.scheduler : 'off' })
        say(`Version     ${status.current || 'unknown'}`)
        say(`Newest      ${status.available || 'not checked yet'}`)
        say(`Applying    ${status.mode === 'off' ? 'off (SLATEBOX_UPDATES=off)' : status.policy?.auto && status.mode === 'auto' ? `automatic (${status.policy.channel}), ${status.policy.window.start} for ${status.policy.window.hours}h, ${status.policy.timeZone}` : 'notify only'}`)
        say(`Next        ${status.words}`)
        say(`Updater     ${status.updater ? `checked in ${status.updater.at} (${status.updater.scheduler})` : `not set up: slatebox updates enable${record.name === 'slatebox' ? '' : ` --name ${record.name}`}`}`)
        if (status.lastAttempt) say(`Last        ${status.lastAttempt.outcome} ${status.lastAttempt.from || '?'} -> ${status.lastAttempt.target || 'previous'} (${status.lastAttempt.at})`)
        return 0
      })
    case 'enable': {
      const scheduled = await enableUpdater(ctx, record, { feedUrl: flags['feed-url'] || null, quiet: true })
      ctx.out.event({ event: 'done', name: record.name, updater: scheduled.scheduler })
      say(`Automatic updates are set up: the host updater runs by ${scheduled.how}.`)
      say('Choose when updates are applied (or turn applying off) in Admin › Updates.')
      if (scheduled.next) say(scheduled.next)
      return 0
    }
    case 'disable':
      return withRecordHost(ctx, record, async host => {
        const removed = await removeUpdater(ctx, host, record)
        writeRecord(ctx.home, { ...record, updates: { ...(record.updates || {}), enabled: false } })
        ctx.out.event({ event: 'done', name: record.name, removed })
        say(`The host updater is off for "${record.name}". Admins still see new releases in Admin › Updates. Turn it on again: slatebox updates enable${record.name === 'slatebox' ? '' : ` --name ${record.name}`}`)
        return 0
      })
    case 'check':
      return withRecordHost(ctx, record, async host => {
        say(last(await inContainer(host, record, ['check'])))
        return 0
      })
    case 'auto': {
      const value = rest[0]
      if (!['on', 'off'].includes(value)) throw new InstallError(EXIT.USAGE, 'Usage: slatebox updates auto on|off')
      return withRecordHost(ctx, record, async host => {
        await inContainer(host, record, ['auto', value])
        say(value === 'on' ? 'Updates are applied automatically in the window set in Admin › Updates.' : 'Updates are no longer applied automatically. Admins are still told about each release.')
        return 0
      })
    }
    case 'apply':
    case 'run':
      return withRecordHost(ctx, record, async host => {
        if (sub === 'apply') await inContainer(host, record, ['request', 'apply', ...(flags.to ? ['--version', flags.to] : [])])
        if (!record.updates?.enabled) {
          ctx.out.event({ event: 'done', name: record.name, requested: sub === 'apply', ran: false, hostUpdater: 'off' })
          say(`Asked for. The host updater is not set up, so nothing runs it yet: slatebox updates enable${record.name === 'slatebox' ? '' : ` --name ${record.name}`}`)
          return 0
        }
        const busy = await host.sh(`[ -d ${shq(join(host.dir, LOCK_DIR))} ] && echo busy || true`)
        if (String(busy.stdout).includes('busy')) {
          ctx.out.event({ event: 'done', name: record.name, ran: false, running: true })
          say('The host updater is running already (its schedule started it). See slatebox updates in a few minutes.')
          return 0
        }
        say('Running the host updater now (Slatebox is unavailable for 1-3 minutes while it restarts, if there is an update).')
        const result = await runNow(host, record)
        const status = JSON.parse(last(await inContainer(host, record, ['status', '--json'])))
        ctx.out.event({ event: 'done', name: record.name, exitCode: result.code, lastAttempt: status.lastAttempt })
        say(status.lastAttempt ? `Last attempt: ${status.lastAttempt.outcome} (${status.lastAttempt.detail || ''})` : status.words)
        return result.code === 0 ? 0 : EXIT.PRECONDITION
      })
    default:
      throw new InstallError(EXIT.USAGE, `Unknown: slatebox updates ${sub}. Usage: slatebox ${UPDATES_USAGE}`)
  }
}
