// The activity log without a database: what an entry may hold, the chain and its check, how long
// entries are kept, the export's escaping, the recorder's context, the registry's hook, who may
// read which log, and what a slate write leaves. scripts/audit-store.test.mjs runs the store
// against a real MongoDB; scripts/audit-coverage.test.mjs checks that every write is covered.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  AUDIT_ACTIONS, AUDIT_GROUPS, AuditEntryError, DETAIL_KEYS, buildEntry, createAddressHasher, describeEntry, expiryFor, retentionDays,
} from '../web/app/server/audit/events.mjs'
import { GENESIS, canonical, chainHash, entryHash, verifyChain } from '../web/app/server/audit/chain.mjs'
import { CSV_COLUMNS, csvCell, csvRow, publicEvent, writeExport } from '../web/app/server/audit/export.mjs'
import { audit, auditContext, completeEntry, viaOf, withAuditContext } from '../web/app/server/audit/recorder.mjs'
import { slateWriteEntries } from '../web/app/server/audit/slate-entries.mjs'
import { createAuditService } from '../web/app/server/audit/service.mjs'
import { ACTION_AUDIT, specProblem } from '../web/app/server/audit/action-specs.mjs'
import { createRegistry, defineAction } from '../web/app/server/actions/registry.mjs'
import { chainBadge, keptFor } from '../web/app/imports/api/common/audit-words.mjs'
import { teamSecurityOn } from '../web/app/imports/api/common/team-security.mjs'
import { auditRetention } from '../self-host/rootfs/opt/slatebox/lib/settings.mjs'

const at = new Date('2026-11-27T10:00:00Z')
const base = { scope: 'team1', at, action: 'slate.renamed', actor: { kind: 'person', userId: 'ana' }, via: 'app' }

test('an entry keeps names and ids only: content, prompts and unknown keys are refused', () => {
  const entry = buildEntry({ ...base, target: { type: 'slate', id: 'abc123', name: 'Q4 plan' }, slateId: 'abc123', details: { from: 'Q3 plan', to: 'Q4 plan' } })
  assert.deepEqual(entry.details, { from: 'Q3 plan', to: 'Q4 plan' })
  assert.equal(entry.actor.label, 'Someone')
  for (const key of ['text', 'body', 'prompt', 'nodes', 'note', 'comment', 'content', 'message']) {
    assert.throws(() => buildEntry({ ...base, details: { [key]: 'secret words' } }), AuditEntryError, key)
  }
  assert.ok(!DETAIL_KEYS.some((key) => /text|body|prompt|note|content|message/i.test(key)), 'no detail key could carry content')
  assert.throws(() => buildEntry({ ...base, details: { from: { nested: 'object' } } }), AuditEntryError)
  assert.throws(() => buildEntry({ ...base, details: { to: ['a', 'b'] } }), AuditEntryError)
  assert.throws(() => buildEntry({ ...base, nodes: [{ text: 'x' }] }), AuditEntryError)
  assert.throws(() => buildEntry({ ...base, target: { type: 'slate', id: 'a', text: 'x' } }), AuditEntryError)
  assert.throws(() => buildEntry({ ...base, actor: { kind: 'person', userId: 'ana', email: 'a@b.c' } }), AuditEntryError)
  assert.throws(() => buildEntry({ ...base, action: 'slate.nope' }), /catalogue/)
  assert.throws(() => buildEntry({ ...base, via: 'carrier-pigeon' }), AuditEntryError)
  assert.throws(() => buildEntry({ ...base, scope: 'a b' }), AuditEntryError)
  // names are one line of at most 120 characters
  const long = buildEntry({ ...base, details: { from: 'x'.repeat(500), to: 'line\none' } })
  assert.equal(long.details.from.length, 120)
  assert.equal(long.details.to, 'line one')
})

