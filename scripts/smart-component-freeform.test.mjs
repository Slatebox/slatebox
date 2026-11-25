// A smart component described instead of picked (owner report 2026-11-25, test.slatebox.com): "snappable congruent
// pieces to compose new printable materials" typed on a builder slate went to the drawing path, whose plan was refused
// and which could never have made a board anyway. Now a description that matches no shape, catalogue board or other
// request is a board of lanes (its pieces are cards, its rules a rulebook): drafted by the agent when one may draft,
// started from the words when not, or when the draft is no board. Either way the builder can save it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import "slateboxjs/workshops/behaviour";
import { rulebook, validateWorkshop } from "slateboxjs/workshops/model";
import { catalogSamples as samples } from "slateboxjs/workshops/samples";
import "../web/app/imports/api/common/library.mjs";
import { nativeCanvasDraft } from "../web/app/imports/api/common/native-canvas-conversation.mjs";
import { builderBoard, builderBrief, builderDescription, builderSaid, builderTitle, componentStarter, pieceNoun } from "../web/app/imports/api/common/builder-freeform.mjs";
import { componentPlacing } from "../web/app/imports/api/common/component-add.mjs";
import { keptReply } from "../web/app/imports/api/common/chat-words.mjs";
import { BUILD_SHAPES } from "../web/app/imports/ui/components/library/build/buildTurns.mjs";
import { authorTool } from "../web/app/server/methods/workshop-lane-draft.mjs";
import { makeExecWorld } from "./exec-test-world.mjs";
import { principalFromUser } from "../web/app/server/actions/principal.mjs";
import { API_TOKEN_SCOPES } from "../web/app/server/api-token-core.mjs";

const OWNER = "snappable congruent pieces to compose new printable materials";
const REQ = "B".repeat(17);
const NOW = new Date("2026-11-25T23:18:01Z");
const builder = (extra = {}) => ({ shareId: "build1", library: { mode: "build" }, nodes: [], options: {}, ...extra });
const app = (path) => readFileSync(new URL("../web/app/" + path, import.meta.url), "utf8");

test("on a builder slate with no board yet, a description is the component to build; anything else keeps its own path", () => {
  assert.equal(builderDescription(builder(), OWNER), true);
  assert.equal(builderDescription(builder(), "A board where ideas go in piles of five"), true);
  // Not a builder slate, or one that holds a board already (its own chat reshapes it): the drawing path, as before.
  assert.equal(builderDescription({ nodes: [] }, OWNER), false);
  assert.equal(builderDescription(builder({ creative: { model: { kind: "workshop" } } }), OWNER), false);
  // Every first-turn shape is read as the board it names, never as a description.
  for (const shape of BUILD_SHAPES) assert.equal(builderDescription(builder(), shape.message), false, shape.label);
  // A catalogue board, typed steps, notes asked for by name, a question and a word or two keep their own paths.
  for (const other of ["Add a retro", "Intake → Review → Ship", "add two notes", "add a note called Print it", "What can I build here?", "Pieces", "Make this interactive: Intake → Review"])
    assert.equal(builderDescription(builder(), other), false, other);
});

