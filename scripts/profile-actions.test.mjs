// About you, S1 (2026-11-26): the profile.* actions, declared once and served on every surface
// (the Meteor methods Profile › About you calls, /api/v1, the exec client and the MCP tools), with
// the registry's own checks: only the signed-in person, for themselves; a guest gets nothing; a
// token needs profile:read or profile:write, which no token has unless the person chose it; only a
// person switches personalization or its sources. And the privacy wiring around them: removed with
// the account, never published to anyone, not in a team export, a Download in the tab.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { API_TOKEN_SCOPES, createApiTokenService } from "../web/app/server/api-token-core.mjs";
import { createAppRegistry } from "../web/app/server/actions/index.mjs";
import { mountDdp } from "../web/app/server/actions/ddp.mjs";
import { boundActions } from "../web/app/server/actions/exec-binding.mjs";
import { buildContract } from "../web/app/server/actions/contract.mjs";
import { createIdempotencyStore } from "../web/app/server/actions/idempotency.mjs";
import { createRateLimiter } from "../web/app/server/actions/rate-limit.mjs";
import { principalFromToken } from "../web/app/server/actions/principal.mjs";
import { PROFILE_WRITE_LIMITS } from "../web/app/server/actions/profile.mjs";
import { tokenPermissions } from "../web/app/imports/api/common/token-permissions.mjs";
import { SECTIONS } from "../web/app/server/team-export/format.mjs";
import { FIRST_SLATE_FACT_ID, LIMITS } from "../web/app/imports/api/common/personal-facts.mjs";
import { memoryDriverCollection, memoryMeteorCollection, serve } from "./action-test-stores.mjs";
import { makeProfileWorld } from "./profile-test-stores.mjs";

const app = (path) => readFileSync(new URL(`../web/app/${path}`, import.meta.url), "utf8");
const PROFILE_IDS = ["profile.facts.list", "profile.facts.add", "profile.facts.update", "profile.facts.hide", "profile.facts.remove", "profile.facts.clear", "profile.settings.get", "profile.settings.set"];

async function makeWorld({ limits } = {}) {
  const start = { job: "ship", with: "team", via: "card", resolved: "ship.team", at: new Date("2026-11-20T09:00:00Z"), v: 1 };
  const profile = await makeProfileWorld({ users: [{ _id: "ada", profile: { start } }, { _id: "ben" }] });
  const users = memoryMeteorCollection("user");
  users.docs.push({ _id: "ada" }, { _id: "ben" }, { _id: "gus", isAnonymous: true });
  const service = createApiTokenService({
    apiTokens: memoryMeteorCollection("token"),
    users,
    slates: { findOneAsync: async () => null },
    slateAccess: { find: () => ({ fetchAsync: async () => [] }) },
    now: () => 5000,
  });
  const registry = createAppRegistry({
    deps: { profile: profile.store, apiTokens: service },
    idempotency: createIdempotencyStore({ collection: memoryDriverCollection() }),
    limiter: createRateLimiter({ collection: memoryDriverCollection(), now: () => 0, limits }),
  });
  let methods;
  mountDdp(registry, {
    defineMethods: (defined) => (methods = defined),
    makeError: (code, reason, details) => Object.assign(new Error(reason), { error: code, reason, details }),
    loadUser: async (id) => users.docs.find((user) => user._id === id) || null,
    scopes: API_TOKEN_SCOPES,
  });
  // A Meteor method as the app calls it, as a signed-in person (or nobody).
  const as = (userId) => (id, input) => methods[id].call({ userId }, input);
  const authenticate = async (req) => principalFromToken(await service.authenticateApiRequest(req));
  const mint = (scopes, userId = "ada", name = "Claude") => service.createApiToken({ userId, name, scopes });
  return { ...profile, registry, methods, as, authenticate, mint };
}

