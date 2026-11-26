# Run your own Slatebox

One container is a complete Slatebox: the app, live collaboration, and the
database. Install Docker, run one command, open one address.

```sh
docker run -d --name slatebox -p 7070:7070 -v slatebox-data:/data ghcr.io/slatebox/slatebox
```

`latest` is version 0.2.2 (`ghcr.io/slatebox/slatebox:0.2.2`, index
`sha256:8a64b09e8e6d53a0fb2b76b60048474eba52a010ddd7f7b834ea898a003e4ec5`), for
linux/amd64 and linux/arm64. It needs no registry login.

A start usually takes well under a minute; `docker ps` shows the container as
`healthy` once a slate can be opened. Then make the one-time setup link:

```sh
docker exec slatebox slatebox setup-link
```

Nobody can sign up until the first admin exists. Open the link it prints to
create that account: the server administrator and the owner of the first team.
The link works once and expires in 24 hours; running the command again prints a
new one and ends the last. Until then <http://localhost:7070> says "This
Slatebox isn't set up yet". After that, people sign up and are invited as usual.
With `SLATEBOX_SSO=keycloak`, the link's page also offers single sign-on: the
first account to sign in through it becomes the administrator. After that,
everyone your identity provider lets in joins that first team as a member,
unless they were invited to a team (`SLATEBOX_SSO_DEFAULT_ROLE=none` makes
joining by invitation only).

Everything Slatebox stores is in the `slatebox-data` volume: your slates and
accounts, and the secrets generated for this installation on its first start.
There is nothing to configure and nothing to keep beside the volume.

The operator guide covers a public address and HTTPS, mail, AI drafts,
upgrades, backup and restore, and troubleshooting:
<https://docs.slatebox.com/installation/install-with-docker/>

## What you need

Docker, on a 64-bit Intel or AMD processor with AVX (Sandy Bridge or
Bulldozer, 2011, or newer) or a 64-bit ARM processor with ARMv8.2-A (Apple
silicon, Graviton 2 or later, Raspberry Pi 5; not a Raspberry Pi 4). Those
are MongoDB 8.0's requirements; on an older processor the container stops
and its log says so. Slatebox uses about half a gigabyte of memory with a
few people at work; allow 1 GB, and 2 GB for a team.

## The same thing, with the settings most servers want

```sh
docker run -d --name slatebox --restart unless-stopped \
  -p 80:80 -p 443:443 \
  -e SLATEBOX_URL=https://boards.example.com \
  -v slatebox-data:/data ghcr.io/slatebox/slatebox
```

With an `https://` address, Slatebox obtains and renews its own certificate.
Point the DNS name at the host and let ports 80 and 443 through first.

## Settings

Every setting is optional and is given with `-e NAME=value`.

