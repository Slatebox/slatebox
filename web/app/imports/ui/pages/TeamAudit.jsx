// Team › Activity log (/team/audit): what people, guests, agents and scripts did on the team's
// slates, for the team's owner and admins. Linked from Team settings › Activity log. The server
// refuses anyone else (server/audit/service.mjs), and the page says so.
import React from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import AppPage from '../common/AppPage'
import ActivityLog from '../components/audit/ActivityLog'

export default function TeamAudit() {
  return (
    <AppPage
      data-team-audit=""
      title="Activity log"
      subtitle="Who did what on the team's slates, and when: people, guests, agents and scripts. Names and ids only, never what a note or comment says."
      eyebrow={<Typography variant="body2" sx={{ mb: 0.5 }}><Link component={RouterLink} to="/team/settings?section=activity" underline="hover">Team settings</Link></Typography>}
    >
      <ActivityLog />
    </AppPage>
  )
}
