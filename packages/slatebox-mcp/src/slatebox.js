#!/usr/bin/env node
// slatebox: run a script against your Slatebox, or learn the client it uses.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { apiOrigin, createClient, DEFAULT_ORIGIN, SlateboxError, UsageError } from "./client/index.js";
import { runLocal, runRemote, summaryLine } from "./exec/index.js";
import { ExecInputError } from "./exec/result.js";
import { describe } from "./describe.js";
import { defaultGenerated } from "./generated.js";

const help = `Usage:
  slatebox exec FILE | - | -e CODE  [--intent TEXT] [--preview] [--confirm ID]
                                    [--idempotency-key KEY] [--remote] [--json] [--base-url ORIGIN]
  slatebox describe [QUERY] [--method NAME ...] [--json]
  slatebox help

exec runs a JavaScript or TypeScript script. The global \`slatebox\` is a typed client for
what your token may do: slatebox.slates.get({ shareId }), and so on. Top-level await and
return work; the returned value is printed as JSON. Use - to read the script from standard
input, or -e to pass it inline. describe lists the methods; describe --method NAME prints
a method's TypeScript declaration.

The script runs here, on your machine, with your rights: there is no sandbox. Each call it
makes through slatebox is checked by your Slatebox exactly as if you made it yourself, and
the rules below apply to those calls only: a script that reads your token and calls the API
some other way is not held or recorded. --remote sends the script to your Slatebox instead,
where it runs in a sealed runner and every rule holds for everything it does.

--preview runs every write as a preview and saves nothing: each write is sent as a preview, a
write that cannot be previewed is refused here, and nothing is sent to a Slatebox that does not
run exec scripts. A script that deletes notes,
rewrites more than 10 notes' text in all, changes notes someone else wrote, or shares more widely
is held for confirmation: on a terminal you are asked; otherwise the command to confirm is
printed. --idempotency-key reuses a run's key so its saved calls replay instead of repeating.

Set SLATEBOX_API_TOKEN to a personal access token. Set SLATEBOX_BASE_URL or pass
--base-url ORIGIN for a self-hosted instance (default ${DEFAULT_ORIGIN}).
Without --json: one summary line on stderr and the result as JSON on stdout.
With --json: the whole exec result on stdout.
Exit codes: 0 completed, 1 other failure, 2 usage, 3 sign-in, 4 access, 5 refused (409/422),
6 confirmation required, 7 the script failed.
`;

const exitFor = (status) => ({ 401: 3, 403: 4, 404: 4, 409: 5, 422: 5 })[status] ?? 1;

function parse(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: {
      help: { type: "boolean", short: "h" },
      e: { type: "string", short: "e" },
      intent: { type: "string" },
      preview: { type: "boolean" },
      confirm: { type: "string" },
      "idempotency-key": { type: "string" },
      remote: { type: "boolean" },
      json: { type: "boolean" },
      "base-url": { type: "string" },
      method: { type: "string", multiple: true },
    } });
  } catch {
    throw new UsageError("Unknown option or missing option value.");
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (values.help || command === "help" || command === undefined) return { command: "help" };
  if (command === "describe") {
    if (rest.length > 1) throw new UsageError("describe takes at most one QUERY. Quote a query with spaces.");
    for (const name of ["e", "intent", "preview", "confirm", "idempotency-key", "remote", "base-url"])
      if (values[name] !== undefined) throw new UsageError(`--${name} goes with exec.`);
    return { command, query: rest[0], methods: values.method, json: values.json };
  }
  if (command !== "exec") throw new UsageError("Choose exec, describe or help.");
  if (values.method !== undefined) throw new UsageError("--method goes with describe.");
  if (values.e !== undefined && rest.length) throw new UsageError("Pass FILE, - or -e CODE, not more than one.");
  if (values.e === undefined && rest.length !== 1) throw new UsageError("Pass the script as FILE, - for standard input, or -e CODE.");
  return {
    command,
    source: values.e !== undefined ? { inline: values.e } : { file: rest[0] },
    intent: values.intent,
    mode: values.preview ? "preview" : "save",
    confirm: values.confirm,
    idempotencyKey: values["idempotency-key"],
    remote: Boolean(values.remote),
    json: Boolean(values.json),
    baseUrl: values["base-url"],
  };
}

