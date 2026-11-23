// The Meteor side of the hosted MCP endpoint: the pinned MCP SDK (loaded the way sdk-chat.cjs
// loads its pinned packages, since Meteor's loader does not resolve export subpaths), the
// registry and exec manifest from the action mount, and the token check every route uses.
import express from 'express'
import { Meteor } from 'meteor/meteor'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import apiTokenService from '../api-token-auth.mjs'
import { principalFromToken } from '../actions/principal.mjs'
import { CONTRACT_VERSION } from '../actions/registry.mjs'
import { renderExecTool } from '../actions/client-render.mjs'
import { typedToolsEnabled } from '../actions/agent-surface.mjs'
import { exec, registry } from '../actions/mount'
import { mountMcp as mount } from './endpoint.mjs'
import { oauth } from '../oauth/meteor'
import { SlateApiTokens } from '../../imports/api/common/models'
import { sanitizeClientName } from '../presence/agentPresence.mjs'

const load = createRequire(
  typeof __meteor_bootstrap__ === 'undefined'
    ? join(process.cwd(), 'package.json')
    : join(__meteor_bootstrap__.serverDir, 'npm', 'package.json')
)

export function mountMcp(app) {
  const sdk = {
    Server: load('@modelcontextprotocol/sdk/server/index.js').Server,
    StreamableHTTPServerTransport: load('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransport,
    ...(({
      ListToolsRequestSchema, CallToolRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema,
      ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ReadResourceRequestSchema, McpError,
    }) => ({
      ListToolsRequestSchema, CallToolRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema,
      ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ReadResourceRequestSchema, McpError,
    }))(load('@modelcontextprotocol/sdk/types.js')),
  }
  mount(app, {
    express,
    sdk,
    registry,
    manifest: exec.manifest,
    tools: renderExecTool(exec.manifest),
    // A personal token, or a connected app's token issued for this endpoint (server/oauth).
    authenticate: async (req) => principalFromToken(await apiTokenService.authenticateApiRequest(req, { audience: oauth.urls.resource })),
    resourceMetadata: oauth.urls.resourceMetadata,
    appOrigin: Meteor.settings.public?.baseUrl || Meteor.absoluteUrl(),
    version: CONTRACT_VERSION,
    // The one option: SLATEBOX_MCP_TYPED_TOOLS=off serves exec and describe only. exec is always on.
    typedTools: typedToolsEnabled(process.env.SLATEBOX_MCP_TYPED_TOOLS),
    // The client's own name, cleaned, for the label of its agent on the canvas.
    recordClient: (principal, name) =>
      SlateApiTokens.updateAsync(
        { _id: principal.tokenId, userId: principal.userId },
        sanitizeClientName(name) ? { $set: { lastClient: sanitizeClientName(name) } } : { $unset: { lastClient: '' } }
      ),
  })
}
