// The host updater's files: updater.sh, the launchd agent, the systemd service and timer, the cron
// line, each against a golden file (SLATEBOX_UPDATE_GOLDEN=1 rewrites them). Only the installer's
// own cron line is ever touched.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
  // Linux: as the folder's owner (its files stay theirs), in the socket's group; a Mac's VM maps ownership itself.
  assert.match(linux, /user="\$\(stat -c %u "\$dir"\):\$\(stat -c %g "\$dir"\)"/)
  assert.match(linux, /--user "\$user" --group-add "\$group"/)
  assert.match(mac, /^user=0:0$/m)
  // The socket is the host's own; never a folder made where it should be.
  const rootless = updaterScript({ name: 'slatebox', dir: '/home/me/.slatebox/installs/slatebox', socket: '/run/user/1000/docker.sock', asOwner: false })
  assert.match(rootless, /^socket=\/run\/user\/1000\/docker\.sock$/m)
  assert.match(rootless, /-v "\$socket:\/var\/run\/docker\.sock"/)
  assert.match(rootless, /^user=0:0$/m, 'rootless Docker maps root in the container to the folder\'s owner')
  assert.match(linux, /if \[ ! -S "\$socket" \]; then/)
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

// updater.sh itself, against a stand-in docker (a small sh script keeping containers as files).
const FAKE_DOCKER = `#!/bin/sh
state="$FAKE_STATE"
echo "$*" >> "$state/calls"
for last; do :; done
case "$1" in
  inspect) [ -f "$state/c/$last" ] || exit 1; case "$*" in *'{{.Image}}'*) cat "$state/c/$last" ;; *) echo id ;; esac ;;
  rename) [ -f "$state/c/$2" ] && [ ! -f "$state/c/$3" ] && mv "$state/c/$2" "$state/c/$3" ;;
  rm) rm -f "$state/c/$last" ;;
  start) [ -f "$state/c/$last" ] && touch "$state/started-$last" ;;
  run) cat > "$state/staged" ;;
  exec) exit 1 ;;
esac
`

function hostWorld() {
  const root = mkdtempSync(join(tmpdir(), 'sbx-updater-sh-'))
  const dir = join(root, 'install')
  const state = join(root, 'state')
  mkdirSync(join(dir, 'updates'), { recursive: true })
  mkdirSync(join(state, 'c'), { recursive: true })
  const docker = join(root, 'docker')
  writeFileSync(docker, FAKE_DOCKER, { mode: 0o755 })
  const script = join(dir, 'updater.sh')
  writeFileSync(script, updaterScript({ name: 'slatebox', dir, docker, hostNetwork: true, scheduler: 'cron' }))
  const container = (name, image) => writeFileSync(join(state, 'c', name), image)
  const run = () => spawnSync('sh', [script], { env: { ...process.env, FAKE_STATE: state }, encoding: 'utf8' })
  return { root, dir, state, container, run, has: name => existsSync(join(state, 'c', name)), image: name => readFileSync(join(state, 'c', name), 'utf8') }
}

test('updater.sh finishes an update cut off by a restart: the previous container back, its backup staged, the outcome left for Slatebox', () => {
  const w = hostWorld()
  w.container('slatebox', 'sha256:new')
  w.container('slatebox-previous', 'sha256:old')
  const backup = join(w.root, 'pre-upgrade-old-new.gz')
  writeFileSync(backup, 'BACKUP')
  writeFileSync(join(w.dir, 'updates', 'in-flight'), `attempt=att-9\nkind=apply\nfrom=2.0.0\nprevious_image=sha256:old\nbackup=${backup}\n`)
  const result = w.run()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(w.image('slatebox'), 'sha256:old')
  assert.ok(!w.has('slatebox-previous'))
  assert.ok(existsSync(join(w.state, 'started-slatebox')))
  assert.equal(readFileSync(join(w.state, 'staged'), 'utf8'), 'BACKUP')
  const pending = JSON.parse(readFileSync(join(w.dir, 'updates', 'pending-report.json'), 'utf8'))
  assert.deepEqual({ attemptId: pending.attemptId, phase: pending.phase, kind: pending.kind, from: pending.from }, { attemptId: 'att-9', phase: 'rolled-back', kind: 'apply', from: '2.0.0' })
  assert.match(pending.detail, /cut off .* put back with its data from before the upgrade/)
  assert.ok(!existsSync(join(w.dir, 'updates', 'in-flight')))
  assert.ok(!existsSync(join(w.dir, 'updates', 'lock')), 'the lock is given back')
})

test('updater.sh puts a container set aside back even with no note of the attempt; a dead run\'s lock is taken over', () => {
  const w = hostWorld()
  w.container('slatebox-previous', 'sha256:old')
  const lock = join(w.dir, 'updates', 'lock')
  mkdirSync(lock)
  writeFileSync(join(lock, 'owner'), 'updater 2026-11-25T03:00:00Z\n')
  const old = new Date(Date.now() - 30 * 60_000)
  utimesSync(lock, old, old)
  const result = w.run()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(w.image('slatebox'), 'sha256:old')
  assert.ok(existsSync(join(w.state, 'started-slatebox')))
  assert.ok(!existsSync(join(w.dir, 'updates', 'pending-report.json')), 'no attempt to report')
  // A live updater container keeps its lock.
  mkdirSync(lock)
  writeFileSync(join(lock, 'owner'), 'updater 2026-11-25T03:00:00Z\n')
  utimesSync(lock, old, old)
  w.container('slatebox-updater', 'sha256:old')
  const calls = readFileSync(join(w.state, 'calls'), 'utf8')
  w.run()
  assert.ok(existsSync(lock), 'held by the running updater')
  assert.equal(readFileSync(join(w.state, 'calls'), 'utf8').length - calls.length > 0, true)
  assert.doesNotMatch(readFileSync(join(w.state, 'calls'), 'utf8').slice(calls.length), /exec/, 'nothing else was done')
})
