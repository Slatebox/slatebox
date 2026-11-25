// Where suggested integrations (library kind 'integration') meet the code that connects to MCP
// servers. That code is enterprise/ (Slatebox as an MCP client), loaded only where it is unlocked;
// the library core (MIT) never imports it. Enterprise fills these at start (enterprise/server/meteor.js
// through setLibraryIntegrations); a locked install leaves them empty, and the core then refuses to
// take an integration (404 integrations_off) and lists none.
//
//   forSubmit(principal, { integrationId })  → { address, host, tools: [{ name, group, destructive, hash }], signedInWith }
//       the person's own working connection, checked: active, theirs, an address the gallery does not
//       already list, and one the endpoint policy allows (https, public). Refuses with its sentence.
//   probe(address)  → { at, reachable, host, lookalike, signIn: { method, authHost, issuer } | null,
//       tools: [{ name, group, destructive, hash }], problem? }
//       the reviewer's check: an anonymous discovery through the guarded fetch, no one's token.
//   covered(address) → boolean: a built-in or already published card lists this address.
//   changed() → called after a decision that changes what the gallery shows (it reads again).

const hooks = { forSubmit: null, probe: null, covered: null, changed: null }

export function setLibraryIntegrations(next = {}) {
  for (const key of Object.keys(hooks)) hooks[key] = typeof next[key] === 'function' ? next[key] : null
}

/** The hooks as the core reads them: null when enterprise code is not running here. */
export const libraryIntegrations = () => (hooks.forSubmit && hooks.probe ? hooks : null)
