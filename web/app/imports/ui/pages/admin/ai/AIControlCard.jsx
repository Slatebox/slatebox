// Admin tools › AI control: the way in to /admin/ai, next to the budget and team imports.
import React from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { AccountActions, AccountPanel, AccountSection, COLUMN_WIDTH } from '../../../common/AccountLayout'

export default function AIControlCard() {
  return (
    <AccountPanel sx={{ maxWidth: COLUMN_WIDTH }}>
      <AccountSection title="AI control" data-testid="ai-control-card">
        <Typography variant="body2">
          Add model providers and their keys, choose which model answers each part of Slatebox, enter the apps
          outside tools sign in through, and see every change with who made it and why.
        </Typography>
        <AccountActions>
          <Button variant="outlined" component={RouterLink} to="/admin/ai">Open AI control</Button>
        </AccountActions>
      </AccountSection>
    </AccountPanel>
  )
}
