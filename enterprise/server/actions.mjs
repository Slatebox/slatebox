// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Outside agents as registry actions: each one is a Meteor method (the slate's walkthrough and
// agent chips call these), an /api/v1 route, an exec call and an MCP tool, with the same checks
// (exec everywhere). The service (service.mjs) enforces Cloud-only (nothing registers elsewhere),
// Pro for the inviter, inviter-only calls and edit rights; the registry adds scopes, rate limits
// and input validation.
import { defineAction } from '/server/actions/registry.mjs'
import { shareIdInput } from '/server/actions/slate-schemas.mjs'

const id = (description) => ({ type: 'string', minLength: 1, maxLength: 40, pattern: '^[A-Za-z0-9_-]+$', description })
const connectionId = id('The invited agent\'s id, as connectors.list gives it.')
const addressInput = { type: 'string', minLength: 8, maxLength: 500, description: 'The server\'s https address, such as https://mcp.linear.app/mcp/readonly' }
const obj = (properties) => ({ type: 'object', properties })
const OUT = {
  list: obj({ connections: { type: 'array', items: { type: 'object' } }, pro: { type: 'boolean' } }),
  discover: obj({ address: { type: 'string' }, host: { type: 'string' }, suggestedName: { type: 'string' }, tools: { type: 'array', items: { type: 'object' } }, summary: { type: ['object', 'null'] }, signIn: { type: 'object', description: 'Present when the server needs sign-in first: method (oauth or key), authHost, needsClientId, keyAllowed.' } }),
  signIn: obj({ flowId: { type: 'string' }, startUrl: { type: 'string' }, authHost: { type: 'string' } }),
  signInStatus: obj({ status: { type: 'string', enum: ['pending', 'done', 'failed', 'unknown'] }, code: { type: 'string' }, message: { type: 'string' }, opened: { type: 'boolean' } }),
  key: obj({ ok: { type: 'boolean' }, host: { type: 'string' } }),
  connection: obj({ connectionId: { type: 'string' }, name: { type: 'string' }, invitedBy: { type: 'string' }, status: { type: 'string' } }),
  removed: obj({ ok: { type: 'boolean' }, connectionId: { type: 'string' } }),
  call: obj({
    items: { type: 'integer', description: 'How many groups it placed on the slate.' },
    actions: { type: 'array', items: { type: 'string' }, description: 'The suggestions it made, as suggestions.list gives them (actionId): keep, discard or undo each with suggestions.decide.' },
    saved: { type: 'integer', description: 'Groups saved at once, when a person lets this agent edit directly.' },
    say: { type: 'string' },
    left: { type: 'array', items: { type: 'string' } },
  }),
}

const toolChoice = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 64 },
    hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    policy: { type: 'string', enum: ['allow', 'off'] },
  },
  required: ['name', 'hash', 'policy'],
  additionalProperties: false,
}

