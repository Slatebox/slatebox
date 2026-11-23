// The local runner (exec-plan 8.1): an exec script runs on the person's own machine, with
// no sandbox, in a child process of the MCP server or CLI (script-process.js). The child is not
// a boundary the script cannot cross: it has the person's rights. It exists so the script's
// stdout is not the MCP stdio stream, a stuck script is killed at the wall clock, and a script
// that crashes takes only its own process down. Each client call is an HTTP request to the person's Slatebox with their token
// and the Slatebox-Exec-* headers; the server applies every script rule (preview, confirm
// before save, call caps, derived idempotency keys, audit). This file implements no rule
// except the local limits below, which the server enforces as well.
import { createHash, randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { defaultGenerated } from "../generated.js";
import { sendCall } from "../client/index.js";
import { assembleResult, validateExecInput } from "./result.js";

/** The published limits (client.json limits), as the local runner applies them. */
export function localLimits(generated = defaultGenerated()) {
  const { wallSeconds, callsPerScript, callsInFlight, resultChars, logKiB } = generated.manifest.limits;
  return Object.freeze({ wallMs: wallSeconds * 1000, maxCalls: callsPerScript, callsInFlight, resultChars, logBytes: logKiB * 1024, maxOldGenerationSizeMb: 256 });
}

const WRAP_OPEN = "(async () => {";
const WRAP_CLOSE = "\n})()";

// stripTypeScriptTypes announces itself as experimental on stderr; that line is not the
// person's business, and the CLI keeps stderr to one summary line.
function quietStrip(source) {
  const emit = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    const text = typeof warning === "string" ? warning : warning?.message;
    if (/stripTypeScriptTypes|Type Stripping/i.test(String(text))) return;
    return emit.call(process, warning, ...rest);
  };
  try {
    return stripTypeScriptTypes(source, { mode: "strip" });
  } finally {
    process.emitWarning = emit;
  }
}

/** The caller's code as one async function body; TypeScript is stripped in place (same lines). */
export function prepareSource({ prelude, trailer }, code) {
  const body = "\n" + code + WRAP_CLOSE;
  const plain = (text) => text.slice(0, -WRAP_CLOSE.length);
  let parsed = body;
  try {
    new vm.Script(WRAP_OPEN + body);
  } catch (syntax) {
    if (!(syntax instanceof SyntaxError)) throw syntax;
    try {
      // Strip the wrapped text so top-level await and return parse; whitespace keeps positions.
      parsed = quietStrip(WRAP_OPEN + body).slice(WRAP_OPEN.length);
    } catch {
      parsed = body; // not TypeScript either: the script process reports the JavaScript syntax error
    }
  }
  // The prelude is one line, inside the wrapper, so the caller's line 1 is the file's line 2.
  return WRAP_OPEN + prelude + plain(parsed) + trailer + WRAP_CLOSE;
}

const SCRIPT_PROCESS = fileURLToPath(new URL("./script-process.js", import.meta.url));
// The script's environment is empty, as on the server; Windows needs SystemRoot to start Node.
const scriptEnv = () => (process.platform === "win32" && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {});

const headerSafe = (text) => encodeURIComponent(text).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

// The script rules (preview, confirm before save, the audit record) are the server's. A
// Slatebox that does not run exec would take each call as an ordinary API call and save it, a
// preview run's writes included, so nothing is sent until the instance says it runs exec:
// GET /api/v1/instance names exec's limits (limits.exec). A yes is kept for ten minutes.
const EXEC_INSTANCE_MS = 10 * 60 * 1000;
const execInstances = new Map();
const INSTANCE_ROUTE = { name: "instance.describe", kind: "read", http: { method: "GET", path: "/api/v1/instance", pathParams: [], queryParams: [], bodyParams: [] } };

export async function checkExecInstance({ baseUrl, token, fetchImpl = fetch, now = Date.now }) {
  if ((execInstances.get(baseUrl) ?? 0) > now()) return null;
  const answer = await sendCall({ baseUrl, token, fetchImpl, method: INSTANCE_ROUTE, input: {} });
  if (answer.ok && answer.body?.limits?.exec) {
    execInstances.set(baseUrl, now() + EXEC_INSTANCE_MS);
    return null;
  }
  if (!answer.ok && [0, 401, 429].includes(answer.status)) return answer.error;
  return { code: "exec_unavailable", status: answer.status,
    message: `${baseUrl} does not run exec scripts (GET /api/v1/instance names no exec limits), so nothing was sent. Point --base-url or SLATEBOX_BASE_URL at a Slatebox that runs exec.` };
}

