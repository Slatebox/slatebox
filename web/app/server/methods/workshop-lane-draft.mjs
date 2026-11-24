import { codePromptText } from '../ai-control/prompts/index.mjs'

// The tool a new lane board is drafted with (workshops.js draftWorkshop). Its description is a
// prompt (tool.draft_workshop): the request sends the published one.
const identifier = { type: 'string', pattern: '^[a-z][a-z0-9-]*$' }
const label = { type: 'string', minLength: 1, maxLength: 80 }
export const authorTool = {
  name: 'draft_workshop',
  description: codePromptText('tool.draft_workshop'),
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['version', 'title', 'lanes', 'cards'],
    properties: {
      version: { type: 'integer', enum: [1] },
      title: { type: 'string', minLength: 1, maxLength: 120 },
      lanes: {
        type: 'array', minItems: 2, maxItems: 5,
        items: {
          type: 'object', required: ['id', 'label'], additionalProperties: false,
          properties: { id: identifier, label, capacity: { type: 'integer', minimum: 1, maximum: 24 } },
        },
      },
      signals: {
        type: 'array', maxItems: 24,
        description: 'A visible change caused by placing one specific card in one lane. Include outcomes the brief asks the team to observe.',
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'label', 'cardId', 'laneId', 'whenPresent', 'whenAbsent'],
          properties: {
            id: identifier, label, cardId: identifier, laneId: identifier,
            whenPresent: { type: 'string', minLength: 1, maxLength: 160 },
            whenAbsent: { type: 'string', minLength: 1, maxLength: 160 },
          },
        },
      },
      cards: {
        type: 'array', minItems: 1, maxItems: 24,
        items: {
          type: 'object', required: ['id', 'label', 'laneId'], additionalProperties: false,
          properties: {
            id: identifier, label, laneId: identifier,
            allowedLaneIds: { type: 'array', minItems: 1, maxItems: 5, items: identifier },
          },
        },
      },
    },
  },
}
