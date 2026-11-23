// The contract the published package (MCP tools; the CLI's `slatebox exec` / `describe`) is generated from.
// Every action a token can call over HTTP appears here with its route, flags, schemas
// (references inlined, so each schema stands alone) and, where it has one, its tool name.
// There are no per-action CLI commands: the CLI reaches every action through `slatebox exec`.
import { CONTRACT_VERSION } from './registry.mjs'
import { actionFlags, httpLayout, modeDescription } from './openapi.mjs'
import { inlineRefs } from './schema.mjs'

export function buildContract(registry) {
  const actions = registry
    .list()
    .filter((action) => action.mounts.http)
    .map((action) => {
      const layout = httpLayout(action)
      const input = inlineRefs(action.input, registry.components)
      if (action.kind === 'write' && action.modes.length > 1)
        input.properties = {
          ...input.properties,
          mode: { type: 'string', enum: action.modes, default: 'save', description: modeDescription(action.modes) },
        }
      return {
        id: action.id,
        title: action.title,
        description: action.description,
        ...actionFlags(action),
        scope: action.scope,
        http: {
          method: layout.method,
          path: '/api/v1' + layout.path,
          pathParams: layout.pathParams,
          queryParams: layout.queryParams,
          bodyParams: layout.bodyParams,
          idempotencyKey: action.idempotency,
        },
        input,
        output: inlineRefs(action.output, registry.components),
        tool: action.tool
          ? {
              name: action.tool.name,
              title: action.tool.title || action.title,
              ...(action.tool.description && { description: action.tool.description }),
              annotations: {
                readOnlyHint: action.readOnly,
                destructiveHint: action.destructive,
                idempotentHint: action.idempotent,
                openWorldHint: action.openWorld,
              },
            }
          : null,
      }
    })
  return {
    contract: CONTRACT_VERSION,
    generatedBy: 'scripts/generate-action-contract.mjs from web/app/server/actions. Do not edit by hand.',
    scopes: registry.scopes,
    errors: {
      shape: '{"error":{"code","message","details"?,"retryAfter"?}} with the HTTP status',
      rateLimitHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
    },
    actions,
  }
}
