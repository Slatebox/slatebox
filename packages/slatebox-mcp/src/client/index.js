// The typed HTTP client, built at runtime from generated/client.json: one method per bound
// action, named by its action id (slatebox.slates.get(input)). Types: generated/slatebox.d.ts.
// Use it in your own code (an AI SDK tool, a script). Outside an exec run it sends no
// Slatebox-Exec-* headers, so each call is an ordinary API call.
import { readFileSync } from "node:fs";
import { defaultGenerated } from "../generated.js";

// Every call names this package (the server counts calls per client, never their content).
const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
export const USER_AGENT = `slatebox-mcp/${version}`;

export class SlateboxError extends Error {
  constructor({ code = "error", status = 0, message, details, retryAfter } = {}) {
    super(message || `Slatebox returned HTTP ${status}.`);
    this.name = "SlateboxError";
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

export class UsageError extends Error {}

/** Slatebox Cloud: the app serves /api/v1 and /mcp. A self-hosted instance passes its own origin. */
export const DEFAULT_ORIGIN = "https://app.slatebox.com";

/** An http(s) origin with nothing after it. */
export function apiOrigin(input) {
  let url;
  try { url = new URL(input); } catch { throw new UsageError("Invalid Slatebox API origin."); }
  if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
    throw new UsageError("Supply an HTTP or HTTPS origin without credentials, path, query or fragment.");
  }
  return url.origin;
}

const isPlainObject = (value) => {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Where each input field travels: path, query or body, from the manifest's http layout. */
export function buildRequest(baseUrl, method, input) {
  const { http } = method;
  let path = http.path;
  const rest = { ...input };
  for (const name of http.pathParams) {
    if (rest[name] === undefined || rest[name] === null) {
      throw new SlateboxError({ code: "invalid_request", status: 400, message: `${method.name} needs ${name}.`, details: { field: name } });
    }
    const segment = String(rest[name]);
    // encodeURIComponent leaves "." and ".." as they are, and a URL normalises them away.
    if (segment === "." || segment === "..") {
      throw new SlateboxError({ code: "invalid_request", status: 400, message: `${method.name}: ${name} cannot be "${segment}".`, details: { field: name } });
    }
    path = path.replace(`{${name}}`, encodeURIComponent(segment));
    delete rest[name];
  }
  const takesBody = !["GET", "DELETE"].includes(http.method);
  const query = new URLSearchParams();
  // A field the route does not carry in its body goes in the query, where the server refuses
  // it by name. Nothing is dropped silently.
  for (const [name, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    if (!takesBody || http.queryParams.includes(name)) {
      query.append(name, typeof value === "string" ? value : JSON.stringify(value));
      delete rest[name];
    }
  }
  const url = baseUrl + path + (query.size ? "?" + query : "");
  const init = { method: http.method, headers: {} };
  if (takesBody) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(rest);
  }
  return { url, init };
}

function retryAfterSeconds(payload, response) {
  const stated = payload?.error?.retryAfter ?? response.headers.get("retry-after");
  const seconds = Number(stated);
  return stated !== null && stated !== undefined && Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/**
 * One HTTP call. Returns {ok, status, body, headers} and never throws for an HTTP refusal:
 * a refusal comes back as {ok:false, error:{code,status,message,details?,retryAfter?}}.
 */
export async function sendCall({ baseUrl, token, fetchImpl = fetch, method, input, headers = {} }) {
  const { url, init } = buildRequest(baseUrl, method, input);
  init.headers = { ...init.headers, "user-agent": USER_AGENT, authorization: `Bearer ${token}`, ...headers };
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (failure) {
    return { ok: false, status: 0, headers: new Headers(), error: { code: "network_error", status: 0, message: "Slatebox could not be reached: " + (failure?.message || "network error") } };
  }
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = undefined; }
  if (payload === undefined) {
    return { ok: false, status: response.status, headers: response.headers,
      error: { code: "not_json", status: response.status, message: "The endpoint did not return JSON. Check the Slatebox API origin." } };
  }
  if (!response.ok) {
    const error = { code: payload.error?.code || "http_" + response.status, status: response.status,
      message: payload.error?.message || `Slatebox returned HTTP ${response.status}.` };
    if (payload.error?.details !== undefined) error.details = payload.error.details;
    const retryAfter = retryAfterSeconds(payload, response);
    if (retryAfter !== undefined) error.retryAfter = retryAfter;
    return { ok: false, status: response.status, headers: response.headers, error };
  }
  return { ok: true, status: response.status, headers: response.headers, body: payload };
}

/**
 * createClient({baseUrl, token}) returns the namespace tree: client.slates.get({shareId}).
 * Each method takes one plain object; an optional second argument {idempotencyKey} sets the
 * Idempotency-Key header for an ordinary API call (exec scripts never pass keys: theirs are derived).
 */
export function createClient({ baseUrl = DEFAULT_ORIGIN, token, fetch: fetchImpl = fetch, generated = defaultGenerated() } = {}) {
  if (!token) throw new UsageError("SLATEBOX_API_TOKEN is required.");
  const origin = apiOrigin(baseUrl.replace(/\/$/, "") + "/");
  const tree = {};
  for (const method of generated.methods.values()) {
    const parts = method.name.split(".");
    let node = tree;
    for (const part of parts.slice(0, -1)) node = node[part] ??= {};
    node[parts.at(-1)] = async (input = {}, options = {}) => {
      if (!isPlainObject(input)) throw new SlateboxError({ code: "invalid_request", status: 400, message: `${method.name} takes one plain object.` });
      const headers = options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {};
      const outcome = await sendCall({ baseUrl: origin, token, fetchImpl, method, input, headers });
      if (!outcome.ok) throw new SlateboxError(outcome.error);
      return outcome.body;
    };
  }
  const freeze = (node) => { for (const value of Object.values(node)) if (typeof value === "object") freeze(value); return Object.freeze(node); };
  return freeze(tree);
}
