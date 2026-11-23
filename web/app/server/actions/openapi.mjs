// The OpenAPI document, generated from the registry. Nothing here is written by hand except
// the wording shared by every route; a route exists in the document because an action
// declares it, with the action's own flags under x-slatebox.
import { CONTRACT_VERSION, pathParams } from './registry.mjs'

const errorSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: {
          type: 'object',
          description:
            'What the caller needs to choose again. move_refused: cardId, laneId, legalLaneIds, revision and the current workshop. slate_changed on a workshop: revision and workshop. invalid_operation_plan on a workshop: supported, the operation kinds this board accepts. ambiguous_selector: candidates. id_taken: ids. connector_limit: limit.',
        },
        retryAfter: { type: 'integer', description: 'Seconds to wait before retrying.' },
      },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
}

const MODE_WORDS = {
  save: 'save (the default) writes',
  preview: 'preview returns what would change and saves nothing',
  propose: 'propose stores the change for a person to keep or discard',
}

/** What a write's `mode` does, naming only the modes the action takes (its enum). */
export function modeDescription(modes) {
  return modes.map((mode) => MODE_WORDS[mode]).filter(Boolean).join('; ') + '. The response says which happened.'
}

const jsonContent = (schema) => ({ 'application/json': { schema } })

export function actionFlags(action) {
  return {
    action: action.id,
    toolset: action.toolset,
    readOnly: action.readOnly,
    destructive: action.destructive,
    idempotent: action.idempotent,
    openWorld: action.openWorld,
    confirm: action.confirm,
    principals: action.principals,
    ...(action.kind === 'write' && { modes: action.modes, idempotency: action.idempotency }),
  }
}

// Splits an action's input into where each field travels on HTTP.
export function httpLayout(action) {
  const { method, path } = action.mounts.http
  const params = pathParams(path)
  const required = new Set(action.input.required || [])
  const rest = Object.keys(action.input.properties).filter((name) => !params.includes(name))
  const takesBody = !['GET', 'DELETE'].includes(method)
  return {
    method,
    path,
    pathParams: params,
    queryParams: takesBody ? [] : rest,
    bodyParams: takesBody ? rest : [],
    required: [...required].filter((name) => rest.includes(name)),
  }
}

function operation(action) {
  const layout = httpLayout(action)
  const property = (name) => action.input.properties[name]
  const parameters = [
    ...layout.pathParams.map((name) => ({ in: 'path', name, required: true, schema: property(name) })),
    ...layout.queryParams.map((name) => ({
      in: 'query',
      name,
      required: layout.required.includes(name),
      schema: property(name),
    })),
  ]
  if (action.idempotency !== 'none')
    parameters.push({
      in: 'header',
      name: 'Idempotency-Key',
      required: action.idempotency === 'required',
      description:
        'Reuse the same key with the same token only to retry one intended write. A different request under a used key answers 409.',
      schema: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[!-~]+$' },
    })
  if (action.kind === 'write')
    parameters.push({
      in: 'header',
      name: 'Slatebox-Confirm',
      required: false,
      description:
        "An agent's save that removes something, changes someone else's notes, rewrites many notes' text or widens access answers 409 confirmation_required. Once the person agrees, send the same request again (same Idempotency-Key) with this header set to details.confirmationId. It works once and expires after 10 minutes.",
      schema: { type: 'string', pattern: '^cf_[A-Za-z0-9]{24}$' },
    })
  const doc = {
    operationId: action.mounts.http.operationId,
    summary: action.title,
    description: action.description,
    ...(action.scope && { 'x-required-scope': action.scope }),
    // Open without a token; a token adds what only a caller with an account may read.
    ...(action.principals.includes('visitor') && { security: [{}, { personalToken: [] }] }),
    'x-slatebox': actionFlags(action),
    parameters,
  }
  if (layout.bodyParams.length || action.kind === 'write') {
    if (!['GET', 'DELETE'].includes(layout.method)) {
      const properties = Object.fromEntries(layout.bodyParams.map((name) => [name, property(name)]))
      if (action.kind === 'write' && action.modes.length > 1)
        properties.mode = { type: 'string', enum: action.modes, default: 'save', description: modeDescription(action.modes) }
      doc.requestBody = {
        required: layout.required.length > 0,
        // An input with several forms publishes the forms themselves (they hold body fields only).
        content: jsonContent(
          action.input.oneOf
            ? { oneOf: action.input.oneOf }
            : {
                type: 'object',
                properties,
                ...(layout.required.length && { required: layout.required }),
                additionalProperties: false,
              }
        ),
      }
    }
  }
  const success = { description: 'Done.', content: jsonContent(action.output) }
  doc.responses = {
    [action.successStatus]: success,
    ...(action.kind === 'write' &&
      (action.modes.length > 1 || action.idempotency !== 'none') && {
        200: {
          description: 'A preview, or the answer to a repeated request with the same key.',
          content: jsonContent(action.output),
        },
      }),
    default: {
      description: 'Read error.code: 400 invalid_request, 401 unauthorized, 403 insufficient_scope or forbidden, 404 not_found, 409 conflict, 429 rate_limited (see Retry-After).',
      content: jsonContent({ $ref: '#/components/schemas/Error' }),
    },
  }
  return doc
}

export function buildOpenApi(registry) {
  const paths = {}
  for (const action of registry.list()) {
    const http = action.mounts.http
    if (!http) continue
    paths[http.path] ||= {}
    paths[http.path][http.method.toLowerCase()] = operation(action)
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Slatebox API',
      version: CONTRACT_VERSION,
      description:
        'Use a personal access token from Profile → Developer access. Every route is generated from the action registry; the same actions back the app. Calls made with a token report their rate limit in RateLimit-Limit, RateLimit-Remaining and RateLimit-Reset.',
    },
    servers: [{ url: '/api/v1' }],
    security: [{ personalToken: [] }],
    paths: Object.fromEntries(Object.keys(paths).sort().map((path) => [path, paths[path]])),
    components: {
      securitySchemes: { personalToken: { type: 'http', scheme: 'bearer' } },
      schemas: { ...registry.components, Error: errorSchema },
    },
  }
}
