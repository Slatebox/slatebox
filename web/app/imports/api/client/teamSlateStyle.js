import { Meteor } from 'meteor/meteor'
import CONSTANTS from '../common/constants'
import { DEFAULT_PRESET_QUERY, defaultPreset } from '../common/brandSettings.mjs'

// The team's slate style (the brand kit's default preset value) for this person, asked once for a page of
// cards: My slates draws a dozen at a time. Asked again after a while, so a style changed in the brand kit
// shows on the next visit. Null for a guest, a person with no team, or a team with no style.
const FRESH_FOR = 30 * 1000
let asked = null

export default function teamSlateStyle() {
  const userId = Meteor.userId?.() ?? null
  // The server answers from the person's own record (a team-less person is refused: no style), so a
  // page whose user document has not arrived yet still asks.
  if (!userId) return Promise.resolve(null)
  if (asked && asked.userId === userId && Date.now() - asked.at < FRESH_FOR) return asked.style
  const style = Meteor.callAsync(CONSTANTS.methods.organizationSettings.getByQuery, { ...DEFAULT_PRESET_QUERY })
    .then((settings) => defaultPreset(settings)?.value ?? null)
    .catch(() => null)
  asked = { userId, at: Date.now(), style }
  return style
}
