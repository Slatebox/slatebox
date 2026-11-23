# enterprise/

<!-- Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE). -->

This directory holds the parts of Slatebox that run only on [Slatebox Cloud](https://app.slatebox.com). It is **not MIT licensed**. Its files are under the [Slatebox Enterprise License](LICENSE). You may read, change and test this code. Running it in production needs an agreement with Slatebox LLC. Everything outside this directory is MIT ([LICENSE.md](../LICENSE.md)).

## What lives here

Outside agent connections: Slatebox as an MCP *client*.

- Inviting an outside MCP server onto a slate as a named cursor, from the gallery or a pasted address.
- Its suggestions, shown live on the slate as ghost notes that anyone can Keep or Discard.
- Connectors and the integrations built on them, with their OAuth sign-in (callback `/connectors/oauth/callback`).

Slatebox as an MCP *server* (`/mcp`, the CLI, `/api/v1`) is not here. It is MIT and works on every install.

## Cloud only

A self-hosted Slatebox never contains or runs this code.

- **One switch.** `settings.public.edition` is `'cloud'` on Slatebox Cloud. When the key is missing or has any other value, the install is self-host (`web/app/imports/api/common/edition.mjs`).
- **Feature switch.** On Cloud, the invite UI also needs `settings.public.agents.invite: true`. It is off by default.
- **Loading.** On self-host the app never requires this code. On Cloud, `web/app/server/enterprise-loader.mjs` calls `server/index.js` → `register(api, context)` once at start, and `web/app/client/enterprise.js` loads `client/index.jsx` as its own chunk. This code reaches the app only through that `api`: actions (each one a Meteor method, an `/api/v1` route, an exec call and an MCP tool, with the same permission checks), routes, methods and UI slots.
- **Builds.** Meteor builds only `web/app`. Run `node scripts/enterprise-stage.mjs link` in local development, which makes the git-ignored link `web/app/enterprise` → `enterprise/`. A Cloud image build copies this directory into its build context (`scripts/test-port-container.mjs`). The self-host image build (`self-host/build-images.sh`) puts a stub with no enterprise code there instead, then checks that nothing from this directory reached the image.

Every file here carries the words "Licensed under the Slatebox Enterprise License" in its first lines. The self-host build check looks for them.
