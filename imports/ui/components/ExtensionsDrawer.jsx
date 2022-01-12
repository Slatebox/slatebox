import React, { useEffect, useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import SwipeableDrawer from '@material-ui/core/SwipeableDrawer';
import Paper from '@material-ui/core/Paper';

const useStyles = makeStyles((theme) => ({
  paper: {
    backgroundColor: theme.palette.primary.main,
    height: "100vh",
    width: "300px"
  },
  content: {
    margin: theme.spacing(3)
  },
  whiteText: {
    color: '#fff'
  },
  heading: {
    fontSize: theme.typography.pxToRem(15)
  }
}));

export const ExtensionsDrawer = (props) => {

  const classes = useStyles();
  const handleClose = (e) => {
    props?.onDrawerClose();
  }

  return (
    <SwipeableDrawer
      anchor="right"
      open={props?.open || false}
      onClose={handleClose}
      onOpen={() => {}}
      disableBackdropTransition={true}
      disableDiscovery={true}
      disableSwipeToOpen={true}
      classes={{ paper: classes.paper }}
      ModalProps={{
        BackdropProps: {
          invisible: true
        }
      }}
    >
      <Paper className={classes.paper}>
        Coming Soon
      </Paper>
    </SwipeableDrawer>
  )
}