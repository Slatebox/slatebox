# Free-form smart-component eval

What people type into Ask Slatebox on a builder slate (`/new#build`) instead of picking a shape, for example the
owner's "snappable congruent pieces to compose new printable materials", must come out as a smart component: a
board of lanes whose cards are the pieces people drag, with its behavior as data (lane capacities, allowed lanes,
one-step, path and archive rules). It must also be a working tool, not a toy.

The prompts are in `prompts.mjs` (46 of them: the owner's, classroom, work, home, games, vague, odd, non-English and
rambling ones). Both layers below read them.

## What "built" means

- **Valid** (`checks.mjs` `previewProblems`): the preview is a board of plain lanes that passes `validateWorkshop`,
  the agent drafted it (not the starter a failed draft falls back to), and it says what it made.
- **Quality** (`checks.mjs` `qualityProblems`, which is `componentQuality` in
  `web/app/imports/api/common/builder-freeform.mjs`): at least three cards; every card named as the real thing it is,
  never a lane, title or generic phrase plus a number or letter ("Piece 3", "Laptop B", "Snappable congruent
  piece 1"); no card named twice; and at least one piece of behavior (a lane capacity, `allowedLaneIds` on a card,
  or a rule). The drafting request holds every draft to this same gate. A draft that fails it is asked again, with
  the problem named. Unambiguous slips are repaired: a repeated card, or a placeholder beside three or more named
  cards, is left out. A draft that still fails is replaced by the starter built from the person's words.

## The deterministic layer (CI-safe)

```sh
npm run test:smart-components
```

This runs under plain node with no network, keys or model. It drives the real `nativeCanvas.preview` →
`workshops.draft` → `req` path (`replay.mjs`) with recorded and known-bad model answers (`recorded.mjs`): counts sent
as text, zero capacities, missing labels, wrong tools, calls written as text, the toy board the owner was shown,
lettered cards, no behavior, too few cards, guests, the lock and the meter. It is also part of `npm run test:library`.

## The live layer

```sh
node scripts/evals/smart-components/live.mjs --origin http://127.0.0.1:3660 --mongo mongodb://127.0.0.1:3661/meteor \
  [--only id,id] [--repeat 2] [--concurrency 3] [--no-render] [--out report.json] [--shots dir] [--keep]
```

Each prompt is typed on a fresh builder slate of a running app, as a new disposable account. The app's configured
model drafts it. The board is checked, kept, and drawn in a fresh headless browser. The script exits 1 below
`--target` (default 0.95 valid) or `--quality-target` (default 0.90 quality). Valid and quality rates are reported
separately in the summary, along with p50/p90 latency, calls, tokens and cost.

What a run needs:

- **A running Meteor app** with the AI configuration you mean to measure (`settings.ai` connections and `use`, or
  Admin › AI control), and that provider's key in its environment. The script names no model and holds no key. For
  local runs: `cd web/app && meteor run --port 3660 --settings <settings file>`, with the keys exported from your own
  `.env`.
- **`--mongo`** pointing at that app's database (Meteor's dev database is the app port + 1). It is used to read token
  use and cost from `aiAudit`, prices from `aiModels` (or `--prices` / `EVAL_PRICES`,
  `{"<model>": [inPerM, outPerM]}`), and to remove the disposable accounts and their slates at the end (unless
  `--keep`). Without it, the run still checks and renders but reports no cost and leaves the accounts behind.
  `mongosh` must be on the path.
- **Playwright** (installed with the repo's dev dependencies) for the render step. Set `SLATEBOX_CHROMIUM` to a
  Chromium executable if Playwright's own browser is not installed. Use `--no-render` to skip this step.
- **Cost**: each prompt is one or two model calls (a second only when the first answer is refused). With Muse Ember on
  test's configuration, a run of the 46 prompts made 46 to 47 calls and cost about $0.25 (p50 5.3 s, p90 11.9 s).
  Each account may draft once a minute, which is why every case gets its own account.

## The owner's words end to end

```sh
node scripts/evals/smart-components/owner-e2e.mjs --origin http://127.0.0.1:3660 --shots <dir> [--mongo <url>]
```

This types the owner's exact words on `/new#build` in two fresh browser contexts: a new signed-in account (the
agent's draft is previewed, kept, saved, and listed in Add to this slate › Yours) and a guest (the starter built from
the words, with the sentence saying that signing in lets the agent draft it). Screenshots of each step go to
`--shots`. The script fails on any "Operation N" text, a page error, or a step that does not arrive.
