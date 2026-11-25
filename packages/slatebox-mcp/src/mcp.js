#!/usr/bin/env node
// slatebox-mcp: the MCP server: exec and describe, one typed tool per client method, prompts
// and resources.
//   stdio (default)                 for agent hosts that start a command
//   --http [--port N]               loopback Streamable HTTP at http://127.0.0.1:N/mcp
//   --typed-tools on|off            list the typed tools (default on; or SLATEBOX_MCP_TYPED_TOOLS).
//                                   exec and describe are always listed.
// SLATEBOX_API_TOKEN is your personal access token; SLATEBOX_BASE_URL (or --base-url) your
// Slatebox origin. A script runs in this process with your rights: there is no sandbox.
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { apiOrigin, createClient, DEFAULT_ORIGIN, UsageError } from "./client/index.js";
import { createExec } from "./exec/index.js";
import { defaultGenerated } from "./generated.js";
import { createSlateboxMcpServer } from "./server.js";
import { startHttp } from "./http-server.js";
import { typedToolsEnabled } from "./typed-tools.js";

export const DEFAULT_HTTP_PORT = 3917;

/** What every tool answers when the server started without a token. */
function tokenRequired() {
  return Object.assign(new Error("No Slatebox token: set SLATEBOX_API_TOKEN to a personal access token from your Slatebox and restart this server. The prompts work without one."), { code: "sign_in_required", status: 401 });
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({ args: process.argv.slice(2), options: {
      http: { type: "boolean" }, port: { type: "string" }, host: { type: "string" }, "base-url": { type: "string" },
      "typed-tools": { type: "string" },
    } }));
  } catch {
    throw new UsageError("Usage: slatebox-mcp [--base-url ORIGIN] [--typed-tools on|off] [--http [--port N]]");
  }
  const typedOption = values["typed-tools"] ?? process.env.SLATEBOX_MCP_TYPED_TOOLS;
  if (typedOption !== undefined && typedOption !== "" && !/^(on|off|true|false|1|0|yes|no)$/i.test(String(typedOption).trim()))
    throw new UsageError("--typed-tools (or SLATEBOX_MCP_TYPED_TOOLS) is on or off.");
  const typedTools = typedToolsEnabled(typedOption);
  const token = process.env.SLATEBOX_API_TOKEN;
  const baseUrl = apiOrigin(values["base-url"] || process.env.SLATEBOX_BASE_URL || DEFAULT_ORIGIN);
  const generated = defaultGenerated();
  if (!token) {
    // No Slatebox yet: the prompts and the client docs still work;
    // every tool answers that it needs a token. The HTTP server always needs one: it is the bearer.
    if (values.http) throw new UsageError("Set SLATEBOX_API_TOKEN to a personal access token.");
    if (values.port !== undefined || values.host !== undefined) throw new UsageError("--port and --host go with --http.");
    process.stderr.write("SLATEBOX_API_TOKEN is not set: the prompts and the client docs work; the tools need a personal access token.\n");
    const exec = async () => { throw tokenRequired(); };
    await createSlateboxMcpServer({ exec, generated, typedTools }).connect(new StdioServerTransport());
    return;
  }
  const client = createClient({ baseUrl, token, generated });
  const exec = createExec({ baseUrl, token, generated });
  const instance = client.instance?.describe ? () => client.instance.describe({}) : undefined;
  const createServerForRequest = () => createSlateboxMcpServer({ exec, generated, instance, typedTools });
  if (!values.http) {
    if (values.port !== undefined || values.host !== undefined) throw new UsageError("--port and --host go with --http.");
    await createServerForRequest().connect(new StdioServerTransport());
    return;
  }
  const port = values.port === undefined ? DEFAULT_HTTP_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError("--port is a port number.");
  const listening = await startHttp({ host: values.host ?? "127.0.0.1", port, token, createServerForRequest });
  process.stderr.write(`Slatebox MCP listening at ${listening.url} (loopback only; send your Slatebox token as the bearer token)\n`);
}

main().catch((error) => {
  process.stderr.write(`Slatebox MCP could not start: ${error.message}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
