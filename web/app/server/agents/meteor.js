// The Meteor side of agent tasks and the Slatebox agent: the collection, how callers are named,
// the agent's own registry (the person's session rule, as the in-app conversation uses), its AI
// (the same model and meter as the conversation), its replies in comment threads and its
// notifications, and the agentTasks.forSlate publication the canvas panel reads.
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { Mongo } from 'meteor/mongo'
import { AgentTasks, Comments, Messages, SlateApiTokens } from '../../imports/api/common/models'
import CONSTANTS from '../../imports/api/common/constants'
import { agentLabel, firstNameOf } from '../../imports/api/common/agent-label.mjs'
import { noteRequest } from '../../imports/api/common/note-requests.mjs'
import { lineRequest } from '../../imports/api/common/line-requests.mjs'
import { deps, exec as apiExec, idempotency, limiter } from '../actions/mount'
import { createAppRegistry } from '../actions/index.mjs'
import { renderExecTool } from '../actions/client-render.mjs'
import { createMeteorExec, readSlateByShareId } from '../exec/meteor'
import { aiQualifies, createCanvasConversation, sessionAuthorization } from '../exec/conversation.mjs'
import { resolvePresentationSlate } from '../methods/creative-slates'
import { modelFor } from '../methods/canvas-conversation'
import { canStartAI } from '../metering/meteor'
import { runAIAction } from '../metering/context.mjs'
import { OPEN_STATES, SLATEBOX_AGENT, createAgentTasks, publicTask } from './agentTasks.mjs'
import { createTeammate } from './teammate.mjs'
import { createDailyCap, createRunQueue, runLimits } from './queue.mjs'
import { selfHosted } from '../../imports/api/common/own-keys.mjs'

export const agentTasks = createAgentTasks({ collection: AgentTasks.rawCollection(), newId: () => Random.id() })

// How many runs go at once and how many a person starts a day (queue.mjs). The daily cap applies on
// Slatebox Cloud, where each run spends the person's Pro credits; self-host sets its own (or none
// beyond the concurrency caps) with settings.agents.dailyPerPerson.
const LIMITS = runLimits(Meteor.settings)
const queue = createRunQueue({ ...LIMITS, log: (error) => console.error('[agents]', error?.message) })
const AgentRunDays = new Mongo.Collection('agentRunDays')
const CLOUD = !selfHosted(Meteor.settings)
const dailyCap = CLOUD || Meteor.settings?.agents?.dailyPerPerson
  ? createDailyCap({ collection: AgentRunDays.rawCollection(), limit: LIMITS.dailyPerPerson })
  : null
const BUILTIN = Object.freeze({ key: SLATEBOX_AGENT.key, label: SLATEBOX_AGENT.label, builtin: true })

const drawable = (slate) => !slate.creative || slate.nativeCanvasDrawing || slate.creative.model?.kind === 'workshop'

// The Slatebox agent's registry: a principal is authorized by its account's session rule.
const registry = createAppRegistry({
  deps: {
    ...deps,
    authorizeTokenForSlate: async (token, shareId, write = false) =>
      sessionAuthorization(await resolvePresentationSlate(shareId, token.userId), token.userId, write),
  },
  idempotency,
  limiter,
})
const inApp = createMeteorExec({ registry, idempotency, readSlate: readSlateByShareId, pool: apiExec.pool })
const conversation = createCanvasConversation({
  registry,
  gate: inApp.gate,
  service: inApp.service,
  manifest: inApp.manifest,
  tool: (({ name, description, inputSchema }) => ({ name, description, parameters: inputSchema }))(renderExecTool(inApp.manifest).exec),
  presence: deps.presence,
})

