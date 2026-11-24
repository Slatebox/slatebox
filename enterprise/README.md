# enterprise/

<!-- Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE). -->

This directory holds the parts of Slatebox that run only on [Slatebox Cloud](https://app.slatebox.com). It is **not MIT licensed**. Its files are under the [Slatebox Enterprise License](LICENSE). You may read, change and test this code. Running it in production needs an agreement with Slatebox LLC. Everything outside this directory is MIT ([LICENSE.md](../LICENSE.md)).

## What lives here

Outside agent connections: Slatebox as an MCP *client*.

- Inviting an outside MCP server onto a slate as a named cursor, from the gallery or a pasted address.
- Its suggestions, shown live on the slate as ghost notes that anyone can Keep or Discard.
- Connectors and the integrations built on them, with their OAuth sign-in (callback `/connectors/oauth/callback`).

### What is built (S2a: open servers)

- `server/mcp-fetch.mjs`: the only network path (https only, every resolved address public, redirects re-checked, size and time caps, a real User-Agent, no listening stream).
- `server/mcp-session.mjs`: one short `@modelcontextprotocol/client` session per job (2026 servers through `server/discover`, older ones through `initialize`). A signed-in server gets the asking person's token, bound to that server's origin only.
- `server/tools.mjs`, `results.mjs`, `context.mjs`, `translate.mjs`: consent to tool hashes, quarantine of results, the context packer ("what leaves Slatebox"), and the two-step translator (plan lookups, then lay out notes; Excalidraw diagrams by a fixed recipe).
- `server/service.mjs`, `actions.mjs`, `meteor.js`: `connectors.list/discover/connect/disconnect/call/keep/discard`, each a Meteor method, `/api/v1` route, exec call and MCP tool. Pro for the inviter, only the inviter asks, any editor keeps.
- `client/`: "+ Invite agent", the walkthrough, the agent chips (Keep all / Discard all) and the live ghosts on the canvas with Keep and Discard on each.
- Tests: `npm run test:enterprise` (with the hostile server in `scripts/mcp-test-servers.mjs`).

### What is built (S2b: servers that need sign-in)

- `server/oauth.mjs`: the OAuth steps and their checks: protected resource metadata (its `resource` must be the invited server), authorization server metadata (its `issuer` must match exactly), PKCE S256 required, every endpoint https and public, registration in order (an app registered ahead of time, Slatebox's Client ID Metadata Document at `/oauth/mcp-client.json`, automatic registration, a pasted client id), `resource` on every request, `iss` checked on the callback.
- `server/signin.mjs` and `server/routes.mjs`: the popup flow. `GET /connectors/oauth/start` ties the flow to the browser (HttpOnly cookie) and sends it to the server's page; `GET /connectors/oauth/callback` takes the single-use state, checks the browser and `iss`, and exchanges the code. Flows expire after 10 minutes.
- `server/credentials.mjs`: the vault. Tokens, pasted keys and registration secrets are sealed (AES-256-GCM, `web/app/server/metering/vault.mjs`) under the app's existing `SLATEBOX_KEY_ENCRYPTION_KEY`, bound to person, address, issuer and field. Refresh runs under a lease; a refused refresh shows "needs sign-in" on the agent. Removing the last agent on a server revokes and forgets its sign-in.
- `connectors.signIn`, `connectors.signInStatus`, `connectors.useKey` (pasted keys and tokens, `writeOnly`): Meteor method, `/api/v1` route, exec call and MCP tool, like the others.
- Settings (`server/connector-settings.mjs`): `settings.connectors.oauthApps.<provider>.{clientId, clientSecret, scopes?}`. GitHub is a known provider (issuer `https://github.com/login/oauth`, scope `repo`); any other provider also gives `issuer`.

Slatebox as an MCP *server* (`/mcp`, the CLI, `/api/v1`) is not here. It is MIT and works on every install.

## Cloud only

A self-hosted Slatebox never contains or runs this code.

- **One switch.** `settings.public.edition` is `'cloud'` on Slatebox Cloud. When the key is missing or has any other value, the install is self-host (`web/app/imports/api/common/edition.mjs`).
- **Feature switch.** On Cloud, the invite UI also needs `settings.public.agents.invite: true`. It is off by default.
- **Loading.** On self-host the app never requires this code. On Cloud, `web/app/server/enterprise-loader.mjs` calls `server/index.js` → `register(api, context)` once at start, and `web/app/client/enterprise.js` loads `client/index.jsx` as its own chunk. This code reaches the app only through that `api`: actions (each one a Meteor method, an `/api/v1` route, an exec call and an MCP tool, with the same permission checks), routes, methods and UI slots.
- **Builds.** Meteor builds only `web/app`. Run `node scripts/enterprise-stage.mjs link` in local development, which makes the git-ignored link `web/app/enterprise` → `enterprise/`. A Cloud image build copies this directory into its build context (`scripts/test-port-container.mjs`). The self-host image build (`self-host/build-images.sh`) puts a stub with no enterprise code there instead, then checks that nothing from this directory reached the image.

Every file here carries the words "Licensed under the Slatebox Enterprise License" in its first lines. The self-host build check looks for them.
