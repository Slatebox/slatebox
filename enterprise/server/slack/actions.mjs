// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Slack as registry actions (slack.*). Connecting is a person's own, in this browser: slack.connect
// makes the sign-in flow the page's popup claims (signin.js followSignIn), and Slack's Allow finishes
// it (the callback, signin.mjs finish → slack.mjs finishInstall). A token never starts a Slack sign-in.
// Asking, approving and disconnecting are the connector service's (connectors.*, integrations.*).
import { defineAction } from '/server/actions/registry.mjs'

const obj = (properties) => ({ type: 'object', properties })

/** The actions, over a getter for the running Slack service (set at server start). */
export function slackActions(service) {
  const run = (name) => async (principal, input) => ({ status: 200, body: await service()[name](principal, input) })
  return [
    defineAction({
      id: 'slack.status',
      title: 'Slack connection',
      description: 'Whether Slack works on this server and for you: connected or not, its workspace, and the access Slatebox asks Slack for. Never a token.',
      toolset: 'connectors',
      kind: 'read',
      scope: 'slates:read',
      principals: ['person', 'agent'],
      mounts: { ddp: true },
      input: { type: 'object', properties: {}, additionalProperties: false },
      output: obj({ enabled: { type: 'boolean' }, configured: { type: 'boolean' }, connected: { type: 'boolean' }, status: { type: 'string' }, workspace: { type: ['string', 'null'] }, scopes: { type: 'array', items: { type: 'string' } } }),
      handler: run('status'),
    }),
    defineAction({
      id: 'slack.connect',
      title: 'Connect Slack',
      description: 'Starts connecting Slack from the app\'s own page: a sign-in on Slack\'s own page, in a window this browser opens. People only.',
      toolset: 'connectors',
      kind: 'write',
      idempotency: 'optional',
      changesNoSlate: true,
      openWorld: true,
      scope: 'slates:write',
      principals: ['person'],
      mounts: { ddp: true },
      input: { type: 'object', properties: {}, additionalProperties: false },
      output: obj({ flowId: { type: 'string' }, authHost: { type: 'string' } }),
      handler: run('connect'),
    }),
  ]
}
