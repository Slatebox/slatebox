// Exec entry points. runLocal: the script runs here, in this process, with no sandbox (the
// person's own machine). runRemote: the script is sent to POST /api/v1/exec and runs in the
// instance's sealed runner.
import { defaultGenerated } from "../generated.js";
import { SlateboxError, sendCall } from "../client/index.js";
import { runLocal, localLimits } from "./local-runner.js";
import { validateExecInput } from "./result.js";

export { runLocal, localLimits };
export { summaryLine, ExecInputError } from "./result.js";

const EXEC_ROUTE = { name: "exec.run", kind: "write", http: { method: "POST", path: "/api/v1/exec", pathParams: [], queryParams: [], bodyParams: [] } };

export async function runRemote({ code, intent, mode = "save", confirm, idempotencyKey, baseUrl, token, fetchImpl = fetch }) {
  validateExecInput({ code, intent, mode, confirm, idempotencyKey });
  const outcome = await sendCall({ baseUrl, token, fetchImpl, method: EXEC_ROUTE,
    input: { intent, code, mode, confirm, idempotencyKey } });
  if (!outcome.ok) throw new SlateboxError(outcome.error);
  return outcome.body;
}

/** The exec function the MCP server calls: local unless remote is true. */
export function createExec({ baseUrl, token, fetchImpl = fetch, generated = defaultGenerated(), remote = false }) {
  return (args) => (remote
    ? runRemote({ ...args, baseUrl, token, fetchImpl })
    : runLocal({ ...args, baseUrl, token, fetchImpl, generated }));
}
