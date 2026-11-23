// Admin tools › Library submissions: how many smart components, slates and presentations wait for
// review, and the way to the queue (/admin/library).
import React from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import libraryApi from '../../../api/client/library'
import { AccountSection, FinePrint } from '../../common/AccountLayout'

export default function LibraryQueueCard() {
  const [waiting, setWaiting] = React.useState(null)
  React.useEffect(() => {
    let live = true
    libraryApi.review.queue({ status: 'waiting' }).then((answer) => { if (live) setWaiting(answer.total) }, () => { if (live) setWaiting(null) })
    return () => { live = false }
  }, [])
  return (
    <AccountSection title="Library submissions" data-testid="admin-library-card">
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
        <Typography>{waiting === null ? 'Smart components, slates and presentations people sent for review.' : `${waiting} waiting for review.`}</Typography>
        <Button variant="contained" component={RouterLink} to="/admin/library">Open the review queue</Button>
      </Box>
      <FinePrint>Nothing is public until you approve it. You can refine each one with AI before it goes out.</FinePrint>
    </AccountSection>
  )
}
