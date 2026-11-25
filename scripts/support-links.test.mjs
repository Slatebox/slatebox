// Help and support (web/app/imports/ui/components/HelpMenu.jsx, common/supportLinks.mjs): the help center, the community,
// a bug report with the app version and browser filled in and nothing personal, and the contact form; no mailto.
// The GitHub templates the bug report and the issue chooser rely on are checked too.
// Run: node --test scripts/support-links.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { appVersion, bugReportUrl, describeBrowser, helpLinks, HELP_CENTER, COMMUNITY, CONTACT } from "../web/app/imports/ui/common/supportLinks.mjs";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");
const chromeMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36";

test("the menu offers the help center, the community, a bug report and the contact form, in that order", () => {
  const links = helpLinks({ commit: "08dfa2316c0ffee", userAgent: chromeMac, host: "app.slatebox.com" });
  assert.deepEqual(links.map((l) => [l.id, l.label]), [["docs", "Help center"], ["community", "Ask the community"], ["bug", "Report a bug"], ["contact", "Contact us"]]);
  assert.equal(links[0].href, "https://docs.slatebox.com/");
  assert.equal(links[1].href, "https://support.slatebox.com/");
  assert.equal(links[3].href, "https://slatebox.com/contact/");
  assert.deepEqual([HELP_CENTER, COMMUNITY, CONTACT], links.filter((l) => l.id !== "bug").map((l) => l.href));
  for (const link of links) assert.match(link.href, /^https:\/\//, link.id + " is not a web address");
});

test("the bug report opens the bug form with the app version and the browser, and nothing else", () => {
  const url = new URL(bugReportUrl({ commit: "08dfa2316c0ffee1234", userAgent: chromeMac, host: "app.slatebox.com" }));
  assert.equal(url.origin + url.pathname, "https://github.com/Slatebox/slatebox/issues/new");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["browser", "template", "version"]);
  assert.equal(url.searchParams.get("template"), "bug_report.yml");
  assert.equal(url.searchParams.get("version"), "app.slatebox.com, build 08dfa2316c0f");
  assert.equal(url.searchParams.get("browser"), "Chrome 131 on macOS");
});

test("a self-hosted Slatebox is named only as Self-hosted, never by its hostname", () => {
  const url = new URL(bugReportUrl({ commit: "abcdef1", userAgent: chromeMac, host: "whiteboard.acme-internal.example" }));
  assert.equal(url.searchParams.get("version"), "Self-hosted, build abcdef1");
  assert.ok(!url.href.includes("acme"));
});

test("the version is a commit or unknown, never free text", () => {
  assert.equal(appVersion(undefined), "unknown");
  assert.equal(appVersion("not a hash"), "unknown");
  assert.equal(appVersion("ABCDEF0123456789"), "ABCDEF012345");
});

test("the browser is a name, a major version and a system: no full user agent", () => {
  const cases = [
    [chromeMac, "Chrome 131 on macOS"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.70", "Edge 131 on Windows"],
    ["Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0", "Firefox 133 on Linux"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", "Safari 18 on iOS"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15", "Safari 18 on macOS"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36", "Chrome 131 on Android"],
    ["", "Unknown browser"],
  ];
  for (const [ua, expected] of cases) assert.equal(describeBrowser(ua), expected, ua);
});

test("Help and support has no mailto and opens the menu from both navigation drawers", async () => {
  const main = await read("web/app/imports/ui/Main.jsx");
  const menu = await read("web/app/imports/ui/components/HelpMenu.jsx");
  assert.doesNotMatch(main + menu, /mailto:/);
  assert.equal((main.match(/<HelpMenu\b/g) || []).length, 2);
  assert.match(menu, /helpLinks\(\{ commit: Meteor\.gitCommitHash, userAgent: navigator\.userAgent, host: window\.location\.hostname \}\)/);
  assert.match(menu, /target="_blank" rel="noopener noreferrer"/);
  assert.match(menu, /chat && <MenuItem onClick=\{\(\) => \{ done\(\); window\.\$chatwoot\.toggle\(\) \}\}/, "the support chat is offered only when it is loaded");
});

test("the GitHub bug form has the fields the app fills in, and the issue chooser points at our help", async () => {
  const bug = await read(".github/ISSUE_TEMPLATE/bug_report.yml");
  for (const id of ["version", "browser"]) assert.match(bug, new RegExp("^    id: " + id + "$", "m"), "bug_report.yml has no " + id + " field for the app to fill");
  const chooser = await read(".github/ISSUE_TEMPLATE/config.yml");
  assert.match(chooser, /^blank_issues_enabled: false$/m);
  assert.match(chooser, /url: https:\/\/github\.com\/Slatebox\/slatebox\/discussions/);
  assert.match(chooser, /url: https:\/\/docs\.slatebox\.com$/m);
  assert.match(chooser, /url: https:\/\/slatebox\.com\/contact\/$/m);
  for (const name of ["q-a.yml", "ideas.yml"]) assert.match(await read(".github/DISCUSSION_TEMPLATE/" + name), /^body:$/m);
});
