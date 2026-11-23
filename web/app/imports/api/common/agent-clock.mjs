// Agents' times on a screen whose clock is not the server's (agentPresence.forSlate sends the
// server's time beside the records).

// How far this screen's clock is from the server's, in ms (server minus screen), read from the
// publication's clock record the moment it arrives. Remembered per server time sent.
const offsets = new Map()
export function clockOffset(clock, screenNow = Date.now()) {
  if (!Number.isFinite(clock?.serverNow)) return 0
  if (!offsets.has(clock.serverNow)) {
    offsets.clear()
    offsets.set(clock.serverNow, clock.serverNow - screenNow)
  }
  return offsets.get(clock.serverNow)
}

/** A record's times moved onto this screen's clock: expiresAt and endedAt are the server's. */
export function onScreenClock(record, offset) {
  if (!offset) return record
  const shift = (value) => (value === undefined || value === null ? value : new Date(new Date(value).getTime() - offset))
  return { ...record, expiresAt: shift(record.expiresAt), endedAt: shift(record.endedAt), updatedAt: shift(record.updatedAt) }
}

