# Slatebox exec: MCP server and CLI

**Slatebox is an open source visual intelligence platform where you can invite any AI via MCP to collaborate with you and your team.** Mind maps, diagrams, project plans and presentations, drawn by your assistant and edited live with your team. An open-source alternative to whiteboard tools such as Miro. MIT licensed. The canvas is free. On Slatebox Cloud, AI comes with Slatebox Pro; a self-hosted Slatebox can use its own AI key.

*Not affiliated with or endorsed by Miro. Miro is a trademark of its owner.*

**Connect without installing anything:** add `https://app.slatebox.com/mcp` as a remote MCP server (a custom connector) in your assistant. It signs you in to Slatebox and asks which permissions to give it. Your own Slatebox serves the same endpoint at `/mcp`. Install this package when you want the server or the `slatebox` command on your own machine. [Setup for Claude, ChatGPT and other clients](https://docs.slatebox.com/developers/slateboxapi/mcp/)

Agents create and edit Slatebox slates (mind maps, flowcharts, diagrams, project plans, slides and boards) by running a short script, or by calling one tool per task. This package gives them two ways to do it:

- `slatebox-mcp`, an MCP server. **`exec`** runs a JavaScript or TypeScript script, and **`describe`** explains the typed client the script uses. Beside them it lists one typed tool per client method, such as `create_slate`, `import_mermaid`, `get_slate`, `edit_slate` and `export_mermaid`, five prompts (mind map, flowchart, project plan, presentation, install Slatebox) and resources (the client's types and guide, and any slate as JSON or Mermaid).
- `slatebox`, a command that runs the same scripts from a terminal.

Inside a script, the global `slatebox` is a typed client with one method for each thing your token may do, such as `slatebox.slates.get({ shareId })` and `slatebox.slates.applyOperations({ shareId, plan })`. The client is generated from the Slatebox action registry, so new Slatebox actions appear in it without a new tool.

Every call a script makes is checked as if you made it yourself: token permissions, sharing, revisions, workshop rules, preview or save, rate limits and the audit record all apply.

The typed tools are generated from the same client: each one is an `exec` script of exactly one call (`get_slate({shareId})` runs `return await slatebox.slates.get(...)`), so it meets exactly the checks a script meets, and a held change is confirmed the same way (call the tool again with `confirm` and the `idempotencyKey`). `exec` is always listed. To list only `exec` and `describe`, start the server with `--typed-tools off` or set `SLATEBOX_MCP_TYPED_TOOLS=off`; the hosted `/mcp` endpoint reads the same variable.

## Where your script runs: no sandbox

**This package runs scripts on your own machine, in its own process, with your rights. There is no sandbox.** A script can do anything a program you start can do: read your files, use your network and read the process memory, which holds your token. Approve an agent's `exec` call as you would approve a shell command it wants to run.

The script runs in a child process of its own, so that a stuck script can be killed after 30 seconds, its output is read as logs and never reaches the MCP stream, and a crash ends only that process. The child starts with an empty environment. None of this is a security boundary: the child has your rights.

**What the rules cover on your machine.** The rules above (holding deletes, large text rewrites, changes to other people's notes and wider sharing for your confirmation; the call, note and operation caps; keeping token management out of reach; the run record) apply to every call the script makes through `slatebox`. They are enforced by your Slatebox, not by this package. Because there is no sandbox, a script can also step outside `slatebox`: it can read your token from this process and call the Slatebox API directly, or do anything else your account allows. Such calls are checked as ordinary API calls (token permissions, sharing, rate limits), and your Slatebox still holds a direct call by an agent token that deletes notes or workshop cards, changes someone else's notes, rewrites many notes' text or widens access, until it is sent again with the `Slatebox-Confirm` header; the run record does not list them. On a Slatebox server (`--remote`, `POST /api/v1/exec`, the hosted `/mcp` endpoint, the in-app conversation) a script has no way out of `slatebox`, so every rule holds for everything it does.

The confirmation rule for wider sharing looks at one script at a time: it holds a script that reads a slate and then writes to a slate more people can see. Text that an agent carries from one script to the next is not tracked.

If you want a script to run on your Slatebox instead, in its sealed runner with no network, no files and no secrets, use `slatebox exec --remote`, the HTTP route `POST /api/v1/exec`, or your instance's hosted MCP endpoint at `/mcp`.

## Install

Use Node.js 22.13 or later. Download the archive and checksum from the Slatebox docs. The archive includes the JavaScript source of both commands, the generated client files and the MIT license.

```sh
curl -fLO https://docs.slatebox.com/assets/downloads/slatebox-mcp-0.3.5.tgz
curl -fLO https://docs.slatebox.com/assets/downloads/slatebox-mcp-0.3.5.tgz.sha256
shasum -a 256 -c slatebox-mcp-0.3.5.tgz.sha256
npm install --global ./slatebox-mcp-0.3.5.tgz
slatebox help
```

On Linux you can also verify the checksum with `sha256sum -c slatebox-mcp-0.3.5.tgz.sha256`. npm installs the public MCP SDK.

Open **Profile → Developer access** in your Slatebox account and create a token. Supply it in the `SLATEBOX_API_TOKEN` environment variable. Set `SLATEBOX_BASE_URL`, or pass `--base-url`, to your own instance's origin when self-hosting. The default is `https://app.slatebox.com`, Slatebox Cloud, which serves the API at `/api/v1` and the hosted MCP endpoint at `/mcp`.

## Use an MCP client

Choose a local stdio server in your MCP client, set its command to the installed `slatebox-mcp` executable and pass `SLATEBOX_API_TOKEN` through the client's secret or environment settings. If the client runs outside your shell, supply the full path printed by `command -v slatebox-mcp`.

```json
{ "mcpServers": { "slatebox": { "command": "slatebox-mcp", "env": { "SLATEBOX_API_TOKEN": "…", "SLATEBOX_BASE_URL": "https://slatebox.example.com" } } } }
```

For a client that connects by URL, start `slatebox-mcp --http`. It listens at `http://127.0.0.1:3917/mcp` (change the port with `--port`). It listens on 127.0.0.1 only, refuses requests whose `Host` or `Origin` is not loopback, and answers only requests that send the token it was started with as `Authorization: Bearer <token>`. Without these rules, any program or web page that could reach the port could run code as you.

The agent calls `describe` to learn the client, then `exec` with:

| Field | Meaning |
|---|---|
| `intent` | One sentence a person can approve: what the script does |
| `code` | A JavaScript or TypeScript function body. Top-level `await` and `return` work; return a small JSON value |
| `mode` | `save` (the default) or `preview`, which previews every write and saves nothing: each write is sent as a preview, and a write that cannot be previewed is refused |
| `confirm` | The confirmation id from a `confirmation_required` result, once the person agreed |
| `idempotencyKey` | Reuse it to retry or confirm the same script: its saved calls replay instead of repeating |

For example:

```js
const shareId = "the-share-id";
const { revision } = await slatebox.slates.get({ shareId });
return await slatebox.slates.applyOperations({ shareId, expectedRevision: revision, mode: "preview", plan: {
  message: "Added a review step",
  operations: [{ kind: "add_nodes", count: 1, text: "Review", placement: { direction: "right" } }],
} });
```

Every edit names the revision it was made on: pass the `revision` that `slates.get` returned as `expectedRevision` with a canvas plan (a workshop or map edit puts `workshop.revision` in its operation instead). Without it the call is refused with `invalid_request`; with it, the edit is refused with `slate_changed` only when a note or setting it changes was changed after that revision.

The result has a `status` of `completed`, `failed` or `confirmation_required`, the returned `result`, the script's `logs`, every call it made with its outcome in `calls`, any `error` with its line, and `usage`. A method that fails throws `SlateboxError` with `code`, `status` and `details`.

## Edit a workshop

A workshop takes the edits people make, by the rules they meet on the canvas. Send one `workshop_edits` operation with 1 to 50 edits; they apply in order, all or none. Name a card or lane by its id (`{ id }`) or by what people call it ("the Proposal stage"). `workshop.edits` in `slates.get` lists the edits that board takes.

```js
const shareId = "the-share-id";
const { workshop } = await slatebox.slates.get({ shareId });
const saved = await slatebox.slates.applyOperations({ shareId, plan: {
  message: "Added a card and moved Gamma on",
  operations: [{ kind: "workshop_edits", expectedRevision: workshop.revision, edits: [
    { kind: "add_card", lane: "Later", label: "Delta" },
    { kind: "move_card", card: "Gamma", lane: "Later" },
  ] }],
} });
```

A refused edit throws `edit_refused` with the sentence a person would see (`details.reason`), which edit it was (`details.editIndex`), the lanes a card may go to (`details.legalLaneIds`) and the board as it stands; nothing is saved. Adding, moving and renaming save at once. An edit that removes a card, a lane, a dependency or an outcome is held for the person to agree, like deleting notes.

A saved workshop edit answers with a `receiptId`. `{ kind: "undo_workshop_edit", receiptId, expectedRevision }` puts the board back as it was before that edit, only while nothing has changed since; otherwise it is refused with `slate_changed` and the board as it stands.

## Show people what your agent is doing

Everyone who can open a slate sees your run as a named pointer: "Ada's agent", or "Ada's agent · Your client" when your MCP client reports its name. The pointer moves to what each save changes. Show them your plan, and tick it as you go:

```js
await slatebox.presence.plan({ shareId, steps: ["Read the interview notes", "Draft a brief", "Map the new signup flow"] });
// ... read and save ...
await slatebox.presence.step({ shareId, index: 0, status: "done" }); // the next step starts
```

A plan has 1 to 8 steps of up to 80 plain characters. A run sets its plan at most 3 times and ticks steps at most 40 times. When the run ends, the step under way is done (or marked stopped if the run failed), and the pointer fades a few seconds later. A preview run shows nothing.

## Confirm before save

Your Slatebox holds a save, and the run ends with `confirmation_required`, when a script deletes notes or workshop cards, rewrites more than 10 notes' text in all (counted over the whole script, on every slate it writes to), changes notes someone else wrote, or makes content visible to more people. Calls before the held one have saved. The result lists the reasons. To save, run the same code again with `confirm` set to the confirmation id and the same `idempotencyKey`. A confirmation expires after 10 minutes and works once.

This is a check with a record, not an approval system: an agent you allow to run `exec` without asking can also confirm without asking.

## Use the terminal

```sh
slatebox exec script.js
slatebox exec - < script.ts
slatebox exec -e 'return (await slatebox.slates.get({ shareId: "the-share-id" })).nodeCount'
slatebox exec script.js --preview
slatebox exec script.js --remote
slatebox describe
slatebox describe --method slates.applyOperations
```

Before a local run sends anything, it asks your Slatebox (`GET /api/v1/instance`) whether it runs exec scripts. One that does not is sent nothing, and the run fails with `exec_unavailable`: such an instance would take the calls as ordinary API calls, with no preview and no confirmation.

Without `--json`, the command writes one summary line to standard error and the returned value as JSON to standard output. With `--json` it writes the whole result. When a save is held, a terminal asks `Save anyway? [y/N]`; elsewhere the command prints the exact command that confirms and exits 6.

| Exit code | Meaning |
|---|---|
| 0 | The script completed |
| 1 | Any other failure |
| 2 | Usage: the command or its options are not valid |
| 3 | Sign-in: the token is missing, expired or revoked (`--remote`) |
| 4 | Access: the route or slate is not available to this token (`--remote`) |
| 5 | Refused: a conflict or a refusal of the whole run (`--remote`) |
| 6 | Confirmation required |
| 7 | The script failed |

## Use the client in your own code

```js
import { createClient } from "slatebox-mcp/client";
const slatebox = createClient({ baseUrl: "https://slatebox.example.com", token: process.env.SLATEBOX_API_TOKEN });
const slate = await slatebox.slates.get({ shareId: "the-share-id" });
```

Outside a script, each call is an ordinary API call. Pass `{ idempotencyKey }` as a second argument to retry a save safely. The types are in `generated/slatebox.d.ts`.

## Mermaid

Any slate you can read comes out as Mermaid, and Mermaid goes in as real notes and lines:

```js
const { mermaid, markdown } = await slatebox.slates.exportMermaid({ shareId }); // format: auto, flowchart, mindmap or gantt
await slatebox.slates.importMermaid({ shareId, mermaid: "flowchart LR\n  idea --> plan" }); // leave out shareId for a new slate
```

A flowchart, mind map or Gantt chart is drawn; another kind of diagram is refused with `mermaid_unsupported`. A public slate's Mermaid is also plain text at `/slates/<shareId>.mmd` (and `.md`), with no token, for a README or a doc.

## Limits

A script may make 64 calls and run for 30 seconds. Its result is cut at 40,000 characters of JSON and its logs at 16 KiB. Call `describe` for the full list your instance publishes.
