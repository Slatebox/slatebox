// Admin › Overview: payments from Stripe (read only) and people, plans and agent usage from this
// server's database, in cards (server/admin/dashboard-core.mjs builds it; admin.dashboard, for
// administrators only, kept a minute). Each card shows its own problem; one failure never blanks
// the page. People are shown by masked email only.
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Link as RouterLink } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Link from '@mui/material/Link'
import Skeleton from '@mui/material/Skeleton'
import Typography from '@mui/material/Typography'
import OpenInNew from '@mui/icons-material/OpenInNew'
import Refresh from '@mui/icons-material/Refresh'
import CONSTANTS from '../../../api/common/constants'
import { PLAN_ROWS, count, day, micros, moneyTotals } from './overview-format.mjs'

// the card the new settings pages share (Team settings, Integrations): warm paper, a soft border
const cardSx = (theme) => ({
  bgcolor: '#fffef8', border: '1px solid #e1e3d6', borderRadius: '14px', p: { xs: 2, sm: 2.5 }, minWidth: 0,
  ...theme.applyStyles('dark', { bgcolor: '#23362d', borderColor: '#3a5244' }),
})
const grid = { display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }

function StripeLink({ url }) {
  if (!url) return null
  return (
    <Link href={url} target="_blank" rel="noopener noreferrer" underline="hover" variant="body2"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontWeight: 600 }}>
      Open in Stripe <OpenInNew sx={{ fontSize: 14 }} aria-hidden />
    </Link>
  )
}
StripeLink.propTypes = { url: PropTypes.string }
StripeLink.defaultProps = { url: null }

function Card({ title, data, wide, children, action }) {
  return (
    <Box component="section" sx={(theme) => ({ ...cardSx(theme), ...(wide && { gridColumn: { sm: '1 / -1' } }) })} data-admin-card={title}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 1.25, flexWrap: 'wrap' }}>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, lineHeight: 1.3 }}>{title}</Typography>
        {data?.ok !== false && (action || <StripeLink url={data?.url} />)}
      </Box>
      {data?.ok === false
        ? <Alert severity="warning" variant="outlined" sx={{ py: 0 }}>Could not read this: {data.error}</Alert>
        : children}
    </Box>
  )
}
Card.propTypes = { title: PropTypes.string.isRequired, data: PropTypes.object, wide: PropTypes.bool, children: PropTypes.node, action: PropTypes.node }
Card.defaultProps = { data: null, wide: false, children: null, action: null }

function Big({ value, label }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: { xs: 24, sm: 28 }, fontWeight: 750, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
    </Box>
  )
}
Big.propTypes = { value: PropTypes.node.isRequired, label: PropTypes.node.isRequired }

function Row({ label, value }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.75, borderTop: '1px solid', borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>{value}</Typography>
    </Box>
  )
}
Row.propTypes = { label: PropTypes.node.isRequired, value: PropTypes.node.isRequired }

const Pair = ({ children }) => <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 2 }}>{children}</Box>
Pair.propTypes = { children: PropTypes.node.isRequired }

function Subscriptions({ data }) {
  const cols = [['active', 'Active'], ['trialing', 'Trialing'], ['past_due', 'Past due'], ['canceled', 'Canceled'], ['members', 'Members']]
  return (
    <Card title="Subscriptions" data={data} wide>
      <Box sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', minWidth: 480, '& th, & td': { py: 0.75, px: 1, textAlign: 'right', fontSize: 14, fontVariantNumeric: 'tabular-nums' },
          '& th:first-of-type, & td:first-of-type': { textAlign: 'left', pl: 0 }, '& thead th': { color: 'text.secondary', fontWeight: 600 }, '& tbody tr': { borderTop: '1px solid', borderColor: 'divider' } }}>
          <thead><tr><th scope="col">Plan</th>{cols.map(([id, label]) => <th scope="col" key={id}>{label}</th>)}</tr></thead>
          <tbody>
            {PLAN_ROWS.map(([id, label]) => (
              <tr key={id}><th scope="row" style={{ fontWeight: 600 }}>{label}</th>{cols.map(([c]) => <td key={c}>{count(data?.byPlan?.[id]?.[c])}</td>)}</tr>
            ))}
          </tbody>
        </Box>
      </Box>
      {data?.capped && <Typography variant="caption" color="text.secondary">Counted from the newest 2,000 subscriptions.</Typography>}
    </Card>
  )
}
Subscriptions.propTypes = { data: PropTypes.object }
Subscriptions.defaultProps = { data: null }

