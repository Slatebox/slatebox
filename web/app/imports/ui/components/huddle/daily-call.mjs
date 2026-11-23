// The page's one Daily call object, once a huddle has loaded Daily (HuddleIsland), or null before that.
// What runs outside the huddle (the huddle switch's AI-listening toggle, the AI listener) reaches the call
// here instead of through Daily's React hooks, so it never needs Daily loaded.
let call = null

export const dailyCall = () => call
export function setDailyCall(next) {
  call = next ?? null
}
