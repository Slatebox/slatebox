# Slatebox app — working notes

Canonical Meteor 3.6.1 product app. Canvas engine comes from the sibling
library repo `../slateboxjs-v2` (SlateboxJS v3).

## Engine source

Tracked `package.json` keeps the registry pin for `slateboxjs`. Do not switch
it to a `file:` dependency: a copied local build goes stale and is easy to
confuse with a published one. To try local engine changes, build
`../slateboxjs-v2` and link it for your own run only; never commit the link.

## Tests

- Run the tests for what you changed before you open a pull request (library
  `npm test` + `npm run test:e2e`, app `npm run test:port-container` when the
  change is risky).
- A failing test is fixed in the code, or in the test only when the test
  itself is wrong. Never loosen a test to make it pass.

## Meteor 3.6

- `web/app/package.json` sets `meteor.modern: false`. Meteor 3.6 turns the modern build stack on
  (SWC transpiler, `@swc/helpers` imports) when it is unset; 3.5 left it off. Turning it on is a
  separate change with its own client checks (the app's Babel plugin is not applied by SWC).
- Live updates: `packages.mongo.reactivity` is `["changeStreams","polling"]`. With
  `MONGO_OPLOG_URL` set, Meteor still opens an oplog tail per server whatever the order says.
- `settings.metrics.methodTiming: true` logs one `[method-timing]` line per 5-minute window
  (server/metrics, from Meteor's `instrumentation` package).

## Settings

No settings file with real values is tracked. Copy
`web/app/settings.example.json` to `web/app/settings.dev.json` (git-ignored)
and fill in the keys you need. Deployed apps read `METEOR_SETTINGS`.

## Dev commands

- Library gates: `cd ../slateboxjs-v2 && npm test && npm run build`.
- Paired real-host gate: `npm run test:port-container` (disposable Meteor 3.6.1
  image + Mongo replica + two-client suite; also `SLATEBOX_LIBRARY_SOURCE=registry`).
