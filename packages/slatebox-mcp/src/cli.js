#!/usr/bin/env node
// slatebox-mcp: the MCP server: exec and describe, one typed tool per client method, prompts
// and resources.
//   stdio (default)                 for agent hosts that start a command
//   --http [--port N]               loopback Streamable HTTP at http://127.0.0.1:N/mcp
//   --typed-tools on|off            list the typed tools (default on; or SLATEBOX_MCP_TYPED_TOOLS).
//                                   exec and describe are always listed.
//   exec | describe ...             the terminal commands (the same as `slatebox exec|describe`)
// SLATEBOX_API_TOKEN is your personal access token; SLATEBOX_BASE_URL (or --base-url) your
// Slatebox origin. A script runs in this process with your rights: there is no sandbox.
//
// This package names only the `slatebox-mcp` command. The `slatebox` command belongs to the npm
// package slatebox, which runs these same commands in its own process.
import { UsageError } from "./client/index.js";
import { run } from "./commands.js";
import { mcpHelp, startMcp } from "./mcp.js";

const argv = process.argv.slice(2);
if (argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help" || (!["exec", "describe"].includes(argv[0]) && (argv.includes("--help") || argv.includes("-h")))) {
  process.stdout.write(mcpHelp());
  process.exitCode = 0;
} else if (["exec", "describe"].includes(argv[0])) {
  process.exitCode = await run(argv, { name: "slatebox-mcp" });
} else {
  startMcp(argv).catch((error) => {
    process.stderr.write(`Slatebox MCP could not start: ${error.message}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  });
}
