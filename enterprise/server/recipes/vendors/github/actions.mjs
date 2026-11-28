// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The GitHub App's registry actions (each a Meteor method, an /api/v1 route where mounted, an exec
// call and an MCP tool, from one definition):
//   connectors.githubApp.get       Admin › Integration apps › GitHub App: ids and fingerprints, never secrets
//   connectors.githubApp.set       an administrator enters the App's credentials (secrets sealed). A person only.
//   connectors.githubApp.clear     forgets them (the settings file's App, if any, serves again). A person only.
//   connectors.githubApp.manifest  the form a self-hosted admin's browser posts to GitHub to make the App in one click
//   recipes.github.installations   the GitHub installations and repositories a person may pick for a recipe,
//                                  and where "Install Slatebox on GitHub" goes
// The admin writes keep their own audit (as integration apps do); they are off the team activity log.
import { defineAction } from '/server/actions/registry.mjs'
import { requireAIControlAdmin } from '/server/actions/ai-control-get.mjs'
import { guardControlWrite } from '/server/actions/ai-providers.mjs'

const VIEW = {
  type: 'object',
  description: 'appId, slug, clientId, apiUrl (public); ready (every credential set); fingerprints { clientSecret, privateKey, webhookSecret } (sha256:…, never the secret); source (admin, settings or none); installUrl; secretsAvailable; updatedAt; updatedBy.',
}
const LINE = (what, max = 200) => ({ type: 'string', minLength: 1, maxLength: max, description: `The App's ${what}.` })
const OFF = { off: 'the GitHub App setup keeps its own audit (ai.audit.list), as integration apps do' }
const personOnly = () => 'Only a person sets up the GitHub App.'