/** The actions, over a getter for the running service (set at server start). */
export function connectorActions(service) {
  const run = (name) => async (principal, input) => ({ status: 200, body: await service()[name](principal, input) })
  return [
    defineAction({
      id: 'connectors.list',
      title: 'List invited agents',
      description: 'The outside agents (MCP servers) invited onto a slate: their names, who invited each, and (for your own) the tools they may use. Anyone who can read the slate sees them.',
      toolset: 'connectors',
      kind: 'read',
      scope: 'slates:read',
      principals: ['person', 'agent'],
      mounts: { ddp: true, http: { method: 'GET', path: '/slates/{shareId}/agents', operationId: 'listInvitedAgents' } },
      input: { type: 'object', properties: { shareId: shareIdInput }, required: ['shareId'], additionalProperties: false },
      output: OUT.list,
      tool: { name: 'list_invited_agents', title: 'List the outside agents invited onto a slate', description: 'See which outside agents are invited onto a slate, who invited each, and which lookups yours may use.' },
      handler: run('list'),
    }),
    defineAction({
      id: 'connectors.discover',
      title: 'Look at an outside agent',
      description: 'Reach an MCP server\'s address and say in plain words what it can do: its tools, grouped into lookups and outside changes, each with a hash consent is given to. When the server needs sign-in, says how (a sign-in page, or a pasted key or token) instead. Needs Slatebox Pro.',
      toolset: 'connectors',
      kind: 'write',
      idempotency: 'optional',
      readOnly: true,
      openWorld: true,
      scope: 'slates:write',
      principals: ['person', 'agent'],
      mounts: { ddp: true, http: { method: 'POST', path: '/slates/{shareId}/agents/discover', operationId: 'discoverAgent' } },
      input: {
        type: 'object',
        properties: { shareId: shareIdInput, address: { type: 'string', minLength: 8, maxLength: 500, description: 'The server\'s https address, such as https://mcp.excalidraw.com/mcp' } },
        required: ['shareId', 'address'],
        additionalProperties: false,
      },
      output: OUT.discover,
      tool: { name: 'discover_agent', title: 'See what an outside MCP server can do before inviting it', description: 'Check an MCP server\'s address and see, in plain words, what it can look up before you invite it onto a slate.' },
      handler: run('discover'),
    }),
    defineAction({
      id: 'connectors.signIn',
      title: 'Sign in to an outside agent\'s server',
      description: 'Start signing in to an MCP server that needs it. Returns a Slatebox address to open in a browser: it sends you to the server\'s own sign-in page, and what the server issues is kept encrypted for you alone, never shown to anyone on the slate. Needs Slatebox Pro.',
      toolset: 'connectors',
      kind: 'write',
      idempotency: 'optional',
      changesNoSlate: true,
      openWorld: true,
      scope: 'slates:write',
      principals: ['person', 'agent'],
      mounts: { ddp: true, http: { method: 'POST', path: '/slates/{shareId}/agents/sign-in', operationId: 'signInToAgent' } },
      input: {
        type: 'object',
        properties: {
          shareId: shareIdInput,
          address: addressInput,
          clientId: { type: 'string', minLength: 1, maxLength: 500, description: 'Only for servers that need a registered app: the client id the server gave you.' },
        },
        required: ['shareId', 'address'],
        additionalProperties: false,
      },
      output: OUT.signIn,
      tool: { name: 'sign_in_to_agent', title: 'Start signing in to an outside MCP server', description: 'Start signing in to an outside MCP server that needs it; open the returned address in a browser to finish.' },
      handler: run('startSignIn'),
    }),
    defineAction({
      id: 'connectors.signInStatus',
      title: 'Check a sign-in',
      description: 'Whether a sign-in you started has finished: pending, done or failed (with plain words).',
      toolset: 'connectors',
      kind: 'read',
      scope: 'slates:read',
      principals: ['person', 'agent'],
      mounts: { ddp: true, http: { method: 'GET', path: '/agent-sign-ins/{flowId}', operationId: 'agentSignInStatus' } },
      input: { type: 'object', properties: { flowId: { type: 'string', minLength: 21, maxLength: 70, pattern: '^f[A-Za-z0-9_-]+$' } }, required: ['flowId'], additionalProperties: false },
      output: OUT.signInStatus,
      tool: { name: 'agent_sign_in_status', title: 'Check whether a sign-in to an outside MCP server finished', description: 'Check whether a sign-in you started to an outside MCP server has finished.' },
      handler: run('signInStatus'),
    }),
    defineAction({
      id: 'connectors.useKey',
      title: 'Use a key for an outside agent\'s server',
      description: 'For servers that take a key or token instead of a sign-in page: Slatebox checks it against the server, then keeps it encrypted for you alone. It is never shown to anyone on the slate. Needs Slatebox Pro.',
      toolset: 'connectors',
      kind: 'write',
      idempotency: 'optional',
      changesNoSlate: true,
      openWorld: true,
      scope: 'slates:write',
      principals: ['person', 'agent'],
      mounts: { ddp: true, http: { method: 'POST', path: '/slates/{shareId}/agents/key', operationId: 'useAgentKey' } },
      input: {
        type: 'object',
        properties: { shareId: shareIdInput, address: addressInput, key: { type: 'string', minLength: 8, maxLength: 4096, writeOnly: true, description: 'The key or token the server gave you. Kept encrypted, never returned; a run\'s record keeps it redacted.' } },
        required: ['shareId', 'address', 'key'],
        additionalProperties: false,
      },
      output: OUT.key,
      tool: { name: 'use_agent_key', title: 'Give Slatebox a key or token for an outside MCP server', description: 'Give Slatebox a key or token for an outside MCP server that takes one; it is checked, then kept encrypted for you alone.' },
      handler: run('useKey'),
    }),
    defineAction({
      id: 'connectors.connect',
      title: 'Invite an outside agent',
      description: 'Invite an MCP server onto a slate as a named agent. Its suggestions appear on the slate as ghosts anyone who can edit may keep or discard. Only you can ask it. Needs Slatebox Pro.',
      toolset: 'connectors',
      kind: 'write',
      idempotency: 'optional',
      changesNoSlate: true,
      openWorld: true,
      scope: 'slates:write',
      principals: ['person', 'agent'],
      mounts: { ddp: true, http: { method: 'POST', path: '/slates/{shareId}/agents', operationId: 'inviteAgent' } },
      input: {
        type: 'object',
        properties: {
          shareId: shareIdInput,
          address: { type: 'string', minLength: 8, maxLength: 500 },
          name: { type: 'string', minLength: 1, maxLength: 32, description: 'The name it wears on the slate.' },
          tools: { type: 'array', maxItems: 64, items: toolChoice, description: 'Each tool from connectors.discover, with its hash and allow or off.' },
          contextLevel: { type: 'string', enum: ['request', 'selection', 'slate'], description: 'What it may see: only your request, plus your selection, or plus the whole slate.' },
        },
        required: ['shareId', 'address', 'name', 'tools'],
        additionalProperties: false,
      },
      output: OUT.connection,
      tool: { name: 'invite_agent', title: 'Invite an outside MCP server onto a slate as a named agent', description: 'Invite an outside MCP server onto a slate as a named agent whose suggestions appear as ghost notes.' },
      handler: run('connect'),
    }),
    defineAction({
      id: 'connectors.disconnect',
      title: 'Remove an invited agent',
      description: 'Remove an outside agent you invited. Its suggestions still waiting go with it.',
      toolset: 'connectors',
      kind: 'write',
      idempotency: 'optional',
      changesNoSlate: true,
      scope: 'slates:write',
      principals: ['person', 'agent'],
      mounts: { ddp: true, http: { method: 'POST', path: '/agents/{connectionId}/remove', operationId: 'removeAgent' } },
      input: { type: 'object', properties: { connectionId }, required: ['connectionId'], additionalProperties: false },
      output: OUT.removed,
      tool: { name: 'remove_agent', title: 'Remove an outside agent you invited', description: 'Remove an outside agent you invited from a slate, with its suggestions that are still waiting.' },
      handler: run('disconnect'),
    }),
    defineAction({
      id: 'connectors.call',
      title: 'Ask an invited agent',
      description: 'Ask an outside agent you invited. Slatebox AI chooses its lookups, sends only what you allowed, and turns what comes back into live suggestions on the slate (ghosts everyone there sees) that anyone who can edit may keep, discard or undo with suggestions.decide. Only the person who invited it can ask it. Needs Slatebox Pro.',
      toolset: 'connectors',
      kind: 'write',
      idempotency: 'optional',
      changesNoSlate: true,
      openWorld: true,
      scope: 'slates:write',
      principals: ['person', 'agent'],
      mounts: { ddp: true, http: { method: 'POST', path: '/agents/{connectionId}/ask', operationId: 'askAgent' } },
      input: {
        type: 'object',
        properties: {
          connectionId,
          request: { type: 'string', minLength: 1, maxLength: 1000 },
          selection: { type: 'array', maxItems: 60, items: { type: 'string', minLength: 1, maxLength: 128 }, description: 'Selected note ids, when it may see your selection.' },
        },
        required: ['connectionId', 'request'],
        additionalProperties: false,
      },
      output: OUT.call,
      tool: { name: 'ask_invited_agent', title: 'Ask an outside agent you invited; its answer lands as ghost suggestions', description: 'Ask an outside agent you invited a question; its answer appears on the slate as ghost suggestions to keep or discard.' },
      handler: run('call'),
    }),
  ]
}