test("eight actions, each the person's own: profile:read or profile:write, never a guest's, set by a person only", () => {
  const registry = createAppRegistry();
  const profile = registry.list().filter((action) => action.id.startsWith("profile."));
  assert.deepEqual(profile.map((action) => action.id).sort(), [...PROFILE_IDS].sort());
  for (const action of profile) {
    assert.equal(action.toolset, "account", action.id);
    assert.equal(action.scope, action.kind === "read" ? "profile:read" : "profile:write", action.id);
    assert.ok(!action.principals.includes("guest") && !action.principals.includes("visitor"), action.id);
    assert.equal(action.mounts.ddp, true, action.id);
    if (action.id === "profile.settings.set") {
      assert.deepEqual(action.principals, ["person"], "an agent never turns on what Slatebox reads about someone");
      assert.equal(action.mounts.http, null);
      continue;
    }
    assert.deepEqual(action.principals, ["person", "agent"], action.id);
    assert.ok(action.mounts.http && action.tool?.name, `${action.id}: an /api/v1 route and an MCP tool`);
    if (action.kind === "write") assert.equal(action.idempotency, "optional", action.id);
  }
  assert.deepEqual(profile.filter((action) => action.destructive).map((action) => action.id).sort(), ["profile.facts.clear", "profile.facts.remove"]);
  // The exec client (and so the CLI and MCP's exec) has every profile method but settings.set.
  const bound = boundActions(registry).map((action) => action.id).filter((id) => id.startsWith("profile."));
  assert.deepEqual(bound.sort(), PROFILE_IDS.filter((id) => id !== "profile.settings.set").sort());
  const tools = buildContract(registry).actions.filter((action) => action.id.startsWith("profile.")).map((action) => action.tool.name).sort();
  assert.deepEqual(tools, ["add_profile_fact", "clear_profile_facts", "get_profile_settings", "hide_profile_fact", "list_profile_facts", "remove_profile_fact", "update_profile_fact"]);
  // The scopes are in the token vocabulary, with words on the token form and the consent page.
  for (const scope of ["profile:read", "profile:write"]) {
    assert.ok(API_TOKEN_SCOPES.includes(scope), scope);
    assert.ok(tokenPermissions.find((item) => item.scope === scope)?.explain, scope);
  }
});

test("Profile › About you: add, list (with the first-slate fact), change, hide, show, remove and clear through the Meteor methods", async () => {
  const world = await makeWorld();
  const ada = world.as("ada");
  const added = await ada("profile.facts.add", { kind: "role", text: "  Product manager " });
  assert.equal(added.added, true);
  assert.equal(added.mode, "save");
  assert.deepEqual({ ...added.fact, id: "x", createdAt: null, updatedAt: null }, {
    id: "x", kind: "role", text: "Product manager", source: { type: "typed" }, confidence: 1, hidden: false, derived: false, createdAt: null, updatedAt: null,
  });
  assert.equal((await ada("profile.facts.add", { kind: "role", text: "I am a product manager." })).added, false, "the same fact again");
  await ada("profile.facts.add", { kind: "tool", text: "Linear" });

  let listed = await ada("profile.facts.list", {});
  assert.equal(listed.on, true);
  assert.equal(listed.limit, LIMITS.perPerson);
  assert.deepEqual(listed.facts.map((fact) => [fact.kind, fact.text, fact.source.type]), [
    ["role", "Product manager", "typed"], ["work", "Works on shipping by a date", "first-slate"], ["tool", "Linear", "typed"],
  ]);
  assert.equal(world.facts.docs.length, 2, "the first-slate fact is read, not copied");
  assert.deepEqual((await ada("profile.facts.list", { kind: "tool" })).facts.map((fact) => fact.text), ["Linear"]);

  const role = listed.facts[0];
  const changed = await ada("profile.facts.update", { factId: role.id, text: "Head of product" });
  assert.equal(changed.fact.text, "Head of product");
  await assert.rejects(ada("profile.facts.update", { factId: role.id }), { error: "invalid_request" });
  assert.equal((await ada("profile.facts.hide", { factId: FIRST_SLATE_FACT_ID })).fact.hidden, true, "hidden is the default");
  assert.equal((await ada("profile.facts.hide", { factId: FIRST_SLATE_FACT_ID, hidden: false })).fact.hidden, false);
  assert.deepEqual(await ada("profile.facts.remove", { factId: role.id }), { factId: role.id, removed: true, mode: "save" });
  await assert.rejects(ada("profile.facts.remove", { factId: role.id }), { error: "not_found" });

  assert.equal((await ada("profile.facts.clear", { source: "typed" })).removed, 1);
  assert.deepEqual((await ada("profile.facts.list", {})).facts.map((fact) => fact.source.type), ["first-slate"], "clearing typed facts leaves the first slate's");
  assert.equal((await ada("profile.facts.clear", {})).removed, 1);
  listed = await ada("profile.facts.list", {});
  assert.deepEqual(listed.facts, []);

  // Bounds: the kind list, the words' length, undeclared fields, a fact id's shape.
  await assert.rejects(ada("profile.facts.add", { kind: "secret", text: "x" }), { error: "invalid_request" });
  await assert.rejects(ada("profile.facts.add", { kind: "role", text: "x".repeat(LIMITS.text + 1) }), { error: "invalid_request" });
  await assert.rejects(ada("profile.facts.add", { kind: "role", text: "x", userId: "ben" }), { error: "invalid_request" });
  await assert.rejects(ada("profile.facts.add", { kind: "role", text: "x", source: { type: "integration", ref: "notion" } }), { error: "invalid_request" }, "a person types; sources are the server's");
  await assert.rejects(ada("profile.facts.hide", { factId: "{$ne:1}" }), { error: "invalid_request" });
});