test("the page sends a description on a builder slate to the board path, and the server reads it the same way", () => {
  const page = app("imports/ui/components/NativeCanvasConversation.jsx");
  assert.match(page, /const methodsFor=\(message,board\)=>nativeRequestKind\(message\)==='draw' && !builderDescription\(board,message\) \? 'canvasConversation' : 'nativeCanvas'/);
  assert.match(page, /methodsFor\(message,board\)/);
  const server = app("server/methods/native-conversation.js");
  assert.match(server, /const freeform=asked==='draw' && builderDescription\(board,message\)/);
  assert.match(server, /builderBoard\(asked,message\)/);
  // A failed turn keeps the person's words: Edit request puts them back in the box.
  assert.match(page, /data-turn-next="edit"[^>]*onClick=\{\(\)=>\{setText\(turn\.message\)/);
});

test("with no agent, the owner's description starts a native board: pieces as cards, a kit, a place to compose, and drag rules", () => {
  const starter = validateWorkshop(componentStarter(OWNER, { now: NOW }));
  assert.equal(starter.title, "Snappable congruent pieces to compose new printable materials");
  assert.deepEqual(starter.lanes.map((lane) => lane.label), ["Kit", "Compose", "Ready to print"]);
  assert.deepEqual(starter.cards.map((card) => [card.label, card.laneId]), [["Piece A", "kit"], ["Piece B", "kit"], ["Piece C", "kit"], ["Piece D", "kit"]]);
  assert.deepEqual(starter.behaviour.rules.map((rule) => [rule.kind, rule.where ?? rule.from, rule.max ?? rule.noSkip]), [["capacity", "compose", 4], ["path", "any", true]]);
  assert.deepEqual(starter.behaviour.rules[0].set, { by: "Slatebox", at: "2026-11-25T23:18:01.000Z", via: "preset" });
  // Its rules are the rulebook's own sentences (the "How this board behaves" note), and the rules hold: a fifth piece
  // is refused in Compose, and a piece can't skip from Kit to Ready.
  const lines = rulebook().lines(starter);
  assert.equal(lines.length, 2);
  const moved = (board, cardId, laneId) => ({ ...board, cards: board.cards.map((card) => (card.id === cardId ? { ...card, laneId } : card)) });
  const full = { ...starter, cards: starter.cards.map((card) => ({ ...card, laneId: "compose" })).concat({ id: "piece-e", label: "Piece E", laneId: "kit" }) };
  assert.ok("refused" in rulebook().check(full, moved(full, "piece-e", "compose")), "a fifth piece in Compose");
  assert.ok("refused" in rulebook().check(starter, moved(starter, "piece-a", "ready")), "Kit straight to Ready");
  assert.ok(!("refused" in rulebook().check(starter, moved(starter, "piece-a", "compose"))), "Kit to Compose");
  // Other words: the noun they use for pieces, and a plain last lane when nothing is printed.
  assert.equal(pieceNoun("modular tiles for a floor plan"), "Tile");
  assert.equal(pieceNoun("a way to sort our hiring ideas"), "Piece");
  assert.equal(componentStarter("modular tiles for a floor plan").lanes.at(-1).label, "Ready");
  assert.equal(builderTitle("x ".repeat(60)).length <= 80, true);
});

test("the drafting agent gets the words framed as a component, within the draft's 1,200 characters", () => {
  const brief = builderBrief(OWNER);
  assert.match(brief, /^Build a reusable smart component people drag to use\. Its cards are the pieces people move;/);
  assert.ok(brief.endsWith("The component: " + OWNER));
  assert.ok(builderBrief("y".repeat(1200)).length <= 1200);
  // The lanes tool is the one the draft answers with: capacity and allowedLaneIds are its rules.
  assert.ok(authorTool.parameters.properties.lanes.items.properties.capacity);
  assert.ok(authorTool.parameters.properties.cards.items.properties.allowedLaneIds);
});

test("an agent's draft is used when it holds together as lanes; a broken or wrong-kind draft starts the board instead, never an error", () => {
  const drafted = {
    version: 1, title: "Snap-together printable kit",
    lanes: [{ id: "pieces", label: "Pieces" }, { id: "layout", label: "Layout", capacity: 6 }, { id: "print", label: "Print sheet", capacity: 1 }],
    cards: [
      { id: "square", label: "Square 1x1", laneId: "pieces", allowedLaneIds: ["pieces", "layout"] },
      { id: "bar", label: "Bar 1x2", laneId: "pieces" },
      { id: "corner", label: "Corner L", laneId: "pieces" },
      { id: "frame", label: "Page frame", laneId: "pieces", allowedLaneIds: ["pieces", "print"] },
    ],
  };
  const used = builderBoard(drafted, OWNER, { now: NOW });
  assert.equal(used.drafted, true);
  assert.equal(used.workshop.title, "Snap-together printable kit");
  for (const broken of [{ ...drafted, lanes: drafted.lanes.slice(0, 1) }, { version: 1, title: "x", lanes: "no" }, { ...drafted, kind: "pipeline" }, null]) {
    const made = builderBoard(broken, OWNER, { now: NOW });
    assert.equal(made.drafted, false);
    assert.deepEqual(made.workshop, validateWorkshop(componentStarter(OWNER, { now: NOW })));
  }
  assert.match(builderSaid(used.workshop, { drafted: true }), /^Drafted “Snap-together printable kit” from your description: Pieces, Layout and Print sheet, with 4 pieces to drag\./);
  assert.match(builderSaid(builderBoard(null, OWNER).workshop, { drafted: false }), /^Started “Snappable congruent pieces to compose new printable materials” from your description: Kit, Compose and Ready to print/);
});

test("the preview is a playable board of lanes (never loose notes), and Keep's reply says what was made", () => {
  for (const draft of [null, { version: 1, title: "Kit", lanes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], cards: [{ id: "c", label: "C", laneId: "a" }] }]) {
    const { workshop, drafted } = builderBoard(draft, OWNER, { now: NOW });
    const made = nativeCanvasDraft(builder(), OWNER, REQ, workshop, samples, { kind: "lanes" });
    assert.equal(made.mode, "play");
    assert.equal(made.format, "lanes");
    assert.equal(made.nodes, undefined, "no notes are drawn");
    const said = builderSaid(made.workshop, { drafted });
    assert.equal(keptReply({ ...made, said, labels: made.workshop.lanes.map((lane) => lane.label) }), said);
  }
  // Without the slate's reading, the same words are still a drawing request (the path every other slate takes).
  assert.equal(nativeCanvasDraft({ nodes: [] }, OWNER, REQ).mode, "draw");
});

test("the kept board is what useBuilder reads and library.saveDraft saves: the description becomes a smart component in Yours", async (t) => {
  const world = makeExecWorld();
  t.after(() => world.close());
  await world.libraryReady;
  const ada = principalFromUser(world.users.docs.find((user) => user._id === "owner"), API_TOKEN_SCOPES);
  const run = (id, input) => world.registry.run(ada, id, input).then((result) => result.body);
  const { shareId } = await run("library.branch", { itemId: "new" });
  const slate = world.slate(shareId);
  assert.equal(builderDescription(slate, OWNER), true, "a fresh builder slate takes a description");
  // nativeCanvas.keep writes the board as componentPlacing sets it: the slate's first board, a workshop.
  const { workshop } = builderBoard(null, OWNER, { now: NOW });
  const { set } = componentPlacing(slate, workshop);
  slate.creative = set.creative;
  slate.nativeCanvasDrawing = set.nativeCanvasDrawing;
  slate.options = { ...slate.options, workshopOrigin: set["options.workshopOrigin"] };
  slate.revision = (slate.revision ?? 0) + 1;
  // useBuilder reads the board only when the slate's model is a workshop.
  assert.equal(slate.creative.model.kind, "workshop");
  assert.match(app("imports/ui/components/library/build/useBuilder.js"), /record\?\.model\?\.kind === 'workshop' \? record\.model\.workshop : null/);
  // Once it holds a board, its own chat reshapes it: a description is no longer a new component.
  assert.equal(builderDescription(slate, OWNER), false);
  const saved = await run("library.saveDraft", { shareId, title: "Printable piece kit", summary: "Snap congruent pieces together to compose printable materials", category: "plan" });
  assert.equal(saved.status, "draft");
  const item = world.library.items.docs.find((doc) => doc._id === saved.itemId);
  const kept = JSON.stringify(item);
  for (const label of ["Kit", "Compose", "Ready to print", "Piece A", "compose-holds", "one-step"]) assert.ok(kept.includes(label), label);
  const mine = await run("library.mine", {});
  assert.ok(mine.items.some((row) => row.id === saved.itemId && row.status === "draft"));
});
