import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LEGACY_SETTINGS } from '../src/ai/settings-adapter.mjs'
import { collect, resolveAnswers } from '../src/answers.mjs'
import { renderCompose } from '../src/render/compose.mjs'
import { settingsFor } from '../src/render/settings.mjs'
import { renderK8s, renderSecret } from '../src/render/k8s.mjs'
import { parse } from '../src/yaml.mjs'

const caps = { settings: [...LEGACY_SETTINGS], commands: ['backup', 'restore', 'health', 'version'] }
const IMAGE = 'ghcr.io/slatebox/slatebox@sha256:' + 'a'.repeat(64)
const answersFor = (flags, file = {}) => {
  const { answers, errors, missing } = resolveAnswers(collect({ flags: { ai: 'none', ...flags }, file }), { freePort: 7071 })
  assert.deepEqual(errors, [])
  assert.deepEqual(missing, [])
  return answers
}

test('settings: address, SSO and mail as plain settings; the key, AI keys and the mail URL as secrets', () => {
  const answers = answersFor({ sso: true, 'sso-only': true, 'mail-url-from': 'env:SMTP_URL', 'mail-from': 'Slatebox <b@example.com>', 'ai-provider': ['kind=deepinfra,key=env:DI'] })
  const out = settingsFor(answers, caps)
  assert.deepEqual(out.env, {
    SLATEBOX_URL: 'http://localhost:7071', SLATEBOX_MAIL_FROM: 'Slatebox <b@example.com>',
    SLATEBOX_SSO: 'keycloak', SLATEBOX_SSO_ONLY: 'true',
  })
  assert.deepEqual(out.secrets, { SLATEBOX_KEY_ENCRYPTION_KEY: 'generate', SLATEBOX_AI_KEY: 'env:DI', SLATEBOX_MAIL_URL: 'env:SMTP_URL' })
})

test('settings the image does not know are left out with a warning, or refused when asked for', () => {
  const old = { settings: LEGACY_SETTINGS.filter(name => name !== 'SLATEBOX_KEY_ENCRYPTION_KEY' && !name.startsWith('SLATEBOX_SSO')), commands: [] }
  const plain = settingsFor(answersFor({}), old)
  assert.equal(plain.secrets.SLATEBOX_KEY_ENCRYPTION_KEY, undefined)
  assert.match(plain.warnings.join('\n'), /own AI and call keys/)
  assert.throws(() => settingsFor(answersFor({ sso: true }), old), error => error.exitCode === 4 && /single sign-on/.test(error.message))
})

test('settings passthrough is JSON in SLATEBOX_SETTINGS', () => {
  const out = settingsFor(answersFor({}, { settings: { daily: { enabled: true } } }), caps)
  assert.equal(out.env.SLATEBOX_SETTINGS, '{"daily":{"enabled":true}}')
})

test('compose, this computer: one service, the chosen port, a named volume, env files, restart policy', () => {
  const compose = parse(renderCompose(answersFor({}), { image: IMAGE }))
  assert.deepEqual(compose, {
    name: 'slatebox',
    services: {
      slatebox: {
        image: IMAGE,
        container_name: 'slatebox',
        restart: 'unless-stopped',
        pull_policy: 'never',
        ports: ['127.0.0.1:7071:7070'],
        volumes: ['data:/data'],
        env_file: ['slatebox.env', 'secrets.env'],
        labels: { 'com.slatebox.install': 'slatebox', 'app.kubernetes.io/managed-by': 'slatebox-installer' },
      },
    },
    volumes: { data: { name: 'slatebox-data' } },
  })
})

test('compose, a server with a domain: ports 80 and 443; an endpoint on the host adds host-gateway', () => {
  const answers = answersFor({ target: 'ssh', host: 'root@203.0.113.5', domain: 'boards.example.com', 'admin-email': 'ops@example.com', name: 'team' })
  const compose = parse(renderCompose(answers, { image: IMAGE, hostGateway: true }))
  const service = compose.services.slatebox
  assert.deepEqual(service.ports, ['80:80', '443:443'])
  assert.equal(service.container_name, 'team')
  assert.deepEqual(service.extra_hosts, ['host.docker.internal:host-gateway'])
  assert.deepEqual(compose.volumes, { data: { name: 'team-data' } })
})

const k8sAnswers = extra => answersFor({ target: 'k8s', 'admin-email': 'ops@example.com', 'k8s-context': 'kind-sbx', namespace: 'boards', ...extra })
const kinds = objects => objects.map(object => `${object.kind}/${object.metadata.name}`)

