// The paths whose handlers read their own raw request body (express.json would consume it): Slack's
// events, interactivity and commands, which are checked against Slack's signature over the exact
// bytes it sent (enterprise/server/slack/verify.mjs).
export const RAW_BODY_PREFIXES = Object.freeze(['/integrations/slack/'])

/** Whether a path is Slack's (its body stays unread for its own signature check). */
export const isSlackPath = (path) => typeof path === 'string' && RAW_BODY_PREFIXES.some((prefix) => path.startsWith(prefix))
