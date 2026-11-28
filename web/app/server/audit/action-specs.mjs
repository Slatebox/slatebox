/* eslint-disable no-underscore-dangle */
// What the activity log keeps of each registry write (server/actions/registry.mjs records it after
// a successful save). Every write action has exactly one entry, here or as `audit` on its own
// definition; scripts/audit-coverage.test.mjs fails the build for a write that has none, so a new
// action cannot skip the log. Writes that change nothing (readOnly) need none.
//
//   { action, target(input, output), details?(input, output), orgId?(input, output),
//     scope?(input, output), coalesce? }
//       the registry records this entry (in the team orgId names, or the log scope names; else
//       the slate's team, else the caller's)
//   { inside: why }
//       the action's own path records it (the save core for every slate write, deleteOwnedSlate
//       for a delete, the action's handler): the registry records nothing more
//   { off: why }
//       not team activity on slates (a person's own settings, the agent configuration, which
//       keeps its own audit, ai.audit.list)
//
// Whatever the spec, a save by an agent's token that left no entry of its own is recorded as
// agent.write with the action's id, unless the spec says agentWrite: false (and why): every
// write by a token, an MCP client, a script or an invited integration is in the log.

const SHARE_ID = /^[A-Za-z0-9_-]{1,80}$/
const shareIdOf = (input, output) => [output?.shareId, input?.shareId].find((id) => typeof id === 'string' && SHARE_ID.test(id)) || null

// A slate the action names by its share id: the log looks up its name and team.
export const slateTarget = (input, output) => {
  const id = shareIdOf(input, output)
  return id ? { type: 'slate', id } : null
}

const SAVE_CORE = 'the save core records the slate created, copied, renamed or edited (server/audit/slate-entries.mjs)'
const OWN_ABOUT_YOU = "the person's own About you, not team activity"
const AI_CONTROL = 'the agent configuration keeps its own audit (ai.audit.list)'
const START_TILES = "the person's own start page"
const PROJECTS_CORE = 'the projects core records project.* (server/projects/core.mjs)'

const own = (action, extra = {}) => ({ action, target: slateTarget, ...extra })

