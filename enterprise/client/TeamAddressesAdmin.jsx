// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Admin tools › Team addresses (Slatebox Cloud only): every claimed <name>.slatebox.team, who owns
// it, whether its install is connected, and the takedown switches: suspend (451 at the edge within
// seconds), unsuspend, release with a one-year hold, and pausing new claims. Every change is
// audited on the server (enterprise/team-addresses/admin.mjs).
import React, { useCallback, useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { AccountPanel, AccountSection, FinePrint } from '/imports/ui/common/AccountLayout'

const M = {
  list: 'teamAddresses.admin.list',
  why: 'teamAddresses.admin.why',
  suspend: 'teamAddresses.admin.suspend',
  unsuspend: 'teamAddresses.admin.unsuspend',
  release: 'teamAddresses.admin.release',
  pause: 'teamAddresses.admin.pause',
}

const when = (at) => (at ? new Date(at).toLocaleString() : '—')

export default function TeamAddressesAdmin() {
  const [data, setData] = useState(null)
  const [q, setQ] = useState('')
  const [why, setWhy] = useState(null)
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (search = q) => {
    try {
      setData(await Meteor.callAsync(M.list, { q: search }))
      setProblem('')
    } catch (error) {
      if (error?.error === 'not_found') setData(false)
      else setProblem(error?.reason || 'Team addresses could not be read.')
    }
  }, [q])
  useEffect(() => {
    load('')
  }, [])

  const act = async (method, input, confirmText) => {
    // eslint-disable-next-line no-alert
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    try {
      await Meteor.callAsync(method, input)
      await load()
    } catch (error) {
      setProblem(error?.reason || 'That did not work.')
    }
    setBusy(false)
  }

  if (data === false) return null
  if (!data) return problem ? <Alert severity="warning">{problem}</Alert> : null
  return (
    <AccountPanel>
      <AccountSection title="Team addresses" data-testid="team-addresses-admin">
        <Typography variant="body2">
          {data.live} live of {data.maxTunnels} at most. New claims are {data.paused ? 'paused' : 'open'}
          {data.pausedBySettings ? ' (closed in the server settings: nothing calls Cloudflare)' : ''}.
        </Typography>
        <Stack direction="row" spacing={1} sx={{ my: 1 }} flexWrap="wrap" useFlexGap>
          <TextField size="small" label="Find a name, id or owner id" value={q} onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && load(q)} inputProps={{ 'data-testid': 'team-addresses-search' }} />
          <Button variant="outlined" onClick={() => load(q)} disabled={busy}>Find</Button>
          <Button variant="outlined" disabled={busy || !q}
            onClick={async () => setWhy(await Meteor.callAsync(M.why, { name: q }).catch((error) => ({ name: q, reason: error?.reason })))}>
            Why is it unavailable?
          </Button>
          {!data.pausedBySettings && (
            <Button variant={data.paused ? 'contained' : 'outlined'} color="warning" disabled={busy} data-testid="team-addresses-pause"
              onClick={() => act(M.pause, { paused: !data.paused }, data.paused ? null : 'Pause every new team-address claim? Live addresses keep working.')}>
              {data.paused ? 'Open new claims' : 'Pause new claims'}
            </Button>
          )}
        </Stack>
        {why && <FinePrint>{why.name}: {why.reason || 'available'}{why.until ? ` until ${when(why.until)}` : ''}</FinePrint>}
        {problem && <Alert severity="warning">{problem}</Alert>}
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Address</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Owner</TableCell>
              <TableCell>Connected</TableCell>
              <TableCell>Claimed</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {data.claims.map((claim) => (
              <TableRow key={claim.id} data-testid="team-address-row" data-status={claim.status}>
                <TableCell>
                  <Typography variant="body2">{claim.host}</Typography>
                  <FinePrint>{claim.id}{claim.refusal ? ` · would be refused now: ${claim.refusal}` : ''}{claim.needsCleanup ? ' · needs cleanup' : ''}</FinePrint>
                </TableCell>
                <TableCell>
                  {claim.status}
                  {claim.suspension?.reason && <FinePrint>{claim.suspension.reason}</FinePrint>}
                </TableCell>
                <TableCell>{claim.owner || claim.ownerId}</TableCell>
                <TableCell>{claim.lastSeen ? `${claim.lastSeen.connections} now · last ${when(claim.lastSeen.connectedAt)}` : 'never'}</TableCell>
                <TableCell>{when(claim.createdAt)}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1}>
                    {['active', 'pending'].includes(claim.status) && (
                      <Button size="small" color="error" disabled={busy} onClick={() => {
                        // eslint-disable-next-line no-alert
                        const reason = window.prompt(`Suspend ${claim.host}? It answers 451 within seconds. Reason (kept in the audit):`)
                        if (reason) act(M.suspend, { id: claim.id, reason, notice: 'This team address was suspended for breaking the Slatebox terms. Write to abuse@slatebox.com to appeal.' })
                      }}>Suspend</Button>
                    )}
                    {claim.status === 'suspended' && <Button size="small" disabled={busy} onClick={() => act(M.unsuspend, { id: claim.id })}>Unsuspend</Button>}
                    {!['released', 'failed'].includes(claim.status) && (
                      <Button size="small" color="error" disabled={busy}
                        onClick={() => act(M.release, { id: claim.id }, `Release ${claim.host} and hold the name from everyone for a year?`)}>
                        Release
                      </Button>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <FinePrint>Abuse reports arrive at abuse@slatebox.com. A suspension keeps the name, so it cannot be claimed again meanwhile.</FinePrint>
      </AccountSection>
    </AccountPanel>
  )
}
