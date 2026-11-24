import { constraintRules } from '../../imports/api/common/workshop-constraints.mjs'
import { promptText } from '../ai-control/prompts/index.mjs'

export function constraintTool(format) {
  return {
    name: 'revise_workshop_rules',
    description: promptText('tool.revise_workshop_rules'),
    parameters: { type: 'object', additionalProperties: false, required: ['changes'], properties: {
      changes: { type: 'array', minItems: 1, maxItems: 8, items: {
        type: 'object', additionalProperties: false, required: ['rule', 'subject', 'value'],
        properties: {
          rule: { type: 'string', enum: constraintRules[format] },
          subject: { type: 'string', description: 'Exact ID of the source station, release window or feature to edit.' },
          value: { type: 'string', description: 'For links use the destination or prerequisite ID. For counts use digits or unlimited where the model permits. For arrival-outcome use the new consequence.' },
        },
      } },
    } },
  }
}

/** The instructions for revising a board's rules (workshop.draft.rules). */
export const constraintInstructions = () => promptText('workshop.draft.rules')
