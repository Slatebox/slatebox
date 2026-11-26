import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import { useTheme } from '@mui/material/styles'
import CONSTANTS from '../../../api/common/constants'
import confirmService from '../../common/confirm'

const usd = micros => '$' + (micros / 1_000_000).toFixed(2)
const HOLDS = [
  ['', 'Automatic'], ['video-to-voice', 'Video as voice'], ['smaller-ai', 'Smaller AI'], ['pause-calls', 'Pause free calls'], ['pause-ai', 'Pause free AI'],
]
const STAGES = { 0: 'Normal', 50: 'Alerted', 70: 'Video as voice', 90: 'Smaller AI', 100: 'Free calls paused', 110: 'Free AI paused' }
const dateInput = ms => (typeof ms === 'number' ? new Date(ms).toISOString().slice(0, 10) : '')
// The Pro switch as the form holds it: 'now', 'never' or 'date' (with the date field).
function switchMode(value) {
  if (typeof value === 'number') return 'date'
  return value === 'now' ? 'now' : 'never'
}
const SWITCHES = [['now', 'Now: included AI and calls need Pro'], ['never', 'Never: free for everyone signed in'], ['date', 'From a date']]

// The shared budget and Slatebox Pro, for administrators: the budget, the hold, when included AI
// and calls need Pro (now, never or a date; Cloud's deploy settings say now), what Pro credits may
// cost a person a month, and stopping one account's included use. The budget's stages apply to
// free use (presentation plans, and everyone where Pro is not needed), never to Pro credits.
export default function FreeBudget() {
  const [data, setData] = useState(null)
  const [budget, setBudget] = useState('')
  const [hold, setHold] = useState('')
  const [proMode, setProMode] = useState('never')
  const [proDate, setProDate] = useState('')
  const [creditDollars, setCreditDollars] = useState('')
  const [note, setNote] = useState(null)
  const theme = useTheme()

  const load = async () => {
    try {
      const next = await Meteor.callAsync(CONSTANTS.methods.meter.adminSummary)
      setData(next)
      setBudget(String(next.budgetMicros / 1_000_000))
      setHold(next.hold || '')
      setProMode(switchMode(next.proRequiredFrom))
      setProDate(dateInput(next.proRequiredFrom))
      setCreditDollars(String(next.creditCostMicros / 1_000_000))
    } catch (err) {
      setNote({ severity: 'warning', text: err.reason || 'The budget could not be read.' })
    }
  }
  useEffect(() => { load() }, [])
  if (!data) return note ? <Alert severity={note.severity}>{note.text}</Alert> : null

  const save = async () => {
    setNote(null)
    try {
      await Meteor.callAsync(CONSTANTS.methods.meter.setBudget, { monthlyDollars: Number(budget), hold: hold || null })
      setNote({ severity: 'success', text: 'Saved.' })
      load()
    } catch (err) {
      setNote({ severity: 'warning', text: err.reason || 'Not saved.' })
    }
  }

  // When included AI and calls need Slatebox Pro. It changes what people pay, so it is asked twice.
  const saveProSwitch = async () => {
    setNote(null)
    let proRequiredFrom = proMode
    if (proMode === 'date') {
      proRequiredFrom = Date.parse(`${proDate}T00:00:00Z`)
      if (!Number.isFinite(proRequiredFrom)) {
        setNote({ severity: 'warning', text: 'Choose a date.' })
        return
      }
    }
    const sentences = {
      now: 'From now, included AI and calls need Slatebox Pro for everyone on this server.',
      never: 'Included AI and calls will be free for everyone signed in, and Slatebox Pro will not be sold.',
      date: `From ${proDate} (00:00 UTC), included AI and calls need Slatebox Pro for everyone on this server.`,
    }
    const sure = await confirmService.show({
      theme, title: 'Slatebox Pro', message: sentences[proMode],
      actionItems: [{ label: 'Save', return: true }, { label: 'Cancel', return: false }],
    })
    if (!sure) return
    try {
      await Meteor.callAsync(CONSTANTS.methods.meter.setBudget, { proRequiredFrom })
      setNote({ severity: 'success', text: 'Saved.' })
      load()
    } catch (err) {
      setNote({ severity: 'warning', text: err.reason || 'Not saved.' })
    }
  }

  // What Pro credits may cost Slatebox per person a month: every allowance is sized from it.
  const saveCredits = async () => {
    setNote(null)
    try {
      await Meteor.callAsync(CONSTANTS.methods.meter.setBudget, { creditDollars: Number(creditDollars) })
      setNote({ severity: 'success', text: 'Saved.' })
      load()
    } catch (err) {
      setNote({ severity: 'warning', text: err.reason || 'Not saved.' })
    }
  }

  // For accounts that look made to drain the budget. Their own keys and balance still work.
  const setFreeStopped = async (userId, stopped) => {
    setNote(null)
    try {
      await Meteor.callAsync(CONSTANTS.methods.meter.setFreeStopped, { userId, stopped })
      load()
    } catch (err) {
      setNote({ severity: 'warning', text: err.reason || 'Not changed.' })
    }
  }

  const kinds = data.byKind || {}
  return (
    <Box sx={{ my: 3 }} aria-label="Budget and Pro">
      <Typography variant="h6">Budget and Pro</Typography>
      <Typography>
        Slatebox Pro: {data.pro.activeMonthly} monthly, {data.pro.activeYearly} yearly, {data.pro.pastDue} past due.
        {' '}{data.proNeededNow ? 'Included AI and calls need Pro.' : 'Included AI and calls are free for everyone signed in.'}
        {typeof data.proRequiredFrom === 'number' && ` (Pro from ${dateInput(data.proRequiredFrom)}.)`}
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', my: 2, flexWrap: 'wrap' }}>
        <TextField select label="Pro needed" size="small" value={proMode} onChange={e => setProMode(e.target.value)} sx={{ minWidth: 260 }}>
          {SWITCHES.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
        </TextField>
        {proMode === 'date' && <TextField label="Pro needed from (UTC)" type="date" size="small" value={proDate} onChange={e => setProDate(e.target.value)} InputLabelProps={{ shrink: true }} />}
        <Button variant="outlined" onClick={saveProSwitch}>Save</Button>
      </Box>
      <Typography>Pro credits are sized to {usd(data.creditCostMicros)} of provider cost a person a month; full use costs {usd(data.fullUseMicros)}.</Typography>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', my: 2, flexWrap: 'wrap' }}>
        <TextField label="Pro credits, cost a month ($)" type="number" size="small" value={creditDollars} onChange={e => setCreditDollars(e.target.value)} />
        <Button variant="outlined" onClick={saveCredits}>Save</Button>
      </Box>
      <Typography variant="subtitle1">Shared budget (free presentation plans, free talks with the agent, and free use where Pro is not needed)</Typography>
      <Typography>This month: {usd(data.spentMicros)} of {usd(data.budgetMicros)} ({data.percent.toFixed(1)}%). Stage: {STAGES[data.level]}.</Typography>
      <Typography>AI {usd(kinds.ai || 0)} · image search {usd(kinds.imageSearch || 0)} · voice {usd(kinds.voice || 0)} · video {usd(kinds.video || 0)}</Typography>
      <Typography>Today: {usd(data.todayMicros)} of the {usd(data.dailyCeilingMicros)} daily ceiling. 7-day average {usd(data.sevenDayAverageMicros)}. Projected month end {usd(data.projectedMicros)}.</Typography>
      <Typography>People at a cap: {data.atCapToday} today, {data.atCapMonth} this month. Own-key share {(data.ownKeyShare * 100).toFixed(0)}%. Balance spend {usd(data.balanceSpendMicros)}. Pro credits spent {usd(data.proSpentMicros || 0)} (outside the shared budget).</Typography>
      <Typography data-admin-allowance="">Free talks with the agent (the personalization allowance, a day a person: {data.personalAllowance?.interview ?? 0} interview turns, {data.personalAllowance?.['personal.suggest'] ?? 0} runs of For you ideas, {data.personalAllowance?.['personal.build'] ?? 0} builds of an idea): {usd(data.allowanceSpentMicros || 0)} this month, inside the shared budget.</Typography>
      <Typography>Top-ups {data.topUps.count} ({usd(data.topUps.micros)}), refunds {data.refunds.count} ({usd(-data.refunds.micros)}).</Typography>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', my: 2, flexWrap: 'wrap' }}>
        <TextField label="Budget for this month ($)" type="number" size="small" value={budget} onChange={e => setBudget(e.target.value)} />
        <TextField select label="Hold free use at" size="small" value={hold} onChange={e => setHold(e.target.value)} sx={{ minWidth: 200 }}>
          {HOLDS.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
        </TextField>
        <Button variant="contained" onClick={save}>Save</Button>
      </Box>
      {note && <Alert severity={note.severity}>{note.text}</Alert>}
      {data.topPayers.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle1">Most included use this month</Typography>
          {data.topPayers.map(p => (
            <Box key={p.userId} sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <Typography variant="body2">{p.email || p.userId}: {usd(p.micros)}{p.freeStopped ? ' (included use stopped)' : ''}</Typography>
              <Button size="small" onClick={() => setFreeStopped(p.userId, !p.freeStopped)}>{p.freeStopped ? 'Allow included use' : 'Stop included use'}</Button>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
