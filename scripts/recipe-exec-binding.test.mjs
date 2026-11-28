// The recipes and GitHub App actions meet the exec client's contract, as the server builds it at
// start (server/exec/system.mjs → buildClientManifest → checkBinding): every action bound into the
// client (an HTTP mount, agents allowed, not NEVER_BOUND) answers an object schema with properties,
// and every bound write declares idempotency. A failure here is a server that does not start.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-exec-binding.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'
import { buildClientManifest } from '../web/app/server/actions/client-render.mjs'
import { recipeActions } from '../enterprise/server/recipes/actions.mjs'
import { githubAppActions } from '../enterprise/server/recipes/vendors/github/actions.mjs'

test('the recipes and GitHub App actions bind into the exec client the server builds', () => {
  const registry = createAppRegistry({ extraActions: [...recipeActions(() => ({})), ...githubAppActions(() => null)] })
  const manifest = buildClientManifest(registry)
  const ids = JSON.stringify(manifest)
  for (const id of ['recipes.run', 'recipes.create', 'recipes.hooks.add', 'recipes.github.installations']) assert.ok(ids.includes(id), id)
})
