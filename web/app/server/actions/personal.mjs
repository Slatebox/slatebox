// For you: smart components and printable pages Slatebox suggests for the signed-in person's work,
// from what they keep in About you and the names of the tools they connected, each built in a click.
// The person's own, for themselves only: a guest gets nothing (save the account first). A token
// reaches them with the About you permissions (profile:read to read them, profile:write to ask for
// new ones, turn one down or build one; building also needs slates:write, as it makes a slate).
//   personal.ideas.list      the ideas kept for them, whether About you changed since, and the empty
//                            state when there is nothing to suggest from
//   personal.ideas.refresh   new ideas: one metered request to the agent (personal.suggest)
//   personal.ideas.dismiss   "Not for me": gone, and never suggested again
//   personal.ideas.build     drafted for them, saved as their private library draft and opened on a
//                            new private slate
// The work is server/personal/core.mjs (deps.personal); the rules imports/api/common/personal-ideas.mjs.
import { defineAction, holdsScope, lacksScopeText } from './registry.mjs'
import { problem } from './errors.mjs'
import { IDEA_KINDS, IDEA_LIMITS } from '../../imports/api/common/personal-ideas.mjs'

// Calls per signed-in person, per minute (DDPRateLimiter in server/personal/meteor.js); refresh is
// also an AI method (metering/limits.mjs) and holds to IDEA_LIMITS.refreshesPerHour; a token's calls
// are counted by the registry's own limiter.
export const PERSONAL_RATE_LIMITS = Object.freeze({
  'personal.ideas.list': 30,
  'personal.ideas.refresh': 3,
  'personal.ideas.dismiss': 30,
  'personal.ideas.build': 3,
})

const serviceOf = (deps) => {
  if (!deps.personal) throw problem(501, 'not_available', 'For you is not available on this server.')
  return deps.personal
}

const ideaIdInput = { type: 'string', pattern: '^i[a-f0-9]{15}$', description: 'The idea, as personal.ideas.list gives it (ideas[].id).' }
const ideaSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    kind: { type: 'string', enum: [...IDEA_KINDS], description: 'component: a smart component (a board of lanes); grid: a printable page.' },
    why: { type: 'string', description: 'One line: what the person said or connected that it fits.' },
    brief: { type: 'string', description: 'What Build it drafts.' },
    tools: { type: 'array', items: { type: 'string' }, description: 'Connected tools it uses, by name.' },
    built: { type: 'object', properties: { shareId: { type: 'string' }, itemId: { type: 'string' } }, description: 'Once built: the slate it opened on and its library draft.' },
  },
  required: ['id', 'title', 'kind', 'why', 'brief', 'tools'],
}
const ideasOutput = {
  type: 'object',
  properties: {
    on: { type: 'boolean', description: 'Personalization is on.' },
    ideas: { type: 'array', items: ideaSchema },
    empty: { type: ['object', 'null'], properties: { code: { type: 'string', enum: ['personalization-off', 'nothing-known'] }, message: { type: 'string' } }, description: 'Why there is nothing to suggest from (no request was made).' },
    stale: { type: 'boolean', description: 'About you changed since these ideas were made: refresh for ones that fit it now (a stale idea is not built).' },
    createdAt: { type: ['string', 'null'] },
    canRefresh: { type: 'boolean' },
  },
  required: ['on', 'ideas', 'empty', 'stale', 'createdAt', 'canRefresh'],
}
const empty = { type: 'object', properties: {}, additionalProperties: false }

const list = defineAction({
  id: 'personal.ideas.list',
  title: 'Ideas made for you',
  description:
    'The smart components and printable pages Slatebox suggested for your work (For you), each with why it fits and what Build it makes, from what you keep in About you and the tools you connected. Asks nothing of the agent. Only you see them.',
  toolset: 'account',
  kind: 'read',
  scope: 'profile:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/personal/ideas', operationId: 'listPersonalIdeas' } },
  input: empty,
  output: ideasOutput,
  tool: { name: 'list_ideas_for_you', title: 'Read the ideas made for the person', description: 'Read the smart components and printable pages Slatebox suggested for the person\'s work, each with why it fits.' },
  handler: (principal, _input, { deps }) => serviceOf(deps).list(principal),
})

