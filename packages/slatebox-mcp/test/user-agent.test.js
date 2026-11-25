// Every API call the package makes names it (slatebox-mcp/<version>), so the server can count
// calls per client; the caller's own headers still win.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { USER_AGENT, sendCall } from "../src/client/index.js";
import { loadGenerated } from "../src/generated.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const generated = loadGenerated(new URL("../generated/", import.meta.url));

test("sendCall names the package and version in User-Agent", async () => {
  assert.equal(USER_AGENT, `slatebox-mcp/${version}`);
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.headers);
    return new Response(JSON.stringify({ shareId: "demo", revision: 1 }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const method = generated.methods.get("slates.get");
  const result = await sendCall({ baseUrl: "https://example.test", token: "t", fetchImpl, method, input: { shareId: "demo" } });
  assert.equal(result.ok, true);
  assert.equal(seen[0]["user-agent"], USER_AGENT);
  assert.equal(seen[0].authorization, "Bearer t");
  await sendCall({ baseUrl: "https://example.test", token: "t", fetchImpl, method, input: { shareId: "demo" }, headers: { "user-agent": "mine/1" } });
  assert.equal(seen[1]["user-agent"], "mine/1");
});
