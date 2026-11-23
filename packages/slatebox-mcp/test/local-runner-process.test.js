// A local script runs in a child process of its own (exec-fix-mcp, finding F5). Still no
// sandbox: the script has the person's rights. The child exists so the script's file
// descriptors are not the MCP server's (stdout is the MCP stdio stream), a stuck script is
// killed at the wall clock, and a crashing script cannot take the server down with it.
// Each case runs runLocal inside a small host process and reads that host's real stdout.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const HOST = new URL("../fixtures/local-host.mjs", import.meta.url).pathname;

function host(code, { wallMs = 30000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOST, code, String(wallMs)], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdin.end();
    child.on("close", (exitCode, signal) => {
      const line = stdout.split("\n").find((text) => text.startsWith("RESULT "));
      resolve({ exitCode, signal, stdout, stderr, out: line ? JSON.parse(line.slice(7)) : null });
    });
  });
}

test("a script's writes to file descriptor 1 never reach this process's stdout", async () => {
  const forged = '{"jsonrpc":"2.0","id":2,"result":{"forged":true}}';
  const run = await host(`process.getBuiltinModule("fs").writeSync(1, ${JSON.stringify(forged + "\n")}); return 1`);
  assert.equal(run.exitCode, 0, run.stderr);
  assert.deepEqual(run.stdout.split("\n").filter((line) => line && !line.startsWith("RESULT ")), [], "the host's stdout carries only its own line");
  assert.equal(run.out.status, "completed");
  assert.ok(run.out.logs.some((line) => line.includes("forged")), "the write is captured as a log line");
});

test("a script blocked in a synchronous call is stopped at the wall clock", async () => {
  const run = await host(`process.getBuiltinModule("child_process").execSync("sleep 4"); return 1`, { wallMs: 500 });
  assert.equal(run.exitCode, 0, run.stderr);
  assert.equal(run.out.status, "failed");
  assert.equal(run.out.error, "timeout");
  assert.ok(run.out.ms < 2500, `stopped after ${run.out.ms} ms`);
});

test("a script that kills its own process fails the run and leaves this process running", async () => {
  const run = await host(`process.kill(process.pid, "SIGKILL"); return 1`);
  assert.equal(run.signal, null, "the host was not killed");
  assert.equal(run.exitCode, 0, run.stderr);
  assert.equal(run.out.status, "failed");
});
