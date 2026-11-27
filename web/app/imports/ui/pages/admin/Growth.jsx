// Admin › Growth (/admin/growth), Slatebox Cloud only: which links bring people and how far they get
// (server/growth/funnel-core.mjs growthSummary, read by admin.growth for administrators only). Each
// step is counted once per account, in the week it happened, under the source that first brought
// that browser. Counts only: no people, no addresses.
import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Link as RouterLink } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Skeleton from '@mui/material/Skeleton'
import Typography from '@mui/material/Typography'
import Refresh from '@mui/icons-material/Refresh'
import AppPage from '../../common/AppPage'
import CONSTANTS from '../../../api/common/constants'
import { ADMIN_SECTIONS, CLOUD_SECTIONS } from '../../../api/common/server-admin.mjs'
import { PAID_KINDS, PAID_LABELS, STEPS, STEP_LABELS, funnelRows, rate } from '../../../api/common/growth.mjs'

const cardSx = (theme) => ({
  bgcolor: '#fffef8', border: '1px solid #e1e3d6', borderRadius: '14px', p: { xs: 2, sm: 2.5 }, minWidth: 0,
  ...theme.applyStyles('dark', { bgcolor: '#23362d', borderColor: '#3a5244' }),
})
const tableSx = {
  width: '100%', borderCollapse: 'collapse', minWidth: 640,
  '& th, & td': { py: 0.75, px: 1, textAlign: 'right', fontSize: 14, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  '& tr > :first-of-type': { textAlign: 'left', pl: 0 },
  '& thead th': { color: 'text.secondary', fontWeight: 600 },
  '& tbody tr': { borderTop: '1px solid', borderColor: 'divider' },
}
const SHORT = { landing: 'Tagged', visit: 'Visits', slate: 'Slate', signup: 'Signup', share: 'Share', return: 'Return', invite: 'Invite', paid: 'Paid' }
const num = (n) => (Number(n) || 0).toLocaleString('en-US')
const pct = (value) => (value === null ? '–' : `${value}%`)
const weekLabel = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function Section({ title, detail, children }) {
  return (
    <Box component="section" sx={cardSx} data-growth-card={title}>
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>{title}</Typography>
      {detail && <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{detail}</Typography>}
      <Box sx={{ overflowX: 'auto' }}>{children}</Box>
    </Box>
  )
}
Section.propTypes = { title: PropTypes.string.isRequired, detail: PropTypes.node, children: PropTypes.node.isRequired }
Section.defaultProps = { detail: null }

function Funnel({ totals }) {
  const rows = funnelRows(totals.steps)
  const top = Math.max(1, ...rows.map((r) => r.n))
  return (
    <Section title="The funnel" detail="Each step counted once per account. The share is of the step above it.">
      <Box sx={{ display: 'grid', gap: 1, minWidth: 320 }} data-growth-funnel="">
        {rows.map((row) => (
          <Box key={row.step} sx={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 220px) 1fr 70px 50px', gap: 1.5, alignItems: 'center' }}>
            <Typography variant="body2">{row.label}</Typography>
            <Box sx={{ height: 10, borderRadius: 5, bgcolor: 'action.hover', overflow: 'hidden' }} aria-hidden>
              <Box sx={{ height: '100%', width: `${Math.round((100 * row.n) / top)}%`, bgcolor: 'success.main', borderRadius: 5 }} />
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{num(row.n)}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>{pct(row.rate)}</Typography>
          </Box>
        ))}
      </Box>
    </Section>
  )
}
Funnel.propTypes = { totals: PropTypes.object.isRequired }

function BySource({ rows }) {
  return (
    <Section title="By source" detail="The ref or utm_source of the link that first brought a browser, else the site it came from. 'direct': no link, no referring site. 'shared-link': a shared slate or presentation opened straight. 'existing': accounts from before counting began (only their payments count).">
      <Box component="table" sx={tableSx} data-growth-sources="">
        <thead><tr><th scope="col">Source</th>{STEPS.map((s) => <th scope="col" key={s}>{SHORT[s]}</th>)}<th scope="col">Visit to signup</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={STEPS.length + 2}>Nothing counted yet.</td></tr>}
          {rows.map((row) => (
            <tr key={row.source}>
              <th scope="row" style={{ fontWeight: 600, fontStyle: row.rolledUp ? 'italic' : 'normal' }}>{row.source}</th>
              {STEPS.map((s) => <td key={s}>{num(row.steps[s])}</td>)}
              <td>{pct(rate(row.steps.signup, row.steps.visit))}</td>
            </tr>
          ))}
        </tbody>
      </Box>
    </Section>
  )
}
BySource.propTypes = { rows: PropTypes.arrayOf(PropTypes.object).isRequired }

function ByWeek({ rows }) {
  return (
    <Section title="By week" detail="Weeks start on Monday (UTC). A step counts in the week it happened.">
      <Box component="table" sx={tableSx} data-growth-weeks="">
        <thead><tr><th scope="col">Week of</th>{STEPS.map((s) => <th scope="col" key={s}>{SHORT[s]}</th>)}</tr></thead>
        <tbody>
          {[...rows].reverse().map((row) => (
            <tr key={row.week}><th scope="row" style={{ fontWeight: 600 }}>{weekLabel(row.week)}</th>{STEPS.map((s) => <td key={s}>{num(row.steps[s])}</td>)}</tr>
          ))}
        </tbody>
      </Box>
    </Section>
  )
}
ByWeek.propTypes = { rows: PropTypes.arrayOf(PropTypes.object).isRequired }

