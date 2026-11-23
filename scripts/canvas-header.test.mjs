import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

// The canvas header (reports21/header-final.md): every control labelled and in one place, no "..."
// menu, one AI entry, and the audit's small fixes.
const ui = (path) => new URL(`../web/app/imports/ui/${path}`, import.meta.url);
const read = (path) => readFile(ui(path), "utf8");
const exists = (path) => access(ui(path)).then(() => true, () => false);

test("the header has no '...' menu, no sliders icon and no legacy AI chat toggle", async () => {
  const source = await read("components/CanvasToolbar.jsx");
  assert.doesNotMatch(source, /MoreHoriz|Board menu|sbManageSlate|Board settings/);
  assert.doesNotMatch(source, /isChatOpen|AI chat/);
  assert.match(source, /sb-board-name/);
  assert.match(source, /aria-pressed/);
});

test("the legacy chat window and its open state are gone; nothing reads isChatOpen", async () => {
  assert.equal(await exists("components/Chat.jsx"), false);
  const atoms = await read("jotai/atoms.js");
  assert.doesNotMatch(atoms, /isChatOpen/);
  for (const file of ["pages/Canvas.jsx", "components/AdHocAINodes.jsx", "components/CollaborationUsers.jsx", "components/huddle/CollaborationHuddle.jsx",
    "components/ai/CanvasAIIntentionsDialog.jsx", "components/node/QuickNodeActions.jsx"]) {
    assert.doesNotMatch(await read(file), /isChatOpen/, file);
  }
  assert.match(atoms, /export const conversationOpen\b/);
});

test("the canvas page has no floating Ask Slatebox button and names its panel Ask Slatebox", async () => {
  const canvas = await read("pages/Canvas.jsx");
  assert.doesNotMatch(canvas, /position:'fixed',right:16,top:76/);
  const panel = await read("components/ConversationPanel.jsx");
  assert.match(panel, /aria-label="Ask Slatebox"/);
  assert.doesNotMatch(panel, />Slatebox</);
});

test("the huddle settings button handles its own click, so the keyboard can use it", async () => {
  const source = await read("components/HuddleUp.jsx");
  assert.doesNotMatch(source, /<SettingsIcon[^>]*onClick/);
  assert.match(source, /<IconButton[^>]*onClick=\{showHuddleProperties\}/);
});

test("the account menu has no unguarded Chatwoot call, no plan or billing item, and no Logout for a guest", async () => {
  const source = await read("components/AccountMenu.jsx");
  assert.doesNotMatch(source, /window\.\$chatwoot\.toggle/);
  assert.doesNotMatch(source, /Upgrade|Billing|Plans and pricing|planType|PricingTiers|createSession/);
  assert.match(source, /isAnonymous/);
  assert.match(source, /menuitemcheckbox/);
  assert.equal(await exists("components/ProfileMenu.jsx"), false);
});

test("the notifications count is system messages only, the same set the list shows", async () => {
  const source = await read("components/MessagesMenu.jsx");
  assert.doesNotMatch(source, /Messages\.find\(\{\s*read:\s*false\s*\}\)/);
  assert.match(source, /type:\s*CONSTANTS\.messageTypes\.system,\s*read:\s*false/);
});

test("the app menu offers a guest nothing they cannot use, and drops Profile and the duplicate support item", async () => {
  const main = await read("Main.jsx");
  assert.doesNotMatch(main, /title: 'Profile'/);
  assert.match(main, /'Theme library'/);
  assert.match(main, /guest/i);
  // One navigation list, rendered on and off the canvas.
  assert.equal((main.match(/const drawerItems = /g) || []).length, 1);
  assert.doesNotMatch(main, /destinations=\{drawerItems\}/);
});

test("the live presentation offers no separate pill; Present and Follow share one slot", async () => {
  const live = await read("components/presentations/useLivePresentation.jsx");
  assert.doesNotMatch(live, /sb-live-notes-action|Present notes together|Present together/);
  const css = await read("common/main.css");
  assert.doesNotMatch(css, /sb-live-notes-action/);
  assert.match(css, /max-width:\s*1179\.98px/);
  assert.match(css, /max-width:\s*999\.98px/);
});
