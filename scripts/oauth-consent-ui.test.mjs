// The consent screen an MCP app sends a person to (/oauth/consent), the connected apps in
// Profile → Developer, and the way back to consent after signing in.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loginDestination, rememberLoginReturn, recalledLoginReturn } from "../web/app/imports/api/common/login-return.mjs";

const read = (path) => readFile(new URL(`../web/app/${path}`, import.meta.url), "utf8");
const consent = await read("imports/ui/pages/OAuthConsent.jsx");
const developer = await read("imports/ui/components/profile/DeveloperAccess.jsx");
const routes = await read("client/main.jsx");
const login = await read("imports/ui/pages/Login.jsx");
const loginLink = await read("imports/ui/pages/LoginLink.jsx");

test("the consent page uses the account layout and names the app, where it returns, and each permission", () => {
  assert.match(consent, /from '\.\.\/common\/AccountLayout'/);
  assert.match(consent, /<AccountPage/);
  assert.match(consent, /<AccountSection/);
  assert.match(consent, /<AccountActions/);
  assert.match(consent, /request\.client\.name/);
  assert.match(consent, /request\.client\.redirectHost/);
  assert.match(consent, /Slatebox has not checked this app/);
  assert.match(consent, /CONSTANTS\.methods\.oauth\.describe/);
  assert.match(consent, /CONSTANTS\.methods\.oauth\.decide/);
  // The person may untick permissions; Allow needs at least one.
  assert.match(consent, /disabled=\{busy \|\| !chosen\.length\}/);
  // One list of permission words, shared with the token form.
  assert.match(consent, /tokenPermissions/);
  assert.match(developer, /tokenPermissions/);
});

test("the consent page refuses to run inside a frame and sends guests to sign in, never to Allow", () => {
  assert.match(consent, /window\.top !== window\.self/);
  assert.match(consent, /isAnonymous/);
  assert.match(consent, /\/login\?oauth=/);
  assert.match(consent, /window\.location\.assign\(decided\.redirectTo\)/);
});

test("the consent route is a page of its own, like sign-in, outside the app's chrome", () => {
  assert.match(routes, /path="\/oauth\/consent"/);
  assert.match(routes, /<OAuthConsent \/>/);
});

test("Profile → Developer lists connected apps apart from personal tokens, with Disconnect", () => {
  assert.match(developer, /Connected apps/);
  assert.match(developer, /token\.kind === 'oauth'/);
  assert.match(developer, /Disconnect/);
  assert.match(developer, /\{instance\.connect\.hosted\}/);
});

test("after signing in, a person waiting on consent goes back to it", () => {
  assert.equal(loginDestination(new URLSearchParams("oauth=0123456789abcdef0123456789abcdef")), "/oauth/consent?request=0123456789abcdef0123456789abcdef");
  assert.equal(loginDestination(new URLSearchParams("oauth=../../evil")), "/");
  assert.equal(loginDestination(new URLSearchParams("room=abcdef0123")), "/workshops?room=abcdef0123");
  assert.equal(loginDestination(new URLSearchParams("")), "/");
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  rememberLoginReturn(storage, "/oauth/consent?request=0123456789abcdef0123456789abcdef", 1000);
  assert.equal(recalledLoginReturn(storage, 1000 + 60_000), "/oauth/consent?request=0123456789abcdef0123456789abcdef");
  assert.equal(recalledLoginReturn(storage, 1000 + 60_000), "/", "read once");
  rememberLoginReturn(storage, "/workshops?room=abcdef0123", 1000);
  assert.equal(recalledLoginReturn(storage, 1000 + 31 * 60_000), "/", "lapses after thirty minutes");
  storage.setItem("slatebox.workshopLogin", "https://evil.example|1000");
  assert.equal(recalledLoginReturn(storage, 2000), "/");
  assert.match(login, /loginDestination\(query\)/);
  assert.match(loginLink, /recalledLoginReturn\(localStorage/);
});

test("each permission is explained in plain words on the consent page and the token form", async () => {
  const { tokenPermissions } = await import("../web/app/imports/api/common/token-permissions.mjs");
  const { API_TOKEN_SCOPES } = await import("../web/app/server/api-token-core.mjs");
  assert.deepEqual(tokenPermissions.map(({ scope }) => scope), API_TOKEN_SCOPES);
  for (const { scope, label, explain } of tokenPermissions) {
    assert.ok(label, scope);
    assert.equal(typeof explain, "string", scope);
    assert.ok(explain.length >= 20 && explain.length <= 200, scope);
    assert.match(explain, /^[A-Z].*\.$/, scope);
    assert.doesNotMatch(explain, /\b(scope|OAuth|token|API)\b/, `${scope}: plain words`);
  }
  assert.match(consent, /explain/);
});
