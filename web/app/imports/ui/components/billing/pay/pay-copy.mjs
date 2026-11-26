// The pay sheet's words (design §5, §8). Pure, so the copy rules are tested (scripts/pay-sheet.test.mjs).
// Never the processor's name, and none of the words the no-plans and no-conversion guards ban.
import { billingDate } from '../billing-date.mjs'
import { proPriceWords } from '../../../../api/pro/prices.mjs'

// The Pro choices, said from the one place Pro's prices are written (pro/prices.mjs; the server
// sells only a Stripe price equal to it). scripts/pay-sheet.test.mjs checks them against the catalogue.
const proChoice = (interval, more) => Object.freeze({ cents: proPriceWords(interval).cents, label: proPriceWords(interval).label, ...more })
export const PRO_FIGURES = Object.freeze({
  month: proChoice('month', { sub: 'Cancel any time', line: 'Slatebox Pro, monthly', tag: null }),
  year: proChoice('year', { sub: 'One payment a year', line: 'Slatebox Pro, yearly', tag: '2 months free' }),
})

export const money = cents => `$${((cents || 0) / 100).toFixed(2)}`
const wholeMoney = cents => (cents % 100 ? money(cents) : `$${cents / 100}`)
const halves = hours => (hours % 1 ? `${Math.floor(hours) || ''}½` : String(hours))
const hoursOf = hours => `${halves(hours)} ${hours === 1 ? 'hour' : 'hours'}`

/** "What Pro brings" and "Now included each month": three rows from meter.summary credits. */
export function proBrings(credits, { perMonth = true } = {}) {
  if (!credits) return []
  return [
    { icon: 'ai', text: `About ${credits.draftsPerMonth} AI drafts${perMonth ? ' a month' : ''}, up to ${credits.draftsPerDay} a day` },
    { icon: 'picture', text: 'Image search and image generation' },
    { icon: 'video', text: `About ${hoursOf(credits.voiceHours)} of four-person voice calls and ${hoursOf(credits.videoHours)} of video` },
  ]
}

// What the person was doing when the sheet opened (usePaySheet().open({ from })).
const GOALS = {
  draft: { title: 'Keep drafting with Slatebox AI', back: 'Back to your draft', again: 'your draft is ready to go again' },
  call: { title: 'Start your call', back: 'Back to your call', again: 'your call is ready to start again' },
  pictures: { title: 'Search for pictures', back: 'Back to your slate', again: 'your picture search is ready to run again' },
  image: { title: 'Make your image', back: 'Back to your slate', again: 'your image is ready to make again' },
  plan: { title: 'Plan your presentation', back: 'Back to your slate', again: 'your plan is ready to make again' },
  agents: { title: 'Invite your agent', back: 'Back to your slate', again: 'your agent is ready to join' },
  voice: { title: 'Talk with the agent', back: 'Back to your conversation', again: 'voice is ready to turn on again' },
}

/** The sheet's eyebrow and heading. */
export function sheetHeader({ action, from, wallet, balanceCents = 0 } = {}) {
  if (action === 'topup') {
    const team = wallet === 'team'
    return { eyebrow: `${team ? 'Team balance' : 'Your balance'} · ${money(balanceCents)}`, title: team ? 'Top up the team balance' : 'Top up your balance' }
  }
  if (action === 'manage') return { eyebrow: 'Slatebox Pro', title: 'Your Pro' }
  if (action === 'card') return { eyebrow: 'Slatebox Pro', title: 'Update your card' }
  if (action === 'pro') return { eyebrow: 'Slatebox Pro', title: GOALS[from]?.title || 'Get Slatebox Pro' }
  if (action === 'business') return { eyebrow: 'Slatebox Business', title: 'Get Slatebox Business for your team' }
  return { eyebrow: 'Slatebox', title: 'Before you pay' }
}

/** A refusal's reason as the top-up "why" note: the sheet is already where to top up. */
export const whyText = reason => String(reason || '').replace(/\s+in your profile(?=[.!]?\s*$)/i, '').trim()

/**
 * The Welcome's words. kind: 'pro' | 'topup' | 'card' | 'switch'. confirmed: meter.summary shows it
 * (until then the finalizing words). variant: 'pending' (15 s and not confirmed) | 'processing'.
 * → { title, lead, button, burst, announce, included, countUp }
 */
