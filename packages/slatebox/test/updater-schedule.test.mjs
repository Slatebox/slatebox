// The host updater's files: updater.sh, the launchd agent, the systemd service and timer, the cron
// line, each against a golden file (SLATEBOX_UPDATE_GOLDEN=1 rewrites them). Only the installer's
// own cron line is ever touched.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { HOST_SCRIPT_OPTIONS, updaterScript } from '../src/updater/host-script.mjs'
import { writeHostScript } from '../src/updater/run.mjs'
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
  // Linux: --mount, so a socket that is not there stops docker run (-v would make a folder in its place).
  assert.match(rootless, /--mount type=bind,source="\$socket",target=\/var\/run\/docker\.sock/)
  assert.doesNotMatch(rootless, /-v "\$socket/)
  // A Mac: the Docker VM's socket, always there, by the -v every Mac Docker documents for it.
  assert.match(mac, /-v "\$socket:\/var\/run\/docker\.sock"/)
  assert.match(rootless, /^user=0:0$/m, 'rootless Docker maps root in the container to the folder\'s owner')
  assert.match(linux, /if \[ ! -S "\$socket" \]; then/)
  // A Mac's socket is the Docker VM's (Docker Desktop, OrbStack, Colima): only Docker sees it, so it is not looked for here.
  assert.doesNotMatch(mac, /-S "\$socket"/)
  // Everything the updater needs is checked before Slatebox is asked: asking starts an attempt.
  for (const script of [mac, linux]) {
    const asked = script.indexOf('updates policy --json')
    assert.ok(script.indexOf('image=$("$docker" inspect') < asked, 'the image is found before asking')
    if (script === linux) assert.ok(script.indexOf('-S "$socket"') < asked, 'the socket is checked before asking')
  }
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

// A stand-in docker whose Slatebox answers: heartbeat, a decision (FAKE_DECISION), reports (kept).
// docker run of the updater exits FAKE_RUN_CODE and, at 0, leaves Slatebox on FAKE_NEW_IMAGE.
const ANSWERING_DOCKER = `#!/bin/sh
state="$FAKE_STATE"
echo "$*" >> "$state/calls"
for last; do :; done
case "$1" in
  inspect) [ -f "$state/c/$last" ] || exit 1; case "$*" in *'{{.Image}}'*) cat "$state/c/$last" ;; *) echo id ;; esac ;;
  exec) case "$*" in
      *' updates heartbeat '*) exit 0 ;;
      *' updates policy '*) printf '%s\\n' "$FAKE_DECISION" ;;
      *' updates report '*) echo "$*" >> "$state/reports"; exit "\${FAKE_REPORT_CODE:-0}" ;;
      *) exit 1 ;;
    esac ;;
  run) case "$*" in
      *--write-host-script*) touch "$state/rewritten"; node "$FAKE_RUN_MJS" --write-host-script --dir "$last" ;;
      *) [ -z "\${FAKE_STARTED:-}" ] || echo "$FAKE_STARTED" > "$FAKE_DIR/updates/started"
         [ "\${FAKE_RUN_CODE:-0}" -ne 0 ] || printf '%s' "$FAKE_NEW_IMAGE" > "$state/c/slatebox"; exit "\${FAKE_RUN_CODE:-0}" ;;
    esac ;;
esac
`

function answeringWorld({ socket } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sbx-updater-ask-'))
  const dir = join(root, 'install')
  const state = join(root, 'state')
  mkdirSync(join(dir, 'updates'), { recursive: true })
  mkdirSync(join(state, 'c'), { recursive: true })
  const docker = join(root, 'docker')
  writeFileSync(docker, ANSWERING_DOCKER, { mode: 0o755 })
  writeFileSync(join(state, 'c', 'slatebox'), 'sha256:old')
  const options = { name: 'slatebox', dir, docker, hostNetwork: false, outsideUrl: 'http://host.docker.internal:7070', scheduler: 'launchd', socket: '/var/run/docker.sock', asOwner: false, ...(socket ? { socket, hostNetwork: true } : {}) }
  writeFileSync(join(dir, 'updater.sh'), updaterScript(options))
  const runMjs = fileURLToPath(new URL('../src/updater/run.mjs', import.meta.url))
  const run = env => spawnSync('sh', [join(dir, 'updater.sh')], { env: { ...process.env, FAKE_STATE: state, FAKE_DIR: dir, FAKE_RUN_MJS: runMjs, ...env }, encoding: 'utf8' })
  const read = file => existsSync(join(state, file)) ? readFileSync(join(state, file), 'utf8') : ''
  const container = (name, image) => writeFileSync(join(state, 'c', name), image)
  return { root, dir, state, options, run, read, container }
}
const APPLY = '{"action":"apply","attemptId":"att-42","target":{"version":"2.1.1"},"current":"2.1.0","reason":"requested"}'

test('updater.sh on a Mac does not look for the Docker VM\'s socket on the Mac itself (Colima has none there)', () => {
  const w = answeringWorld()
  const result = w.run({ FAKE_DECISION: APPLY, FAKE_NEW_IMAGE: 'sha256:new' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(w.read('calls'), /run --rm --user 0:0 .*-v \/var\/run\/docker\.sock:\/var\/run\/docker\.sock .*slatebox-updater sha256:old/)
  assert.doesNotMatch(readFileSync(join(w.dir, 'updates', 'updates.log'), 'utf8'), /no Docker socket/)
})

test('updater.sh on Linux with no socket stops before asking Slatebox, so no attempt is started', () => {
  const w = answeringWorld({ socket: join(tmpdir(), 'sbx-no-such-socket.sock') })
  const result = w.run({ FAKE_DECISION: APPLY })
  assert.equal(result.status, 1)
  assert.doesNotMatch(w.read('calls'), /updates policy/)
  assert.match(readFileSync(join(w.dir, 'updates', 'updates.log'), 'utf8'), /no Docker socket at/)
})

test('updater.sh reports an attempt Docker could not start (exit 125), so it does not stay "running"', () => {
  const w = answeringWorld()
  const result = w.run({ FAKE_DECISION: APPLY, FAKE_RUN_CODE: '125' })
  assert.equal(result.status, 125)
  assert.match(w.read('reports'), /updates report --attempt att-42 --phase failed --kind apply --detail Docker could not start the updater/)
  assert.ok(!existsSync(join(w.dir, 'updates', 'pending-report.json')))
  // Slatebox not answering: the report waits for the next run.
  const again = answeringWorld()
  again.run({ FAKE_DECISION: APPLY, FAKE_RUN_CODE: '125', FAKE_REPORT_CODE: '1' })
  const pending = JSON.parse(readFileSync(join(again.dir, 'updates', 'pending-report.json'), 'utf8'))
  assert.deepEqual({ attemptId: pending.attemptId, phase: pending.phase, kind: pending.kind }, { attemptId: 'att-42', phase: 'failed', kind: 'apply' })
  // Any other failure is the updater's own, and it reported it itself.
  const own = answeringWorld()
  own.run({ FAKE_DECISION: APPLY, FAKE_RUN_CODE: '1' })
  assert.equal(own.read('reports'), '')
  // 125 after the updater started (Docker lost the connection, --rm could not remove it): its own report stands.
  const lost = answeringWorld()
  lost.run({ FAKE_DECISION: APPLY, FAKE_RUN_CODE: '125', FAKE_STARTED: 'att-42' })
  assert.equal(lost.read('reports'), '')
  assert.ok(!existsSync(join(lost.dir, 'updates', 'started')), 'the marker is cleared after each run')
  // ... or with a report it kept for Slatebox: never written over.
  const kept = answeringWorld()
  writeFileSync(join(kept.dir, 'updates', 'pending-report.json'), '{"attemptId":"att-42","phase":"healthy"}\n')
  kept.run({ FAKE_DECISION: APPLY, FAKE_RUN_CODE: '125', FAKE_REPORT_CODE: '1' })
  assert.equal(readFileSync(join(kept.dir, 'updates', 'pending-report.json'), 'utf8'), '{"attemptId":"att-42","phase":"healthy"}\n')
})

test('updater.sh leaves an updater from an earlier run be: no new attempt is asked for', () => {
  const w = answeringWorld()
  w.container('slatebox-updater', 'sha256:old')
  const result = w.run({ FAKE_DECISION: APPLY })
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(w.read('calls'), /updates policy/)
})

test('after an update or a rollback the version now running writes updater.sh again; not after a failure or with no saved options', () => {
  for (const [decision, image] of [[APPLY, 'sha256:new'], [APPLY.replace('"apply"', '"rollback"'), 'sha256:older']]) {
    const w = answeringWorld()
    writeFileSync(join(w.dir, 'updater.sh'), `${readFileSync(join(w.dir, 'updater.sh'), 'utf8')}# from before\n`)
    const before = readFileSync(join(w.dir, 'updater.sh'), 'utf8')
    writeFileSync(join(w.dir, HOST_SCRIPT_OPTIONS), JSON.stringify(w.options))
    const result = w.run({ FAKE_DECISION: decision, FAKE_NEW_IMAGE: image })
    assert.equal(result.status, 0, result.stderr)
    assert.match(w.read('calls'), new RegExp(`run --rm --user 0:0 --network none -v \\S+:\\S+ --entrypoint /opt/slatebox/bin/slatebox-updater ${image} --write-host-script --dir `))
    // The real slatebox-updater --write-host-script: the script from the options, the one before kept.
    assert.equal(readFileSync(join(w.dir, 'updater.sh'), 'utf8'), updaterScript(w.options))
    assert.equal(readFileSync(join(w.dir, 'updater.sh.prev'), 'utf8'), before)
    assert.equal(statSync(join(w.dir, 'updater.sh')).mode & 0o777, 0o700)
  }
  const failed = answeringWorld()
  writeFileSync(join(failed.dir, HOST_SCRIPT_OPTIONS), JSON.stringify(failed.options))
  failed.run({ FAKE_DECISION: APPLY, FAKE_RUN_CODE: '1' })
  assert.ok(!existsSync(join(failed.state, 'rewritten')), 'a failed update')
  const unsaved = answeringWorld()
  unsaved.run({ FAKE_DECISION: APPLY, FAKE_NEW_IMAGE: 'sha256:new' })
  assert.ok(!existsSync(join(unsaved.state, 'rewritten')), 'an install from before the options were kept')
})

test('writeHostScript: updater.sh from the saved options, renamed into place; options for another folder are refused', () => {
  const w = answeringWorld()
  writeFileSync(join(w.dir, 'updater.sh'), '#!/bin/sh\necho old\n')
  writeFileSync(join(w.dir, HOST_SCRIPT_OPTIONS), JSON.stringify(w.options))
  writeHostScript(w.dir)
  assert.equal(readFileSync(join(w.dir, 'updater.sh'), 'utf8'), updaterScript(w.options))
  assert.ok(!existsSync(join(w.dir, 'updater.sh.tmp')))
  writeFileSync(join(w.dir, HOST_SCRIPT_OPTIONS), JSON.stringify({ ...w.options, dir: '/elsewhere' }))
  assert.throws(() => writeHostScript(w.dir), /is for \/elsewhere/)
  // A choice that differs between a Mac and Linux, missing: refused, never the Linux default.
  const { hostNetwork, ...noNetwork } = w.options
  writeFileSync(join(w.dir, HOST_SCRIPT_OPTIONS), JSON.stringify(noNetwork))
  assert.throws(() => writeHostScript(w.dir), /does not say hostNetwork/)
  assert.equal(readFileSync(join(w.dir, 'updater.sh'), 'utf8'), updaterScript(w.options), 'the script there stays')
})
