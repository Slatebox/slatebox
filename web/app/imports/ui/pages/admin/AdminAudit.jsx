// Admin › Activity log (/admin/audit): every activity log on this server, for its administrator:
// this server's own (people outside any team, and the server itself) and each team's. On Slatebox
// Cloud, opening a team's log is itself an entry in that log (audit.viewedByStaff).
import React from 'react'
import { Meteor } from 'meteor/meteor'
import { Link as RouterLink } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import AppPage from '../../common/AppPage'
import ActivityLog from '../../components/audit/ActivityLog'
import { ADMIN_SECTIONS, SELF_HOST_SECTIONS, selfHostedServer } from '../../../api/common/server-admin.mjs'
import { isCloudEdition } from '../../../api/common/edition.mjs'

export default function AdminAudit() {
  const [scopes, setScopes] = React.useState(null)
  const [team, setTeam] = React.useState('server')
  const [error, setError] = React.useState(null)
  React.useEffect(() => {
    Meteor.callAsync('audit.scopes', {}).then((answer) => {
      setScopes(answer.scopes)
      // open the busiest log, not an empty one
      if (answer.scopes[0]?.entries) setTeam(answer.scopes[0].team)
    }).catch((failure) => setError(failure?.reason || failure?.message || 'The logs could not be listed.'))
  }, [])
  const sections = selfHostedServer(Meteor.settings) ? [...ADMIN_SECTIONS, ...SELF_HOST_SECTIONS] : ADMIN_SECTIONS
  const choices = scopes?.some((row) => row.team === 'server') ? scopes : [{ team: 'server', name: 'This server', entries: 0 }, ...(scopes || [])]
  return (
    <AppPage data-admin-audit="" title="Activity log"
      subtitle={isCloudEdition(Meteor.settings)
        ? 'Every team’s log. Opening a team’s log is noted in it, so its admins see that Slatebox staff looked.'
        : 'This server’s own log (people outside any team, and the server itself) and each team’s.'}>
      <Box component="nav" aria-label="Admin sections" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }} data-admin-sections="">
        {sections.map((section) => (
          <Button key={section.id} component={RouterLink} to={section.to} size="small" disableElevation
            variant={section.id === 'audit' ? 'contained' : 'outlined'} aria-current={section.id === 'audit' ? 'page' : undefined}>
            {section.id === 'overview' ? 'Overview' : section.title}
          </Button>
        ))}
      </Box>
      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}
      <TextField select size="small" label="Log" value={team} onChange={(event) => setTeam(event.target.value)} sx={{ minWidth: 280, mb: 2 }} data-admin-audit-scope="">
        {choices.map((row) => <MenuItem key={row.team} value={row.team}>{`${row.name} (${row.entries.toLocaleString('en-US')})`}</MenuItem>)}
      </TextField>
      <ActivityLog key={team} team={team} />
    </AppPage>
  )
}
