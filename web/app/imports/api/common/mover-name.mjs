// The name a board stamps on what a person did ("Moved anyway by Sam · Nov 23", a rule's audit line): the first word
// of their name, or their username; a guest, who has neither, is "a guest" (never "Someone"). At most 80 letters.
export function moverName(account) {
  const name = String(account?.profile?.name || (account?.isAnonymous ? '' : account?.username) || '').trim().split(/\s+/)[0]
  return (name || 'a guest').slice(0, 80)
}
