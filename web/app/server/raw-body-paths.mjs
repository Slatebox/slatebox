// The paths whose handlers read their own raw request body (express.json would consume it), each
// checked against a signature over the exact bytes sent:
//   /hooks/recipes/<hookId>       a recipe's inbound webhook (Slatebox-Signature, enterprise/server/recipes/webhooks)
//   /integrations/github/events   the Slatebox GitHub App's events (X-Hub-Signature-256)
//   /integrations/google/watch    Google Drive's change pings (a per-channel token)
//   /integrations/slack/          Slack's events, interactivity and commands (Slack's signature,
//                                 enterprise/server/slack/verify.mjs)
//   /integrations/linear/events   Linear's webhook for recipes (Linear-Signature, enterprise/server/recipes/vendors/linear)
export const SLACK_PREFIX = '/integrations/slack/'
export const RAW_BODY_PREFIXES = Object.freeze(['/hooks/recipes/', '/integrations/github/events', '/integrations/google/watch', SLACK_PREFIX, '/integrations/linear/events'])

/** Whether a path's body stays unread for its own signature check. */
export const isRawBodyPath = (path) => typeof path === 'string' && RAW_BODY_PREFIXES.some((prefix) => path.startsWith(prefix))

/** Whether a path is Slack's. */
export const isSlackPath = (path) => typeof path === 'string' && path.startsWith(SLACK_PREFIX)
