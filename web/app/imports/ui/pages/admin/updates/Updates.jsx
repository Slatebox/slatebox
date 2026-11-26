// Admin › Updates (/admin/updates), on a self-hosted server: the version it runs, what GitHub
// offers (signed by Slatebox), when updates are applied, and what happened. Every button asks the
// server (server/updates/meteor.js), which checks the server administrator claim again; the host
// updater does the update itself after checking the signed release on its own.
import React from 'react'
import { Meteor } from 'meteor/meteor'
import { Link as RouterLink } from 'react-router-dom'
import { useSetAtom } from 'jotai'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Link from '@mui/material/Link'
import MenuItem from '@mui/material/MenuItem'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Stepper from '@mui/material/Stepper'
import Switch from '@mui/material/Switch'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import VerifiedUser from '@mui/icons-material/VerifiedUser'
import AppPage from '../../../common/AppPage'
import { AccountSection, FinePrint, MONO } from '../../../common/AccountLayout'
import CONSTANTS from '../../../../api/common/constants'
import { ADMIN_SECTIONS, SELF_HOST_SECTIONS } from '../../../../api/common/server-admin.mjs'
import { globalMessage } from '../../../jotai/atoms'
import {
  DAYS, HOLD_BACK_CHOICES, LENGTH_CHOICES, STEPS, ago, attemptRows, dateTime, eventRows, noteLines, primaryAction, shortDate, stepIndex,
  timeZones, updaterLine, windowWords,
} from './updates-view.mjs'

const M = CONSTANTS.methods.updates
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'UTC' } }

function Row({ label, children }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '180px 1fr' }, gap: { xs: 0.25, sm: 2 }, py: 0.75 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Box>{children}</Box>
    </Box>
  )
}

