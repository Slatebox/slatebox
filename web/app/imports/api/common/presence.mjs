// Who else is on a slate, from the relay's presence: one entry per person, whatever the number of
// their tabs. A client's own other tabs are this person, never someone else. Names are the server's
// (an account's name, or a guest's name made from their key), so every viewer shows the same name
// for a person, and it matches their pointer on the canvas.

import { guestNameFor } from './guest-name.mjs'

/**
 * @param {{clientID: number, key?: string, userName?: string, color?: string}[]} users the relay's peers (this client excluded)
 * @param {string|undefined} selfKey this person's key
 * @returns {{key: string, clientID: number, clientIDs: number[], userName: string, color: string, guest: boolean}[]}
 */
export function presentPeople(users, selfKey) {
  const people = new Map()
  for (const user of users) {
    // A peer with no key is counted per client.
    const key = user.key || `client:${user.clientID}`
    if (selfKey && key === selfKey) continue
    const guestName = user.key ? guestNameFor(user.key) : ''
    const guest = !user.userName || user.userName === guestName
    const tab = { clientID: user.clientID, userName: user.userName || 'Guest', color: user.color, guest }
    const person = people.get(key)
    if (!person) people.set(key, { key, clientIDs: [user.clientID], ...tab })
    else {
      person.clientIDs.push(user.clientID)
      // One tab signed in while another is still a guest: the account's name is the newer.
      if (person.guest && !guest) Object.assign(person, tab)
    }
  }
  return [...people.values()]
}