test("personalization switches: on by default; a person turns it, and sources, on or off", async () => {
  const world = await makeWorld();
  const ada = world.as("ada");
  assert.deepEqual(await ada("profile.settings.get", {}), { on: true, sources: {}, updatedAt: null });
  const off = await ada("profile.settings.set", { on: false, sources: { "integration:notion": true } });
  assert.equal(off.on, false);
  assert.deepEqual(off.sources, { "integration:notion": true });
  assert.equal((await ada("profile.facts.list", {})).on, false);
  await assert.rejects(ada("profile.settings.set", {}), { error: "invalid_request" });
  await assert.rejects(ada("profile.settings.set", { sources: { "email:inbox": true } }), { error: "invalid_request" });
  await assert.rejects(ada("profile.settings.set", { sources: { interview: "yes" } }), { error: "invalid_request" });
  assert.equal((await world.as("ben")("profile.settings.get", {})).on, true, "one person's switch is theirs");
});

test("only the signed-in person, for themselves: a guest and nobody get nothing", async () => {
  const world = await makeWorld();
  await world.as("ada")("profile.facts.add", { kind: "goal", text: "Ship the beta" });
  for (const id of PROFILE_IDS) {
    const input = id === "profile.facts.add" ? { kind: "goal", text: "x" } : id.endsWith(".update") || id.endsWith(".hide") || id.endsWith(".remove") ? { factId: "f1" } : id.endsWith("settings.set") ? { on: false } : {};
    await assert.rejects(world.as("gus")(id, input), { error: "registration_required" }, `${id}: a guest saves their account first`);
    await assert.rejects(world.as(null)(id, input), { error: "unauthorized" }, `${id}: signed out`);
  }
  const ben = world.as("ben");
  assert.deepEqual((await ben("profile.facts.list", {})).facts, []);
  await assert.rejects(ben("profile.facts.update", { factId: "f1", text: "Mine now" }), { error: "not_found" });
  await assert.rejects(ben("profile.facts.hide", { factId: "f1" }), { error: "not_found" });
  await assert.rejects(ben("profile.facts.remove", { factId: "f1" }), { error: "not_found" });
  await assert.rejects(ben("profile.facts.hide", { factId: FIRST_SLATE_FACT_ID }), { error: "not_found" }, "Ben never answered a first slate");
  assert.equal((await ben("profile.facts.clear", {})).removed, 0);
  assert.equal(world.facts.docs.length, 1, "Ada's fact is untouched");
});

