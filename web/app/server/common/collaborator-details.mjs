// What collaborators.init hands a canvas: who this person is to their peers on the slate (a name, a
// colour, a key counted once across their tabs) and, when the collaboration relay is set up, the
// credential to join its room. Without the relay's key pair (settings.slateboxAPI) the details still
// come back, with no credential: the canvas keeps working, its visit is recorded and its saves go
// through; only live editing between people waits for the relay.
import { collabCredential } from './api-signature.mjs'
import { personKeyFor } from './person-key.mjs'
import { guestNameFor, personCursorColour } from '../../imports/api/common/guest-name.mjs'

const isKey = (value) => typeof value === 'string' && value.length > 0

export function collaboratorDetails({ user, userId, id, shareId, settings, fallbackSecret, now }) {
  const { publicKey, secretKey } = settings?.slateboxAPI ?? {}
  const relay = isKey(publicKey) && isKey(secretKey)
  // The relay's credential is signed with the Slatebox API key over a stamp that is never an ISO
  // instant, so it cannot be replayed as a signed HTTP hook request (api-signature.mjs).
  const signature = relay ? collabCredential({ publicKey, secretKey, ...(now ? { now } : {}) }) : null
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
  const accountName = isAnonymous ? '' : (person.profile?.firstName
    ? `${person.profile.firstName} ${person.profile.lastName || ''}`.trim()
    : person.emails?.[0]?.address?.split('@')[0])
  return {
    isAnonymous,
    userName: accountName || guestNameFor(personKey),
    personKey,
    wsUrl: settings?.public?.wsUrl,
    wsParams: signature ? { bearer: signature.bearer, timestamp: signature.timestamp } : null,
    // The person's own colour, from their key; never one an agent's pointer uses (agent-colors.mjs):
    // near one, the same hue is tried darker, so a guest's name still says its colour and it reads on white.
    color: personCursorColour(personKey),
  }
}
