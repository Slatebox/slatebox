// Single sign-on with the bundled Keycloak (SLATEBOX_SSO=keycloak): what configure.mjs renders
// for Keycloak and for the app, and the realm keycloak-init.mjs creates. Off by default; with
// SSO off nothing here runs and Keycloak is not started.
import { join } from 'node:path'
import {
  KEYCLOAK_DATA, KEYCLOAK_HOME, KEYCLOAK_MANAGEMENT_PORT, KEYCLOAK_PORT, Plain, SCIM_CLIENT, SSO_CLIENT, SSO_INIT_CLIENT,
  SSO_PATH, SSO_REALM,
} from './common.mjs'

export const ADMIN_USER = 'admin'
const JAVA_HOME = '/opt/java/openjdk'

/** SLATEBOX_SSO and SLATEBOX_SSO_ONLY, validated. */
export function ssoMode(setting) {
  const mode = (setting('SLATEBOX_SSO') || 'off').toLowerCase()
  if (!['off', 'keycloak'].includes(mode)) throw new Plain('SLATEBOX_SSO must be off or keycloak')
  const onlyValue = (setting('SLATEBOX_SSO_ONLY') || 'false').toLowerCase()
  if (!['true', 'false'].includes(onlyValue)) throw new Plain('SLATEBOX_SSO_ONLY must be true or false')
  const only = onlyValue === 'true'
  if (only && mode === 'off') throw new Plain('SLATEBOX_SSO_ONLY=true also needs SLATEBOX_SSO=keycloak')
  return { enabled: mode === 'keycloak', only }
}

export const issuerFor = url => `${url.origin}${SSO_PATH}/realms/${SSO_REALM}`
const internal = `http://127.0.0.1:${KEYCLOAK_PORT}${SSO_PATH}`

/** The app's settings: server side (sso) and what browsers see (public.sso). */
export function appSettings({ url, secrets, only }) {
  const issuer = issuerFor(url)
  return {
    sso: {
      enabled: true,
      only,
      issuer,
      authorizationEndpoint: `${issuer}/protocol/openid-connect/auth`,
      // The code and the refresh tokens go to Keycloak on loopback, never over the network.
      tokenEndpoint: `${internal}/realms/${SSO_REALM}/protocol/openid-connect/token`,
      clientId: SSO_CLIENT,
      clientSecret: secrets.ssoClientSecret,
      redirectUri: `${url.origin}/sso/callback`,
      stateKey: secrets.ssoStateKey,
    },
    public: { sso: { enabled: true, only } },
  }
}

// A small heap for a small realm. The serial collector gives memory back and suits one core.
// Larger installations raise -Xmx; see DESIGN.md.
const JAVA_OPTS = [
  '-XX:MetaspaceSize=96M', '-XX:MaxMetaspaceSize=192m', '-Xms32m', '-Xmx256m', '-Xss512k', '-XX:ReservedCodeCacheSize=64m',
  '-XX:+UseSerialGC', '-XX:+ExitOnOutOfMemoryError', '-Djava.security.egd=file:/dev/urandom', '-Dfile.encoding=UTF-8',
  '-Dsun.stdout.encoding=UTF-8', '-Dsun.err.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8',
  '-Djdk.tls.rejectClientInitiatedRenegotiation=true', `-Djava.io.tmpdir=${join('/run/slatebox', 'keycloak-tmp')}`,
].join(' ')

