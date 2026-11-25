# slatebox

Run your own Slatebox with one command, on the machine of your choice:

```sh
npx slatebox install
```

Pick a team address and sign in; Slatebox runs at `https://<name>.slatebox.team`
with no DNS, ports or certificates. Or choose your own domain, or this computer
only. It asks a few short questions (Enter takes the default), shows a plan of
everything it will write, run and create, and installs once you say yes. Then
it prints the address and a one-time setup link: nobody can sign up until the
first admin exists, and the person who opens the link creates that account (the
server administrator and the owner of the first team). The link works once and
expires in 24 hours; `slatebox setup-link` prints a new one at a terminal and
ends the last. `npx slatebox --dry-run` asks the same questions and
prints the plan without changing anything. You need Node.js 22.13 or newer, and
Docker (or Podman with its Docker compatibility on) on whatever runs Slatebox.
Plain `npx slatebox` lists the commands.

### A team address

```sh
npx slatebox install --team-address acme --yes
```

With `--yes` nothing is asked: what you did not give takes its default (this
computer, AI off until you add a model with `slatebox ai add`, no single
sign-on, daily backups, size small). The pinned image is downloaded first
(about 1 GB, once), so nothing is claimed for an image this computer cannot get.
`acme.slatebox.team` is claimed for your Slatebox account when you approve a
short code in your browser (like `gh auth login`). The container then connects
out to Cloudflare through a secure tunnel, which carries HTTPS and live
editing: nothing is opened on your machine or router, and the container starts
again when the machine does. Names are 3 to 32 characters (a-z, 0-9, hyphens).
An account holds up to 3. Your address is public; your slates are not.

The install keeps one credential for the address, on this computer only:
`~/.slatebox/installs/<name>/credentials.json` (mode 0600). It can fetch the
tunnel token again and give the address back, and nothing else.

```sh
slatebox status                 # includes the address and the tunnel's connections
slatebox setup-link             # a new one-time link for the first admin (ends the last one)
slatebox rename acme-boards     # move to https://acme-boards.slatebox.team (sign-in)
slatebox address rotate         # a new tunnel token; any copy of the old one stops working
slatebox address release        # give the address back; Slatebox keeps running on this computer
slatebox uninstall              # also gives the address back, unless --keep-address
```

A released name is held for your account for 30 days. Slatebox Cloud releases
an address that never connected within 24 hours, and one unused for 90 days.
To leave the team address for your own domain, run
`npx slatebox install --domain boards.example.com`.

Slatebox is one container: the app, the live collaboration relay, MongoDB and
Keycloak for single sign-on (off until you turn it on). It is free, and single
sign-on is free.

| Where | How |
| --- | --- |
| This computer | `npx slatebox install` (the default). A team address, your own domain, or `--local` for `http://localhost` on a free port from 7070. Daily backups run from cron on Linux and from a launchd agent on a Mac (no permission prompt; a backup missed while the Mac sleeps runs when it wakes). |
| A Linux server | `npx slatebox install ssh root@203.0.113.5 --team-address acme`, or `--domain boards.example.com`. With a domain, HTTPS certificates are obtained and renewed automatically (point DNS at the server, open ports 80 and 443); without one, `http://<server>:7070`. Docker is installed only if you add `--install-docker`. |
| Kubernetes | `npx slatebox install k8s --route ingress --domain boards.example.com --tls-issuer ClusterIssuer/letsencrypt`. Uses kubectl and your current context (a context whose name looks like production must be named with `--k8s-context`). One StatefulSet with a volume, a Service, an optional Ingress or Gateway API HTTPRoute, a Secret, and a backups sidecar. |
| Files only | `npx slatebox install export --format compose\|manifests\|helm --out ./slatebox-deploy` for GitOps. Nothing is applied. |

## AI is yours to choose

Slatebox is not tied to any AI provider, and the installer never picks one
for you. Answer "none for now", or give any mix: OpenAI, Anthropic, DeepInfra,
OpenRouter, Groq, Together, Mistral, or any OpenAI-compatible endpoint you run
(Ollama, vLLM, LM Studio, a company gateway) with its model.

