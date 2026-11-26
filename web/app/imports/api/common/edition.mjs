// Which Slatebox this server is: Slatebox Cloud or a self-hosted install. One switch,
// settings.public.edition, read the same way by the server and the browser.
//
// - 'cloud': Slatebox Cloud. The code in the repository's enterprise/ directory (outside agent
//   connections: the MCP client, invited agents and the integrations built on them) runs, once
//   Cloud's own signed key proves it (server/enterprise-license.mjs): the setting alone is not Cloud.
// - 'self-host': every other install. Its image carries the same enterprise code, and it runs there
//   with no key: integrations are free everywhere (owner, 2026-11-26). Single sign-on (the bundled
//   Keycloak) is free too.
//
// A missing or unknown value is self-host, so a settings file without Cloud's key never turns
// Cloud behaviour (payments and the meter) on.
export const EDITIONS = Object.freeze(['cloud', 'self-host'])

export function editionOf(settings) {
  return settings?.public?.edition === 'cloud' ? 'cloud' : 'self-host'
}

export const isCloudEdition = (settings) => editionOf(settings) === 'cloud'

// What the server worked out at start (server/enterprise.js writes settings.public.enterprise
// before any browser loads): whether enterprise code runs here, as which edition ('cloud' or 'self-host'),
// and which of its features are on. Invited agents are on wherever enterprise code runs;
// only the server-side kill switch (settings.connectors.off, never public) takes them away.
export function enterpriseState(settings) {
  const state = settings?.public?.enterprise
  const unlocked = state?.unlocked === true
  return {
    unlocked,
    via: unlocked && (state.via === 'cloud' || state.via === 'self-host') ? state.via : null,
    features: unlocked && Array.isArray(state.features) ? state.features.filter((name) => typeof name === 'string') : [],
  }
}

export const agentInviteOn = (settings) => enterpriseState(settings).features.includes('agents.invite')

// The server-side kill switch for invited agents: on unless settings.connectors.off is true.
export const agentInviteKilled = (settings) => settings?.connectors?.off === true
