// The paths whose handlers read their own raw request body (express.json would consume it), each
// checked against a signature over the exact bytes sent:
//   /hooks/recipes/<hookId>       a recipe's inbound webhook (Slatebox-Signature, enterprise/server/recipes/webhooks)
//   /integrations/github/events   the Slatebox GitHub App's events (X-Hub-Signature-256)
//   /integrations/google/watch    Google Drive's change pings (a per-channel token)
export const RAW_BODY_PREFIXES = Object.freeze(['/hooks/recipes/', '/integrations/github/events', '/integrations/google/watch'])

/** Whether a path's body stays unread for its own signature check. */
export const isRawBodyPath = (path) => typeof path === 'string' && RAW_BODY_PREFIXES.some((prefix) => path.startsWith(prefix))