test("a token reads and writes its own account's profile with profile:read and profile:write only, as itself", async (t) => {
  const world = await makeWorld();
  const call = await serve(t, world.registry, world.authenticate);
  const slates = await world.mint(["slates:read", "slates:write"]);
  const denied = await call("/api/v1/profile/facts", { token: slates.token });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "insufficient_scope");
  assert.equal(denied.body.error.details.requiredScope, "profile:read");

  const reader = await world.mint(["profile:read"]);
  const listed = await call("/api/v1/profile/facts", { token: reader.token });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.facts.map((fact) => fact.text), ["Works on shipping by a date"]);
  const cannotWrite = await call("/api/v1/profile/facts", { token: reader.token, method: "POST", body: { kind: "tool", text: "Figma" } });
  assert.equal(cannotWrite.status, 403);
  assert.equal(cannotWrite.body.error.details.requiredScope, "profile:write");

  const writer = await world.mint(["profile:read", "profile:write"], "ada", "Claude Desktop");
  const added = await call("/api/v1/profile/facts", { token: writer.token, method: "POST", key: "add-1", body: { kind: "tool", text: "Figma" } });
  assert.equal(added.status, 201);
  assert.deepEqual(added.body.fact.source, { type: "typed", label: "Claude Desktop" }, "the fact says which connection added it");
  const replay = await call("/api/v1/profile/facts", { token: writer.token, method: "POST", key: "add-1", body: { kind: "tool", text: "Figma" } });
  assert.equal(replay.headers.get("idempotent-replayed"), "true");
  const id = added.body.fact.id;
  assert.equal((await call(`/api/v1/profile/facts/${id}`, { token: writer.token, method: "PATCH", body: { kind: "tool", text: "Figma and FigJam" } })).body.fact.text, "Figma and FigJam");
  assert.equal((await call(`/api/v1/profile/facts/${id}/hide`, { token: writer.token, method: "POST", body: {} })).body.fact.hidden, true);
  assert.equal((await call("/api/v1/profile/settings", { token: reader.token })).body.on, true);
  // settings.set has no route, and run as a token it is refused: an agent never widens what is read.
  assert.equal((await call("/api/v1/profile/settings", { token: writer.token, method: "PATCH", body: { on: false } })).status, 404);
  const principal = { kind: "agent", userId: "ada", tokenId: writer.id, tokenName: "Claude Desktop", scopes: ["profile:read", "profile:write"] };
  await assert.rejects(world.registry.run(principal, "profile.settings.set", { sources: { "integration:notion": true } }), { code: "session_required" });
  assert.equal((await call(`/api/v1/profile/facts/${id}`, { token: writer.token, method: "DELETE" })).status, 200);
  assert.equal((await call("/api/v1/profile/facts/clear", { token: writer.token, method: "POST", body: {} })).body.removed, 1);

  // Another account's token reaches only its own profile.
  const bens = await world.mint(["profile:read", "profile:write"], "ben");
  await world.as("ada")("profile.facts.add", { kind: "goal", text: "Private goal" });
  assert.deepEqual((await call("/api/v1/profile/facts", { token: bens.token })).body.facts, []);
  const ada = (await world.as("ada")("profile.facts.list", {})).facts.find((fact) => fact.text === "Private goal");
  assert.equal((await call(`/api/v1/profile/facts/${ada.id}`, { token: bens.token, method: "DELETE" })).status, 404);
});

test("with personalization off, an agent cannot add to About you; the person still can, and can still tidy up", async (t) => {
  const world = await makeWorld();
  const call = await serve(t, world.registry, world.authenticate);
  const writer = await world.mint(["profile:read", "profile:write"]);
  const kept = await call("/api/v1/profile/facts", { token: writer.token, method: "POST", body: { kind: "tool", text: "Figma" } });
  assert.equal(kept.status, 201);
  await world.as("ada")("profile.settings.set", { on: false });
  const refused = await call("/api/v1/profile/facts", { token: writer.token, method: "POST", body: { kind: "tool", text: "Linear" } });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error.code, "personalization_off");
  assert.ok(!world.facts.docs.some((doc) => doc.text === "Linear"));
  assert.equal((await world.as("ada")("profile.facts.add", { kind: "tool", text: "Linear" })).added, true, "their own typing is theirs");
  assert.equal((await call(`/api/v1/profile/facts/${kept.body.fact.id}/hide`, { token: writer.token, method: "POST", body: {} })).status, 200, "hiding uses less, so it stays open");
  await world.as("ada")("profile.settings.set", { on: true });
  assert.equal((await call("/api/v1/profile/facts", { token: writer.token, method: "POST", body: { kind: "tool", text: "Notion" } })).status, 201);
});

test("writes are rate limited: a token's by the registry, a person's by Meteor's limiter on every write", async (t) => {
  const world = await makeWorld({ limits: { perToken: 2, perAccount: 10, windowSeconds: 60 } });
  const call = await serve(t, world.registry, world.authenticate);
  const writer = await world.mint(["profile:write"]);
  const send = (text) => call("/api/v1/profile/facts", { token: writer.token, method: "POST", body: { kind: "topic", text } });
  assert.equal((await send("One")).status, 201);
  assert.equal((await send("Two")).status, 201);
  const refused = await send("Three");
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error.code, "rate_limited");
  // Every write a person makes is counted per account (server/profile/meteor.js).
  const writes = createAppRegistry().list().filter((action) => action.id.startsWith("profile.") && action.kind === "write").map((action) => action.id);
  assert.deepEqual(Object.keys(PROFILE_WRITE_LIMITS).sort(), writes.sort());
  assert.ok(Object.values(PROFILE_WRITE_LIMITS).every((count) => count > 0 && count <= 30));
  const glue = app("server/profile/meteor.js");
  assert.match(glue, /for \(const \[name, count\] of Object\.entries\(PROFILE_WRITE_LIMITS\)\) \{\s*DDPRateLimiter\.addRule\(\{ type: 'method', name, userId: \(userId\) => Boolean\(userId\) \}, count, 60000\)/);
});

