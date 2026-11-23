// A stand-in for the MCP server process: runs one script with runLocal and writes one RESULT
// line to its own stdout. argv: <code> <wallMs>
import { runLocal, localLimits } from "../src/exec/local-runner.js";

const [code, wallMs] = process.argv.slice(2);
// A Slatebox that runs exec: /api/v1/instance names exec's limits; every other call answers a slate.
const fetchImpl = async (url) => new Response(JSON.stringify(new URL(url).pathname === "/api/v1/instance"
  ? { view: "account", limits: { exec: { callsPerScript: 64 } } } : { shareId: "demo" }), { status: 200, headers: { "content-type": "application/json" } });
const started = Date.now();
const out = await runLocal({ code, intent: "Probe", baseUrl: "http://127.0.0.1:9", token: "sbx_t", fetchImpl,
  limits: { ...localLimits(), wallMs: Number(wallMs) } });
process.stdout.write("RESULT " + JSON.stringify({ status: out.status, error: out.error?.code, result: out.result, logs: out.logs, ms: Date.now() - started }) + "\n");
