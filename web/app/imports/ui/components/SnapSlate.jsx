/* eslint-disable new-cap */
import React, { useEffect } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@material-ui/core/Box'
import { useTracker } from 'meteor/react-meteor-data'
import { makeStyles } from '@material-ui/core/styles'
import { Slatebox } from 'slatebox'
import CONSTANTS from '../../api/common/constants'
import { Collaboration } from '../../api/common/models'
import slateProps from '../propTypes/slatePriops'

const useStyles = makeStyles(() => ({
  slateTheme: {
    width: 'inherit',
    height: 'inherit',
    padding: '0 important',
    transition: 'all 500ms',
    '&:hover': {
      transform: 'scale(1.2)',
    },
  },
  noZoom: {
    width: 'inherit',
    height: 'inherit',
    padding: '0 important',
  },
}))

export default function SnapSlate({
  slate,
  onSlateClicked,
  overrideContainer,
  allowDrag,
  allowZoom,
  disableCollab,
}) {
  const classes = useStyles()

  useEffect(() => {
    const ss = JSON.parse(JSON.stringify(slate))
    if (ss) {
      const events = {
        onCanvasClicked() {
          if (onSlateClicked) onSlateClicked()
        },
      }
      const snap = new Slatebox.slate(
        {
          container: overrideContainer
            ? `slatePreviewContainer`
            : `slate_${ss.shareId}`,
          containerStyle: {
            backgroundColor: ss.options.containerStyle.backgroundColor,
          },
          defaultLineColor: ss.options.defaultLineColor,
          viewPort: {
            allowDrag: !!allowDrag,
            useInertiaScrolling: !!allowDrag,
          },
          name: ss.options.name,
          description: ss.options.description,
          showbirdsEye: false,
          showMultiSelect: false,
          showUndoRedo: false,
          showZoom: !!allowZoom,
          showLocks: false,
          showAddNodes: false,
          collaboration: {
            allow: disableCollab || true,
            async onCollaboration() {
              // always add the instanceId
            },
          },
        },
        events
      ).init()

      ss.options.showLocks = false
      ss.nodes?.forEach((n) => {
        const nn = n
        nn.options.allowResize = false
        nn.options.allowContext = false
        nn.options.allowMenu = false
        nn.options.allowDrag = false
        nn.relationships?.associations?.forEach((a) => {
          const aa = a
          aa.lineWidth = 2
        })
      })

      window.requestAnimationFrame(() => {
        snap.loadJSON(JSON.stringify(ss))
        if (ss.nodes.length < 50 || ss.options.templateApproved) {
          if (!overrideContainer) {
            snap.controller.scaleToFitAndCenter()
          } else {
            snap.canvas.zoom({
              dur: 0,
              zoomPercent: 120,
            })
          }
        }
      })

      if (!disableCollab) {
        Collaboration.find({ slateId: ss.shareId }).observe({
          added(doc) {
            const ddoc = doc
            if (ddoc.type === 'onZoom') return

            let scaleAfter = true
            if (ddoc.type === 'onCanvasMove') {
              const orient = snap.getOrientation()
              const ratio =
                Math.max(orient.width, orient.height) /
                Math.max(ddoc.data.orient.width, ddoc.data.orient.height)
              ddoc.data.left = ddoc.data.relative.x * ratio
              ddoc.data.top = ddoc.data.relative.y * ratio
              ddoc.isRelative = true
              scaleAfter = false
            }
            if (!overrideContainer) {
              snap?.collab.invoke(doc)
              if (scaleAfter) {
                setTimeout(() => {
                  window.requestAnimationFrame(() => {
                    snap.controller.scaleToFitAndCenter()
                  })
                }, 250)
              }
            }
          },
        })
      }
    }
  }, [])

  if (!disableCollab) {
    useTracker(() => {
      Meteor.subscribe(
        CONSTANTS.publications.collaboration,
        [slate?.shareId],
        [], // all collaborators
        new Date().valueOf()
      )
    })
  }

  return (
    <Box
      id={
        overrideContainer ? `slatePreviewContainer` : `slate_${slate?.shareId}`
      }
      className={allowDrag ? classes.noZoom : classes.slateTheme}
    />
  )
}

SnapSlate.propTypes = {
  slate: slateProps.isRequired,
  onSlateClicked: PropTypes.func.isRequired,
  overrideContainer: PropTypes.string.isRequired,
  allowDrag: PropTypes.bool.isRequired,
  allowZoom: PropTypes.bool.isRequired,
  disableCollab: PropTypes.bool.isRequired,
}
