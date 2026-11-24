# The meter

Slatebox is free and open source, with no guest limits. Only two things cost money each time they are used, so only they are metered:

- **AI** (drafts, chat turns, welcome turns, presentation passes, generated images, image search), counted in dollars from the token counts `req.js` already writes to `AIAudit`.
- **Calls on Daily**, counted in participant-minutes and charged to the person who started the call.

Whoever starts a call or makes an AI request pays, in this order: their own key (or their team's; self-hosted Slatebox only), then the included amount, then a balance (theirs, then their team's). Guests and people who join a call never pay.

Own AI and call keys are a self-hosted feature (`imports/api/common/own-keys.mjs`: `public.env` `selfhost` only). On Slatebox Cloud (every other env) nobody brings their own key: `keys.save` and personal or team AI connections are refused with one sentence (`OWN_KEYS_CLOUD`), the meter never routes to a key saved before (`settings.ownKeys` false, `ai-settings-core.mjs` own providers off and locked), Credits, the AI tab and team settings show no own keys, and every refusal and pay-sheet answer leaves them out (`COPY` is Cloud's words, `OWN_KEY_COPY` a self-hosted meter's). Keys saved before stay stored, unused; their owner can still remove them.

The included amount ("Pro credits") is sized by one number, `free.creditCostMicrosPerMonth`: what full use may cost Slatebox in provider fees per person a month, $3.75 by default, so that full use never costs more than Pro brings in, even yearly Pro on an international card with currency conversion and tax on top (`scripts/stripe-catalog.test.mjs`). `sizeCredits` shares it out (AI 25%, voice 37.5%, video 37.5%): 30 drafts a day within about $0.94 of AI a month, 1,380 voice and 330 video participant-minutes (about 180 drafts, about 5½ hours of four-person voice and about 1 hour of four-person video, as separate allowances), with $0.50 a day per person. `proCreditsInWords` says the same in plain words for the profile, and `scripts/pro-credits.mjs` writes the same figures as `pro-credits.json`, the file the site and the docs copy and test against. Credits count per calendar month (UTC); the month Pro starts in, and the month it ends in once it will not renew, gives only the share of the month Pro covers (`monthShare`, `proCreditShare`), so buying on the 30th never brings two months of credits for one payment. Whether it needs **Slatebox Pro** ($5 a month or $50 a year plus tax where applicable, `server/pro-billing.mjs`) is `free.proRequiredFrom`: `'now'` on Slatebox Cloud (from 2026-11-22), `'never'` by default and on every self-hosted meter (self-host has no Pro), or a moment in ms. Without Pro where it is needed: included AI, image search and image generation and starting a call are refused with a clear message (`pro`, `pro-images`, `pro-calls`, `pro-past-due`) unless a balance pays; joining a call stays free; the free presentation plan stays at the guest caps (`guestPresentationsPerDay: 0` turns it off). Pro credits are never paused by the shared budget's stages; each person's day and month caps still hold. A self-hosted meter keeps `proRequiredFrom` at `'never'`, so the amount there is everyone's and Pro is not sold.

## Files

