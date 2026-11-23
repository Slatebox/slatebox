// The library and the rulebook over exec: components.list equals the panel's cards one for one,
// check_move answers with the drag's verdict, and add_rule travels through workshop_edits.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { makeExecWorld } from "./exec-test-world.mjs";
import "slateboxjs/workshops/behaviour";
import { listedEntries } from "../web/app/imports/api/common/library.mjs";
import { EXEC_LIMITS } from "../web/app/server/exec/limits.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const team = () => ({
  version: 1, title: "Team board",
  lanes: [{ id: "todo", label: "To do" }, { id: "doing", label: "Doing" }, { id: "review", label: "Review" }, { id: "done", label: "Done" }],
  cards: [{ id: "billing", label: "Billing", laneId: "todo" }, { id: "search", label: "Search", laneId: "doing" },
    { id: "export", label: "Export", laneId: "review" }, { id: "auth", label: "Auth", laneId: "review" }],
  behaviour: { version: 1, rev: 1, rules: [{ id: "rule-1", kind: "capacity", where: "review", max: 2, on: true, severity: "refuse",
    set: { by: "Tim", at: "2026-11-21T10:00:00.000Z", via: "chat" } }] },
});

async function setup(t) {
  const world = makeExecWorld();
  t.after(() => world.close());
  world.slates.push({
    _id: "slate-7", shareId: "team", userId: "owner", lastSaved: 1000, options: { name: "Team", isPrivate: true }, nodes: [],
    creative: { revision: 1, model: { version: 1, kind: "workshop", workshop: team() } },
  });
  const principal = await world.principalFor(["slates:read", "slates:write"]);
  const gate = world.exec.gate;
  const context = () => gate.newContext({ execId: uuid(), principal, surface: "api", codeSha256: sha("code"), intent: "test" });
  return { world, gate, context };
}

test("components.list is the panel's cards, one for one, and says what fits this slate", async (t) => {
  const { gate, context } = await setup(t);
  const out = await gate.call(context(), { seq: 1, method: "components.list", input: { shareId: "team" } });
  assert.equal(out.ok, true, JSON.stringify(out.error));
  assert.deepEqual(out.value.components.map((entry) => entry.id), listedEntries().map((entry) => entry.id));
  const retro = out.value.components.find((entry) => entry.id === "retro");
  assert.equal(retro.add, "Add a retro");
  assert.ok(retro.edits.some((edit) => edit.kind === "add_rule" && /rule/i.test(edit.summary)));
  // Many boards on a slate (boards S4a): a slate that has a board takes another beside it.
  assert.deepEqual(retro.fits, { ok: true });
  const bare = await gate.call(context(), { seq: 2, method: "components.list", input: {} });
  assert.equal(bare.value.components[0].fits, undefined);
});

test("a plain components.list through exec comes back whole, under the result cap; components.get has the details", async (t) => {
  const { world, gate, context } = await setup(t);
  const principal = await world.principalFor(["slates:read"]);
  const out = await world.exec.service.run({ principal, intent: "Library", code: `return slatebox.components.list({ shareId: "team" })` });
  assert.equal(out.status, "completed", JSON.stringify(out.error));
  assert.equal(out.truncated, undefined, "the library is not cut at exec's result cap");
  assert.equal(typeof out.result, "object");
  assert.deepEqual(out.result.components.map((entry) => entry.id), listedEntries().map((entry) => entry.id));
  // room to grow: the list leaves a quarter of the cap for new entries
  assert.ok(JSON.stringify(out.result).length < EXEC_LIMITS.resultChars * 0.75, String(JSON.stringify(out.result).length));
  for (const entry of listedEntries()) {
    const one = await gate.call(context(), { seq: 1, method: "components.get", input: { id: entry.id, shareId: "team" } });
    assert.equal(one.ok, true, JSON.stringify(one.error));
    const listed = out.result.components.find((item) => item.id === entry.id);
    assert.deepEqual({ ...one.value.component, moves: undefined, loop: { ...one.value.component.loop, steps: undefined } },
      { ...listed, moves: undefined, loop: { ...listed.loop, steps: undefined } }, entry.id);
    assert.ok(Array.isArray(one.value.component.moves) && Array.isArray(one.value.component.loop.steps), entry.id);
  }
  const missing = await gate.call(context(), { seq: 2, method: "components.get", input: { id: "nope" } });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "not_found");
});

test("check_move gives the drag's verdict, read-only: the one rule, who set it, the nearest lane", async (t) => {
  const { world, gate, context } = await setup(t);
  const out = await gate.call(context(), { seq: 1, method: "slates.checkMove", input: { shareId: "team", card: "Search", lane: "Review" } });
  assert.equal(out.ok, true, JSON.stringify(out.error));
  assert.deepEqual(out.value, { revision: 1, rev: 1, refused: { sentence: "Review holds 2. It has 2.", ruleId: "rule-1", nearest: "Done",
    set: { by: "Tim", at: "2026-11-21T10:00:00.000Z", via: "chat" } } });
  const fine = await gate.call(context(), { seq: 2, method: "slates.checkMove", input: { shareId: "team", card: "billing", lane: "Doing" } });
  assert.deepEqual(fine.value, { revision: 1, rev: 1, ok: true, warnings: [] });
  assert.equal(world.slate("team").creative.revision, 1);
});

test("add_rule travels through workshop_edits: the rule moves nothing, bumps rev, and the next move obeys it", async (t) => {
  const { world, gate, context } = await setup(t);
  const edit = (edits, seq) => gate.call(context(), { seq, method: "slates.applyOperations", input: { shareId: "team",
    plan: { message: "Rules", operations: [{ kind: "workshop_edits", edits, expectedRevision: world.slate("team").creative.revision }] } } });
  const out = await edit([{ kind: "add_rule", rule: { kind: "path", from: "any", noSkip: true } }], 1);
  assert.equal(out.ok, true, JSON.stringify(out.error));
  const board = world.slate("team").creative.model.workshop;
  assert.equal(board.behaviour.rev, 2);
  assert.equal(board.behaviour.rules[1].set.via, "exec");
  const skip = await edit([{ kind: "move_card", card: "Billing", lane: "Done" }], 2);
  assert.equal(skip.ok, false);
  assert.match(JSON.stringify(skip.error), /Cards move one lane at a time\. Billing is in To do, so Doing comes first\./);
});
