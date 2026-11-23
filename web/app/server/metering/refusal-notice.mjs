// Whether the meter's refusal may be written into a slate's chat. The refusal happens before a
// handler checks anything, so this is the same rule the conversation itself uses
// (openai.js checkConversationTarget): a signed-in caller, on a saved slate it may change.
// Anyone else still gets the refusal in the method's answer, just not in someone's chat.
export async function mayPostRefusal({ userId, shareId, findSlate, canEditSlate }) {
  if (!userId || typeof shareId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(shareId)) return false
  const slate = await findSlate({ shareId })
  if (!slate) return false
  return Boolean(await canEditSlate(userId, slate))
}
