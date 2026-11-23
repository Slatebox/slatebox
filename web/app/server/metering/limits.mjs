// Rate limits on every metered method, per signed-in person and per network address, so one
// account or one machine with many accounts cannot drain the month's shared budget or their own Pro credits in a burst.
// Counts are per minute. meteor.js installs them with DDPRateLimiter (ddpRule).
import { isProxyAddress } from './client-address.mjs'

const AI = ['openai.chat', 'openai.welcome', 'openai.routeSlateMessage', 'workshops.draft', 'workshops.laneChat', 'workshops.mapChat',
  'nativeCanvas.preview', 'canvasConversation.preview', 'presentations.analyze', 'images.search', 'stabilityai.generate']
const CALLS = ['daily.join', 'daily.useVideo']
const MONEY = ['wallet.refund', 'pro.portal',
  // the pay sheet's Manage pane (server/pro-manage.mjs): changes to Pro itself
  'pro.switchInterval', 'pro.renewal']
// what Your Pro reads when it opens (the switch's preview, receipts) and the bank step's secret,
// asked again until the payment is in: reads that change nothing the webhook would not
const MANAGE_READS = ['pro.preview', 'pro.invoices', 'pro.actionSecret']
// payment sessions: the pay sheet makes one per amount or interval chosen (idempotent per attempt;
// nothing is charged until the person pays), so a person trying the amounts is not refused
const SESSIONS = ['wallet.createTopUp', 'pro.checkout', 'pro.cardSession']
// the return checks the pay sheet polls after a payment (every 1-2 s for about 15 s): each re-reads
// Stripe on the server and grants nothing the webhook would not
const CONFIRM = ['pro.confirm', 'wallet.confirmTopUp', 'pro.cardConfirm']
// saving a key: a few tries to fix a typo; asking for the confirmation email again
const KEYS = ['keys.save', 'users.sendVerification']

const rules = (methods, perUser, perAddress) => methods.flatMap(method => [
  { method, per: 'user', count: perUser, intervalMs: 60_000 },
  { method, per: 'address', count: perAddress, intervalMs: 60_000 },
])

export const METER_RATE_LIMITS = Object.freeze([
  // A guest account is free to make, and a guest gets a few presentation plans a day: one
  // address makes a bounded number of them (per connection is not enough: a reconnect is new).
  // The machine's own address (a developer's or a test run's) is not counted.
  { method: 'users.createAnonymous', per: 'address', count: 30, intervalMs: 10 * 60_000, exceptLocal: true },
  ...rules(AI, 20, 60),
  ...rules(CALLS, 10, 40),
  ...rules(MONEY, 3, 10),
  ...rules(SESSIONS, 10, 30),
  ...rules(MANAGE_READS, 20, 60),
  ...rules(CONFIRM, 20, 60),
  ...rules(KEYS, 6, 20),
])

// The DDPRateLimiter matcher for one rule. The per-person rule counts signed-in people only:
// Meteor keys it on the user id, so every signed-out caller would otherwise share one bucket
// (one public call's listeners refusing each other). The per-address rule counts real
// addresses only (client-address.mjs): a Cloudflare edge stands for many people, not one, and the
// cluster's own private address (the ingress, seen when no forwarded address is read) for everyone.
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
export function ddpRule(rule) {
  return rule.per === 'user'
    ? { type: 'method', name: rule.method, userId: userId => Boolean(userId) }
    : { type: 'method', name: rule.method, clientAddress: address => Boolean(address) && !isProxyAddress(address) && !(rule.exceptLocal && LOCAL.has(address)) }
}
