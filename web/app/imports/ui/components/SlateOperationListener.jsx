/* eslint-disable no-underscore-dangle */
/* eslint-disable react/forbid-prop-types */
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import CONSTANTS from '../../api/common/constants'
import { SlateOperationRuns } from '../../api/common/models'
import executeSlateOperations from '../../api/client/executeSlateOperations'
import { waitForRun } from '../../api/client/waitForRun.mjs'
import { appliesToCanvas, runsSince } from '../../api/common/slate-operation-runs.mjs'
import { exportForSave } from '../../api/client/saveSlateLite'
import { foldIntoBase } from '../../api/common/slate-save-patch.mjs'

// The notes as this page has them, by id, as text: to see what a run it drew changed.
function notesAsText(slate) {
  try {
    return new Map((exportForSave(slate).nodes || []).map((note) => [note?.options?.id, JSON.stringify(note)]))
  } catch {
    return null
  }
}

// What changes as a run draws: the notes on this canvas, how many are drawn (a note gets its
// relationships once drawn), and their lines.
function canvasProgress(slate) {
  const notes = slate?.nodes?.allNodes || []
  const drawn = notes.filter((node) => node?.relationships).length
  const lines = notes.reduce((sum, node) => sum + (node?.relationships?.associations?.length || 0), 0)
  return `${notes.length}:${drawn}:${lines}`
}

export default function SlateOperationListener({ slate, revision }) {
  // The runs saved after the revision this canvas loaded, by the server's numbering: one saved
  // between loading the slate and starting to listen is drawn, one already in what was loaded is
  // not, whatever the browser's clock says.
  const since = React.useMemo(() => ({ revision: Number.isInteger(revision) && revision >= 0 ? revision : 0 }), [slate, revision])
  const processed = React.useRef(new Set())
  // Runs are drawn one after another, in the order they were saved: a Mermaid import saves once and
  // sends its plans as several runs, and a later plan joins notes an earlier one made.
  const queue = React.useRef(Promise.resolve())

  useTracker(() => {
    Meteor.subscribe(CONSTANTS.publications.slateOperationRuns, slate.shareId, since)
  }, [slate.shareId, since])

  React.useEffect(() => {
    const observer = SlateOperationRuns.find(runsSince(slate.shareId, since), { sort: { revision: 1, createdAt: 1 } }).observe({
      added(run) {
        if (processed.current.has(run._id)) return
        processed.current.add(run._id)
        // A workshop edit reaches this canvas through creativeSlates.state, not here.
        if (!appliesToCanvas(run)) return
        queue.current = queue.current.then(async () => {
          // A run is saved on the server already: what it draws here is what the server holds, so it
          // joins this page's save base (slate-save-patch.mjs) and the page's next save does not send
          // it back as an edit of its own over someone's later change.
          const before = slate.saveBase ? notesAsText(slate) : null
          let drawing
          try {
            drawing = executeSlateOperations({
              slate,
              plan: run.plan,
              userMessage: run.userMessage || '',
              // A saved run's plan is already carried out: ids it names that
              // this canvas already holds were made by that run.
              replay: true,
              // Every canvas only draws it: none saves what the server already holds (that raised
              // the slate's revision behind the agent) or passes it on to the room, since every
              // open canvas that may read the slate draws runs itself.
              send: false,
            })
          } catch (error) {
            drawing = Promise.reject(error)
          }
          drawing.catch((error) => {
            // eslint-disable-next-line no-console
            console.error('Unable to apply external slate operations', error)
          })
          // The next run waits while this one keeps drawing (it may join notes this one makes);
          // only a run that has stopped changing the canvas for 10 seconds is let go.
          const outcome = await waitForRun(drawing, { progress: () => canvasProgress(slate), stallMs: 10000 })
          if (outcome === 'stalled') {
            // eslint-disable-next-line no-console
            console.warn('A replayed slate operation run stopped drawing; drawing the next one.')
          }
          if (before && slate.saveBase) {
            const after = exportForSave(slate).nodes || []
            foldIntoBase(slate.saveBase, after.filter((note) => before.get(note?.options?.id) !== JSON.stringify(note)))
          }
        })
      },
    })
    return () => observer.stop()
  }, [slate, since])

  return null
}

SlateOperationListener.propTypes = {
  slate: PropTypes.object.isRequired,
  revision: PropTypes.number,
}

SlateOperationListener.defaultProps = {
  revision: 0,
}
