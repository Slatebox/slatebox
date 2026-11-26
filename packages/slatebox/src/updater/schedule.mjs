// The schedule that runs updater.sh every five minutes: a launchd agent on a Mac, a systemd timer
// on a Linux server (cron where there is no systemd), a cron line on this Linux computer. A copy
// of the backup schedule's rules, kept apart from it (targets/docker.mjs scheduleBackups): only
// the installer's own entry is ever touched, marked with its own tag.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { shq } from '../runner.mjs'
import { HOST_SCRIPT_OPTIONS, UPDATER_SCRIPT, UPDATES_DIR } from './host-script.mjs'

export const INTERVAL_SECONDS = 300
export const updaterLabel = name => `com.slatebox.${name}.updater`
export const updaterAgentPath = (ctx, name) => join(ctx.env?.HOME || homedir(), 'Library', 'LaunchAgents', `${updaterLabel(name)}.plist`)
export const updaterUnit = name => `slatebox-${name}-updater`
export const CRON_MARK = name => `# slatebox-installer-updater:${name}`
const TIMEOUT = 30_000
const run = (ctx, cmd, args, options = {}) => ctx.run(cmd, args, { ...options, timeout: ctx.schedulerTimeout ?? TIMEOUT })
const xml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const last = text => String(text || '').trim().split('\n').filter(Boolean).pop() || ''

/** Which scheduler runs the updater on this host. */
export function schedulerFor(ctx, host, facts = {}) {
  if (host.kind === 'local') return (ctx.platform || process.platform) === 'darwin' ? 'launchd' : 'cron'
  return facts.systemd === 'yes' ? 'systemd' : 'cron'
}

export function updaterAgentText(label, script, log) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Written by the slatebox installer: automatic updates of a Slatebox on this Mac (every five minutes). -->
<plist version="1.0">
  <dict>
    <key>Label</key><string>${xml(label)}</string>
    <key>ProgramArguments</key>
    <array><string>/bin/sh</string><string>${xml(script)}</string></array>
    <key>StartInterval</key><integer>${INTERVAL_SECONDS}</integer>
    <key>RunAtLoad</key><true/>
    <key>StandardOutPath</key><string>${xml(log)}</string>
    <key>StandardErrorPath</key><string>${xml(log)}</string>
  </dict>
</plist>
`
}

export const systemdService = (name, script) => `[Unit]\nDescription=Automatic updates for Slatebox ${name}\nAfter=docker.service\n\n[Service]\nType=oneshot\nExecStart=/bin/sh ${script}\n`
export const systemdTimer = name => `[Unit]\nDescription=Check for Slatebox ${name} updates every five minutes\n\n[Timer]\nOnCalendar=*:0/5\nRandomizedDelaySec=30\nPersistent=false\n\n[Install]\nWantedBy=timers.target\n`
export const cronLine = (name, script, log) => `*/5 * * * * /bin/sh ${shq(script)} >> ${shq(log)} 2>&1 ${CRON_MARK(name)}`
export const cronFile = (name, script, log) => `# Written by the slatebox installer: automatic updates for Slatebox ${name}\n*/5 * * * * root /bin/sh ${shq(script)} >> ${shq(log)} 2>&1\n`

/** Only the installer's own updater line changes; the rest of the crontab stays byte for byte. */
export function nextCrontab(current, name, line) {
  const lines = String(current || '').split('\n')
  const others = lines.filter(item => !item.endsWith(CRON_MARK(name)))
  while (others.length && others.at(-1) === '') others.pop()
  const all = [...others, ...(line ? [line] : [])]
  return all.length ? `${all.join('\n')}\n` : ''
}

