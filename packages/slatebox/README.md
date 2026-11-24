# slatebox

Run your own Slatebox with one command, on the machine of your choice:

```sh
npx slatebox
```

It asks a few short questions (Enter takes the default), shows a plan of
everything it will write, run and create, and installs once you say yes. Then
it prints the address and how to set the admin password. `npx slatebox
--dry-run` asks the same questions and prints the plan without changing
anything. You need Node.js 22.13 or newer, and Docker (or Podman with its
Docker compatibility on) on whatever runs Slatebox.

Slatebox is one container: the app, the live collaboration relay, MongoDB and
Keycloak for single sign-on (off until you turn it on). It is free, and single
sign-on is free.

| Where | How |
| --- | --- |
| This computer | `npx slatebox` (the default). Picks a free port from 7070 and prints the address. |
| A Linux server | `npx slatebox install ssh root@203.0.113.5 --domain boards.example.com`. With a domain, HTTPS certificates are obtained and renewed automatically (point DNS at the server, open ports 80 and 443); without one, `http://<server>:7070`. Docker is installed only if you add `--install-docker`. |
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
slatebox upgrade                      # back up, upgrade, check health, roll back (with the backup) on failure
slatebox backup [--to ./backups]      # a complete backup now
slatebox restore slatebox-backup.gz
slatebox secrets path                 # where SLATEBOX_KEY_ENCRYPTION_KEY and your keys are kept
slatebox secrets reveal SLATEBOX_KEY_ENCRYPTION_KEY   # to a terminal only, never with --json
slatebox uninstall                    # keeps data; --delete-data --confirm <name> removes it
slatebox installs                     # every install this computer made (--name picks one)
```

The installer generates `SLATEBOX_KEY_ENCRYPTION_KEY` once and stores it
outside the data: `~/.slatebox/installs/<name>/secrets.env` (mode 0600) on this
computer, `/opt/slatebox/secrets.env` (root, 0600) on a server, or the Secret
`<name>-env` on Kubernetes. Back it up: backups do not contain it, and without
it the AI keys people saved cannot be read after a restore. Re-running the
installer never makes a new one.

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
- Nothing phones home. The installer contacts the image registry, and only
  with your consent get.docker.com; Slatebox itself contacts the certificate
  authority when you give a domain, and the AI endpoints you configure.

## Before the public image exists

Until `ghcr.io/slatebox/slatebox` is published, install a local build with
`--image <name>` (or `--image-archive slatebox.tar` for a server). Each
release of this package will pin one image digest.

## With an agent

Connect the Slatebox MCP server (`npx -y slatebox-mcp`) to Claude, ChatGPT,
Claude Code or another agent and say "install Slatebox on my server". Its
`install_slatebox` prompt and tool walk you through the choices and end with
the exact `npx slatebox` command to run on that machine. The agent never runs
anything on your server itself; once you have run the command, it checks the
address answers.

## Slates

`slatebox exec` and `slatebox describe` (scripts against a Slatebox) come from
the slatebox-mcp package; this command fetches it the first time you use one.
