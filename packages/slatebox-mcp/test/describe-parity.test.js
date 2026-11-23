// The package's describe is a port of the app's describeClient (the hosted /mcp describe):
// for the same input both answer the same, so an agent learns the same client either way.
import assert from "node:assert/strict";
import test from "node:test";
import { describe as describeLocal, describeClient } from "../src/describe.js";
import { defaultGenerated } from "../src/generated.js";

const { describeClient: describeHosted } = await import(new URL("../../../web/app/server/actions/client-render.mjs", import.meta.url));
const generated = defaultGenerated();

test("local describe answers exactly as the hosted describe does", async () => {
  for (const input of [{}, { methods: ["slates.applyOperations"] }, { methods: ["slates.get", "slates.create"] },
    { query: "invitation" }, { query: "preview save" }, { query: "nothing-matches" }, { methods: ["apiTokens.create"] }]) {
    assert.deepEqual(await describeLocal(input, { generated }), describeHosted(generated.manifest, input), JSON.stringify(input));
    assert.deepEqual(describeClient(generated.manifest, input), describeHosted(generated.manifest, input));
  }
});

test("describe refuses input its schema does not allow", async () => {
  for (const input of [{ extra: 1 }, { query: 3 }, { query: "x".repeat(201) }, { methods: "slates.get" }, { methods: Array(13).fill("slates.get") }]) {
    await assert.rejects(() => describeLocal(input, { generated }), (e) => e.code === "invalid_request", JSON.stringify(input));
  }
});
