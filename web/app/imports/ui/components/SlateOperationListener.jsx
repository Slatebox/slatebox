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
import { appliesToCanvas } from '../../api/common/slate-operation-runs.mjs'

// What changes as a run draws: the notes on this canvas, how many are drawn (a note gets its
// relationships once drawn), and their lines.
function canvasProgress(slate) {
  const notes = slate?.nodes?.allNodes || []
  const drawn = notes.filter((node) => node?.relationships).length
  const lines = notes.reduce((sum, node) => sum + (node?.relationships?.associations?.length || 0), 0)
  return `${notes.length}:${drawn}:${lines}`
}

export default function SlateOperationListener({ slate }) {
  const mountedAt = React.useRef(Date.now())
  const processed = React.useRef(new Set())
  // Runs are drawn one after another, in the order they arrive: a Mermaid import saves once and
  // sends its plans as several runs, and a later plan joins notes an earlier one made.
  const queue = React.useRef(Promise.resolve())

  useTracker(() => {
    Meteor.subscribe(
      CONSTANTS.publications.slateOperationRuns,
      slate.shareId,
      mountedAt.current
    )
  }, [slate.shareId])

  React.useEffect(() => {
    const observer = SlateOperationRuns.find({
      slateShareId: slate.shareId,
      createdAt: { $gte: mountedAt.current },
    }).observe({
      added(run) {
        if (processed.current.has(run._id)) return
        processed.current.add(run._id)
        // A workshop edit reaches this canvas through creativeSlates.state, not here.
        if (!appliesToCanvas(run)) return
        queue.current = queue.current.then(async () => {
          let drawing
          try {
            drawing = executeSlateOperations({
              slate,
              plan: run.plan,
              userMessage: run.userMessage || '',
              // A saved run's plan is already carried out: ids it names that
              // this canvas already holds were made by that run.
              replay: true,
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
        })
      },
    })
    return () => observer.stop()
  }, [slate])

  return null
}

SlateOperationListener.propTypes = {
  slate: PropTypes.object.isRequired,
}
