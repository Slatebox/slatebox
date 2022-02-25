import React, { useEffect, useRef, Component } from 'react'
import { Meteor } from 'meteor/meteor'
import Box from '@material-ui/core/Box'
import { useTracker } from 'meteor/react-meteor-data'

import { Slatebox } from '../../api/client/slatebox'
import { CONSTANTS } from '../../api/common/constants'
import { Collaboration } from '../..//api/common/models.js'
import { makeStyles } from '@material-ui/core/styles'

const useStyles = makeStyles((theme) => ({
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

export const SnapSlate = (props) => {
  const classes = useStyles()

  useEffect(() => {
    const ss = JSON.parse(JSON.stringify(props.slate))
    if (ss) {
      const events = {
        onCanvasClicked: function () {
          props.onSlateClicked && props.onSlateClicked()
        },
      }
      const snap = new Slatebox.Slate(
        {
          container: props.overrideContainer
            ? `slatePreviewContainer`
            : `slate_${ss.shareId}`,
          containerStyle: {
            backgroundColor: ss.options.containerStyle.backgroundColor,
          },
          defaultLineColor: ss.options.defaultLineColor,
          viewPort: {
            allowDrag: !!props.allowDrag,
            useInertiaScrolling: !!props.allowDrag,
          },
          name: ss.options.name,
          description: ss.options.description,
          showbirdsEye: false,
          showMultiSelect: false,
          showUndoRedo: false,
          showZoom: !!props.allowZoom,
          showLocks: false,
          showAddNodes: false,
          collaboration: {
            allow: props.disableCollab || true,
            onCollaboration: async function (opts) {
              //always add the instanceId
              console.log(
                'onCollaboration snap called',
                opts.type,
                opts.pkg?.type
              )
            },
          },
        },
        events
      ).init()

      ss.options.showLocks = false
      ss.nodes?.forEach((n) => {
        n.options.allowResize = false
        n.options.allowContext = false
        n.options.allowMenu = false
        n.options.allowDrag = false
        n.relationships?.associations?.forEach((a) => {
          a.lineWidth = 2
        })
      })

      window.requestAnimationFrame(() => {
        snap.loadJSON(JSON.stringify(ss))
        if (ss.nodes.length < 50 || ss.options.templateApproved) {
          if (!props.overrideContainer) {
            snap.controller.scaleToFitAndCenter()
          } else {
            snap.canvas.zoom({
              dur: 0,
              zoomPercent: 120,
            })
          }
        }
      })

      if (!props.disableCollab) {
        Collaboration.find({ slateId: ss.shareId }).observe({
          added: function (doc) {
            if (doc.type === 'onZoom') return

            let scaleAfter = true
            if (doc.type === 'onCanvasMove') {
              //adjust movement for snap -- use relative movement against current positioned offset
              //console.log("passed in left top ", doc.data);
              const orient = snap.getOrientation()
              const ratio =
                Math.max(orient.width, orient.height) /
                Math.max(doc.data.orient.width, doc.data.orient.height)
              //console.log("ratio is ", ratio, orient.width, doc.data.orient.width);
              // doc.data.left = orient.left + (doc.data.relative.x * ratio);
              // doc.data.top = orient.top + (doc.data.relative.y * ratio);

              doc.data.left = doc.data.relative.x * ratio
              doc.data.top = doc.data.relative.y * ratio
              doc.isRelative = true
              scaleAfter = false
              //doc.pkg.left = doc.pkg.left - orient.left;
              //doc.pkg.top = doc.pkg.top - orient.top;
            }
            if (!props.overrideContainer) {
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

  if (!props.disableCollab) {
    useTracker(() => {
      Meteor.subscribe(
        CONSTANTS.publications.collaboration,
        [props.slate?.shareId],
        [], //all collaborators
        new Date().valueOf()
      )
    })
  }

  return (
    <Box
      id={
        props.overrideContainer
          ? `slatePreviewContainer`
          : `slate_${props.slate?.shareId}`
      }
      className={props.allowDrag ? classes.noZoom : classes.slateTheme}
    ></Box>
  )
}
