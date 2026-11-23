// Reads the files generated from the Slatebox action registry (exec-plan 3.3). The package
// never lists actions by hand: every client method, the exec and describe tool definitions,
// the rules, limits, recipes and the guest prelude come from here, so an action the app adds
// appears without a package edit.
import { readFileSync } from "node:fs";

const DEFAULT_DIR = new URL("../generated/", import.meta.url);

// guest-client.js declares `export const PRELUDE = "<json string>"` and TRAILER likewise.
function readConstant(text, name) {
  const match = new RegExp(`export const ${name} = ("(?:[^"\\\\]|\\\\.)*")`).exec(text);
  if (!match) throw new Error(`guest-client.js does not export ${name}.`);
  return JSON.parse(match[1]);
}

export function loadGenerated(dir = DEFAULT_DIR) {
  const read = (name) => readFileSync(new URL(name, dir), "utf8");
  const manifest = JSON.parse(read("client.json"));
  const tools = JSON.parse(read("exec-tool.json"));
  const guest = read("guest-client.js");
  const methods = new Map(manifest.methods.map((method) => [method.name, method]));
  return { manifest, methods, tools, prelude: readConstant(guest, "PRELUDE"), trailer: readConstant(guest, "TRAILER") };
}

let cached;
export function defaultGenerated() {
  cached ??= loadGenerated();
  return cached;
}
