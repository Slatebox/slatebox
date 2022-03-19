/* eslint-disable no-undef */
// Streamy is global, so no import needed
import React, { useEffect, useRef } from 'react'
import { useSelector } from 'react-redux'
import PropTypes from 'prop-types'
import Grid from '@material-ui/core/Grid'
import { Slatebox } from 'slateboxjs'
import RemoteCursor from './RemoteCursor'

export default function RemoteCursors({
  shareId,
  instanceId,
  backgroundColor,
  children,
}) {
  const [remoteCursors, setCursors] = React.useState({})
  const cursorParent = useRef(null)
  const trackCursorTimes = useRef({})
  const embeddedSlate = useSelector((state) => state.embeddedSlate)
  const slate = useSelector((state) => state.slate)

  useEffect(() => {
    const hexColors = Slatebox.utils.availColors.map((a) => a.hex)
    const foreColors = Slatebox.utils.availColors.map((a) => a.fore)
    let canvasPos = null

    function wireObserver() {
      const ele = document.getElementsByClassName('sb_canvas')[0]
      canvasPos = Slatebox.utils.positionedOffset(ele)

      const observer = new MutationObserver(() => {
        canvasPos = Slatebox.utils.positionedOffset(ele)
      })

      observer.observe(ele, {
        attributes: true,
        childList: false,
        subtree: false,
      })
    }

    // Later, you can stop observing
    // observer.disconnect()

    window.setInterval(() => {
      const newCursors = { ...remoteCursors }
      Object.keys(remoteCursors).forEach((key) => {
        if (new Date().valueOf() - trackCursorTimes.current[key] > 1000 * 9) {
          delete newCursors[key]
        }
      })
      setCursors(newCursors)
    }, 1000 * 10)

    Streamy.on(shareId, (d) => {
      if (d.data.instanceId !== instanceId) {
        switch (d.data.type) {
          case 'onMouseMoved': {
            // tracked++;
            // if (tracked % 5 === 0) {
            if (!canvasPos) {
              wireObserver()
            }
            const cursors = { ...remoteCursors }
            const key = `${d.data.userId}_${d.data.instanceId}`
            if (!cursors[key]) {
              trackCursorTimes.current[key] = new Date().valueOf()
              const ind = Object.keys(cursors).length
              cursors[key] = {
                dataKey: key,
                userName: d.data.userName,
                bgColor: `#${hexColors[ind]}` || '#fff',
                fgColor: `#${foreColors[ind]}` || '#000',
              }
            }
            const multiplier =
              slate.options.viewPort.zoom.r / d.data.data.currentZoom

            cursors[key].top =
              d.data.data.y * multiplier +
              d.data.data.top * multiplier -
              Math.abs(canvasPos.top)
            cursors[key].left =
              d.data.data.x * multiplier +
              d.data.data.left * multiplier -
              Math.abs(canvasPos.left)

            setCursors(cursors)
            break
          }
          default: {
            break
          }
        }
      }
    })
  }, [shareId, instanceId])

  const gstyle = embeddedSlate
    ? { backgroundColor, height: '100%' }
    : { height: 'calc(100% - 64px)', backgroundColor }

  // 64px is the height of the header
  return (
    <Grid ref={cursorParent} container style={gstyle}>
      {Object.keys(remoteCursors).map((cursor) => (
        <RemoteCursor key={cursor} {...remoteCursors[cursor]} />
      ))}
      {children}
    </Grid>
  )
}

RemoteCursors.propTypes = {
  shareId: PropTypes.string.isRequired,
  instanceId: PropTypes.string.isRequired,
  backgroundColor: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
}
