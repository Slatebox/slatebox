# Host a Slatebox instance

Run the Meteor web app, its authenticated collaboration relay, and a single-member MongoDB replica set with persistent storage on your own Docker host. The setup creates fresh installation secrets. Each browser talks to the app and to the collaboration relay at the origins you configure.

## Start the stack

Install Docker Engine and Docker Compose v2 or newer. The initializer uses Node bundled in the app image. Run these commands from this directory on the Docker host. With Docker Desktop or Colima, keep this checkout and the instance state in a folder shared with the Docker VM so it can mount the configuration files. Slatebox supplies matched Linux ARM64 and AMD64 release kits on request. Give the release contact your Docker server architecture and ask for the exact release tag and archive SHA-256 checksum. The kit includes the app, collaboration relay, MongoDB, optional Caddy proxy and startup files. Verify and load the archive before starting the services. [Install a supplied release kit](https://docs.slatebox.com/installation/install-with-docker/#start-from-a-release-kit)

For a first evaluation on a remote VM, use the two-port SSH tunnel to reach the app and relay while keeping both ports on loopback. [Try a remote host over SSH](https://docs.slatebox.com/installation/install-with-docker/#try-a-remote-host-over-ssh)

The commands below use a separately supplied image pair or a local build. Current release kits are distributed directly. Anonymous registry downloads of the current release are pending.

```sh
APP_IMAGE=registry.example.com/slatebox/app:release \
  COLLAB_IMAGE=registry.example.com/slatebox/relay:release ./run init
./run up -d
./run ps
curl --fail http://localhost:7070/readyz
```

Replace the two image references with the supplied release tags or your local build tags. Sign in to your registry first if it requires authentication. The browser entry is http://localhost:7070/start and the relay listens on ws://localhost:7071. Both ports bind to loopback. MongoDB is reachable only inside the Compose network.

To run multiple instances, use a distinct COMPOSE_PROJECT_NAME, SLATEBOX_STATE directory, APP_PORT and COLLAB_PORT for each one. Keep the project name and state path the same for later commands. `./run stop` stops the containers. `./run up -d` starts them again. `./run down` recreates containers on the next start and preserves the Mongo data volume. Removing the volume deletes the instance data.

## Use your enterprise hostnames

On a fresh Docker host, point two DNS names to the machine, allow inbound TCP ports 80 and 443, and initialize with managed HTTPS. Caddy obtains and renews the certificates, and forwards WebSocket connections to both the app and the relay.

```sh
ROOT_URL=https://boards.example.com WS_URL=wss://live.example.com \
  APP_IMAGE=registry.example.com/slatebox/app:release \
  COLLAB_IMAGE=registry.example.com/slatebox/relay:release ./run init --https
./run up -d --wait
curl --fail https://boards.example.com/readyz
```

Open `https://boards.example.com/start`. Keep the Compose project name and its `caddy-data` volume across updates. That volume holds certificate private keys and renewal state. A new host with a fresh volume needs to obtain new certificates from the issuer. For an existing reverse proxy, omit `--https` and forward the two origins to the app and relay loopback ports, including WebSocket upgrades.

The init command creates `.state/instance.env` and `.state/settings.json` with private file permissions. Protect these files and your Mongo volume in backups. Running init against an existing directory stops before changing credentials. For an update, change the two image tags in `instance.env`, make a database backup, and run `./run up -d`. The Mongo initialization service also runs on restart and reuses the original database users.

### Keep a pilot’s boards when you add team hostnames

Have guest owners save their accounts before changing the address. Browser guest sessions belong to the original origin. Back up the installation, point the two DNS names at this Docker host, and allow the proxy to accept HTTP and HTTPS. From the running pilot’s `self-host/` directory, keep its existing Compose project name. Generate a separate settings directory, then use it to start the HTTPS proxy.

```sh
ROOT_URL=https://boards.example.com WS_URL=wss://live.example.com ./run promote .team-state
export SLATEBOX_STATE=.team-state
./run up -d --wait
```

Continue using this state directory and the same Compose project for later commands. The app and relay keep their credentials and Mongo volume. Sign in at the new app hostname and reopen the saved board path. Give collaborators links with the new hostname. [Operator guide](https://docs.slatebox.com/installation/install-with-docker/#keep-the-boards-from-your-pilot)

## Build from the three source checkouts

Use the Slatebox app, SlateboxJS engine and Slatebox collaboration relay repositories. The relay is the Slatebox fork of y-websocket. Use a compatible set of commits supplied by your release contact. With this app checkout open in the self-host directory, run:

```sh
./build-images.sh /path/to/slateboxjs-v2 /path/to/y-websocket
```

The script stages committed source in a temporary directory, builds and packs the engine, and checks the app lock points at that exact local build. It then produces Docker images tagged with the source revisions and prints the two image names to use with init. Source builds need Git, npm, Node.js, Docker, internet access for dependencies, and sufficient memory for the Meteor builder.

By default the script targets the Docker daemon’s native Linux architecture. To select one explicitly, run:

```sh
TARGET_PLATFORM=linux/amd64 ./build-images.sh /path/to/slateboxjs-v2 /path/to/y-websocket
TARGET_PLATFORM=linux/arm64 ./build-images.sh /path/to/slateboxjs-v2 /path/to/y-websocket
```

Build each architecture on a matching Docker host or a builder with emulation for the target. The script loads individual images into the local Docker daemon, checks their architecture and adds an `-amd64` or `-arm64` suffix to each tag. Use the matching pair for your deployment.

## Promote a matched two-architecture release

Release maintainers need Python 3 and [crane](https://github.com/google/go-containerregistry/tree/main/cmd/crane) (tested with v0.20.6). Check out the release’s app, engine and relay commits before building both architectures. Keep the three 12-character revision labels from the build. Use one stable version tag for the app and relay, for example `v1.3.21`.

On each builder, set `ARCH` to `amd64` or `arm64` and set `VERSION`, `APP_REV`, `ENGINE_REV` and `RELAY_REV` to your release values. An authorized registry maintainer can upload the versioned candidates using these commands:

```sh
namespace=ghcr.io/slatebox
docker tag "slatebox-app:selfhost-$APP_REV-$ENGINE_REV-$ARCH" "$namespace/slatebox:$VERSION-$ARCH"
docker tag "slatebox-collab:selfhost-$RELAY_REV-$ARCH" "$namespace/relay:$VERSION-$ARCH"
docker push --platform "linux/$ARCH" "$namespace/slatebox:$VERSION-$ARCH"
docker push --platform "linux/$ARCH" "$namespace/relay:$VERSION-$ARCH"
```

Run the following in the extracted app source’s `self-host/` directory. Coordinate a single maintainer for each version and for changes to `latest`. The first command is read-only. It resolves each architecture tag to a digest and verifies its OS, architecture and source revision labels. The second creates both version indexes. It refuses to replace a version that already names different contents.

```sh
./release-images.py check "$VERSION" "$APP_REV" "$ENGINE_REV" "$RELAY_REV"
./release-images.py assemble "$VERSION" "$APP_REV" "$ENGINE_REV" "$RELAY_REV"
```

Keep the two printed index digests with the release. Use the immutable references for deployment and test the install before promotion. To make that same pair the stable default:

```sh
./release-images.py promote "$VERSION" "$APP_REV" "$ENGINE_REV" "$RELAY_REV"
```

The registry updates the two `latest` tags separately. If promotion stops after one update, rerun it with the same version and revisions, and announce the release only after both comparisons pass. For a mirror or a local rehearsal, supply `--namespace REGISTRY/NAMESPACE` to all three commands. Public distribution also requires a maintainer to authorize publication and enable anonymous pulls for both packages. Verify each digest from a signed-out registry client before sharing install instructions.

## Connect optional services

- **Email** — Set `mailGun.server` in `.state/settings.json` to your SMTP URL for login links, invitations, verification, and password resets.
- **Calls** — Add `daily.apiKey` to the server-only `.state/settings.json` using your organization’s Daily credential. Turn on audio or video huddles in the slate settings. Daily hosts the media rooms and handles network traversal. The bundled WebSocket service carries board changes. For browser microphone and camera access, serve the app over HTTPS or use localhost for development.
- **Published presentation images** — Configure your own `aws.region`, `aws.accessKey`, `aws.secretKey`, `aws.imageBucket` and `aws.cloudUrl` for the app's S3 image-storage integration. Published images need an HTTPS asset origin reachable by viewers.

### Tell the app how many proxies are in front of it

The API counts a caller without a token (a public slate read, `GET /api/v1/instance`) by its address, and Meteor uses the same address for its own clients. Behind a proxy, every request seems to come from the proxy, so all signed-out callers would share one rate-limit window. Set `HTTP_FORWARDED_COUNT` in `.state/instance.env` to the number of proxies that add an `X-Forwarded-For` entry before the app: `1` behind the bundled Caddy (`--https`) or behind one reverse proxy of your own, `2` behind a load balancer and a proxy. Leave it unset only when nothing sits in front of the app. Too high a number lets a caller choose the address it is counted by; too low counts everyone as the proxy.

Apply settings changes with `./run up -d --force-recreate app`. The app's `public` settings are visible to browsers. Keep credentials in server settings. Configure production access through your organization’s firewall, TLS proxy, and backup process. This Compose installation uses one database member and one relay process.

### Enable AI workshop drafts

A new installation opens editable boards with AI drafting turned off. For the default provider, configure your own DeepInfra account. To run inference on your infrastructure instead, follow **Use your own inference endpoint** below. Drafting sends the user's brief to DeepInfra. Asking for a rule revision also sends the current workshop model. Provider usage is billed to the account that issued your key.

1. Edit the generated `.state/instance.env` and add `API_KEY_DEEP_INFRA='your-provider-key'`. Keep this file private.
2. Edit `.state/settings.json` and change the existing `selfHosted.workshopAI` value from `false` to `true`. Keep the other installation settings in place.
3. From the same release directory, run `./run up -d --no-deps --force-recreate --wait app`. This loads both changes while the database and relay continue running.
4. Sign in with a registered account and open `/new/map`. In the conversation beside the map, ask “Add a step for account owner approval after Start.” Inspect the proposed branch, choose **Keep changes**, then reload the slate and check that the branch is still there. The conversation makes a simple change like this one without AI too, so then ask for something only a model can do, such as “Suggest two steps this map is missing.” If the reply is “I did not follow that”, check the account and workshop AI settings.

Guest users can work with the example board. Drafting with DeepInfra requires a registered account, an available AI allowance and access from the app container to `https://api.deepinfra.com`. To disable drafting again, set `selfHosted.workshopAI` to `false` and recreate the app with the same command.

### Use your own inference endpoint

The Docker stack runs the app, collaboration relay and MongoDB. For workshop drafts and rule revisions, you can connect the app to a model server you operate. The app sends it the brief and, for a revision, the current workshop model. Calls still use the separately configured Daily service.

1. Start a model server that accepts OpenAI-compatible chat completions with function tools. Give it a private address reachable from the **app container**. Inside that container, `localhost` refers to the app itself. Use a service name on a shared Docker network or an internal hostname for a separate inference machine. A separate host lets you budget model memory and GPU time independently of the board and database.
2. In `.state/settings.json`, set `selfHosted.workshopAI` to `true`. Add an `ai` object beside `selfHosted` (outside the browser-visible `public` object) with one named connection and make it the default: `"ai": { "connections": { "local": { "type": "openai-compatible", "baseUrl": "http://inference:8080/v1", "model": "slatebox-local" } }, "use": { "default": "local" } }`. `baseUrl` is the API root, including `/v1` when required, and `model` the exact model name served. If your server requires a bearer credential, add `apiKey` to the connection. This path does not require a DeepInfra key. [Choose your AI](https://docs.slatebox.com/using-slatebox/choose-your-ai/) covers mixing connections per feature.
3. Run `./run up -d --no-deps --force-recreate --wait app`. Open `/new/map` as a registered user and try the **Canvas AI** edit above. The model receives the current map, your request and recent conversation turns. Checking that the proposed branch survives a reload verifies the model's tool call and the saved change. [Self-hosted model setup](https://docs.slatebox.com/installation/install-with-docker/#run-workshop-ai-on-your-own-infrastructure)

A tested configuration used llama.cpp build 9910 with Qwen3-4B-Instruct-2507 in Q4_K_M GGUF format, `--jinja --ctx-size 8192 --alias slatebox-local`, Set `model` to the alias. A registered operator generated a workshop, moved a card on its private slate and presented it. A separate branching map draft retained both requested cue messages. The model weights take about 2.5 GB on disk. Allow extra memory for inference, and test your intended workload. [llama.cpp server setup](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) · [GGUF model files](https://huggingface.co/lmstudio-community/Qwen3-4B-Instruct-2507-GGUF)

The registered-user and usage checks still apply. If your endpoint is unavailable or returns an unusable draft, the request fails on that endpoint. To return to DeepInfra, remove the `ai` object, configure your DeepInfra key as above and recreate the app.

### Connect a hosted provider such as Meta or Google Gemini

Any provider with an OpenAI-compatible chat API is a named connection in `.state/settings.json`, and its key stays in `.state/instance.env`. A new installation's `instance.env` lists `GEMINI_API_KEY` and `META_API_KEY` as blank optional entries. Set the one you use: a key from Meta's Model API dashboard, or from Google AI Studio. For a variable with another name, add it to `instance.env` and to the app's `environment` in `compose.yaml`. The connection's `apiKeyEnv` names the variable. The settings file never holds the key itself, and the app reads the key for each request. If the variable is empty, a request on that connection fails with a configuration error that names the variable. The prompt is never sent to another provider.

```json
"ai": {
  "connections": {
    "meta-muse": { "type": "openai-compatible", "baseUrl": "https://api.meta.ai/v1", "model": "muse-ember-1.0", "apiKeyEnv": "META_API_KEY", "toolChoice": "auto" },
    "gemini": { "type": "openai-compatible", "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "gemini-3.8-flash", "apiKeyEnv": "GEMINI_API_KEY", "toolChoice": "required" }
  },
  "use": { "presentation": "meta-muse", "generation": "gemini", "shape": "meta-muse" }
}
```

`use` chooses a connection per feature: `default`, `chat`, `generation`, `presentation`, `vision`, `images` or `shape` (drawing custom note shapes from a description; it needs tool calls). A feature you do not name keeps the built-in AI. `toolChoice` sets how the endpoint takes a forced tool call. Use `named` (the default for the OpenAI and DeepInfra types) for an endpoint that accepts a function by name. Use `required` for an endpoint that forces a call but has no named form, such as Gemini. Use `auto` for an endpoint that accepts nothing else. Meta's Model API answers HTTP 400 to any other value. With `auto` or `required`, Slatebox checks the answer and asks again when the model calls no tool or the wrong one. `apiKeyEnv` is accepted only in the settings file. People, teams and administrators send the key itself in the app's AI settings.

The meter prices each request by the model's name. An unknown model is priced at the dearest model in Slatebox's table. To price a model the table lacks, or to change a price, add `"metering": { "prices": [{ "model": "muse-ember-1.0", "inPerMillion": 0.3, "outPerMillion": 1.5 }] }` with dollars per million input and output tokens. A wrong entry stops the app at start with a message that names it. Recreate the app after any of these changes with `./run up -d --no-deps --force-recreate --wait app`. The app container must reach the provider's address.

### Move a backed-up instance to another Docker host

Use the [current backup and recovery procedure](https://docs.slatebox.com/installation/install-with-docker/#move-a-backed-up-instance-to-another-docker-host). The backup helper checks the running app, its settings and the actual database volume before taking the instance offline. A routine backup restarts the same services. For a final migration, choose `--leave-stopped` so the source stays at the snapshot until cutover.

On the receiving host, extract a matched release kit and restore the checksum-verified backup into a fresh Compose project. The recovery tool loads the bundled images and preserves the original accounts, boards and invitations. Reopen a private slate as its owner and have a teammate edit it using the existing invitation. [Download the release tools for offline use](https://docs.slatebox.com/assets/self-host/release-tools.tar.gz)