function Paid({ totals, bySource, byWeek }) {
  const sources = bySource.filter((row) => PAID_KINDS.some((k) => row.paid[k]))
  return (
    <Section title="Paid conversions" detail="First payment of each kind per account: Slatebox Business bought by a team's owner, Slatebox Pro, a top-up, or an own AI key added.">
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(5, 1fr)' }, gap: 2, mb: 2 }} data-growth-paid="">
        <Box><Typography sx={{ fontSize: 26, fontWeight: 750 }}>{num(totals.steps.paid)}</Typography><Typography variant="body2" color="text.secondary">Accounts that paid</Typography></Box>
        {PAID_KINDS.map((k) => (
          <Box key={k}><Typography sx={{ fontSize: 26, fontWeight: 750 }}>{num(totals.paid[k])}</Typography><Typography variant="body2" color="text.secondary">{PAID_LABELS[k]}</Typography></Box>
        ))}
      </Box>
      <Box component="table" sx={tableSx}>
        <thead><tr><th scope="col">Source</th>{PAID_KINDS.map((k) => <th scope="col" key={k}>{PAID_LABELS[k]}</th>)}<th scope="col">Signup to paid</th></tr></thead>
        <tbody>
          {sources.length === 0 && <tr><td colSpan={PAID_KINDS.length + 2}>No payments counted yet.</td></tr>}
          {sources.map((row) => (
            <tr key={row.source}><th scope="row" style={{ fontWeight: 600 }}>{row.source}</th>{PAID_KINDS.map((k) => <td key={k}>{num(row.paid[k])}</td>)}<td>{pct(rate(row.steps.paid, row.steps.signup))}</td></tr>
          ))}
        </tbody>
      </Box>
      <Box component="table" sx={{ ...tableSx, mt: 2 }}>
        <thead><tr><th scope="col">Week of</th>{PAID_KINDS.map((k) => <th scope="col" key={k}>{PAID_LABELS[k]}</th>)}</tr></thead>
        <tbody>
          {[...byWeek].reverse().filter((row) => PAID_KINDS.some((k) => row.paid[k])).map((row) => (
            <tr key={row.week}><th scope="row" style={{ fontWeight: 600 }}>{weekLabel(row.week)}</th>{PAID_KINDS.map((k) => <td key={k}>{num(row.paid[k])}</td>)}</tr>
          ))}
        </tbody>
      </Box>
    </Section>
  )
}
Paid.propTypes = { totals: PropTypes.object.isRequired, bySource: PropTypes.arrayOf(PropTypes.object).isRequired, byWeek: PropTypes.arrayOf(PropTypes.object).isRequired }

function Campaigns({ rows }) {
  if (!rows.length) return null
  return (
    <Section title="Campaigns" detail="Links with utm_campaign, by source.">
      <Box component="table" sx={{ ...tableSx, minWidth: 420 }}>
        <thead><tr><th scope="col">Source / campaign</th><th scope="col">Tagged</th><th scope="col">Signup</th><th scope="col">Paid</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.source}|${row.campaign}`}><th scope="row" style={{ fontWeight: 600 }}>{row.source} / {row.campaign}</th><td>{num(row.landing)}</td><td>{num(row.signup)}</td><td>{num(row.paid)}</td></tr>
          ))}
        </tbody>
      </Box>
    </Section>
  )
}
Campaigns.propTypes = { rows: PropTypes.arrayOf(PropTypes.object).isRequired }

export default function Growth() {
  const [weeks, setWeeks] = useState(12)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setBusy(true)
    try {
      setData(await Meteor.callAsync(CONSTANTS.methods.admin.growth, { weeks }))
      setError(null)
    } catch (e) {
      setError(e.reason || e.message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => { load() }, [weeks])

  return (
    <AppPage title="Growth" subtitle="Which links bring people to Slatebox Cloud, and how far they get. First-party counts only; browsers that send Do Not Track or Global Privacy Control are never counted.">
      <Box component="nav" aria-label="Admin sections" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }} data-admin-sections="">
        {[...ADMIN_SECTIONS, ...CLOUD_SECTIONS].map((section) => (
          <Button key={section.id} component={RouterLink} to={section.to} size="small" disableElevation
            variant={section.id === 'growth' ? 'contained' : 'outlined'} aria-current={section.id === 'growth' ? 'page' : undefined}>
            {section.id === 'overview' ? 'Overview' : section.title}
          </Button>
        ))}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Select size="small" value={weeks} onChange={(e) => setWeeks(e.target.value)} aria-label="How many weeks">
          {[4, 12, 26, 52].map((n) => <MenuItem key={n} value={n}>Last {n} weeks</MenuItem>)}
        </Select>
        <Button size="small" startIcon={<Refresh />} onClick={load} disabled={busy}>Refresh</Button>
        {data?.since && <Typography variant="body2" color="text.secondary">Since {weekLabel(data.since)}</Typography>}
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {!error && !data && <Skeleton variant="rounded" height={240} />}
      {data && data.on === false && <Alert severity="info">The growth funnel runs only on Slatebox Cloud. Nothing is counted on this server.</Alert>}
      {data && data.on && (
        <Box sx={{ display: 'grid', gap: 2 }} data-testid="admin-growth">
          <Funnel totals={data.totals} />
          <BySource rows={data.bySource} />
          <ByWeek rows={data.byWeek} />
          <Paid totals={data.totals} bySource={data.bySource} byWeek={data.byWeek} />
          <Campaigns rows={data.campaigns} />
          <Typography variant="caption" color="text.secondary">
            {STEPS.map((s) => `${SHORT[s]}: ${STEP_LABELS[s].toLowerCase()}`).join(' · ')}. Raw events are kept 90 days; the weekly counts hold no account ids.
          </Typography>
        </Box>
      )}
    </AppPage>
  )
}
