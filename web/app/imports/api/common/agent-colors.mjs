// Agents are drawn in colours people's cursors never use (the engine's AGENT_PALETTE; a test
// keeps the two lists the same). People get a random colour that is not close to any of them.
export const AGENT_COLORS = Object.freeze(['#6d28d9', '#0f766e', '#a16207', '#be185d', '#1d4ed8', '#4d7c0f'])

const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
const distance = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]))

/** Whether a #rrggbb colour is too close to an agent's to tell apart. */
export const nearAgentColor = (hex) => typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex) && AGENT_COLORS.some((agent) => distance(hex.toLowerCase(), agent) < 80)

/** A person's cursor colour: random, never an agent's. `random` answers #rrggbb. */
export function personColor(random) {
  for (let tries = 0; tries < 50; tries++) {
    const color = random()
    if (!nearAgentColor(color)) return color
  }
  // Nothing usable rolled: a dark slate that reads on white and is not near any agent's colour.
  return '#1f2937'
}
