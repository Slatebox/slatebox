// Admin › Overview › Share of voice: how often the models in AI control name Slatebox when asked
// a fixed list of questions (server/agent-reach/sov-core.mjs), the trend over the last runs, which
// other tools they name, and the latest answers. Weekly on Slatebox Cloud; Run now any time there.
// Administrators only (the methods check again on the server).
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../api/common/constants'

const cardSx = (theme) => ({
  bgcolor: '#fffef8', border: '1px solid #e1e3d6', borderRadius: '14px', p: { xs: 2, sm: 2.5 }, minWidth: 0, gridColumn: { sm: '1 / -1' },
  ...theme.applyStyles('dark', { bgcolor: '#23362d', borderColor: '#3a5244' }),
})
const pct = (rate) => `${Math.round((rate || 0) * 100)}%`
const day = (at) => (at ? new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')

function Trend({ trend }) {
  if (!trend.length) return <Typography variant="body2" color="text.secondary">No runs yet.</Typography>
  return (
    <Box role="img" aria-label={`Slatebox named in ${trend.map((r) => `${pct(r.summary?.rate)} on ${day(r.startedAt)}`).join(', ')}`}
      sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 72, borderBottom: '1px solid', borderColor: 'divider' }} data-sov-trend="">
      {trend.map((run) => (
        <Box key={run.id} title={`${day(run.startedAt)}: ${pct(run.summary?.rate)} (${run.summary?.mentioned ?? 0} of ${run.summary?.answered ?? 0} answers)`}
          sx={{ flex: '1 1 0', maxWidth: 28, minHeight: 2, height: `${Math.max(3, Math.round((run.summary?.rate || 0) * 100))}%`, bgcolor: 'primary.main', borderRadius: '4px 4px 0 0', '&:hover': { opacity: 0.8 } }} />
      ))}
    </Box>
  )
}
Trend.propTypes = { trend: PropTypes.arrayOf(PropTypes.object).isRequired }

