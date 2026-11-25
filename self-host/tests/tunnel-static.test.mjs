// The team-address tunnel as the image's files describe it, checked without building or starting
// the image: cloudflared is pinned by version and by each architecture's checksum in two places
// that must agree, its token never reaches a command line or another process's environment, and
// a container without a token starts no tunnel at all.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { COMMANDS, SETTINGS } from '../rootfs/opt/slatebox/lib/settings.mjs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const dockerfile = read('Dockerfile')
const init = read('rootfs/opt/slatebox/bin/slatebox-init')

test('cloudflared is pinned by version, and each architecture by the same sha256 in the Dockerfile and build/cloudflared.sha256', () => {
  const version = /^ARG CLOUDFLARED_VERSION=(\d{4}\.\d+\.\d+)$/m.exec(dockerfile)?.[1]
  assert.ok(version, 'a pinned release, not latest')
  const listed = Object.fromEntries(read('build/cloudflared.sha256').trim().split('\n').map(line => line.split(/\s+/).reverse()))
  assert.deepEqual(Object.keys(listed).sort(), ['cloudflared-linux-amd64', 'cloudflared-linux-arm64'])
  for (const [file, sum] of Object.entries(listed)) {
    assert.match(sum, /^[a-f0-9]{64}$/)
    const arch = file.replace('cloudflared-linux-', '')
    const stage = new RegExp(`FROM scratch AS cloudflared-${arch}\\nARG CLOUDFLARED_VERSION\\nADD --checksum=sha256:${sum} \\\\\\n +https://github\\.com/cloudflare/cloudflared/releases/download/\\$\\{CLOUDFLARED_VERSION\\}/${file} /cloudflared`)
    assert.match(dockerfile, stage, `${arch}: the download is checked against the listed sum`)
  }
  assert.match(dockerfile, /FROM cloudflared-\$\{TARGETARCH\} AS cloudflared-download/)
  assert.match(dockerfile, /sha256sum -c -/, 'checked again against build/cloudflared.sha256 for the target architecture')
  assert.match(dockerfile, /cloudflared --version \| grep -F "version \$\{CLOUDFLARED_VERSION\} "/, 'and it is the pinned version')
  assert.match(dockerfile, /COPY --from=cloudflared \/out\/cloudflared \/opt\/cloudflared\/bin\/cloudflared/)
  assert.match(read('licenses/NOTICE.md'), /cloudflared.*Apache License 2\.0.*third-party\/cloudflared-LICENSE\.txt/)
})

test('SLATEBOX_TUNNEL_TOKEN is a setting the image accepts, and `slatebox tunnel` a command', () => {
  assert.ok(SETTINGS.includes('SLATEBOX_TUNNEL_TOKEN'))
  assert.ok(COMMANDS.includes('tunnel'))
})

test('the token goes to cloudflared by file only, and leaves the environment before any service starts', () => {
  const unset = init.indexOf('unset SLATEBOX_TUNNEL_TOKEN')
  assert.ok(unset > init.indexOf('step node "$LIB/configure.mjs"'), 'after configure.mjs has read it')
  for (const service of ['start mongo --', 'start proxy --', 'start_tunnel\n', 'start_sso\n  start_app']) {
    assert.ok(init.indexOf(service, init.indexOf('main() {')) > unset, `${service.trim()} starts after the token left the environment`)
  }
  const run = /\/opt\/cloudflared\/bin\/cloudflared tunnel [^\n]*\\\n\s+run --token-file "\$RUN\/tunnel\.token"/.exec(init)
  assert.ok(run, 'cloudflared reads the token from the private file')
  assert.doesNotMatch(init, /--token[ =]"?\$|TUNNEL_TOKEN=/, 'never as an argument or a variable')
  assert.match(init, /--no-autoupdate/, 'the pinned binary never replaces itself')
  assert.match(init, /--metrics 127\.0\.0\.1:7085/, 'metrics on loopback only')
})

test('no token, no tunnel: the tunnel starts only when configure.mjs said so, and a refused tunnel does not stop the container', () => {
  assert.match(init, /start_tunnel\(\) \{\n {2}local delay=\$\{1:-0\}\n {2}\[\[ \$\{SLATEBOX_TUNNEL:-0\} == 1 && ! -e \$RUN\/tunnel-failed \]\] \|\| return 0/)
  assert.match(init, /elif \[\[ \$name == tunnel \]\]; then\n {8}tunnel_ended "\$status"/)
  assert.match(init, /if \(\(\$\{#TUNNEL_ENDS\[@\]\} >= 3\)\); then\n {4}: > "\$RUN\/tunnel-failed"/)
  const configure = read('rootfs/opt/slatebox/lib/configure.mjs')
  assert.match(configure, /SLATEBOX_TUNNEL: tunnel \? 1 : 0/)
  assert.match(configure, /HTTP_FORWARDED_COUNT: tunnel \? 2 : 1/)
})
