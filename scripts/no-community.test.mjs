// Community slates, the template gallery and featured presentations are gone (greenfield): the
// shared library replaced them. No page, route, list, menu branch, writer or feed of theirs remains,
// and the pieces that replace them are wired: the review queue, My library, publishing from Share
// and from a presentation, and the one-time move into the library at startup.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("../web/app/", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");
function files(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name);
    if (name === "node_modules" || name === "generated" || name.startsWith(".")) continue;
    if (statSync(join(root, path)).isDirectory()) files(path, out);
    else if (/\.(jsx?|mjs)$/.test(name)) out.push(path);
  }
  return out;
}
const source = [...files("imports"), ...files("client"), ...files("server")].map((path) => [path, read(path)]);
// The one-time move into the library (server/library/migrate.mjs and its startup call) names what it
// moves, by design: it is the only place the old flags are read.
const moving = (path) => path.startsWith("server/library/");
const where = (pattern) => source.filter(([path, text]) => !moving(path) && pattern.test(text.replace(/migrateCommunitySlates/g, ""))).map(([path]) => path);

test("no community slates page, route, list type or menu branch remains", () => {
  assert.ok(!existsSync(join(root, "imports/ui/pages/CommunitySlates.jsx")));
  assert.deepEqual(where(/CommunitySlates|type="community"|isCommunity=\{|case 'community'|communitySlates/), []);
  assert.doesNotMatch(read("imports/ui/SBRoutes.jsx"), /path="\/slates"/);
  const strings = JSON.parse(read("client/i18n/en/slates.i18n.json"));
  assert.deepEqual(Object.keys(strings).filter((key) => /community|template/i.test(key)), []);
});

test("no template gallery: no /templates route, page, directory, editor or creation-link redirect", () => {
  for (const gone of ["imports/ui/pages/SlateTemplates.jsx", "imports/ui/components/TemplateDetails.jsx", "server/methods/template-directory.js",
    "server/common/resolve-template-directory.mjs"]) assert.ok(!existsSync(join(root, gone)), gone);
  assert.deepEqual(where(/['"`]\/templates|templates\.directory|templates\.setDraft|legacyTemplateDestination|publicTemplateSelector|keepTemplate|fromTemplate|slateIdToCopy/), []);
  assert.doesNotMatch(read("imports/api/common/slateFilter.js"), /case 'templates'/);
  // A browser save never approves a template, whoever saves (the master user's auto-approval is gone).
  assert.doesNotMatch(read("server/methods/native-slate-save.mjs"), /templateApproved = true|userNameOverride/);
});

test("no featured presentations: no isFeatured writer, switch or feed, and no /api/public-presentations", () => {
  assert.ok(!existsSync(join(root, "server/common/featuredPresentationFeed.mjs")));
  assert.deepEqual(where(/public-presentations|featuredPresentationFeed/), []);
  assert.deepEqual(where(/isFeatured\s*[:=]\s*(true|false|e\.target|curPresentation|pinnedPrezi|workingPresentation|isFeatured)|updateFields\.isFeatured/), []);
  assert.doesNotMatch(read("server/methods/presentations.js"), /isFeatured|isMasterUser/);
  assert.doesNotMatch(read("server/startup.js"), /isFeatured: true/);
});

test("what replaces them is wired: the review queue, My library, publishing from Share and from a presentation, the move at startup", () => {
  assert.match(read("imports/ui/pages/LibraryReview.jsx"), /libraryApi\.review\.queue/);
  assert.match(read("imports/ui/pages/MyLibrary.jsx"), /libraryApi\.mine\(\)/);
  assert.match(read("imports/ui/components/library/review/ReviewPanel.jsx"), /libraryApi\.review\.refine/);
  assert.match(read("imports/ui/components/slate/SlateSharing.jsx"), /<PublishStatus kind="slate"/);
  assert.match(read("imports/ui/components/PresentSlate.jsx"), /<PublishStatus kind="presentation"/);
  assert.match(read("imports/ui/components/library/PublishDialog.jsx"), /libraryApi\.submit\(/);
  assert.match(read("imports/ui/pages/AdminTools.jsx"), /<LibraryQueueCard \/>/);
  assert.match(read("server/startup.js"), /migrateCommunitySlates\(\)/);
  assert.match(read("server/library/meteor.js"), /notify: notifyAuthor\(/);
  assert.match(read("server/library/meteor.js"), /createRefineAI\(/);
  // A notification of a decision links to My library from the bell's list.
  assert.match(read("imports/ui/components/MessagesMenu.jsx"), /messageActionTypes\.link/);
});
