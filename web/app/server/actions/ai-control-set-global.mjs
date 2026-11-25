import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { guardControlWrite } from './ai-providers.mjs'
import { REASON, asProblem } from './ai-control-schemas.mjs'
import { GLOBAL_MESSAGE_MAX } from '../ai-control/admin.mjs'

// The global switch: AI on or off for everyone on this server, with the message people see. Model
// calls stop; the admin
// pages, these actions and sign-in never use AI, so an administrator is never locked out. A person
// only (spec 4): the app's page, not a token.
export default defineAction({
  id: 'ai.control.setGlobal',
  title: 'Turn AI on or off',
  description:
    'Turns AI on or off for everyone on this server, with the message people see while it is off (aiEnabled, message). Every server picks it up within seconds. Needs a reason. A person only. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person'],
  mounts: { ddp: true },
  confirm: true,
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: {
    type: 'object',
    properties: {
      aiEnabled: { type: 'boolean' },
      message: { type: ['string', 'null'], maxLength: GLOBAL_MESSAGE_MAX, description: 'What people see while AI is off.' },
      reason: REASON,
    },
    required: ['reason'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { aiEnabled: { type: 'boolean' }, aiDisabledMessage: { type: ['string', 'null'] }, generation: { type: ['integer', 'null'] } } },
  handler: async (principal, input, { deps }) => {
    const actor = await guardControlWrite(principal, deps, { action: 'ai.control.setGlobal', target: { kind: 'state', id: 'global' }, doing: 'turn AI on or off', reason: input.reason })
    if (input.aiEnabled === undefined && input.message === undefined) throw problem(400, 'invalid_request', 'Send aiEnabled or message.')
    try {
      return await deps.aiControlOps.setGlobal({ actor, aiEnabled: input.aiEnabled, message: input.message, reason: input.reason })
    } catch (error) {
      throw asProblem(error)
    }
  },
})
