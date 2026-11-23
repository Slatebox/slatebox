// slatebox-mcp --http: the same two tools over Streamable HTTP, for agent hosts that connect by
// URL. A script runs in this process with no sandbox, so this listener answers only:
//   - on loopback (127.0.0.1), never another interface;
//   - requests whose Host and any Origin are loopback (no DNS rebinding from a web page);
//   - requests that carry, as a bearer token, the Slatebox token this process was started with.
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { UsageError } from "./client/index.js";

export const LOOPBACK_HOST = "127.0.0.1";
const BODY_LIMIT = 128 * 1024;
const LOOPBACK_NAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

const digest = (text) => createHash("sha256").update(String(text)).digest();
export function sameToken(given, expected) {
  return typeof given === "string" && given.length > 0 && timingSafeEqual(digest(given), digest(expected));
}

function loopbackHost(value, port) {
  if (!value) return false;
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(value.toLowerCase());
  return Boolean(match) && LOOPBACK_NAMES.has(match[1]) && (match[2] === undefined || Number(match[2]) === port);
}
function loopbackOrigin(value, port) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && loopbackHost(url.host, port);
  } catch { return false; }
}

const answer = (res, status, code, message, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify({ error: { code, message } }));
};

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error("The request body is too large."), { status: 413, code: "payload_too_large" });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("The request body is not valid JSON."), { status: 400, code: "invalid_json" }); }
}

/**
 * Start the loopback MCP listener. createServerForRequest() returns a fresh MCP server per
 * request (stateless). Resolves with {server, port, url, close}.
 */
export async function startHttp({ host = LOOPBACK_HOST, port = 0, token, createServerForRequest }) {
  if (host !== LOOPBACK_HOST) throw new UsageError(`--http listens on ${LOOPBACK_HOST} only: a script runs on this machine with your rights.`);
  if (!token) throw new UsageError("SLATEBOX_API_TOKEN is required.");
  let bound = port;
  const listener = createServer(async (req, res) => {
    try {
      if (!loopbackHost(req.headers.host, bound)) return answer(res, 403, "forbidden_host", "This listener answers loopback hosts only.");
      if (req.headers.origin !== undefined && !loopbackOrigin(req.headers.origin, bound))
        return answer(res, 403, "forbidden_origin", "This listener refuses requests from web pages.");
      const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
      if (!auth || !sameToken(auth[1], token))
        return answer(res, 401, "unauthorized", "Send the Slatebox token this listener was started with as a bearer token.", { "www-authenticate": "Bearer" });
      const path = new URL(req.url, "http://" + LOOPBACK_HOST).pathname;
      if (path !== "/mcp") return answer(res, 404, "unknown_route", "The MCP endpoint is /mcp.");
      if (req.method !== "POST") return answer(res, 405, "method_not_allowed", "Use POST.", { allow: "POST" });
      const body = await readJson(req);
      const server = createServerForRequest();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (!res.headersSent) answer(res, error.status ?? 500, error.code ?? "internal_error", error.status ? error.message : "The request could not be completed.");
    }
  });
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(port, host, resolve);
  });
  bound = listener.address().port;
  return {
    server: listener,
    port: bound,
    url: `http://${LOOPBACK_HOST}:${bound}/mcp`,
    close: () => new Promise((resolve) => listener.close(resolve)),
  };
}
