import React, { useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

// Admin › AI control › Prompts › test run: the text in the editor sent with a built-in sample
// through a part of Slatebox's binding. Shows what was sent, the raw answer, whether that part could
// use it, the model, latency and cost. The answer is never applied.
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220, overflow: 'auto', bgcolor: 'action.hover', p: 1, borderRadius: 1 }
const failure = (err, fallback) => err?.reason || err?.message || fallback
const contentText = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => part?.text ?? '').join('') : JSON.stringify(content))

export default function PromptTest({ prompt, body, wrap, titles }) {
  const [sample, setSample] = useState(prompt.samples[0]?.id || '')
  const [surface, setSurface] = useState(prompt.surface)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [run, setRun] = useState(null)
  if (!prompt.samples.length) return <Typography variant="body2" color="text.secondary">There are no samples for this part of Slatebox yet.</Typography>
  const go = async () => {
    setBusy(true)
    setError('')
    setRun(null)
    try {
      setRun(await Meteor.callAsync('ai.prompts.test', { id: prompt.id, body, ...(wrap && Object.keys(wrap).length && { wrap }), sample, surface }))
    } catch (err) {
      setError(failure(err, 'The test run did not work.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Box data-testid="prompt-test">
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <TextField select size="small" label="Sample" value={sample} onChange={(e) => setSample(e.target.value)} sx={{ minWidth: 260 }}>
          {prompt.samples.map((s) => <MenuItem key={s.id} value={s.id}>{s.title}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Model from the binding of" value={surface} onChange={(e) => setSurface(e.target.value)} sx={{ minWidth: 260 }}>
          {prompt.testSurfaces.map((id) => <MenuItem key={id} value={id}>{titles[id] || id}</MenuItem>)}
        </TextField>
        <Button variant="outlined" onClick={go} disabled={busy}>{busy ? 'Running…' : 'Run test'}</Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">Sends the text in the editor. Charged to you as an admin test run; the answer is shown, never applied. 30 an hour.</Typography>
      {error && <Alert severity="warning" sx={{ mt: 1 }}>{error}</Alert>}
      {run && (
        <Box mt={1.5}>
          <Alert severity={run.parses.ok ? 'success' : 'error'} sx={{ mb: 1 }} data-testid="prompt-test-verdict">
            {run.parses.ok ? 'The answer is one this part of Slatebox can use.' : `The answer cannot be used: ${run.parses.problem}`}
            {' '}{run.model ? `Model ${run.model}, ` : ''}{run.latencyMs} ms{run.costMicros ? `, about $${(run.costMicros / 1e6).toFixed(4)}` : ''}.
          </Alert>
          <Typography variant="subtitle2">The answer</Typography>
          <Box sx={mono} data-testid="prompt-test-answer">{run.answer.toolCall ? `${run.answer.toolCall.name} ${JSON.stringify(run.answer.toolCall.arguments, null, 2)}` : run.answer.text || '(no text)'}</Box>
          <Typography variant="subtitle2" mt={1}>What was sent</Typography>
          {run.rendered.system && (
            <>
              <Typography variant="caption">Instructions</Typography>
              <Box sx={mono}>{run.rendered.system}</Box>
            </>
          )}
          {run.rendered.prompts.map((p, i) => (
            <React.Fragment key={i}>
              <Typography variant="caption">{p.role === 'user' ? 'Request' : 'Earlier answer'}</Typography>
              <Box sx={mono}>{contentText(p.content)}</Box>
            </React.Fragment>
          ))}
          {run.rendered.tools.map((t) => <Typography key={t.name} variant="caption" display="block">Tool {t.name}: {t.description}</Typography>)}
        </Box>
      )}
    </Box>
  )
}
