import React, { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Container from '@mui/material/Container'
import Link from '@mui/material/Link'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
import Overview from './Overview'
import Providers from './Providers'
import Models from './Models'
import Audit from './Audit'

// Admin › AI control (/admin/ai): which AI answers each part of Slatebox and where that choice
// comes from, the providers, keys and models it can use, and every change to the AI configuration. The page calls only the ai.control.* and
// ai.audit.* actions, the same ones an administrator's token, exec, MCP and the CLI call; the
// server checks the administrator on every call.
const TABS = [
  { id: 'overview', label: 'Overview', Panel: Overview },
  { id: 'providers', label: 'Providers and keys', Panel: Providers },
  { id: 'models', label: 'Models', Panel: Models },
  { id: 'audit', label: 'Changes', Panel: Audit },
]

export default function AIControl() {
  const [tab, setTab] = useState('overview')
  const { Panel } = TABS.find((t) => t.id === tab) || TABS[0]
  return (
    <Container maxWidth="xl">
      <Box py={2}>
        <Link component={RouterLink} to="/admin" underline="hover" variant="body2">Admin tools</Link>
        <Typography component="h1" variant="h5" color="text.primary" sx={{ mt: 0.5 }}>AI control</Typography>
        <Typography variant="body2" color="text.secondary">
          Which AI answers each part of Slatebox on this server, where each choice comes from, and who changed it.
        </Typography>
      </Box>
      <Tabs value={tab} onChange={(_event, next) => setTab(next)} aria-label="AI control sections" sx={{ borderBottom: 1, borderColor: 'divider' }}>
        {TABS.map((t) => <Tab key={t.id} value={t.id} label={t.label} id={`ai-control-tab-${t.id}`} aria-controls={`ai-control-panel-${t.id}`} />)}
      </Tabs>
      <Box role="tabpanel" id={`ai-control-panel-${tab}`} aria-labelledby={`ai-control-tab-${tab}`} py={3}>
        <Panel />
      </Box>
    </Container>
  )
}