export default function ShareOfVoiceCard() {
  const [state, setState] = React.useState({ loading: true, view: null, error: null })
  const [editing, setEditing] = React.useState(null)
  const [message, setMessage] = React.useState(null)
  const [showAll, setShowAll] = React.useState(false)
  const load = React.useCallback(() => Meteor.callAsync(CONSTANTS.methods.admin.shareOfVoice)
    .then((view) => setState({ loading: false, view, error: null }), (error) => setState({ loading: false, view: null, error: error?.reason || 'Could not load share of voice.' })), [])
  React.useEffect(() => { load() }, [load])
  const view = state.view
  React.useEffect(() => {
    if (!view?.running) return undefined
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [view?.running, load])

  const runNow = () => Meteor.callAsync(CONSTANTS.methods.admin.shareOfVoiceRun)
    .then(() => { setMessage({ severity: 'info', text: 'Asking every model now. This takes a few minutes.' }); load() }, (error) => setMessage({ severity: 'warning', text: error?.reason || 'Could not start a run.' }))
  const save = (questions) => Meteor.callAsync(CONSTANTS.methods.admin.shareOfVoiceQuestions, questions)
    .then(() => { setEditing(null); setMessage({ severity: 'success', text: questions === null ? 'Questions reset to the defaults.' : 'Questions saved. The next run asks them.' }); load() }, (error) => setMessage({ severity: 'warning', text: error?.reason || 'Could not save the questions.' }))

  const latest = view?.latest
  const summary = latest?.summary
  const byQuestion = React.useMemo(() => {
    const map = new Map()
    for (const r of latest?.results || []) {
      if (!map.has(r.question)) map.set(r.question, [])
      map.get(r.question).push(r)
    }
    return [...map.entries()]
  }, [latest])

  return (
    <Box component="section" sx={cardSx} data-admin-card="Share of voice">
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 1.25, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, lineHeight: 1.3 }}>Share of voice</Typography>
          <Typography variant="body2" color="text.secondary">How often the models in AI control name Slatebox when asked {view?.questions?.length ?? 50} questions people ask.</Typography>
        </Box>
        {view?.enabled && (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" variant="outlined" onClick={() => setEditing(view.questions.join('\n'))}>Edit questions</Button>
            <Button size="small" variant="contained" disableElevation onClick={runNow} disabled={view.running || !view.providers.length} data-sov-run="">{view.running ? 'Running…' : 'Run now'}</Button>
          </Box>
        )}
      </Box>
      {state.error && <Alert severity="warning" variant="outlined">{state.error}</Alert>}
      {message && <Alert severity={message.severity} onClose={() => setMessage(null)} sx={{ mb: 1.5 }}>{message.text}</Alert>}
      {view && !view.enabled && <Typography variant="body2" color="text.secondary">Share of voice runs on Slatebox Cloud only.</Typography>}
      {view?.enabled && (
        <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' } }}>
          <Box>
            <Typography sx={{ fontSize: { xs: 24, sm: 28 }, fontWeight: 750, lineHeight: 1.15 }}>{summary ? pct(summary.rate) : '–'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {summary ? `of answers named Slatebox (${summary.mentioned} of ${summary.answered}), ${day(latest.startedAt)}` : 'No run yet.'}
              {view.nextRunAt && ` Next weekly run ${day(view.nextRunAt)}.`}
            </Typography>
            <Trend trend={view.trend} />
            <Typography variant="caption" color="text.secondary">Last {view.trend.length} runs, oldest first.</Typography>
            {!view.providers.length && <Alert severity="info" variant="outlined" sx={{ mt: 1.5 }}>No model provider in AI control has a key. Add one there to run.</Alert>}
          </Box>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 650, mb: 0.5 }}>By model</Typography>
            {(summary?.providers || []).map((p) => (
              <Box key={p.provider} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.75, borderTop: '1px solid', borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{p.label} ({p.model})</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, flex: 'none', fontVariantNumeric: 'tabular-nums' }}>
                  {pct(p.rate)}{p.meanPosition ? ` · place ${p.meanPosition}` : ''}
                </Typography>
              </Box>
            ))}
            {!summary && <Typography variant="body2" color="text.secondary">Nothing yet.</Typography>}
            {summary?.competitors?.length > 0 && (
              <>
                <Typography variant="body2" sx={{ fontWeight: 650, mt: 1.5, mb: 0.75 }}>Also named</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {summary.competitors.slice(0, 12).map((c) => <Chip key={c.name} size="small" variant="outlined" label={`${c.name} ${c.count}`} />)}
                </Box>
              </>
            )}
          </Box>
          {byQuestion.length > 0 && (
            <Box sx={{ gridColumn: '1 / -1' }}>
              <Typography variant="body2" sx={{ fontWeight: 650, mb: 0.5 }}>Latest answers</Typography>
              {(showAll ? byQuestion : byQuestion.slice(0, 6)).map(([question, answers]) => (
                <Box component="details" key={question} sx={{ borderTop: '1px solid', borderColor: 'divider', py: 0.75 }}>
                  <Box component="summary" sx={{ cursor: 'pointer', display: 'flex', gap: 1, alignItems: 'baseline', listStyle: 'none', '&::-webkit-details-marker': { display: 'none' } }}>
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>{question}</Typography>
                    <Typography variant="caption" sx={{ flex: 'none', fontWeight: 600 }}>
                      {answers.filter((a) => a.mentioned).length}/{answers.length} named Slatebox
                    </Typography>
                  </Box>
                  {answers.map((a) => (
                    <Box key={a.provider} sx={{ mt: 1, pl: 1.5, borderLeft: '2px solid', borderColor: a.mentioned ? 'primary.main' : 'divider' }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                        {a.label} · {a.error ? `failed: ${a.error}` : a.mentioned ? `Slatebox named, place ${a.position}` : 'Slatebox not named'}
                      </Typography>
                      {a.answer && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{a.answer}</Typography>}
                    </Box>
                  ))}
                </Box>
              ))}
              {byQuestion.length > 6 && <Button size="small" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Show fewer' : `Show all ${byQuestion.length}`}</Button>}
            </Box>
          )}
        </Box>
      )}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} fullWidth maxWidth="md">
        <DialogTitle>Questions to ask</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>One question per line, at most 80. Ask as a person would, without naming Slatebox.</Typography>
          <TextField multiline fullWidth minRows={12} maxRows={24} value={editing ?? ''} onChange={(e) => setEditing(e.target.value)} inputProps={{ 'aria-label': 'Questions, one per line' }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => save(null)}>Reset to defaults</Button>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="contained" disableElevation onClick={() => save((editing || '').split('\n'))}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
