// Team settings > Sign-in & security, as plain data: which fields each identity provider asks for,
// what the admin copies into the provider's console, and the words for a domain's and a policy's
// state. Pure, so scripts/sso-connections.test.mjs checks the same copy the page shows.

// console: where the admin makes the app for Slatebox (the same links server/sso/connections.mjs names).
export const PRESET_CHOICES = Object.freeze([
  { id: 'okta', name: 'Okta', protocol: 'oidc', console: 'https://help.okta.com/en-us/content/topics/apps/apps_app_integration_wizard_oidc.htm' },
  { id: 'entra', name: 'Microsoft Entra ID', protocol: 'oidc', console: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' },
  { id: 'google', name: 'Google Workspace', protocol: 'oidc', console: 'https://console.cloud.google.com/apis/credentials' },
  { id: 'oidc', name: 'Other OpenID Connect', protocol: 'oidc', console: null },
  { id: 'saml', name: 'SAML 2.0', protocol: 'saml', console: null },
])

// The fields each preset asks for, in order. secret: write-only (blank keeps the saved one).
export const PRESET_FIELDS = Object.freeze({
  okta: [
    { name: 'issuer', label: 'Okta domain (issuer)', placeholder: 'https://acme.okta.com', help: 'Your Okta org address, or an authorization server\'s issuer.' },
    { name: 'clientId', label: 'Client ID' },
    { name: 'clientSecret', label: 'Client secret', secret: true },
  ],
  entra: [
    { name: 'tenantId', label: 'Directory (tenant) ID', placeholder: '0b6f3c4e-…', help: 'From the app registration\'s Overview. Only people in this tenant can sign in.' },
    { name: 'clientId', label: 'Application (client) ID' },
    { name: 'clientSecret', label: 'Client secret (value)', secret: true },
  ],
  google: [
    { name: 'clientId', label: 'Client ID', help: 'A Web application OAuth client in your Workspace\'s Google Cloud project.' },
    { name: 'clientSecret', label: 'Client secret', secret: true },
  ],
  oidc: [
    { name: 'issuer', label: 'Issuer', placeholder: 'https://login.acme.com', help: 'Slatebox reads <issuer>/.well-known/openid-configuration.' },
    { name: 'clientId', label: 'Client ID' },
    { name: 'clientSecret', label: 'Client secret', secret: true },
  ],
  saml: [
    { name: 'idpEntityId', label: 'Identity provider entity ID (issuer)' },
    { name: 'ssoUrl', label: 'Sign-in address (SSO URL)', placeholder: 'https://…' },
    { name: 'certificate', label: 'Signing certificate (PEM)', multiline: true, help: 'Paste it again to replace the saved one.' },
    { name: 'emailAttribute', label: 'Email attribute (optional)', help: 'Leave empty to use email, mail or an email NameID.' },
  ],
})

/** What the admin copies into the identity provider's console, for a saved connection. */
export function copyRows(connection) {
  const a = connection.addresses || {}
  if (connection.protocol === 'saml') {
    return [
      { label: 'ACS (reply) URL', value: a.acsUrl },
      { label: 'SP entity ID (audience)', value: a.entityId },
      { label: 'SP metadata', value: a.metadataUrl },
      { label: 'Sign-in address for app tiles', value: a.startUrl },
    ]
  }
  return [
    { label: 'Redirect URI', value: a.redirectUri },
    { label: 'Back-channel logout URI', value: a.backchannelLogoutUri },
    { label: 'Sign-in address for app tiles', value: a.startUrl },
  ]
}

/** The redirect URI an OpenID Connect app needs before it is saved. */
export const redirectUriFor = (origin) => `${String(origin || '').replace(/\/$/, '')}/sso/callback`

/** A domain's state in a word, and a sentence. */
export function domainState(domain) {
  if (!domain.verified) return { word: 'Not verified', tone: 'warning', detail: `Add this TXT record at your DNS provider, then press Check.` }
  if (!domain.routes) return { word: 'Paused', tone: 'error', detail: 'The TXT record has been missing for seven days, so this domain no longer signs anyone in. Add it again and press Check.' }
  if (domain.failingSince) return { word: 'Record missing', tone: 'warning', detail: `The TXT record could not be found since ${new Date(domain.failingSince).toLocaleDateString()}. After seven days this domain stops signing people in.` }
  if (domain.verifiedBy === 'server-admin') return { word: 'Verified', tone: 'success', detail: 'Verified by this server\'s administrator.' }
  return { word: 'Verified', tone: 'success', detail: 'People with these addresses can sign in with this connection.' }
}

export const SESSION_CHOICES = Object.freeze([
  { hours: 8, label: '8 hours' },
  { hours: 24, label: '24 hours' },
  { hours: 168, label: '7 days' },
])

/** Why "Require single sign-on" cannot be turned on yet, or null. */
export function requireBlocker(connection) {
  if (!connection.enabled) return 'Turn the connection on first.'
  if (!connection.domains.some((d) => d.routes)) return 'Verify a domain first: single sign-on is required for the addresses of verified domains.'
  return null
}
