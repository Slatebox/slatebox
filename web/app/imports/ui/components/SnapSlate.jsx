/* eslint-disable new-cap */
import React, { useEffect } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import { useTracker } from 'meteor/react-meteor-data'
import { Slatebox } from 'slateboxjs'
import CONSTANTS from '../../api/common/constants'
import { Collaboration } from '../../api/common/models'
import slateProps from '../propTypes/slateProps'
import promisify from '../../api/client/promisify'
import { drawSlateBoards } from './workshop/boardRender'
import useCanvasTheme from '../common/useCanvasTheme'
import { stillPicture } from './stillPicture.mjs'
import { shownContainerStyle } from '../../api/common/slateBackground.mjs'
import teamSlateStyle from '../../api/client/teamSlateStyle'

/** Whether a saved slate holds a board (its first in creative, any further in boards). */
const holdsBoards = (ss) => ss?.creative?.model?.kind === 'workshop' || Object.values(ss?.boards ?? {}).some((b) => b?.model?.kind === 'workshop')

export default function SnapSlate({
  slate,
  onSlateClicked = () => {},
  overrideContainer,
  allowDrag = false,
  allowZoom = false,
  disableCollab = false,
  index,
}) {
  const [isVisible, setVisible] = React.useState(null)
  // A slate's picture follows the app's mode, as its canvas does (canvasTheme.mjs), judged on the
  // background it is drawn on (a slate stored without one is drawn on the team's style).
  const box = React.useRef(null)
  const shown = React.useRef(slate?.options?.containerStyle)
  useCanvasTheme(box, () => shown.current)

  async function create(ss) {
    const snap = await new Slatebox.slate(
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
        allowCollaboration: !disableCollab,
        // A slate's card is a picture of it: a video note shows its poster and never plays here.
        mediaPlayback: false,
      },
      {
        onSlateChanged: async (pkg) => {
          const doc = { ...pkg }
          if (doc.type === 'onZoom') return
          let scaleAfter = true
          if (doc.type === 'onCanvasMove') {
            const orient = snap.getOrientation()
            const ratio =
              Math.max(orient.width, orient.height) /
              Math.max(doc.data.orient.width, doc.data.orient.height)
            doc.data.left = doc.data.relative.x * ratio
            doc.data.top = doc.data.relative.y * ratio
            doc.isRelative = true
            scaleAfter = false
          }
          if (!overrideContainer) {
            // snap?.collab.invoke(doc)
            if (scaleAfter) {
              setTimeout(() => {
                window.requestAnimationFrame(() => {
                  snap.controller.scaleToFitAndCenter()
                })
              }, 250)
            }
          }
        },
        onInitCollaboration: async (clientID) => {
          // A slate's picture follows its room and never edits it: a read-only token.
          const room = { id: clientID, shareId: ss.shareId, readOnly: true }
          const collaboratorDetails = await Meteor.callAsync(CONSTANTS.methods.collaborators.init, room)

          // The same person as on the slate itself: their key, name and colour there.
          return {
            websocketUrl: collaboratorDetails.wsUrl,
            websocketParams: collaboratorDetails.wsParams,
            websocketRole: collaboratorDetails.relayRole ?? null,
            refreshWebsocketParams: async () =>
              (await Meteor.callAsync(CONSTANTS.methods.collaborators.refresh, room))?.wsParams ?? null,
            color: collaboratorDetails.color,
            userName: collaboratorDetails.userName,
            personKey: collaboratorDetails.personKey,
            x: 0,
            y: 0,
            suppressCursor: true,
          }
        },
        onCanvasClicked: () => {
          if (onSlateClicked) onSlateClicked()
        },
      }
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

    // The slate's own notes, then each board it holds, drawn by the same renderer as the live canvas
    // (boardRender.js): a plan's months and bars, not the generic columns its notes would make.
    const boards = holdsBoards(ss)
    window.setTimeout(() => {
      window.requestAnimationFrame(async () => {
        if (gone.current) return
        snap.loadJSON(JSON.stringify(ss))
        if (boards) {
          drawn.current = await drawSlateBoards(snap.v2 ?? snap, ss)
          if (gone.current) return
        }
        if (ss.nodes.length < 25 || boards) {
          snap.controller.scaleToFitAndCenter(() => {
            setVisible(true)
          })
        } else {
          setVisible(true)
        }
      })
    }, 0 * index || 1)

    if (!disableCollab) {
      // snap.collabPackages.observe((event) => {
      //   let scaleAfter = true
      //   const pkgs = snap.collabPackages.get('last')
      //   pkgs.forEach((p) => {
      //     switch (p.type) {
      //       case 'onZoom': {
      //         break
      //       }
      //       case 'onCanvasMove': {
      //         const orient = snap.getOrientation()
      //         const ratio =
      //           Math.max(orient.width, orient.height) /
      //           Math.max(p.data.orient.width, p.data.orient.height)
      //         p.data.left = p.data.relative.x * ratio
      //         p.data.top = p.data.relative.y * ratio
      //         p.isRelative = true
      //         scaleAfter = false
      //         break
      //       }
      //       default: {
      //         break
      //       }
      //     }
      //     if (!overrideContainer) {
      //       snap?.collab.invoke(p)
      //       if (scaleAfter) {
      //         setTimeout(() => {
      //           window.requestAnimationFrame(() => {
      //             snap.controller.scaleToFitAndCenter()
      //           })
      //         }, 250)
      //       }
      //     }
      //   })
      // })
    }
    // Collaboration.find({ slateId: ss.shareId }).observe({
    //   added(doc) {
    //     const ddoc = doc
    //     if (ddoc.type === 'onZoom') return

    //     let scaleAfter = true
    //     if (ddoc.type === 'onCanvasMove') {
    //       const orient = snap.getOrientation()
    //       const ratio =
    //         Math.max(orient.width, orient.height) /
    //         Math.max(ddoc.data.orient.width, ddoc.data.orient.height)
    //       ddoc.data.left = ddoc.data.relative.x * ratio
    //       ddoc.data.top = ddoc.data.relative.y * ratio
    //       ddoc.isRelative = true
    //       scaleAfter = false
    //     }
    //     if (!overrideContainer) {
    //       snap?.collab.invoke(doc)
    //       if (scaleAfter) {
    //         setTimeout(() => {
    //           window.requestAnimationFrame(() => {
    //             snap.controller.scaleToFitAndCenter()
    //           })
    //         }, 250)
    //       }
    //     }
    //   },
    // })
  }

  const gone = React.useRef(false)
  const drawn = React.useRef([])
  // A thumbnail (not the preview you can pan) is a still picture: none of the canvas's controls are said on it.
  useEffect(() => (allowDrag ? undefined : stillPicture(box.current)), [])
  useEffect(() => {
    gone.current = false
    if (slate) {
      const copy = JSON.parse(JSON.stringify(slate))
      copy.nodes = Array.isArray(copy.nodes) ? copy.nodes : []
      // The background its canvas opens on (slateBackground.mjs): its own, else the team's style, else white.
      // Only a slate stored without one waits for the team's style (asked once for the page).
      const stored = copy.options?.containerStyle
      const style = stored && typeof stored === 'object' ? Promise.resolve(null) : teamSlateStyle()
      style.then((team) => {
        if (gone.current) return
        shown.current = shownContainerStyle(stored, team)
        copy.options = { ...copy.options, containerStyle: shown.current }
        create(copy)
      })
    }
    return () => {
      gone.current = true
      for (const board of drawn.current) {
        try { board.destroy() } catch { /* The card is already gone. */ }
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

  // return null;
  return (
    <Box
      ref={box}
      sx={{
        visibility: isVisible ? 'visible' : 'hidden',
        width: 'inherit',
        height: 'inherit',
        overflow: 'hidden',
        ...(allowDrag
          ? {}
          : {
              transition: 'all 200ms',
              '&:hover': {
                transform: 'scale(1.3)',
              },
            }),
      }}
      id={
        overrideContainer ? `slatePreviewContainer` : `slate_${slate?.shareId}`
      }
    />
  )
}