/** Write updater.sh and schedule it. → a few words on how it runs. */
export async function scheduleUpdater(ctx, host, record, scriptText, { facts = {} } = {}) {
  const script = join(host.dir, UPDATER_SCRIPT)
  const log = join(host.dir, UPDATES_DIR, 'updater.log')
  await host.writeFile(script, scriptText, 0o700)
  const kind = schedulerFor(ctx, host, facts)
  if (kind === 'launchd') {
    const label = updaterLabel(record.name)
    const path = updaterAgentPath(ctx, record.name)
    const domain = `gui/${ctx.uid ?? process.getuid?.() ?? 501}`
    mkdirSync(join(host.dir, UPDATES_DIR), { recursive: true, mode: 0o700 })
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, updaterAgentText(label, script, log), { mode: 0o644 })
    await run(ctx, 'launchctl', ['bootout', `${domain}/${label}`])
    const loaded = await run(ctx, 'launchctl', ['bootstrap', domain, path])
    if (loaded.code !== 0) throw new Error(`launchctl bootstrap failed: ${last(loaded.stderr) || `exit ${loaded.code}`}`)
    return { scheduler: 'launchd', how: `a launchd agent (${label}), every five minutes` }
  }
  if (kind === 'cron' && host.kind === 'local') {
    const listed = await run(ctx, 'crontab', ['-l'])
    if (listed.code === 124) throw new Error('crontab -l did not finish in time')
    const next = nextCrontab(listed.code === 0 ? listed.stdout : '', record.name, cronLine(record.name, script, log))
    const written = await run(ctx, 'crontab', ['-'], { input: next })
    if (written.code !== 0) throw new Error(`crontab failed: ${last(written.stderr) || `exit ${written.code}`}`)
    return { scheduler: 'cron', how: 'cron, every five minutes' }
  }
  const unit = updaterUnit(record.name)
  if (kind === 'systemd') {
    await host.writeFile(`/etc/systemd/system/${unit}.service`, systemdService(record.name, script), 0o644)
    await host.writeFile(`/etc/systemd/system/${unit}.timer`, systemdTimer(record.name), 0o644)
    const enabled = await host.sh(`systemctl daemon-reload && systemctl enable --now ${unit}.timer`)
    if (enabled.code !== 0) throw new Error(`systemctl: ${last(enabled.stderr)}`)
    return { scheduler: 'systemd', how: `a systemd timer (${unit}.timer), every five minutes` }
  }
  await host.writeFile(`/etc/cron.d/${unit}`, cronFile(record.name, script, log), 0o644)
  return { scheduler: 'cron', how: facts.cron === 'yes' ? 'cron, every five minutes' : 'cron (no cron daemon found: install cron for updates to run)' }
}

/** Take the updater's schedule and script away (uninstall, `slatebox updates disable`). Never fails on "not there". */
export async function removeUpdater(ctx, host, record) {
  const removed = []
  if (host.kind === 'local') {
    if ((ctx.platform || process.platform) === 'darwin') {
      const path = updaterAgentPath(ctx, record.name)
      if (existsSync(path)) {
        await run(ctx, 'launchctl', ['bootout', `gui/${ctx.uid ?? process.getuid?.() ?? 501}/${updaterLabel(record.name)}`])
        rmSync(path, { force: true })
        removed.push('launchd agent')
      }
    }
    const listed = await run(ctx, 'crontab', ['-l']).catch(() => ({ code: 1 }))
    if (listed.code === 0 && listed.stdout.split('\n').some(line => line.endsWith(CRON_MARK(record.name)))) {
      const written = await run(ctx, 'crontab', ['-'], { input: nextCrontab(listed.stdout, record.name, null) })
      if (written.code === 0) removed.push('cron line')
    }
    const script = join(host.dir, UPDATER_SCRIPT)
    if (existsSync(script)) { rmSync(script, { force: true }); removed.push(UPDATER_SCRIPT) }
    rmSync(`${script}.prev`, { force: true })
    rmSync(join(host.dir, HOST_SCRIPT_OPTIONS), { force: true })
    return removed
  }
  const unit = updaterUnit(record.name)
  await host.sh(`systemctl disable --now ${unit}.timer 2>/dev/null; rm -f /etc/systemd/system/${unit}.service /etc/systemd/system/${unit}.timer /etc/cron.d/${unit} ${shq(join(host.dir, UPDATER_SCRIPT))} ${shq(join(host.dir, `${UPDATER_SCRIPT}.prev`))} ${shq(join(host.dir, HOST_SCRIPT_OPTIONS))}; systemctl daemon-reload 2>/dev/null; true`)
  return ['systemd timer or cron file', UPDATER_SCRIPT]
}

/** Whether this computer's updater schedule is in place (launchd or cron); null when it cannot tell (a server). */
export function localUpdaterScheduled(ctx, record) {
  if ((ctx.platform || process.platform) === 'darwin') return existsSync(updaterAgentPath(ctx, record.name))
  return null
}

export const readText = path => (existsSync(path) ? readFileSync(path, 'utf8') : null)