function Payments({ payments }) {
  if (!payments) return null
  if (payments.ok === false) return <Alert severity="warning">Could not read Stripe: {payments.error}</Alert>
  if (!payments.on) {
    return (
      <Box sx={cardSx} data-admin-payments-off="">
        <Typography sx={{ fontWeight: 700 }}>{payments.words}</Typography>
        <Typography variant="body2" color="text.secondary">Stripe is used only on Slatebox Cloud with its license and a Stripe key. Nothing is read from Stripe here.</Typography>
      </Box>
    )
  }
  const { customers, revenue, invoices, refunds, failed, topUps } = payments
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 750 }}>Payments</Typography>
        <Chip size="small" label={payments.mode === 'test' ? 'Stripe test mode' : 'Stripe live mode'} color={payments.mode === 'test' ? 'warning' : 'success'} variant="outlined" />
        <Typography variant="body2" color="text.secondary">Read only. Last {payments.days} days where noted.</Typography>
      </Box>
      <Box sx={grid}>
        <Card title="Customers" data={customers}>
          <Pair><Big value={count(customers?.count, customers?.capped)} label="customers" /><Big value={count(customers?.recent)} label={`new in ${payments.days} days`} /></Pair>
          {customers?.newest?.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 650, mb: 0.5 }}>Newest</Typography>
              {customers.newest.map((c, i) => <Row key={`${c.email}-${c.created}-${i}`} label={c.email || 'No email'} value={day(c.created)} />)}
            </Box>
          )}
          {customers?.count === 0 && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>No customers yet.</Typography>}
        </Card>
        <Card title="Recurring revenue (estimate)" data={revenue}>
          <Pair><Big value={moneyTotals(revenue?.mrr)} label="MRR" /><Big value={moneyTotals(revenue?.arr)} label="ARR" /></Pair>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>Active and past-due subscriptions at list price; trials and discounts left out.</Typography>
        </Card>
        <Card title={`Paid invoices, ${payments.days} days`} data={invoices}>
          <Pair><Big value={moneyTotals(invoices?.total)} label="collected" /><Big value={count(invoices?.count, invoices?.capped)} label="invoices" /></Pair>
        </Card>
        <Card title={`Top-ups, ${payments.days} days`} data={topUps}>
          <Pair><Big value={moneyTotals(topUps?.total)} label="credits bought" /><Big value={count(topUps?.count, topUps?.capped)} label="purchases" /></Pair>
        </Card>
        <Card title={`Refunds, ${payments.days} days`} data={refunds}>
          <Pair><Big value={moneyTotals(refunds?.total)} label="refunded" /><Big value={count(refunds?.count, refunds?.capped)} label="refunds" /></Pair>
        </Card>
        <Card title={`Failed payments, ${payments.days} days`} data={failed}>
          <Pair><Big value={moneyTotals(failed?.total)} label="declined" /><Big value={count(failed?.count, failed?.capped)} label="attempts" /></Pair>
        </Card>
        <Subscriptions data={payments.subscriptions} />
      </Box>
    </Box>
  )
}
Payments.propTypes = { payments: PropTypes.object }
Payments.defaultProps = { payments: null }