| Setting | What it does |
| --- | --- |
| `SLATEBOX_URL` | The address people type to reach this Slatebox. Default `http://localhost:7070`. Set it whenever the address is anything else, including another port. |
| `SLATEBOX_HTTPS` | `off` when your own proxy terminates HTTPS and forwards to port 7070. Otherwise an `https://` address turns on built-in HTTPS on ports 80 and 443. |
| `SLATEBOX_ACME_CA` | The ACME directory of your own certificate authority, when certificates should not come from Let's Encrypt. |
| `SLATEBOX_MAIL_URL` | An `smtp://` or `smtps://` URL, with the user name and password of your mail account. Turns on invitations, email verification and password mail. |
| `SLATEBOX_MAIL_FROM` | The sender of that mail, for example `Slatebox <boards@example.com>`: an address your mail service accepts. Needed unless the mail account's user name is itself an address, which is then used. |
| `SLATEBOX_AI_URL`, `SLATEBOX_AI_MODEL` | Any OpenAI-compatible endpoint and the model it serves, used for every AI feature: Ollama, llama.cpp, vLLM, LM Studio or a host provider. `SLATEBOX_AI_KEY` is then its bearer token, if it needs one. See [AI](#ai). |
| `SLATEBOX_AI_KEY` | Without `SLATEBOX_AI_URL`: a DeepInfra API key for the built-in AI. |
| `SLATEBOX_AI_CONFIG` | Any mix of AI, as JSON: several connections and which one each feature uses. See [AI](#ai). |
| `SLATEBOX_AI_OWN_PROVIDERS` | `off` keeps everyone on the AI set here. Default `on`: people and teams may connect their own models and keys in Profile, AI. |
| `SLATEBOX_AI_PRIVATE_ENDPOINTS` | `off` lets people and teams connect only models at public addresses, so they cannot use the server to reach other machines on your network. Default `on`: they may use your LAN or `host.docker.internal`. Your own connections are not affected. |
| `SLATEBOX_KEY_ENCRYPTION_KEY` | 32 random bytes in base64, made once with `openssl rand -base64 32`. Every AI and call key saved on this server (an administrator's in Admin, AI control, and people's and teams' own) is encrypted with it. Unset, the first start makes one and keeps it in the data volume (`/data/secrets/key-encryption.key`), and every later start reads it back; it is never replaced. Either way, keep the same key for the life of the server and store it with your backups, which do not contain it: with a different key, saved keys cannot be read and are added again. It is never written to the log. |
| `SLATEBOX_SETTINGS` | A JSON object of further app settings, for example `{"daily":{"apiKey":"…"}}` to turn on calls, or `{"enterprise":{"license":"sblic1.…"}}` for an on-prem license (below). |
| `SLATEBOX_LICENSE`, `SLATEBOX_LICENSE_FILE` | An on-prem license key for the enterprise features (below): the key itself, or the path inside the container of a file that holds it. Give one of them, or the license in `SLATEBOX_SETTINGS`, not both. The key is never written to the log. |
| `SLATEBOX_UPDATES` | `auto` (default): Admin › Updates decides whether releases are applied by themselves. `notify`: admins are told about releases, nothing is applied by itself. `off`: no update request ever leaves this server. See [Updates](#updates). |
| `SLATEBOX_UPDATE_FEED` | Another update feed (a mirror): the address of its `update-feed/channels.json`. What it serves must still be signed by Slatebox. |
| `MONGO_URL`, `MONGO_OPLOG_URL` | Use a MongoDB you run elsewhere. The bundled database is then not started. |
| `SLATEBOX_SSO` | `keycloak` turns on single sign-on with the Keycloak bundled in the image (off by default). People sign in with Entra ID, Okta, Google Workspace, SAML, OpenID Connect or LDAP through it. Keycloak's admin console is at `/auth/admin/` on the same address. |
| `SLATEBOX_SSO_ONLY` | `true`, with `SLATEBOX_SSO=keycloak`: single sign-on is the only way in, no passwords and no guests. |
| `SLATEBOX_SSO_ADMIN` | `closed`, with `SLATEBOX_SSO=keycloak`: Keycloak's admin console and master realm are not served on the published port (default `open`). |
| `SLATEBOX_SSO_DEFAULT_ROLE` | With `SLATEBOX_SSO=keycloak`: `member` (default), everyone single sign-on lets in joins the first team as a member; `none`, people join a team only when a team admin invites them. Invited people always join the team that invited them. |
| `SLATEBOX_SSO_DOMAINS` | With `SLATEBOX_SSO=keycloak`: comma-separated email domains, for example `example.com,example.org`. Single sign-on refuses any address outside them. |
| `SLATEBOX_TUNNEL_TOKEN` | A Cloudflare Tunnel connector token. The container's cloudflared connects out to Cloudflare with it, which ends HTTPS for the `https://` `SLATEBOX_URL`: no ports to open, no certificates. `npx slatebox install --team-address <name>` gets one for `https://<name>.slatebox.team`; a tunnel in your own Cloudflare account works the same way. Built-in HTTPS is off with it. The token is passed to cloudflared in a private file, never to the app, and never written to the log. |

A misspelled setting, or one in lower case, stops the container with the list
of valid names, so a setting is never silently ignored.

## AI

Slatebox bundles no model. It uses whatever you connect, and you can mix them:
a model on this computer or your network, a host provider, or a cloud provider
with your key. People may add their own too (Profile, AI), unless
`SLATEBOX_AI_OWN_PROVIDERS=off`. Their choice for a feature wins over yours.

One endpoint for everything:

```sh
docker run ... -e SLATEBOX_AI_URL=http://host.docker.internal:11434/v1 -e SLATEBOX_AI_MODEL=<model> ...
```

Inside the container, `localhost` is the container itself. A model server on
the Docker host is at `host.docker.internal`. Docker Desktop provides that
name; on Linux, add `--add-host=host.docker.internal:host-gateway`. On a Mac,
run the model server on the Mac itself, so it can use the Mac's GPU. Docker on
a Mac cannot.

A mix: a model on the host for conversation and drafts, and a cloud provider for
reading and making images:

```sh
-e SLATEBOX_AI_CONFIG='{
  "connections": {
    "desk":  { "type": "openai-compatible", "url": "http://host.docker.internal:11434/v1", "model": "<model>" },
    "cloud": { "type": "openai", "key": "<key>", "model": "<model>", "vision": true, "images": true }
  },
  "use": { "default": "desk", "vision": "cloud", "images": "cloud" }
}'
```

- **type:** `openai-compatible` (any host, with `url`), `openai`, `anthropic` or `deepinfra`.
- **use:** keys are `default`, `chat`, `generation`, `presentation`, `vision` and `images`. A value is a connection name, or `builtin` for the built-in AI (`SLATEBOX_AI_KEY`).
- **What a model can do:** `tools`, `vision` and `images` (`true` or `false`) say what it can do, where you know. An unset capability is tried. Making images needs `"images": true`.
- **Output length:** `maxTokens` caps each answer. The default is 16384.

The installer (`npx slatebox`) writes the same thing as a list, with each key in
a variable of its own, so keys stay in its secrets file:

```sh
-e SLATEBOX_AI_PROVIDERS='[
  { "id": "desk",  "kind": "openai-compatible", "baseUrl": "http://host.docker.internal:11434/v1", "model": "<model>" },
  { "id": "cloud", "kind": "openai-compatible", "baseUrl": "https://api.openai.com/v1", "model": "<model>", "keyEnv": "SLATEBOX_AI_KEY_CLOUD" }
]' -e SLATEBOX_AI_DEFAULT=desk -e SLATEBOX_AI_KEY_CLOUD
```

`SLATEBOX_AI_DEFAULT` names the provider every feature uses; with one provider
it is that one.

If a model can't do what a feature needs, the feature says so and asks for
another model. Slatebox never sends the request somewhere else instead. Keys go
only to the app's settings, never to the log. Slatebox never sends AI requests
to cloud metadata addresses. Requests may go to your network.

`docker exec slatebox slatebox ai check` tests each connection set here. It
reports whether the endpoint answers and accepts the key, whether it lists the
model, and whether the model calls tools. People test their own connections in
Profile, AI. An agent can set and test all of this through the API (`ai`,
`ai-set`, `ai-check`) with a token that has the `ai:settings` permission.

Your provider bills the account that issued its key; Slatebox charges nothing on
your own server. Slatebox Pro exists only on Slatebox Cloud.

## Enterprise features (Upgrade on prem)

The image includes Slatebox's enterprise features (inviting outside agents such
as GitHub, Linear or Hugging Face onto a slate, and the connectors behind them),
locked. An on-prem license from Slatebox unlocks them on one install, without
moving to Slatebox Cloud. Single sign-on with the bundled Keycloak needs no
license and is never locked.

The quickest way is the **Upgrade** button in the app's header, which this
server's administrator sees (other people see a quiet **Enterprise** link with
the same reasons, and are asked to talk to their admin). It offers two choices,
each one click:

- **Unlock enterprise, stay on your servers.** *Start free trial* signs this
  server in to Slatebox Cloud once (approve a code in any browser, your phone
  included) and gets a trial key bound to this server's address. The features
  turn on at once, with no restart, and the page opens **Integrations**. After
  that the key is checked offline. *I have a license key* takes a key you got
  from Slatebox and turns the features on the same way.

  The trial is offered only when Slatebox Cloud says it issues them, for as many
  days as Cloud says. It needs this server's public address (a name like
  `slatebox.example.com`, not `localhost` or a bare intranet name), reachable
  from the internet over https: Cloud checks the address really is this server
  by fetching a one-time proof from
  `https://<your address>/.well-known/slatebox-license-proof/…`. Each address
  gets one trial, which ends on its last day (a bought license keeps 14 days of
  grace). This server also needs outbound https to `app.slatebox.com`. If either
  is not possible, a license key works on any install, offline. When a trial or
  license ends, the button reads **Renew** and the panel says when it ended.
- **Move your team to Slatebox Cloud.** Signs in to Slatebox Cloud for an hour,
  sends your team's slates, people, team settings, brand kit and files there
  server to server, compares what arrived with what was sent, and makes it live
  when you say so. This server keeps its copy; you can show everyone here a
  banner pointing to Slatebox Cloud.

Keys entered this way are kept in this server's database. A key given in the
container's settings or environment (below) always wins. To ask Slatebox about a
license, use **Admin tools → Upgrade on prem** or
[contact Slatebox](https://slatebox.com/contact/).

Give the key you receive with `-e SLATEBOX_LICENSE=sblic1.…`, or keep it in a file
and mount it (`-v /path/slatebox.license:/run/secrets/slatebox.license:ro -e
SLATEBOX_LICENSE_FILE=/run/secrets/slatebox.license`), and start the container
again. `SLATEBOX_SETTINGS='{"enterprise":{"license":"sblic1.…"}}'` works too. The log says `[enterprise] licensed to …` and
**Admin tools** shows the license and its end date. The key is checked inside
the app, offline: nothing is sent to Slatebox. A key names its install's host
name and works only at that address (`SLATEBOX_URL`). Without a valid key the
features stay locked and the rest of Slatebox works as before.

## Everyday commands

```sh
docker logs slatebox                                           # what is happening
docker exec slatebox slatebox backup > slatebox-backup.gz      # back up while running
docker exec -i slatebox slatebox restore < slatebox-backup.gz  # restore a backup
docker exec slatebox slatebox setup-link                       # before the first admin exists: the one-time setup link
docker exec slatebox slatebox password-link person@example.com # a one-time link to set a new password
docker exec slatebox slatebox sso                              # with SLATEBOX_SSO=keycloak: admin console, issuer, SCIM
docker exec slatebox slatebox sso admin-password               # Keycloak's first admin password (never in the log)
docker exec slatebox slatebox sso events 50                    # recent sign-in events
docker exec slatebox slatebox sso sessions                     # the last session check (at most 500 accounts per pass)
docker exec slatebox slatebox ai check                         # test the AI connections set here
```

Single sign-on is described in <https://docs.slatebox.com/installation/single-sign-on/>.

Without mail, `password-link` is how someone who forgot their password gets
back in: give them the link it prints. It works once and expires in three days.

To keep the data in a folder on a Linux host instead of a volume, run the
container as the folder's owner, for example after `mkdir -p ~/slatebox-data`:
`--user "$(id -u):$(id -g)" -v ~/slatebox-data:/data`. If the container cannot
write to `/data`, its log names the owner to use.

To upgrade, pull the newer image, remove the container and run your `docker
run` command again. The volume keeps your data:

```sh
docker pull ghcr.io/slatebox/slatebox
docker rm -f slatebox
docker run -d --name slatebox -p 7070:7070 -v slatebox-data:/data ghcr.io/slatebox/slatebox
```

## Updates

Slatebox checks GitHub for new releases every 6 hours and shows them to server
admins in **Admin › Updates**: the release notes, a "Signature verified" mark,
and an **Update now** button. There an admin also chooses whether updates are
applied by themselves, on which days and at what time (in their own time zone),
how many days to wait after a release, and the stable or preview channel. Major
releases always need an admin's approval first.

The update itself is done by a small host updater, not by Slatebox: `npx
slatebox install` sets it up. Every five minutes it asks the container what to
do. When there is an update, it checks the release's signature itself, takes a
backup, starts the new version and checks its health; if the new version is not
healthy, the previous one and its data are put back. Only a release signed by
Slatebox, pulled by its digest, is ever installed. If the server restarts in the
middle of an update, the next run puts the previous version back by itself.

An install from before automatic updates (an image older than 2.1.0) gets them
in two steps, on the computer that installed it:

```sh
npx slatebox@latest upgrade          # to an image with automatic updates; this sets up the host updater too
npx slatebox updates auto on         # or turn on "Apply updates automatically" in Admin › Updates
```

The second step is needed because a server that already had data before it
gained the updater only tells admins about releases until someone turns
applying on. `npx slatebox updates enable` puts the host updater back after
`npx slatebox updates disable`; it needs an image from 2.1.0 on.

The host updater needs Docker Engine (rootful or rootless) on the same computer:
on Podman, or a Docker reached over TCP or SSH, `updates enable` says so and you
update with `npx slatebox upgrade`.

```sh
npx slatebox updates                 # the version, what is available, what happens next
npx slatebox updates apply           # update now
npx slatebox updates auto off        # tell me about releases, never apply them by themselves
npx slatebox updates disable         # remove the host updater
docker exec slatebox slatebox updates status
```

`SLATEBOX_UPDATES=notify` never applies updates by itself; `SLATEBOX_UPDATES=off`
makes no update request at all (for a server without internet access, keep
using `slatebox upgrade --image-archive`). On Kubernetes there is no host
updater: Admin › Updates shows the exact upgrade command for each release
(`npx slatebox upgrade --name <install> --to <image>@sha256:...`). Each image is signed with cosign:

```sh
cosign verify ghcr.io/slatebox/slatebox:<version> \
  --certificate-identity-regexp 'https://github.com/Slatebox/slatebox/.github/workflows/selfhost-image.yml@refs/tags/v.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Build the image from source

You need Git, Docker, and checkouts of three repositories: this one,
SlateboxJS, and the Slatebox collaboration relay
(<https://github.com/Slatebox/y-websocket>).

```sh
./build-image.sh /path/to/slateboxjs /path/to/y-websocket
```

The script builds from committed files only and prints the image name and the
command to run it. The image is labelled with the three source revisions. It
targets the Docker host's own architecture; set `TARGET_PLATFORM=linux/amd64`
or `linux/arm64` to choose, or `TARGET_PLATFORM=linux/amd64,linux/arm64` for
one tag that holds both (this needs Docker's containerd image store; the
platform that is not the host's is built under emulation and takes much
longer). The Meteor build needs about 4 GB of memory.

## Test an image

The tests start real containers on ports 17000 to 17999 and remove everything
they create. They need Node 22 or newer, Docker, Chrome, and a checkout that
has `@playwright/test` installed (SlateboxJS does). Run them from this
directory:

```sh
SLATEBOX_IMAGE=<image name> PLAYWRIGHT_FROM=/path/to/slateboxjs/package.json \
  node --test --test-concurrency=1 tests/
```

`tests/configure.test.mjs` runs only this checkout's start-up step inside the
image, in seconds, so a change to the settings can be checked without
rebuilding the image.

They cover the image's contents (identity, licenses, no settings or keys),
the first start, restart, stop, a crashed process, upgrade, backup and
restore, every setting, two browsers editing one slate, and a log that
carries none of what people wrote. Outside services
are replaced by local stand-ins: a mail sink, an OpenAI-compatible endpoint,
a second MongoDB, a proxy in front, and Let's Encrypt's Pebble test server
as the certificate authority. To also search the image for the values in
settings files kept outside this checkout, list their folders in
`SLATEBOX_SETTINGS_DIRS`, separated by colons.

## What is inside, and its licenses

The Slatebox app, the SlateboxJS engine and the collaboration relay are MIT
licensed. The image also contains third-party programs under their own
licenses, most notably MongoDB Community Server under the Server Side Public
License (SSPL), which is not an MIT-style license. The image as a whole is
therefore not MIT. The full list and every license text are in the image:

```sh
docker run --rm --entrypoint cat ghcr.io/slatebox/slatebox /opt/slatebox/licenses/NOTICE.md
```

[DESIGN.md](DESIGN.md) explains how the container is put together.
