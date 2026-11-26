// What server/enterprise.js offers the rest of the server once it has run: the key an
// administrator entered (enterprise-key.mjs), unlockNow() (register enterprise code while the
// server runs) and running() (what runs now). A holder, so MIT code that needs them never imports
// the enterprise loader's Meteor side by path (scripts/enterprise-carveout.test.mjs).
export const enterpriseRuntime = {
  licenseKeys: null,
  unlockNow: async () => ({ unlocked: false, reason: 'locked' }),
  running: () => ({ loaded: false }),
}

/**
 * Meteor's encoded runtime config (a JSON string holding the URI-encoded JSON of
 * __meteor_runtime_config__) with settings.public.enterprise as it is now, or undefined when it
 * already says so (WebApp.addRuntimeConfigHook: a page loaded after a late unlock is told).
 */
export function runtimeConfigWithEnterprise(encoded, enterprise) {
  try {
    const config = JSON.parse(decodeURIComponent(JSON.parse(encoded)))
    if (JSON.stringify(config.PUBLIC_SETTINGS?.enterprise) === JSON.stringify(enterprise)) return undefined
    config.PUBLIC_SETTINGS = { ...config.PUBLIC_SETTINGS, enterprise }
    return JSON.stringify(encodeURIComponent(JSON.stringify(config)))
  } catch {
    return undefined
  }
}
