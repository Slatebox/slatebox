// Telling an author what happened to their library item: an in-app notification (the Messages
// collection, shown in the bell's list) and a plain-text email with a link to My library. Pure, with
// injected senders; server/library/meteor.js wires the real ones.
//
//   createLibraryNotifier({ insertMessage, sendEmail, loadAuthor, appOrigin, now }) → notify({ item, type, message })
//
// insertMessage(row)              writes one Messages row ({ userId, text, type: 'system', action: { type: 'link', url } })
// sendEmail({ to, subject, text })  sends one email; optional (no mail server: no email, the in-app note still goes)
// loadAuthor(userId)              → { email?, isAnonymous? } | null
import { KIND_LABELS } from '../../imports/api/common/library-model.mjs'

export const MY_LIBRARY_PATH = '/library/mine'

const OUTCOMES = Object.freeze({
  approved: { line: 'was published', subject: 'is published' },
  changes_requested: { line: 'needs changes', subject: 'needs changes' },
  rejected: { line: 'was not accepted', subject: 'was not accepted' },
  unpublished: { line: 'was taken out of the library', subject: 'was taken out of the library' },
  comment: { line: 'has a new message from the reviewer', subject: 'has a new message' },
})

/** The notification's words for an outcome: { text, subject, body }. */
export function libraryNotice({ item, type, message, origin = '' }) {
  const outcome = OUTCOMES[type]
  if (!outcome || !item) return null
  const kind = KIND_LABELS[item.kind] || 'item'
  const title = String(item.title || 'Untitled').slice(0, 80)
  const text = `Your ${kind} "${title}" ${outcome.line}.`
  const link = `${String(origin || '').replace(/\/$/, '')}${MY_LIBRARY_PATH}`
  const said = typeof message === 'string' && message.trim() ? `\n\nThe reviewer wrote:\n${message.trim().slice(0, 2000)}\n` : '\n'
  const next = type === 'approved'
    ? `Anyone can find it in the library now${item.slug ? `: ${String(origin || '').replace(/\/$/, '')}/library/${item.slug}` : ''}.`
    : type === 'changes_requested' ? 'Change it, then submit it again from My library.' : 'See the whole thread in My library.'
  return {
    text,
    subject: `Slatebox: your ${kind} "${title}" ${outcome.subject}`,
    body: `${text}${said}\n${next}\n\nMy library: ${link}\n`,
  }
}

export function createLibraryNotifier({ insertMessage, sendEmail = null, loadAuthor = async () => null, appOrigin = () => '', now = Date.now, log = console }) {
  return async function notify({ item, type, message }) {
    if (!item?.authorId || item.origin === 'builtin') return
    const notice = libraryNotice({ item, type, message, origin: appOrigin() })
    if (!notice) return
    try {
      await insertMessage({
        timestamp: now(), userId: item.authorId, text: notice.text, read: false, priority: 5, type: 'system',
        action: { type: 'link', url: MY_LIBRARY_PATH }, libraryItemId: item._id,
      })
    } catch (error) {
      log.error?.('[library] notification', error?.message)
    }
    if (!sendEmail) return
    try {
      const author = await loadAuthor(item.authorId)
      if (!author?.email || author.isAnonymous) return
      await sendEmail({ to: author.email, subject: notice.subject, text: notice.body })
    } catch (error) {
      log.error?.('[library] email', error?.message)
    }
  }
}
