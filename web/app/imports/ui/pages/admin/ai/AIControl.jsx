import React, { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import AppPage from '../../../common/AppPage'
import Link from '@mui/material/Link'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Overview from './Overview'
import Providers from './Providers'
import Models from './Models'
import Bindings from './Bindings'
import Prompts from './Prompts'
import Effective from './Effective'
import Audit from './Audit'
import Gallery from './Gallery'
import IntegrationApps from './IntegrationApps'

// Admin › AI control (/admin/ai): which model answers each part of Slatebox, the providers and
// their keys (kept only in the backend), the models with their prices, one choice per part, the
// prompts each part sends, the outside agents people can invite (Agent gallery), the OAuth apps
// outside tools sign in through (Integration apps), and every change to the AI configuration. The
// page calls only the ai.control.*, ai.providers.*, ai.keys.*, ai.models.*, ai.bindings.*,
// ai.prompts.*, ai.agents.gallery.*, connectors.apps.* and ai.audit.* actions, the same
// ones an administrator's token, exec, MCP and the CLI call; the server checks the administrator on
// every call.
const TABS = [
  { id: 'overview', label: 'Overview', Panel: Overview },
  { id: 'providers', label: 'Providers and keys', Panel: Providers },
  { id: 'integration-apps', label: 'Integration apps', Panel: IntegrationApps },
  { id: 'models', label: 'Models', Panel: Models },
  { id: 'bindings', label: 'Bindings', Panel: Bindings },
  { id: 'prompts', label: 'Prompts', Panel: Prompts },
  { id: 'gallery', label: 'Agent gallery', Panel: Gallery },
  { id: 'effective', label: 'What a person gets', Panel: Effective },
  { id: 'audit', label: 'Changes', Panel: Audit },
]

export default function AIControl() {
  const [tab, setTab] = useState('overview')
  const { Panel } = TABS.find((t) => t.id === tab) || TABS[0]
  return (
    <AppPage title="AI control"
      eyebrow={<Link component={RouterLink} to="/admin" underline="hover" variant="body2">Server admin</Link>}
      subtitle="Which model answers each part of Slatebox on this server, the providers and keys it uses, and who changed what.">
      <Tabs variant="scrollable" scrollButtons={false} value={tab} onChange={(_event, next) => setTab(next)} aria-label="AI control sections" sx={{ borderBottom: 1, borderColor: 'divider' }}>
        {TABS.map((t) => <Tab key={t.id} value={t.id} label={t.label} id={`ai-control-tab-${t.id}`} aria-controls={`ai-control-panel-${t.id}`} />)}
      </Tabs>
      <Box role="tabpanel" id={`ai-control-panel-${tab}`} aria-labelledby={`ai-control-tab-${tab}`} py={3}>
        <Panel />
      </Box>
    </AppPage>
  )
}
