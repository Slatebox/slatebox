// The Meteor side of About you: the real collections in, the store out (deps.profile in
// server/actions/mount.js), its indexes at start, the per-person write limits, and the two
// server-only calls later slices use. Everything it wires runs without Meteor in the tests
// (server/profile/store.mjs, imports/api/common/personal-facts.mjs).
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import { PersonalFacts, PersonalIdeas, PersonalSettings } from '../../imports/api/common/models'
import { createProfileStore, ensureProfileIndexes } from './store.mjs'
import { PROFILE_WRITE_LIMITS } from '../actions/profile.mjs'

export const profileStore = createProfileStore({
  facts: PersonalFacts.rawCollection(),
  settings: PersonalSettings.rawCollection(),
  users: Meteor.users.rawCollection(),
  newId: () => Random.id(),
  // For you's ideas (server/personal) go with the account too
  ideas: PersonalIdeas.rawCollection(),
})

/**
 * Server only, never an action: facts from a source (the interview, a connected tool, an upload),
 * with the same fact skipped and the cap kept. Refused (FactError 403) when personalization is off
 * or that source is switched off. → { added, same, overCap, invalid }
 */
export const addFactsFrom = (userId, source, facts) => profileStore.addFrom(userId, source, facts)

/**
 * Server only: what a model call may read about the person, as short lines ('- tool: Linear'):
 * visible facts from sources that are on, bounded. '' when personalization is off. Wrap it as
 * data in the prompt, never as instructions.
 */
export const factsForPrompt = (userId) => profileStore.forPrompt(userId)

/** users.delete: every fact and setting of the person's. */
export const removePersonalData = (userId) => profileStore.removeAll(userId)

// A person's writes, per minute (a token's are counted by the registry's limiter).
for (const [name, count] of Object.entries(PROFILE_WRITE_LIMITS)) {
  DDPRateLimiter.addRule({ type: 'method', name, userId: (userId) => Boolean(userId) }, count, 60000)
}

Meteor.startup(async () => {
  try {
    await ensureProfileIndexes({ facts: PersonalFacts.rawCollection(), settings: PersonalSettings.rawCollection() })
  } catch (error) {
    console.error('[profile] indexes', error?.message)
  }
})
