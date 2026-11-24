// Golden files for each answer preset, checked by the tools that consume them:
// kubeconform (Kubernetes schemas, Gateway API from the CRD catalog), helm lint
// and helm template (the chart must render the very objects `install k8s`
// applies), and docker compose config. A tool that is not installed is
// skipped with a note; set KUBECONFORM to its path if it is not on PATH.
// SLATEBOX_UPDATE_GOLDEN=1 rewrites the golden files.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { LEGACY_SETTINGS } from '../src/ai/settings-adapter.mjs'
import { collect, resolveAnswers } from '../src/answers.mjs'
import { renderCompose } from '../src/render/compose.mjs'
import { renderHelmChart } from '../src/render/helm.mjs'
import { renderK8s, renderSecret } from '../src/render/k8s.mjs'
import { settingsFor } from '../src/render/settings.mjs'
import { parse, stringify, stringifyAll } from '../src/yaml.mjs'

const GOLDEN = fileURLToPath(new URL('./golden/', import.meta.url))
const IMAGE = 'ghcr.io/slatebox/slatebox@sha256:' + '0123456789abcdef'.repeat(4)
const caps = { settings: [...LEGACY_SETTINGS], commands: [] }
const tool = name => (spawnSync(name, ['--help'], { stdio: 'ignore' }).error ? null : name)
const KUBECONFORM = process.env.KUBECONFORM || tool('kubeconform')
const HELM = tool('helm')
const DOCKER = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0

function answers(flags) {
  const { answers, errors, missing } = resolveAnswers(collect({ flags }), { freePort: 7070 })
  assert.deepEqual(errors, [])
  assert.deepEqual(missing, [])
  return answers
}

const K8S_PRESETS = {
  'k8s-port-forward': { target: 'k8s', 'admin-email': 'ops@example.com', ai: 'none' },
  'k8s-ingress-tls': {
    target: 'k8s', 'admin-email': 'ops@example.com', namespace: 'boards', route: 'ingress', domain: 'boards.example.com',
    'ingress-class': 'nginx', 'tls-issuer': 'ClusterIssuer/letsencrypt', size: 'team', sso: true,
    'ai-provider': ['id=local,kind=openai-compatible,url=http://ollama.ai.svc:11434/v1,model=qwen3:8b'],
  },
  'k8s-gateway': {
    target: 'k8s', 'admin-email': 'ops@example.com', route: 'gateway', domain: 'boards.example.com', 'gateway-ref': 'infra/public',
    'storage-class': 'fast', backups: 'off', ai: 'none', 'mail-url-from': 'env:SMTP_URL', 'mail-from': 'Slatebox <b@example.com>',
  },
}
const COMPOSE_PRESETS = {
  'compose-local': { ai: 'none', port: '7070' },
  'compose-domain': { target: 'ssh', host: 'root@203.0.113.5', domain: 'boards.example.com', 'admin-email': 'ops@example.com', 'ai-provider': ['kind=deepinfra,key=env:DI'] },
}

function k8sDocs(flags) {
  const a = answers(flags)
  const settings = settingsFor(a, caps)
  const placeholders = Object.fromEntries(Object.keys(settings.secrets).map(name => [name, 'placeholder']))
  const objects = renderK8s(a, { image: IMAGE, env: settings.env, record: stringify({ name: a.name }) })
  return { a, settings, objects, text: stringifyAll([objects[0], renderSecret(a, placeholders), ...objects.slice(1)]) }
}

function golden(name, text) {
  const path = join(GOLDEN, name)
  if (process.env.SLATEBOX_UPDATE_GOLDEN || !existsSync(path)) {
    mkdirSync(GOLDEN, { recursive: true })
    writeFileSync(path, text)
  }
  assert.equal(text, readFileSync(path, 'utf8'), `${name} changed; review it and run with SLATEBOX_UPDATE_GOLDEN=1`)
  return path
}

const CRD_CATALOG = 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json'

for (const [name, flags] of Object.entries(K8S_PRESETS)) {
  test(`kubernetes golden: ${name}`, async t => {
    const { text } = k8sDocs(flags)
    const path = golden(`${name}.yaml`, text)
    if (!KUBECONFORM) return t.skip('kubeconform is not installed')
    const result = spawnSync(KUBECONFORM, ['-strict', '-summary', '-kubernetes-version', '1.34.0', '-schema-location', 'default', '-schema-location', CRD_CATALOG, path], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /Invalid: 0, Errors: 0, Skipped: 0/)
  })
}

for (const [name, flags] of Object.entries(COMPOSE_PRESETS)) {
  test(`compose golden: ${name}`, async t => {
    const a = answers(flags)
    const settings = settingsFor(a, caps)
    const path = golden(`${name}.yaml`, renderCompose(a, { image: IMAGE, hostGateway: settings.hostGateway }))
    if (!DOCKER) return t.skip('docker compose is not installed')
    const dir = mkdtempSync(join(tmpdir(), 'sbx-compose-'))
    writeFileSync(join(dir, 'compose.yaml'), readFileSync(path))
    writeFileSync(join(dir, 'slatebox.env'), '')
    writeFileSync(join(dir, 'secrets.env'), '')
    execFileSync('docker', ['compose', '--project-directory', dir, '-f', join(dir, 'compose.yaml'), 'config', '--quiet'], { stdio: 'pipe' })
  })
}

test('helm chart: lints, and renders exactly the objects install k8s applies', async t => {
  if (!HELM) return t.skip('helm is not installed')
  const flags = K8S_PRESETS['k8s-ingress-tls']
  const { a, settings, objects } = k8sDocs(flags)
  const dir = mkdtempSync(join(tmpdir(), 'sbx-chart-'))
  for (const [path, text] of Object.entries(renderHelmChart(a, { image: IMAGE, env: settings.env, version: '0.1.0', appVersion: '0123456789abcdef' }))) {
    mkdirSync(dirname(join(dir, 'slatebox', path)), { recursive: true })
    writeFileSync(join(dir, 'slatebox', path), text)
  }
  const lint = spawnSync(HELM, ['lint', join(dir, 'slatebox')], { encoding: 'utf8' })
  assert.equal(lint.status, 0, lint.stdout + lint.stderr)
  const rendered = spawnSync(HELM, ['template', a.name, join(dir, 'slatebox'), '-n', a.k8s.namespace], { encoding: 'utf8' })
  assert.equal(rendered.status, 0, rendered.stderr)
  const fromChart = rendered.stdout.split(/^---$/m).map(doc => doc.replace(/^# Source:.*$/m, '').trim()).filter(Boolean).map(doc => parse(doc))
  const strip = object => {
    const copy = structuredClone(object)
    if (copy.kind === 'StatefulSet') delete copy.spec.template.metadata.annotations['slatebox.com/config-hash']
    return copy
  }
  const key = object => `${object.kind}/${object.metadata.name}`
  const expected = objects.filter(object => object.kind !== 'Namespace' && object.metadata.name !== `${a.name}-install`).map(strip).sort((x, y) => key(x).localeCompare(key(y)))
  const actual = fromChart.map(strip).sort((x, y) => key(x).localeCompare(key(y)))
  assert.deepEqual(actual, expected)
  if (KUBECONFORM) {
    writeFileSync(join(dir, 'rendered.yaml'), rendered.stdout)
    const result = spawnSync(KUBECONFORM, ['-strict', '-summary', '-kubernetes-version', '1.34.0', join(dir, 'rendered.yaml')], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  }
})
