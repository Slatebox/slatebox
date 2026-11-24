import { defineAction } from './registry.mjs'
import { tokenLike } from './principal.mjs'
import { ref } from './slate-schemas.mjs'
import { nativeDiagramSources } from '../../imports/api/common/native-diagram-brief.mjs'

const created = { shareId: { type: 'string' }, url: { type: 'string', format: 'uri' } }

export default defineAction({
  id: 'slates.create',
  title: 'Create a slate',
  description:
    'Omitting kind creates a playable decision map from a brief of up to 160 characters. kind diagram makes editable notes and connections from your own steps (up to 1200 characters, connect two steps with → or ->) or from a named source. The token owner owns the new private slate.',
  toolset: 'slates',
  kind: 'write',
  scope: 'slates:write',
  principals: ['agent'],
  mounts: { http: { method: 'POST', path: '/slates', operationId: 'createSlate' } },
  idempotency: 'required',
  // The core keeps a receipt in the same transaction as the slate, and on a repeat says
  // whether that slate is still there (410 when it is not). The repeat runs it again.
  replay: 'rerun',
  // Two request forms. properties lists every field; oneOf says which combinations exist.
  input: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['map', 'diagram'] },
      brief: { type: 'string', minLength: 1, maxLength: 1200 },
      source: { type: 'string', enum: nativeDiagramSources },
    },
    required: ['brief'],
    additionalProperties: false,
    oneOf: [
      {
        type: 'object',
        properties: {
          kind: { const: 'map' },
          brief: { type: 'string', minLength: 1, maxLength: 160, pattern: '^[^<>\\x00-\\x1f\\x7f]+$', example: 'Who can approve a customer refund?' },
        },
        required: ['brief'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          kind: { const: 'diagram' },
          source: { type: 'string', enum: nativeDiagramSources },
          brief: {
            type: 'string', minLength: 1, maxLength: 1200,
            description: 'Plain text, including multiple lines. Connect two named steps using → or ->. Use up to 24 distinct notes including source notes.',
            example: 'Field report → Support reply',
          },
        },
        required: ['kind', 'brief'],
        additionalProperties: false,
      },
    ],
  },
  output: {
    oneOf: [
      { type: 'object', properties: { ...created, workshop: ref('Workshop') }, required: ['shareId', 'url', 'workshop'] },
      { type: 'object', properties: { ...created, diagram: ref('DiagramSummary') }, required: ['shareId', 'url', 'diagram'] },
    ],
  },
  failure: { code: 'slate_create_failed', message: 'The slate could not be created. Retry with the same key.' },
  tool: { name: 'create_slate', title: 'Create a flowchart or decision map', description: 'Create a new private slate and return its link: a flowchart or process diagram from steps written as "A -> B" (kind "diagram"), or a decision map from a one-line question. Mind maps and project plans are drawn from Mermaid by import_mermaid.' },
  handler: (principal, input, { deps, idempotencyKey }) =>
    deps.createPrivateSlate({ token: tokenLike(principal), key: idempotencyKey, body: input }),
})
