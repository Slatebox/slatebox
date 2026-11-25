// Telling an author what happened to their library item: an in-app notification (the Messages
// collection, shown in the bell's list) and an email (HTML and plain text, server/email/templates.mjs)
// with a link to My library. Pure, with injected senders; server/library/meteor.js wires the real ones.
//
//   createLibraryNotifier({ insertMessage, sendEmail, loadAuthor, appOrigin, now }) → notify({ item, type, message })
//
// insertMessage(row)              writes one Messages row ({ userId, text, type: 'system', action: { type: 'link', url } })
// sendEmail({ to, subject, text, html })  sends one email; optional (no mail server: no email, the in-app note still goes)
// loadAuthor(userId)              → { email?, isAnonymous?, firstName? } | null
// logoUrl()                       → the email logo's address (templates.mjs logoUrlFor)
import { KIND_LABELS } from '../../imports/api/common/library-model.mjs'
import { libraryDecision, logoUrlFor } from '../email/templates.mjs'

export const MY_LIBRARY_PATH = '/library/mine'

const OUTCOMES = Object.freeze({
  approved: { line: 'was published', subject: 'is published' },
  changes_requested: { line: 'needs changes', subject: 'needs changes' },
  rejected: { line: 'was not accepted', subject: 'was not accepted' },
  unpublished: { line: 'was taken out of the library', subject: 'was taken out of the library' },
  comment: { line: 'has a new message from the reviewer', subject: 'has a new message' },
})

/** The in-app line for an outcome (no email rendered): { text, kind, title, outcome } or null. */
export function libraryLine({ item, type }) {
  const outcome = OUTCOMES[type]
  if (!outcome || !item) return null
  const kind = KIND_LABELS[item.kind] || 'item'
  const title = String(item.title || 'Untitled').slice(0, 80)
  return { text: `Your ${kind} "${title}" ${outcome.line}.`, kind, title, outcome }
}

/** The notification's words for an outcome: { text, subject, body, html } (body is the email's plain text). */
export function libraryNotice({ item, type, message, origin = '', firstName = null, logoUrl = logoUrlFor(origin) }) {
  const line = libraryLine({ item, type })
  if (!line) return null
  const { text, kind, title, outcome } = line
  const base = String(origin || '').replace(/\/$/, '')
  const link = `${base}${MY_LIBRARY_PATH}`
  // An integration has no library page: it is a Community card in Connect an integration.
  const integration = item.kind === 'integration'
  const publicUrl = type === 'approved' && item.slug && !integration ? `${base}/library/${item.slug}` : null
  const nextLine = type === 'approved'
    ? (integration ? 'Anyone on Slatebox can find it in Connect an integration, marked Community.' : 'Anyone can find it in the library now.')
    : type === 'changes_requested' ? 'Change it, then submit it again from My library.' : 'See the whole thread in My library.'
  const mail = libraryDecision({
    // The subject keeps its old "Slatebox: " start, so inboxes that hide the sender and the
    // filters people made for these emails still recognize them.
    firstName, subject: `Slatebox: your ${kind} "${title}" ${outcome.subject}`, headline: text.replace(/\.$/, ''),
    message, publicUrl, nextLine, libraryUrl: link, logoUrl,
  })
  return { text, subject: mail.subject, body: mail.text, html: mail.html }
}

export function createLibraryNotifier({ insertMessage, sendEmail = null, loadAuthor = async () => null, appOrigin = () => '', logoUrl = null, now = Date.now, log = console }) {
  return async function notify({ item, type, message }) {
    if (!item?.authorId || item.origin === 'builtin') return
    const notice = libraryLine({ item, type })
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
      const origin = appOrigin()
      const mail = libraryNotice({ item, type, message, origin, firstName: author.firstName ?? null, logoUrl: logoUrl ? logoUrl() : logoUrlFor(origin) })
      await sendEmail({ to: author.email, subject: mail.subject, text: mail.body, html: mail.html })
    } catch (error) {
      log.error?.('[library] email', error?.message)
    }
  }
}
