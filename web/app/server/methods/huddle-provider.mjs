// A public board can admit public listeners. The media room itself always
// requires an expiring, room-specific token obtained through the slate app.
// Who may start a call (and pay for it from their allowance) is decided by the meter;
// the grant only says who may be in one, with which media.
export function huddleGrant(record, user, transcriptionConfigured = false) {
  const slate = record?.slateBase
  if (!slate || (!user && !slate.options?.isPublic)) return null
  if (!['EDIT', 'COMMENT', 'READ'].includes(record.accessLevel)) return null
  const setting = slate.options?.huddleType ?? 'audio'
  if (!['audio', 'video'].includes(setting)) return null
  if (typeof slate.shareId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(slate.shareId)) return null
  const editable = record.accessLevel === 'EDIT'
  const speaking = record.accessLevel !== 'READ'
  const signedIn = Boolean(user && !user.isAnonymous)
  const name = signedIn ? [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(' ').trim() : ''
  return {
    shareId: slate.shareId,
    defaultMode: setting === 'video' ? 'video' : 'voice',
    displayName: (name || 'Guest').slice(0, 80),
    audioMuted: user?.profile?.audioMutedOnStart ?? true,
    // the call's mode narrows this: a voice call never sends camera tracks
    media: speaking ? ['audio', 'video'] : [],
    canStart: signedIn && speaking,
    canTranscribe: Boolean(user && editable && transcriptionConfigured),
  }
}

// Daily's REST API. The base URL is injectable so tests and the local smoke run use a stub.
// Rooms and tokens follow server/metering/calls.mjs: a room per call that expires unless
// the tick extends it, and room-scoped tokens.
export function dailyClient(fetch, apiKey, transcriptionKey, apiBase = 'https://api.daily.co/v1') {
  async function request(method, path, body) {
    return fetch(apiBase.replace(/\/+$/, '') + path, {
      method,
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      ...(body && { body: JSON.stringify(body) }),
    })
  }
  const roomPath = name => '/rooms/' + encodeURIComponent(name)

  // roomRequest: from calls.mjs roomRequest(); the transcription key is added here.
  async function createRoom(roomRequest) {
    const properties = { ...roomRequest.properties }
    if (transcriptionKey && !properties.enable_transcription) properties.enable_transcription = 'deepgram:' + transcriptionKey
    const result = await request('POST', '/rooms', { ...roomRequest, properties })
    if (!result.ok) throw new Error('Huddle room unavailable')
    const data = await result.json()
    if (data.name !== roomRequest.name || data.privacy !== 'private') throw new Error('Unexpected huddle room')
    const url = new URL(data.url)
    if (url.protocol !== 'https:' || url.pathname !== '/' + roomRequest.name) throw new Error('Invalid huddle room URL')
    return url.href
  }

  async function extendRoom(name, expAtMs) {
    const result = await request('POST', roomPath(name), { properties: { exp: Math.floor(expAtMs / 1000) } })
    if (!result.ok) throw new Error('Could not extend huddle room')
  }

  // The number of people in the room now, or null when Daily cannot say (never zero by default).
  async function presence(name) {
    try {
      const result = await request('GET', roomPath(name) + '/presence')
      if (!result.ok) return null
      const data = await result.json()
      if (Number.isFinite(data?.total_count)) return data.total_count
      return Array.isArray(data?.data) ? data.data.length : null
    } catch {
      return null
    }
  }

  async function deleteRoom(name) {
    const result = await request('DELETE', roomPath(name))
    if (!result.ok && result.status !== 404) throw new Error('Could not close huddle room')
  }

  async function token(tokenRequest) {
    const result = await request('POST', '/meeting-tokens', tokenRequest)
    if (!result.ok) throw new Error('Huddle token unavailable')
    const { token: value } = await result.json()
    if (typeof value !== 'string' || !value) throw new Error('Missing huddle token')
    return value
  }
  return { createRoom, extendRoom, presence, deleteRoom, token }
}