```sh
npx slatebox install --ai none
npx slatebox install --ai-provider "kind=openai,model=gpt-5-mini,key=env:OPENAI_API_KEY"
npx slatebox install --ai-provider "id=local,kind=ollama,model=qwen3:8b" \
                     --ai-provider "kind=anthropic,model=claude-sonnet-4-5,key=env:ANTHROPIC_API_KEY" --ai-default local
slatebox ai add "kind=groq,model=llama-3.3-70b-versatile,key=env:GROQ_API_KEY"
slatebox ai test            # from inside the container: models, tool calls, tool_choice, latency
slatebox ai use local | remove groq | off | list
```

Keys are never written in flags or answers files: give `env:NAME`,
`file:/path`, or `prompt` (typed, hidden). An endpoint on `localhost` is
reached from the container as `host.docker.internal`. Images that take one
provider at a time are told so plainly when you give several.

## For agents

`npx slatebox agent-prompt` prints the brief an agent follows. In short: an
answers file, `slatebox plan --answers slatebox.yaml --json`, show the plan to
the person, then `slatebox install --answers slatebox.yaml --yes --json`.
With no terminal (or `--agent yes`, or an agent detected from the
environment), nothing is ever asked: a missing answer is exit code 3 with each
question, its choices and the flag that answers it.

Every flag has an environment form, `SLATEBOX_INSTALL_<FLAG>`. Flags win, then
the answers file, then the environment. Consent is the exception: `--yes`,
`--install-docker`, `--new-encryption-key`, `--delete-data` and `--confirm`
count only when typed on the command line, never from the environment or an
answers file, so a variable left exported in a shell or a CI job approves
nothing.

An answers file is treated as untrusted input: ssh options are limited to a
short allow-list (no `ProxyCommand`, `LocalCommand`, or host-key checking off),
host, user, folder, image, schedule and S3 URL are checked before anything runs,
and a value that looks like a key where a variable name belongs is refused
without being repeated.

| Exit | Meaning |
| --- | --- |
| 0 | Done, or nothing to change |
| 2 | Bad flags or answers; the `error` event lists each field |
| 3 | An answer or a confirmation is needed and nobody can be asked; the event lists the questions |
| 4 | A precondition failed: no Docker, no kube access, CPU too old, port taken, image unavailable |
| 5 | The change failed its health check and was rolled back cleanly |
| 6 | The rollback failed too; the event carries the commands a person must run |
| 7 | Cancelled |

With `--json`, stdout is one JSON event per line (`plan`, `step`, `done`,
`error`); text for people goes to stderr.

## After the install

```sh
slatebox status                       # address, health, version, AI, SSO, last backup
slatebox logs [-f] [--service tunnel] # the container's log, every line redacted
slatebox upgrade                      # back up, upgrade, check health, roll back (with the backup) on failure
slatebox backup [--to ./backups]      # a complete backup now
slatebox restore slatebox-backup.gz
slatebox secrets path                 # where SLATEBOX_KEY_ENCRYPTION_KEY and your keys are kept
slatebox secrets reveal SLATEBOX_KEY_ENCRYPTION_KEY   # to a terminal only, never with --json
slatebox uninstall                    # keeps data; --delete-data --confirm <name> removes it (alias: remove)
slatebox installs                     # every install this computer made (--name picks one)
```

The installer generates `SLATEBOX_KEY_ENCRYPTION_KEY` once and stores it
outside the data: `~/.slatebox/installs/<name>/secrets.env` (mode 0600) on this
computer, `/opt/slatebox/secrets.env` (root, 0600) on a server, or the Secret
`<name>-env` on Kubernetes. Back it up: backups do not contain it, and without
it the AI keys people saved cannot be read after a restore. Re-running the
installer never makes a new one.

## Move your team to Slatebox Cloud, or back

```sh
npx slatebox migrate --to cloud       # your own server's team → Slatebox Cloud
npx slatebox import --from cloud      # your Slatebox Cloud team → your own server
npx slatebox install --from cloud     # a new server, then the steps to bring your Cloud team over
npx slatebox export --out acme.sbxteam --passphrase prompt    # a team export file
npx slatebox import acme.sbxteam --to cloud --passphrase prompt
```

