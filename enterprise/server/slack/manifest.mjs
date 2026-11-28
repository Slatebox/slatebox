// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The Slack app Slatebox signs people in with, as a Slack app manifest (api.slack.com/apps › Create
// New App › From a manifest), and the scopes it asks for. Least scopes, each with a reason a reviewer
// can test:
//   user token (reads and writes as the person who connected, only what they can see):
//     search:read       search_messages (search.messages): "@Slack what did we decide about pricing"
//     channels:read     list_channels and #name → channel id (conversations.list), public channels
//     groups:read       the same for private channels the person is in
//     channels:history  read_channel and read_thread (conversations.history / replies), public channels
//     groups:history    the same for private channels the person is in
//     im:history        read_thread on a direct-message permalink the person pastes
//     mpim:history      read_thread on a group direct-message permalink the person pastes
//     users:read        the authors' names (users.info): notes say "Ana:", never "U0123"
//     chat:write        post_message, only after the person approves its card on the slate
//     reactions:write   add_reaction, only after the person approves its card on the slate
//   bot token (one per workspace, the in-Slack features):
//     links:read        link_shared for this server's slate links
//     links:write       chat.unfurl: a slate's preview (its name and picture only when it is public)
//     commands          the "Send to slate" message shortcut and the /slatebox command
// No token rotation: Slack's tokens then do not expire; they are revoked on disconnect, on account
// deletion, and dropped when Slack says they were revoked or the app was removed.
export const SLACK_USER_SCOPES = Object.freeze(['search:read', 'channels:read', 'groups:read', 'channels:history', 'groups:history', 'im:history', 'mpim:history', 'users:read', 'chat:write', 'reactions:write'])
export const SLACK_BOT_SCOPES = Object.freeze(['links:read', 'links:write', 'commands'])
// Events sent for the people who connected (their user token's channels:history and groups:history):
// new messages in the channels they are in, which recipes fold into a channel's ledger
// (enterprise/server/recipes/vendors/slack/ingest.mjs). Not limited like conversations.history.
export const SLACK_USER_EVENTS = Object.freeze(['message.channels', 'message.groups'])
export const SLACK_PATHS = Object.freeze({ events: '/integrations/slack/events', interactive: '/integrations/slack/interactive', commands: '/integrations/slack/commands' })
export const SLACK_CALLBACKS = Object.freeze({ sendToSlate: 'send_to_slate' })

const LONG = 'Slatebox is a free, open-source team canvas. Connect Slack once, then ask about your channels and threads from a slate. Answers land as suggested notes you keep or discard. Posting to Slack always waits for your approval. Slate links posted in Slack show a preview, but only for public slates. Use Send to slate on any message to put it on a slate. The agent can be inaccurate, so check important details against the original messages. Slatebox never trains models on Slack data.'

/**
 * The manifest for this server (origin: its public https address). name and command differ only for a
 * second app on the same workspace (a test server's "Slatebox Test" and /slatebox-test).
 * redirects: extra redirect URLs (another server that signs in with this same app).
 */
export function slackManifest({ origin, name = 'Slatebox', command = '/slatebox', redirects = [] }) {
  const base = String(origin || '').replace(/\/+$/, '')
  const host = (() => {
    try {
      return new URL(base).host
    } catch {
      return ''
    }
  })()
  return {
    _metadata: { major_version: 2, minor_version: 1 },
    display_information: {
      name,
      description: 'Bring Slack threads onto a shared canvas your team edits.',
      long_description: LONG,
      background_color: '#1d2330',
    },
    features: {
      bot_user: { display_name: name, always_online: false },
      unfurl_domains: [host],
      shortcuts: [{ name: 'Send to slate', type: 'message', callback_id: SLACK_CALLBACKS.sendToSlate, description: 'Put this message on a Slatebox slate you pick.' }],
      slash_commands: [{ command, url: base + SLACK_PATHS.commands, description: 'Find one of your slates', usage_hint: '[slate name]', should_escape: false }],
    },
    oauth_config: {
      redirect_urls: [base + '/connectors/oauth/callback', ...redirects.filter((r) => r !== base + '/connectors/oauth/callback')],
      scopes: { user: [...SLACK_USER_SCOPES], bot: [...SLACK_BOT_SCOPES] },
      pkce_enabled: false,
    },
    settings: {
      event_subscriptions: { request_url: base + SLACK_PATHS.events, bot_events: ['link_shared', 'app_uninstalled', 'tokens_revoked'], user_events: [...SLACK_USER_EVENTS] },
      interactivity: { is_enabled: true, request_url: base + SLACK_PATHS.interactive },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
      is_mcp_enabled: false,
    },
  }
}
