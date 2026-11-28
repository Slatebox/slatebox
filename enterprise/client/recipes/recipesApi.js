// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Recipes from the browser: one thin wrapper per recipes.* action (enterprise/server/recipes/actions.mjs),
// the same handlers tokens, exec, the MCP server and the CLI reach. grant and revoke are the browser's
// alone (a signed-in person, never a token). A refusal rejects with a Meteor.Error whose `error` is
// the action's code (recipes_off, forbidden, ...) and whose reason is the sentence to show.
import { Meteor } from 'meteor/meteor'
import { enterpriseSlots } from '/imports/api/client/enterprise-slots.mjs'

const call = async (method, input = {}) => {
  try {
    return await Meteor.callAsync(method, input)
  } catch (error) {
    enterpriseSlots.lockIfRefused(error)
    throw error
  }
}

const recipesApi = {
  /** @returns {Promise<{recipes: Array<object>}>} manifests, each with `connected` for its integration */
  catalog: () => call('recipes.catalog', {}),
  /** @param {{projectId: string}} input */
  list: (input) => call('recipes.list', input),
  /** @param {{instanceId: string}} input @returns {Promise<{instance: object, manifest: object, grants: object[], hooks: object[]}>} */
  get: (input) => call('recipes.get', input),
  /** @param {{projectId: string, recipeId: string, config: object, triggers?: object[], name?: string}} input @returns {Promise<{instance: object}>} a draft */
  create: (input) => call('recipes.create', input),
  /** @param {{instanceId: string, config?: object, triggers?: object[], name?: string, applyMode?: 'suggest'|'auto'}} input */
  update: (input) => call('recipes.update', input),
  /** @param {{instanceId: string}} input @returns {Promise<{slates: Array<{role, name, slate, counts}>, tokens?: {in, out}, partial?: string}>} */
  preview: (input) => call('recipes.preview', input),
  /** @param {{instanceId: string}} input  draft -> on, and queues the first run */
  activate: (input) => call('recipes.activate', input),
  /** @param {{instanceId: string, reason?: string, data?: object}} input @returns {Promise<{runId: string}>} */
  run: (input) => call('recipes.run', input),
  pause: (input) => call('recipes.pause', input),
  resume: (input) => call('recipes.resume', input),
  /** @param {{instanceId: string}} input  its slates stay in the project */
  remove: (input) => call('recipes.delete', input),
  /** @param {{instanceId: string, before?: string, limit?: number}} input */
  runs: (input) => call('recipes.runs', input),
  /** @param {{runId: string}} input */
  undoRun: (input) => call('recipes.undoRun', input),
  /** @param {{instanceId: string, shareId?: string}} input  a synced slate (or all of them) to its repository now */
  saveNow: (input) => call('recipes.saveNow', input),
  /** @param {{shareId: string}} input @returns {Promise<{synced: Array<{instanceId, repo, path, commit, pending, canSave, savesDueAt, state}>}>} */
  syncedOn: (input) => call('recipes.syncedOn', input),
  /** @param {{cardId: string, decision: 'approve'|'decline'}} input  the person the recipe runs for */
  decideWrite: (input) => call('recipes.decideWrite', input),
  /** @param {{shareId: string}} input @returns {Promise<{instances: Array<{instanceId, agentName, ownerName, colorIndex, noteIds: string[]}>}>} */
  notesOn: (input) => call('recipes.notesOn', input),
  /** @param {{shareId: string, noteIds: string[]}} input  "Make it mine": the recipe stops changing these notes */
  makeMine: (input) => call('recipes.makeMine', input),
  /** @param {{instanceId: string}} input  a manager takes the recipe over; its permissions are cleared */
  transfer: (input) => call('recipes.transfer', input),
  /** @param {{instanceId: string, kind: string, scope: object, expiresAt?: string|null}} input */
  grant: (input) => call('recipes.grant', input),
  /** @param {{grantId: string}} input */
  revoke: (input) => call('recipes.revoke', input),
  /** @param {{projectId: string, paused: boolean}} input  manager+ */
  pauseProject: (input) => call('recipes.pauseProject', input),
  /** @param {{paused: boolean}} input  every recipe the caller owns */
  pauseMine: (input) => call('recipes.pauseMine', input),
  /** @returns {Promise<{paused: boolean}>} */
  mine: () => call('recipes.mine', {}),
  /** @param {{projectId?: string}} input @returns {Promise<{installUrl: string|null, installations: object[]}>} the Slatebox GitHub App's install screen (back to this project after) */
  githubInstallations: (input) => call('recipes.github.installations', input),
  team: {
    /** @param {{orgId: string}} input @returns {Promise<{allowed: boolean}>} */
    get: (input) => call('recipes.team.get', input),
    /** @param {{orgId: string, allowed: boolean}} input  team admins */
    set: (input) => call('recipes.team.set', input),
  },
  hooks: {
    /** @param {{instanceId?: string, projectId?: string}} input */
    list: (input) => call('recipes.hooks.list', input),
    /** @param {{scope: {instanceId: string}|{projectId: string}, direction: 'outbound'|'inbound'|'intercept', url?: string, events?: string[], point?: string, failMode?: 'open'|'closed'}} input
     *  @returns {Promise<{hook: object, secret: string, url?: string}>} the secret, shown once */
    add: (input) => call('recipes.hooks.add', input),
    remove: (input) => call('recipes.hooks.remove', input),
    /** @returns {Promise<{secret: string}>} the new secret, shown once; the old one signs for 24 h more */
    rotate: (input) => call('recipes.hooks.rotate', input),
    /** @returns {Promise<{deliveryId: string, status: number|null}>} a signed ping */
    test: (input) => call('recipes.hooks.test', input),
  },
  /** @param {{hookId: string}} input */
  deliveries: (input) => call('recipes.deliveries', input),
  admin: {
    /** @returns {Promise<{enabled: boolean, instances: {active: number, paused: number, total: number}, limits: object}>} */
    status: () => call('recipes.admin.status', {}),
    /** @param {{enabled: boolean}} input  a server admin; recorded in the activity log */
    setEnabled: (input) => call('recipes.admin.setEnabled', input),
    /** pause every recipe on this server */
    pauseAll: () => call('recipes.admin.pauseAll', {}),
  },
}

export default recipesApi
