// No kind or k3d on this machine, so the pod the installer renders for
// Kubernetes is run with Docker the way the kubelet would run it: the two
// containers of the StatefulSet share one network namespace and an emptyDir
// (mode 0777) at /run/slatebox, run as uid/gid 10001 with every capability
// dropped and no privilege escalation, get their environment from the
// rendered ConfigMap and Secret, and the backups container runs the rendered
// script from its ConfigMap. This proves the security context and the backup
// sidecar against the real image; the manifests themselves are checked by
// kubeconform in golden.test.mjs.
//
//   SLATEBOX_IMAGE=<local image> node --test --test-concurrency=1 test/integration/pod.test.mjs
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { LEGACY_SETTINGS } from '../../src/ai/settings-adapter.mjs'
import { collect, resolveAnswers } from '../../src/answers.mjs'
import { renderK8s, renderSecret } from '../../src/render/k8s.mjs'
import { settingsFor } from '../../src/render/settings.mjs'
import { generateKek } from '../../src/secrets.mjs'
import { available, buildTestImages, cleanup, docker, ok, RUN_ID, track } from './lib.mjs'

const skip = !available() && 'set SLATEBOX_IMAGE to a local one-container image'
const pod = `${RUN_ID}-pod`
let objects, secret, app, backups

before(() => {
  if (skip) return
  const images = buildTestImages()
  const { answers } = resolveAnswers(collect({ flags: { target: 'k8s', 'admin-email': 'ops@example.com', ai: 'none', 'k8s-context': 'emulated', 'backup-keep': '2' } }), {})
  const settings = settingsFor(answers, { settings: [...LEGACY_SETTINGS] })
  objects = renderK8s(answers, { image: images.current, env: settings.env, record: '' })
  secret = renderSecret(answers, { SLATEBOX_KEY_ENCRYPTION_KEY: generateKek() })
  const set = objects.find(object => object.kind === 'StatefulSet')
  ;[app, backups] = set.spec.template.spec.containers
  for (const volume of ['data', 'run', 'backups']) track.volume(`${pod}-${volume}`)
  track.container(pod)
  track.container(`${pod}-backups`)
})
after(() => { if (!skip) cleanup() })

function securityArgs(spec, container) {
  const context = spec.securityContext
  assert.deepEqual(container.securityContext.capabilities.drop, ['ALL'])
  assert.equal(container.securityContext.allowPrivilegeEscalation, false)
  return ['--user', `${context.runAsUser}:${context.runAsGroup}`, '--group-add', String(context.fsGroup), '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges']
}

test('the rendered pod starts with all capabilities dropped and an emptyDir at /run/slatebox', { skip, timeout: 900_000 }, async () => {
  const spec = objects.find(object => object.kind === 'StatefulSet').spec.template.spec
  assert.equal(spec.enableServiceLinks, false)
  const dir = mkdtempSync(join(tmpdir(), 'sbxi-pod-'))
  const config = objects.find(object => object.metadata.name.endsWith('-config')).data
  // envFrom: the ConfigMap, then the Secret.
  writeFileSync(join(dir, 'env'), Object.entries({ ...config, ...secret.stringData }).map(([key, value]) => `${key}=${value}`).join('\n') + '\n')
  ok(['volume', 'create', `${pod}-data`])
  ok(['volume', 'create', '--driver', 'local', '--opt', 'type=tmpfs', '--opt', 'device=tmpfs', '--opt', 'o=mode=0777', `${pod}-run`])
  ok(['volume', 'create', `${pod}-backups`])
  // What fsGroup does for a volume: group-owned by 10001 and writable.
  ok(['run', '--rm', '-v', `${pod}-data:/d`, '-v', `${pod}-backups:/b`, '--entrypoint', 'sh', '--user', '0', app.image, '-c', 'chown 10001:10001 /d /b && chmod 2775 /d /b'])
  ok(['run', '-d', '--name', pod, ...securityArgs(spec, app), '--env-file', join(dir, 'env'),
    '-v', `${pod}-data:/data`, '-v', `${pod}-run:/run/slatebox`, '-p', '127.0.0.1::7070', app.image])
  let healthy = false
  for (let i = 0; i < 300 && !healthy; i++) {
    // The readiness probe, exactly as rendered.
    healthy = docker(['exec', pod, ...app.readinessProbe.exec.command]).code === 0
    if (!healthy) await new Promise(resolve => setTimeout(resolve, 1000))
  }
  assert.ok(healthy, docker(['logs', pod]).stdout)
  assert.equal(docker(['exec', pod, '/opt/slatebox/bin/slatebox', 'health', '--deep']).code, 0)
  assert.match(docker(['logs', pod]).stdout, /Own keys: +on/)
})

test('the backups container makes complete backups beside it and keeps the last BACKUP_KEEP', { skip, timeout: 600_000 }, async () => {
  const spec = objects.find(object => object.kind === 'StatefulSet').spec.template.spec
  const scriptDir = mkdtempSync(join(tmpdir(), 'sbxi-script-'))
  const script = objects.find(object => object.metadata.name.endsWith('-backup-script')).data['backup-loop.sh']
  writeFileSync(join(scriptDir, 'backup-loop.sh'), script)
  chmodSync(join(scriptDir, 'backup-loop.sh'), 0o555)
  chmodSync(scriptDir, 0o755)
  const env = backups.env.flatMap(item => ['-e', `${item.name}=${item.value}`])
  assert.deepEqual(backups.command, ['/bin/bash', '/opt/slatebox-backup/backup-loop.sh'])
  for (let round = 0; round < 3; round++) {
    const result = docker(['run', '--rm', '--network', `container:${pod}`, ...securityArgs(spec, backups), ...env,
      '-v', `${pod}-data:/data`, '-v', `${pod}-run:/run/slatebox`, '-v', `${pod}-backups:/backups`, '-v', `${scriptDir}:/opt/slatebox-backup:ro`,
      '--entrypoint', backups.command[0], app.image, backups.command[1], '--once'])
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /wrote \/backups\/slatebox-/)
    await new Promise(resolve => setTimeout(resolve, 1100)) // distinct file names
  }
  const listing = docker(['run', '--rm', '-v', `${pod}-backups:/b`, '--entrypoint', 'sh', app.image, '-c', 'ls /b; for f in /b/*.gz; do head -c 2 "$f" | od -An -tx1; done']).stdout
  const files = listing.split('\n').filter(line => line.startsWith('slatebox-'))
  assert.equal(files.length, 2, listing)
  assert.equal(listing.match(/1f 8b/g).length, 2, 'both are gzip archives')
})
