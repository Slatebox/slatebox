// Webhook signatures and the parts of webhooks that need no run (enterprise/server/recipes/webhooks):
// the header both ways, rotation's overlap, the 5-minute window, intercept answers made safe, and
// the permissions' hard limits and scopes (permissions.mjs).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { signatureHeader, verifySignature, parseSignature, liveSecrets, newSecret } from '../enterprise/server/recipes/webhooks/sign.mjs'
import { quarantineAnswer, applyGraphPatch, applyOutputNotes } from '../enterprise/server/recipes/webhooks/intercept.mjs'
import { hardLimit, scopeCovers, targetLine } from '../enterprise/server/recipes/permissions.mjs'
import { pointerOf } from '../enterprise/server/recipes/webhooks/inbound.mjs'

const now = Date.UTC(2026, 10, 27, 12)
const t = Math.floor(now / 1000)

test('the signature is HMAC-SHA256 over t.body, as documented (a receiver in a few lines)', () => {
  const secret = newSecret()
  assert.match(secret, /^whsec_[A-Za-z0-9_-]{43}$/)
  const body = '{"id":"evt_1"}'
  const header = signatureHeader([{ plain: secret }], body, t)
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  assert.equal(header, `t=${t},v1=${expected}`)
  assert.equal(verifySignature(header, [{ plain: secret }], body, now), true)
  assert.equal(verifySignature(header, [{ plain: secret }], body + ' ', now), false, 'any change to the body')
  assert.equal(verifySignature(header, [{ plain: 'whsec_other' }], body, now), false)
  assert.equal(verifySignature(header, [{ plain: secret }], body, now + 301000), false, 'older than 5 minutes')
  assert.equal(verifySignature('t=1,v1=zz', [{ plain: secret }], body, now), false)
  assert.equal(parseSignature('nonsense'), null)
})

test('after a rotation both secrets sign for a day, then the old one stops', () => {
  const secrets = [
    { id: 'new', plain: 'whsec_new', created: new Date(now), retiresAt: null },
    { id: 'old', plain: 'whsec_old', created: new Date(now - 86400000), retiresAt: new Date(now + 86400000) },
  ]
  const live = liveSecrets(secrets, now)
  assert.deepEqual(live.map((s) => s.id), ['new', 'old'])
  const header = signatureHeader(live, 'x', t)
  assert.equal(header.split(',v1=').length, 3)
  assert.equal(verifySignature(header, [{ plain: 'whsec_old' }], 'x', now), true)
  assert.deepEqual(liveSecrets(secrets, now + 2 * 86400000).map((s) => s.id), ['new'])
})

test('an intercept\'s answer is made safe: plain text, https links only', () => {
  const safe = quarantineAnswer('graph.ready', { add: { nodes: [{ key: 'k', text: 'Billing\u0000\n  service', link: 'javascript:alert(1)' }, { key: 'j', text: 'Docs', link: 'https://docs.example.com' }] } })
  assert.equal(safe.add.nodes[0].text, 'Billing service')
  assert.equal(safe.add.nodes[0].link, undefined)
  assert.equal(safe.add.nodes[1].link, 'https://docs.example.com/')
  const desired = { slates: [{ role: 'map', key: '', graph: { nodes: [{ key: 'a', text: 'a' }, { key: 'b', text: 'b' }], edges: [{ from: 'a', to: 'b' }], layout: 'tree' } }] }
  const patched = applyGraphPatch(desired, { add: { nodes: [{ key: 'c', text: 'c' }], edges: [{ from: 'a', to: 'c' }, { from: 'a', to: 'nowhere' }] }, update: [{ key: 'a', text: 'A' }], drop: ['b'] })
  assert.deepEqual(patched.slates[0].graph.nodes.map((n) => n.text), ['A', 'c'])
  assert.deepEqual(patched.slates[0].graph.edges, [{ from: 'a', to: 'c' }])
  assert.equal(desired.slates[0].graph.nodes.length, 2, 'the original is untouched')
  const noted = applyOutputNotes(desired, { notes: [{ key: 'owner', text: 'Owned by payments' }] })
  assert.deepEqual(noted.slates[0].notes, [{ key: 'hook:owner', text: 'Owned by payments', anchor: 'legend' }])
})

test('hard limits: never merge, never delete, pull requests only from slatebox/ branches, never to the default branch', () => {
  assert.equal(hardLimit({ kind: 'github.pull_request', target: { repo: 'a/b', ref: 'refs/heads/main' } }), 'refused')
  assert.equal(hardLimit({ kind: 'github.pull_request', target: { repo: 'a/b', ref: 'refs/heads/slatebox/architecture', targetsDefaultBranch: true } }), 'refused')
  assert.equal(hardLimit({ kind: 'github.pull_request', target: { repo: 'a/b', ref: 'refs/heads/slatebox/architecture', protected: true } }), 'refused')
  assert.equal(hardLimit({ kind: 'github.pull_request', target: { repo: 'a/b', ref: 'refs/heads/slatebox/architecture' } }), null)
  assert.equal(hardLimit({ kind: 'github.pr_comment', target: { repo: 'a/b' }, body: { merge: true } }), 'refused')
  assert.equal(hardLimit({ kind: 'slack.post', target: { channel: 'C2' } }, { scope: { channels: ['C1'] } }), 'refused')
  assert.equal(hardLimit({ kind: 'slack.post', target: { channel: 'C1' } }, { scope: { channels: ['C1'] } }), null)
  assert.equal(hardLimit({ kind: 'github.check_run', target: { repo: 'a/b' } }, null, () => 'refused'), 'refused', 'the vendor\'s own limits too')
})

test('a scope covers only targets inside it', () => {
  assert.equal(scopeCovers({ repos: ['acme/api'] }, { repo: 'acme/api', number: 3 }), true)
  assert.equal(scopeCovers({ repos: ['acme/api'] }, { repo: 'acme/web' }), false)
  assert.equal(scopeCovers({ repos: ['acme/api'], paths: ['docs/architecture/*.mmd'] }, { repo: 'acme/api', paths: ['docs/architecture/service-map.mmd'] }), true)
  assert.equal(scopeCovers({ repos: ['acme/api'], paths: ['docs/architecture/*.mmd'] }, { repo: 'acme/api', paths: ['docs/architecture/deep/x.mmd'] }), false)
  assert.equal(scopeCovers({ repos: ['acme/api'], paths: ['docs/**'] }, { repo: 'acme/api', paths: ['docs/a/b.mmd', 'src/x.js'] }), false)
  assert.equal(scopeCovers({ channels: ['C1'] }, { channel: 'C1' }), true)
  assert.equal(targetLine({ repo: 'acme/api', number: 7 }), 'acme/api #7')
})

test('a validator path reads as a JSON pointer', () => {
  assert.equal(pointerOf('nodes[0].key'), '/nodes/0/key')
  assert.equal(pointerOf(''), '')
})