/** The environment kc.sh starts with. The build options (dev-file, /auth, health, local cache) are baked into the image. */
export function keycloakEnv({ url, secrets }) {
  return {
    JAVA_HOME,
    PATH: `${JAVA_HOME}/bin:/usr/local/bin:/usr/bin:/bin`,
    JAVA_OPTS,
    KC_HOSTNAME: `${url.origin}${SSO_PATH}`,
    KC_HOSTNAME_BACKCHANNEL_DYNAMIC: 'true',
    KC_HTTP_ENABLED: 'true',
    KC_HTTP_HOST: '127.0.0.1',
    KC_HTTP_PORT: KEYCLOAK_PORT,
    KC_HTTP_MANAGEMENT_PORT: KEYCLOAK_MANAGEMENT_PORT,
    KC_PROXY_HEADERS: 'xforwarded',
    // Keycloak's own log carries user names in its event lines: keep warnings and errors only,
    // and leave the event logger out entirely. Events are kept in the realm instead (see below).
    KC_LOG_LEVEL: 'warn,org.keycloak.events:off',
    KC_LOG_CONSOLE_COLOR: 'false',
    // Used only when Keycloak creates its master realm, on the first start with SSO on.
    KC_BOOTSTRAP_ADMIN_USERNAME: ADMIN_USER,
    KC_BOOTSTRAP_ADMIN_PASSWORD: secrets.keycloakAdminPassword,
    KC_BOOTSTRAP_ADMIN_CLIENT_ID: SSO_INIT_CLIENT,
    KC_BOOTSTRAP_ADMIN_CLIENT_SECRET: secrets.keycloakInitSecret,
  }
}

export const KEYCLOAK_COMMAND = [join(KEYCLOAK_HOME, 'bin/kc.sh'), 'start', '--optimized']
export const keycloakDatabaseExists = existsSync => existsSync(join(KEYCLOAK_DATA, 'h2/keycloakdb.mv.db'))

/** The app's client: confidential, authorization code with PKCE (S256) only. Rewritten at every start. */
export function appClient({ url, secrets }) {
  return {
    clientId: SSO_CLIENT,
    name: 'Slatebox',
    enabled: true,
    protocol: 'openid-connect',
    publicClient: false,
    clientAuthenticatorType: 'client-secret',
    secret: secrets.ssoClientSecret,
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    frontchannelLogout: false,
    rootUrl: url.origin,
    baseUrl: '/',
    redirectUris: [`${url.origin}/sso/callback`],
    webOrigins: [url.origin],
    attributes: {
      'pkce.code.challenge.method': 'S256',
      'post.logout.redirect.uris': `${url.origin}/*`,
      'use.refresh.tokens': 'true',
    },
    defaultClientScopes: ['web-origins', 'acr', 'profile', 'roles', 'basic', 'email'],
    optionalClientScopes: ['offline_access'],
  }
}

/** A client for SCIM provisioning (OAuth 2.0 client credentials), allowed to manage users. */
export function scimClient({ url, secrets }) {
  return {
    clientId: SCIM_CLIENT,
    name: 'SCIM provisioning',
    enabled: true,
    protocol: 'openid-connect',
    publicClient: false,
    clientAuthenticatorType: 'client-secret',
    secret: secrets.scimClientSecret,
    standardFlowEnabled: false,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: true,
    protocolMappers: [{
      name: 'scim-audience',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-audience-mapper',
      config: { 'included.custom.audience': `${issuerFor(url)}/scim/v2`, 'access.token.claim': 'true', 'id.token.claim': 'false' },
    }],
  }
}

/** The realm, as created on the first start. After that the operator owns its settings. */
export function realm() {
  return {
    realm: SSO_REALM,
    displayName: 'Slatebox',
    enabled: true,
    registrationAllowed: false,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
    resetPasswordAllowed: true,
    bruteForceProtected: true,
    sslRequired: 'external',
    // Offline sessions (the app keeps one per signed-in person) end after 30 idle days.
    offlineSessionIdleTimeout: 30 * 24 * 3600,
    // Sign-in events and admin events are stored in the realm for 90 days, shown in the admin
    // console under Events and by `slatebox sso events`.
    eventsEnabled: true,
    eventsExpiration: 90 * 24 * 3600,
    eventsListeners: [],
    adminEventsEnabled: true,
    adminEventsDetailsEnabled: false,
    scimApiEnabled: true,
  }
}
