// The exec input checks and the exec result shape (exec-plan 6.1), shared by the local runner,
// the MCP tools and the CLI.

export class ExecInputError extends Error {
  constructor(message, field) {
    super(message);
    this.code = "invalid_request";
    this.status = 400;
    if (field) this.details = { field };
  }
}

const KEY = /^[!-~]{1,128}$/;
const CONFIRM = /^cf_[A-Za-z0-9]{24}$/;
export const EXEC_FIELDS = ["intent", "code", "mode", "confirm", "idempotencyKey"];

export function validateExecInput({ code, intent, mode = "save", confirm, idempotencyKey }) {
  if (typeof intent !== "string" || intent.trim().length < 1 || intent.length > 200)
    throw new ExecInputError("intent is one sentence of 1–200 characters a person can approve.", "intent");
  if (!intent.isWellFormed()) throw new ExecInputError("intent must be well-formed text (it has a lone surrogate).", "intent");
  if (typeof code !== "string" || code.length < 1 || code.length > 65536)
    throw new ExecInputError("code is 1–65,536 characters of JavaScript or TypeScript.", "code");
  if (!["save", "preview"].includes(mode)) throw new ExecInputError('mode is "save" or "preview".', "mode");
  if (confirm !== undefined && (typeof confirm !== "string" || !CONFIRM.test(confirm)))
    throw new ExecInputError("confirm is the cf_… id from a confirmation_required result.", "confirm");
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || !KEY.test(idempotencyKey)))
    throw new ExecInputError("idempotencyKey is 1–128 printable characters without spaces.", "idempotencyKey");
}

function capLogs(lines, limit) {
  const kept = [];
  let size = 0;
  for (const line of lines) {
    const cost = Buffer.byteLength(line) + 1;
    if (size + cost > limit) {
      kept.push(`[logs cut at ${Math.round(limit / 1024)} KiB]`);
      return kept;
    }
    kept.push(line);
    size += cost;
  }
  return kept;
}

function countWrites(responses) {
  let operations = 0;
  let notesCreated = 0;
  for (const { method, body } of responses) {
    if (method.kind !== "write" || !Array.isArray(body?.operations)) continue;
    operations += body.operations.length;
    for (const op of body.operations)
      if (op?.kind === "add_nodes") notesCreated += Array.isArray(op.nodes) ? op.nodes.length : Number.isInteger(op.count) ? op.count : 1;
  }
  return { operations, notesCreated };
}

export function assembleResult({ execId, mode, execKey, outcome, calls, responses, logs, held, limits, wallMs }) {
  const result = { execId, status: "completed", mode, idempotencyKey: execKey };
  if (held) {
    result.status = "confirmation_required";
  } else if (outcome.ok) {
    if (outcome.json.length > limits.resultChars) {
      result.result = outcome.json.slice(0, limits.resultChars);
      result.truncated = { chars: outcome.json.length };
    } else {
      result.result = JSON.parse(outcome.json);
    }
  } else {
    result.status = "failed";
    const { code, message, line, column, status, details } = outcome.error;
    result.error = { code, message, ...(Number.isInteger(line) ? { line } : {}), ...(Number.isInteger(column) ? { column } : {}),
      ...(Number.isInteger(status) ? { status } : {}), ...(details !== undefined ? { details } : {}) };
  }
  result.logs = capLogs(logs, limits.logBytes);
  result.calls = [...calls].sort((a, b) => a.n - b.n);
  if (held) result.confirmation = held;
  // cpuMs is measured by the sealed runner only; a local script shares this process's CPU.
  result.usage = { calls: calls.length, maxCalls: limits.maxCalls, ...countWrites(responses), wallMs };
  return result;
}

/** One line a person can read: "completed · 2 calls: slates.get 200, slates.applyOperations 201 save". */
export function summaryLine(result) {
  const calls = result.calls ?? [];
  const list = calls.map((c) => [c.method, c.status, c.mode].filter((x) => x !== null && x !== undefined).join(" ")).join(", ");
  let line = `${result.status} · ${calls.length} call${calls.length === 1 ? "" : "s"}${list ? ": " + list : ""}`;
  if (result.error) line += ` · ${result.error.code}: ${result.error.message}${result.error.line ? ` (line ${result.error.line})` : ""}`;
  if (result.confirmation) line += ` · confirm ${result.confirmation.id}: ${result.confirmation.reasons.map((r) => r.rule).join(", ")}`;
  return line;
}
