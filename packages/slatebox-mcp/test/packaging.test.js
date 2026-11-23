// What the package says about itself when it is listed: the npm manifest, server.json for the
// official MCP Registry (registry.modelcontextprotocol.io) and the README's opening. Nothing here
// publishes anything; it pins what a publish would send so it cannot drift.
//
// Wording rules (MCP plan, "Off-model surfaces"): the comparison with Miro is allowed only in the
// README's opening, next to the not-affiliated line, and as one npm keyword. Never in a name,
// package, tool, slug, the npm or registry description, or anything the server sends an agent.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const read = async (path) => readFile(new URL(path, import.meta.url), "utf8");
const manifest = JSON.parse(await read("../package.json"));
const server = JSON.parse(await read("../server.json").catch(() => "{}"));
const readme = await read("../README.md");
const packScript = await read("../../../scripts/pack-agent-tools.py");
const registrySchema = await read("./registry-server.schema.json");

const DESCRIPTION =
  "Slatebox for AI assistants: create and edit mind maps, diagrams, project plans and presentations on a shared canvas.";
const KEYWORDS = [
  "mcp", "mcp-server", "modelcontextprotocol", "mind-map", "mindmap", "diagram", "flowchart", "whiteboard",
  "project-planning", "gantt", "timeline", "presentation", "mermaid", "collaboration", "open-source", "miro-alternative",
];
const REPOSITORY = "https://github.com/Slatebox/slatebox";
const HOMEPAGE = "https://docs.slatebox.com/developers/slateboxapi/mcp/";

test("the npm manifest carries the listing fields for a 0.3.x release", () => {
  assert.match(manifest.version, /^0\.3\.\d+$/);
  assert.notEqual(manifest.version, "0.3.0", "0.3.0 is the archive without typed tools; a release with them needs a new version");
  assert.equal(manifest.mcpName, "com.slatebox/slatebox");
  assert.equal(manifest.description, DESCRIPTION);
  assert.deepEqual(manifest.keywords, KEYWORDS);
  assert.equal(manifest.homepage, HOMEPAGE);
  assert.deepEqual(manifest.repository, { type: "git", url: "git+" + REPOSITORY + ".git", directory: "packages/slatebox-mcp" });
  assert.deepEqual(manifest.bugs, { url: REPOSITORY + "/issues" });
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.name, "slatebox-mcp");
  assert.deepEqual(manifest.bin, { "slatebox-mcp": "src/cli.js", slatebox: "src/slatebox.js" });
});

