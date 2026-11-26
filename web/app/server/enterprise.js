/* eslint-disable no-console */
// The Meteor side of server/enterprise-loader.mjs. Imported near the top of server/main.js, before
// any module builds the action registry, so enterprise actions join the one registry.
//
// '/enterprise/server' is web/app/enterprise/server: a copy of (or, in local development, a link
// to) the repository's enterprise/ directory (scripts/enterprise-stage.mjs). Cloud and self-host
// images both carry it; it is required only where it is unlocked (Slatebox Cloud, or a self-hosted
// install with a license key: server/enterprise-license.mjs).
//
// A key can also arrive while the server runs: an administrator enters one, or Slatebox Cloud
// issues a trial key (the header button for self-hosted installs, server/selfhost-options). It is kept in this server's database
// (server/enterprise-key.mjs) and unlockNow() registers the enterprise code then, with no restart:
// its actions join the registry (server/actions/mount.js late mount), its methods, routes and
// startups are added, and browsers are told on their next page load (and the one that unlocked, at once).
import express from 'express'
import { Meteor } from 'meteor/meteor'
import { WebApp } from 'meteor/webapp'
import app from './expressApp'
import { enterpriseHost, loadEnterprise, loadEnterpriseLate } from './enterprise-loader.mjs'
import { enterpriseAccess } from './enterprise-license.mjs'
import { licenseStatusFor } from './enterprise-license-status.mjs'
import { createLicenseKeyStore } from './enterprise-key.mjs'
import { enterpriseRuntime, runtimeConfigWithEnterprise } from './enterprise-runtime.mjs'
import { Permissions, SystemSettings } from '../imports/api/common/models'
import CONSTANTS from '../imports/api/common/constants'

// The key an administrator entered (read at startup below; settings and environment win over it).
export const licenseKeys = createLicenseKeyStore({ collection: SystemSettings })
const access = (now) => enterpriseAccess({ settings: Meteor.settings, env: process.env, now, stored: licenseKeys.cached() })
const load = () => require('/enterprise/server')
const log = (text) => console.warn('[enterprise]', text)

// Enterprise routes go through one router mounted now, so routes registered later still come
// before anything the app mounts after this file.
const routes = express.Router()
app.use(routes)

let result = loadEnterprise({ settings: Meteor.settings, host: enterpriseHost, load, log, access })

// What every browser is told before it loads: whether enterprise code runs here, how, and which of
// its features are on. The browser loads the enterprise chunk only when it does (client/enterprise.js);
// the server checks every call anyway.
const publicState = (loaded) => (loaded.loaded ? { unlocked: true, via: loaded.access.via, features: loaded.features } : { unlocked: false })
Meteor.settings.public = Meteor.settings.public || {}
Meteor.settings.public.enterprise = publicState(result)

// Meteor encodes settings.public into each page once, at start: a page loaded after a late unlock
// gets the state as it is now.
WebApp.addRuntimeConfigHook?.(({ encodedCurrentConfig }) => runtimeConfigWithEnterprise(encodedCurrentConfig, Meteor.settings.public.enterprise))

function registerRest(host, { late }) {
  if (Object.keys(host.methods).length) Meteor.methods(host.methods)
  for (const { method, path, handler } of host.routes) routes[method.toLowerCase()](path, handler)
  for (const fn of host.startups) (late ? Promise.resolve().then(fn) : Meteor.startup(fn))?.catch?.((error) => console.error('[enterprise] startup', error))
}

function announce(loaded, host) {
  const how = loaded.access.via === 'cloud' ? 'Cloud edition' : `licensed to ${loaded.access.license?.licensee || 'this install'}`
  console.log(
    `[enterprise] ${how}: ${loaded.name} registered ${host.actions.length} actions, ` +
      `${Object.keys(host.methods).length} methods, ${host.routes.length} routes` +
      (loaded.features.length ? '' : ' (invited agents are switched off: settings.connectors.off)')
  )
  if (loaded.access.reason === 'grace') console.warn('[enterprise]', loaded.access.words)
}

if (result.loaded) {
  registerRest(enterpriseHost, { late: false })
  announce(result, enterpriseHost)
}

let unlocking = null
/**
 * Registers the enterprise code now, if a key unlocks it and it is not running yet.
 * @returns {Promise<{ unlocked: boolean, already?: boolean, reason?: string, enterprise: object }>}
 */
export function unlockNow() {
  if (result.loaded) return Promise.resolve({ unlocked: true, already: true, enterprise: Meteor.settings.public.enterprise })
  unlocking ||= (async () => {
    try {
      const late = loadEnterpriseLate({ settings: Meteor.settings, load, log, access, apply: (host) => registerRest(host, { late: true }) })
      if (!late.loaded) return { unlocked: false, reason: late.reason === 'locked' ? late.access.reason : late.reason, enterprise: Meteor.settings.public.enterprise }
      result = late
      enterpriseHost.actions.push(...late.host.actions)
      Meteor.settings.public.enterprise = publicState(late)
      announce(late, late.host)
      return { unlocked: true, enterprise: Meteor.settings.public.enterprise }
    } finally {
      unlocking = null
    }
  })()
  return unlocking
}

/** What runs now (for the license status and the header's offer). */
export const running = () => result

Object.assign(enterpriseRuntime, { licenseKeys, unlockNow, running })

Meteor.startup(async () => {
  try {
    if (await licenseKeys.load()) {
      const outcome = await unlockNow()
      if (!outcome.unlocked && !outcome.already) console.log('[enterprise] the key an administrator entered does not unlock:', access().words)
    } else if (!result.loaded && result.reason === 'locked') {
      console.log('[enterprise]', result.access.words)
    }
  } catch (error) {
    console.error('[enterprise] reading the entered license key failed:', error?.message || error)
  }
})

// Admin tools › Enterprise features: the license state for this server's administrators (the
// platform administrator claim). A plain method, not a registry action, on purpose: it is the admin
// page's own read of the server's settings, with nothing a token or an agent should reach (like
// agents.control's exception, written down here where it is defined).
Meteor.methods({
  async 'enterprise.licenseStatus'() {
    const userId = Meteor.userId()
    const admin = Boolean(userId && (await Permissions.findOneAsync({ userId, claimId: CONSTANTS.claims.uberMensch._id }, { fields: { _id: 1 } })))
    if (!admin) throw new Meteor.Error('denied', 'Only an administrator can see this server\'s license.')
    return licenseStatusFor({ settings: Meteor.settings, env: process.env, running: result, access: (options) => enterpriseAccess({ ...options, stored: licenseKeys.cached() }) })
  },
})
