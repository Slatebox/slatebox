import { Meteor } from 'meteor/meteor'
import React, { useEffect } from 'react'
import { useTracker } from 'meteor/react-meteor-data'
import Snackbar from '@mui/material/Snackbar'
import { Alert } from '@mui/material'

export default function ConnectionStatus() {
  const isOnline = useTracker(() => Meteor.status().connected)
  const intervalSet = React.useRef(null)
  const [retrySecs, setRetrySecs] = React.useState(
    Meteor.settings.public.retrySecs || 10
  )

  useEffect(() => {
    if (!isOnline) {
      intervalSet.current = window.setInterval(() => {
        setRetrySecs((retrySecs) => retrySecs - 1)
      }, 1000)
      return () => clearInterval(intervalSet.current)
    }
  }, [!isOnline])

  if (retrySecs - 1 < 0) {
    location.reload()
  }

  return (
    <Snackbar
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      open={!isOnline}
      autoHideDuration={100000}
    >
      <Alert severity="error">
        Disconnected...your work will not be saved, please wait - retrying in{' '}
        {retrySecs} seconds
      </Alert>
    </Snackbar>
  )
}
