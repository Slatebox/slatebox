import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse, stringify, stringifyAll } from '../src/yaml.mjs'

test('parses the answers-file shape: maps, lists of flow maps, comments, scalars', () => {
  const text = `version: 1
name: slatebox   # the install's name
target: k8s
address: { url: https://boards.example.com, port: 7070 }
k8s: { context: kind-test, namespace: slatebox, tlsIssuer: { kind: ClusterIssuer, name: letsencrypt }, storageClass: null }
ai:
  mode: providers
  providers:
    - { id: deepinfra, kind: deepinfra, keyFrom: "env:DEEPINFRA_API_KEY" }
    - id: local
      kind: openai-compatible
      baseUrl: http://ollama:11434/v1
      model: 'qwen3:8b'
      keyFrom: none
  default: local
sso: { enabled: false, only: false }
backups: { schedule: "0 3 * * *", to: ./backups, keep: 14 }
tags: [a, "b c", 3]
settings: {}
empty: []
`
  assert.deepEqual(parse(text), {
    version: 1,
    name: 'slatebox',
    target: 'k8s',
    address: { url: 'https://boards.example.com', port: 7070 },
    k8s: { context: 'kind-test', namespace: 'slatebox', tlsIssuer: { kind: 'ClusterIssuer', name: 'letsencrypt' }, storageClass: null },
    ai: {
      mode: 'providers',
      providers: [
        { id: 'deepinfra', kind: 'deepinfra', keyFrom: 'env:DEEPINFRA_API_KEY' },
        { id: 'local', kind: 'openai-compatible', baseUrl: 'http://ollama:11434/v1', model: 'qwen3:8b', keyFrom: 'none' },
      ],
      default: 'local',
    },
    sso: { enabled: false, only: false },
    backups: { schedule: '0 3 * * *', to: './backups', keep: 14 },
    tags: ['a', 'b c', 3],
    settings: {},
    empty: [],
  })
})

test('a JSON document is also accepted', () => {
  assert.deepEqual(parse('{"version": 1, "ai": {"mode": "none"}, "list": [1, "x"]}'), { version: 1, ai: { mode: 'none' }, list: [1, 'x'] })
})

test('block sequences at the same indent as their key, and nested blocks', () => {
  assert.deepEqual(parse('a:\n- 1\n- two\nb:\n  c:\n    d: true\n'), { a: [1, 'two'], b: { c: { d: true } } })
})

test('unsupported YAML is refused with a line number instead of guessed at', () => {
  assert.throws(() => parse('a: |\n  text\n'), /line 1/)
  assert.throws(() => parse('a: b\n  c: d\n'), /line 2/)
  assert.throws(() => parse('a: [1, 2\n'), /line 1/)
})

test('stringify round-trips every shape the installer writes', () => {
  const value = {
    apiVersion: 'apps/v1',
    metadata: { name: 'slatebox', labels: { 'app.kubernetes.io/managed-by': 'slatebox-installer' }, annotations: {} },
    spec: {
      replicas: 1,
      containers: [{ name: 'slatebox', args: [], env: [{ name: 'A', value: '1' }, { name: 'B', value: 'true' }], ports: [{ containerPort: 7070 }] }],
    },
    odd: ['', ' lead', 'x: y', 'a #b', '-dash', 'null', 'yes', '0123', '1e3', '@at', '*star', 'line\nbreak', "quote'", '{brace}', 'ok-plain', 'sha256:abc'],
    n: null, t: true, f: 1.5,
  }
  const text = stringify(value)
  assert.deepEqual(parse(text), value)
  assert.match(text, /^apiVersion: apps\/v1$/m)
})

test('stringifyAll writes a multi-document stream', () => {
  assert.equal(stringifyAll([{ a: 1 }, { b: 2 }]), 'a: 1\n---\nb: 2\n')
})
