import { Meteor } from 'meteor/meteor'
import React from 'react'
import { useTracker } from 'meteor/react-meteor-data'
import Snackbar from '@material-ui/core/Snackbar'
import Alert from '@material-ui/lab/Alert'

export default function ConnectionStatus() {
  const isOnline = useTracker(() => Meteor.status().connected)

  return (
    <Snackbar
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      open={!isOnline}
      autoHideDuration={100000}
    >
      <Alert severity="error">
        Disconnected...your work will not be saved, please wait
      </Alert>
    </Snackbar>
  )
}
