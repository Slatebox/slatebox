// Comments on a slate's notes, by the rules the comment drawer follows (the drawer posts through
// comments.add too, server/methods/comments.js resolves and removes):
//   read                anyone who may open the slate (a token acts as its account)
//   add, resolve        the slate's comment role: COMMENT or EDIT by its sharing (owner decision
//                       2026-11-23), never plain read access
//   remove              your own comment; the Slatebox agent's replies, by anyone who may edit
// "@Slatebox ..." in a comment asks the Slatebox agent here, on the server, whichever surface
// posted it (the drawer, REST, MCP add_comment, exec).
// slates.get counts each note's comments; these read and write the comments themselves.
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { loadSlate } from './slate-access.mjs'
import { shareIdInput } from './slate-schemas.mjs'
import { slateboxRequest } from '../../imports/api/common/agent-mention.mjs'

const noteId = { type: 'string', minLength: 1, maxLength: 128, description: 'The note\'s id, as slates.get gives it.' }
const commentId = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' }

const comment = {
  type: 'object',
  properties: {
    commentId: { type: 'string' },
    noteId: { type: 'string' },
    author: { type: 'string' },
    yours: { type: 'boolean' },
    text: { type: 'string' },
    resolved: { type: 'boolean' },
    created: { type: ['string', 'null'] },
  },
  required: ['commentId', 'noteId', 'author', 'text', 'resolved'],
}

export const commentEntry = (row, userId) => ({
  commentId: row._id,
  noteId: row.nodeId,
  author: row.createdByUserName || '',
  yours: row.createdByUserId === userId,
  text: row.text || '',
  resolved: Boolean(row.resolved),
  created: row.timestamp ? new Date(row.timestamp).toISOString() : null,
})

const COMMENT_ROLES = ['COMMENT', 'EDIT']
const noCommentRole = () =>
  problem(403, 'comment_role_required', 'Your role on this slate does not include commenting. Ask its owner to share it with you as a commenter.')

// A token by its account's role on the slate (authorizeTokenForSlate); a signed-in page (the
// drawer) by the session's rule (deps.canComment, or the edit right where that is not given).
const loadCommenter = async (principal, input, ctx) => {
  if (principal.kind === 'person') {
    const found = await ctx.deps.resolveSlateForUser(input.shareId, principal.userId)
    if (!found?.slate || !found.canRead) throw problem(404, 'not_found', 'Slate not found or unavailable.')
    const may = found.canEdit || (ctx.deps.canComment ? await ctx.deps.canComment(found.slate, principal.userId) : false)
    if (!may) throw noCommentRole()
    ctx.access = { canEdit: Boolean(found.canEdit), role: found.canEdit ? 'EDIT' : 'COMMENT' }
    return found.slate
  }
  const slate = await loadSlate(false)(principal, input, ctx)
  if (!ctx.access?.canEdit && !COMMENT_ROLES.includes(ctx.access?.role)) throw noCommentRole()
  return slate
}

// "@Slatebox ..." asks the Slatebox agent, as the commenter, when they may edit the slate (the agent
// works with the asker's rights). The comment is kept either way; agentNote says why no task.
async function askFromComment({ principal, deps, slate, canEdit, text, nodeId, commentId }) {
  const request = slateboxRequest(text)
  const tasks = deps.agentTasks
  if (!request || !tasks?.store) return {}
  if (!canEdit) return { agentNote: 'The Slatebox agent works only for people who can edit this slate, so it was not asked.' }
  try {
    const label = await tasks.labelOf(principal, slate)
    const doc = await tasks.store.create({ slate, by: { userId: principal.userId, label }, text: request, assignee: 'slatebox', nodeId, commentId })
    tasks.onAssigned?.(doc)
    return { agentTask: doc._id }
  } catch (error) {
    return { agentNote: String(error?.message || 'The Slatebox agent could not take that.').slice(0, 200) }
  }
}

const hasNote = (slate, id) => (slate.nodes || []).some((node) => node?.options?.id === id)
const noNote = () => problem(404, 'not_found', 'There is no note with that id on this slate.')

