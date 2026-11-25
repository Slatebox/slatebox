// `slatebox-mcp --help` prints the help and exits 0 (0.4.0 refused it as an unknown option, exit 2,
// found by the published-installer end-to-end run).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const bin = fileURLToPath(new URL("../" + manifest.bin["slatebox-mcp"], import.meta.url));
const run = (args) => new Promise((resolve) => {
  execFile(process.execPath, [bin, ...args], { env: { PATH: process.env.PATH }, timeout: 20_000 }, (error, stdout, stderr) =>
    resolve({ code: error ? error.code : 0, stdout, stderr }));
});

for (const flag of ["--help", "-h", "help"]) {
  test(`slatebox-mcp ${flag} prints the help and exits 0`, async () => {
    const result = await run([flag]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^Usage: slatebox-mcp \[--base-url ORIGIN\] \[--typed-tools on\|off\] \[--http \[--port N\]\]/);
    assert.match(result.stdout, /SLATEBOX_API_TOKEN is your personal access token/);
    assert.equal(result.stderr, "");
  });
}

test("slatebox-mcp --http --help is help too, not a server", async () => {
  const result = await run(["--http", "--help"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Usage: slatebox-mcp/);
});

test("an unknown option is still a usage error (exit 2)", async () => {
  const result = await run(["--nope"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Usage: slatebox-mcp/);
});
