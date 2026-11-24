// A Linux server over SSH, played by throwaway Ubuntu 24.04 containers running
// sshd. One has no Docker (the installer must stop and change nothing). The
// other has the Docker CLI and compose plugin and talks to this machine's
// Docker daemon through its socket, so what it starts is real; the install
// runs as a non-root user with passwordless sudo.
//
//   SLATEBOX_IMAGE=<local image> node --test --test-concurrency=1 test/integration/ssh.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { available, buildTestImages, cleanup, docker, freePort, home as makeHome, ok, RUN_ID, slatebox, track } from './lib.mjs'

const skip = !available() && 'set SLATEBOX_IMAGE to a local one-container image'
const name = `${RUN_ID}-ssh`
let images, home, keys, withDocker, noDocker, sshPort, sshPortBare, appPort, sshArgs

function sshdImage(tag, { docker: withDockerCli }) {
  const dir = mkdtempSync(join(tmpdir(), 'sbxi-sshd-'))
  writeFileSync(join(dir, 'key.pub'), readFileSync(join(keys, 'id_ed25519.pub')))
  const packages = ['openssh-server', 'iproute2', 'ca-certificates', 'sudo', ...(withDockerCli ? ['docker.io', 'docker-compose-v2'] : [])]
  ok(['build', '-q', '-t', tag, '-f', '-', dir], {
    input: `FROM ubuntu:24.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${packages.join(' ')} && rm -rf /var/lib/apt/lists/* && mkdir -p /run/sshd
RUN useradd -m -s /bin/bash deploy && echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/deploy && chmod 440 /etc/sudoers.d/deploy
COPY key.pub /root/.ssh/authorized_keys
COPY key.pub /home/deploy/.ssh/authorized_keys
RUN chmod 700 /root/.ssh /home/deploy/.ssh && chmod 600 /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys && chown -R deploy:deploy /home/deploy/.ssh
CMD ["/usr/sbin/sshd", "-D", "-e"]
`,
    timeout: 1_200_000,
  })
  track.image(tag)
}

before(async () => {
  if (skip) return
  images = buildTestImages()
  home = makeHome()
  keys = mkdtempSync(join(tmpdir(), 'sbxi-keys-'))
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(keys, 'id_ed25519')])
  sshdImage(`${RUN_ID}-sshd:docker`, { docker: true })
  sshdImage(`${RUN_ID}-sshd:bare`, { docker: false })
  sshPort = await freePort()
  sshPortBare = await freePort()
  appPort = await freePort()
  withDocker = `${RUN_ID}-server`
  noDocker = `${RUN_ID}-server-bare`
  for (const id of [withDocker, noDocker, name]) track.container(id)
  track.volume(`${name}-data`)
  ok(['run', '-d', '--name', withDocker, '-p', `127.0.0.1:${sshPort}:22`, '-v', '/var/run/docker.sock:/var/run/docker.sock', `${RUN_ID}-sshd:docker`])
  ok(['run', '-d', '--name', noDocker, '-p', `127.0.0.1:${sshPortBare}:22`, `${RUN_ID}-sshd:bare`])
  sshArgs = ['--identity', join(keys, 'id_ed25519'), '--ssh-option', 'StrictHostKeyChecking=accept-new', '--ssh-option', `UserKnownHostsFile=${join(keys, 'known_hosts')}`]
  // Wait for sshd.
  for (let i = 0; i < 60; i++) {
    const probe = docker(['exec', withDocker, 'sh', '-c', 'ss -ltn | grep -q ":22 "'])
    const bare = docker(['exec', noDocker, 'sh', '-c', 'ss -ltn | grep -q ":22 "'])
    if (probe.code === 0 && bare.code === 0) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
})
after(() => { if (!skip) cleanup() })

const env = () => ({ SLATEBOX_INSTALL_HOME: home })

test('no Docker on the server and no consent: exit 4, and the server is unchanged', { skip, timeout: 300_000 }, async () => {
  const before = docker(['exec', noDocker, 'sh', '-c', 'ls -A /opt; ls /etc/cron.d 2>/dev/null | wc -l']).stdout
  const result = await slatebox(['install', 'ssh', 'root@127.0.0.1', '--ssh-port', String(sshPortBare), ...sshArgs, '--name', `${name}-bare`,
    '--image', images.current, '--admin-email', 'ops@example.com', '--ai', 'none', '--yes', '--json'], { env: env() })
  assert.equal(result.code, 4, result.stderr)
  assert.equal(result.events.at(-1).needs, 'install-docker')
  assert.match(result.events.at(-1).message, /--install-docker/)
  assert.equal(docker(['exec', noDocker, 'sh', '-c', 'ls -A /opt; ls /etc/cron.d 2>/dev/null | wc -l']).stdout, before)
})

