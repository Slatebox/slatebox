// The files iOS and Android read to open this server's links in the Slatebox viewer app and to
// offer its saved sign-ins (passwords and passkeys) there:
//
//   /.well-known/apple-app-site-association  universal links for /canvas/* and /present/*, and
//                                            webcredentials, for settings.mobile.ios.appIds
//                                            (TeamID.bundleId, for example ABCDE12345.com.slatebox.viewer)
//   /.well-known/assetlinks.json             Android App Links and shared sign-ins, for
//                                            settings.mobile.android.package and .sha256 (the
//                                            signing certificate's SHA-256 fingerprints)
//
// Both are application/json, served straight (no redirect, as the platforms require). A file whose
// settings are missing or malformed answers 404 JSON, never the app's page. A self-hosted server
// publishes its own once it names its own app build.
//
// MIT, runs without Meteor (scripts/mobile-viewer.test.mjs); server/apiHooks.js mounts it.

export const APP_LINK_PATHS = Object.freeze({
  apple: '/.well-known/apple-app-site-association',
  android: '/.well-known/assetlinks.json',
})
// The addresses the app opens: a canvas (/canvas/:id?/:nodeId?/:asEmbed?) and a presentation.
export const APP_LINK_ROUTES = Object.freeze(['/canvas/*', '/present/*'])

const APPLE_APP_ID = /^[A-Z0-9]{10}\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/
const ANDROID_PACKAGE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/
const SHA256_FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/

const list = (value) => {
  if (Array.isArray(value)) return value
  return typeof value === 'string' ? [value] : []
}
const mobileOf = (settings) => (settings?.mobile && typeof settings.mobile === 'object' ? settings.mobile : {})

/** The iOS app ids (TeamID.bundleId) from settings.mobile.ios.appIds; malformed ones are left out. */
export function appleAppIds(settings) {
  const ids = list(mobileOf(settings).ios?.appIds).map((id) => (typeof id === 'string' ? id.trim() : '')).filter((id) => APPLE_APP_ID.test(id))
  return [...new Set(ids)]
}

/** The apple-app-site-association document, or null when no app id is set. */
export function appleAppSiteAssociation(settings) {
  const appIDs = appleAppIds(settings)
  if (!appIDs.length) return null
  return {
    applinks: {
      details: [{ appIDs, components: APP_LINK_ROUTES.map((path) => ({ '/': path })) }],
    },
    webcredentials: { apps: appIDs },
  }
}

/** The Android package and its certificate fingerprints, or null when either is missing or malformed. */
export function androidApp(settings) {
  const android = mobileOf(settings).android || {}
  const packageName = typeof android.package === 'string' ? android.package.trim() : ''
  if (!ANDROID_PACKAGE.test(packageName)) return null
  const fingerprints = [...new Set(list(android.sha256).map((value) => (typeof value === 'string' ? value.trim().toUpperCase() : '')).filter((value) => SHA256_FINGERPRINT.test(value)))]
  if (!fingerprints.length) return null
  return { packageName, fingerprints }
}

/** The assetlinks.json document, or null when the Android app is not set. */
export function assetLinks(settings) {
  const app = androidApp(settings)
  if (!app) return null
  return [{
    relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
    target: { namespace: 'android_app', package_name: app.packageName, sha256_cert_fingerprints: app.fingerprints },
  }]
}

const notConfigured = (res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.status(404).json({ error: 'not_found', error_description: 'This server has not set up the Slatebox app here.' })
}

// settings() is read on each request, so the documents follow the settings the server runs with.
export function mountAppLinks(app, { settings }) {
  const serve = (build) => (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD')
      return res.status(405).json({ error: 'method_not_allowed', error_description: 'Use GET.' })
    }
    const body = build(settings() || {})
    if (!body) return notConfigured(res)
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    return res.status(200).type('application/json').send(JSON.stringify(body))
  }
  // Exact paths only: anything below them is not one of these files.
  app.use(APP_LINK_PATHS.apple, (req, res) => (req.path === '/' ? serve(appleAppSiteAssociation)(req, res) : notConfigured(res)))
  app.use(APP_LINK_PATHS.android, (req, res) => (req.path === '/' ? serve(assetLinks)(req, res) : notConfigured(res)))
}
