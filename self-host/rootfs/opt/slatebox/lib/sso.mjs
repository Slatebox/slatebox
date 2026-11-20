// Single sign-on with the bundled Keycloak (SLATEBOX_SSO=keycloak): what configure.mjs renders
// for Keycloak and for the app, and the realm keycloak-init.mjs creates. Off by default; with
// SSO off nothing here runs and Keycloak is not started.
import { join } from 'node:path'
import {
  KEYCLOAK_DATA, KEYCLOAK_HOME, KEYCLOAK_MANAGEMENT_PORT, KEYCLOAK_PORT, Plain, SCIM_CLIENT, SSO_CLIENT, SSO_INIT_CLIENT,
  SSO_PATH, SSO_REALM,
} from './common.mjs'

export const ADMIN_USER = 'admin'
export const KEYCLOAK_DB_USER = 'keycloak'
// H2's AUTO_SERVER lets `slatebox backup` open the database while Keycloak runs, for an online
// backup; with h2.bindAddress its port is on loopback only.
export const keycloakDbUrl = () => `jdbc:h2:file:${join(KEYCLOAK_DATA, 'h2/keycloakdb')};NON_KEYWORDS=VALUE;AUTO_SERVER=TRUE`
const JAVA_HOME = '/opt/java/openjdk'

/** SLATEBOX_SSO, SLATEBOX_SSO_ONLY and SLATEBOX_SSO_ADMIN, validated. */
export function ssoMode(setting) {
  const mode = (setting('SLATEBOX_SSO') || 'off').toLowerCase()
  if (!['off', 'keycloak'].includes(mode)) throw new Plain('SLATEBOX_SSO must be off or keycloak')
  const onlyValue = (setting('SLATEBOX_SSO_ONLY') || 'false').toLowerCase()
  if (!['true', 'false'].includes(onlyValue)) throw new Plain('SLATEBOX_SSO_ONLY must be true or false')
  const only = onlyValue === 'true'
  if (only && mode === 'off') throw new Plain('SLATEBOX_SSO_ONLY=true also needs SLATEBOX_SSO=keycloak')
  // Keycloak's admin console and the master realm on the published port: open (the default, so an
  // operator can set up the providers), or closed once that is done.
  const adminValue = setting('SLATEBOX_SSO_ADMIN')
  const admin = (adminValue || 'open').toLowerCase()
  if (!['open', 'closed'].includes(admin)) throw new Plain('SLATEBOX_SSO_ADMIN must be open or closed')
  if (adminValue && mode === 'off') throw new Plain('SLATEBOX_SSO_ADMIN also needs SLATEBOX_SSO=keycloak')
  return { enabled: mode === 'keycloak', only, adminOpen: admin === 'open' }
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
      // Accounts stay linked when SLATEBOX_URL (and with it the issuer) changes.
      provider: 'bundled-keycloak',
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
  '-Djdk.tls.rejectClientInitiatedRenegotiation=true', '-Dh2.bindAddress=127.0.0.1', `-Djava.io.tmpdir=${join('/run/slatebox', 'keycloak-tmp')}`,
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
    KC_DB_URL: keycloakDbUrl(),
    KC_DB_USERNAME: KEYCLOAK_DB_USER,
    KC_DB_PASSWORD: secrets.keycloakDbPassword,
    // Keycloak's own log carries user names in its event lines: keep warnings and errors only,
    // and leave the event logger out entirely. Events are kept in the realm instead (see below).
    KC_LOG_LEVEL: 'warn,org.keycloak.events:off,org.keycloak.protocol.oidc.endpoints.TokenEndpoint.full-scope-allowed:error',
    // One server: no cluster, so nothing listens beyond loopback.
    KC_CACHE: 'local',
    KC_SPI_STICKY_SESSION_ENCODER__INFINISPAN__SHOULD_ATTACH_ROUTE: 'false',
    KC_LOG_CONSOLE_COLOR: 'false',
    // Used only when Keycloak creates its master realm, on the first start with SSO on.
    KC_BOOTSTRAP_ADMIN_USERNAME: ADMIN_USER,
    KC_BOOTSTRAP_ADMIN_PASSWORD: secrets.keycloakAdminPassword,
    KC_BOOTSTRAP_ADMIN_CLIENT_ID: SSO_INIT_CLIENT,
    KC_BOOTSTRAP_ADMIN_CLIENT_SECRET: secrets.keycloakInitSecret,
  }
}

export const KEYCLOAK_COMMAND = [join(KEYCLOAK_HOME, 'bin/kc.sh'), 'start', '--optimized']

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
      config: { 'included.custom.audience': scimAudience(url), 'access.token.claim': 'true', 'id.token.claim': 'false' },
    }],
  }
}

/** The audience SCIM tokens must carry: SCIM's own address under this installation's issuer. */
export const scimAudience = url => `${issuerFor(url)}/scim/v2`

/**
 * The first-login flow for a company provider whose email addresses are trusted: a person who
 * already exists in the realm with the same address (provisioned over SCIM or synced from the
 * directory) is linked automatically instead of being asked for a Keycloak password they do not
 * have; anyone else gets a new user. It is not the realm's default: an operator chooses it, under
 * "First login flow override", only for a provider with Trust Email on (see the guide).
 */
export const TRUSTED_EMAIL_FLOW = 'link by trusted email'
export const TRUSTED_EMAIL_STEPS = `${TRUSTED_EMAIL_FLOW} create or link`

/** Master-realm settings kept at every start: guessing an administrator's password is slowed and recorded. */
export const MASTER_REALM = {
  bruteForceProtected: true,
  failureFactor: 10,
  permanentLockout: false,
  maxFailureWaitSeconds: 900,
  waitIncrementSeconds: 60,
}
export const MASTER_EVENTS = { eventsEnabled: true, eventsExpiration: 90 * 24 * 3600, adminEventsEnabled: true }

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
