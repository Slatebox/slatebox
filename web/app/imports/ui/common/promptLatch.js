/* Pure one-shot claim registry for auto-submitted AI prompts.

   WHY: the /start wizard hands its prompt to the canvas TWICE (query param
   + jotai atom) and the Chat component can execute its initWelcome effect
   more than once per canvas (mount timing around slate init, prop changes,
   remounts). In live run 3f04265bdf that produced TWO welcome chains and
   TWO kickoff pipelines for ONE user submit — double provider cost and a
   race between two pipelines mutating the same slate (one crashed with
   "Cannot read properties of null (reading 'id')" mid-apply).

   The latch is intentionally NOT React state: it must survive component
   unmount/remount for the lifetime of the page. Keyed by canvas + prompt;
   bounded to keep long SPA sessions from growing it.
*/
const claimed = new Set()
const MAX_CLAIMS = 200

export function claimPrompt(key) {
  if (!key) return false
  if (claimed.has(key)) return false
  if (claimed.size >= MAX_CLAIMS) {
    // Keep it bounded; oldest-insertion entries drop first (Set preserves
    // insertion order). Losing an old claim only risks a re-fire in a
    // multi-hour single-page session, which is acceptable.
    const oldest = claimed.values().next().value
    claimed.delete(oldest)
  }
  claimed.add(key)
  return true
}

// test hook
export function __resetPromptLatch() {
  claimed.clear()
}
