// Which Slatebox this server is: Slatebox Cloud or a self-hosted install. One switch,
// settings.public.edition, read the same way by the server and the browser.
//
// - 'cloud': Slatebox Cloud. The code in the repository's enterprise/ directory (outside agent
//   connections: the MCP client and the integrations built on it) is loaded and registered.
// - 'self-host': every other install. Nothing from enterprise/ is loaded, and a self-host image
//   does not contain it (self-host/build-images.sh, scripts/enterprise-stage.mjs).
//
// A missing or unknown value is self-host, so a settings file without the key never turns
// Cloud-only code on.
export const EDITIONS = Object.freeze(['cloud', 'self-host'])

export function editionOf(settings) {
  return settings?.public?.edition === 'cloud' ? 'cloud' : 'self-host'
}

export const isCloudEdition = (settings) => editionOf(settings) === 'cloud'

// Inviting an outside agent onto a slate (Cloud only). settings.public.agents.invite turns the
// invite UI and its server methods on; it is off unless set to true, and it is always off on
// self-host whatever the setting says.
export const agentInviteEnabled = (settings) =>
  isCloudEdition(settings) && settings?.public?.agents?.invite === true