test('every action has a group and a sentence; the sentence fills in names and details', () => {
  for (const [id, spec] of Object.entries(AUDIT_ACTIONS)) {
    assert.ok(Object.hasOwn(AUDIT_GROUPS, spec.group), `${id} is in a group`)
    assert.ok(spec.text.length > 3, id)
    assert.doesNotMatch(spec.text, /\bAI\b/, `${id}: agent, not AI`)
  }
  assert.equal(describeEntry({ action: 'slate.renamed', details: { from: 'A', to: 'B' } }), 'renamed A to B')
  assert.equal(describeEntry({ action: 'slate.deleted', target: { type: 'slate', name: 'Roadmap' } }), 'deleted Roadmap')
  assert.equal(describeEntry({ action: 'agent.write', details: { actionId: 'slates.applyOperations' } }), 'made a change through slates.applyOperations')
})

test('address hashes differ per team and never hold the address', () => {
  const hash = createAddressHasher(randomBytes(32))
  const a = hash('team1', '203.0.113.7')
  assert.match(a, /^[a-f0-9]{32}$/)
  assert.equal(hash('team1', '::ffff:203.0.113.7'), a, 'an IPv4 address mapped into IPv6 is the same address')
  assert.notEqual(hash('team2', '203.0.113.7'), a, 'hashes do not correlate across teams')
  assert.notEqual(hash('team1', '203.0.113.8'), a)
  assert.equal(createAddressHasher(null)('team1', '203.0.113.7'), null, 'no key, no hash')
  assert.equal(hash('team1', ''), null)
})

test('retention: Cloud a year, self-host its setting (at least 30 days, 0 for ever)', () => {
  assert.equal(retentionDays({ cloud: true, settings: { audit: { retentionDays: 0 } } }), 365, 'a Cloud team cannot change it')
  assert.equal(retentionDays({ cloud: false, settings: {} }), 365)
  assert.equal(retentionDays({ cloud: false, settings: { audit: { retentionDays: 90 } } }), 90)
  assert.equal(retentionDays({ cloud: false, settings: { audit: { retentionDays: 7 } } }), 30)
  assert.equal(retentionDays({ cloud: false, settings: { audit: { retentionDays: 0 } } }), null)
  assert.equal(expiryFor(at, 365).toISOString(), '2027-11-27T10:00:00.000Z')
  assert.equal(expiryFor(at, null), null)
  assert.deepEqual(auditRetention(undefined), { days: 365 })
  assert.deepEqual(auditRetention('0'), { days: 0 })
  assert.deepEqual(auditRetention('90'), { days: 90 })
  assert.match(auditRetention('10').problem, /at least 30/)
  assert.match(auditRetention('a year').problem, /whole number/)
  assert.equal(keptFor({ cloud: true, keptDays: 365 }), 'Entries are kept for a year. Export the log to keep a copy for longer.')
  assert.match(keptFor({ cloud: false, keptDays: null }), /until you remove them/)
  assert.match(keptFor({ cloud: false, keptDays: 90 }), /90 days/)
})

// A sealed chain, as the sealer leaves it.
function sealed(count, scope = 'team1') {
  const rows = []
  let previous = GENESIS
  for (let seq = 1; seq <= count; seq += 1) {
    const row = { ...buildEntry({ ...base, scope, at: new Date(at.getTime() + seq * 1000), details: { from: `v${seq}`, to: `v${seq + 1}` } }), seq }
    row.entryHash = entryHash(row)
    row.chain = chainHash(previous, row.entryHash)
    previous = row.chain
    rows.push(row)
  }
  return rows
}

test('the chain: an unbroken log checks out, and its head names its newest entry', async () => {
  const rows = sealed(5)
  const result = await verifyChain(rows, [{ seq: 3, chain: rows[2].chain }])
  assert.equal(result.ok, true)
  assert.equal(result.checked, 5)
  assert.equal(result.headSeq, 5)
  assert.equal(result.head, rows[4].chain)
  assert.equal(canonical({ b: 1, a: [new Date(0), undefined, { d: 1, c: 2 }] }), '{"a":["1970-01-01T00:00:00.000Z",null,{"c":2,"d":1}],"b":1}')
})

