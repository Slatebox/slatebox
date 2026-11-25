// Kubernetes and SSH orchestration against stand-ins for kubectl and ssh.
// (Real-cluster and real-sshd runs are in test/integration.)
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '../src/yaml.mjs'
import { cli, FakeCloud, sandbox } from './fakes.mjs'

const IMAGE = 'registry.example.com/slatebox/slatebox@sha256:' + 'b'.repeat(64)
const BROKEN = 'registry.example.com/slatebox/slatebox@sha256:' + 'c'.repeat(64)

class FakeKube {
  constructor({ context = 'kind-sbx', denied = [], namespaceExists = false, breakWhen = () => false, localImages = {}, nodeArch = 'amd64' } = {}) {
    this.context = context
    this.denied = new Set(denied)
    this.namespaceExists = namespaceExists
    this.calls = []
    this.applied = null
    this.applies = []
    this.secret = null
    this.secretError = null
    this.image = null
    this.ready = false
    this.breakWhen = breakWhen
    this.localImages = localImages
    this.nodeArch = nodeArch
  }

  run = async (cmd, args, options = {}) => {
    this.calls.push({ cmd, args, input: options.input })
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' })
    const fail = (stderr = 'failed', code = 1) => ({ code, stdout: '', stderr })
    if (cmd === 'docker') {
      const local = args[0] === 'image' && args[1] === 'inspect' && this.localImages[args.at(-1)]
      return local ? ok(JSON.stringify({ Id: `sha256:${'d'.repeat(64)}`, RepoDigests: [], ...local })) : fail('No such image')
    }
    if (cmd !== 'kubectl') return fail(`${cmd} missing`, 127)
    if (args[0] === 'config' && args[1] === 'current-context') return ok(`${this.context}\n`)
    const rest = args[0] === '--context' ? args.slice(2) : args
    const [verb, kind, name] = rest
    if (verb === 'version') return ok('{}')
    if (verb === 'auth') return this.denied.has(`${rest[2]} ${rest[3]}`) ? { code: 1, stdout: 'no\n', stderr: '' } : ok('yes\n')
    if (verb === 'get' && kind === 'nodes') return ok(this.nodeArch)
    if (verb === 'get' && kind === 'namespace') return this.namespaceExists || this.applied ? ok(`namespace/${name}`) : fail('NotFound')
    if (verb === 'get' && kind === 'storageclass') return ok(JSON.stringify({ items: [{ metadata: { name: 'standard', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } } }] }))
    if (verb === 'get' && kind === 'secret' && this.secretError) return fail(this.secretError)
    if (verb === 'get' && kind === 'secret') return this.secret ? ok(JSON.stringify({ data: Object.fromEntries(Object.entries(this.secret).map(([k, v]) => [k, Buffer.from(v).toString('base64')])) })) : fail(`Error from server (NotFound): secrets "${name}" not found`)
    if (verb === 'get' && kind === 'statefulset') return this.image ? ok(this.image) : fail('NotFound')
    if (verb === 'get' && kind === 'pod') return ok(this.ready ? 'true' : '')
    if (verb === 'diff') return options.input === this.applied ? ok() : { code: 1, stdout: 'diff', stderr: '' }
    if (verb === 'apply') {
      this.applied = options.input
      this.applies.push(options.input)
      const docs = options.input.split('---\n').map(text => parse(text))
      const secret = docs.find(doc => doc.kind === 'Secret')
      if (secret) this.secret = secret.stringData
      this.image = docs.find(doc => doc.kind === 'StatefulSet').spec.template.spec.containers[0].image
      this.ready = this.image !== BROKEN && !this.breakWhen(options.input)
      return ok()
    }
    if (verb === 'rollout') return this.ready ? ok() : fail('timed out waiting for the condition')
    if (verb === 'delete') return ok()
    if (verb === 'exec') {
      if (args.includes('backup')) { writeFileSync(options.outputFile, 'BACKUP'); return ok() }
      return this.ready ? ok() : fail('not ready')
    }
    return fail(`fake kubectl does not know ${rest.join(' ')}`)
  }
}