The command exports everything your team owns from one side (you need to be a team admin
there), and moves it to the other side, where you own your team or are in no team yet. It
moves slates and boards, smart components, versions, comments, presentations, files, the
brand kit, and library items (sent to the other side's review queue). People arrive as
placeholders. Once the move is live you are asked once, "Send invitations to the N other
members now?" (yes by default; `--invite` / `--no-invite` answer ahead; a script invites
nobody without `--invite`). Later: `npx slatebox migrate invite <move id> --to cloud`. Someone
who already has an account on the other side accepts an invitation to join there. Passwords,
keys, access tokens and connected agents never move.

You see the report before anything is visible on the other side, and nothing goes live until
you confirm. The team stays where it was until you remove it there.

- **Your own server:** its address is `--from`/`--to <url>`, `SLATEBOX_BASE_URL`, or the install
  this computer made (`--name`). Its access token is `SLATEBOX_API_TOKEN` (make one in Profile →
  Developer with "Export everything my team owns" and "Move a team here"). At a terminal you are
  asked for it, with hidden input.
- **Slatebox Cloud:** you sign in with a code in your browser (the page says "Move your team";
  the sign-in works for the move only, for an hour), or set `SLATEBOX_CLOUD_TOKEN`.
- **The archive** is encrypted with a passphrase made for this move, in `~/.slatebox/moves/`
  (mode 0600). Once the move is live you are asked whether to delete it (no by default; the
  command to delete it is printed). `--delete-archive` deletes it, `--keep-archive` keeps it,
  without asking.
- An older server than the archive stops the move with "update that server"; the archive is kept.
- `--replace-waiting` discards a move that is already waiting on the other side.

## Safety

- A plan is always shown first. On a server or a cluster nothing changes
  without a yes (`--yes` skips only the question; the plan is still printed).
- `--yes` never deletes data and never installs system software: those need
  `--delete-data --confirm <name>` and `--install-docker`. Deleting data over
  SSH removes only the files the installer wrote, in a folder holding its
  `.slatebox-install` marker.
- `plan`, and `install` before its yes, only look: nothing is pulled, loaded or
  started on the host. `upgrade` fetches the image tag first, because whether it
  is newer is what its plan is about.
- On this computer Slatebox is published on 127.0.0.1 only. `--listen 0.0.0.0`
  opens it to the network (Docker's port rules bypass ufw, so do this only
  behind something you trust). A server over SSH listens on every interface.
- The key encryption key is never made again over existing data: if the data
  volume, StatefulSet or volume claim exists and its key cannot be read, the
  installer stops (exit 4) unless you add `--new-encryption-key`.
- Upgrades back up first and roll back on failure; on Kubernetes the rollback
  puts back the previous settings and Secret, not only the image. An upgrade
  of a stopped install says in its plan that there is no backup to fall back to.
- Native Windows is not supported for this computer or SSH; use WSL 2.
- Secrets never appear in output, logs, answers files, install records or
  command lines (`ps` can read those); they travel on standard input or in
  0600 files.
- Re-running with the same answers changes nothing.
- Nothing phones home. The installer contacts the image registry, Slatebox
  Cloud only when you ask for a team address, and only with your consent
  get.docker.com; Slatebox itself contacts Cloudflare's tunnel when it has a
  team address, the certificate authority when you give a domain, and the AI
  endpoints you configure.

## Which image

Each release of this package installs one public image,
`ghcr.io/slatebox/slatebox`, by its digest (this release: `0.2.1`, which adds
the team-address tunnel, the setup link and team moves). It needs
no registry login. To install a local build instead, give `--image <name>`
(or `--image-archive slatebox.tar` for a server).

## With an agent

Connect the Slatebox MCP server (`npx -y slatebox-mcp`) to Claude, ChatGPT,
Claude Code or another agent and say "install Slatebox on my server". Its
`install_slatebox` prompt and tool walk you through the choices and end with
the exact `npx slatebox` command to run on that machine. The agent never runs
anything on your server itself; once you have run the command, it checks the
address answers.

## Slates

`slatebox exec`, `slatebox describe` and `slatebox mcp` (scripts and agents
against any Slatebox) come from the slatebox-mcp package, which this package
installs with it. If you installed slatebox-mcp 0.3 globally, which also named
a `slatebox` command, replace it with:
`npm rm -g slatebox-mcp && npm i -g slatebox slatebox-mcp`.
