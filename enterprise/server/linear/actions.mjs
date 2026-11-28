// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Linear (for recipes) as registry actions (linear.*). Connecting is a person's own, in this
// browser: linear.connect makes the sign-in flow the page's popup claims (signin.js followSignIn),
// and Authorize on Linear finishes it (the callback, signin.mjs finish → linear.mjs finishInstall).
// A token never starts a Linear sign-in.
import { defineAction } from '/server/actions/registry.mjs'

const obj = (properties) => ({ type: 'object', properties })
const NONE = { type: 'object', properties: {}, additionalProperties: false }

/** The actions, over a getter for the running Linear service (set at server start). */
export function linearActions(service) {
  const run = (name) => async (principal, input) => ({ status: 200, body: await service()[name](principal, input) })
  return [
    defineAction({
      id: 'linear.status',
      title: 'Linear connection',
      description: 'Whether Linear works for recipes on this server and for you: connected or not, its workspace, and the access Slatebox asks Linear for. Never a token.',
      toolset: 'connectors',
      kind: 'read',
      scope: 'slates:read',
      principals: ['person', 'agent'],
      mounts: { ddp: true },
      input: NONE,
      output: obj({ enabled: { type: 'boolean' }, configured: { type: 'boolean' }, connected: { type: 'boolean' }, status: { type: 'string' }, workspace: { type: ['string', 'null'] }, scopes: { type: 'array', items: { type: 'string' } } }),
      handler: run('status'),
    }),
    defineAction({
      id: 'linear.connect',
      title: 'Connect Linear',
      description: 'Starts connecting Linear for recipes: a sign-in on Linear\'s own page, in a window this browser opens. People only.',
      toolset: 'connectors',
      kind: 'write',
      idempotency: 'optional',
      changesNoSlate: true,
      openWorld: true,
      scope: 'slates:write',
      principals: ['person'],
      mounts: { ddp: true },
      input: NONE,
      output: obj({ flowId: { type: 'string' }, authHost: { type: 'string' } }),
      handler: run('connect'),
    }),
    defineAction({
      id: 'linear.disconnect',
      title: 'Disconnect Linear',
      description: 'Ends Slatebox\'s access to your Linear workspace and forgets it. Recipes that read Linear wait until you connect again. People only.',
      toolset: 'connectors',
      kind: 'write',
      idempotency: 'optional',
      changesNoSlate: true,
      openWorld: true,
      scope: 'slates:write',
      principals: ['person'],
      mounts: { ddp: true },
      input: NONE,
      output: obj({ disconnected: { type: 'boolean' }, revoked: { type: 'boolean' } }),
      handler: run('disconnect'),
    }),
  ]
}