test("server.json is valid for the MCP Registry and matches the package", () => {
  const schema = JSON.parse(registrySchema);
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.ok(validate(server), JSON.stringify(validate.errors, null, 2));
  assert.equal(server.$schema, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
  assert.equal(server.name, manifest.mcpName, "the registry checks mcpName in the npm package against this name");
  assert.equal(server.title, "Slatebox");
  assert.equal(server.description, "Mind maps, diagrams, project plans and presentations on a free, open-source team canvas.");
  assert.ok(server.description.length <= 100);
  assert.equal(server.version, manifest.version);
  assert.equal(server.websiteUrl, "https://slatebox.com");
  assert.deepEqual(server.repository, { url: REPOSITORY, source: "github", subfolder: "packages/slatebox-mcp" });

  assert.equal(server.packages.length, 1);
  const [pkg] = server.packages;
  assert.equal(pkg.registryType, "npm");
  assert.equal(pkg.identifier, manifest.name);
  assert.equal(pkg.version, manifest.version);
  assert.deepEqual(pkg.transport, { type: "stdio" });
  const env = Object.fromEntries(pkg.environmentVariables.map((v) => [v.name, v]));
  assert.equal(env.SLATEBOX_API_TOKEN.isSecret, true);
  assert.equal(env.SLATEBOX_API_TOKEN.isRequired, true);
  assert.equal(env.SLATEBOX_BASE_URL.isSecret, false);
  assert.equal(env.SLATEBOX_BASE_URL.default, "https://app.slatebox.com");

  assert.deepEqual(server.remotes, [{ type: "streamable-http", url: "https://app.slatebox.com/mcp" }]);
  for (const icon of server.icons) assert.match(icon.src, /^https:\/\/app\.slatebox\.com\//);
});

test("Miro is named only in the README's opening, beside the not-affiliated line", async () => {
  const opening = readme.split(/^## /m)[0];
  assert.match(opening, /\*\*Slatebox: the free, open-source team canvas\.\*\*/);
  assert.match(opening, /An open-source alternative to whiteboard tools such as Miro\./);
  assert.match(opening, /Not affiliated with or endorsed by Miro\. Miro is a trademark of its owner\./);
  assert.ok(readme.indexOf("Miro") < readme.indexOf("no sandbox"), "the product opening sits above the no-sandbox warning");
  assert.doesNotMatch(readme.slice(opening.length), /Miro/, "Miro appears only in the opening");
  assert.doesNotMatch(readme, /\b(better|only) (than|alternative)\b/i);

  const named = [manifest.name, manifest.description, manifest.mcpName, ...Object.keys(manifest.bin), server.name, server.title, server.description];
  for (const value of named) assert.doesNotMatch(value, /miro/i, value);
  assert.deepEqual(manifest.keywords.filter((k) => /miro/i.test(k)), ["miro-alternative"]);

  // Nothing the server sends an agent: the sources and the generated tool text.
  for (const dir of ["../src/", "../src/client/", "../src/exec/", "../generated/"]) {
    for (const entry of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      // typed-tools.js keeps the list of words the tool text is scanned for; that list is not tool text.
      const source = (await read(dir + entry.name)).replace(/PROMOTIONAL_WORDS = Object\.freeze\(\[[^\]]*\]\)/, "");
      assert.doesNotMatch(source, /\bMiro\b/i, dir + entry.name);
    }
  }
});

test("the README leads with connecting to the hosted endpoint, and installs this version", () => {
  const opening = readme.split(/^## /m)[0];
  assert.match(opening, /https:\/\/app\.slatebox\.com\/mcp/);
  assert.ok(readme.indexOf("https://app.slatebox.com/mcp") < readme.indexOf("## Install"), "the hosted address comes before installing");
  for (const [name] of readme.matchAll(/slatebox-mcp-\d+\.\d+\.\d+\.tgz/g)) assert.equal(name, `slatebox-mcp-${manifest.version}.tgz`);
});

test("npm pack would publish exactly the public files the release archive holds", async () => {
  const listed = JSON.parse(
    await new Promise((resolve, reject) =>
      execFile("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: new URL("..", import.meta.url) }, (error, stdout) =>
        error ? reject(error) : resolve(stdout))),
  );
  const packed = listed[0].files.map((f) => f.path).sort();
  const archive = [...packScript.match(/PUBLIC_FILES = \{([\s\S]*?)\n\}/)[1].matchAll(/^\s+"([^"]+)": 0o/gm)].map((m) => m[1]).sort();
  assert.deepEqual(packed, archive);
  assert.equal(listed[0].name, "slatebox-mcp");
  assert.equal(listed[0].version, manifest.version);
  for (const path of packed) assert.doesNotMatch(path, /^(test|fixtures)\/|server\.schema/);
  const modes = Object.fromEntries(listed[0].files.map((f) => [f.path, f.mode]));
  assert.equal(modes["src/cli.js"] & 0o111, 0o111, "slatebox-mcp is executable");
  assert.equal(modes["src/slatebox.js"] & 0o111, 0o111, "slatebox is executable");
});


// The repository's own README is the GitHub page: the same first line as the GitHub About text
// (listings/github-about.md) and, wherever Miro is named, the not-affiliated line.
test("the repository README opens with the positioning line and the not-affiliated line", async () => {
  const root = await read("../../../README.md");
  const opening = root.split(/^## /m).slice(0, 2).join("## ");
  assert.match(opening, /\*\*Slatebox: the free, open-source team canvas\.\*\*/);
  assert.match(opening, /An open-source alternative to whiteboard tools such as Miro\./);
  assert.match(opening, /Not affiliated with or endorsed by Miro\. Miro is a trademark of its owner\./);
  assert.equal(root.match(/Miro/g).length, opening.match(/Miro/g).length, "Miro appears only in the opening");
});
