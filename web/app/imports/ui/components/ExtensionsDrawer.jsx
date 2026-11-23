import React from 'react'
import PropTypes from 'prop-types'
import { useTheme } from '@mui/material/styles'
import SwipeableDrawer from '@mui/material/SwipeableDrawer'
import Paper from '@mui/material/Paper'

export default function ExtensionsDrawer({ onDrawerClose, open }) {
  const theme = useTheme()

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
      ModalProps={{
        BackdropProps: {
          invisible: true,
        },
      }}
    >
      <Paper
        sx={{
          backgroundColor: theme.palette.primary.main,
          height: '100vh',
          width: '300px',
        }}
      >
        Coming Soon
      </Paper>
    </SwipeableDrawer>
  )
}
