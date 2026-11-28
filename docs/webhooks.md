# Recipe webhooks

Recipes (see [recipes.md](recipes.md)) talk to your own systems three ways:

| Kind | Direction | Use it to |
|---|---|---|
| Outbound | Slatebox → you | Hear about runs, changed slates and diagrams, approvals and the recipe's own events (a new dependency, a slipped date). |
| Inbound | you → Slatebox | Run a recipe with your data: a dependency graph from CI, a board from your tracker. |
| Intercept | Slatebox → you → Slatebox, during a run | Narrow what a run does: drop or add graph items, add legend notes, approve or veto a change outside Slatebox. |

Add them on the recipe's Webhooks tab, or with `recipes.hooks.add`. The secret (`whsec_…`) is
shown once. Code: `enterprise/server/recipes/webhooks/`.

## Signatures

Every body Slatebox sends, and every inbound body you send, is signed the same way:

```
Slatebox-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + body)>[,v1=<old secret's>]
Slatebox-Event: run.finished
Slatebox-Delivery: evt_…           (unique per delivery: dedupe on it)
```

A signature older than 5 minutes is refused. After `recipes.hooks.rotate`, the old secret keeps
signing beside the new one (a second `v1`) for 24 hours.

**Node**

```js
import { createHmac, timingSafeEqual } from 'node:crypto'
export function verify(header, body, secret, now = Date.now()) {
  const t = /(?:^|,)t=(\d+)/.exec(header)?.[1]
  const sigs = [...header.matchAll(/v1=([0-9a-f]{64})/g)].map((m) => m[1])
  if (!t || Math.abs(now / 1000 - Number(t)) > 300) return false
  const want = createHmac('sha256', secret).update(`${t}.${body}`).digest()
  return sigs.some((s) => timingSafeEqual(Buffer.from(s, 'hex'), want))
}
```

**Python**

```python
import hmac, hashlib, re, time
def verify(header: str, body: bytes, secret: str) -> bool:
    t = re.search(r'(?:^|,)t=(\d+)', header)
    if not t or abs(time.time() - int(t.group(1))) > 300:
        return False
    want = hmac.new(secret.encode(), t.group(1).encode() + b'.' + body, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(want, s) for s in re.findall(r'v1=([0-9a-f]{64})', header))
```

**Go**

```go
func Verify(header string, body []byte, secret string) bool {
	t := regexp.MustCompile(`(?:^|,)t=(\d+)`).FindStringSubmatch(header)
	if t == nil { return false }
	ts, _ := strconv.ParseInt(t[1], 10, 64)
	if d := time.Now().Unix() - ts; d > 300 || d < -300 { return false }
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(t[1] + "."))
	mac.Write(body)
	want := mac.Sum(nil)
	for _, m := range regexp.MustCompile(`v1=([0-9a-f]{64})`).FindAllStringSubmatch(header, -1) {
		got, _ := hex.DecodeString(m[1])
		if hmac.Equal(got, want) { return true }
	}
	return false
}
```

Verify against the raw bytes you received, before parsing JSON.

## Outbound

A hook sits on one recipe, or on a whole project (every recipe in it). Its URL must be https and a
public address. Pick events, or leave the list empty for all of them.

**Envelope**

```json
{
  "id": "evt_3vo9cgzwzjc",
  "type": "slate.updated",
  "at": "2026-11-28T01:29:57.477Z",
  "project": { "id": "c4fpe69CRrXCEEjNP" },
  "instance": { "id": "C6PxdBf7mGb6fvZ3t", "recipeId": "github-architecture", "name": "Living architecture · acme/platform" },
  "run": { "id": "…", "trigger": { "kind": "vendor" } },
  "data": { "slateId": "…", "shareId": "9cf958e952", "url": "https://…/canvas/9cf958e952", "added": 1, "updated": 1, "removed": 0 }
}
```

**Events every recipe sends**

| Event | Data |
|---|---|
| `run.started` | — |
| `run.finished` | `state`, `durationMs`, `stats`, `slatesChanged` |
| `run.failed` | `name`, `status`, `code` (never a message or content) |
| `slate.updated` | `slateId`, `shareId`, `url`, `added`, `updated`, `removed` |
| `diagram.changed` | `slateId`, `shareId`, `before`, `after` (content hashes), `mermaidUrl` |
| `approval.needed` | `cardId`, `kind`, `target`, `url` |
| `writeback.done`, `writeback.declined` | the change's kind and target |
| `recipe.paused`, `recipe.resumed` | `reason`, `by` |

**Each recipe's own events** (data is flat: names, numbers and lists of them; never the words of
your messages or files):

