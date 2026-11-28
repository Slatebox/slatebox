// The enterprise actions (enterprise/server: integrations, Google) go through the same registry,
// so each write says what the activity log keeps of it (server/audit/action-specs.mjs), like the
// app's own (scripts/audit-coverage.test.mjs). Run with --import ./scripts/enterprise-resolve.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { connectorActions, integrationActions } from '../enterprise/server/actions.mjs'
import { galleryActions } from '../enterprise/server/gallery-admin.mjs'
import { integrationAppActions } from '../enterprise/server/integration-apps.mjs'
import { googleActions } from '../enterprise/server/google/actions.mjs'
import { recipeActions } from '../enterprise/server/recipes/actions.mjs'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'
import { ACTION_AUDIT, specProblem } from '../web/app/server/audit/action-specs.mjs'
import { createEnterpriseHost } from '../web/app/server/enterprise-loader.mjs'
import { audit } from '../web/app/server/audit/recorder.mjs'

const none = () => ({})
const enterprise = () => [...connectorActions(none), ...integrationActions(none), ...googleActions(none), ...galleryActions(none, none, none), ...integrationAppActions(none), ...recipeActions(none)]

test('every enterprise write says what the activity log keeps of it', () => {
  const registry = createAppRegistry({ extraActions: enterprise() })
  const missing = registry.list().filter((action) => action.kind === 'write' && !action.readOnly && !(action.audit || ACTION_AUDIT[action.id])).map((action) => action.id)
  assert.deepEqual(missing, [])
  for (const action of registry.list()) if (ACTION_AUDIT[action.id]) assert.equal(specProblem(ACTION_AUDIT[action.id]), null, action.id)
  const ids = new Set(registry.list().map((action) => action.id))
  assert.deepEqual(Object.keys(ACTION_AUDIT).filter((id) => !ids.has(id)), [], 'no spec for an action that does not exist')
})

test('enterprise code adds entries through api.audit, for what happens outside an action', async () => {
  const host = createEnterpriseHost()
  const written = []
  audit.configure(async (entry) => { written.push(entry) })
  try {
    await host.api.audit({ action: 'integration.changed', target: { type: 'integration', id: 'i1' }, details: { actionId: 'sweep' } })
  } finally {
    audit.configure(null)
  }
  assert.equal(written.length, 1)
  assert.equal(written[0].action, 'integration.changed')
})
