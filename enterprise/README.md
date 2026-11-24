# enterprise/

<!-- Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE). -->

This directory holds Slatebox's enterprise features. They run on [Slatebox Cloud](https://app.slatebox.com), and on a self-hosted install once a license key from Slatebox LLC unlocks them ("Upgrade on prem"). It is **not MIT licensed**. Its files are under the [Slatebox Enterprise License](LICENSE). You may read, change and test this code. Running it in production needs an agreement with Slatebox LLC. Everything outside this directory is MIT ([LICENSE.md](../LICENSE.md)).

## What lives here

Outside agent connections: Slatebox as an MCP *client*.

- Inviting an outside MCP server onto a slate as a named cursor, from the gallery or a pasted address.
- Its suggestions, shown live on the slate as ghost notes that anyone can Keep or Discard.
- Connectors and the integrations built on them, with their OAuth sign-in (callback `/connectors/oauth/callback`).

### What is built (S2a: open servers)

- `server/mcp-fetch.mjs`: the only network path (https only, every resolved address public, redirects re-checked, size and time caps, a real User-Agent, no listening stream).
- `server/mcp-session.mjs`: one short `@modelcontextprotocol/client` session per job (2026 servers through `server/discover`, older ones through `initialize`). A signed-in server gets the asking person's token, bound to that server's origin only.
- `server/tools.mjs`, `results.mjs`, `context.mjs`, `translate.mjs`: consent to tool hashes, quarantine of results, the context packer ("what leaves Slatebox"), and the two-step translator (plan lookups, then lay out notes; Excalidraw diagrams by a fixed recipe).
- `server/service.mjs`, `actions.mjs`, `meteor.js`: `connectors.list/discover/connect/disconnect/call/keep/discard`, each a Meteor method, `/api/v1` route, exec call and MCP tool. On Cloud the inviter needs Pro; only the inviter asks; any editor keeps.
- `client/`: "+ Invite agent", the walkthrough, each invited agent's chip on the people strip (ask it there, or by `@name` in Ask Slatebox) and the live ghosts on the canvas with Keep and Discard on each.
- Tests: `npm run test:enterprise` (with the hostile server in `scripts/mcp-test-servers.mjs`).

### What is built (S2b: servers that need sign-in)

- `server/oauth.mjs`: the OAuth steps and their checks: protected resource metadata (its `resource` must be the invited server), authorization server metadata (its `issuer` must match exactly), PKCE S256 required, every endpoint https and public, registration in order (an app registered ahead of time, Slatebox's Client ID Metadata Document at `/oauth/mcp-client.json`, automatic registration, a pasted client id), `resource` on every request, `iss` checked on the callback.
- `server/signin.mjs` and `server/routes.mjs`: the popup flow. `POST /connectors/oauth/start` (from the signed-in Slatebox page, with its login token) lets only the flow's owner claim it, ties it to the browser (HttpOnly cookie) and answers the server's sign-in address for the popup; there is no GET start, so a link can never start someone's sign-in; `GET /connectors/oauth/callback` takes the single-use state, checks the browser and `iss`, and exchanges the code. Flows expire after 10 minutes.
- `server/credentials.mjs`: the vault. Tokens, pasted keys and registration secrets are sealed (AES-256-GCM, `web/app/server/metering/vault.mjs`) under the app's existing `SLATEBOX_KEY_ENCRYPTION_KEY`, bound to person, address, issuer and field. Refresh runs under a lease; a refused refresh shows "needs sign-in" on the agent. Removing the last agent on a server revokes and forgets its sign-in.
- `connectors.signIn`, `connectors.signInStatus`, `connectors.useKey` (pasted keys and tokens, `writeOnly`): Meteor method, `/api/v1` route, exec call and MCP tool, like the others.
- Settings (`server/connector-settings.mjs`): `settings.connectors.oauthApps.<provider>.{clientId, clientSecret, scopes?}`. GitHub is a known provider (issuer `https://github.com/login/oauth`, scopes `public_repo read:org` unless `scopes` widens them, pinned to `https://api.githubcopilot.com`); any other provider also gives `issuer` and `resources`.

Slatebox as an MCP *server* (`/mcp`, the CLI, `/api/v1`) is not here. It is MIT and works on every install.

## Where it runs

- **Slatebox Cloud.** `settings.public.edition` is `'cloud'`. Inviting agents needs Slatebox Pro for the person who invites.
- **Self-hosted, locked.** Every self-host image carries this directory. It stays locked: the app never requires it and nothing registers.
- **Self-hosted, unlocked.** A license key from Slatebox LLC (`settings.enterprise.license`, `settings.enterprise.licenseFile`, or the `SLATEBOX_LICENSE` / `SLATEBOX_LICENSE_FILE` environment variables) unlocks it on that install. `web/app/server/enterprise-license.mjs` checks the key offline: an Ed25519 signature against Slatebox LLC's public keys, which are in that file; the private keys never are. The key may name the install's host names, and ends on its date after a 14-day grace. A licensed install has no Slatebox Pro, so its license is what lets people who can edit invite agents. Every action, method and route is checked against the license again while the server runs. Administrators see the state, and **Upgrade on prem**, in Admin tools (`enterprise.licenseStatus`).
- **No feature switch.** Wherever this code runs, invited agents are on. `settings.connectors.off: true` (server-side, never public) is the kill switch.
- **Not enterprise.** Single sign-on with the bundled Keycloak is MIT and free on every install, as are Slatebox's own MCP server, CLI and API.
- **Loading.** Where enterprise code is locked the app never requires it. Where it is unlocked, `web/app/server/enterprise-loader.mjs` calls `server/index.js` → `register(api, context)` once at start, and writes `settings.public.enterprise` so browsers know; `web/app/client/enterprise.js` then loads `client/index.jsx` as its own chunk. This code reaches the app only through that `api`: actions (each one a Meteor method, an `/api/v1` route, an exec call and an MCP tool, with the same permission checks), routes, methods and UI slots.
- **Builds.** Meteor builds only `web/app`. Run `node scripts/enterprise-stage.mjs link` in local development, which makes the git-ignored link `web/app/enterprise` → `enterprise/`. Every image build copies this directory into its build context and checks it is there (`scripts/test-port-container.mjs`, `self-host/build-images.sh`, `enterprise-stage.mjs check-present`).

Every file here carries the words "Licensed under the Slatebox Enterprise License" in its first lines. The self-host build check looks for them.