const K8S = ['install', 'k8s', '--image', IMAGE, '--ai', 'none', '--admin-email', 'ops@example.com', '--namespace', 'boards', '--json']

test('a production-looking current context is refused unless named', async () => {
  const kube = new FakeKube({ context: 'prod-eu' })
  const result = await cli([...K8S, '--yes'], { run: kube.run, home: sandbox() })
  assert.equal(result.code, 4)
  assert.match(result.events.at(-1).message, /--k8s-context prod-eu/)
  assert.equal(kube.calls.filter(call => call.args.includes('apply')).length, 0)
  const named = await cli([...K8S, '--k8s-context', 'prod-eu'], { run: kube.run, home: sandbox() })
  assert.equal(named.code, 3, 'named: it gets as far as asking for a yes')
})

test('missing permissions are exit 4 with the list of what is denied', async () => {
  const kube = new FakeKube({ denied: ['create secrets', 'create statefulsets.apps'] })
  const result = await cli([...K8S, '--yes'], { run: kube.run, home: sandbox() })
  assert.equal(result.code, 4)
  assert.deepEqual(result.events.at(-1).denied, ['create secrets in boards', 'create statefulsets.apps in boards'])
})

test('kubernetes install: the plan names the context; the Secret goes on standard input only; a re-run changes nothing', async () => {
  const kube = new FakeKube()
  const home = sandbox()
  const planned = await cli(K8S, { run: kube.run, home })
  assert.equal(planned.code, 3, 'needs a yes')
  const plan = planned.events.find(event => event.event === 'plan')
  assert.match(plan.where, /kube context "kind-sbx", namespace boards/)
  assert.ok(plan.objects.includes('Secret/slatebox-env'))
  assert.ok(plan.objects.includes('StatefulSet/slatebox'))

  const result = await cli([...K8S, '--yes'], { run: kube.run, home })
  assert.equal(result.code, 0, result.stderr)
  const key = kube.secret.SLATEBOX_KEY_ENCRYPTION_KEY
  assert.equal(Buffer.from(key, 'base64').length, 32)
  for (const call of kube.calls) assert.ok(!call.args.join(' ').includes(key), 'never in arguments')
  assert.ok(!result.stdout.includes(key) && !result.stderr.includes(key))
  const apply = kube.calls.find(call => call.args.includes('apply'))
  assert.deepEqual(apply.args.slice(0, 2), ['--context', 'kind-sbx'])
  assert.ok(apply.args.includes('--server-side') && apply.args.includes('--field-manager=slatebox-installer'))
  assert.equal(result.events.at(-1).secretsFile, 'Secret boards/slatebox-env in context kind-sbx')

  const again = await cli([...K8S], { run: kube.run, home })
  assert.equal(again.code, 0, again.stderr)
  assert.equal(again.events.at(-1).nothingToChange, true)
  assert.equal(kube.secret.SLATEBOX_KEY_ENCRYPTION_KEY, key, 'the key is kept')
})

test('kubernetes upgrade that never gets ready: backup, previous objects, the stuck pod replaced, restore, exit 5', async () => {
  const kube = new FakeKube()
  const home = sandbox()
  assert.equal((await cli([...K8S, '--yes'], { run: kube.run, home })).code, 0)
  const result = await cli(['upgrade', '--to', BROKEN, '--yes', '--json'], { run: kube.run, home })
  assert.equal(result.code, 5, result.stderr)
  assert.equal(kube.image, IMAGE)
  const verbs = kube.calls.map(call => call.args.slice(2).join(' '))
  const backup = verbs.findIndex(verb => verb.includes('slatebox backup'))
  const deletePod = verbs.findIndex(verb => verb.startsWith('delete pod slatebox-0'))
  const restore = verbs.findIndex(verb => verb.includes('slatebox restore'))
  assert.ok(backup >= 0 && deletePod > backup && restore > deletePod, verbs.join('\n'))
})