/**
 * Run a script locally. Throws {code:'invalid_request'} for bad exec input; otherwise always
 * resolves with the exec result (status completed, failed or confirmation_required).
 */
export async function runLocal({ code, intent, mode = "save", confirm, idempotencyKey, baseUrl, token, fetchImpl = fetch,
  generated = defaultGenerated(), limits = localLimits(generated) }) {
  validateExecInput({ code, intent, mode, confirm, idempotencyKey });
  const execId = randomUUID();
  const execKey = idempotencyKey ?? execId;
  const codeSha256 = createHash("sha256").update(code).digest("hex");
  const baseHeaders = {
    "slatebox-exec-id": execId,
    "slatebox-exec-key": execKey,
    "slatebox-exec-code-sha256": codeSha256,
    "slatebox-exec-mode": mode,
    "slatebox-exec-intent": headerSafe(intent),
    ...(confirm ? { "slatebox-exec-confirm": confirm } : {}),
  };
  const started = Date.now();
  const state = { calls: [], responses: [], logs: [], held: null, outcome: null };
  const unavailable = await checkExecInstance({ baseUrl, token, fetchImpl });
  if (unavailable)
    return assembleResult({ execId, mode, execKey, outcome: { ok: false, error: unavailable }, calls: [], responses: [],
      logs: [], held: null, limits, wallMs: Date.now() - started });
  const source = prepareSource(generated, code);

  const child = fork(SCRIPT_PROCESS, [], {
    env: scriptEnv(),
    // Our own flags only: the host's (--test, --input-type, an inspector) are not the script's.
    execArgv: [`--max-old-space-size=${limits.maxOldGenerationSizeMb}`],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    serialization: "json",
  });
  const toScript = (message) => {
    if (child.connected) child.send(message, (failure) => void failure);
  };
  // Node reports a heap overflow on stderr before it aborts.
  let outOfMemory = false;
  let stderrTail = "";
  child.stderr.on("data", (chunk) => {
    stderrTail = (stderrTail + chunk).slice(-256);
    if (/heap out of memory|allocation failed/i.test(stderrTail)) outOfMemory = true;
  });
  const capture = (stream, prefix) => {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        state.logs.push(prefix + buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    });
    stream.on("end", () => { if (buffer) state.logs.push(prefix + buffer); });
  };
  capture(child.stdout, "");
  capture(child.stderr, "stderr: ");

  const inFlight = new Set();
  let count = 0;
  // At most callsInFlight requests at once, as in the sealed runner; the rest wait their turn.
  const maxInFlight = Number.isSafeInteger(limits.callsInFlight) && limits.callsInFlight > 0 ? limits.callsInFlight : 1;
  let active = 0;
  const waiting = [];
  const takeSlot = () => (active < maxInFlight ?(active += 1, Promise.resolve()) : new Promise((resolve) => waiting.push(resolve)));
  const giveSlot = () => { const next = waiting.shift(); if (next) next(); else active -= 1; };
  let finished;
  const done = new Promise((resolve) => { finished = resolve; });
  const finish = (outcome) => {
    if (state.outcome) return;
    state.outcome = outcome;
    finished();
  };

  async function call({ seq, method: name, input }) {
    count += 1;
    if (count > limits.maxCalls) {
      finish({ ok: false, error: { code: "call_limit", message: `A script may make ${limits.maxCalls} calls.` } });
      return;
    }
    const method = generated.methods.get(name);
    const t0 = Date.now();
    if (!method) {
      state.calls.push({ n: seq, method: name, mode: null, ok: false, status: 404, code: "unknown_method", ms: 0 });
      toScript({ t: "reply", seq, envelope: { ok: false, error: { code: "unknown_method", status: 404, message: `There is no method ${name}. Call describe.` } } });
      return;
    }
    // A preview run previews every write here as well as on the server: each write is sent as a
    // preview, and a write that cannot be previewed is refused before it is sent.
    let sent = input;
    if (mode === "preview" && method.kind === "write") {
      if (!(method.modes ?? []).includes("preview")) {
        state.calls.push({ n: seq, method: name, mode: "preview", ok: false, status: 400, code: "preview_unavailable", ms: 0 });
        toScript({ t: "reply", seq, envelope: { ok: false, error: { code: "preview_unavailable", status: 400,
          message: `${name} cannot be previewed, so this preview run stops here.`, details: { method: name } } } });
        return;
      }
      // Not one plain object: the server refuses it as it stands.
      if (input && typeof input === "object" && !Array.isArray(input)) sent = { ...input, mode: "preview" };
    }
    await takeSlot();
    let outcome;
    try {
      outcome = await sendCall({ baseUrl, token, fetchImpl, method, input: sent,
        headers: { ...baseHeaders, "slatebox-exec-call": String(seq) } });
    } finally {
      giveSlot();
    }
    const record = { n: seq, method: name, mode: null, ok: outcome.ok, status: outcome.status };
    if (method.kind === "write") record.mode = outcome.body?.mode ?? (mode === "preview" ? "preview" : input?.mode ?? "save");
    if (!outcome.ok) record.code = outcome.error.code;
    const heldId = outcome.headers.get("slatebox-exec-held");
    if (heldId) {
      record.held = true;
      const details = outcome.error?.details ?? {};
      state.held ??= {
        id: heldId,
        ...(details.expiresAt ? { expiresAt: details.expiresAt } : {}),
        reasons: (details.reasons ?? []).map((reason) => ({ n: seq, ...reason })),
      };
    }
    if (outcome.headers.get("idempotent-replayed") === "true") record.replayed = true;
    record.ms = Date.now() - t0;
    state.calls.push(record);
    if (outcome.ok) state.responses.push({ method, body: outcome.body });
    toScript({ t: "reply", seq, envelope: outcome.ok ? { ok: true, value: outcome.body } : { ok: false, error: outcome.error } });
  }

  child.on("message", (message) => {
    if (message?.t === "call") {
      const pendingCall = call(message).catch((failure) => finish({ ok: false, error: { code: "internal_error", message: failure.message } }));
      inFlight.add(pendingCall);
      pendingCall.finally(() => inFlight.delete(pendingCall));
    } else if (message?.t === "done") {
      const { outcome } = message;
      state.logs.unshift(...(Array.isArray(outcome?.logs) ? outcome.logs.map(String) : []));
      if (outcome?.ok && message.inFlight > 0) {
        finish({ ok: false, error: { code: "detached_call", message: "The script returned while a call was still running. Await every call." } });
      } else if (outcome?.ok) {
        finish({ ok: true, json: outcome.json === null ? "null" : String(outcome.json) });
      } else {
        finish({ ok: false, error: { code: "script_error", message: "The script failed.", ...outcome?.error } });
      }
    }
  });
  child.on("error", (error) => finish({ ok: false, error: { code: "script_error", message: `The script could not start: ${error?.message ?? error}` } }));
  // The process ended before it said done: read its stderr to the end to say why.
  const ended = () => finish({ ok: false, error: outOfMemory
    ? { code: "memory", message: "The script ran out of memory." }
    : { code: "script_error", message: "The script stopped unexpectedly." } });
  child.once("exit", () => setTimeout(ended, 500).unref());
  const closed = new Promise((resolve) => child.once("close", () => { ended(); resolve(); }));
  const timer = setTimeout(() => finish({ ok: false, error: { code: "timeout", message: `The script ran past ${limits.wallMs / 1000} s.` } }), limits.wallMs);
  toScript({ t: "run", source });

  await done;
  clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  // Its output is read to the end, unless something it started still holds the pipes open.
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 1000).unref())]);
  child.stdout.destroy();
  child.stderr.destroy();
  // Calls already sent finish, so the result lists every request that reached the server.
  await Promise.allSettled([...inFlight]);

  return assembleResult({ execId, mode, execKey, outcome: state.outcome, calls: state.calls, responses: state.responses,
    logs: state.logs, held: state.held, limits, wallMs: Date.now() - started });
}
