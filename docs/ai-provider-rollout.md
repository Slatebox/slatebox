# AI provider rollout

Slatebox promotes an AI feature to DeepInfra only after its live, feature-level
gate passes and the deployed app completes an end-to-end browser check. Provider
telemetry stores provider, model, status, latency, response status, token usage,
and bounded error metadata. It does not store prompts or model responses.

## Current defaults

| Feature | Primary | Fallback | Evidence |
| --- | --- | --- | --- |
| Presentation planning | DeepInfra DeepSeek V3 | Anthropic Claude 3.5 Sonnet | Tool schema and live anonymous presentation generation, refresh, and playback passed on test. |
| Welcome chat | DeepInfra Qwen3-235B Instruct | DeepInfra DeepSeek V3.1 Terminus | Production-sized browser traffic exposed V3.2 setIntention timeouts. Qwen then passed three complete routing, tool-shape, instruction-length, latency, and bounded-retry gate runs. |
| Automatic layout | Anthropic Claude 3.5 Sonnet | None | DeepSeek V3 and V3.2 each left two collisions in the live layout gate, so promotion is blocked on quality. |

Welcome is the only feature that opts into provider-normalized plain-text
responses. Its tool calls remain strict JSON, and `setIntention` additionally
requires a 150-word downstream brief with at most two same-provider retries.
All structured generation paths continue to reject and retry invalid JSON.

## Re-run the live gates

From `web/app`, load the untracked local DeepInfra environment file without
printing it:

```sh
node --env-file=settings.local.json scripts/eval-deepinfra-presentation.mjs
DEEPINFRA_MODEL=Qwen/Qwen3-235B-A22B-Instruct-2507 \
  node --env-file=settings.local.json scripts/eval-deepinfra-welcome.mjs
DEEPINFRA_MODEL=deepseek-ai/DeepSeek-V3.2 \
  node --env-file=settings.local.json scripts/eval-deepinfra-layout.mjs
```

Do not promote a feature from a single lucky response. Require at least three
consecutive complete gate passes, then verify the real workflow in the anonymous
test browser and confirm a privacy-safe success record in `aiAudit`. A failed
gate keeps the current primary provider in place.
