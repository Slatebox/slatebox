// The Meteor side of agent-client counting (usage-core.mjs): the two collections, the recorder
// the /mcp endpoint, /api/v1 and the app's actions report to, and the reads the admin Overview's
// Agents card makes. Counts only; nothing a person wrote or an agent asked is stored.
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { SlateApiTokens } from '../../imports/api/common/models'
import { derivedToolName } from '../actions/agent-surface.mjs'
import { clientFromUserAgent, createAgentUsage, ensureAgentUsageIndexes } from './usage-core.mjs'

const AgentClientDays = new Mongo.Collection('agentClientDays')
const AgentFirstActions = new Mongo.Collection('agentFirstActions')
const days = AgentClientDays.rawCollection()
const firsts = AgentFirstActions.rawCollection()

export const agentUsage = createAgentUsage({ days, firsts })

/** The client a token's MCP connection last named (kept on the token for the canvas label). */
export async function lastClientOf(principal) {
  if (!principal?.tokenId) return null
  const token = await SlateApiTokens.findOneAsync({ _id: principal.tokenId }, { fields: { lastClient: 1 } })
  return token?.lastClient || null
}

/** mountHttp's onAgentCall: a token's call on /api/v1, by action and User-Agent. */
export async function countApiCall(principal, action, req) {
  const client = clientFromUserAgent(req.get('user-agent'))
  await agentUsage.call({ surface: 'api', client, tool: action.tool?.name || derivedToolName(action.id) })
  await agentUsage.first({ userId: principal.userId, via: 'api', client })
}

/** The registry the app's Meteor methods run through, noting each account's first action there. */
export function noticingFirstAction(registry) {
  return {
    ...registry,
    run(principal, id, input, options) {
      if (principal?.kind === 'person') agentUsage.first({ userId: principal.userId, via: 'app' })
      return registry.run(principal, id, input, options)
    },
  }
}

/** The reads agentSummary (usage-core.mjs) makes for the Overview. */
export const agentUsageIo = {
  days: (since) => days.find({ at: { $gte: since } }).toArray(),
  newAccounts: (since) => Meteor.users.rawCollection()
    .find({ createdAt: { $gte: since }, isAnonymous: { $ne: true } }, { projection: { _id: 1, createdAt: 1 } }).limit(5000).toArray(),
  firsts: (ids) => firsts.find({ _id: { $in: ids } }).toArray(),
}

Meteor.startup(() => ensureAgentUsageIndexes({ days, firsts }).catch((error) => console.warn(`agent-usage: indexes not made (${error.message})`)))
