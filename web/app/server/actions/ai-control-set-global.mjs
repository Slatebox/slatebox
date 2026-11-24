import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { guardControlWrite } from './ai-providers.mjs'
import { REASON, asProblem } from './ai-control-schemas.mjs'
import { GLOBAL_MESSAGE_MAX } from '../ai-control/admin.mjs'

// The global switch (spec 1.7, 3.1): AI on or off for everyone on this server, with the message
// people see, and AI control's own documents on or off at runtime. Model calls stop; the admin
// pages, these actions and sign-in never use AI, so an administrator is never locked out. A person
// only (spec 4): the app's page, not a token.
export default defineAction({
  id: 'ai.control.setGlobal',
  title: 'Turn AI on or off',
  description:
    'Turns AI on or off for everyone on this server, with the message people see while it is off (aiEnabled, message), or switches AI control\'s own settings on or off at runtime (dbLayer). Every server picks it up within seconds. Needs a reason. A person only. Administrators only.',
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
      dbLayer: { type: 'string', enum: ['on', 'off'], description: 'off: every AI control document is ignored until it is switched on again.' },
      reason: REASON,
    },
    required: ['reason'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { aiEnabled: { type: 'boolean' }, aiDisabledMessage: { type: ['string', 'null'] }, dbLayer: { type: 'string' }, generation: { type: ['integer', 'null'] } } },
  handler: async (principal, input, { deps }) => {
    const actor = await guardControlWrite(principal, deps, { action: 'ai.control.setGlobal', target: { kind: 'state', id: 'global' }, doing: 'turn AI on or off', reason: input.reason })
    if (input.aiEnabled === undefined && input.message === undefined && input.dbLayer === undefined) throw problem(400, 'invalid_request', 'Send aiEnabled, message or dbLayer.')
    try {
      return await deps.aiControlOps.setGlobal({ actor, aiEnabled: input.aiEnabled, message: input.message, dbLayer: input.dbLayer, reason: input.reason })
    } catch (error) {
      throw asProblem(error)
    }
  },
})