export const teammate = createTeammate({
  tasks: agentTasks,
  registry,
  conversation,
  presence: deps.presence,
  async admit(task) {
    if (!dailyCap || (await dailyCap.take(task.assignedBy))) return null
    return `You have asked the Slatebox agent for ${dailyCap.limit} tasks today, the most for one day. It takes new tasks again after midnight UTC.`
  },
  async resolveBoard(shareId, userId) {
    const access = await resolvePresentationSlate(shareId, userId)
    return access?.canEdit && drawable(access.slateBase) ? access.slateBase : null
  },
  // AI for an account that may draft (on Cloud: Pro credits and top-ups, through the meter), for a
  // request that reads as prose; typed notes and lines are drawn directly, at no cost.
  async draft({ userId, text, board: given }, fn) {
    const user = await Meteor.users.findOneAsync(userId)
    const board = given || { nodes: [] }
    const prose = !noteRequest(text) && !lineRequest(board, text, null) && aiQualifies({ canGenerate: await canStartAI(user), message: text })
    if (!prose) return fn({ useAI: false, model: null })
    return runAIAction({ feature: 'workshop', userId }, () => fn({ useAI: true, model: modelFor(null) }))
  },
  // The answer goes where the task was asked: the note's comment thread.
  async reply({ task, text }) {
    if (!task.nodeId) return
    await Comments.insertAsync({
      timestamp: Date.now(),
      createdByUserId: 'slatebox-agent',
      createdByUserName: SLATEBOX_AGENT.label,
      mentionedTeamMembers: [],
      text: String(text).slice(0, 1000),
      read: false,
      priority: 5,
      slateId: task.slateId,
      nodeId: task.nodeId,
      resolved: false,
      fromAgent: true,
    })
  },
  async notify({ task, text }) {
    const to = task.askedBy?.userId
    if (!to) return
    await Messages.insertAsync({
      timestamp: Date.now(),
      userId: to,
      text: `${SLATEBOX_AGENT.label}: ${String(text).slice(0, 300)}`,
      read: false,
      priority: 5,
      slateId: task.slateId,
      ...(task.nodeId && { nodeId: task.nodeId }),
      type: CONSTANTS.messageTypes.system,
      action: { type: CONSTANTS.messageActionTypes.slate, toolTip: 'Go to the slate' },
    })
  },
})
// Every run goes through the bounded queue; a full queue fails the task with the reason, so nothing
// piles up unseen.
async function refuse(task, text) {
  const claimed = await agentTasks.claim(task.slateId, task._id, BUILTIN).catch(() => null)
  if (claimed) await agentTasks.finish(task.slateId, task._id, BUILTIN, 'failed', text).catch(() => null)
}
const BUSY = 'The Slatebox agent has too much waiting on this server right now. Ask again in a few minutes.'
function enqueue(key, owner, work, task) {
  const queued = queue.enqueue({ key, owner, work })
  if (queued === 'full') refuse(task, BUSY).catch((error) => console.error('[agents]', error?.message))
  return queued
}
const runTask = (task) => enqueue(task._id, task.assignedBy, () => teammate.run(task), task)

// The action layer reaches the store, the names and the Slatebox agent through deps.
deps.agentTasks = {
  store: agentTasks,
  async labelOf(principal) {
    const user = await Meteor.users.findOneAsync(principal.userId, { fields: { profile: 1, emails: 1 } })
    const first = firstNameOf(user)
    if (principal.kind !== 'agent') return first
    const token = principal.tokenId && !String(principal.tokenId).startsWith('session:')
      ? await SlateApiTokens.findOneAsync({ _id: principal.tokenId }, { fields: { lastClient: 1 } })
      : null
    return agentLabel(first, token?.lastClient)
  },
  onAssigned: (task) => runTask(task),
  onApproved: (approved) => enqueue(approved.task._id, approved.task.assignedBy, () => teammate.resume(approved), approved.task),
  // A canceled task that had not started leaves the queue; a running one stops before it saves.
  onCanceled: (task) => queue.cancel(task._id),
}

// agentTasks.forSlate(shareId): the slate's tasks (open, and those finished in the last day) as
// screens show them, for people who may edit the slate. Public viewers, guests and readers get none.
const RECENT_MS = 24 * 3600_000
Meteor.publish('agentTasks.forSlate', async function (shareId) {
  if (typeof shareId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(shareId)) return this.ready()
  const access = await resolvePresentationSlate(shareId, this.userId)
  if (!this.userId || !access?.canEdit || !access.slateBase?._id) return this.ready()
  const callerKey = this.userId ? 'user:' + this.userId : null
  const since = new Date(Date.now() - RECENT_MS)
  const shown = (doc) => {
    const { id: _id, ...fields } = publicTask(doc, { callerKey })
    return fields
  }
  const handle = await AgentTasks.find({ slateId: access.slateBase._id, $or: [{ status: { $in: [...OPEN_STATES] } }, { updatedAt: { $gte: since } }] })
    .observeAsync({
      added: (doc) => this.added('agentTasks', doc._id, shown(doc)),
      // A field a task no longer has (what it waited for) is cleared on screens too.
      changed: (doc) => this.changed('agentTasks', doc._id, { waiting: undefined, nodeId: undefined, ...shown(doc) }),
      removed: (doc) => this.removed('agentTasks', doc._id),
    })
  this.onStop(() => handle.stop())
  this.ready()
  return undefined
})

Meteor.startup(async () => {
  await agentTasks.ensureIndexes().catch((error) => console.error('[agents] indexes', error?.message))
  await dailyCap?.ensureIndexes().catch((error) => console.error('[agents] indexes', error?.message))
  // Claims that lapsed (a crash mid-run): free them, now and every minute.
  const sweep = () => agentTasks.expireClaims({ isRunning: (id) => queue.isActive(id) }).catch((error) => console.error('[agents] sweep', error?.message))
  await sweep()
  Meteor.setInterval(sweep, 60_000)
  // Tasks the Slatebox agent was given before a restart: pick them up, through the queue.
  const waiting = await AgentTasks.rawCollection().find({ assignee: 'slatebox', status: 'submitted' }).limit(LIMITS.queued).toArray()
  for (const task of waiting) runTask(task)
})
