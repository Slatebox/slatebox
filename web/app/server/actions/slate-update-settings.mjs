// The slate settings the canvas page changes on its own (the AI conversation switch, the welcome
// conversation it started, the files attached to the conversation). The browser used to write
// these straight to the slates collection; now they are saved here, through the save core, by
// anyone who may edit the slate. Visibility is not a setting: it changes through sharing.
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { shareIdInput } from './slate-schemas.mjs'
import { sharedSaveConditions } from '../methods/native-slate-save.mjs'

const uploadedFile = {
  type: 'object',
  properties: {
    fileName: { type: 'string', minLength: 1, maxLength: 260 },
    url: { type: 'string', maxLength: 2048, pattern: '^https?://[^\\s<>"]+$' },
    pending: { type: 'boolean' },
  },
  required: ['fileName'],
  additionalProperties: false,
}

export default defineAction({
  id: 'slates.updateSettings',
  title: 'Change a slate setting',
  description:
    "Turn the slate's AI conversation on or off, record the welcome conversation it started, or set the files attached to the conversation. Only someone who may edit the slate can.",
  toolset: 'slates',
  kind: 'write',
  scope: 'slates:write',
  principals: ['person', 'guest'],
  mounts: { ddp: true },
  input: {
    type: 'object',
    properties: {
      shareId: shareIdInput,
      aiConversation: {
        type: 'object',
        properties: { active: { type: 'boolean' }, dormant: { type: 'boolean' } },
        additionalProperties: false,
      },
      welcomeAid: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' },
      uploadedFiles: { type: 'array', maxItems: 3, items: uploadedFile },
    },
    required: ['shareId'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: { shareId: { type: 'string' }, revision: { type: 'integer', minimum: 0 } },
    required: ['shareId', 'revision'],
  },
  async load(principal, input, { deps }) {
    const found = await deps.resolveSlateForUser(input.shareId, principal.userId)
    if (!found?.canEdit) throw problem(404, 'not_found', 'Slate not found or unavailable.')
    return found.slate
  },
  async handler(principal, input, { deps, resource: slate }) {
    const set = {}
    for (const key of ['active', 'dormant'])
      if (input.aiConversation?.[key] !== undefined) set[`options.ai.isConversation.${key}`] = input.aiConversation[key]
    if (input.welcomeAid !== undefined) set['options.welcomeAid'] = input.welcomeAid
    if (input.uploadedFiles !== undefined) set['options.uploadedFiles'] = input.uploadedFiles
    if (!Object.keys(set).length) throw problem(400, 'invalid_request', 'Name a setting to change.')
    try {
      const saved = await deps.saveCore.save({
        slateId: slate._id,
        actor: principal,
        source: 'settings',
        // The edit right was read at load; a collaborator's rests on sharing, so the save holds
        // only while sharing is as it was read (the condition every content writer uses).
        conditions: { userId: slate.userId, ...sharedSaveConditions(slate, principal.userId) },
        build: () => ({ set }),
      })
      return { shareId: slate.shareId, revision: saved.revision }
    } catch (error) {
      if (error?.code === 'save_refused') throw problem(404, 'not_found', 'Slate not found or unavailable.')
      throw error
    }
  },
})
