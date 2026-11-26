// What Admin tools › Integrations shows on a self-hosted install (server/enterprise.js
// 'enterprise.status'). MIT, without Meteor (scripts/enterprise-license.test.mjs).
// Integrations are free on every install (owner, 2026-11-26): the card only says whether they run
// here, and when they do not, why (a build without the enterprise code, or the operator's switch).
import { editionOf } from '../imports/api/common/edition.mjs'

export const STATUS_WORDS = Object.freeze({
  on: 'Integrations are on for everyone on this server.',
  not_in_build: 'This build of Slatebox carries no integrations code, so integrations are off. The published Slatebox image carries it.',
  switched_off: 'Integrations are switched off in this server\'s settings (connectors.off).',
})

/**
 * @param {{ settings: object, running: { loaded: boolean, reason?: string, features?: string[] } }} options
 *   running: what the server loaded at start (server/enterprise-loader.mjs loadEnterprise)
 * @returns {{ edition: 'cloud'|'self-host', on: boolean, reason: string, words: string }}
 */
export function enterpriseStatusFor({ settings, running }) {
  const edition = editionOf(settings)
  const reason = !running?.loaded ? 'not_in_build' : (running.features || []).includes('agents.invite') ? 'on' : 'switched_off'
  return { edition, on: reason === 'on', reason, words: STATUS_WORDS[reason] }
}