function readCode(source) {
  if (source.inline !== undefined) return source.inline;
  try { return readFileSync(source.file === "-" ? 0 : source.file, "utf8"); }
  catch { throw new UsageError(source.file === "-" ? "Could not read the script from standard input." : "Could not read the script file."); }
}

const shellQuote = (text) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`);

/** The same command with --confirm and --idempotency-key set: what a person runs to confirm. */
function confirmCommand(argv, id, key) {
  const kept = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--confirm" || arg === "--idempotency-key") { i += 1; continue; }
    if (arg.startsWith("--confirm=") || arg.startsWith("--idempotency-key=")) continue;
    kept.push(arg);
  }
  return ["slatebox", ...kept, "--confirm", id, "--idempotency-key", key].map(shellQuote).join(" ");
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try { return (await rl.question(question)).trim().toLowerCase(); } finally { rl.close(); }
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parse(argv);
  if (args.command === "help") { process.stdout.write(help); return 0; }
  const generated = defaultGenerated();
  if (args.command === "describe") {
    const out = await describe({ query: args.query, methods: args.methods }, { generated });
    if (args.json) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    else if (out.methods.some((m) => m.dts)) process.stdout.write(out.methods.map((m) => m.dts).join("\n\n") + "\n\n" + out.types + "\n");
    else process.stdout.write(out.methods.map((m) => `${m.name.padEnd(28)} ${m.title}`).join("\n") + "\n");
    return 0;
  }
  const token = process.env.SLATEBOX_API_TOKEN;
  if (!token) throw new UsageError("Set SLATEBOX_API_TOKEN to a personal access token.");
  const baseUrl = apiOrigin(args.baseUrl ?? process.env.SLATEBOX_BASE_URL ?? DEFAULT_ORIGIN);
  const code = readCode(args.source);
  const intent = args.intent ?? `slatebox exec ${args.source.inline !== undefined ? "-e" : args.source.file}`.slice(0, 200);
  const run = (extra = {}) => {
    const input = { code, intent, mode: args.mode, confirm: args.confirm, idempotencyKey: args.idempotencyKey, baseUrl, token, ...extra };
    return args.remote ? runRemote(input) : runLocal({ ...input, generated });
  };
  let result = await run();
  if (result.status === "confirmation_required") {
    const { id, reasons } = result.confirmation;
    process.stderr.write(summaryLine(result) + "\n");
    for (const reason of reasons)
      process.stderr.write(`  call ${reason.n}: ${reason.rule}${reason.shareId ? " on " + reason.shareId : ""}${reason.count !== undefined ? ` (${reason.count})` : ""}\n`);
    if (process.stdin.isTTY && process.stderr.isTTY && args.source.file !== "-") {
      if ((await ask("Save anyway? [y/N] ")) === "y") result = await run({ confirm: id, idempotencyKey: result.idempotencyKey });
    } else {
      process.stderr.write("To save, run:\n  " + confirmCommand(argv, id, result.idempotencyKey) + "\n");
      if (args.source.file === "-") process.stderr.write("  with the same script on standard input.\n");
      if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return 6;
    }
  }
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stderr.write(summaryLine(result) + "\n");
    if (result.status === "completed") process.stdout.write(JSON.stringify(result.result ?? null, null, 2) + "\n");
    else if (result.logs?.length) process.stderr.write(result.logs.join("\n") + "\n");
  }
  return { completed: 0, failed: 7, confirmation_required: 6 }[result.status] ?? 1;
}

const token = process.env.SLATEBOX_API_TOKEN;
const redact = (text) => (token ? text.replaceAll(token, "[redacted]") : text);
// A script or an untrusted endpoint could echo the token; it never reaches the terminal.
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => write(typeof chunk === "string" ? redact(chunk) : chunk, ...rest);
}

main().then((code) => { process.exitCode = code; }, (error) => {
  const api = error instanceof SlateboxError;
  const status = api ? `HTTP ${error.status} ${error.code}: ` : "";
  process.stderr.write(`slatebox: ${status}${error.message}\n`);
  if (api && error.details !== undefined) process.stderr.write(JSON.stringify(error.details, null, 2) + "\n");
  const usage = error instanceof UsageError || error instanceof ExecInputError;
  if (usage) process.stderr.write("Run slatebox help for usage.\n");
  process.exitCode = usage ? 2 : api ? exitFor(error.status) : 1;
});