const refresh = defineAction({
  id: 'personal.ideas.refresh',
  title: 'Get new ideas made for you',
  description:
    `Asks the agent for ${IDEA_LIMITS.min} to ${IDEA_LIMITS.max} new ideas made for your work, from what you keep in About you and the names of the tools you connected; they replace the ones shown. One metered request, up to ${IDEA_LIMITS.refreshesPerHour} an hour. With personalization off, or nothing known about you yet, nothing is asked and the empty state says what to do.`,
  toolset: 'account',
  kind: 'write',
  changesNoSlate: true,
  scope: 'profile:write',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/personal/ideas/refresh', operationId: 'refreshPersonalIdeas' } },
  idempotency: 'optional',
  successStatus: 200,
  input: empty,
  output: ideasOutput,
  failure: { code: 'suggest_failed', message: 'Slatebox could not suggest ideas just now. Try again.' },
  tool: { name: 'refresh_ideas_for_you', title: 'Get new ideas made for the person', description: 'Ask Slatebox for new smart components and printable pages made for the person\'s work, from their About you and connected tools.' },
  handler: (principal, _input, { deps }) => serviceOf(deps).refresh(principal),
})

const dismiss = defineAction({
  id: 'personal.ideas.dismiss',
  title: 'Not for me',
  description: 'Turns down one idea: it goes, and the agent is not asked for it again.',
  toolset: 'account',
  kind: 'write',
  changesNoSlate: true,
  scope: 'profile:write',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/personal/ideas/{ideaId}/dismiss', operationId: 'dismissPersonalIdea' } },
  idempotency: 'optional',
  successStatus: 200,
  input: { type: 'object', properties: { ideaId: ideaIdInput }, required: ['ideaId'], additionalProperties: false },
  output: { type: 'object', properties: { ideaId: { type: 'string' }, dismissed: { const: true } }, required: ['ideaId', 'dismissed'] },
  failure: { code: 'dismiss_failed', message: 'That could not be changed. Retry.' },
  tool: { name: 'dismiss_idea_for_you', title: 'Turn down an idea made for the person', description: 'Turn down one idea made for the person, so it is not suggested again.' },
  handler: (principal, input, { deps }) => serviceOf(deps).dismiss(principal, input),
})

const build = defineAction({
  id: 'personal.ideas.build',
  title: 'Build an idea made for you',
  description:
    'Builds one idea: the agent drafts it from your words (metered as a board draft), it is saved as your own private smart component in the library, and it opens on a new private slate. An idea built already answers the slate it opened on. A stale idea (About you changed since) is refused with 409 ideas_stale: refresh first. A token also needs slates:write.',
  toolset: 'account',
  kind: 'write',
  scope: 'profile:write',
  alsoScopes: ['slates:write'],
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/personal/ideas/{ideaId}/build', operationId: 'buildPersonalIdea' } },
  idempotency: 'optional',
  input: { type: 'object', properties: { ideaId: ideaIdInput }, required: ['ideaId'], additionalProperties: false },
  output: {
    type: 'object',
    properties: {
      ideaId: { type: 'string' },
      kind: { type: 'string', enum: [...IDEA_KINDS] },
      title: { type: 'string' },
      itemId: { type: 'string', description: 'Your library draft.' },
      shareId: { type: 'string', description: 'The new private slate it opened on.' },
      built: { type: 'boolean', description: 'false: it was built already, and this is that slate.' },
    },
    required: ['ideaId', 'kind', 'title', 'itemId', 'shareId', 'built'],
  },
  failure: { code: 'build_failed', message: 'That could not be built just now. Try again.' },
  tool: { name: 'build_idea_for_you', title: 'Build an idea made for the person', description: 'Build one idea made for the person: drafted from their words, saved as their private library draft, opened on a new private slate.' },
  precheck(principal) {
    if (principal.kind === 'agent' && !holdsScope(principal, 'slates:write')) throw problem(403, 'insufficient_scope', lacksScopeText(principal, 'slates:write', ', which building needs (it makes a slate)'), { details: { requiredScope: 'slates:write' } })
  },
  handler(principal, input, { deps }) {
    build.precheck(principal, input)
    return serviceOf(deps).build(principal, input)
  },
})

export default [list, refresh, dismiss, build]