test('install over SSH as a sudo user: files 0600 under /opt/slatebox, healthy, answering, backups scheduled', { skip, timeout: 1_200_000 }, async () => {
  const result = await slatebox(['install', 'ssh', 'deploy@127.0.0.1', '--ssh-port', String(sshPort), ...sshArgs, '--name', name,
    '--image', images.current, '--port', String(appPort), '--admin-email', 'ops@example.com', '--ai', 'none', '--yes', '--json'], { env: env() })
  assert.equal(result.code, 0, result.stderr)
  const done = result.events.at(-1)
  assert.equal(done.address, `http://127.0.0.1:${appPort}`)
  assert.equal(done.secretsFile, `deploy@127.0.0.1:/opt/slatebox/secrets.env`)
  assert.equal((await (await fetch(`${done.address}/readyz`)).json()).ok, true)
  const listing = docker(['exec', withDocker, 'stat', '-c', '%a %U %n', '/opt/slatebox/secrets.env', '/opt/slatebox/compose.yaml', '/opt/slatebox/install.yaml', '/opt/slatebox/backup.sh']).stdout
  assert.match(listing, /^600 root \/opt\/slatebox\/secrets\.env$/m)
  assert.match(listing, /^700 root \/opt\/slatebox\/backup\.sh$/m)
  const cron = docker(['exec', withDocker, 'cat', `/etc/cron.d/slatebox-${name}-backup`]).stdout
  assert.match(cron, /^0 3 \* \* \* root \/bin\/sh \/opt\/slatebox\/backup\.sh/m)
  const key = /SLATEBOX_KEY_ENCRYPTION_KEY='([^']+)'/.exec(docker(['exec', withDocker, 'cat', '/opt/slatebox/secrets.env']).stdout)[1]
  assert.ok(!result.stdout.includes(key) && !result.stderr.includes(key))
  assert.ok(!readFileSync(join(home, 'installs', name, 'install.yaml'), 'utf8').includes(key))
  assert.equal(docker(['inspect', '--format', '{{.State.Health.Status}}', name]).stdout.trim(), 'healthy')
})

test('again over SSH: nothing to change', { skip, timeout: 300_000 }, async () => {
  const result = await slatebox(['install', '--name', name, '--image', images.current, '--json'], { env: env() })
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.events.at(-1).nothingToChange, true)
})

test('backup over SSH lands on the server; status answers', { skip, timeout: 600_000 }, async () => {
  const backup = await slatebox(['backup', '--name', name, '--json'], { env: env() })
  assert.equal(backup.code, 0, backup.stderr)
  const file = backup.events.at(-1).file
  assert.match(file, /^\/opt\/slatebox\/backups\/slatebox-.*\.gz$/)
  assert.equal(docker(['exec', withDocker, 'sh', '-c', `head -c 2 ${file} | od -An -tx1`]).stdout.trim(), '1f 8b')
  const status = await slatebox(['status', '--name', name, '--json'], { env: env() })
  assert.equal(status.code, 0, status.stderr)
  assert.equal(status.events.at(-1).health, 'healthy')
  assert.equal(status.events.at(-1).lastBackup, file.split('/').pop())
})

test('uninstall over SSH with delete-data removes the container, volume, files and schedule', { skip, timeout: 300_000 }, async () => {
  const result = await slatebox(['uninstall', '--name', name, '--delete-data', '--confirm', name, '--yes', '--json'], { env: env() })
  assert.equal(result.code, 0, result.stderr)
  assert.notEqual(docker(['inspect', name]).code, 0)
  assert.notEqual(docker(['volume', 'inspect', `${name}-data`]).code, 0)
  assert.equal(docker(['exec', withDocker, 'sh', '-c', `ls /opt/slatebox /etc/cron.d/slatebox-${name}-backup 2>/dev/null | wc -l`]).stdout.trim(), '0')
})