export const commentsList = defineAction({
  id: 'comments.list',
  title: 'Comments',
  description:
    'Read the comments on a slate\'s notes, oldest first, or on one note (noteId): each one\'s author, text and whether its note\'s comments are resolved. Comment text is written by people.',
  toolset: 'slates',
  kind: 'read',
  scope: 'slates:read',
  principals: ['agent'],
  mounts: { http: { method: 'GET', path: '/slates/{shareId}/comments', operationId: 'listComments' } },
  input: {
    type: 'object',
    properties: { shareId: shareIdInput, noteId, unresolved: { type: 'boolean', default: false, description: 'Only comments not yet resolved.' } },
    required: ['shareId'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { comments: { type: 'array', items: comment } }, required: ['comments'] },
  load: loadSlate(false),
  tool: { name: 'list_comments', title: 'Read comments', description: 'Read the comments people left on a slate\'s notes, or on one note: the team\'s feedback on a diagram, plan or board.' },
  async handler(principal, input, { deps, resource: slate }) {
    const rows = await deps.comments.list({ slateId: slate._id, nodeId: input.noteId, unresolved: input.unresolved })
    return { comments: rows.map((row) => commentEntry(row, principal.userId)) }
  },
})

export const commentsAdd = defineAction({
  id: 'comments.add',
  title: 'Comment',
  description:
    'Comment on a note, as yourself, the way the comment drawer does; needs the slate\'s comment role. The comment is shown with your name to everyone who opens the slate. "@Slatebox ..." asks the Slatebox agent (if you may edit).',
  toolset: 'slates',
  kind: 'write',
  scope: 'slates:write',
  principals: ['person', 'agent'],
  // A retried comment answers the first instead of posting it twice.
  idempotency: 'optional',
  mounts: { ddp: true, http: { method: 'POST', path: '/slates/{shareId}/comments', operationId: 'addComment' } },
  input: {
    type: 'object',
    properties: { shareId: shareIdInput, noteId, text: { type: 'string', minLength: 1, maxLength: 4000 } },
    required: ['shareId', 'noteId', 'text'],
    additionalProperties: false,
  },
  output: {
    ...comment,
    properties: {
      ...comment.properties,
      agentTask: { type: 'string', description: 'The agent task a "@Slatebox ..." comment started.' },
      agentNote: { type: 'string', description: 'Why a "@Slatebox ..." comment started no task.' },
    },
  },
  load: loadCommenter,
  tool: { name: 'add_comment', title: 'Comment on a note', description: 'Leave a comment on a note of a shared slate, under the person\'s name, where the team sees it live.' },
  async handler(principal, input, { deps, now, resource: slate, access }) {
    if (!hasNote(slate, input.noteId)) throw noNote()
    const text = input.text.trim()
    if (!text) throw problem(400, 'invalid_request', 'Write the comment.')
    const row = {
      timestamp: now(),
      createdByUserId: principal.userId,
      createdByUserName: (await deps.userName(principal.userId)) || '',
      mentionedTeamMembers: [],
      text,
      read: false,
      priority: 5,
      slateId: slate._id,
      nodeId: input.noteId,
      resolved: false,
    }
    const id = await deps.comments.add(row)
    const asked = await askFromComment({ principal, deps, slate, canEdit: Boolean(access?.canEdit), text, nodeId: input.noteId, commentId: id })
    return { ...commentEntry({ ...row, _id: id }, principal.userId), ...asked }
  },
})

export const commentsResolve = defineAction({
  id: 'comments.resolve',
  title: 'Resolve',
  description:
    'Mark the comments on a note resolved, or open them again (resolved: false), as the comment drawer does; needs the slate\'s comment role.',
  toolset: 'slates',
  kind: 'write',
  scope: 'slates:write',
  principals: ['agent'],
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  mounts: { http: { method: 'POST', path: '/slates/{shareId}/comments/resolve', operationId: 'resolveComments' } },
  input: {
    type: 'object',
    properties: { shareId: shareIdInput, noteId, resolved: { type: 'boolean', default: true } },
    required: ['shareId', 'noteId'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: { noteId: { type: 'string' }, resolved: { type: 'boolean' }, comments: { type: 'integer' } },
    required: ['noteId', 'resolved', 'comments'],
  },
  successStatus: 200,
  load: loadCommenter,
  tool: { name: 'resolve_comments', title: 'Resolve a note\'s comments', description: 'Mark the comments on a note resolved, or open them again.' },
  async handler(_principal, input, { deps, resource: slate }) {
    if (!hasNote(slate, input.noteId)) throw noNote()
    const comments = await deps.comments.resolve({ slateId: slate._id, nodeId: input.noteId, resolved: input.resolved })
    return { noteId: input.noteId, resolved: input.resolved, comments }
  },
})

export const commentsRemove = defineAction({
  id: 'comments.remove',
  title: 'Uncomment',
  description: 'Remove a comment you wrote on a slate (or, if you may edit it, a Slatebox agent reply).',
  toolset: 'slates',
  kind: 'write',
  scope: 'slates:delete',
  principals: ['agent'],
  destructive: true,
  idempotency: 'optional',
  mounts: { http: { method: 'DELETE', path: '/slates/{shareId}/comments/{commentId}', operationId: 'removeComment' } },
  input: { type: 'object', properties: { shareId: shareIdInput, commentId }, required: ['shareId', 'commentId'], additionalProperties: false },
  output: { type: 'object', properties: { commentId: { type: 'string' }, removed: { type: 'boolean' } }, required: ['commentId', 'removed'] },
  successStatus: 200,
  load: loadSlate(false),
  tool: { name: 'remove_comment', title: 'Remove your comment', description: 'Remove a comment the person wrote on a slate.' },
  async handler(principal, input, { deps, resource: slate, access }) {
    const row = await deps.comments.get({ slateId: slate._id, commentId: input.commentId })
    if (!row) throw problem(404, 'not_found', 'There is no such comment on this slate.')
    const agentReply = row.fromAgent === true && row.createdByUserId === 'slatebox-agent'
    if (row.createdByUserId !== principal.userId && !(agentReply && access?.canEdit))
      throw problem(403, 'forbidden', 'Only its author can remove a comment; the Slatebox agent\'s replies, whoever may edit the slate.')
    await deps.comments.remove({ slateId: slate._id, commentId: input.commentId })
    return { commentId: input.commentId, removed: true }
  },
})

export default [commentsList, commentsAdd, commentsResolve, commentsRemove]
