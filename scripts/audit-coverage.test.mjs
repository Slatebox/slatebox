// Nothing skips the activity log. Every registry write declares what the log keeps (an entry, the
// inner path that records it, or why it is not team activity), so a new action cannot land
// without one; the Meteor methods outside the registry that change slates, sharing or the team
// call audit.record (checked in their source); and every action in the log's catalogue is
// recorded somewhere, so the catalogue never promises an entry nothing writes.
// The enterprise actions are checked in scripts/audit-coverage-enterprise.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'
import { ACTION_AUDIT, specProblem } from '../web/app/server/audit/action-specs.mjs'
import { AUDIT_ACTIONS } from '../web/app/server/audit/events.mjs'
import { isNeverBound } from '../web/app/server/actions/exec-binding.mjs'

const app = new URL('../web/app/', import.meta.url)
const read = (path) => readFileSync(new URL(path, app), 'utf8')
const ENTERPRISE_IDS = /^(connectors|integrations|google|ai\.agents\.gallery)\./

test('every write in the registry says what the activity log keeps of it', () => {
  const registry = createAppRegistry()
  const missing = []
  for (const action of registry.list()) {
    if (action.kind !== 'write' || action.readOnly) continue
    const spec = action.audit || ACTION_AUDIT[action.id]
    if (!spec) missing.push(action.id)
    else assert.equal(specProblem(spec), null, action.id)
  }
  assert.deepEqual(missing, [], 'add these to server/audit/action-specs.mjs (an entry, inside or off with a reason)')
})

test('no spec names an action that does not exist', () => {
  const ids = new Set(createAppRegistry().list().map((action) => action.id))
  const stale = Object.keys(ACTION_AUDIT).filter((id) => !ids.has(id) && !ENTERPRISE_IDS.test(id))
  assert.deepEqual(stale, [])
  const reads = createAppRegistry().list().filter((action) => (action.kind === 'read' || action.readOnly) && Object.hasOwn(ACTION_AUDIT, action.id)).map((action) => action.id)
  assert.deepEqual(reads, [], 'a read keeps nothing')
})

test('the log is not a client method or an MCP tool', () => {
  for (const id of ['audit.list', 'audit.verify', 'audit.export', 'audit.scopes', 'audit.recordDownload']) assert.ok(isNeverBound(id), id)
  const registry = createAppRegistry()
  assert.equal(registry.get('audit.list').scope, 'audit:read')
  assert.equal(registry.get('audit.list').tool, null)
  assert.equal(registry.get('audit.export').tool, null)
})

// The plain Meteor methods (and hooks) that change what a team admin must see, and the entries
// each records. Moving one of these into the registry moves its entry into ACTION_AUDIT.
const METHOD_HOOKS = [
  ['server/methods/slates.js', ['slate.deleted', 'sharing.embedOpened']],
  ['server/methods/slateAccess.js', ['sharing.linkChanged', 'sharing.memberChanged']],
  ['server/methods/users.js', ['member.invited', 'member.roleChanged', 'account.deleted']],
  ['server/methods/team-member-slates.js', ['member.removed', 'slate.deleted']],
  ['server/methods/organizations.js', ['team.created', 'team.deleted', 'slate.deleted', 'sharing.guestAdmitted']],
  ['server/methods/presentations.js', ['presentation.published', 'presentation.unpublished']],
  ['server/methods/cloudLinks.js', ['sharing.cloudLink']],
  ['server/audit/meteor.js', ['signin.succeeded', 'signin.failed', 'signout', 'member.joined']],
]

test('the Meteor methods outside the registry record what they change', () => {
  for (const [file, actions] of METHOD_HOOKS) {
    const source = read(file)
    assert.match(source, /audit\.record\(/, `${file} records`)
    for (const id of actions) assert.ok(source.includes(`action: '${id}'`), `${file} records ${id}`)
  }
  // every slate write goes through the save core, which tells the log of creates and saves
  const core = read('server/slate-save-core.mjs')
  assert.match(core, /await told\(\{ kind: 'saved'/)
  assert.match(core, /await told\(\{ kind: 'created'/)
  const wiring = read('server/slate-save.js')
  assert.equal((wiring.match(/onWrite: logSlateWrite/g) || []).length, 2, 'both save cores (plain and fenced) tell the log')
  // the method each hook sits in
  const slates = read('server/methods/slates.js')
  assert.match(slates.slice(slates.indexOf('export async function deleteOwnedSlate'), slates.indexOf('method[CONSTANTS.methods.slates.remove]')), /action: 'slate\.deleted'/)
  const users = read('server/methods/users.js')
  assert.match(users.slice(users.indexOf('method[CONSTANTS.methods.users.changeRoles]'), users.indexOf('// Who may ask how often')), /action: 'member\.roleChanged'/)
  const access = read('server/methods/slateAccess.js')
  assert.match(access.slice(access.indexOf('method[CONSTANTS.methods.slateAccess.configureMember]')), /action: 'sharing\.memberChanged'/)
})


function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name === 'node_modules' || name === 'generated' || name === 'events.mjs') continue
    if (statSync(path).isDirectory()) sources(path, out)
    else if (/\.(m?js|jsx)$/.test(name)) out.push(readFileSync(path, 'utf8'))
  }
  return out
}

test('every action in the catalogue is recorded somewhere', () => {
  // the app's server, and the enterprise code that records through api.audit (recipes)
  const text = [...sources(new URL('server/', app).pathname), ...sources(new URL('../enterprise/server/', import.meta.url).pathname)].join('\n')
  // named outside the catalogue (server/audit/events.mjs), where an entry is made
  const unused = Object.keys(AUDIT_ACTIONS).filter((id) => !text.includes(`'${id}'`))
  assert.deepEqual(unused, [])
})
