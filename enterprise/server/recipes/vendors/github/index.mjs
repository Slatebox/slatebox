// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The GitHub vendor plug-in for the recipe runtime (design F.1):
//   name               'github'
//   session(instance)  what a recipe sees as ctx.vendor.github: read calls only (no write, no merge,
//                      no delete), under the installation token of instance.match.github.installationId,
//                      after checking the owner's own GitHub sign-in was shown to see that installation
//                      and that every configured repository is still in it
//   routes()           the webhook and the install callback (routes.mjs), and the manifest callback
//   matchInstances(e)  the RecipeInstances selector for an event
//   perform(write)     a write outside Slatebox, called only after permissions said allow or a person
//                      approved its card (perform.mjs)
//   checkHardLimits(w) 'refused' | null
// Plus installUrl(userId, projectId) for the "Install Slatebox on GitHub" button, and appSettings
// (Admin › Integration apps › GitHub App).
//
// deps: { collections: { installations, deliveries, appSettings, flows } (Mongo driver collections),
//         master (vault key or null), settings() → settings.connectors.githubApp, fetch?, now?, log?,
//         later?, origin() → this Slatebox's address, audit?(entry), edition?() → { cloud, test } (app-settings.mjs) }
import { createInstallationTokens, GITHUB_API } from './app.mjs'
import { createGithubAppSettings, appOAuth, MANIFEST_CALLBACK_PATH } from './app-settings.mjs'
import { createGithubClient, createInstallationGate, GithubError } from './client.mjs'
import { checkHardLimits, performWrite } from './perform.mjs'
import { githubRoutes, signState } from './routes.mjs'
import { createGithubStores } from './store.mjs'

// Back to Admin › AI control › Integration apps (the tab by ?tab=), saying how it went.
export const ADMIN_BACK = (status) => `/admin/ai?tab=integration-apps&github=${status}`

export const READ_CALLS = Object.freeze(['head', 'repo', 'branch', 'compare', 'contents', 'tarball', 'pull', 'pullFiles', 'issueComments', 'ref', 'commit'])

const signInNeeded = (message) => Object.assign(new GithubError(message, { status: 401, code: 'sign_in_needed' }), { name: 'SignInNeeded' })
const accessLost = (message) => Object.assign(new GithubError(message, { status: 403, code: 'blocked_access' }), { name: 'AccessLost' })

function docRows(collection, id = 'app') {
  return {
    get: () => collection.findOne({ _id: id }),
    put: (doc) => collection.updateOne({ _id: id }, { $set: { ...doc, _id: id } }, { upsert: true }),
    remove: () => collection.deleteOne({ _id: id }),
  }
}
function flowRows(collection, now) {
  return {
    put: (state, value, expiresAt) => collection.insertOne({ _id: state, value, expiresAt }),
    async take(state) {
      const doc = await collection.findOne({ _id: state })
      if (!doc) return null
      const { deletedCount } = await collection.deleteOne({ _id: state })
      if (!deletedCount || (doc.expiresAt && new Date(doc.expiresAt).getTime() < now())) return null
      return doc.value
    },
  }
}