test('ssh: without Docker on the server and without consent, exit 4 and nothing is changed', async () => {
  const calls = []
  const run = async (cmd, args, options = {}) => {
    calls.push({ cmd, args, input: options.input })
    if (cmd !== 'ssh') return { code: 127, stdout: '', stderr: 'missing' }
    if (args.at(-1) === 'sh -s') return { code: 0, stdout: 'uid=0\narch=x86_64\nos=ubuntu 24.04\ndocker_path=\nsystemd=yes\ndisk_kb=99999999\nlistening=22\n', stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  const home = sandbox()
  const result = await cli(['install', 'ssh', 'root@203.0.113.5', '--admin-email', 'ops@example.com', '--ai', 'none', '--yes', '--json'], { run, home })
  assert.equal(result.code, 4)
  assert.equal(result.events.at(-1).needs, 'install-docker')
  assert.equal(calls.length, 1, 'only the read-only preflight ran')
  assert.ok(calls[0].args.includes('BatchMode=yes'))

  const planned = await cli(['plan', 'ssh', 'root@203.0.113.5', '--admin-email', 'ops@example.com', '--ai', 'none', '--install-docker', '--json'], { run, home })
  assert.equal(planned.code, 0, planned.stderr)
  assert.match(planned.events.find(event => event.event === 'plan').commands.join('\n'), /get\.docker\.com/)
  assert.match(planned.events.find(event => event.event === 'plan').warnings.join('\n'), /get\.docker\.com as root on root@203\.0\.113\.5.*not pinned/)
})

test('ssh: snap Docker and a host without root or sudo are refused before anything changes', async () => {
  const home = sandbox()
  const facts = text => async (cmd, args) => (args.at(-1) === 'sh -s' ? { code: 0, stdout: text, stderr: '' } : { code: 0, stdout: '', stderr: '' })
  const snap = await cli(['install', 'ssh', 'root@h', '--admin-email', 'o@example.com', '--ai', 'none', '--yes', '--json'], { run: facts('uid=0\narch=x86_64\ndocker_path=/snap/bin/docker\ndocker_server=27\ncompose=2\n'), home })
  assert.equal(snap.code, 4)
  assert.match(snap.events.at(-1).message, /snap/)
  const noSudo = await cli(['install', 'ssh', 'deploy@h', '--admin-email', 'o@example.com', '--ai', 'none', '--yes', '--json'], { run: facts('uid=1000\nsudo=no\narch=x86_64\n'), home })
  assert.equal(noSudo.code, 4)
  assert.match(noSudo.events.at(-1).message, /sudo/)
})

// ------------------------------------------------------------------ review findings (2026-11-21)

const docsOf = input => input.split('---\n').map(text => parse(text))

test('review 1: the Secret cannot be read (not "not found"): exit 4, no new key, nothing applied', async () => {
  const kube = new FakeKube()
  const home = sandbox()
  assert.equal((await cli([...K8S, '--yes'], { run: kube.run, home })).code, 0)
  const key = kube.secret.SLATEBOX_KEY_ENCRYPTION_KEY
  const applies = kube.applies.length
  kube.secretError = 'Error from server (Forbidden): secrets "slatebox-env" is forbidden: User "dev" cannot get resource "secrets"'
  const result = await cli([...K8S, '--size', 'team', '--yes'], { run: kube.run, home })
  assert.equal(result.code, 4, result.stderr)
  assert.match(result.events.at(-1).message, /forbidden/)
  assert.equal(kube.applies.length, applies)
  assert.equal(kube.secret.SLATEBOX_KEY_ENCRYPTION_KEY, key)
})

test('review 1: preflight checks that the Secret can be read', async () => {
  const kube = new FakeKube({ denied: ['get secrets'] })
  const result = await cli([...K8S, '--yes'], { run: kube.run, home: sandbox() })
  assert.equal(result.code, 4)
  assert.ok(result.events.at(-1).denied.includes('get secrets in boards'))
})

test('review 1: the Secret is gone but the StatefulSet is there: refused until --new-encryption-key', async () => {
  const kube = new FakeKube()
  const home = sandbox()
  assert.equal((await cli([...K8S, '--yes'], { run: kube.run, home })).code, 0)
  const key = kube.secret.SLATEBOX_KEY_ENCRYPTION_KEY
  kube.secret = null
  const refused = await cli([...K8S, '--yes'], { run: kube.run, home })
  assert.equal(refused.code, 4, refused.stderr)
  assert.match(refused.events.at(-1).message, /--new-encryption-key/)
  const forced = await cli([...K8S, '--yes', '--new-encryption-key'], { run: kube.run, home })
  assert.equal(forced.code, 0, forced.stderr)
  assert.notEqual(kube.secret.SLATEBOX_KEY_ENCRYPTION_KEY, key)
})

test('review 7: a settings change that never gets ready puts the previous ConfigMap and Secret back (exit 5)', async () => {
  const kube = new FakeKube({ breakWhen: input => input.includes('SLATEBOX_AI') })
  const home = sandbox()
  assert.equal((await cli([...K8S, '--yes'], { run: kube.run, home })).code, 0)
  const before = docsOf(kube.applied)
  const result = await cli(['ai', 'add', 'kind=deepinfra,key=env:DI_KEY', '--yes', '--json'], { run: kube.run, home, env: { DI_KEY: 'di-0123456789abcdef' } })
  assert.equal(result.code, 5, result.stderr)
  const after = docsOf(kube.applies.at(-1))
  const pick = (docs, kind) => docs.find(doc => doc.kind === kind)
  assert.deepEqual(pick(after, 'Secret').stringData, pick(before, 'Secret').stringData, 'the previous Secret is back')
  assert.deepEqual(pick(after, 'ConfigMap').data, pick(before, 'ConfigMap').data, 'the previous settings are back')
  assert.deepEqual(pick(after, 'StatefulSet').spec, pick(before, 'StatefulSet').spec)
  assert.equal(kube.ready, true)
})

test('review 8: upgrading Kubernetes to a tag that cannot be resolved to a digest here is refused (exit 4), not "nothing"', async () => {
  const kube = new FakeKube()
  const home = sandbox()
  assert.equal((await cli([...K8S, '--yes'], { run: kube.run, home })).code, 0)
  const result = await cli(['upgrade', '--to', 'registry.example.com/slatebox/slatebox:2', '--yes', '--json'], { run: kube.run, home })
  assert.equal(result.code, 4, result.stderr)
  assert.match(result.events.at(-1).message, /@sha256:/)
})

test('review 13: an image built for another architecture than the nodes is refused before anything is applied', async () => {
  const ref = 'registry.example.com/slatebox/slatebox:arm'
  const kube = new FakeKube({ localImages: { [ref]: { Architecture: 'arm64' } }, nodeArch: 'amd64 amd64' })
  const result = await cli(['install', 'k8s', '--image', ref, '--ai', 'none', '--admin-email', 'ops@example.com', '--namespace', 'boards', '--json', '--yes'], { run: kube.run, home: sandbox() })
  assert.equal(result.code, 4, result.stderr)
  assert.match(result.events.at(-1).message, /arm64/)
  assert.equal(kube.applies.length, 0)
})

// The published-installer end-to-end run: with the image not on this computer, a plan assumed the
// oldest image's settings and refused a team address. This release's own image is known.
test('Kubernetes with this release\'s image and a team address: planned with the image\'s own settings, not refused', async () => {
  const kube = new FakeKube()
  const cloud = new FakeCloud()
  const result = await cli(['plan', 'k8s', '--team-address', 'acme', '--ai', 'none', '--admin-email', 'ops@example.com', '--json'], { run: kube.run, home: sandbox(), fetch: cloud.fetch, env: { SLATEBOX_CLOUD_URL: cloud.base } })
  assert.equal(result.code, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /does not support a team address/)
  const plan = result.events.find(event => event.event === 'plan')
  assert.doesNotMatch(plan.warnings.join('\n'), /could not be read from it/, 'nothing is assumed for the pinned image')
})
