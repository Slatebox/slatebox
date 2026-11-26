// What collaborators.init hands a canvas: who this person is to their peers on the slate (a name, a
// colour, a key counted once across their tabs) and, when the collaboration relay is set up and the
// person may open the slate, the token to join its room (relay-token.mjs). Without the relay's key
// pair (settings.slateboxAPI) the details still come back, with no credential: the canvas keeps
// working, its visit is recorded and its saves go through; only live editing between people waits
// for the relay.
//
// access is relayAccess's answer (relay-access.mjs): { code, role, room }. Only code 'ok' gets
// relay params, for that room and role; anything else gets none and says why in relayCode.
// The old bearer/timestamp credential is valid on every room, never expires and writes, so it is
// off by default. Only with the rollout override settings.relay.legacy === true does it ride
// along, for engines that do not send the token yet (the relay takes it only with
// RELAY_ALLOW_LEGACY=true), and then only to a person the access check gave write: a viewer, a
// slate's picture (readOnly) or anyone refused never gets it.
import { collabCredential } from './api-signature.mjs'
import { mintRoomToken } from './relay-token.mjs'
import { personKeyFor } from './person-key.mjs'
import { guestNameFor, personCursorColour } from '../../imports/api/common/guest-name.mjs'

const isKey = (value) => typeof value === 'string' && value.length > 0

export const legacyRelayAllowed = (settings) => settings?.relay?.legacy === true

/** The relay params for one room and role: { token, exp }, and with the override, for write, the legacy pair. */
export function relayParams({ settings, access, now, legacy = legacyRelayAllowed(settings) }) {
  const { publicKey, secretKey } = settings?.slateboxAPI ?? {}
  if (!isKey(publicKey) || !isKey(secretKey) || access?.code !== 'ok') return null
  const { token, exp } = mintRoomToken({ publicKey, secretKey, room: access.room, role: access.role,
    ...(now ? { now: now.valueOf() } : {}) })
  if (!legacy || access.role !== 'write') return { token, exp }
  // The legacy credential is signed with the Slatebox API key over a stamp that is never an ISO
  // instant, so it cannot be replayed as a signed HTTP hook request (api-signature.mjs).
  const { bearer, timestamp } = collabCredential({ publicKey, secretKey, ...(now ? { now: new Date(now.valueOf()) } : {}) })
  return { token, exp, bearer, timestamp }
}

export default function collaboratorDetails({ user, userId, id, shareId, settings, fallbackSecret, now, access }) {
  const { publicKey, secretKey } = settings?.slateboxAPI ?? {}
  const relay = isKey(publicKey) && isKey(secretKey)
  const wsParams = relay ? relayParams({ settings, access, now }) : null
  // A visitor browsing an unlisted or public slate may have no user at all.
  const person = user || { _id: 'guest', isAnonymous: true }
  const { isAnonymous } = person
  // Each of a person's tabs on this slate gets the same key, colour and name, so peers count them
  // once and every viewer (and every pointer on the canvas) calls them the same.
  const personKey = personKeyFor({
    userId: userId || null,
    visitorId: typeof id === 'string' ? id.slice(0, 64) : '',
    slate: typeof shareId === 'string' ? shareId.slice(0, 64) : '',
  }, relay ? secretKey : fallbackSecret)
  let accountName = ''
  if (!isAnonymous) {
    accountName = person.profile?.firstName
      ? `${person.profile.firstName} ${person.profile.lastName || ''}`.trim()
      : person.emails?.[0]?.address?.split('@')[0]
  }
  return {
    isAnonymous,
    userName: accountName || guestNameFor(personKey),
    personKey,
    wsUrl: settings?.public?.wsUrl,
    wsParams,
    // Why there are no relay params ('relay-off' when the relay is not set up), and the room role.
    relayCode: relay ? (access?.code ?? 'no-access') : 'relay-off',
    relayRole: wsParams ? access.role : null,
    // The person's own colour, from their key; never one an agent's pointer uses (agent-colors.mjs):
    // near one, the same hue is tried darker, so a guest's name still says its colour and it reads on white.
    color: personCursorColour(personKey),
  }
}
