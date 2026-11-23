import React from 'react'
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { useTracker } from 'meteor/react-meteor-data'
import { Box, Link, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'

const history = new Mongo.Collection('joinedSlateHistory')
const rows = new Mongo.Collection('joinedSlateRows')

export default function RecentlyJoined() {
  const joined = useTracker(() => {
    const userId = Meteor.userId()
    if (!userId) return []
    Meteor.subscribe('joinedSlates.index')
    const revision = history.findOne(userId)?.revision
    if (!revision) return []
    const subscription = Meteor.subscribe('joinedSlates.rows', revision)
    return subscription.ready() ? rows.find({}, { sort: { index: 1 } }).fetch() : []
  }, [])
  if (!joined.length) return null
  return <Box component="section" aria-labelledby="joined-heading" sx={{ px: 1, mb: 3 }}>
    <Typography id="joined-heading" component="h2" variant="h6">Recently joined</Typography>
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {joined.map(row => <li key={row._id}>
        <Link component={RouterLink} to={'/canvas/' + row.accessKey}
          sx={{ display: 'inline-block', py: 1, overflowWrap: 'anywhere' }}>{row.title}</Link>
      </li>)}
    </Box>
  </Box>
}
