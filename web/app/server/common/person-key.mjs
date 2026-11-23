import { createHmac } from 'node:crypto'

/**
 * Who is on a slate, as their peers on that slate see it: the same key on each of a person's tabs
 * and screens there, so a person is counted once, and never their account id. An account is keyed
 * by its id; a visitor with no account by the guest cookie their browser keeps. The slate is part
 * of the key, so the same visitor on two slates cannot be linked by it.
 */
export function personKeyFor({ userId, visitorId, slate } = {}, secret) {
  const who = userId ? `user:${userId}` : `visitor:${visitorId ?? ''}`
  return createHmac('sha256', String(secret)).update(`presence:${slate ?? ''}:${who}`).digest('base64url').slice(0, 16)
}
