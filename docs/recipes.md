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
| `enterprise/server/recipes/vendors/<name>/` | GitHub, Slack, Google and Linear: sessions, routes, writes outside Slatebox |
| `enterprise/recipes/<id>/` | One folder per built-in recipe: `manifest.mjs`, `run.mjs`, `render.mjs`, fixtures |
| `enterprise/client/recipes/` | The Recipes tab, Add recipe, runs, webhooks, permissions, switches |

## The built-in recipes

| Recipe | Agent | Runs on | Keeps |
|---|---|---|---|
| Living architecture (`github-architecture`) | GitHub architect | every push to the default branch (2-minute quiet time), 03:00 daily, Run now, inbound data | A service map, a module graph and an API surface per repository, a "What changed" board. Extracts compose, k8s, Helm, Terraform, serverless, JS/TS, Python, Go, Java, Rust, Ruby, OpenAPI, GraphQL, proto, routes, CODEOWNERS and cycles. |
| Diagrams as code (`github-mermaid-sync`) | Diagram keeper | someone edits a synced slate (10 minutes after that slate's last edit), Living architecture changing a synced slate, a push to the default branch that touches a synced file, Run now, Save to repo now | The slates you map, kept in step with Mermaid files in the repository: canvas changes go to one pull request on `slatebox/architecture`, merged file edits update the slates in place. |
| Pull request impact (`github-pr-impact`) | PR reviewer | pull requests opened, updated, reopened, ready, closed | One slate per pull request in the Pull requests folder: what it adds, removes and touches. Can keep one diagram comment on the pull request (with your permission). |
| Live roadmap from Linear (`linear-roadmap`) | Roadmap keeper | a Linear project, project update or initiative changes (2-minute quiet time), 03:00 daily, Run now; optionally issue changes | A Roadmap board per team (or initiative, or lead) with each open project in its target-date lane, a Dependencies map of which projects block which, and each project's latest health post. |
| Cycle board from Linear (`linear-cycle-board`) | Cycle keeper | a Linear issue or cycle changes, 03:30 daily, Run now | One slate per team cycle in the Cycles folder: a board of its issues by status, what is blocked and by whom, and how its scope moved. |
| Release map from Linear and GitHub (`linear-release-map`) | Release mapper | a GitHub release is published, 04:15 daily, Run now; optionally Linear issue changes | A frame per release with the Linear issues its commits name and each project's progress, and a board of what shipped but is still open in Linear. |
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

### The Linear recipes

**Connect Linear** once, from Add a recipe: Slatebox opens Linear's own page, you choose
**Authorize**, and it is connected. Slatebox reads Linear as you, with your access there, and asks
for `read`, `issues:create` (to change an issue's status, only when you allow it per recipe) and
`comments:create`. Your sign-in is kept encrypted for you alone and renewed by itself (Linear's
sign-ins last a day and renew for 30 days; each recipe's nightly run keeps it from lapsing). This is
not the Linear card in the agent gallery: that one is Linear's own MCP server, for asking Linear
from a slate. Recipes run with nobody there, so they use Linear's API.

**Live roadmap** (`linear-roadmap`). Pick the teams. You get three slates:

- **Roadmap**: a board per team (or per initiative, or per project lead), with lanes *Overdue*,
  *This quarter*, *Next quarter*, *Later* and *No target date*. Each open project is a card in the
  lane its target date puts it: "Checkout v2 · Dec 19 · at risk · slipped +9d". A board holds 24
  cards, so a bigger team gets more boards (8 a slate, then a second slate).
- **Dependencies**: each open project as a note colored by its health (green on track, amber at
  risk, red off track), inside a frame for its team, and a line from a project to each project it
  blocks, labeled with how many open issues block it. A dashed line marked *late* means the blocker
  is due after what it blocks.
- **Project health**: each project's latest update, worst health first, with how long ago it was
  posted; *Stale update* after 14 days (you choose). Turn on the weekly summary for three sentences
  by the agent from the week's updates (one call a week, at most 6,000 tokens in); off, the recipe
  uses no tokens.

When a target date moves in Linear, that project's card changes and says by how much it slipped;
nothing else on the board does. Move a card yourself to plan on the slate and it stays there until
Linear changes that project again; then it follows Linear. Your own notes and stickies stay.
Grouping by initiative needs a Linear admin to have installed Slatebox for the workspace; otherwise
the recipe groups by team and says so. The roadmap never changes anything in Linear.

**Cycle board** (`linear-cycle-board`). Pick up to five teams. Each team's current cycle is a slate
in the Cycles folder, "ENG cycle 48 (Nov 24 – Dec 7)":

- a board with lanes *To do*, *In progress*, *Done* and *Canceled* and a card per issue ("ENG-212
  Fix refunds · Ana · 3 pts · blocked"); past 24 issues the boards are split by assignee, each
  person's issues on one board;
- each blocked issue as an amber note with a line from each issue blocking it; another team's
  issues in a frame for that team; a blocker already done is grey;
- a scope note: how many issues were planned at the start, added after it started, and removed.

A status change in Linear moves that one card. When you move a card to another lane, the recipe
proposes moving the issue in Linear to the first status of that lane: with the permission
*Move Linear issues to another status* it does so; without it, the move waits as an approval card
on the recipe's status slate. When the next cycle starts it gets its own slate, and the last one
stays as it was.

**Release map** (`linear-release-map`). Pick the repositories (the Slatebox GitHub App must be
installed on them) and the Linear teams whose issue ids to look for. Each published GitHub release
becomes a frame on the Releases slate, oldest to newest, holding the Linear issues its commits name
(an id such as ENG-123 in a commit message, or in the branch a merged pull request came from), grey
when done and orange when still open in Linear, and a note per project with its progress at that
release against the release before ("Fraud rules: 40% → 55% done"). The board *Shipped but not
closed in Linear* lists what is still open; it empties as Linear catches up. A release is read once
(one compare against the release before it); later runs only check whether its open issues have
closed. It never changes anything in Linear or GitHub.

**What it costs Linear.** A roadmap run makes 2 to 10 calls, a cycle run 1 per 100 issues, a
release map 2 plus 1 per new release and 1 per 50 open issues. Linear's limits are per person (5,000
calls an hour), so this stays far below them. Every call counts against the run's own budget.

**Linear's events.** Linear calls `/integrations/linear/events` for every workspace that authorized
Slatebox (one address for all of them). Each call is checked first: the `Linear-Signature` header
must be the HMAC-SHA256 of the exact body under the app's signing secret, and its
`webhookTimestamp` within a minute, else it gets a 401 and nothing runs. Each delivery is handled
once and becomes a trigger after a short quiet time, never a run inline. When a workspace removes
Slatebox's access in Linear, its people's Linear sign-ins end here and their Linear recipes stop as
*Needs you to sign in again*. Linear gives up on a call after three tries, which is why each recipe
also runs nightly.

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
| `linear.update_item` | Move an issue's status when its card moves on the cycle board, for the ENG team | Only an issue's status, never another field; only the granted and picked teams; never create, delete or archive |

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
| `recipes.pickerOptions` | `GET /recipes/picker-options` (GitHub repos, Slack channels, Linear teams) |

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
npm run test:recipes-linear         # Linear connect, vendor (signed events, GraphQL, writes) and the three Linear recipes, end to end
npm run test:projects               # projects: roles, doors, actions
```

`scripts/recipe-github-runtime.test.mjs` is the whole story in one test: a shared project, a
recipe added and kept, a signed push turned into one debounced run that updates in place while a
person's edit survives, signed outbound webhooks, an inbound webhook run, a scheduled run, every
switch, and the activity log.
