// Plain money and time words for the billing components.
import { billingDate } from './billing-date.mjs'

export const dollars = cents => '$' + (cents / 100).toFixed(2)

// Hours left, as summary.credits words them: halves as ½, under an hour in minutes (to the nearest
// five, never "0 minutes"), none as "no".
export function hoursText(hours) {
  if (!hours || hours <= 0) return 'no'
  if (hours < 1) return `about ${Math.max(5, Math.round(hours * 12) * 5)} minutes`
  const whole = Math.floor(hours)
  const half = hours - whole >= 0.5
  if (whole === 1 && !half) return 'about 1 hour'
  return `about ${whole}${half ? '½' : ''} hours`
}

// The call hours left this month, as one phrase per kind: "about 1½ hours of four-person voice
// and no four-person video left this month" (never "no of four-person video").
const callPart = (hours, kind) => (hoursText(hours) === 'no' ? `no four-person ${kind}` : `${hoursText(hours)} of four-person ${kind}`)
export const callsLeftText = ({ voice, video }) => `${callPart(voice, 'voice')} and ${callPart(video, 'video')} left this month`

// Spending is shown to a tenth of a cent so a single AI draft is visible.
export function amountText(amount) {
  const sign = amount < 0 ? '' : '+'
  const abs = Math.abs(amount)
  const text = abs < 0.01 && abs > 0 ? '$' + abs.toFixed(4) : '$' + abs.toFixed(2)
  return amount < 0 ? text : sign + text
}

export function dayText(at) {
  return billingDate(at, 'short')
}

// The sentence before a refund: what goes back to the card and, if any of the balance has no
// card charge left to go back to, what is closed.
export function refundConfirmText({ balanceCents, refundableCents, team = false }) {
  const back = Math.min(refundableCents || 0, balanceCents || 0)
  const closed = Math.max(0, (balanceCents || 0) - back)
  const whose = team ? 'the team’s' : 'your'
  if (!closed) return `${dollars(back)} goes back to the card it came from, and ${whose} balance is closed at $0.00.`
  if (!back) return `None of ${whose} balance of ${dollars(balanceCents)} can go back to a card, so refunding closes all of it.`
  return `${dollars(back)} goes back to the card it came from. The other ${dollars(closed)} cannot go back to a card, so it is closed. ${team ? 'The team’s' : 'Your'} balance is then $0.00.`
}
