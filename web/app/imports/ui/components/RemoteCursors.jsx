/* eslint-disable no-undef */
// Streamy is global, so no import needed
import React, { useEffect, useRef } from 'react'
import PropTypes from 'prop-types'
import Grid from '@material-ui/core/Grid'
import RemoteCursor from './RemoteCursor'
import { Slatebox } from '../../api/client/slatebox'

export default function RemoteCursors({
  shareId,
  instanceId,
  backgroundColor,
  children,
}) {
  // let tracked = 0;
  const [remoteCursors, setCursors] = React.useState({})
  const cursorParent = useRef(null)
  const trackCursorTimes = useRef({})

  // const handleExpiration = function(key) {
  //   const delCursors = Object.assign({}, remoteCursors);
  //   delete delCursors[key];
  //   setCursors(delCursors);
  // }

  const secondsToExpire = 10
  // useEffect(() => {
  //   setInterval(() => {
  //     Object.keys(trackCursorTimes).forEach(k => {
  //       if ((new Date().valueOf() - trackCursorTimes.current[k])/1000 > secondsToExpire) {
  //         const delCursors = Object.assign({}, remoteCursors);
  //         delete delCursors[k];
  //         setCursors(delCursors);
  //       }
  //     });
  //   }, 1000);
  // }, []);

  useEffect(() => {
    const hexColors = Slatebox.utils.availColors.map((a) => a.hex)
    const foreColors = Slatebox.utils.availColors.map((a) => a.fore)
    Streamy.on(shareId, (d) => {
      if (d.data.instanceId !== instanceId) {
        switch (d.data.type) {
          case 'onMouseMoved': {
            // tracked++;
            // if (tracked % 5 === 0) {
            const cursors = { ...remoteCursors }
            const key = `${d.data.userId}_${d.data.instanceId}`
            if (!cursors[key]) {
              trackCursorTimes.current[key] = { expTrigger: null, last: -1 }
              const ind = Object.keys(cursors).length
              cursors[key] = {
                dataKey: key,
                userName: d.data.userName,
                bgColor: `#${hexColors[ind]}` || '#fff',
                fgColor: `#${foreColors[ind]}` || '#000',
                // onExpiration: handleExpiration
              }
            }
            cursors[key].top = d.data.data.y
            cursors[key].left = d.data.data.x
            clearTimeout(trackCursorTimes.current[key].expTrigger)
            trackCursorTimes.current[key].expTrigger = setTimeout(() => {
              const delCursors = { ...remoteCursors }
              delete delCursors[key]
              setCursors(delCursors)
            }, 1000 * secondsToExpire)
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

  // 64px is the height of the header
  return (
    <Grid
      ref={cursorParent}
      container
      style={{
        height: 'calc(100% - 64px)',
        backgroundColor,
      }}
    >
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