test('the chain catches an edited entry, a deleted one, a rewritten link and a checkpoint that disagrees', async () => {
  const edited = sealed(5)
  edited[2].details = { from: 'v3', to: 'something else' }
  assert.deepEqual((await verifyChain(edited)).problem, { seq: 3, kind: 'edited' })

  const deleted = sealed(5)
  deleted.splice(3, 1)
  assert.deepEqual((await verifyChain(deleted)).problem, { seq: 4, kind: 'missing' })

  // an edit with its own hash recomputed still breaks the link
  const relinked = sealed(5)
  relinked[1].details = { from: 'v2', to: 'forged' }
  relinked[1].entryHash = entryHash(relinked[1])
  assert.deepEqual((await verifyChain(relinked)).problem, { seq: 2, kind: 'chain' })

  // the whole chain rewritten from entry 2 on: the daily checkpoint (and a SIEM's copy of the head) disagree
  const rows = sealed(5)
  const checkpoint = { seq: 4, chain: rows[3].chain }
  let previous = rows[0].chain
  for (const row of rows.slice(1)) {
    if (row.seq === 2) row.details = { from: 'v2', to: 'forged' }
    row.entryHash = entryHash(row)
    row.chain = chainHash(previous, row.entryHash)
    previous = row.chain
  }
  assert.deepEqual((await verifyChain(rows, [checkpoint])).problem, { seq: 4, kind: 'checkpoint' })
})

test('expired entries: the oldest kept entry anchors the check', async () => {
  const rows = sealed(6).slice(2)
  const result = await verifyChain(rows)
  assert.equal(result.ok, true)
  assert.equal(result.firstSeq, 3)
  assert.equal(result.since.toISOString(), rows[0].at.toISOString())
})

test('the badge says whether the chain is unbroken, and since when', () => {
  assert.equal(chainBadge({ ok: true, checked: 1200, since: '2026-01-02T00:00:00Z', pending: 0 }).text, 'Chain unbroken since January 2, 2026')
  assert.match(chainBadge({ ok: true, checked: 2, since: '2026-01-02T00:00:00Z', pending: 3 }).detail, /3 newer entries are being sealed/)
  assert.equal(chainBadge({ ok: false, problem: { seq: 7, kind: 'missing' } }).text, 'Entry 7 is missing')
  assert.equal(chainBadge({ ok: true, checked: 0, pending: 0 }).text, 'No entries yet')
})

