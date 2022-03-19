// Streamy is global, so no import needed
import React from 'react'
import PropTypes from 'prop-types'
import { makeStyles } from '@material-ui/core/styles'
import NearMeIcon from '@material-ui/icons/NearMe'

const useStyles = makeStyles(() => ({
  rotateIcon: {
    transform: 'rotate(270deg)',
  },
}))

export default function RemoteCursor({
  userName,
  fgColor,
  bgColor,
  top,
  left,
}) {
  const classes = useStyles()

  return (
    <div
      style={{
        position: 'absolute',
        top: `${top}px`,
        left: `${left}px`,
        zIndex: '99999',
      }}
    >
      <NearMeIcon className={classes.rotateIcon} />
      <div
        style={{
          padding: `3px`,
          marginLeft: `10px`,
          fontSize: `11pt`,
          fontFamily: `Trebuchet MS`,
          color: fgColor,
          backgroundColor: bgColor,
          border: `1px solid ${fgColor}`,
          borderRadius: `8px 8px`,
        }}
      >
        {userName}
      </div>
    </div>
  )
}

RemoteCursor.propTypes = {
  userName: PropTypes.string.isRequired,
  fgColor: PropTypes.string.isRequired,
  bgColor: PropTypes.string.isRequired,
  top: PropTypes.number.isRequired,
  left: PropTypes.number.isRequired,
}
