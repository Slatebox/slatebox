import React from 'react'
import PropTypes from 'prop-types'
import { makeStyles } from '@material-ui/core/styles'
import SwipeableDrawer from '@material-ui/core/SwipeableDrawer'
import Paper from '@material-ui/core/Paper'

const useStyles = makeStyles((theme) => ({
  paper: {
    backgroundColor: theme.palette.primary.main,
    height: '100vh',
    width: '300px',
  },
  content: {
    margin: theme.spacing(3),
  },
  whiteText: {
    color: '#fff',
  },
  heading: {
    fontSize: theme.typography.pxToRem(15),
  },
}))

export default function ExtensionsDrawer({ onDrawerClose, open }) {
  const classes = useStyles()
  const handleClose = () => {
    if (onDrawerClose) onDrawerClose()
  }

  ExtensionsDrawer.propTypes = {
    onDrawerClose: PropTypes.func.isRequired,
    open: PropTypes.bool.isRequired,
  }

  return (
    <SwipeableDrawer
      anchor="right"
      open={open || false}
      onClose={handleClose}
      onOpen={() => {}}
      disableBackdropTransition
      disableDiscovery
      disableSwipeToOpen
      classes={{ paper: classes.paper }}
      ModalProps={{
        BackdropProps: {
          invisible: true,
        },
      }}
    >
      <Paper className={classes.paper}>Coming Soon</Paper>
    </SwipeableDrawer>
  )
}
