// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The GitHub vendor as the recipes runtime starts it (enterprise/server/recipes/index.mjs
// VENDOR_FACTORIES): runtime deps in ({ collection, master, settings, clock, log, origin, audit }),
// its four collections (installations, deliveries once, App settings, manifest flows; the last two
// expire on expiresAt), and the App's credentials from settings.connectors.githubApp or Admin ›
// Integration apps. Its routes are the App's webhook and install callback (routes.mjs); the
// runtime's route hand-off gives them the raw body, trigger(match, trigger) and pause(match, state).
import { createVendor } from './index.mjs'
import { GITHUB_PATHS } from './routes.mjs'
import { MANIFEST_CALLBACK_PATH } from './app-settings.mjs'

export const GITHUB_COLLECTIONS = Object.freeze({
  installations: 'githubInstallations',
  deliveries: 'githubDeliveries',
  appSettings: 'githubAppSettings',
  flows: 'githubAppFlows',
})

export function githubVendorFactory({ collection, master = null, settings = {}, clock = Date.now, log = () => {}, origin = () => '', audit = async () => {} }) {
  const collections = Object.fromEntries(Object.entries(GITHUB_COLLECTIONS).map(([key, name]) => [key, collection(name)]))
  for (const key of ['deliveries', 'flows']) collections[key].createIndex?.({ expiresAt: 1 }, { expireAfterSeconds: 0 })?.catch?.(() => {})
  collections.installations.createIndex?.({ users: 1 })?.catch?.(() => {})
  return createVendor({
    collections,
    master,
    settings: () => settings.connectors?.githubApp || {},
    now: clock,
    log: (entry) => log({ vendor: 'github', ...entry }),
    origin,
    audit,
  })
}
// Registered before the server starts; the handlers are the started vendor's (index.mjs).
githubVendorFactory.routes = () => [
  { method: 'POST', path: GITHUB_PATHS.events, raw: true, vendor: 'github' },
  { method: 'GET', path: GITHUB_PATHS.installed, raw: false, vendor: 'github' },
  { method: 'GET', path: MANIFEST_CALLBACK_PATH, raw: false, vendor: 'github' },
]
