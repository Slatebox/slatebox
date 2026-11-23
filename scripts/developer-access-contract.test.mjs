import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL(
    "../web/app/imports/ui/components/profile/DeveloperAccess.jsx",
    import.meta.url,
  ),
  "utf8",
);

test("developer access documents MCP and authenticated HTTP parity", () => {
  // Restated (P08): the install line, the API address and the OpenAPI address come from the
  // instance's own description (instance.describe), not from strings in the tab.
  assert.match(source, /\{instance\.connect\.mcp\}/);
  assert.match(source, /href=\{instance\.connect\.guide\}/);
  assert.match(source, /Authorization: Bearer <token>/);
  assert.match(source, /Idempotency-Key: <unique-request-id>/);
  assert.match(source, /\$\{instance\.api\.base\}\/slates\/<share-id>\/operations/);
  // Restated (P02): the registry's write mode replaced dryRun on every write.
  assert.match(source, /"mode":"preview"/);
  // Release/agentic: every edit names the revision it was made on (the read's revision).
  assert.match(source, /"expectedRevision":<revision>/);
  assert.doesNotMatch(source, /dryRun/);
  assert.match(source, /\{instance\.api\.openapi\}/);
  assert.doesNotMatch(source, /slatebox-mcp --base-url|Meteor\.settings\.public\.baseUrl/);
});

test("the Developer tab shows the base address, contract version and install line from the descriptor", () => {
  assert.match(source, /Meteor\.callAsync\(CONSTANTS\.methods\.instance\.describe\)/);
  assert.match(source, /\{instance\.api\.base\}/);
  assert.match(source, /\{instance\.contract\.version\}/);
});

test("the token list is read from the registry action's answer", () => {
  assert.match(source, /\(await Meteor\.callAsync\(CONSTANTS\.methods\.apiTokens\.list\)\)\.tokens/);
});

test("new API secrets are explicitly one-time and copyable", () => {
  assert.match(source, /Copy this token now/);
  assert.match(source, /will not show the complete token again/);
  assert.match(source, /navigator\.clipboard\.writeText\(newToken\)/);
});