export const ACTION_AUDIT = Object.freeze({
  // Slates
  'slates.create': { inside: SAVE_CORE },
  'slates.applyOperations': { inside: SAVE_CORE },
  'slates.updateSettings': { inside: SAVE_CORE },
  'slates.copy': { inside: SAVE_CORE },
  'slates.importMermaid': { inside: SAVE_CORE },
  'slates.undo': { inside: SAVE_CORE },
  'slates.redo': { inside: SAVE_CORE },
  'slates.addMedia': { inside: SAVE_CORE },
  'slates.addPhoto': { inside: SAVE_CORE },
  'slates.delete': { inside: 'deleteOwnedSlate records slate.deleted (server/methods/slates.js)' },
  'shapes.apply': { inside: SAVE_CORE },
  'shapes.generate': { off: 'draws shapes into the shape library; it changes no slate' },
  'suggestions.decide': { inside: SAVE_CORE },
  'presentations.setStyle': { inside: SAVE_CORE },
  'presentations.create': { off: 'a presentation stays private until it is published (presentations.publish is recorded)' },
  'presence.plan': { off: "an agent's pointer and plan on the canvas; it changes no slate", agentWrite: false },
  'presence.step': { off: "an agent's pointer and plan on the canvas; it changes no slate", agentWrite: false },
  'agents.control': { off: 'pauses or resumes agents on a slate; their changes are recorded as theirs' },
  'agentTasks.create': { off: 'a request to an agent on the slate; what the agent changes is recorded as its own' },
  'agentTasks.update': { off: 'a request to an agent on the slate; what the agent changes is recorded as its own' },
  'media.lookup': { off: "reads a video's title and poster; it changes nothing" },
  // Sharing
  'slates.issueInvite': own('sharing.inviteIssued', { details: (input) => ({ role: input.role }) }),
  'slates.revokeInvite': own('sharing.inviteRevoked'),
  // Comments (never their text)
  'comments.add': own('comment.added'),
  'comments.resolve': own('comment.resolved'),
  'comments.remove': own('comment.removed'),
  // Export and import
  'team.export': { action: 'export.team', target: () => ({ type: 'team' }) },
  'teamImports.start': { off: 'hands out an upload address; nothing changes until the import is confirmed' },
  'teamImports.confirm': { action: 'import.team', target: (_input, output) => ({ type: 'team', id: output?.teamId }), orgId: (_input, output) => output?.teamId, details: () => ({ method: 'import' }) },
  'teamImports.invite': { off: 'an invitation to claim an imported placeholder; joining is recorded' },
  'teamImports.discard': { off: 'a pending import that never went live' },
  'teamMove.start': { off: 'hands out an upload address; nothing changes until the move is confirmed' },
  'teamMove.confirm': { action: 'move.team', target: (_input, output) => ({ type: 'team', id: output?.teamId }), orgId: (_input, output) => output?.teamId, details: () => ({ method: 'move' }) },
  'teamMove.invite': { off: 'an invitation to join a moved team; joining is recorded' },
  'teamMove.join': { action: 'member.joined', target: (_input, output) => ({ type: 'team', id: output?.teamId, name: output?.teamName }), orgId: (_input, output) => output?.teamId },
  'teamMove.discard': { off: 'a pending move that never went live' },
  // Agents and API
  'apiTokens.create': { action: 'token.created', target: (_input, output) => ({ type: 'token', id: output?.id || output?._id, name: output?.name }), details: (_input, output) => ({ scope: (output?.scopes || []).join(' ') }) },
  'apiTokens.revoke': { action: 'token.revoked', target: (input) => ({ type: 'token', id: input.tokenId }) },
  'exec.run': { off: 'each call the script makes is recorded as that call', agentWrite: false },
  // The library
  'library.submit': { action: 'library.submitted', target: (input, output) => ({ type: 'library', id: output?.itemId || input.itemId, name: input.title }) },
  'library.review.approve': { action: 'library.published', target: (input) => ({ type: 'library', id: input.itemId }) },
  'library.review.unpublish': { action: 'library.unpublished', target: (input) => ({ type: 'library', id: input.itemId }) },
  'library.review.open': { off: "opens a submission's review copy for a reviewer" },
  'library.review.refine': { off: "a reviewer's draft change to a submission, kept in the library's own events" },
  'library.review.update': { off: "a reviewer's change to a submission's listing, kept in the library's own events" },
  'library.review.requestChanges': { off: "the reviewer's answer to the submitter, kept in the library's own events" },
  'library.review.reject': { off: "the reviewer's answer to the submitter, kept in the library's own events" },
  'library.fork': { inside: SAVE_CORE },
  'library.branch': { inside: SAVE_CORE },
  'library.saveDraft': { off: 'a private draft of a library listing' },
  'library.withdraw': { off: 'takes back a submission before review' },
  'library.discard': { off: 'discards a private draft' },
  'library.comment': { off: "a review conversation, kept in the library's own events" },
  // The person's own
  'profile.facts.add': { off: OWN_ABOUT_YOU },
  'profile.facts.update': { off: OWN_ABOUT_YOU },
  'profile.facts.hide': { off: OWN_ABOUT_YOU },
  'profile.facts.remove': { off: OWN_ABOUT_YOU },
  'profile.facts.clear': { off: OWN_ABOUT_YOU },
  'profile.settings.set': { off: OWN_ABOUT_YOU },
  'personal.ideas.refresh': { off: OWN_ABOUT_YOU },
  'personal.ideas.dismiss': { off: OWN_ABOUT_YOU },
  'personal.ideas.build': { inside: SAVE_CORE },
  'start.tiles.rename': { off: START_TILES },
  'start.tiles.remove': { off: START_TILES },
  'start.tiles.build': { inside: SAVE_CORE },
  'start.tiles.rebuild': { inside: SAVE_CORE },
  // The agent configuration (AI control)
  'ai.update': { off: AI_CONTROL },
  'ai.control.reset': { off: AI_CONTROL },
  'ai.control.setGlobal': { off: AI_CONTROL },
  'ai.providers.add': { off: AI_CONTROL },
  'ai.providers.save': { off: AI_CONTROL },
  'ai.providers.archive': { off: AI_CONTROL },
  'ai.keys.add': { off: AI_CONTROL },
  'ai.keys.activate': { off: AI_CONTROL },
  'ai.keys.rotate': { off: AI_CONTROL },
  'ai.keys.revoke': { off: AI_CONTROL },
  'ai.keys.remove': { off: AI_CONTROL },
  'ai.models.save': { off: AI_CONTROL },
  'ai.models.remove': { off: AI_CONTROL },
  'ai.bindings.set': { off: AI_CONTROL },
  'ai.prompts.saveDraft': { off: AI_CONTROL },
  'ai.prompts.test': { off: AI_CONTROL },
  'ai.prompts.publish': { off: AI_CONTROL },
  'ai.prompts.rollback': { off: AI_CONTROL },
  // Projects: the projects core records each change (project.*) with its project and details
  'projects.create': { inside: PROJECTS_CORE },
  'projects.update': { inside: PROJECTS_CORE },
  'projects.delete': { inside: PROJECTS_CORE },
  'projects.moveSlate': { inside: PROJECTS_CORE },
  'projects.share': { inside: PROJECTS_CORE },
  // The activity log itself
  'audit.export': { action: 'audit.exported', target: () => ({ type: 'log' }), scope: (_input, output) => output?.team, details: (input) => ({ format: String(input.format || 'csv').toUpperCase() }) },
  'audit.recordDownload': { inside: 'its handler records export.download' },

  // Enterprise code (enterprise/server): integrations, free everywhere
  'connectors.signIn': { off: 'opens a sign-in window for a server being connected; connecting is recorded' },
  'connectors.useKey': { off: 'gives a key to a server being connected; connecting is recorded' },
  'connectors.connect': own('integration.invited'),
  'connectors.disconnect': { action: 'integration.removed', target: (input) => ({ type: 'integration', id: input.connectionId }) },
  'connectors.call': { inside: SAVE_CORE },
  'connectors.approve': { action: 'integration.approved', target: (input) => ({ type: 'integration', id: input.cardId }) },
  'connectors.decline': { off: 'declining keeps nothing' },
  'connectors.setActing': { action: 'integration.changed', target: (input) => ({ type: 'integration', id: input.connectionId }), details: () => ({ actionId: 'connectors.setActing' }) },
  'integrations.useKey': { off: 'gives a key to a server being connected; connecting is recorded' },
  'integrations.connect': { action: 'integration.changed', target: (_input, output) => ({ type: 'integration', id: output?.integrationId, name: output?.name }), details: () => ({ actionId: 'integrations.connect' }) },
  'integrations.setRule': { action: 'integration.changed', target: (input, output) => ({ type: 'integration', id: input.integrationId, name: output?.name }), details: () => ({ actionId: 'integrations.setRule' }) },
  'integrations.setActing': { action: 'integration.changed', target: (input, output) => ({ type: 'integration', id: input.integrationId, name: output?.name }), details: () => ({ actionId: 'integrations.setActing' }) },
  'integrations.allowChanges': { action: 'integration.changed', target: (input, output) => ({ type: 'integration', id: input.integrationId, name: output?.name }), details: () => ({ actionId: 'integrations.allowChanges' }) },
  'integrations.disconnect': { action: 'integration.changed', target: (input, output) => ({ type: 'integration', id: input.integrationId, name: output?.name }), details: () => ({ actionId: 'integrations.disconnect' }) },
  'integrations.invite': own('integration.invited'),
  'integrations.applyRules': own('integration.invited', { details: (_input, output) => ({ count: Array.isArray(output?.joined) ? output.joined.length : 0 }) }),
  'integrations.setSlateSetting': own('integration.changed', { details: (input) => ({ actionId: 'integrations.setSlateSetting', mode: input.outsideAgents }) }),
  'google.connect': { action: 'integration.changed', target: () => ({ type: 'integration', name: 'Google' }), details: () => ({ actionId: 'google.connect' }) },
  'google.saveToDrive': own('export.google', { details: (input) => ({ format: `Drive, ${input.format || 'file'}` }) }),
  'google.exportDoc': own('export.google', { details: () => ({ format: 'Docs' }) }),
  'google.exportSlides': own('export.google', { details: () => ({ format: 'Slides' }) }),
  'google.importFile': { inside: SAVE_CORE },
  'google.attachFiles': { off: "lists Drive files beside a slate; it changes no slate's content" },
  'ai.agents.gallery.save': { off: AI_CONTROL },
  'ai.agents.gallery.reorder': { off: AI_CONTROL },
  'connectors.apps.set': { off: AI_CONTROL },
  'connectors.apps.clear': { off: AI_CONTROL },
})

/** Checks one spec's shape. → null, or what is wrong with it. */
export function specProblem(spec) {
  if (!spec || typeof spec !== 'object') return 'is not an object'
  const why = (value) => typeof value === 'string' && value.trim().length >= 8
  if (spec.agentWrite !== undefined && (spec.agentWrite !== false || !why(spec.off || spec.inside))) return 'agentWrite is only false, with a reason'
  if ('off' in spec) return why(spec.off) && !('action' in spec) && !('inside' in spec) ? null : 'off needs a reason, and no action'
  if ('inside' in spec) return why(spec.inside) && !('action' in spec) ? null : 'inside needs a reason, and no action'
  if (typeof spec.action !== 'string') return 'needs an action, inside or off'
  if (typeof spec.target !== 'function') return 'needs target(input, output)'
  for (const key of ['details', 'orgId', 'scope']) if (spec[key] !== undefined && typeof spec[key] !== 'function') return `${key} is a function`
  return null
}
