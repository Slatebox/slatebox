// The host updater's files: updater.sh, the launchd agent, the systemd service and timer, the cron
// line, each against a golden file (SLATEBOX_UPDATE_GOLDEN=1 rewrites them). Only the installer's
// own cron line is ever touched.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { updaterScript } from '../src/updater/host-script.mjs'
import { CRON_MARK, cronFile, cronLine, nextCrontab, systemdService, systemdTimer, updaterAgentText } from '../src/updater/schedule.mjs'

const golden = fileURLToPath(new URL('./golden/updater/', import.meta.url))
function matches(name, text) {
  const path = join(golden, name)
  if (process.env.SLATEBOX_UPDATE_GOLDEN === '1' || !existsSync(path)) writeFileSync(path, text)
  assert.equal(text, readFileSync(path, 'utf8'), `${name} differs from its golden file`)
}

const mac = updaterScript({ name: 'slatebox', dir: '/Users/me/.slatebox/installs/slatebox', docker: '/usr/local/bin/docker', hostNetwork: false, outsideUrl: 'http://host.docker.internal:7070', scheduler: 'launchd' })
const linux = updaterScript({ name: 'team', dir: '/opt/slatebox/team', docker: '/usr/bin/docker', backups: '/srv/backups', hostNetwork: true, scheduler: 'systemd', feedUrl: 'https://mirror.example/update-feed/channels.json' })

test('updater.sh: one exec when there is nothing to do; the running image (by ID) with the socket when there is', () => {
  matches('updater-mac.sh', mac)
  matches('updater-linux.sh', linux)
  assert.match(linux, /--network host/)
  assert.match(mac, /--add-host host\.docker\.internal:host-gateway/)
  assert.match(mac, /--outside-url '?http:\/\/host\.docker\.internal:7070'?/)
  assert.match(linux, /-v '?\/srv\/backups'?:'?\/srv\/backups'?/)
  assert.match(linux, /heartbeat --updater 1 --scheduler '?systemd'? --feed-url '?https:\/\/mirror\.example/)
  assert.match(mac, /image=\$\("\$docker" inspect --format '\{\{\.Image\}\}' "\$name"\)/)
  assert.match(mac, /--entrypoint \/opt\/slatebox\/bin\/slatebox-updater "\$image"/)
  // The decision travels as data in an environment variable, never as shell code.
  assert.match(mac, /-e SLATEBOX_UPDATE_DECISION="\$decision"/)
})

test('updater.sh is valid sh', () => {
  for (const script of [mac, linux]) execFileSync('sh', ['-n'], { input: script })
})

test('launchd, systemd and cron entries', () => {
  matches('launchd.plist', updaterAgentText('com.slatebox.slatebox.updater', '/Users/me/.slatebox/installs/slatebox/updater.sh', '/Users/me/.slatebox/installs/slatebox/updates/updater.log'))
  matches('updater.service', systemdService('team', '/opt/slatebox/team/updater.sh'))
  matches('updater.timer', systemdTimer('team'))
  matches('cron.d', cronFile('team', '/opt/slatebox/team/updater.sh', '/opt/slatebox/team/updates/updater.log'))
  assert.match(systemdTimer('team'), /OnCalendar=\*:0\/5/)
})

test('only the installer\'s own updater line changes; the backup line and everyone else\'s stay byte for byte', () => {
  const others = '# mine\n0 1 * * * /usr/bin/mine\n15 3 * * * /bin/sh /x/backup.sh >> /x/backup.log 2>&1 # slatebox-installer:slatebox\n'
  const line = cronLine('slatebox', '/x/updater.sh', '/x/updates/updater.log')
  assert.ok(line.endsWith(CRON_MARK('slatebox')))
  const added = nextCrontab(others, 'slatebox', line)
  assert.equal(added, `${others}${line}\n`)
  assert.equal(nextCrontab(added, 'slatebox', line), added, 'again: unchanged')
  assert.equal(nextCrontab(added, 'slatebox', null), others, 'removed: the rest as it was')
  assert.equal(nextCrontab(added, 'other', null), added, 'another install\'s removal touches nothing here')
})
