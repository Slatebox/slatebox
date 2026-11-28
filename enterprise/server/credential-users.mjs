// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Who else uses a person's sign-in besides their integrations: a recipe running for them (it opens
// their Google, Slack or GitHub session on its own schedule). The hourly sweep (service.sweep)
// keeps a sign-in while any user here says it is in use, so a recipe's sign-in is never revoked
// under it.
const users = new Set()

/** Adds a check: (credentialRow: { ownerId, address }) → Promise<boolean>. → a function that removes it. */
export function addCredentialUser(inUse) {
  users.add(inUse)
  return () => users.delete(inUse)
}

/** Whether anything here still uses this sign-in. A failing check counts as in use (never revoke on doubt). */
export async function credentialInUse(row) {
  for (const inUse of users) {
    try {
      if (await inUse(row)) return true
    } catch {
      return true
    }
  }
  return false
}