| Recipe | Events |
|---|---|
| Living architecture | `architecture.updated` (`repo`, `sha`, `modulesAdded`, `edgesAdded`, `servicesAdded`, `endpointsAdded`, `…Removed`), `architecture.new_dependency` (`repo`, `from`, `to`), `architecture.cycle_detected`, `architecture.renamed` |
| Pull request impact | `pr_impact.ready` (`repo`, `number`, `headSha`, counts), `pr_impact.new_dependency`, `pr_impact.service_changed` |
| Decision log | `decision.recorded`, `decision.revisited`, `decision.reversed` |
| Project timeline | `timeline.date_changed`, `timeline.slipped`, `timeline.done` |
| Concept map | `concepts.updated` |
| Weekly digest | `digest.published` |
| Sheet board | `sheet.synced`, `sheet.writeback.done` |
| Design doc | `design_doc.updated`, `design_doc.drift` |
| Render from a webhook | `webhook.rendered` |

**Delivery**

- A 2xx answer within 10 seconds is delivered. Anything else is retried after 1 min, 5 min, 30 min,
  2 h, 6 h and 24 h. After 8 failures in a row the hook is turned off and its owner told.
- At least once: dedupe on `Slatebox-Delivery`.
- `recipes.deliveries` lists the last 14 days (event, attempt, status code, time).
  `recipes.hooks.test` sends a signed `ping` now.

## Inbound

An inbound hook belongs to one recipe that takes data (its manifest's `inputSchema`, such as
Render from a webhook or Living architecture). Its address is `POST /hooks/recipes/<hookId>`.

```sh
BODY='{"reason":"CI build 812","data":{"key":"deps","graph":{"nodes":[{"key":"web","label":"web"},{"key":"api","label":"api"}],"edges":[{"from":"web","to":"api"}]}}}'
T=$(date +%s)
SIG=$(printf '%s.%s' "$T" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/.* //')
curl -X POST "$SLATEBOX/hooks/recipes/$HOOK_ID" \
  -H 'Content-Type: application/json' \
  -H "Slatebox-Signature: t=$T,v1=$SIG" -H "Slatebox-Delivery: ci-812" \
  -d "$BODY"
# 202 {"runId":"…"}      the run is queued
# 200 {"duplicate":true}  the same Slatebox-Delivery, or the same signed request sent again, within an hour
# 400 bad_payload         with a JSON pointer to what does not match the recipe's inputSchema
# 401 bad_signature       413 over 256 KB       429 over 30 runs an hour (Retry-After)
```

With an API token instead of a hook secret: `POST /api/v1/recipes/{instanceId}/run` with
`{ reason?, data? }` (scope `recipes:run`).

**In a GitHub Actions step**

```yaml
- name: Send the dependency graph to Slatebox
  run: |
    BODY=$(node scripts/deps-graph.mjs)   # {"data":{"key":"deps","graph":{...}}}
    T=$(date +%s)
    SIG=$(printf '%s.%s' "$T" "$BODY" | openssl dgst -sha256 -hmac "${{ secrets.SLATEBOX_HOOK_SECRET }}" -hex | sed 's/.* //')
    curl -fsS -X POST "${{ vars.SLATEBOX_HOOK_URL }}" -H 'Content-Type: application/json' \
      -H "Slatebox-Signature: t=$T,v1=$SIG" -H "Slatebox-Delivery: gh-${{ github.run_id }}" -d "$BODY"
```

## Intercepts

An intercept is called during a run at one point, with the same envelope and signature, and has
5 seconds to answer. Its answer can only narrow what the run does.

| Point | You answer | Limits |
|---|---|---|
| `graph.ready` | `{ add, update, drop }` graph items | Only inside the recipe's own slates; ids still come from keys |
| `output.ready` | `{ notes: [{ key, text, link? }] }` | At most 12 notes, in the legend |
| `writeback.proposed` | `{ decision: 'approve' \| 'veto' \| 'defer', body? }` | Never wider than the permission the owner granted; `body` is used only from a hook the recipe's owner added |

`failMode: 'open'` (the default) carries on without you when you do not answer; `'closed'` skips
the run (`skipped: hook_failed`).

A hook works only while the person who added it may still add it: on a recipe, the person it runs
for or a manager of its project; on a project, a manager. Someone unshared or lowered keeps no hook
that hears, feeds or steps into the project's runs. A hook's full address is shown only to the
person who added it and the project's managers; others see its host.

## Vendor webhooks Slatebox receives

| Path | From | Checked by |
|---|---|---|
| `/integrations/github/events` | The Slatebox GitHub App: push, pull_request, installation, installation_repositories | `X-Hub-Signature-256` over the raw body; `X-GitHub-Delivery` handled once |
| `/integrations/slack/events` | Slack's Events API (messages in channels a recipe reads) | Slack's signing secret |
| `/integrations/google/watch` | Google Drive push channels | A per-channel token Slatebox sets |

Raw bodies on these paths are kept for the signature check (`web/app/server/raw-body-paths.mjs`).
