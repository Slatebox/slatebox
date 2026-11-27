// The activity log of a team (or of this server): who did what to which slate, when, and through
// which door, newest first, with filters, the chain check and CSV or JSON export. The team page
// (/team/audit) and the server admin's page (/admin/audit) both show it; the server decides who
// may read which log (server/audit/service.mjs) and answers anyone else with a refusal.
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import VerifiedOutlined from '@mui/icons-material/VerifiedOutlined'
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined'
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined'
import { AUDIT_GROUPS, VIA_LABELS, chainBadge, keptFor } from '../../../api/common/audit-words.mjs'
import { isCloudEdition } from '../../../api/common/edition.mjs'
import BusinessGateNotice, { useBusinessAccess } from '../teams/security/BusinessGate'
import { businessGate } from '../teams/security/business-gate-model.mjs'

const PAGE = 100

const card = (theme) => ({
  bgcolor: '#fffef8', border: '1px solid #e1e3d6', borderRadius: '14px', p: { xs: 2, sm: 2.5 }, minWidth: 0,
  ...theme.applyStyles('dark', { bgcolor: '#23362d', borderColor: '#3a5244' }),
})

const when = (iso) => {
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? '' : time.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// A date field (YYYY-MM-DD) as the start of that day, or the start of the next one for "to".
const dayTime = (value, next = false) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return undefined
  const time = new Date(`${value}T00:00:00`)
  if (next) time.setDate(time.getDate() + 1)
  return time.toISOString()
}

const failureText = (error) => error?.reason || error?.message || 'The activity log could not be read.'
// audit.list's refusal when the team's plan does not include the log (server/audit/service.mjs)
const planRequired = (error) => error?.error === 'plan_required'

function Badge({ result }) {
  const badge = chainBadge(result)
  const Icon = badge.tone === 'warn' ? ReportProblemOutlined : VerifiedOutlined
  const tones = { warn: 'warning.main', ok: 'success.main' }
  return (
    <Box data-audit-chain={badge.tone} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
      <Icon fontSize="small" aria-hidden sx={{ mt: '2px', color: tones[badge.tone] || 'text.secondary' }} />
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 650 }}>{badge.text}</Typography>
        {badge.detail && <Typography variant="body2" color="text.secondary">{badge.detail}</Typography>}
      </Box>
    </Box>
  )
}
Badge.propTypes = {
  result: PropTypes.shape({ ok: PropTypes.bool, checked: PropTypes.number, since: PropTypes.string, pending: PropTypes.number, problem: PropTypes.shape({ seq: PropTypes.number, kind: PropTypes.string }) }),
}
Badge.defaultProps = { result: null }