function Usage({ data }) {
  if (data?.ok !== false && data && !data.meterOn) {
    return <Card title="Agent usage this month" data={data}><Typography variant="body2" color="text.secondary">The meter is off on this server, so agent and call use is not recorded.</Typography></Card>
  }
  const granted = data?.granted || {}
  const spent = data?.spent || {}
  return (
    <Card title={`Agent usage, ${data?.month || 'this month'}`} data={data} wide>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' } }}>
        <Big value={micros(granted.proAllowanceMicros)} label={`included with Pro (${count(granted.proPeople)} people)`} />
        <Big value={micros(granted.topUpMicros)} label="bought as top-ups" />
        <Big value={micros(spent.includedMicros)} label="spent from included credits" />
        <Big value={micros(spent.balanceMicros)} label="spent from balances" />
      </Box>
      <Box sx={{ display: 'grid', gap: 2, mt: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' } }}>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 650, mb: 0.5 }}>By model</Typography>
          {data?.byModel?.length ? data.byModel.map((m) => <Row key={m.name} label={`${m.name} (${count(m.uses)})`} value={micros(m.costMicros)} />)
            : <Typography variant="body2" color="text.secondary">Nothing yet this month.</Typography>}
        </Box>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 650, mb: 0.5 }}>By feature</Typography>
          {data?.byFeature?.length ? data.byFeature.map((m) => <Row key={m.name} label={`${m.name} (${count(m.uses)})`} value={micros(m.costMicros)} />)
            : <Typography variant="body2" color="text.secondary">Nothing yet this month.</Typography>}
        </Box>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 650, mb: 0.5 }}>Top spenders</Typography>
          {data?.topSpenders?.length ? data.topSpenders.map((s, i) => <Row key={`${s.who}-${i}`} label={s.who} value={micros(s.costMicros)} />)
            : <Typography variant="body2" color="text.secondary">Nobody yet this month.</Typography>}
          <Typography variant="body2" sx={{ fontWeight: 650, mt: 1.5, mb: 0.5 }}>Calls on Daily</Typography>
          <Row label="Voice participant-minutes" value={count(data?.calls?.voiceMinutes)} />
          <Row label="Video participant-minutes" value={count(data?.calls?.videoMinutes)} />
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>Provider cost as the meter recorded it; balances show what people were charged.</Typography>
    </Card>
  )
}
Usage.propTypes = { data: PropTypes.object }
Usage.defaultProps = { data: null }

export default function AdminOverview() {
  const [state, setState] = React.useState({ loading: true, data: null, error: null })
  const load = React.useCallback((refresh = false) => {
    setState((s) => ({ ...s, loading: true }))
    Meteor.callAsync(CONSTANTS.methods.admin.dashboard, { refresh })
      .then((data) => setState({ loading: false, data, error: null }), (error) => setState({ loading: false, data: null, error: error?.reason || 'Could not load the overview.' }))
  }, [])
  React.useEffect(() => { load(false) }, [load])
  const { data, loading, error } = state

  return (
    <Box sx={{ display: 'grid', gap: 3 }} data-admin-overview="">
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h5" component="h2" sx={{ fontWeight: 750 }}>Overview</Typography>
          {data?.generatedAt && <Typography variant="caption" color="text.secondary">Updated {new Date(data.generatedAt).toLocaleTimeString('en-US')}; kept for a minute.</Typography>}
        </Box>
        <Button size="small" variant="outlined" startIcon={<Refresh />} onClick={() => load(true)} disabled={loading}>Refresh</Button>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {!data && loading && <Box sx={grid}>{[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={140} />)}</Box>}
      {data && (
        <>
          <Payments payments={data.payments} />
          <Box sx={{ display: 'grid', gap: 2 }}>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 750 }}>This server</Typography>
            <Box sx={grid}>
              <Card title="People" data={data.people}>
                <Pair><Big value={count(data.people?.members)} label="accounts" /><Big value={count(data.people?.guests)} label="guests" /></Pair>
                <Box sx={{ mt: 1 }}>
                  <Row label="Sign-ups, last 7 days" value={count(data.people?.signups7)} />
                  <Row label="Sign-ups, last 30 days" value={count(data.people?.signups30)} />
                </Box>
              </Card>
              <Card title="Plans" data={data.plans}>
                <Pair><Big value={count(data.plans?.pro?.active)} label="Pro people" /><Big value={count(data.plans?.business?.teams)} label="Business teams" /></Pair>
                <Box sx={{ mt: 1 }}>
                  <Row label="Pro trialing" value={count(data.plans?.pro?.trialing)} />
                  <Row label="Pro past due" value={count(data.plans?.pro?.pastDue)} />
                  <Row label="Business members" value={count(data.plans?.business?.members)} />
                </Box>
              </Card>
              <Card title="Library" data={data.library}
                action={<Link component={RouterLink} to="/admin/library" underline="hover" variant="body2" sx={{ fontWeight: 600 }}>Review queue</Link>}>
                <Big value={count(data.library?.waiting)} label="waiting for review" />
              </Card>
              <Usage data={data.usage} />
            </Box>
          </Box>
        </>
      )}
    </Box>
  )
}
