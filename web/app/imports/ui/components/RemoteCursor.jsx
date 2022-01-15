//Streamy is global, so no import needed
import React, { useEffect, useLayoutEffect } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import NearMeIcon from '@material-ui/icons/NearMe';

const useStyles = makeStyles((theme) => ({
  rotateIcon: {
    transform: 'rotate(270deg)'
  }
}));

export const RemoteCursor = (props) => {

  const classes = useStyles();

  //let secondsToExpire = 10;
  
  // useEffect(() => {
  //   this.setInterval(() => {
  //     if ((new Date().valueOf() - props.dateLastMoved)/1000 > secondsToExpire) {
  //       props.onExpiration(props.dataKey);
  //     }
  //   }, 5000);
  // }, [])
  
  return (
    <div style={{position: 'absolute', top: `${props.top}px`, left: `${props.left}px`, zIndex:'99999' }}>
      <NearMeIcon className={classes.rotateIcon}/>
        <div style={{
            padding: `3px`
          , marginLeft: `10px`
          , fontSize: `11pt`
          , fontFamily: `Trebuchet MS`
          , color: props.fgColor
          , backgroundColor: props.bgColor
          , border: `1px solid ${props.fgColor}`
          , borderRadius: `8px 8px`
        }}>
          {props.userName}
        </div>
    </div>
  )

}