export default function Updates() {
  const setMessage = useSetAtom(globalMessage)
  const [status, setStatus] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [draft, setDraft] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [rollbackOpen, setRollbackOpen] = React.useState(false)
  const [typed, setTyped] = React.useState('')

  const load = React.useCallback(async () => {
    try {
      let next = await Meteor.callAsync(M.status)
      // A policy nobody has set yet takes the first administrator's own time zone, once and stored,
      // so the window on this page is the window the server applies.
      if (next.policySource !== 'admin' && !next.zoneFrom && next.policy.timeZone !== browserZone()) {
        const adopted = await Meteor.callAsync(M.adoptTimeZone, browserZone()).catch(() => null)
        if (adopted?.adopted) next = await Meteor.callAsync(M.status)
      }
      setStatus(next)
      setDraft((current) => current || { ...next.policy })
      setError(null)
    } catch (e) {
      setError(e.reason || e.message)
    }
  }, [])

  React.useEffect(() => {
    load()
    // While an update runs, the phases come in every few seconds.
    const timer = setInterval(load, status?.attempt ? 4000 : 30000)
    return () => clearInterval(timer)
  }, [load, Boolean(status?.attempt)])

  const call = async (name, args, done) => {
    setBusy(true)
    try {
      const answer = await Meteor.callAsync(name, ...args)
      if (done) setMessage({ visible: true, text: typeof done === 'function' ? done(answer) : done, severity: 'success', autoHide: 6000 })
      await load()
      return answer
    } catch (e) {
      setMessage({ visible: true, text: e.reason || e.message, severity: 'error', autoHide: 10000 })
      return null
    } finally {
      setBusy(false)
    }
  }

  if (error) return <AppPage title="Updates"><Alert severity="error">{error}</Alert></AppPage>
  if (!status || !draft) return <AppPage title="Updates" subtitle="Checking this server…" />

  const updater = updaterLine(status)
  const action = primaryAction(status)
  const available = status.available
  const live = status.attempt
  const zones = timeZones(browserZone())
  const dirty = JSON.stringify(draft) !== JSON.stringify(status.policy)
  const setWindow = (patch) => setDraft({ ...draft, window: { ...draft.window, ...patch } })

  return (
    <AppPage title="Updates" subtitle="New versions of Slatebox come from GitHub, signed by Slatebox. Choose when this server applies them.">
      <Box component="nav" aria-label="Admin sections" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }} data-admin-sections="">
        {[...ADMIN_SECTIONS, ...SELF_HOST_SECTIONS].map((section) => (
          <Button key={section.id} component={RouterLink} to={section.to} size="small" disableElevation
            variant={section.id === 'updates' ? 'contained' : 'outlined'} aria-current={section.id === 'updates' ? 'page' : undefined}>
            {section.id === 'overview' ? 'Overview' : section.title}
          </Button>
        ))}
      </Box>

      <Box sx={{ display: 'grid', gap: 3 }} data-testid="admin-updates">
        {status.decision?.notice && <Alert severity="error">{status.decision.notice}</Alert>}

        <AccountSection title="This server" data-testid="updates-current">
          <Row label="Version"><Typography sx={{ fontWeight: 700 }} data-updates-version="">{status.current.version || 'Unknown (a local build)'}</Typography></Row>
          {status.current.revision && <Row label="Build"><Typography sx={{ fontFamily: MONO }}>{status.current.revision}</Typography></Row>}
          <Row label="Channel"><Typography>{status.policy.channel === 'preview' ? 'Preview (early releases)' : 'Stable'}</Typography></Row>
          <Row label="Host updater">
            <Chip size="small" color={updater.tone} variant={updater.tone === 'success' ? 'filled' : 'outlined'} label={updater.tone === 'success' ? 'Connected' : updater.tone === 'default' ? 'Off' : 'Needs attention'} sx={{ mr: 1 }} />
            <Typography component="span" data-updates-updater="">{updater.text}</Typography>
          </Row>
          <Row label="Last checked">
            <Typography component="span">{status.feed.checkedAt ? `${ago(status.feed.checkedAt)}${status.feed.ok ? '' : ' (it did not work)'}` : 'Not yet'}</Typography>
            {status.mode !== 'off' && <Button size="small" sx={{ ml: 1 }} disabled={busy} onClick={() => call(M.checkNow, [], (a) => (a?.ok ? (a.available ? `The newest release is ${a.available}.` : 'Checked: no release yet.') : `The check failed: ${a?.error}`))}>Check now</Button>}
          </Row>
          {status.feed.lastError && !status.feed.ok && <Alert severity="warning" sx={{ mt: 1 }}>{status.feed.lastError.message}</Alert>}
          {status.feed.expired && <Alert severity="warning" sx={{ mt: 1 }}>Slatebox can't confirm the newest version right now, so nothing is applied automatically until it can.</Alert>}
        </AccountSection>

        {live && (
          <AccountSection title={live.kind === 'rollback' ? 'Rolling back' : `Updating to ${live.target}`} data-testid="updates-live">
            <Stepper activeStep={Math.max(0, stepIndex(live.phase))} alternativeLabel>
              {STEPS.map((step) => <Step key={step.phase}><StepLabel>{step.label}</StepLabel></Step>)}
            </Stepper>
            <FinePrint sx={{ mt: 2 }}>{live.phase === 'queued' ? 'Waiting for the host updater (it checks every five minutes).' : `${STEPS[stepIndex(live.phase)]?.label || live.phase}. If the new version is not healthy, the previous one and its data are put back by themselves.`}</FinePrint>
          </AccountSection>
        )}

        <AccountSection title={available ? `Slatebox ${available.version} is available` : 'Available'} data-testid="updates-available">
          {!available && <Typography data-updates-state="up-to-date">{status.decision?.words || 'Slatebox is up to date.'}</Typography>}
          {available && (
            <>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
                <Chip size="small" icon={<VerifiedUser />} color="success" variant="outlined" label="Signature verified" data-updates-signed="" />
                <Typography color="text.secondary">Released {shortDate(available.releasedAt)}</Typography>
                {available.major && <Chip size="small" color="warning" label="Major release" />}
                {available.preview && <Chip size="small" label="Preview" />}
              </Box>
              <Box sx={{ borderLeft: 3, borderColor: 'divider', pl: 2, mb: 1.5 }}>
                {noteLines(available.notes).map((line, i) => (line.kind === 'heading'
                  ? <Typography key={i} sx={{ fontWeight: 700, mt: i ? 1 : 0 }}>{line.text}</Typography>
                  : <Typography key={i} sx={{ pl: line.kind === 'item' ? 2 : 0, '&::before': line.kind === 'item' ? { content: '"•"', ml: -2, mr: 1 } : {} }}>{line.text}</Typography>))}
                {available.notesUrl && <Link href={available.notesUrl} target="_blank" rel="noreferrer">The full release notes on GitHub</Link>}
              </Box>
              {available.migrations?.length > 0 && (
                <Alert severity="info" sx={{ mb: 1.5 }}>
                  This release changes stored data: {available.migrations.map((m) => m.summary).join('; ')}. A backup is taken first, and a failed update puts it back.
                </Alert>
              )}
              {available.major && !available.approved && (
                <Alert severity="warning" sx={{ mb: 1.5 }}>A major release can change how Slatebox works. Read the notes, then approve {available.version} before it is applied.</Alert>
              )}
              <Typography sx={{ mb: 1.5 }} data-updates-decision="">{status.decision?.words}</Typography>
              {action && (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Button variant="contained" disabled={busy} data-updates-action={action.kind}
                    onClick={() => (action.kind === 'approve'
                      ? call(M.approve, [available.version], `${available.version} is approved.`)
                      : action.kind === 'retry'
                        ? call(M.retry, [available.version], 'Asked for. The host updater starts it within five minutes.')
                        : action.kind === 'cancel'
                          ? call(M.cancel, [], 'The update request was cancelled.')
                          : call(M.applyNow, [available.version], (a) => (a?.updaterReady ? 'Asked for. The host updater starts it within five minutes.' : 'Asked for. Set up the host updater on the server to run it: npx slatebox updates enable')))}>
                    {action.label}
                  </Button>
                  {(action.kind === 'apply' || action.kind === 'retry') && <Typography color="text.secondary">Starts within 5 minutes; Slatebox is unavailable for 1–3 minutes while it restarts.</Typography>}
                  {action.kind === 'cancel' && <Typography color="text.secondary">Waiting for the host updater to start it.</Typography>}
                </Box>
              )}
              {available.upgradeCommand && <FinePrint sx={{ mt: 1.5 }}>On Kubernetes, update with: <Box component="code" sx={{ fontFamily: MONO, wordBreak: 'break-all' }}>{available.upgradeCommand}</Box></FinePrint>}
            </>
          )}
        </AccountSection>

        <AccountSection title="Automatic updates" data-testid="updates-policy">
          <FormControlLabel control={<Switch checked={draft.auto} onChange={(e) => setDraft({ ...draft, auto: e.target.checked })} inputProps={{ 'aria-label': 'Apply updates automatically' }} />}
            label={draft.auto ? 'On: minor and patch releases are applied in the window below' : 'Off: you are told about each release and choose when to update'} />
          <Box sx={{ display: 'grid', gap: 2, mt: 2, opacity: draft.auto ? 1 : 0.6 }}>
            <Box>
              <Typography sx={{ fontWeight: 600, mb: 0.75 }} id="updates-days">Days</Typography>
              <ToggleButtonGroup size="small" color="primary" value={draft.window.days} aria-labelledby="updates-days"
                onChange={(_, days) => days.length && setWindow({ days })}>
                {DAYS.map((day) => <ToggleButton key={day.value} value={day.value} aria-label={day.label}>{day.short}</ToggleButton>)}
              </ToggleButtonGroup>
            </Box>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <TextField label="Starts at" type="time" size="small" value={draft.window.start} onChange={(e) => setWindow({ start: e.target.value })} sx={{ width: 150 }} slotProps={{ inputLabel: { shrink: true } }} />
              <TextField select label="For" size="small" value={draft.window.hours} onChange={(e) => setWindow({ hours: Number(e.target.value) })} sx={{ width: 130 }}>
                {LENGTH_CHOICES.map((h) => <MenuItem key={h} value={h}>{h} hour{h === 1 ? '' : 's'}</MenuItem>)}
              </TextField>
              <Autocomplete size="small" options={zones} value={draft.timeZone} disableClearable onChange={(_, zone) => setDraft({ ...draft, timeZone: zone })} sx={{ width: 280 }}
                renderInput={(params) => <TextField {...params} label="Time zone" />} />
            </Box>
            <Typography color="text.secondary">{windowWords(draft)}. Backups run at 03:00 by default, so the window starts after the night's backup.</Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              <TextField select label="Wait after a release" size="small" value={draft.holdBackDays} onChange={(e) => setDraft({ ...draft, holdBackDays: Number(e.target.value) })} sx={{ width: 210 }}>
                {HOLD_BACK_CHOICES.map((d) => <MenuItem key={d} value={d}>{d === 0 ? 'No wait' : `${d} day${d === 1 ? '' : 's'}`}</MenuItem>)}
              </TextField>
              <Typography color="text.secondary" sx={{ maxWidth: 460 }}>A short wait gives Slatebox time to withdraw a release before it reaches this server.</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontWeight: 600 }} id="updates-channel">Channel</Typography>
              <RadioGroup row aria-labelledby="updates-channel" value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value })}>
                <FormControlLabel value="stable" control={<Radio />} label="Stable" />
                <FormControlLabel value="preview" control={<Radio />} label="Preview (early releases, for a test server)" />
              </RadioGroup>
            </Box>
            <FormControlLabel control={<Switch checked={draft.includeMajor} onChange={(e) => setDraft({ ...draft, includeMajor: e.target.checked })} />}
              label="Include major releases in the window (each one still needs your approval first)" />
          </Box>
          <Typography sx={{ fontWeight: 600, mt: 2.5 }}>Tell server admins</Typography>
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <FormControlLabel control={<Switch checked={draft.notify?.bell !== false} onChange={(e) => setDraft({ ...draft, notify: { ...draft.notify, bell: e.target.checked } })} />} label="In the notifications bell" />
            <FormControlLabel control={<Switch checked={draft.notify?.email !== false} onChange={(e) => setDraft({ ...draft, notify: { ...draft.notify, email: e.target.checked } })} />} label="By email (when mail is set up)" />
          </Box>
          <FinePrint>Security alerts (an update that did not verify) always go to the bell.</FinePrint>
          <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
            <Button variant="contained" disabled={!dirty || busy} onClick={() => call(M.setPolicy, [draft], 'Saved.')} data-updates-save="">Save</Button>
            <Button disabled={!dirty || busy} onClick={() => setDraft(status.policy)}>Undo changes</Button>
          </Box>
        </AccountSection>

        {status.rollback && (
          <AccountSection title="Roll back" data-testid="updates-rollback">
            <Typography sx={{ mb: 1.5 }}>Go back to {status.rollback.to} (this server runs {status.rollback.from} now).{status.rollback.keepsData ? ' Your data is kept.' : ` The backup taken before the update is restored, so changes since ${dateTime(status.rollback.backupAt, status.policy.timeZone) || 'then'} are lost.`}</Typography>
            <Button variant="outlined" color="warning" sx={{ alignSelf: "flex-start" }} disabled={busy || Boolean(live)} onClick={() => { setTyped(''); setRollbackOpen(true) }}>Roll back to {status.rollback.to}</Button>
          </AccountSection>
        )}

        <AccountSection title="History" data-testid="updates-history">
          {attemptRows(status).length === 0 && eventRows(status).length === 0 && <Typography color="text.secondary">Nothing yet.</Typography>}
          {attemptRows(status).length > 0 && (
            <Table size="small" aria-label="Update attempts">
              <TableHead><TableRow><TableCell>When</TableCell><TableCell>Change</TableCell><TableCell>Outcome</TableCell><TableCell>Why</TableCell></TableRow></TableHead>
              <TableBody>
                {attemptRows(status).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{dateTime(row.at, status.policy.timeZone)}</TableCell>
                    <TableCell>{row.change}</TableCell>
                    <TableCell><Chip size="small" color={row.outcome.tone} label={row.outcome.label} /></TableCell>
                    <TableCell sx={{ color: 'text.secondary', maxWidth: 360 }}>{row.detail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {eventRows(status).length > 0 && (
            <Box component="ul" sx={{ m: 0, mt: 2, pl: 2.5, color: 'text.secondary' }}>
              {eventRows(status).map((row, i) => <li key={i}><Typography component="span" color={row.tone === 'error' ? 'error' : 'text.secondary'}>{dateTime(row.at, status.policy.timeZone)}: {row.text}</Typography></li>)}
            </Box>
          )}
        </AccountSection>

        <FinePrint>
          Every update is a release signed by Slatebox and pulled by its digest; the host updater checks the signature itself, backs up first, and puts the previous version back if the new one is not healthy.
          To stop all update checks (an air-gapped server), set SLATEBOX_UPDATES=off.
        </FinePrint>
      </Box>

      <Dialog open={rollbackOpen} onClose={() => setRollbackOpen(false)} aria-labelledby="rollback-title">
        <DialogTitle id="rollback-title">Roll back to {status.rollback?.to}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {status.rollback?.keepsData
              ? `Slatebox restarts on ${status.rollback?.to} within five minutes and keeps your data.`
              : `Slatebox restarts on ${status.rollback?.to} and restores the backup taken before the update. Changes since then are lost. Type "roll back" to confirm.`}
          </DialogContentText>
          {!status.rollback?.keepsData && <TextField autoFocus fullWidth sx={{ mt: 2 }} label='Type "roll back"' value={typed} onChange={(e) => setTyped(e.target.value)} />}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRollbackOpen(false)}>Cancel</Button>
          <Button color="warning" variant="contained" disabled={busy || (!status.rollback?.keepsData && typed.trim().toLowerCase() !== 'roll back')}
            onClick={async () => { if (await call(M.rollback, [{ confirm: typed }], 'Asked for. The host updater rolls back within five minutes.')) setRollbackOpen(false) }}>
            Roll back
          </Button>
        </DialogActions>
      </Dialog>
    </AppPage>
  )
}
