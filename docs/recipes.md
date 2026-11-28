# Recipes

A recipe is an agent that keeps some of a project's slates up to date for one person: on a
schedule, on an integration's events, when you press Run now, or when your own systems post to it.
What it makes are real notes, connectors and boards on the SlateboxJS canvas, never an overlay.
People keep editing those slates as usual, and the recipe works around them.

Recipes live in `enterprise/` (source-available, free to run on Cloud and on every self-hosted
install). Projects, which recipes run in, are MIT core: see [projects.md](projects.md).

| Where | What |
|---|---|
| `enterprise/common/recipes/` | The manifest rules (`defineRecipe`), cron, events, UI words, the catalog |
| `enterprise/server/recipes/` | The runtime: store, scheduler, queue, runner, reconcile, ownership, permissions, budgets, webhooks, actions |
| `enterprise/server/recipes/vendors/<name>/` | GitHub, Slack and Google: sessions, routes, writes outside Slatebox |
| `enterprise/recipes/<id>/` | One folder per built-in recipe: `manifest.mjs`, `run.mjs`, `render.mjs`, fixtures |
| `enterprise/client/recipes/` | The Recipes tab, Add recipe, runs, webhooks, permissions, switches |

## The built-in recipes

| Recipe | Agent | Runs on | Keeps |
|---|---|---|---|
| Living architecture (`github-architecture`) | GitHub architect | every push to the default branch (2-minute quiet time), 03:00 daily, Run now, inbound data | A service map, a module graph and an API surface per repository, a "What changed" board. Extracts compose, k8s, Helm, Terraform, serverless, JS/TS, Python, Go, Java, Rust, Ruby, OpenAPI, GraphQL, proto, routes, CODEOWNERS and cycles. |
| Diagrams as code (`github-mermaid-sync`) | Diagram keeper | someone edits a synced slate (10 minutes after that slate's last edit), Living architecture changing a synced slate, a push to the default branch that touches a synced file, Run now, Save to repo now | The slates you map, kept in step with Mermaid files in the repository: canvas changes go to one pull request on `slatebox/architecture`, merged file edits update the slates in place. |
| Pull request impact (`github-pr-impact`) | PR reviewer | pull requests opened, updated, reopened, ready, closed | One slate per pull request in the Pull requests folder: what it adds, removes and touches. Can keep one diagram comment on the pull request (with your permission). |
| Decision log (`slack-decision-log`) | Decision keeper | new messages in your channels (folded every 30 minutes), 18:00 daily | A board of Decided, Revisited, Reversed and Maybe, each card linked to its thread. |
| Project timeline (`slack-timeline`) | Timeline keeper | new messages | A launch plan with owners and dates, and a board of every commitment. A moved date shows the slip. |
| Concept map (`slack-concepts`) | Glossary keeper | Mondays 08:00, new messages | The channels' vocabulary as a mind map, each term linked to where it was defined. |
| Weekly channel digest (`slack-digest`) | Digest writer | Mondays 07:30 | Last week on one slate and a presentation. Can post it to a channel you allow. |
| Sheet-backed live board (`google-sheet-board`) | Sheet sync | the sheet changes (Drive push, with a poll behind it) | An org chart, kanban, hiring plan, pipeline or timeline driven by a sheet. |
| Design doc to diagram (`google-design-doc`) | Design doc reader | the doc changes | The doc's Mermaid diagrams, outline and components, each note linked to its section. |
| Render from a webhook (`webhook-render`) | Webhook renderer | inbound data, Run now with data | A slate drawn from the graph, Mermaid, board or prose your systems post. |
| Project index (`project-index`) | Project librarian | hourly | One slate listing every slate in the project and which agent keeps it. |

### Diagrams as code

Set it up with the repository, a folder (default `docs/architecture/`), which slates of the project
are kept as which files (any slate: the agent's own or one you made; leave the file empty to name
it after the slate), and the branch (default `slatebox/architecture`). Then:

- **Edits go to the repository by themselves.** Ten minutes after the last edit to a synced slate
  (per slate: a slate you keep editing never holds back another), the slate is written as Mermaid
  and committed to the one open pull request on the branch. Moving notes changes nothing (the file
  lists notes by id, not by position), so it makes no commit. A person's commit on the branch is
  kept: the next commit goes on top, never a force-push. Nothing is ever pushed to the default
  branch or merged by Slatebox.
- **Save to repo now** on the synced slate (beside "Synced with acme/api
  docs/architecture/checkout.mmd @ 1a2b3c4") and on the recipe's card exports at once.
- **After Living architecture** changes a synced slate, the export runs straight after its run.
- **Merged edits to the file** (a push to the default branch) update the slate in place: new
  notes and lines, changed labels and shapes; nothing moves, and people's own notes stay. Our own
  merged pull request is recognized by its content and changes nothing.
- **Changed in both places:** the canvas version is kept, a note on the slate says what the file
  had, and the pull request lists the element, until the canvas version is merged.
- **Without the permission** to open pull requests, each change waits as an approval card in the
  recipe's Changes outside Slatebox, with its `.mmd` files to download.
- Its webhooks still send `mermaid.sync.pr_opened`, `mermaid.sync.pr_updated`,
  `mermaid.sync.imported` and `mermaid.sync.conflict`, for developers.

Under the hood: the app tells recipes of every slate save (`web/app/server/recipes-hooks.mjs`
`slateSaved`); `enterprise/server/recipes/slate-saves.mjs` keeps that cheap (a slate no recipe
watches is one cached lookup; a watched one is folded per slate into the instance's due time), and
the scheduler turns quiet slates into one `slate_saved` run. A recipe's own saves never count.

## How a run works

1. **Switches**, widest first: the server's `settings.recipes.off`, the install switch (Admin ›
   Recipes), the team's "Allow recipes", the owner's "Pause all my recipes", the project's "Pause
   recipes in this project", the recipe's own state. Any one of them off: the run is skipped and
   says why.
2. **Access.** The owner must still be an editor of the project (and in its team). If not, the
   recipe stops as `blocked_access` and a manager may take it over.
3. **Sign-in.** The run opens the owner's integration session. GitHub runs on the Slatebox GitHub
   App installation that holds the picked repositories, and only if the owner's own GitHub account
   was shown to see it. A lost sign-in stops the recipe as `needs_sign_in`.
4. **The recipe runs** under a 10-minute limit and a budget (vendor calls, model tokens,
   operations). It answers a *desired set*: the slates, notes, connectors and boards it wants, by
   key. It never touches Mongo, fetch or the registry itself (`scripts/recipe-imports.test.mjs`).
5. **Intercepts** may narrow what it does (see [webhooks.md](webhooks.md)).
6. **Reconcile** turns the desired set into operation plans on each slate, then saves them through
   the app's own `slates.applyOperations`, under the recipe's agent identity ("GitHub architect ·
   runs for Ana"), with a named cursor while it works and an undo record per slate.
7. **Writes outside Slatebox** (a check run, a PR comment, a Slack post) happen only under a
   standing permission (below).
8. **Finish:** the status slate is refreshed, events go to webhooks, and the activity log gets one
   `recipe.run` entry per recipe per hour.

## People's edits always win

- Every note a recipe makes has an id from its key, and the recipe remembers which notes it keeps.
- It never moves or resizes an existing note; positions are people's.
- A note a person rewords, restyles, relinks or deletes becomes theirs: the recipe never changes or
  deletes it again. "Make it mine" does the same on purpose; locking a note pins it.
- Notes people add are invisible to the recipe.
- When the source drops something a person made theirs, the recipe leaves a comment on it instead
  of deleting it.
- A save that meets someone else's change is re-read and retried once, else tried on the next run.

## Suggest first, then automatic

The first run always suggests: ghost notes with Keep all, in actions of at most 120 items (a first
build larger than 400 is saved as one undoable action instead, after the Preview). Once the owner
keeps a run, "Apply future updates automatically" is offered. The status slate, and slates the
recipe did not make, always get suggestions.

## Changes outside Slatebox

A recipe never changes anything outside Slatebox on its own. Each kind is a separate permission the
owner grants on the recipe, in the app only (never a token, a script or MCP), showing exactly what
and where:

| Kind | Example scope | Limits no permission lifts |
|---|---|---|
| `github.check_run` | Add a neutral "Slatebox architecture" check to pushes in acme/api | — |
| `github.pr_comment` | Keep one diagram comment on pull requests in acme/api | One comment, edited in place |
| `github.pull_request` | Open pull requests on `slatebox/…` branches changing only `docs/architecture/*.mmd` | Never the default or a protected branch; never merge, delete or force |
| `slack.post` | Post the digest to #team-platform | Only the granted channels |

Without a permission, the change becomes an approval card on the recipe's status slate; approving it
runs it once. Every change made is recorded as `recipe.outside_write`. Taking a permission back stops
the recipe until it is resumed.

## Turning recipes on, and every switch

| Switch | Who | Where |
|---|---|---|
| `settings.recipes.off: true` | The operator | Meteor settings: no actions, no routes, no workers |
| Install switch | A server admin | Admin › Recipes. On from the start on Cloud; **off on a self-hosted install until an admin turns it on** |
| Pause every recipe | A server admin | Admin › Recipes |
| Allow recipes for this team | A team admin | Team settings |
| Pause all my recipes | Each person | Profile |
| Pause recipes in this project | Managers | The project's Recipes tab |
| Pause, resume, Run now, delete | The owner or a manager | Each recipe |
| Pause all agents | Anyone who can edit | On a slate |

Every switch is recorded in the activity log.

## Agent use and cost

A run's model calls go through AI control (`settings.ai.use.recipes`, then `connectors`, then the
default), on the owner's own key if they set one, else their agent allowance on Cloud. On a
self-hosted install they use the admin's keys. When a call is refused, the run still keeps what it
read without the model and ends `partial`.

## From an agent, a script or the CLI

The `recipes.*` actions are on `/api/v1` and over DDP (scopes `recipes:read`, `recipes:write`,
`recipes:run`). The main ones:

| Action | HTTP |
|---|---|
| `recipes.catalog` | `GET /recipes/catalog` |
| `recipes.list` | `GET /projects/{projectId}/recipes` |
| `recipes.create` | `POST /projects/{projectId}/recipes` (`{ recipeId, config, triggers? }`, a draft) |
| `recipes.preview` | `POST /recipes/{instanceId}/preview` (what it would make, nothing saved) |
| `recipes.activate` | `POST /recipes/{instanceId}/activate` |
| `recipes.run` | `POST /recipes/{instanceId}/run` (`{ reason?, data? }`, 30 an hour) |
| `recipes.saveNow` | `POST /recipes/{instanceId}/save-now` (`{ shareId? }`: a synced slate to its repository now; counted with Run now) |
| `recipes.syncedOn` | `GET /slates/{shareId}/recipe-sync` (the repository, file and commit a slate is synced with) |
| `recipes.pause`, `recipes.resume` | `POST /recipes/{instanceId}/pause`, `/resume` |
| `recipes.runs` | `GET /recipes/{instanceId}/runs` |
| `recipes.undoRun` | `POST /recipe-runs/{runId}/undo` |
| `recipes.hooks.*` | `/recipes/hooks…` (see [webhooks.md](webhooks.md)) |
| `recipes.pauseProject` | `POST /projects/{projectId}/recipes/pause` |
| `recipes.pickerOptions` | `GET /recipes/picker-options` (GitHub repos, Slack channels) |

```sh
curl -X POST "$SLATEBOX/api/v1/recipes/$INSTANCE/run" \
  -H "Authorization: Bearer $SLATEBOX_TOKEN" -H 'Content-Type: application/json' \
  -d '{"reason":"nightly build","data":{"key":"deps","graph":{"nodes":[{"key":"web","label":"web"},{"key":"api","label":"api"}],"edges":[{"from":"web","to":"api"}]}}}'
```

## Writing a recipe

```js
// enterprise/recipes/my-recipe/manifest.mjs
import { defineRecipe } from '../../common/recipes/manifest.mjs'
export const manifest = defineRecipe({
  id: 'my-recipe', version: 1, label: 'Release notes board', agentName: 'Release scribe',
  summary: 'Every release, on a board.', integration: 'github',
  needs: { github: ['contents:read'] },
  triggers: [{ kind: 'vendor', event: 'github.push', debounceMs: 120000, default: true }, { kind: 'manual' }],
  configSchema: { type: 'object', additionalProperties: false, required: ['repos'], properties: { repos: { type: 'array', items: { type: 'string' }, 'x-slatebox-picker': 'repos' } } },
  inputSchema: null,
  outputs: [{ role: 'releases', name: 'Releases', kind: 'board', component: 'team-board' }],
  writes: [], events: ['releases.updated'], intercepts: ['output.ready'],
  cost: { class: 'low', tokensPerRun: [0, 0], vendorCallsPerRun: [1, 20] }, idPrefix: 'rn',
})
// enterprise/recipes/my-recipe/run.mjs: return what the project should hold, by key
export default async function run(ctx) {
  const head = await ctx.vendor.github.head(ctx.instance.config.repos[0])
  ctx.emit('releases.updated', { sha: head.sha })
  return { summary: 'Releases up to date', desired: { slates: [{ role: 'releases', key: 'releases', name: 'Releases', boards: [/* … */] }] } }
}
```

Add it to `RECIPE_MODULES` in `enterprise/server/recipes/index.mjs` and to `CATALOG` in
`enterprise/common/recipes/catalog.mjs`. Event data is flat: names, numbers and lists of them.

## Tests

```sh
npm run test:recipes                # the runtime: queue, scheduler, reconcile, webhooks, actions
npm run test:recipes-github         # GitHub vendor, G1–G3, Mermaid, and G1 end to end through the runtime
npm run test:recipes:slack-google   # Slack, Google and webhook recipes, end to end through the runtime
npm run test:projects               # projects: roles, doors, actions
```

`scripts/recipe-github-runtime.test.mjs` is the whole story in one test: a shared project, a
recipe added and kept, a signed push turned into one debounced run that updates in place while a
person's edit survives, signed outbound webhooks, an inbound webhook run, a scheduled run, every
switch, and the activity log.