export default function ActivityLog({ team }) {
  // A reload resumes the sign-in after the page draws: read the log once it has.
  const userId = useTracker(() => (Meteor.loggingIn() ? null : Meteor.userId()))
  const [filters, setFilters] = React.useState({ action: '', actor: '', slate: null, via: '', from: '', to: '', address: '' })
  const [rows, setRows] = React.useState([])
  const [next, setNext] = React.useState(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(null)
  const [chain, setChain] = React.useState(null)
  const [people, setPeople] = React.useState(new Map())
  const [exporting, setExporting] = React.useState(null)
  const [addressDraft, setAddressDraft] = React.useState('')
  const [gated, setGated] = React.useState(false)
  const access = useBusinessAccess()

  const query = React.useCallback((before) => {
    const input = { limit: PAGE, ...(team && { team }) }
    if (filters.action) input.action = filters.action
    if (filters.actor) input.actor = filters.actor
    if (filters.slate) input.slate = filters.slate.id
    if (filters.via) input.via = filters.via
    const from = dayTime(filters.from)
    const to = dayTime(filters.to, true)
    if (from) input.from = from
    if (to) input.to = to
    if (filters.address) input.address = filters.address
    if (before) input.before = before
    return input
  }, [team, filters])

  const load = React.useCallback(async (before = null) => {
    if (!userId) return
    setLoading(true)
    setError(null)
    setGated(false)
    try {
      const page = await Meteor.callAsync('audit.list', query(before))
      setRows((had) => (before ? [...had, ...page.events] : page.events))
      setNext(page.next)
      setPeople((had) => {
        const known = new Map(had)
        page.events.filter((event) => event.actor?.userId && event.actor.kind !== 'agent').forEach((event) => known.set(event.actor.userId, event.actor.label))
        return known
      })
    } catch (failure) {
      setError(failureText(failure))
      setGated(planRequired(failure))
      if (!before) setRows([])
    } finally {
      setLoading(false)
    }
  }, [query, userId])

  React.useEffect(() => { load() }, [load])
  React.useEffect(() => {
    let live = true
    setChain(null)
    if (!userId) return () => { live = false }
    Meteor.callAsync('audit.verify', team ? { team } : {}).then((result) => { if (live) setChain(result) }).catch(() => {})
    return () => { live = false }
  }, [team, userId])

  const set = (key) => (event) => setFilters((had) => ({ ...had, [key]: event.target.value }))
  const exportAs = async (format) => {
    setExporting(format)
    setError(null)
    try {
      const { limit: _limit, ...filter } = query(null)
      const answer = await Meteor.callAsync('audit.export', { ...filter, format })
      window.location.assign(new URL(answer.downloadUrl).pathname)
    } catch (failure) {
      setError(failureText(failure))
    } finally {
      setExporting(null)
    }
  }
  const filtered = Boolean(filters.action || filters.actor || filters.slate || filters.via || filters.from || filters.to || filters.address)
  const cloud = isCloudEdition(Meteor.settings)
  // The team's own log on Cloud without Business: say it comes with Business, and how to get it.
  // Elsewhere (a server admin opening a team's log, a self-hosted server) the server's words stand.
  const gate = gated && !team && cloud ? businessGate({ feature: 'log', available: false, ...access }) : null

  return (
    <Box sx={{ display: 'grid', gap: 2, minWidth: 0 }} data-activity-log="">
      <Box sx={(theme) => ({ ...card(theme), display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', justifyContent: 'space-between' })}>
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          <Badge result={chain} />
          {chain && <Typography variant="body2" color="text.secondary">{keptFor({ cloud, keptDays: chain.keptDays })}</Typography>}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<FileDownloadOutlined />} disabled={Boolean(exporting) || Boolean(gate)} onClick={() => exportAs('csv')} data-audit-export="csv">
            {exporting === 'csv' ? 'Preparing…' : 'Export CSV'}
          </Button>
          <Button variant="outlined" startIcon={<FileDownloadOutlined />} disabled={Boolean(exporting) || Boolean(gate)} onClick={() => exportAs('json')} data-audit-export="json">
            {exporting === 'json' ? 'Preparing…' : 'Export JSON'}
          </Button>
        </Box>
      </Box>

      <Box component="form" role="search" aria-label="Filter the activity log" onSubmit={(event) => { event.preventDefault(); setFilters((had) => ({ ...had, address: addressDraft.trim() })) }}
        sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(6, minmax(0, 1fr))' } }}>
        <TextField select size="small" label="What" value={filters.action} onChange={set('action')} data-audit-filter="action">
          <MenuItem value="">Everything</MenuItem>
          {Object.entries(AUDIT_GROUPS).map(([id, label]) => <MenuItem key={id} value={id}>{label}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Who" value={filters.actor} onChange={set('actor')} data-audit-filter="actor">
          <MenuItem value="">Anyone</MenuItem>
          {[...people.entries()].map(([id, label]) => <MenuItem key={id} value={id}>{label}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Through" value={filters.via} onChange={set('via')} data-audit-filter="via">
          <MenuItem value="">Any door</MenuItem>
          {Object.entries(VIA_LABELS).map(([id, label]) => <MenuItem key={id} value={id}>{label}</MenuItem>)}
        </TextField>
        <TextField size="small" type="date" label="From" value={filters.from} onChange={set('from')} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" type="date" label="To" value={filters.to} onChange={set('to')} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" label="Check an address" placeholder="203.0.113.7" value={addressDraft} onChange={(event) => setAddressDraft(event.target.value)}
          helperText={filters.address ? `Showing requests from ${filters.address}` : 'Press Enter to check'} data-audit-filter="address" />
      </Box>

      {(filters.slate || filtered) && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          {filters.slate && <Chip label={`Slate: ${filters.slate.name}`} onDelete={() => setFilters((had) => ({ ...had, slate: null }))} />}
          <Button size="small" onClick={() => { setAddressDraft(''); setFilters({ action: '', actor: '', slate: null, via: '', from: '', to: '', address: '' }) }}>Clear filters</Button>
        </Box>
      )}

      {gate && <BusinessGateNotice gate={gate} />}
      {error && !gate && <Alert severity="warning" data-audit-error="">{error}</Alert>}

      <Box sx={(theme) => ({ ...card(theme), p: 0, overflowX: 'auto' })}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, '& th, & td': { textAlign: 'left', px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', verticalAlign: 'top' }, '& th': { fontWeight: 650, color: 'text.secondary', fontSize: 13, whiteSpace: 'nowrap' }, '& tbody tr:last-of-type td': { borderBottom: 0 } }}>
          <thead>
            <tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Through</th></tr>
          </thead>
          <tbody data-audit-rows="">
            {rows.map((event) => (
              <tr key={event.seq} data-audit-row={event.action}>
                <Box component="td" sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{when(event.at)}</Box>
                <Box component="td" sx={{ fontWeight: 600, minWidth: 160 }}>{event.actor?.label}</Box>
                <Box component="td" sx={{ minWidth: 240 }}>
                  {event.summary}
                  {event.slateId && event.target?.type === 'slate' && (
                    <>
                      {' · '}
                      <Button size="small" variant="text" sx={{ p: 0, minWidth: 0, verticalAlign: 'baseline', textTransform: 'none' }}
                        onClick={() => setFilters((had) => ({ ...had, slate: { id: event.slateId, name: event.target?.name || event.slateId } }))}>
                        only this slate
                      </Button>
                    </>
                  )}
                </Box>
                <Box component="td" sx={{ whiteSpace: 'nowrap' }}>{VIA_LABELS[event.via] || event.via}</Box>
              </tr>
            ))}
          </tbody>
        </Box>
        {!loading && !rows.length && !error && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2.5 }} data-audit-empty="">
            {filtered || filters.slate ? 'Nothing matches these filters.' : 'Nothing has happened here yet. What people do on these slates shows up here.'}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {next !== null && <Button variant="outlined" disabled={loading} onClick={() => load(next)}>Show older</Button>}
        {loading && <Typography variant="body2" color="text.secondary">Loading…</Typography>}
      </Box>
    </Box>
  )
}
ActivityLog.propTypes = { team: PropTypes.string }
ActivityLog.defaultProps = { team: undefined }
