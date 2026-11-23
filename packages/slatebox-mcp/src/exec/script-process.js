// Runs one exec script in a child process of the MCP server or CLI, on the person's own
// machine. This is not a sandbox: the script has the person's rights, and can do anything the
// person's account can. The process exists so the parent can kill a stuck script, so the
// script's stdout and stderr are pipes the parent reads as logs (never the MCP stdio stream),
// and so a crash ends only this process.
//
// The generated prelude defines `slatebox`, `SlateboxError` and a buffering `console`, runs
// the caller's code and resolves to {ok:true, json, logs} or {ok:false, error, logs}. It needs
// one global, __slatebox.call(name, input), resolving to {ok:true,value} | {ok:false,error}.
import vm from "node:vm";

const pending = new Map();
let seq = 0;

const send = (message) => {
  if (process.connected) process.send(message);
};

process.on("message", (message) => {
  if (message?.t === "run") return void main(message.source);
  if (message?.t !== "reply") return;
  const resolve = pending.get(message.seq);
  if (!resolve) return;
  pending.delete(message.seq);
  resolve(message.envelope);
});

Object.defineProperty(globalThis, "__slatebox", { enumerable: false, value: Object.freeze({
  call(method, input) {
    let plain;
    try {
      plain = JSON.parse(JSON.stringify(input ?? {}));
    } catch (failure) {
      return Promise.resolve({ ok: false, error: { code: "invalid_request", status: 400, message: `${method} input is not JSON: ${failure.message}` } });
    }
    seq += 1;
    const n = seq;
    return new Promise((resolve) => {
      pending.set(n, resolve);
      send({ t: "call", seq: n, method: String(method), input: plain });
    });
  },
}) });

async function main(source) {
  let outcome;
  try {
    const script = new vm.Script(source, { filename: "run.js" });
    outcome = await script.runInThisContext();
  } catch (error) {
    // A syntax error, or a failure the prelude does not catch. Line 1 is the prelude.
    const at = /run\.js:(\d+)(?::(\d+))?/.exec(String(error?.stack ?? ""));
    const line = at && Number(at[1]) > 1 ? { line: Number(at[1]) - 1, ...(at[2] ? { column: Number(at[2]) } : {}) } : {};
    outcome = { ok: false, error: { code: "script_error", message: `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`, ...line }, logs: [] };
  }
  send({ t: "done", outcome, inFlight: pending.size });
}
