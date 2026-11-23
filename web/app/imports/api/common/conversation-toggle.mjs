// "Ask Slatebox" works as soon as its button is in sight (the header's, or the bar's under a narrow
// canvas). A slate may open its conversation by itself as it loads, but the conversation's code
// arrives on its own (a lazy chunk), so on a slow line the button is there, pressed, before the
// conversation is. Until it is in sight, and for a moment after (the time a person takes to see it),
// a tap means what the person saw: "open it". Closing it then would lose the tap.
//
// `arrival` is null, or the conversation the slate opened by itself: { shownAt } with shownAt null
// until it first shows (ConversationPanel marks it). Any tap ends the arrival.
export const ARRIVAL_SETTLE_MS = 800

/** Whether the conversation is open after a tap on its button. */
export function toggledConversation({ open, arrival, now }) {
  if (!open) return true
  if (arrival && (arrival.shownAt == null || now - arrival.shownAt < ARRIVAL_SETTLE_MS)) return true
  return false
}

/** The arrival once the conversation shows: marked in sight the first time only. */
export function arrivalShown(arrival, now) {
  return arrival && arrival.shownAt == null ? { shownAt: now } : arrival
}