test('kubernetes without a route: namespace, config, statefulset, service, backups, install record', () => {
  const answers = k8sAnswers({})
  const objects = renderK8s(answers, { image: IMAGE, ...settingsFor(answers, caps), record: 'version: 1\n' })
  assert.deepEqual(kinds(objects), [
    'Namespace/boards', 'ConfigMap/slatebox-config', 'ConfigMap/slatebox-backup-script', 'PersistentVolumeClaim/slatebox-backups',
    'StatefulSet/slatebox', 'Service/slatebox', 'ConfigMap/slatebox-install',
  ])
  for (const object of objects) {
    assert.equal(object.metadata.labels['app.kubernetes.io/managed-by'], 'slatebox-installer', kinds([object])[0])
    assert.equal(object.metadata.labels['slatebox.com/install'], 'slatebox')
    if (object.kind !== 'Namespace') assert.equal(object.metadata.namespace, 'boards')
  }
  const set = objects.find(object => object.kind === 'StatefulSet')
  assert.equal(set.spec.replicas, 1)
  const pod = set.spec.template.spec
  assert.deepEqual(pod.securityContext, { runAsUser: 10001, runAsGroup: 10001, fsGroup: 10001, runAsNonRoot: true, seccompProfile: { type: 'RuntimeDefault' } })
  const [app, backups] = pod.containers
  assert.equal(app.image, IMAGE)
  assert.deepEqual(app.envFrom, [{ configMapRef: { name: 'slatebox-config' } }, { secretRef: { name: 'slatebox-env' } }])
  assert.deepEqual(app.readinessProbe.exec.command, ['/opt/slatebox/bin/slatebox', 'health'])
  assert.ok(app.startupProbe.periodSeconds * app.startupProbe.failureThreshold >= 600, 'ten minutes to start')
  assert.deepEqual(app.resources, { requests: { memory: '1Gi', cpu: '1' }, limits: { memory: '1Gi' } })
  assert.equal(app.securityContext.allowPrivilegeEscalation, false)
  assert.equal(set.spec.volumeClaimTemplates[0].spec.resources.requests.storage, '10Gi')
  assert.equal(backups.name, 'backups')
  assert.equal(backups.image, IMAGE)
  assert.deepEqual(backups.volumeMounts.map(mount => mount.mountPath).sort(), ['/backups', '/data', '/opt/slatebox-backup', '/run/slatebox'])
  assert.deepEqual(app.volumeMounts.map(mount => mount.mountPath).sort(), ['/data', '/run/slatebox'])
  const config = objects.find(object => object.metadata.name === 'slatebox-config')
  assert.deepEqual(config.data, { SLATEBOX_URL: 'http://localhost:7070' })
})

test('kubernetes with an Ingress: TLS from the cert-manager issuer, HTTPS ends at the edge, long WebSocket timeouts', () => {
  const answers = k8sAnswers({ route: 'ingress', domain: 'boards.example.com', 'ingress-class': 'nginx', 'tls-issuer': 'ClusterIssuer/letsencrypt' })
  const objects = renderK8s(answers, { image: IMAGE, ...settingsFor(answers, caps), record: '' })
  const ingress = objects.find(object => object.kind === 'Ingress')
  assert.equal(ingress.metadata.annotations['cert-manager.io/cluster-issuer'], 'letsencrypt')
  assert.equal(ingress.metadata.annotations['nginx.ingress.kubernetes.io/proxy-read-timeout'], '3600')
  assert.equal(ingress.spec.ingressClassName, 'nginx')
  assert.deepEqual(ingress.spec.tls, [{ hosts: ['boards.example.com'], secretName: 'slatebox-tls' }])
  assert.equal(ingress.spec.rules[0].host, 'boards.example.com')
  const config = objects.find(object => object.metadata.name === 'slatebox-config')
  assert.deepEqual(config.data, { SLATEBOX_URL: 'https://boards.example.com', SLATEBOX_HTTPS: 'off' })
})

test('kubernetes with Gateway API: an HTTPRoute on the given gateway', () => {
  const answers = k8sAnswers({ route: 'gateway', domain: 'boards.example.com', 'gateway-ref': 'infra/public' })
  const route = renderK8s(answers, { image: IMAGE, ...settingsFor(answers, caps), record: '' }).find(object => object.kind === 'HTTPRoute')
  assert.equal(route.apiVersion, 'gateway.networking.k8s.io/v1')
  assert.deepEqual(route.spec.parentRefs, [{ name: 'public', namespace: 'infra' }])
  assert.deepEqual(route.spec.hostnames, ['boards.example.com'])
  assert.deepEqual(route.spec.rules[0].backendRefs, [{ name: 'slatebox', port: 7070 }])
})

test('the Secret is rendered on its own, only for apply on standard input, with every secret value', () => {
  const secret = renderSecret(k8sAnswers({}), { SLATEBOX_KEY_ENCRYPTION_KEY: 'k'.repeat(44) })
  assert.equal(secret.kind, 'Secret')
  assert.equal(secret.metadata.name, 'slatebox-env')
  assert.deepEqual(secret.stringData, { SLATEBOX_KEY_ENCRYPTION_KEY: 'k'.repeat(44) })
})

test('kubernetes pulls a registry tag every start (nodes never keep different builds); a digest or a local tag as it is', () => {
  const answers = k8sAnswers({})
  const policies = image => renderK8s(answers, { image, ...settingsFor(answers, caps), record: '' })
    .find(object => object.kind === 'StatefulSet').spec.template.spec.containers.map(container => container.imagePullPolicy)
  assert.deepEqual(policies('ghcr.io/slatebox/slatebox:latest'), ['Always', 'Always'])
  assert.deepEqual(policies(IMAGE), ['IfNotPresent', 'IfNotPresent'])
  assert.deepEqual(policies('slatebox:dev'), ['IfNotPresent', 'IfNotPresent'])
})
