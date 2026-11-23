// Ask Slatebox's conversation, anchored at its foot: where to scroll when it grows.

/**
 * Where to scroll when the newest exchange is taller than the conversation's area (a long reply on a
 * phone): its start, the person's own words just above Slatebox's answer, so the question the answer
 * belongs to stays in sight, as chat apps do. Null when it fits: then the foot is in sight.
 */
export function newestTop(el) {
  const turns = el.querySelectorAll('[data-chat-turn]')
  const last = turns[turns.length - 1]
  if (!last) return null
  const before = turns[turns.length - 2]
  const start = last.dataset.chatTurn !== 'you' && before?.dataset.chatTurn === 'you' ? before : last
  const top = start.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
  return el.scrollHeight - top > el.clientHeight ? Math.max(0, top - 8) : null
}
