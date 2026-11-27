# Design: Slatebox in one container

One image, `ghcr.io/slatebox/slatebox`, is a complete Slatebox. One command
starts it, one volume holds everything it knows, one port serves it.

```sh
docker run -d --name slatebox -p 7070:7070 -v slatebox-data:/data ghcr.io/slatebox/slatebox
```

## Process tree

```
tini                     PID 1: reaps orphans, passes SIGTERM on
└─ slatebox-init         the supervisor, a Bash script
   ├─ mongod             MongoDB 8.0, single-member replica set    127.0.0.1:27017
   ├─ node bin/server.js collaboration relay (y-websocket fork)    127.0.0.1:7072
   ├─ node main.js       the Slatebox app (Meteor bundle)          127.0.0.1:3000
   ├─ caddy              front proxy                               0.0.0.0:7070 (and :80, :443 with built-in HTTPS)
   └─ java (kc.sh)       Keycloak, only with SLATEBOX_SSO=keycloak 127.0.0.1:7080 (management 127.0.0.1:7083)
```

Everything runs as the unprivileged user `slatebox` (10001). Nothing in the
container ever runs as root, and only Caddy listens beyond loopback. The
account's home is `/run/slatebox`, inside the container, so that caches never
land on the data volume.

**Supervisor: tini plus a Bash script.** The job is small: start four
processes in order, stop them in order, and leave when one of them dies. tini
(a 30 kB static binary from Ubuntu's package) does what PID 1 must do. The
script (`rootfs/opt/slatebox/bin/slatebox-init`) uses Bash's `wait -n -p`,
adds no runtime and no resident memory beyond the shell, and is short enough
to read in one sitting. s6-overlay and supervisord were considered: both want
to keep a container alive and restart services inside it, which is the
opposite of what Docker's restart policy needs, and supervisord would add a
Python runtime.

**Front proxy: Caddy.** One static binary proxies HTTP and WebSocket
traffic and obtains and renews certificates by itself. nginx would need a
second program for certificates. A proxy written for the purpose in Node
would not do HTTPS.

## One port, one origin

The browser talks to a single origin. Caddy sends `/live/*` to the relay with
the prefix removed (the relay reads the room name from the path) and
everything else to the app. The app tells browsers where the relay is through
`public.wsUrl`, which `configure.mjs` derives from the public address:
`http://localhost:7070` gives `ws://localhost:7070/live`,
`https://boards.example.com` gives `wss://boards.example.com/live`.
`Canvas.jsx` and `SnapSlate.jsx` hand that value to SlateboxJS unchanged, and
y-websocket appends `/<room>?token=…` (a room token for that one slate,
read or write, that `collaborators.init` mints only for someone who may open
the slate). The old room-less `bearer`/`timestamp` pair is off in both halves
(`relay: { legacy: false }` in the app's settings, `RELAY_ALLOW_LEGACY=false`
for the relay), and the deep health check connects with a short-lived read
token for the `slatebox-health` room. The relay checks the token with a key
derived from the same API secret it gets in `API_KEYS`, so self-hosting needs
no new secret.

Because links, sign-in mail and the live-editing address are all built from
the public address, the proxy only serves the app for that address (and for
the container's own loopback checks). Reached under any other host or port it
answers with a page that says which setting to change, rather than an app in
which live editing silently fails.

While the app boots, Caddy answers with a self-refreshing "Slatebox is
starting" page instead of a refused connection.

## Paths under /data

| Path | Contents |
| --- | --- |
| `/data/db` | MongoDB data files |
| `/data/secrets/secrets.json` | Generated secrets, mode 0600 in a 0700 directory |
| `/data/secrets/mongo.key` | Replica-set key file, mode 0400 |
| `/data/caddy` | Certificates and ACME account, only with built-in HTTPS |
| `/data/keycloak` | Keycloak's H2 database and transaction log, only with single sign-on (`/opt/keycloak/data` links here) |
| `/data/tmp` | Working files of a running backup or restore |

Files rendered for the current start (environment for the app and relay, the
Caddyfile, credentials for the database tools) live in `/run/slatebox`, mode
0600, inside the container and not on the volume. They are rewritten at every
start.

## First start, and every start

1. `configure.mjs` validates the settings, creates any missing secret with
   `crypto.randomBytes(32)` (Mongo root, app and relay passwords, the
   replica-set key, the API key pair the app and relay share, and the relay's
   encryption key), and renders the files above. An unknown `SLATEBOX_*`
   variable stops the start with the list of valid names. A database without
   its secrets stops the start too.
2. `mongod` starts with access control on, bound to loopback.
3. `mongo-init.mjs` initiates the replica set and creates the `root`, `app`
   and `relay` accounts if they are missing, then waits for a writable
   primary. The first administrator is created through MongoDB's loopback
   exception; an interrupted first start resumes where it stopped.
4. Caddy, the relay and the app start.
5. A readiness check opens a signed live-editing connection through port
   7070, exactly as a browser would. Only then does the log say `Ready`.

A second start finds the secrets and the accounts and changes neither.
No secret is in the image, in the container's environment or in the log.

## Health

`HEALTHCHECK` runs `slatebox health`: through port 7070 it asks the app's
`/readyz` (which queries the slates collection) and the relay. It is green
only when the proxy, the app, the database and the relay all answer. The
signed WebSocket handshake is part of the start-up check and of every restore;
it is left out of the periodic check because the relay logs each connection.

The start-up check allows ten minutes before it gives up and the container
exits; the health check's start period is the same. A start normally takes
well under a minute, but the app's boot is CPU-bound and a small or busy
machine can need several.

## Stopping and failing

`docker stop` sends SIGTERM. The supervisor stops the app and the relay first
(they hold no state and end at once; after three seconds they are killed),
then sends SIGTERM to Caddy and `mongod` together and waits for MongoDB's
clean exit. MongoDB's fifteen-second quiesce period for signalled shutdowns is
set to zero, since its clients are already gone. What remains is the storage
engine's final checkpoint: under a second on an idle disk, several seconds on
a heavily loaded one. Exit status 0. If the disk is so slow that this exceeds
Docker's ten-second default, Docker kills the container and MongoDB replays
its journal at the next start; no acknowledged write is lost.

If any of the four processes ends by itself, the same ordered stop runs and
the container exits with status 1. With `--restart unless-stopped` Docker
starts it again on the same volume.

The supervisor also answers two signals used by `slatebox restore`: SIGUSR1
stops the app and the relay and leaves MongoDB and Caddy running (the proxy
shows the starting page), SIGUSR2 starts them again.

## Processors

MongoDB 8.0 sets the floor: x86-64 with AVX (Intel Sandy Bridge, AMD
Bulldozer, 2011) and arm64 with ARMv8.2-A (Cortex-A76 and later: a Raspberry
Pi 5, Graviton 2, Ampere Altra, Apple silicon). Run under QEMU's CPU models,
`mongod --version` dies with SIGILL on Westmere and Nehalem (no AVX) and on
Cortex-A53 and A72 (a Raspberry Pi 3 and 4), and runs on Sandy Bridge,
Cortex-A76 and Neoverse-N1. Caddy runs on all of them. Node crashes inside
QEMU's user-mode emulator on every model, Sandy Bridge included, so its floor
was not measured that way; Node's Linux builds detect CPU features at run
time rather than requiring AVX. Before starting MongoDB the supervisor runs
`mongod --version`; exit 132 (SIGILL) stops the start with a message naming
the requirement and `MONGO_URL` as the way out. The same message follows if
MongoDB itself later ends with SIGILL.

## The log

Every line carries the name of the process that wrote it: `[slatebox]`,
`[app]`, `[relay]`, `[proxy]`, `[mongo]`. MongoDB writes a JSON line for
every routine event and several host-tuning hints at each start; only its
errors are passed on. Caddy logs errors only. The relay's Node deprecation notice
is switched off.

What people write never reaches the log. The app and the relay log ids,
counts and sizes, never note text, chat, AI prompts or replies, email
addresses or tokens. `tests/log-content.test.mjs` runs a session of live
edits, the slate conversation, an AI-drafted workshop and its chat, account
mail and a refused live connection, then searches the whole log for each of
those texts and credentials.

## Settings

Every setting is optional.

| Variable | Effect |
| --- | --- |
| `SLATEBOX_URL` | The address people type. Default `http://localhost:7070`. |
| `SLATEBOX_HTTPS` | `auto` (default): an `https://` address turns on built-in HTTPS on ports 80 and 443. `off`: your own proxy terminates HTTPS and forwards to 7070. |
| `SLATEBOX_ACME_CA` | ACME directory of a private certificate authority, instead of Let's Encrypt. |
| `SLATEBOX_MAIL_URL` | `smtp://` or `smtps://` URL for invitations, verification and password mail. |
| `SLATEBOX_MAIL_FROM` | The sender, an address the operator's mail service accepts (`settings.mailFrom`). Defaults to the SMTP user name when that is an address; otherwise required with `SLATEBOX_MAIL_URL`. |
| `SLATEBOX_AI_KEY` | DeepInfra key for the built-in AI. With `SLATEBOX_AI_URL`, the bearer token for that endpoint. |
| `SLATEBOX_AI_URL`, `SLATEBOX_AI_MODEL` | An OpenAI-compatible endpoint and model, written as `settings.ai.connections.server` with `use.default` (every feature), and as `selfHosted.workshopProvider` for apps that predate `settings.ai`. |
| `SLATEBOX_AI_CONFIG` | JSON: named connections (`openai-compatible` with `url`, or `openai`, `anthropic`, `deepinfra`; `key`, `model`, `tools`, `vision`, `images`, `maxTokens`, `toolChoice`) and `use` (`default`, `chat`, `generation`, `presentation`, `vision`, `images`: a name or `builtin`). Checked by `lib/ai-config.mjs` before anything is written: cloud metadata addresses, credentials in a URL, unknown fields and dangling names stop the start. Becomes `settings.ai`; keys never reach the log. No model is bundled or named. |
| `SLATEBOX_AI_PROVIDERS`, `SLATEBOX_AI_DEFAULT` | The installer's form (`npx slatebox`): a JSON list of providers (`id`, `kind` `openai-compatible` with `baseUrl`, or `deepinfra`; `model`, `toolChoice`, `keyEnv`) and the one every feature uses (needed with more than one). Each key is in its own variable `SLATEBOX_AI_KEY_<NAME>`, the one `keyEnv` names, so keys stay in the installer's secrets file and out of the list; a key variable no provider names stops the start. Becomes `settings.ai` like `SLATEBOX_AI_CONFIG`. `slatebox settings --json` lists every setting the image accepts, for an installer to read from the image. |
| `SLATEBOX_AI_OWN_PROVIDERS` | `on` (default) or `off`: `settings.ai.ownProviders`, the one switch that stops people and teams from using their own AI. |
| `SLATEBOX_AI_PRIVATE_ENDPOINTS` | `on` (default) or `off`: `settings.ai.privateEndpoints`. Off, people's and teams' own endpoints must be public addresses (the app's `endpoint-policy.mjs`); the operator's connections keep the operator rules. Separate from the switch, so a server can allow own cloud keys without letting every account probe the LAN through Test connection. Also accepted as `privateEndpoints` in `SLATEBOX_AI_CONFIG`; the variable wins. |
| `SLATEBOX_KEY_ENCRYPTION_KEY` | 32 bytes in base64 (standard or URL-safe; anything else stops the start, without printing the value). Written to `app.env` only, never to the app's settings, where the app's key vault reads it as the master key for every saved AI and call key (AES-256-GCM): the administrator's in Admin → AI control and people's own, and the integration apps' client secrets entered in Admin → AI control → Integration apps (`connectorOAuthApps`). Unset: `lib/common.mjs` `ensureKeyEncryptionKey` makes one on first boot and keeps it in `/data/secrets/key-encryption.key` (0600), read back on every later start and never replaced (a file that does not hold a key stops the start). Since keys now live only in the backend, a server without one could not save any AI key. The secrets are not in the backup: a restore onto the same volume keeps the key; onto a new volume, set the variable to the old key or saved keys and client secrets must be added again. |
| `SLATEBOX_SETTINGS` | A JSON object merged into the app's settings, for integrations without a variable of their own (`daily.apiKey` for calls, `aws.*` to keep stored files in an S3 bucket instead of the database, `connectors.off` to turn integrations off). It cannot change the generated address and key wiring or the edition, and it refuses settings that exist only on Slatebox Cloud. |
| `MONGO_URL`, `MONGO_OPLOG_URL` | Use an external MongoDB. The bundled `mongod` is not started. |
| `SLATEBOX_SSO` | `off` (default) or `keycloak`: single sign-on through the bundled Keycloak (below). |
| `SLATEBOX_SSO_ONLY` | `true` with `SLATEBOX_SSO=keycloak`: no passwords and no guests. |
| `SLATEBOX_SSO_ADMIN` | `open` (default) or `closed` with `SLATEBOX_SSO=keycloak`: `closed` answers 404 for `/auth/admin` and `/auth/realms/master` on the published port. |
| `SLATEBOX_SSO_DEFAULT_ROLE` | `member` (default) or `none` with `SLATEBOX_SSO=keycloak`: whether a person single sign-on lets in joins the first team as a Member, or only by invitation (below). |
| `SLATEBOX_SSO_DOMAINS` | Comma-separated email domains with `SLATEBOX_SSO=keycloak`, for example `example.com,example.org`: single sign-on refuses any address outside them. Unset, every address the identity provider verified is allowed. |

The app's settings are generated at every start: `public.env = selfhost`,
`edition = self-host` (integrations, the enterprise code, run with no key;
`SLATEBOX_SETTINGS` cannot change the edition), `baseUrl`, `wsUrl`,
`chatWoot.enabled = false`, `cloudLinks` (true only
when `SLATEBOX_SETTINGS` configures an S3 bucket), `mailFrom`, `slateboxAPI`
and `selfHosted.workshopAI`. Files the app stores (uploads, AI images,
presentation images) go to the database's `files` GridFS bucket and are served
by the app at `/files/`, so a backup carries them; only an `aws.imageBucket`
in `SLATEBOX_SETTINGS` sends them to S3 instead. With `public.env = selfhost` the app also leaves
out Heap analytics and every screen that belongs to the hosted service; the
interface fonts are the app's own, served at `/fonts/`, so a page view sends
nothing to a font host. The relay gets `API_KEYS` and
`API_GEN_KEY`; MongoDB has three accounts (root, app, relay).

Setting names are matched in any case, so `slatebox_url` stops the start
instead of being ignored. An address that fails to parse is shown in the log
with its user name and password replaced by `***`.

Every process runs as uid 10001 by default. `docker run --user UID:GID` runs
them all as another user instead, for a host folder that user owns;
`/run/slatebox` is sticky and open to any user for that reason, and every file
written there is private to its writer.

**Account recovery:** `docker exec slatebox slatebox password-link EMAIL`
writes the same reset record Meteor's "forgot password" mail does and prints
the link, so the app's reset page accepts it once, within three days. It is
the recovery path when mail is off.

## Upgrade, backup, restore

**Upgrade:** pull, remove the container, run the same command. The volume
carries the data and the secrets; the new container finds both.

**Backup:** `docker exec slatebox slatebox backup > slatebox-backup.gz` writes
a gzip-compressed `mongodump` archive of the `slatebox` database. The dump is
completed and verified inside the container before the first byte is written
out, so a failed backup leaves an empty file, never a plausible partial one.
The secrets are not in the backup and are not needed: accounts, passwords and
login tokens live in the database, and the API key pair only signs live
connections between the app and relay of one installation.

**Restore:** `docker exec -i slatebox slatebox restore < slatebox-backup.gz`,
into the same container or a new one. The restore verifies the file, pauses
the app and relay (the supervisor handles SIGUSR1 and SIGUSR2 for this; the
proxy shows the starting page meanwhile), saves the current database, replaces
it, starts the app and relay again and waits for the signed readiness check.
If loading fails, the saved database is put back.

## Build

`./build-image.sh <SlateboxJS checkout> <y-websocket checkout>` stages the
committed files of the three repositories and runs one multi-stage
`Dockerfile`:

- `engine`: a fresh SlateboxJS build for every image, versioned
  `<version>+selfhost.<revision>`. The app's manifest and lock normally point
  at a sibling checkout; `build/pin-engine.mjs` points them at that tarball
  and checks the result.
- `meteor-build`: the Meteor bundle. The build stops if a `settings*.json` is
  in the app tree; the script removes them and the context ignores them.
- `server-dependencies`: native modules for the runtime's own base. With
  Meteor 3.6.1, `accounts-password` (3.3.3) bundles bcrypt 6 and Argon2 with
  prebuilt bindings (3.3.0, in Meteor 3.5, still had bcrypt 5); the stage checks that bcrypt 6 is the one that loads and hashes.
  Third-party source maps, editor folders and the sample keys in packages'
  test suites are left out (about 130 MB).
- `relay`, `fonts`: production dependencies of the relay; the Google Fonts
  families the server uses to render slate images, and the interface fonts
  (Manrope, Readex Pro) with a stylesheet that points at the instance.
- `mongodb-notices`: MongoDB's lists of the third-party libraries in the server
  and the database tools, fetched at the released versions and pinned by
  checksum (the official `mongo` image leaves its documentation out).
- `runtime`: Ubuntu 24.04 (the platform MongoDB 8.0 publishes builds for),
  Node 26.13.1, `mongod`, `mongodump` and `mongorestore` from the official
  `mongo` image, Caddy from the official `caddy` image, tini.

The result is about 585 MB to download and 1.6 GB on disk, of which Keycloak
is 0.19 GB and its Java runtime 0.17 GB (225 MB of the download), the
app's server bundle is 0.94 GB (it carries every npm dependency of the app,
as the hosted image does) and MongoDB 0.25 GB.

Labels and `/opt/slatebox/identity.json` carry the app, engine and relay
revisions. The base is glibc because MongoDB publishes no musl build; that
is also why this file does not reuse the Alpine stages of `web/Dockerfile`.

License notices are in `/opt/slatebox/licenses`. The image is not MIT as a
whole: MongoDB Community Server is SSPL-1.0.

## Left for later

- Publishing to GHCR, with `org.opencontainers.image.source` set to the
  public repository. Both platforms are built and tested: linux/arm64
  natively and linux/amd64 under emulation, with the same suite.
  `TARGET_PLATFORM=linux/amd64,linux/arm64 ./build-image.sh …` makes one
  tag that holds both; publishing pushes that tag (or each platform is built
  on its own runner and the two are joined with `docker buildx imagetools
  create`).
- MongoDB major upgrades (8.0 to a later series) need a
  feature-compatibility step; the image pins 8.0.
- Further plan-gated features: with no plans, some features still check for a
  paid plan in the app (image search in the note drawer, team creation, AI
  settings). On a self-hosted instance these need either the plan check
  lifted for `public.env = selfhost` or the feature hidden; that is an app
  change outside this directory.

## Single sign-on: Keycloak in the same image

`SLATEBOX_SSO=keycloak` turns on single sign-on. Off, nothing below runs: no
Java process, no Keycloak secret, nothing under `/data/keycloak`, and the
sign-in page has no SSO button. The image still carries Keycloak 26.8.2 and the
Eclipse Temurin 21 runtime that runs it (about 357 MB unpacked, 224 MB more to
download); every installation gets the same image.

**Process and port.** Keycloak is one more supervised service (`sso`), started
with `kc.sh start --optimized` beside the app. Its build options are fixed in
the image (`kc.sh build`): the H2 file database, served under `/auth`, health
endpoints, and the SCIM API. At run time it listens on loopback only
(`KC_HTTP_HOST=127.0.0.1`, `KC_CACHE=local`, so no cluster port, and H2's
auto-server port is bound to loopback). Caddy sends `/auth` and `/auth/*` to it
unchanged, so the one published port serves Keycloak too. `KC_HOSTNAME` is the
public address plus `/auth`; `KC_HOSTNAME_BACKCHANNEL_DYNAMIC` lets the app
reach the token endpoint on loopback while tokens name the public issuer.
Keycloak gets a 256 MB heap and the serial collector; idle, its Java process
holds about 0.5 GB resident (the whole container: 946 MiB with single sign-on
on, 497 MiB off). When Keycloak stops by itself, the container stops,
like any other service; on `docker stop` it is given the same time as MongoDB
to close its database.

**First start.** `configure.mjs` creates the single sign-on secrets
(`keycloakAdminPassword`, `keycloakInitSecret`, `keycloakDbPassword`,
`ssoClientSecret`, `ssoStateKey`, `scimClientSecret`) in `secrets.json`, and
renders `/run/slatebox/keycloak.env`. Keycloak creates its master realm with
the temporary administrator `admin` and the service client `slatebox-init`
(`KC_BOOTSTRAP_ADMIN_*`, honoured only when the master realm is created).
`keycloak-init.mjs` (service `sso-setup`) waits for readiness, then, through
`slatebox-init`, creates the `slatebox` realm once (events stored 90 days,
admin events, SCIM on, registration off, brute-force protection), and at every
start rewrites the app's client (`slatebox`: confidential, code flow with PKCE
S256 only, redirect `<address>/sso/callback`) and the SCIM client (`scim`:
client credentials, `manage-users`, an audience mapper for the SCIM endpoint at
the current address, so a new `SLATEBOX_URL` or a restore at another address
keeps SCIM working). It also keeps the first-login flow `link by trusted email`
in the realm (review profile if fields are missing, then create the user or
link the existing one with that address), which operators choose per provider
with Trust Email on and sync mode Force (which marks the linked user's address
verified), so people provisioned ahead over SCIM or LDAP can sign in through
the company provider; and it keeps brute-force protection, sign-in
events and admin events on in the master realm, whose sign-in the admin console
uses. The log carries a one-time hint naming the admin console and the
command that shows the password, never the password. Keycloak's own log is
limited to warnings and its event logger is off, because event lines carry user
names; events are stored in the realm instead.

**The app.** The app's settings gain `sso` (issuer, endpoints, client secret,
state key; server only) and `public.sso` (`enabled`, `only`). The app signs in
with OpenID Connect (authorization code, PKCE S256, state and nonce in an
HMAC-sealed, HttpOnly, SameSite=Lax cookie on `/sso`), exchanges the code on
loopback, checks the ID token's signature (Keycloak's keys, read on loopback),
issuer, audience, expiry and nonce (openid-client), and hands
the browser a one-time ticket in a URL fragment, which the `sso` login handler
trades for a Meteor session. The ticket is bound to the tab that started the
sign-in: the tab keeps a random verifier in sessionStorage and sends it to
`/sso/start`, its hash is sealed into the state, and the ticket (kept in Mongo,
`ssoTickets`, by its hash) is redeemed only
with the verifier (no login CSRF with someone else's ticket). Accounts: the one
linked to the Keycloak subject; else the account with the same email, when the
provider verified it and Slatebox verified it too (or the account has no
password, session or API token yet, such as an invitation), which is linked;
else a new one. A new account joins the first team (the one the setup link's
first admin made, recorded at setup) as a Member, with no people claims; an
account in no team that signs in or is linked joins it too; anyone already in a
team, invitations included, keeps that team and every role in it, so the first
admin and team owners are never changed. `SLATEBOX_SSO_DEFAULT_ROLE=none` keeps
the invite-first behavior instead: an account from SSO joins a team only by
invitation. With `SLATEBOX_SSO_DOMAINS`, an identity whose address is outside
those domains is refused (no account, no link, no sign-in). Linking removes the password and ends the account's sessions,
API tokens and sign-in links. Links are kept under the provider name
`bundled-keycloak`, so a new `SLATEBOX_URL` keeps them. It asks for
`offline_access` and keeps the refresh token in `services.sso`; every 60
seconds (checked every 30) it refreshes it for each SSO account, with a session
or not, at most 500 accounts per pass (oldest check first). Each pass is
recorded as counts only (`systemSettings` `ssoSessionCheck`): `slatebox sso
sessions` and the installer's `slatebox status` show it, and warn when, in the
last 24 hours, more accounts were due than one pass checks, or when the check
has stopped. The refresh token is never in a publication. A refused refresh (`invalid_grant`: user disabled, deleted, deactivated
over SCIM, offline session revoked) removes all of that user's Meteor sessions,
revokes their API tokens and sign-in links, and marks the account revoked until
its next SSO sign-in; API tokens of revoked, disabled or deleted accounts are
refused; an outage changes nothing. An account linked to SSO never signs in
with a password. The browser notices the refused resume and reloads signed
out. `SLATEBOX_SSO_ONLY=true` adds: password sign-in, sign-up, reset and change
refused in `validateLoginAttempt`, and guest sessions too; no guest and no
self-made account in `validateNewUser`; the password, reset, guest and
sign-in-link methods closed; every other method and publication refused to a
connection without a session (except signing in and loading code), and the
public presentation feed and embeds answer 404; every page but `/login` and
`/sso/*` sends a visitor without an account to `/login`.

**Storage.** Keycloak supports PostgreSQL, MySQL, MariaDB, SQL Server and
Oracle in production, all separate servers; it cannot embed one, and H2
(`dev-file`) is supported for development only. Bundling PostgreSQL would add a
second database server to the image and to every backup and upgrade for a
feature most installations leave off. Slatebox uses H2 instead: one file under
`/data/keycloak`, opened with its own generated password. Keycloak applies its
schema migrations to it at start like to any database. The risk is the H2
engine's own file format, which changed once (Keycloak 17); every backup
therefore carries a portable H2 backup. `slatebox backup` makes an online
H2 `BACKUP TO` through H2's auto-server (loopback), stores it with the single
sign-on secrets in the GridFS bucket `selfhost_keycloak` for the length of the
dump, and removes it again. `slatebox restore` pauses Keycloak with the app,
restores H2 from the archive (keeping the old files until it succeeds), takes
over those secrets, renders the settings again and starts everything.

**Provisioning and audit.** Just-in-time accounts at first sign-in, Keycloak's
LDAP and Active Directory sync, and Keycloak's built-in SCIM 2.0 API (supported
since 26.8, Apache-2.0) provisioning Keycloak. Slatebox accounts are still made
at first sign-in; SCIM groups do not become Slatebox teams. Audit: Keycloak's
stored login and admin events (`slatebox sso events [N]`, or the admin
console); Slatebox logs only account ids when SSO creates, links or signs out
an account. There is no Slatebox audit log of slate activity.