/** vendor(): the running GitHub vendor (createVendor), set at server start. */
export function githubAppActions(vendor) {
  return [
    defineAction({
      id: 'connectors.githubApp.get',
      title: 'GitHub App',
      description: 'The Slatebox GitHub App this server uses for recipes: its id, slug and client id, whether every credential is set, fingerprints of its secrets (never the secrets), where it comes from (Admin or the settings file) and the install address. Administrators only.',
      toolset: 'admin',
      kind: 'read',
      scope: 'ai:admin:read',
      principals: ['person', 'agent'],
      mounts: { ddp: true, http: { method: 'GET', path: '/ai/control/github-app', operationId: 'getGithubApp' } },
      input: { type: 'object', properties: {}, additionalProperties: false },
      output: VIEW,
      handler: async (principal, _input, { deps }) => {
        await requireAIControlAdmin(principal, deps, 'read the GitHub App')
        return { status: 200, body: await vendor().appSettings.view() }
      },
    }),
    defineAction({
      id: 'connectors.githubApp.set',
      title: 'Save GitHub App',
      description: 'Saves the GitHub App\'s credentials: appId, slug, clientId, and the secrets (clientSecret, privateKey, webhookSecret), stored encrypted and never returned. They win over the settings file at once. Audited. A person only. Administrators only.',
      toolset: 'admin',
      kind: 'write',
      scope: 'ai:admin',
      principals: ['person'],
      mounts: { ddp: true },
      confirm: true,
      idempotent: true,
      idempotency: 'optional',
      replay: 'rerun',
      successStatus: 200,
      audit: OFF,
      input: {
        type: 'object',
        properties: {
          appId: LINE('id', 20), slug: LINE('slug (its github.com/apps/<slug> address)', 100), clientId: LINE('client id', 100),
          clientSecret: LINE('client secret'), privateKey: { type: 'string', minLength: 100, maxLength: 8000, description: 'The App\'s private key (.pem), whole.' }, webhookSecret: LINE('webhook secret'),
        },
        additionalProperties: false,
        minProperties: 1,
      },
      output: VIEW,
      handler: async (principal, input, { deps }) => {
        const actor = await guardControlWrite(principal, deps, { action: 'connectors.githubApp.set', target: { kind: 'integration-app', id: 'github-app' }, doing: 'set up the GitHub App', refusal: personOnly })
        return { status: 200, body: await vendor().appSettings.set({ actor, values: input }) }
      },
    }),
    defineAction({
      id: 'connectors.githubApp.clear',
      title: 'Clear GitHub App',
      description: 'Forgets the GitHub App credentials an administrator entered; the settings file\'s App, if any, is used again. Recipes on GitHub stop until an App is set. Audited. A person only. Administrators only.',
      toolset: 'admin',
      kind: 'write',
      scope: 'ai:admin',
      principals: ['person'],
      mounts: { ddp: true },
      confirm: true,
      destructive: true,
      idempotent: true,
      idempotency: 'optional',
      replay: 'rerun',
      successStatus: 200,
      audit: OFF,
      input: { type: 'object', properties: { reason: { type: 'string', maxLength: 500 } }, additionalProperties: false },
      output: VIEW,
      handler: async (principal, input, { deps }) => {
        const actor = await guardControlWrite(principal, deps, { action: 'connectors.githubApp.clear', target: { kind: 'integration-app', id: 'github-app' }, doing: 'set up the GitHub App', reason: input.reason ?? null, refusal: personOnly })
        return { status: 200, body: await vendor().appSettings.clear({ actor }) }
      },
    }),
    defineAction({
      id: 'connectors.githubApp.manifest',
      title: 'Make a GitHub App',
      description: 'The form that makes this server\'s own GitHub App in one click (GitHub\'s App manifest flow): post `manifest` to `action` from the browser; GitHub returns to Slatebox, which stores the new App\'s credentials sealed. org: make it in that GitHub organization. The link lasts ten minutes and works once. A person only. Administrators only.',
      toolset: 'admin',
      kind: 'write',
      scope: 'ai:admin',
      principals: ['person'],
      mounts: { ddp: true },
      successStatus: 200,
      idempotency: 'optional',
      replay: 'rerun',
      audit: OFF,
      input: { type: 'object', properties: { org: { type: 'string', pattern: '^[A-Za-z0-9-]{1,39}$' } }, additionalProperties: false },
      output: { type: 'object', properties: { action: { type: 'string' }, manifest: { type: 'string' }, state: { type: 'string' } } },
      handler: async (principal, input, { deps }) => {
        const actor = await guardControlWrite(principal, deps, { action: 'connectors.githubApp.manifest', target: { kind: 'integration-app', id: 'github-app' }, doing: 'set up the GitHub App', refusal: personOnly })
        return { status: 200, body: await vendor().appSettings.manifestFor({ actor, org: input.org ?? null }) }
      },
    }),
    defineAction({
      id: 'recipes.github.installations',
      title: 'GitHub repositories for recipes',
      description: 'The GitHub installations of the Slatebox GitHub App your GitHub account was shown to see, with their repositories, for picking what a recipe reads; and installUrl, GitHub\'s install screen for adding an account or repositories (null until an admin sets the App up). projectId: where GitHub sends you back after installing.',
      toolset: 'recipes',
      kind: 'read',
      scope: 'recipes:read',
      principals: ['person', 'agent'],
      mounts: { ddp: true, http: { method: 'GET', path: '/recipes/github/installations', operationId: 'listGithubInstallations' } },
      input: { type: 'object', properties: { projectId: { type: 'string', pattern: '^[A-Za-z0-9]{1,40}$' } }, additionalProperties: false },
      output: {
        type: 'object',
        properties: {
          installUrl: { type: ['string', 'null'] },
          installations: { type: 'array', items: { type: 'object', properties: { installationId: { type: 'string' }, account: { type: ['string', 'null'] }, repos: { type: 'array', items: { type: 'string' } }, allRepos: { type: 'boolean' } } } },
        },
      },
      handler: async (principal, input) => {
        const v = vendor()
        const installUrl = await v.installUrl(principal.userId, input.projectId ?? null).catch((error) => (error?.code === 'github_app_missing' ? null : Promise.reject(error)))
        return { status: 200, body: { installUrl, installations: await v.stores.installations.forUser(principal.userId) } }
      },
    }),
  ]
}