test("privacy: removed with the account, never published, not in a team export", () => {
  // users.delete removes every fact and setting before the account goes.
  const users = app("server/methods/users.js");
  const removal = users.slice(users.indexOf("removeOwnAccount"), users.indexOf("Meteor.users.removeAsync({ _id: user._id })"));
  assert.match(removal, /await removePersonalData\(user\._id\)/);
  assert.match(users, /import \{ removePersonalData \} from '\.\.\/profile\/meteor'/);
  assert.match(app("server/profile/meteor.js"), /export const removePersonalData = \(userId\) => profileStore\.removeAll\(userId\)/);
  // Every other path that removes a saved account does the same before the account goes: the sole
  // owner deleting their team, and an admin removing a member. The only other removals are of a
  // guest account made moments before in the same call, which About you never stores for.
  const removals = { "server/methods/organizations.js": "user._id", "server/methods/team-member-slates.js": "memberId" };
  for (const [file, id] of Object.entries(removals)) {
    const text = app(file);
    assert.match(text, /import \{ removePersonalData \} from '\.\.\/profile\/meteor'/, file);
    const removal = text.indexOf("Meteor.users.removeAsync(");
    const cleanup = text.indexOf(`await removePersonalData(${id})`);
    assert.ok(cleanup > 0 && cleanup < removal, `${file}: About you is removed before the account`);
  }
  const server = new URL("../web/app/server/", import.meta.url);
  const removers = readdirSync(server, { recursive: true })
    .filter((file) => /\.(m?js)$/.test(file) && !file.includes("generated"))
    .filter((file) => /Meteor\.users\.removeAsync\(/.test(readFileSync(new URL(file, server), "utf8")))
    .map((file) => `server/${file}`)
    .sort();
  assert.deepEqual(removers, ["server/methods/creative-slates.js", "server/methods/kept-native-slate.js", "server/methods/organizations.js", "server/methods/team-member-slates.js", "server/methods/users.js"],
    "a new path that removes accounts must remove About you too (or be a just-made guest)");
  for (const file of ["server/methods/creative-slates.js", "server/methods/kept-native-slate.js"])
    assert.match(app(file), /Meteor\.users\.removeAsync\(\{ _id: guest\._id/, `${file} removes only the guest it just made`);

  // No publication anywhere sends the collections, or a teammate's whole profile (the first-slate answer).
  const sources = readdirSync(server, { recursive: true }).filter((file) => /\.(m?js)$/.test(file) && !file.includes("generated"));
  for (const file of sources) {
    const text = readFileSync(new URL(file, server), "utf8");
    if (!/Meteor\.publish/.test(text)) continue;
    assert.doesNotMatch(text, /PersonalFacts|PersonalSettings|personalFacts|personalSettings/, `${file} publishes no About you data`);
  }
  const publications = app("server/publications.js");
  const orgUsers = publications.slice(publications.indexOf("CONSTANTS.publications.orgUsers,"), publications.indexOf("CONSTANTS.publications.orgUsersForGuest"));
  assert.match(orgUsers, /\{ orgId: user\.orgId, _id: \{ \$ne: user\._id \} \}/);
  assert.match(orgUsers, /'profile\.firstName': 1,\s*'profile\.lastName': 1,/);
  assert.doesNotMatch(orgUsers, /\bprofile: 1/, "teammates see names, never the rest of a profile");

  // The team export carries the team's work; About you is personal, so it is not in it.
  assert.ok(!SECTIONS.some((section) => /personal|profile|facts/i.test(section)));
  for (const file of ["export-core.mjs", "format.mjs", "meteor.js"]) assert.doesNotMatch(app(`server/team-export/${file}`), /personalFacts|personalSettings|PersonalFacts|profile\.start/, file);
  // The collections are the server's: written and read through profile.* only.
  assert.match(app("imports/api/common/models.js"), /Each person's own; written and read through the profile\.\* actions only, never published\./);
});

test("the About you tab: the explanation, the switch, facts by kind with edit, hide and remove, add, Download and Delete all facts", () => {
  const profile = app("imports/ui/pages/Profile.jsx");
  assert.match(profile, /<Tab label="About you" value="about" id="scrollable-auto-tab-about" aria-controls="scrollable-auto-tabpanel-about" \/>/);
  // Every tab carries the id its panel is labelled by (TabPanel: aria-labelledby scrollable-auto-tab-<index>).
  for (const match of profile.matchAll(/<TabPanel value=\{tabValue\} index=\{?"?([\w]+)"?\}?>/g)) assert.ok(profile.includes(`id="scrollable-auto-tab-${match[1]}"`), match[1]);
  assert.match(profile, /<TabPanel value=\{tabValue\} index="about">\s*<AboutYou \/>/);
  assert.match(profile, /about: 'about'/, "/profile?tab=about opens it");
  const tab = app("imports/ui/components/profile/AboutYou.jsx");
  assert.match(tab, /What Slatebox knows about you, so it can suggest boards and slates made for your work\. Only you see this\./);
  assert.match(tab, /<Switch checked=\{settings\.on\}/);
  // The switch's name stays the same whatever its state (the state is its own), and it is a switch.
  assert.match(tab, /label="Use what is here to personalize Slatebox"/);
  assert.match(tab, /slotProps=\{\{ input: \{ role: 'switch' \} \}\}/);
  assert.match(tab, /M\.settings\.set, \{ on \}/);
  for (const method of ["list", "add", "update", "hide", "remove", "clear"]) assert.match(tab, new RegExp(`M\\.facts\\.${method}\\b`), method);
  assert.match(tab, /groupFacts\(/);
  assert.match(tab, /sourceLine\(fact\.source\)/);
  for (const label of [">Edit<", "'Show' : 'Hide'", ">Remove<", ">Add<", ">Download<", ">Delete all facts<"]) assert.ok(tab.includes(label), label);
  assert.match(tab, /confirmService\.show\(/, "Delete all facts asks first");
  assert.match(tab, /profileDownload\(/);
  // Accessible: labelled fields, a polite status for each change, Escape leaves an edit, focus comes back.
  assert.match(tab, /label="What Slatebox should know"/);
  assert.match(tab, /label="Kind"/);
  assert.match(tab, /role="status" aria-live="polite"/);
  assert.match(tab, /e\.key === 'Escape'/);
  assert.match(tab, /editButton\.current\?\.focus\(\)/);
  assert.match(tab, /aria-label=\{`Edit: \$\{fact\.text\}`\}/);
  // The empty state offers the interview, now real (S2, 2026-11-26: it said "is coming" until then), and promises nothing else.
  const empty = tab.slice(tab.indexOf("data-about-you-empty"), tab.indexOf("</AccountActions>", tab.indexOf("data-about-you-empty")));
  assert.match(empty, /or talk with Slatebox about your work and keep what you choose\./);
  // its own name, so it is not a second "Talk with Slatebox about your work" on the page; offered only when a talk can start
  assert.match(empty, /onClick=\{openTalk\}[^>]*>Start a talk with Slatebox</);
  assert.match(empty, /canTalk\s*\?\s*'Nothing here yet\. Add something above, such as your role or the tools you use, or talk with Slatebox/);
  assert.match(empty, /: 'Nothing here yet\. Add something above, such as your role or the tools you use\.'/);
  assert.doesNotMatch(empty, /coming/);
  assert.doesNotMatch(empty, /LinkedIn|Facebook|Instagram|Notion|Slack|connect|upload/i);
  // Plain words: no all-caps placeholders, "agent" rather than "AI".
  const copy = [
    ...[...tab.matchAll(/(?<=[(,:?=\s])(['`])([A-Z][^'`\n]*)\1/g)].map((match) => match[2]),
    ...[...tab.matchAll(/>\s*([^<>{}=;()&|'"\n]+?)\s*</g)].map((match) => match[1]).filter((text) => /[a-z]{2}/i.test(text)),
  ];
  assert.ok(copy.some((text) => text.includes("Delete all facts")) && copy.length > 20, `read ${copy.length} pieces of copy`);
  for (const text of copy) assert.doesNotMatch(text, /\b[A-Z]{4,}\b/, text);
  assert.doesNotMatch(tab, /\bAI\b/);
});

test("MIT core: About you imports nothing from enterprise/", () => {
  for (const file of ["imports/api/common/personal-facts.mjs", "server/profile/store.mjs", "server/profile/meteor.js", "server/actions/profile.mjs", "imports/ui/components/profile/AboutYou.jsx",
    // the interview (S2): its rules, its turns, its methods and its panel
    "imports/api/common/interview.mjs", "server/interview/core.mjs", "server/methods/interview.js", "imports/ui/components/profile/Interview.jsx"])
    assert.doesNotMatch(app(file), /enterprise/i, file);
});