export function welcomeCopy({ kind = 'pro', from = 'profile', firstPro = false, confirmed = false, variant = null, amountCents = 0, pastDueCleared = false, interval = 'year', nextDate = null } = {}) {
  const goal = GOALS[from]
  const button = goal?.back || 'Done'
  const out = { title: '', lead: '', button, burst: false, announce: '', included: false, countUp: null }
  if (variant === 'pending') {
    const pending = {
      topup: ['Payment received', 'Payment received. Your balance updates in a moment.'],
      business: ['Welcome to Slatebox Business', 'Payment received. Business switches on for your team in a moment.'],
    }[kind] || ['Welcome to Slatebox Pro', 'Payment received. Pro switches on in a moment.']
    return { ...out, title: pending[0], lead: pending[1], button: 'Close', announce: 'Payment received' }
  }
  if (variant === 'processing') {
    return { ...out, title: 'Payment on its way', lead: "Thank you. Your bank is still processing the payment. We'll tell you when it clears.", button: 'Close', announce: 'Payment is processing' }
  }
  if (kind === 'topup') {
    const lead = goal ? `Thank you. ${goal.again[0].toUpperCase()}${goal.again.slice(1)}.` : 'Thank you. It never expires, and what is left can be refunded from your profile.'
    return { ...out, title: `${wholeMoney(amountCents)} is in your balance`, lead: confirmed ? lead : 'Thank you. Your payment went through. Adding it to your balance…', button: confirmed ? button : 'Getting things ready…', countUp: amountCents, announce: confirmed ? `${wholeMoney(amountCents)} is in your balance.` : 'Payment went through' }
  }
  if (kind === 'card') {
    return { ...out, title: 'Your card is updated', lead: pastDueCleared ? 'Thank you. Pro is back on, and your next payment uses this card.' : 'Your next payment uses this card.', button: confirmed ? button : 'Getting things ready…', announce: confirmed ? 'Your card is updated.' : 'Card saved' }
  }
  if (kind === 'business') {
    return {
      ...out,
      title: 'Welcome to Slatebox Business',
      lead: confirmed ? 'Thank you. Business is on for everyone in your team. Manage it on the team page.' : 'Thank you. Your payment went through. Switching Business on for your team…',
      button: confirmed ? button : 'Getting things ready…',
      announce: confirmed ? 'Welcome to Slatebox Business. Business is on for your team.' : 'Payment went through',
    }
  }
  if (kind === 'switch') {
    const yearly = interval === 'year'
    const when = billingDate(nextDate) || null
    return { ...out, title: yearly ? "You're on yearly now" : "You're on monthly now", lead: when ? `Pro next renews on ${when}.` : 'Thank you.', button, announce: yearly ? "You're on yearly now." : "You're on monthly now." }
  }
  return {
    ...out,
    title: 'Welcome to Slatebox Pro',
    lead: confirmed ? `Thank you. Pro is on for your account${goal ? `, and ${goal.again}` : ''}.` : 'Thank you. Your payment went through. Switching Pro on for your account…',
    button: confirmed ? button : 'Getting things ready…',
    burst: Boolean(firstPro),
    announce: confirmed ? 'Welcome to Slatebox Pro. Pro is on.' : 'Payment went through',
    included: true,
  }
}

// A guest's email in the Pro sheet (no sign-up first): it names the receipt and, after the payment, the account.
export const BUYER_EMAIL = Object.freeze({
  label: 'Email',
  help: 'For your receipt and your account. No password needed now.',
  invalid: 'Enter an email address like name@example.com.',
})
export const buyerEmailValid = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/\.invalid$/i.test(value)

/**
 * What a guest's email did after paying (server/pro-claim.mjs claim: { kind, email }), as the Welcome's
 * optional next step. 'attached': the account is theirs now; a password is offered, never required.
 * 'existing': the address already has an account; a link went there, nobody was signed in.
 * → { kind, title, lead, action?, skip? } | null
 */
export function claimCopy(claim) {
  if (!claim?.email) return null
  if (claim.kind === 'attached') {
    return {
      kind: 'attached',
      title: 'Keep your slates on every device',
      lead: `Your account is ${claim.email}. We sent a link there to confirm it. Choose a password to sign in anywhere, now or later from your profile.`,
      action: 'Save password',
      skip: 'Not now',
      saved: 'Password saved. Sign in with it on any device.',
    }
  }
  if (claim.kind === 'existing') {
    return {
      kind: 'existing',
      title: 'One more step, when you like',
      lead: `${claim.email} already has a Slatebox account, so we sent it a link. Open it to move Slatebox Pro and these slates into that account, and use Pro there from then on.`,
    }
  }
  return null
}

// ---------- Slatebox Business (a team's purchase, server/business-billing.mjs) ----------
// No Business amount is written here: the sheet shows the amounts the server read from Stripe
// (business.offer), and words that would name one link the pricing page instead.

/** An amount in the smallest unit of a currency, as people read it: whole amounts without cents, in the currency Stripe gave. */
export function moneyIn(cents, currency = 'usd') {
  const whole = Number.isInteger(cents) && cents % 100 === 0
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'usd').toUpperCase(), minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format((cents || 0) / 100)
  } catch {
    return money(cents)
  }
}

const peopleWord = n => `${n} ${n === 1 ? 'person' : 'people'}`

/** One choice in the Business pane, from a price the server read: { label, sub, line, totalCents }. */
export function businessChoice(price, members) {
  if (!price) return null
  const each = moneyIn(price.unitAmount, price.currency)
  const per = price.interval === 'year' ? 'a year' : 'a month'
  const totalCents = price.unitAmount * members
  return {
    label: `${each} per person ${per}`,
    sub: `${moneyIn(totalCents, price.currency)} ${per} for ${peopleWord(members)}`,
    line: `Slatebox Business, ${price.interval === 'year' ? 'yearly' : 'monthly'} × ${peopleWord(members)}`,
    totalCents,
  }
}

/** What Business brings, in the sheet and on the team page. */
export const BUSINESS_BRINGS = Object.freeze([
  Object.freeze({ icon: 'ai', text: 'A shared AI and call pool for the team: each member adds what Slatebox Pro includes' }),
])

/** The fine print under the Business Pay button. */
export const businessFine = interval => `Charged ${interval === 'year' ? 'yearly' : 'monthly'} for each member of the team. Adding or removing a member changes the next payment, prorated. Stop any time from the team page.`