test('CSV: a cell a spreadsheet would run as a formula stays text', () => {
  for (const evil of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd']) {
    assert.ok(csvCell(evil).replace(/^"/, '').startsWith("'"), JSON.stringify(evil))
  }
  assert.equal(csvCell('plain'), 'plain')
  assert.equal(csvCell('a, "b"'), '"a, ""b"""')
  assert.equal(csvCell('=x,y'), `"'=x,y"`)
  assert.equal(csvCell(42), '42')
  const row = csvRow({ seq: 1, at, action: 'slate.renamed', actor: { label: '=cmd|calc', kind: 'person' }, target: { type: 'slate', name: '@evil' }, details: { from: '-1', to: '+2' }, via: 'app', entryHash: 'h' })
  assert.ok(!/,=|,\+|,@|,-/.test(row.replace(/"[^"]*"/g, '""')), row)
})

test('the export writes CSV with a header, and JSON as one array of public entries', async () => {
  const rows = sealed(3)
  let csv = ''
  assert.equal(await writeExport(rows, 'csv', (text) => { csv += text }), 3)
  const lines = csv.trim().split('\r\n')
  assert.equal(lines[0], CSV_COLUMNS.join(','))
  assert.equal(lines.length, 4)
  let json = ''
  await writeExport(rows, 'json', (text) => { json += text })
  const parsed = JSON.parse(json)
  assert.equal(parsed.length, 3)
  assert.deepEqual(parsed[0], JSON.parse(JSON.stringify(publicEvent(rows[0]))))
  assert.equal(parsed[0].summary, 'renamed v1 to v2')
  let empty = ''
  await writeExport([], 'json', (text) => { empty += text })
  assert.deepEqual(JSON.parse(empty), [])
})

test('the recorder: the running call names the actor, the door and the address; a failed run leaves no deferred entry', async () => {
  assert.equal(viaOf({ kind: 'person' }), 'app')
  assert.equal(viaOf({ kind: 'agent' }), 'api')
  assert.equal(viaOf({ kind: 'agent', runId: 'r1' }), 'exec')
  assert.equal(viaOf({ kind: 'agent', via: 'mcp', runId: 'r1' }), 'mcp')
  assert.equal(viaOf({ kind: 'agent' }, { via: 'exec' }), 'exec')
  const written = []
  audit.configure(async (entry, options) => { written.push([entry, options]) })
  try {
    await withAuditContext({ principal: { kind: 'agent', userId: 'ana', tokenId: 't1', tokenName: 'CI' }, via: 'api', address: '203.0.113.7', recorded: [], pending: [] }, async () => {
      const full = completeEntry({ action: 'slate.edited' })
      assert.deepEqual(full.actor, { kind: 'agent', userId: 'ana', tokenId: 't1', tokenName: 'CI' })
      assert.equal(full.via, 'api')
      assert.equal(full.address, '203.0.113.7')
      await audit.record({ action: 'slate.created' })
      await audit.record({ action: 'slate.edited' }, { deferred: true })
      await audit.record({ action: 'slate.edited' }, { deferred: true })
      assert.equal(written.length, 1, 'a deferred entry waits')
      await audit.flush()
      assert.equal(written.length, 2, 'flushed once, the same entry twice is one')
      await audit.record({ action: 'slate.edited' }, { deferred: true })
      audit.discard()
      await audit.flush()
      assert.equal(written.length, 2, 'a discarded entry is never written')
      assert.deepEqual(auditContext().recorded, ['slate.created', 'slate.edited', 'slate.edited', 'slate.edited'])
    })
    // no principal (a plain Meteor method): the sink names the caller
    assert.equal(completeEntry({ action: 'signout' }, null).actor, null)
    // a failing sink never fails the caller
    audit.configure(async () => { throw new Error('database down') }, { onError: () => {} })
    assert.equal(await audit.record({ action: 'slate.created' }), null)
  } finally {
    audit.configure(null)
  }
})

const ok = { type: 'object', properties: {}, additionalProperties: false }
function registryWith(definitions, specs = {}) {
  const written = []
  const recorder = {
    record: async (entry, options) => {
      const context = auditContext()
      const full = completeEntry(entry, context)
      context?.recorded?.push(full.action)
      written.push([full, options])
    },
    flush: async () => {},
    discard: () => {},
  }
  const registry = createRegistry({ actions: definitions.map(defineAction), scopes: ['slates:write'], auditSpecs: specs, audit: recorder })
  return { registry, written }
}
const person = { kind: 'person', userId: 'ana', tokenId: null, tokenName: null, scopes: ['slates:write'] }
const agent = { kind: 'agent', userId: 'ana', tokenId: 'tok1', tokenName: 'CI bot', scopes: ['slates:write'] }
const slateInput = { type: 'object', properties: { shareId: { type: 'string' } }, additionalProperties: false }

test('the registry records a write after it saves, never a refused one, a preview or a read', async () => {
  const { registry, written } = registryWith([
    { id: 'slates.share', title: 'Share', description: 'Share it', toolset: 'slates', kind: 'write', principals: ['person', 'agent'], modes: ['save', 'preview'], input: slateInput, output: ok, handler: async () => ({}) },
    { id: 'slates.fail', title: 'Fail', description: 'Fails', toolset: 'slates', kind: 'write', principals: ['person'], input: slateInput, output: ok, handler: async () => { throw new Error('no') } },
    { id: 'slates.look', title: 'Look', description: 'Reads', toolset: 'slates', kind: 'read', principals: ['person', 'agent'], input: slateInput, output: ok, handler: async () => ({}) },
  ], {
    'slates.share': { action: 'sharing.inviteIssued', target: (input) => ({ type: 'slate', id: input.shareId }), details: () => ({ role: 'EDIT' }) },
    'slates.fail': { action: 'slate.deleted', target: () => ({ type: 'slate' }) },
  })
  await registry.run(person, 'slates.share', { shareId: 'abc' })
  assert.equal(written.length, 1)
  const [entry] = written[0]
  assert.equal(entry.action, 'sharing.inviteIssued')
  assert.deepEqual(entry.target, { type: 'slate', id: 'abc' })
  assert.equal(entry.slateId, 'abc')
  assert.deepEqual(entry.details, { role: 'EDIT' })
  assert.equal(entry.via, 'app')
  await registry.run(person, 'slates.share', { shareId: 'abc', mode: 'preview' })
  await assert.rejects(registry.run(person, 'slates.fail', { shareId: 'abc' }))
  await registry.run(person, 'slates.look', { shareId: 'abc' })
  assert.equal(written.length, 1, 'a preview, a failure and a read leave nothing')
})

test("an agent's save always leaves an entry: its own, the inner path's, or agent.write", async () => {
  const { registry, written } = registryWith([
    { id: 'profile.facts.add', title: 'Add', description: 'Adds a fact', toolset: 'account', kind: 'write', principals: ['person', 'agent'], input: slateInput, output: ok, handler: async () => ({}) },
    { id: 'slates.edit', title: 'Edit', description: 'Edits', toolset: 'slates', kind: 'write', principals: ['person', 'agent'], input: slateInput, output: ok,
      handler: async () => { auditContext().recorded.push('slate.edited'); return {} } },
    { id: 'presence.step', title: 'Step', description: 'Moves a pointer', toolset: 'slates', kind: 'write', principals: ['person', 'agent'], input: slateInput, output: ok, handler: async () => ({}) },
  ], {
    'profile.facts.add': { off: "the person's own About you" },
    'slates.edit': { inside: 'the save core records it' },
    'presence.step': { off: 'a pointer on the canvas', agentWrite: false },
  })
  await registry.run(person, 'profile.facts.add', {})
  assert.equal(written.length, 0, "a person's own settings are not team activity")
  await registry.run(agent, 'profile.facts.add', { shareId: 's1' })
  assert.equal(written.length, 1)
  assert.equal(written[0][0].action, 'agent.write')
  assert.deepEqual(written[0][0].details, { actionId: 'profile.facts.add' })
  assert.deepEqual(written[0][0].actor, { kind: 'agent', userId: 'ana', tokenId: 'tok1', tokenName: 'CI bot' })
  assert.equal(written[0][0].via, 'api')
  await registry.run(agent, 'slates.edit', { shareId: 's1' })
  assert.equal(written.length, 1, 'the inner path recorded it: no agent.write on top')
  await registry.run(agent, 'presence.step', { shareId: 's1' })
  assert.equal(written.length, 1, 'agentWrite: false')
  await registry.run({ ...agent, runId: 'run1' }, 'profile.facts.add', {})
  assert.equal(written[1][0].via, 'exec')
})

test('a definition may carry its own audit spec, checked at start', () => {
  const definition = { id: 'slates.thing', title: 'T', description: 'D', toolset: 'slates', kind: 'write', input: slateInput, output: ok, handler: async () => ({}) }
  assert.doesNotThrow(() => defineAction({ ...definition, audit: { action: 'slate.edited', target: () => null } }))
  assert.throws(() => defineAction({ ...definition, audit: { off: 'no' } }), /reason/)
  assert.throws(() => defineAction({ ...definition, audit: { action: 'slate.edited' } }), /target/)
  assert.throws(() => defineAction({ ...definition, kind: 'read', audit: { off: 'reads keep nothing' } }), /read keeps no/)
  for (const [id, spec] of Object.entries(ACTION_AUDIT)) {
    assert.equal(specProblem(spec), null, id)
    if (spec.action) assert.ok(Object.hasOwn(AUDIT_ACTIONS, spec.action), `${id}: ${spec.action} is in the catalogue`)
  }
})

test('a slate write leaves created, copied, renamed or edited; imports and migrations leave nothing', () => {
  const slate = { _id: 'id1', shareId: 'share1', orgId: 'team1', options: { name: 'Plan' } }
  const actor = { kind: 'person', userId: 'ana' }
  assert.equal(slateWriteEntries({ kind: 'created', slate, actor, source: 'create' })[0][0].action, 'slate.created')
  assert.equal(slateWriteEntries({ kind: 'created', slate, actor, source: 'copy' })[0][0].action, 'slate.copied')
  for (const source of ['import', 'move', 'migration']) assert.deepEqual(slateWriteEntries({ kind: 'created', slate, actor, source }), [])
  const renamed = slateWriteEntries({ kind: 'saved', slate, actor, source: 'autosave', set: { 'options.name': 'Plan B', nodes: [] }, notes: ['n1'], fields: ['options.name'] })
  assert.deepEqual(renamed.map(([entry]) => entry.action), ['slate.renamed', 'slate.edited'])
  assert.deepEqual(renamed[0][0].details, { from: 'Plan', to: 'Plan B' })
  assert.deepEqual(renamed[1][1], { coalesce: true }, 'editing is one entry per person per slate per hour')
  assert.equal(renamed[0][0].slateId, 'share1')
  assert.equal(renamed[0][0].orgId, 'team1')
  const same = slateWriteEntries({ kind: 'saved', slate, actor, source: 'autosave', set: { 'options.name': 'Plan' }, notes: [], fields: [] })
  assert.deepEqual(same, [], 'a save that changed nothing it keeps')
  assert.equal(slateWriteEntries({ kind: 'saved', slate, actor, source: 'settings', set: {}, fields: ['options.welcomeAid'] })[0][0].action, 'slate.settingsChanged')
  const guest = slateWriteEntries({ kind: 'saved', slate, actor: { kind: 'guest', userId: null, visitor: 'v1' }, source: 'autosave', notes: ['n'] })
  assert.deepEqual(guest[0][0].actor, { kind: 'guest', visitor: 'v1' })
  assert.deepEqual(slateWriteEntries({ kind: 'saved', slate, actor: {}, source: 'autosave', notes: ['n'] }), [], 'no one: no entry')
})

function service({ person: who = { orgId: 'team1', isAdmin: true }, serverAdmin = false, cloud = true, securityOn = true } = {}) {
  const calls = { list: [], recorded: [] }
  const svc = createAuditService({
    store: {
      list: async (scope, filter, page) => { calls.list.push({ scope, filter, page }); return { events: [], next: null, order: 'newest' } },
      verify: async () => ({ ok: true, checked: 0, problem: null, sealedSeq: 0, pending: 0 }),
      createExport: async () => ({ ticket: 'T'.repeat(32), expiresAt: new Date(at.getTime() + 600000) }),
    },
    cloud,
    teamPerson: async () => who,
    isServerAdmin: async () => serverAdmin,
    securityOn: async () => securityOn,
    hashAddress: (scope, address) => `${scope}:${address}`.replace(/[^a-f0-9]/g, 'a').padEnd(32, 'a'),
    record: async (entry, options) => { calls.recorded.push([entry, options]) },
    origin: () => 'https://app.example.com',
    teamNames: async () => new Map(),
    scopes: async () => [],
    retention: () => 365,
  })
  return { svc, calls }
}

test("who reads which log: a team's owner and admins; a server administrator any; Cloud staff leave a trace", async () => {
  const admin = service()
  await admin.svc.list(person, {})
  assert.equal(admin.calls.list[0].scope, 'team1')
  await assert.rejects(admin.svc.list(person, { team: 'team2' }), /owner and admins/)

  const member = service({ person: { orgId: 'team1', isAdmin: false } })
  await assert.rejects(member.svc.list(person, {}), /owner and admins/)
  const loner = service({ person: { orgId: null, isAdmin: false } })
  await assert.rejects(loner.svc.list(person, {}), /not in a team/)
  await assert.rejects(admin.svc.list({ kind: 'guest', userId: 'g' }, {}), /owner and admins/)

  const staff = service({ person: { orgId: null }, serverAdmin: true, cloud: true })
  await staff.svc.list(person, { team: 'team9' })
  assert.equal(staff.calls.list[0].scope, 'team9')
  assert.equal(staff.calls.recorded[0][0].action, 'audit.viewedByStaff')
  assert.equal(staff.calls.recorded[0][0].scope, 'team9')
  assert.deepEqual(staff.calls.recorded[0][1], { coalesce: true })
  const selfHostAdmin = service({ person: { orgId: null }, serverAdmin: true, cloud: false })
  await selfHostAdmin.svc.list(person, {})
  assert.equal(selfHostAdmin.calls.list[0].scope, 'server')
  assert.equal(selfHostAdmin.calls.recorded.length, 0, 'a self-hosted server administrator is not staff')

  const gated = service({ securityOn: false })
  await assert.rejects(gated.svc.list(person, {}), /plan does not include/)
})

test('filters: a group or one action, a person, a slate, a door, dates and an address check', async () => {
  const { svc, calls } = service()
  await svc.list(person, { action: 'sharing', actor: 'bob', slate: 's1', via: 'mcp', from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z', address: '203.0.113.7', before: 40, limit: 50 })
  const { filter, page } = calls.list[0]
  assert.ok(filter.actions.includes('sharing.linkChanged') && filter.actions.every((id) => id.startsWith('sharing.')))
  assert.equal(filter.userId, 'bob')
  assert.equal(filter.slateId, 's1')
  assert.equal(filter.via, 'mcp')
  assert.equal(filter.from.toISOString(), '2026-11-01T00:00:00.000Z')
  assert.ok(filter.ipHash, 'the address is checked by its hash')
  assert.deepEqual(page, { after: null, before: 40, limit: 50 })
  await svc.list(person, { action: 'slate.renamed' })
  assert.deepEqual(calls.list[1].filter.actions, ['slate.renamed'])
  await assert.rejects(svc.list(person, { action: 'nothing.here' }), /Choose an action/)
  await assert.rejects(svc.list(person, { from: '2026-13-45T99:00:00Z' }), /Times are written/)
  const exported = await svc.startExport(person, { format: 'csv' })
  assert.equal(exported.downloadUrl, `https://app.example.com/audit-export/${'T'.repeat(32)}`)
  assert.equal(exported.method, 'GET')
  assert.equal((await svc.verify(person, {})).keptDays, 365)
})

test('the switch: Business on Cloud today; a business-only Cloud needs Business; self-host always on', () => {
  const cloudSettings = { public: { edition: 'cloud' } }
  assert.equal(teamSecurityOn({ settings: cloudSettings, org: {} }), false)
  assert.equal(teamSecurityOn({ settings: cloudSettings, org: {}, plan: 'free' }), true)
  assert.equal(teamSecurityOn({ settings: cloudSettings, org: {}, plan: 'business' }), false)
  assert.equal(teamSecurityOn({ settings: cloudSettings, org: { business: { status: 'active' } }, plan: 'business' }), true)
  assert.equal(teamSecurityOn({ settings: cloudSettings, org: { business: { status: 'active', until: 1 } }, plan: 'business', now: 2 }), false)
  assert.equal(teamSecurityOn({ settings: { public: { edition: 'self-host' } }, org: {}, plan: 'business' }), true)
})