| File | What it holds |
|---|---|
| `prices.mjs` | Price table (source and read date per row), estimates, per-request ceilings. The operator adds or reprices models in `settings.metering.prices` (`[{ model, inPerMillion, outPerMillion }]`, checked at start). An unknown model is priced at the dearest row. |
| `policy.mjs` | The included amounts (`sizeCredits`, `resolveMetering`), the Pro switch, the route decision, budget stages, the daily ceilings, the summary people see. |
| `context.mjs` | `runAIAction` (AsyncLocalStorage). `req.js` refuses to send anything when the meter is on and no action is running, or after it ended. Work a request starts without waiting (`keepActionOpen`) keeps it open. Attempts that got no usage back are charged the feature estimate. |
| `meter-core.mjs` | The meter itself: route, hold, record, release. Tests run it with an in-memory store. |
| `holds.mjs` | Before a request is sent, its most possible spend is set aside with conditional updates (person's day and month, the global month up to 110%, or the wallet), so parallel requests cannot pass a cap. |
| `limits.mjs` | Per-person and per-address rate limits on every metered method. The per-person rule counts signed-in people only; the per-address rule never counts a Cloudflare edge address or a private one (the cluster's own: the ingress, a node, a pod). |
| `client-address.mjs` | The caller's address behind Cloudflare and the ingress (walks X-Forwarded-For left past Cloudflare's own ranges). `meteor.js` sets it on each connection. |
| `refusal-notice.mjs` | The meter's refusal goes into a slate's chat only for a signed-in caller who may change that saved slate. |
| `own-endpoint.mjs` | A person's own model endpoint: public https only, checked on save and on every connection. |
| `record.mjs` | One metered use: event (unique `ref`), counters, wallet debit. |
| `ledger.mjs` | Wallet arithmetic: balance never below zero, what can go back to a card, top-up limits, card fee, refund plan. |
| `calls.mjs` | Room per call, tokens, the 60-second tick (charge, extend, move to voice, end). Transcription (Slatebox's Deepgram key) only on unmetered operator calls: never on an own Daily key, and not on metered calls until it is priced. |
| `vault.mjs` | AES-256-GCM for own keys, bound to owner and provider. Master key from `SLATEBOX_KEY_ENCRYPTION_KEY` (32 bytes, base64). |
| `migrations.mjs` | M1 (indexes and the settings document, at startup), M3 (field cleanup, owner-run) and M4 (Slatebox Pro indexes, at startup; no data change). |
| `meteor.js` | Meteor glue: settings, methods (`meter.*`, `keys.*`), the tick runner lease, alerts. |
| `../methods/wallet.js`, `../wallet-stripe.mjs` | Top-ups (Stripe Checkout, one-time), refunds, charges, webhook events. |
| `../methods/pro.js`, `../pro-billing.mjs` | Slatebox Pro: checkout (subscription, Stripe Tax on top, no trial), customer portal, the webhook's Pro events (state read fresh from Stripe, guarded by `fetchedAt`). Prices by lookup_key from `imports/api/pro/catalog.mjs`; Stripe objects made by `scripts/stripe-catalog.mjs` (Pro only). Slatebox Business (`imports/api/business/catalog.mjs`, per person inside Cloud) is `../methods/business.js` and `../business-billing.mjs`: a team owner or admin buys it on the team page at the two Stripe prices `settings.payments.business.monthly` / `.yearly` name (quantity = the team's members, prorated as members change); the webhook writes `organizations.business` from the subscription; a staff-written contract is never overwritten. Without both price ids it is sold by talking to us (`BUSINESS_CONTACT_URL`). |

## Settings

`Meteor.settings.metering.enabled === true` turns the meter on (Cloud). It is read once at startup and fails closed: with `public.env` `prod` the server does not start unless it is `true`; with any other env, including a missing or misspelled one, it must be `true` or `false`. Only `selfhost` and `dev` may leave it out, and then run with no meter: the operator's AI provider and Daily key are used with no limits. The numbers are resolved by `resolveMetering` in `policy.mjs`: the defaults (`DEFAULT_METERING`), then the deploy settings `metering.proRequiredFrom` (`"now"`, `"never"` or `"YYYY-MM-DD"`) and `metering.creditCostMicrosPerMonth` (checked at start: a wrong value stops it), then `SystemSettings` `_id: 'metering'` (created by M1), which admins change from **Admin → Budget and Pro** (the monthly budget, the hold, when Pro is needed, and what Pro credits may cost a month). Slatebox Cloud's settings carry `"metering": {"enabled": true, "proRequiredFrom": "now"}`; self-host leaves `proRequiredFrom` out.

Defaults: Pro credits sized to $3.75 a month (30 AI drafts a day with a $0.9375 monthly AI ceiling, 1,380 voice and 330 video participant-minutes a month), $0.50 a day per person for AI and call starts, a $1,000 monthly free budget with stages at 50/70/90/100/110% and a daily ceiling of P/20, top-ups at cost plus 5%.

Other settings: `googleImageSearch.{apiKey,engineKey}` (private; Google closes the API on 2027-01-01), `stripe.apiBase` and `daily.apiBase` (local stubs), `stripe.proPortalConfiguration` (optional `bpc_…`, else the account's default portal), `metering.alertEmail`, and in development only `ai.stubEndpoint`.

## Slatebox Pro (owner, 2026-11-22)

1. The lead runs `STRIPE_SECRET_KEY=… node scripts/stripe-catalog.mjs --dry-run --live` with the live key (Slatebox Pro and its portal: product `slatebox_pro`, prices `pro_monthly_usd_500` and `pro_yearly_usd_5000`, tax-exclusive), shows the owner the plan, then runs it again without `--dry-run`. Without a key nothing runs, not even the dry run. Slatebox Business is not in the catalogue script: the owner makes its product and two prices in Stripe by hand and puts their ids in `settings.payments.business`; nothing else is created.
2. In the Stripe dashboard, check every line of the run's `dashboardChecks` (the script cannot set them, and the terms rely on them): failed payments **cancel** the subscription after the last retry (not "mark as unpaid"), upcoming-renewal emails are on for yearly Pro, failed-payment emails link to the portal, Stripe Tax is on, the webhook receives the subscription, invoice, checkout, refund and dispute events. If a subscription is ever left `unpaid` anyway, the app treats it as still held (no second checkout; a second subscription is cancelled as a duplicate).
3. Switch now (owner, 2026-11-22: no users yet, no notice period, no trial): set `"proRequiredFrom": "now"` in Cloud's deploy settings (`metering`) with the app release. Pro goes on sale at once (`proOnSale`) and is paid from the first day. Then switch on the site's and the docs' `pro-checkout`, so "Get Slatebox Pro" never leads to a Credits tab with no Pro on it.

Pro credits are spent on the global keys as `proMicros` (and held as `heldProMicros`), never as the `freeMicros` and `heldMicros` the shared budget's stages, daily rule and alerts read: paying people's use never pauses free use. **Admin → Budget and Pro** shows Pro credits spent beside the shared budget. Only paying people skip the stages: live Pro where Pro is needed.

Account removal: the balance is refunded first, then Pro is ended (no refund of the current period), then the account is removed. A failed refund leaves Pro on and removes nothing.

A dispute hold belongs to the subscription it was raised on: a later subscription (bought again after a lost dispute) starts without it.

## Switch day (owner, 2026-11-20)

Every Stripe subscription was cancelled on 2026-11-20, with no refund and nothing carried into a balance. Balances come only from top-ups.

1. **Staging:** deploy to test with `metering.enabled: true` in `TEST_METEOR_SETTINGS` (the server does not start without the key), `SLATEBOX_KEY_ENCRYPTION_KEY` in the environment, `googleImageSearch` keys and Stripe **test** keys. Check the Daily behaviours below, one recorded DeepInfra response (`estimated_cost`), and a browser pass of Profile → Credits, top-up, refund, own keys, Admin → Budget and Pro, the camera warning and the call notices.
2. **Production settings:** add `"metering": {"enabled": true}` and the `googleImageSearch` keys to `PROD_METEOR_SETTINGS`, and `SLATEBOX_KEY_ENCRYPTION_KEY` (32 random bytes, base64) to the environment. Production refuses to start without the meter.
3. **Ship.** A Stripe subscription or invoice event for a product other than Slatebox Pro sends an alert to admins.
4. **Cleanup:** `node web/app/scripts/pricing-cleanup.mjs --mongo <url>` (dry run: counts the people and teams that still carry plan or subscription fields), then `--apply` (removes those fields, drops `pricingTiers` and the old `aiCreditUsage` setting; keeps `customerId`). Then remove `PricingTiers` from `models.js`.

## Behind Cloudflare

Per-address limits need the caller's address. `HTTP_FORWARDED_COUNT=1` makes the ingress's own X-Forwarded-For entry the trusted one, and `client-address.mjs` walks left past Cloudflare's ranges to the visitor. That only works if the ingress keeps the entry Cloudflare sends: configure the ingress to trust X-Forwarded-For from Cloudflare's ranges (Traefik `forwardedHeaders.trustedIPs`). Until then the only address seen is Cloudflare's or the ingress's own private one, and the per-address rules skip both (per-person limits, the confirmed-address rule and the caps still apply), so guests behind the ingress are never put in one count.

## Daily behaviour to confirm on the first test-cluster deploy

The presence endpoint's shape; that updating a live room's `exp` moves `eject_at_room_exp`; `max_participants`; `eject_after_elapsed`; the `/meetings` usage endpoint for an end-of-call reconciliation. If any differs, only `calls.mjs` and `dailyClient` change.
