import { useCallback, useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { CreativeStates } from '../../../../api/client/creativeSlateStates'
import libraryApi from '../../../../api/client/library'
import { boardName } from './buildTurns.mjs'

/**
 * A builder slate's library state (library spec §4.2): the item it is saving to (once saved), the board being built
 * (the slate's board, live), and Save and Submit through library.saveDraft and library.submit, the same actions exec,
 * the MCP server and the API reach. `slate` is the canvas's slate (its server-only `library` field included).
 */
export default function useBuilder(slate) {
  const shareId = slate?.shareId
  const library = slate?.library ?? null
  const boardId = library?.boardId ?? 'main'
  const [itemId, setItemId] = useState(library?.itemId ?? null)
  const [item, setItem] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  // The board as the canvas holds it now (the board's live record, the one the canvas draws from).
  const board = useTracker(() => {
    if (!shareId) return null
    const record = CreativeStates.findOne(boardId === 'main' ? shareId : shareId + ':' + boardId)
    return record?.model?.kind === 'workshop' ? record.model.workshop : null
  }, [shareId, boardId])
  const guest = useTracker(() => Boolean(Meteor.user()?.isAnonymous), [])

  // The saved item: its name, line, category and where it stands.
  useEffect(() => {
    if (!itemId) return undefined
    let gone = false
    libraryApi.get({ itemId }).then(({ item: found }) => { if (!gone) setItem(found) }).catch(() => { /* Saved again on the next Save. */ })
    return () => { gone = true }
  }, [itemId])

  const save = useCallback(async (input) => {
    setBusy('saving'); setError(null)
    try {
      const saved = await libraryApi.saveDraft({ shareId, ...(itemId && { itemId }), ...input })
      setItemId(saved.itemId)
      const { item: found } = await libraryApi.get({ itemId: saved.itemId })
      setItem(found)
      return saved
    } catch (err) {
      setError({ code: err.error, reason: err.reason || err.message })
      return null
    } finally { setBusy(null) }
  }, [shareId, itemId])

  // Submitting saves the board first (the item is made on the first save), then sends it to the review queue.
  const submit = useCallback(async (input, note) => {
    setBusy('submitting'); setError(null)
    try {
      const saved = await libraryApi.saveDraft({ shareId, ...(itemId && { itemId }), ...input })
      setItemId(saved.itemId)
      const sent = await libraryApi.submit({ kind: 'component', itemId: saved.itemId, ...(note && { note }) })
      const { item: found } = await libraryApi.get({ itemId: saved.itemId })
      setItem(found)
      return sent
    } catch (err) {
      setError({ code: err.error, reason: err.reason || err.message })
      return null
    } finally { setBusy(null) }
  }, [shareId, itemId])

  const status = item ? (item.reviewStatus || item.status) : null
  return {
    shareId, library, board, guest, itemId, item, status, busy, error, clearError: () => setError(null),
    // The category a branch keeps (its parent's): never a choice.
    locked: library?.parent?.category ?? (item?.categoryLocked ? item.category : null),
    // What the save sheet starts from: what was saved, or the board's own name.
    defaults: {
      title: item?.pendingMeta?.title ?? item?.title ?? boardName(board) ?? '',
      summary: item?.pendingMeta?.summary ?? item?.summary ?? '',
      category: item?.category ?? null,
      synonyms: (item?.synonyms ?? []).join(', '),
    },
    // Waiting for review: the board can't be saved over until it is withdrawn.
    waiting: ['submitted', 'in_review'].includes(status),
    save, submit,
  }
}