export function createVendor(deps) {
  const { collections, now = () => Date.now(), log = () => {}, later, fetch = globalThis.fetch } = deps
  const stores = createGithubStores({ installations: collections.installations, deliveries: collections.deliveries, now })
  const appSettings = createGithubAppSettings({
    rows: docRows(collections.appSettings), master: deps.master ?? null, settings: deps.settings, flows: flowRows(collections.flows, now), fetch, audit: deps.audit, now, origin: deps.origin, edition: deps.edition,
  })
  const apiBase = async () => (await appSettings.credentials()).apiUrl || GITHUB_API
  const tokens = createInstallationTokens({
    fetch,
    apiBase,
    credentials: async () => {
      const c = await appSettings.credentials()
      return { appId: c.appId, privateKey: c.privateKey }
    },
    now,
  })
  const gate = createInstallationGate({ now })

  function clientFor(installationId, { budget = null, signal = null, base = GITHUB_API } = {}) {
    return createGithubClient({
      fetch, apiBase: base, installationId, gate, budget, signal,
      token: () => tokens.token(installationId),
      refresh: () => {
        tokens.forget(installationId)
        return tokens.token(installationId)
      },
    })
  }

  async function installationFor(instance) {
    const installationId = instance?.match?.github?.installationId
    if (!installationId) throw signInNeeded('Install Slatebox on GitHub and pick the repositories for this recipe.')
    const doc = await stores.installations.get(installationId)
    if (!doc || doc.suspended) throw signInNeeded('The Slatebox GitHub App is no longer installed there. Install it again.')
    if (!(await stores.installations.userCanSee(instance.ownerId, installationId))) throw signInNeeded('Connect GitHub again: this installation is not one your GitHub account can see.')
    const repos = instance.match.github.repos || []
    const missing = doc.allRepos ? [] : repos.filter((r) => !(doc.repos || []).includes(r))
    if (missing.length) throw accessLost(`Slatebox no longer has access to ${missing.join(', ')} on GitHub.`)
    return installationId
  }

  return {
    name: 'github',
    stores,
    appSettings,
    async session(instance, { signal = null, budget = null } = {}) {
      const installationId = await installationFor(instance)
      const client = clientFor(installationId, { budget, signal, base: await apiBase() })
      // every HTTP call is counted against the run's budget by the client itself (countsOwnCalls)
      return Object.freeze(Object.fromEntries([...READ_CALLS.map((name) => [name, client[name]]), ['stats', client.stats], ['installationId', installationId], ['countsOwnCalls', true]]))
    },
    routes() {
      const credentials = () => appSettings.credentials()
      const routes = githubRoutes({
        stores,
        secret: async () => (await credentials()).webhookSecret,
        stateSecret: async () => (await credentials()).webhookSecret || 'unset',
        oauth: appOAuth({ credentials, fetch }),
        fetch,
        apiBase,
        async installationInfo(installationId) {
          const info = await tokens.installation(installationId)
          // The repositories the installation holds (installation token, paged).
          const repos = []
          for (let page = 1; page <= 10; page += 1) {
            const res = await fetch(`${await apiBase()}/installation/repositories?per_page=100&page=${page}`, {
              headers: { authorization: `Bearer ${await tokens.token(installationId)}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'Slatebox-Recipes' },
            })
            if (!res.ok) break
            const data = await res.json()
            repos.push(...(data.repositories || []).map((r) => r.full_name))
            if ((data.repositories || []).length < 100) break
          }
          return { account: info.account?.login ?? null, accountType: info.account?.type ?? null, suspended: Boolean(info.suspended_at), allRepos: info.repository_selection === 'all', repos }
        },
        later,
        log,
        now,
      })
      routes.push({
        method: 'GET',
        path: MANIFEST_CALLBACK_PATH,
        raw: false,
        async handler(req, res) {
          res.setHeader('Cache-Control', 'no-store')
          res.setHeader('Referrer-Policy', 'no-referrer')
          const q = req.query || {}
          try {
            await appSettings.finishManifest({ code: q.code, state: q.state })
            log({ kind: 'github_app_created' })
            return res.redirect(302, ADMIN_BACK('ready'))
          } catch (error) {
            log({ kind: 'github_app_failed', code: error?.code ?? null })
            return res.redirect(302, ADMIN_BACK('failed'))
          }
        },
      })
      return routes
    },
    matchInstances(event) {
      return {
        'match.github.installationId': String(event.installationId),
        ...(event.repo && { 'match.github.repos': event.repo }),
      }
    },
    async perform(write, { instance, grant = null, signal = null } = {}) {
      // Only a repository the person picked for this recipe, whatever else the installation holds
      // or a permission's scope names.
      if (!(instance?.match?.github?.repos || []).includes(write?.target?.repo)) return { refused: 'repo_not_picked' }
      const installationId = await installationFor(instance)
      return performWrite(clientFor(installationId, { signal, base: await apiBase() }), write, { grant })
    },
    checkHardLimits: (write, grant = null) => (checkHardLimits(write, grant) ? 'refused' : null),
    /** The installation an instance runs on: the one its owner can see that holds every picked repository. */
    async resolveMatch(match, ownerId) {
      const repos = match?.github?.repos || []
      if (!repos.length || match.github.installationId) return match
      const seen = await stores.installations.forUser(ownerId)
      const holds = seen.find((doc) => doc.allRepos || repos.every((r) => (doc.repos || []).includes(r)))
      if (!holds) throw Object.assign(new Error(`Install Slatebox on GitHub for ${repos.join(', ')} first.`), { status: 409, code: 'github_not_installed' })
      return { ...match, github: { ...match.github, installationId: String(holds._id ?? holds.installationId) } }
    },
    /** Where "Install Slatebox on GitHub" goes: GitHub's install screen, with Slatebox's signed state. */
    async installUrl(userId, projectId = null) {
      const c = await appSettings.credentials()
      if (!c.slug || !c.webhookSecret) throw Object.assign(new Error('The GitHub App is not set up on this server yet. An admin sets it up in Admin › Integration apps.'), { status: 409, code: 'github_app_missing' })
      const state = signState(c.webhookSecret, { userId, projectId, at: now() })
      return `${c.webUrl}/apps/${encodeURIComponent(c.slug)}/installations/new?state=${encodeURIComponent(state)}`
    },
  }
}
