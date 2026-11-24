// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Outside agents as registry actions: each one is a Meteor method (the slate's walkthrough and
// ghosts call these), an /api/v1 route, an exec call and an MCP tool, with the same checks
// (exec everywhere). The service (service.mjs) enforces Cloud-only (nothing registers elsewhere),
// Pro for the inviter, inviter-only calls and edit rights; the registry adds scopes, rate limits
// and input validation.
import { defineAction } from '/server/actions/registry.mjs'
import { shareIdInput } from '/server/actions/slate-schemas.mjs'

const id = (description) => ({ type: 'string', minLength: 1, maxLength: 40, pattern: '^[A-Za-z0-9_-]+$', description })
const connectionId = id('The invited agent\'s id, as connectors.list gives it.')
const suggestionId = id('The suggestions\' id, as connectors.call gives it.')
const obj = (properties) => ({ type: 'object', properties })
const OUT = {
  list: obj({ connections: { type: 'array', items: { type: 'object' } }, pro: { type: 'boolean' } }),
  discover: obj({ address: { type: 'string' }, host: { type: 'string' }, suggestedName: { type: 'string' }, tools: { type: 'array', items: { type: 'object' } }, summary: { type: 'object' } }),
  connection: obj({ connectionId: { type: 'string' }, name: { type: 'string' }, invitedBy: { type: 'string' }, status: { type: 'string' } }),
  removed: obj({ ok: { type: 'boolean' }, connectionId: { type: 'string' } }),
  call: obj({ suggestionId: { type: 'string' }, items: { type: 'integer' }, say: { type: 'string' }, left: { type: 'array', items: { type: 'string' } } }),
  decide: obj({ ok: { type: 'boolean' }, kept: { type: 'integer' }, discarded: { type: 'integer' } }),
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
      description: 'Reach an MCP server\'s address and say in plain words what it can do: its tools, grouped into lookups and outside changes, each with a hash consent is given to. Needs Slatebox Pro. Open servers (no sign-in) only for now.',
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
      description: 'Ask an outside agent you invited. Slatebox AI chooses its lookups, sends only what you allowed, and turns what comes back into ghost suggestions on the slate that anyone who can edit may keep or discard. Only the person who invited it can ask it. Needs Slatebox Pro.',
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
    defineAction({
      id: 'connectors.keep',
      title: 'Keep an agent\'s suggestion',
      description: 'Keep one ghost suggestion (n) or all of them. Each is saved as the agent, one save per suggestion. Anyone who can edit the slate may keep.',
      toolset: 'connectors',
      kind: 'write',
      idempotency: 'optional',
      scope: 'slates:write',
      principals: ['person', 'agent'],
      mounts: { ddp: true, http: { method: 'POST', path: '/agent-suggestions/{suggestionId}/keep', operationId: 'keepAgentSuggestion' } },
      input: { type: 'object', properties: { suggestionId, n: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['suggestionId'], additionalProperties: false },
      output: OUT.decide,
      tool: { name: 'keep_agent_suggestion', title: 'Keep an invited agent\'s ghost suggestion', description: 'Keep one of an invited agent\'s ghost suggestions on a slate, or all of them.' },
      handler: run('keep'),
    }),
    defineAction({
      id: 'connectors.discard',
      title: 'Discard an agent\'s suggestion',
      description: 'Discard one ghost suggestion (n) or all of them. Anyone who can edit the slate may discard.',
      toolset: 'connectors',
      kind: 'write',
      idempotency: 'optional',
      changesNoSlate: true,
      scope: 'slates:write',
      principals: ['person', 'agent'],
      mounts: { ddp: true, http: { method: 'POST', path: '/agent-suggestions/{suggestionId}/discard', operationId: 'discardAgentSuggestion' } },
      input: { type: 'object', properties: { suggestionId, n: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['suggestionId'], additionalProperties: false },
      output: OUT.decide,
      tool: { name: 'discard_agent_suggestion', title: 'Discard an invited agent\'s ghost suggestion', description: 'Discard one of an invited agent\'s ghost suggestions on a slate, or all of them.' },
      handler: run('discard'),
    }),
  ]
}
