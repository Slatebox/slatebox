//Streamy is global, so no import needed
import { Slatebox } from '../../api/client/slatebox'
import React, { useEffect, useLayoutEffect, useState } from 'react'
import { RemoteCursor } from './RemoteCursor.jsx'
import Grid from '@material-ui/core/Grid'
import { useRef } from 'react'

export const RemoteCursors = (props) => {
  const self = this
  //let tracked = 0;
  const [remoteCursors, setCursors] = React.useState({})
  const cursorParent = useRef(null)
  const trackCursorTimes = useRef({})

  // const handleExpiration = function(key) {
  //   const delCursors = Object.assign({}, remoteCursors);
  //   delete delCursors[key];
  //   setCursors(delCursors);
  // }

  let secondsToExpire = 10
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
    let hexColors = Slatebox.Utils.availColors.map((a) => {
      return a.hex
    })
    let foreColors = Slatebox.Utils.availColors.map((a) => {
      return a.fore
    })
    Streamy.on(props.shareId, function (d, s) {
      if (d.data.instanceId !== props.instanceId) {
        switch (d.data.type) {
          case 'onMouseMoved': {
            //tracked++;
            //if (tracked % 5 === 0) {
            const cursors = Object.assign({}, remoteCursors)
            let key = `${d.data.userId}_${d.data.instanceId}`
            if (!cursors[key]) {
              trackCursorTimes.current[key] = { expTrigger: null, last: -1 }
              let _ind = Object.keys(cursors).length
              cursors[key] = {
                dataKey: key,
                userName: d.data.userName,
                bgColor: `#${hexColors[_ind]}` || '#fff',
                fgColor: `#${foreColors[_ind]}` || '#000',
                //onExpiration: handleExpiration
              }
            }
            cursors[key].top = d.data.data.y
            cursors[key].left = d.data.data.x
            clearTimeout(trackCursorTimes.current[key].expTrigger)
            trackCursorTimes.current[key].expTrigger = setTimeout(() => {
              const delCursors = Object.assign({}, remoteCursors)
              delete delCursors[key]
              setCursors(delCursors)
            }, 1000 * secondsToExpire)
            setCursors(cursors)
            // if (tracked > 100) {
            //   tracked = 0;
            // }
            //}
          }
        }
      }
    })
  }, [props.shareId, props.instanceId])

  //64px is the height of the header
  return (
    <Grid
      ref={cursorParent}
      container
      style={{
        height: 'calc(100% - 64px)',
        backgroundColor: props.backgroundColor,
      }}
    >
      {Object.keys(remoteCursors).map((cursor) => (
        <RemoteCursor key={cursor} {...remoteCursors[cursor]} />
      ))}
      {props.children}
    </Grid>
  )
}
