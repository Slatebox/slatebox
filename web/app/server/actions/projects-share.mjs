// Share a project like a drive: a person (by account or address), the caller's team, or anyone with
// the link, at a role; role "none" (link "none") takes it away. It widens who can open every slate
// in the project, so a script holds it for the person to agree.
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { projectAccessOutput, projectIdInput, projectsOf } from './project-schemas.mjs'
import { GRANTABLE_ROLES, LINK_ROLES } from '../../imports/api/common/project-roles.mjs'

function checkForm(_principal, input) {
  const forms = ['userId', 'email', 'orgId', 'link'].filter((key) => input[key] !== undefined)
  if (forms.length !== 1) throw problem(400, 'invalid_request', 'Share with one of: userId, email, orgId (your team), or link.')
  if (input.link === undefined && input.role === undefined) throw problem(400, 'invalid_request', 'Give the role (or "none" to take access away).')
  if (input.link !== undefined && input.role !== undefined) throw problem(400, 'invalid_request', 'A link takes link, not role.')
  if (input.rotate !== undefined && input.link === undefined) throw problem(400, 'invalid_request', 'rotate is for the link.')
}

export default defineAction({
  id: 'projects.share',
  title: 'Share project',
  description:
    'Share a project, as a shared drive is shared: with one person (userId, or email, which invites an address that has no account yet), with your whole team (orgId, your own team, if you may make team slates), or with anyone who has the link (link). Roles: viewer opens every slate, commenter comments too, editor edits and adds slates and folders, manager also organizes and shares. role "none" (or link "none") takes access away; rotate makes a new link and turns the old one off. The project\'s owner and managers may share it.',
  toolset: 'projects',
  kind: 'write',
  scope: 'projects:share',
  principals: ['person', 'agent'],
  // widens who can open every slate in the project
  confirm: true,
  idempotency: 'optional',
  successStatus: 200,
  mounts: { ddp: true, http: { method: 'POST', path: '/projects/{projectId}/access', operationId: 'shareProject' } },
  input: {
    type: 'object',
    properties: {
      projectId: projectIdInput,
      userId: { type: 'string', minLength: 1, maxLength: 128 },
      email: { type: 'string', minLength: 3, maxLength: 320, format: 'email' },
      orgId: { type: 'string', minLength: 1, maxLength: 128, description: 'Your team, to share with everyone in it.' },
      role: { type: 'string', enum: GRANTABLE_ROLES, description: 'For a person or a team.' },
      link: { type: 'string', enum: LINK_ROLES, description: 'What anyone with the link can do.' },
      rotate: { type: 'boolean', description: 'With link: make a new link address; the old one stops working.' },
    },
    required: ['projectId'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { ...projectAccessOutput.properties, mode: { type: 'string' } }, required: projectAccessOutput.required },
  tool: { name: 'share_project', title: 'Share a project', description: 'Share one of the person\'s projects with a person, their team or anyone with the link, at a role, or take access away.' },
  precheck: checkForm,
  async handler(principal, input, { deps }) {
    checkForm(principal, input)
    const { projectId, ...share } = input
    return projectsOf(deps).share(principal, projectId, share)
  },
})
