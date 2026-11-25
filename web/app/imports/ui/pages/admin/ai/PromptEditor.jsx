import React, { useEffect, useRef, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { ReasonDialog } from './ReasonDialog'
import PromptDiff from './PromptDiff'
import PromptTest from './PromptTest'
import { KIND_LABELS, liveText, sourceText, statusText, undeclaredNames } from './prompts-view.mjs'

// Admin › AI control › Prompts › one prompt: edit its text as a draft (nothing live changes), see the
// lint as you type, compare it with what is live or any version (the built-in text is version 0),
// test-run it with a sample through a binding, then publish a saved version: its checks (the lint,
// then the part's eval cases on its binding's model) run first, and a failed case blocks unless you
// publish anyway with a reason. Any earlier version, or the built-in text, can be served again.
// Only a person publishes or rolls back (ai.prompts.publish / rollback).
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8rem', lineHeight: 1.5 }
const failure = (err, fallback) => err?.reason || err?.message || fallback
const wrapOf = (variables) => Object.fromEntries(Object.entries(variables || {}).filter(([, d]) => d.wrap === 'data').map(([n]) => [n, 'data']))
const when = (at) => (at ? new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

// A text area with line numbers beside it (prompts are long; the lint and the diff name lines).
function BodyEditor({ value, onChange, undeclared }) {
  const gutter = useRef(null)
  const lines = Math.max(1, value.split('\n').length)
  return (
    <Box>
      <Box sx={{ display: 'flex', border: 1, borderColor: undeclared.length ? 'error.main' : 'divider', borderRadius: 1, overflow: 'hidden' }}>
        <Box ref={gutter} aria-hidden sx={{ ...mono, color: 'text.disabled', bgcolor: 'action.hover', textAlign: 'right', px: 1, py: 1, userSelect: 'none', overflow: 'hidden', maxHeight: 360 }}>
          {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
        </Box>
        <Box
          component="textarea"
          aria-label="Prompt text"
          data-testid="prompt-body"
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.target.scrollTop }}
          sx={{ ...mono, flex: 1, border: 0, outline: 0, resize: 'vertical', p: 1, minHeight: 240, maxHeight: 360, bgcolor: 'background.paper', color: 'text.primary', whiteSpace: 'pre-wrap' }}
        />
      </Box>
      {undeclared.length > 0 && (
        <Typography variant="caption" color="error" sx={{ textDecoration: 'underline wavy' }}>
          {undeclared.map((n) => `{{${n}}}`).join(', ')}: not a value this part of Slatebox gives
        </Typography>
      )}
    </Box>
  )
}

function Variables({ code, body, wrap, onWrap }) {
  const names = Object.keys(code)
  if (!names.length) return <Typography variant="body2" color="text.secondary">This prompt takes no values.</Typography>
  return (
    <Table size="small" aria-label="Values this prompt is given">
      <TableHead>
        <TableRow><TableCell>Value</TableCell><TableCell>Type</TableCell><TableCell>Required</TableCell><TableCell>From</TableCell><TableCell>Used</TableCell><TableCell>Put in as</TableCell></TableRow>
      </TableHead>
      <TableBody>
        {names.map((name) => {
          const decl = code[name]
          const used = new RegExp(`\\{\\{\\s*[#^]?\\s*${name}\\s*\\}\\}`).test(body)
          return (
            <TableRow key={name}>
              <TableCell sx={mono}>{`{{${name}}}`}</TableCell>
              <TableCell>{decl.type}</TableCell>
              <TableCell>{decl.required ? 'Yes' : 'No'}</TableCell>
              <TableCell>{decl.source === 'server' ? 'Slatebox' : decl.source === 'user' ? 'A person' : decl.source === 'slate' ? 'The slate' : 'Outside'}{decl.untrusted ? ' (untrusted)' : ''}</TableCell>
              <TableCell>{used ? 'Yes' : 'No'}</TableCell>
              <TableCell>
                {decl.untrusted ? (
                  <TextField select size="small" variant="standard" value={wrap[name] || decl.wrap || 'none'} onChange={(e) => onWrap(name, e.target.value)} inputProps={{ 'aria-label': `How ${name} is put in` }}>
                    <MenuItem value="none">As it is</MenuItem>
                    <MenuItem value="data">As data</MenuItem>
                  </TextField>
                ) : 'As it is'}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function Lint({ lint, error }) {
  if (!lint && !error) return null
  return (
    <Box data-testid="prompt-lint">
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {lint?.blocking?.length > 0 && <Alert severity="error" sx={{ mb: 1 }}>{lint.blocking.map((t) => <div key={t}>{t}</div>)}</Alert>}
      {lint?.warnings?.length > 0 && <Alert severity="info" sx={{ mb: 1 }}>{lint.warnings.map((t) => <div key={t}>{t}</div>)}</Alert>}
      {lint && !lint.blocking?.length && !error && <Typography variant="caption" color="success.main">No lint problems.</Typography>}
    </Box>
  )
}

function EvalResults({ evalRun }) {
  if (!evalRun?.cases) return null
  return (
    <Box mt={1} data-testid="prompt-eval">
      <Typography variant="subtitle2">Checks: {evalRun.passed} passed, {evalRun.failed} failed{evalRun.skipped ? `, ${evalRun.skipped} samples do not use this prompt` : ''}</Typography>
      {evalRun.cases.map((c, i) => (
        <Typography key={i} variant="body2" color={c.passed ? 'success.main' : 'error'}>
          {c.passed ? '✓' : '✗'} {c.name}{c.error ? `: ${c.error}` : ''}{c.checks?.filter((x) => !x.ok).map((x) => ` · ${x.check}${x.problem ? ` (${x.problem})` : ''}`).join('') || ''}
        </Typography>
      ))}
    </Box>
  )
}

// Publish a draft, or serve a version that was live before again (rollback): both run the lint and
// the part's checks first, and a failed check blocks unless you go ahead anyway with a reason.
function PublishDialog({ prompt, row, rollback = false, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [evalRun, setEvalRun] = useState(null)
  const [anyway, setAnyway] = useState(false)
  const suggestion = row.origin === 'ai-proposal' || Boolean(row.basedOn?.suggestion)
  const go = async () => {
    setBusy(true)
    setError('')
    try {
      const out = rollback
        ? await Meteor.callAsync('ai.prompts.rollback', { id: prompt.id, toVersion: row.version, reason: reason.trim(), ...(anyway && { override: true }) })
        : await Meteor.callAsync('ai.prompts.publish', { id: prompt.id, version: row.version, reason: reason.trim(), ...(anyway && { override: true }) })
      onDone(liveText(out, prompt.title))
    } catch (err) {
      setError(failure(err, 'It was not published.'))
      setEvalRun(err?.details?.evalRun || null)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth aria-labelledby="prompt-publish-title">
      <DialogTitle id="prompt-publish-title">{rollback ? `Serve version ${row.version} of ${prompt.title} again` : `Publish version ${row.version} of ${prompt.title}`}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" mb={1}>What changes against the text served now ({sourceText(prompt.live).toLowerCase()}):</Typography>
        <PromptDiff before={prompt.live.body} after={row.body} beforeLabel={`Now: ${sourceText(prompt.live)}`} afterLabel={`Version ${row.version}`} suggestion={suggestion} />
        <Typography variant="body2" mt={2}>{rollback ? 'Serving it again' : 'Publishing'} first runs the lint, then {prompt.evalCases.length} checks with this part's samples on its binding's model (charged to you).</Typography>
        <TextField label="Why (kept in the change history)" value={reason} onChange={(e) => setReason(e.target.value)} fullWidth multiline minRows={2} inputProps={{ maxLength: 500 }} sx={{ mt: 2 }} />
        {error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}
        <EvalResults evalRun={evalRun} />
        {evalRun?.failed > 0 && (
          <FormControlLabel sx={{ mt: 1 }} control={<Checkbox checked={anyway} onChange={(e) => setAnyway(e.target.checked)} />} label={`${rollback ? 'Serve it anyway' : 'Publish anyway'} (the change history records that the checks failed, and why)`} />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy || !reason.trim()} onClick={go}>{busy ? 'Running checks…' : rollback ? (anyway ? 'Serve it anyway' : 'Run checks and serve it again') : anyway ? 'Publish anyway' : 'Run checks and publish'}</Button>
      </DialogActions>
    </Dialog>
  )
}

export default function PromptEditor({ id, titles, onClose, onChanged }) {
  const [prompt, setPrompt] = useState(null)
  const [error, setError] = useState('')
  const [body, setBody] = useState('')
  const [wrap, setWrap] = useState({})
  const [basedOn, setBasedOn] = useState(null)
  const [note, setNote] = useState('')
  const [lint, setLint] = useState(null)
  const [renderError, setRenderError] = useState('')
  const [tab, setTab] = useState('edit')
  const [compareTo, setCompareTo] = useState('live')
  const [saved, setSaved] = useState('')
  const [publishing, setPublishing] = useState(null)
  const [rolling, setRolling] = useState(null)
  const [serving, setServing] = useState(null)

  const load = async (keepText = false) => {
    try {
      const got = await Meteor.callAsync('ai.prompts.get', { id })
      setPrompt(got)
      if (!keepText) {
        setBody(got.live.body)
        setWrap(wrapOf(got.live.variables))
        setBasedOn(got.live.version)
      }
      setError('')
    } catch (err) {
      setError(failure(err, 'The prompt could not be read.'))
    }
  }
  useEffect(() => { load() }, [id])

  // the lint as you type (no model call)
  useEffect(() => {
    if (!prompt) return undefined
    const timer = setTimeout(async () => {
      try {
        const out = await Meteor.callAsync('ai.prompts.render', { id, body: body || ' ', ...(Object.keys(wrap).length && { wrap }) })
        setLint(out.lint)
        setRenderError(out.error || '')
      } catch (err) {
        setRenderError(failure(err, ''))
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [body, wrap, prompt?.id])

  if (error) return <Dialog open onClose={onClose}><DialogContent><Alert severity="warning">{error}</Alert></DialogContent></Dialog>
  if (!prompt) return null
  const undeclared = undeclaredNames(body, prompt.code.variables)
  const changed = body !== prompt.live.body
  const versionText = (v) => (v === 0 ? 'Built-in text (version 0)' : `Version ${v}`)
  const compareRow = compareTo === 'live' ? { body: prompt.live.body, label: `Now: ${sourceText(prompt.live)}` }
    : compareTo === '0' ? { body: prompt.code.body, label: versionText(0) }
      : (() => { const row = prompt.versions.find((v) => String(v.version) === compareTo); return { body: row?.body ?? '', label: versionText(row?.version) } })()

  const save = async () => {
    try {
      const out = await Meteor.callAsync('ai.prompts.saveDraft', { id, body, ...(Object.keys(wrap).length && { wrap }), ...(note.trim() && { note: note.trim() }), ...(Number.isInteger(basedOn) && { basedOn }) })
      setSaved(`Version ${out.version} saved as a draft. Nothing live changed.${out.lint.blocking.length ? ' Fix the lint problems before publishing it.' : ''}`)
      setNote('')
      await load(true)
    } catch (err) {
      setSaved('')
      setRenderError(failure(err, 'The draft was not saved.'))
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth aria-labelledby="prompt-editor-title" data-testid="prompt-editor">
      <DialogTitle id="prompt-editor-title">
        {prompt.title}
        <Typography component="div" variant="body2" color="text.secondary">
          {prompt.surfaceTitle} · {KIND_LABELS[prompt.kind] || prompt.kind} · <Box component="span" sx={mono}>{prompt.id}</Box> · Served now: {sourceText(prompt.live)}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {prompt.live.problem && <Alert severity="error" sx={{ mb: 2 }}>{prompt.live.problem}</Alert>}
        {saved && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSaved('')}>{saved}</Alert>}
        <Tabs value={tab} onChange={(_e, next) => setTab(next)} sx={{ mb: 2 }} aria-label="Prompt sections">
          <Tab value="edit" label="Edit" />
          <Tab value="compare" label="Compare" />
          <Tab value="test" label="Test run" />
          <Tab value="versions" label={`Versions (${prompt.versions.length + 1})`} />
        </Tabs>
        {tab === 'edit' && (
          <Stack spacing={2}>
            <BodyEditor value={body} onChange={setBody} undeclared={undeclared} />
            <Lint lint={lint} error={renderError} />
            <Box>
              <Typography variant="subtitle2" mb={0.5}>Values this prompt is given</Typography>
              <Box sx={{ overflowX: 'auto' }}>
                <Variables code={prompt.code.variables} body={body} wrap={wrap} onWrap={(name, value) => setWrap((w) => ({ ...w, [name]: value }))} />
              </Box>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField size="small" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} inputProps={{ maxLength: 200 }} sx={{ flex: 1 }} />
              <Button onClick={() => { setBody(prompt.live.body); setWrap(wrapOf(prompt.live.variables)); setBasedOn(prompt.live.version) }} disabled={!changed}>Undo my changes</Button>
              <Button variant="contained" onClick={save} disabled={!body.trim()}>Save draft</Button>
            </Stack>
          </Stack>
        )}
        {tab === 'compare' && (
          <Box>
            <TextField select size="small" label="Compare the editor's text with" value={compareTo} onChange={(e) => setCompareTo(e.target.value)} sx={{ minWidth: 300, mb: 2 }}>
              <MenuItem value="live">What is served now</MenuItem>
              <MenuItem value="0">The built-in text (version 0)</MenuItem>
              {prompt.versions.map((v) => <MenuItem key={v.version} value={String(v.version)}>Version {v.version} ({statusText(v, prompt.labels).toLowerCase()})</MenuItem>)}
            </TextField>
            <PromptDiff before={compareRow.body} after={body} beforeLabel={compareRow.label} afterLabel="The editor" />
          </Box>
        )}
        {tab === 'test' && <PromptTest prompt={prompt} body={body} wrap={wrap} titles={titles} />}
        {tab === 'versions' && (
          <Table size="small" aria-label="Versions">
            <TableHead>
              <TableRow><TableCell>Version</TableCell><TableCell>Status</TableCell><TableCell>By</TableCell><TableCell>Checks</TableCell><TableCell /></TableRow>
            </TableHead>
            <TableBody>
              {prompt.versions.map((v) => {
                const live = v.version === prompt.labels.published
                return (
                  <TableRow key={v.version} data-testid={`prompt-version-${v.version}`}>
                    <TableCell>
                      Version {v.version}
                      {v.note && <Typography variant="caption" display="block" color="text.secondary">{v.note}</Typography>}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={statusText(v, prompt.labels)} color={live ? 'primary' : v.origin === 'ai-proposal' && v.status === 'draft' ? 'warning' : 'default'} variant={live ? 'filled' : 'outlined'} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{v.origin === 'ai-proposal' ? 'Suggested by an agent' : 'An administrator'}</Typography>
                      <Typography variant="caption" color="text.secondary">{when(v.createdAt)}</Typography>
                    </TableCell>
                    <TableCell>{v.evalRun ? `${v.evalRun.passed} passed, ${v.evalRun.failed} failed${v.evalRun.overridden ? ' (published anyway)' : ''}` : '—'}</TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => { setBody(v.body); setWrap(wrapOf(v.variables)); setBasedOn(v.version); setTab('edit') }}>Edit from this</Button>
                      {v.status === 'draft' && <Button size="small" variant="outlined" onClick={() => setPublishing(v)}>Publish…</Button>}
                      {!live && v.status !== 'draft' && <Button size="small" onClick={() => setServing(v)}>Serve this again…</Button>}
                    </TableCell>
                  </TableRow>
                )
              })}
              <TableRow data-testid="prompt-version-0">
                <TableCell>Version 0</TableCell>
                <TableCell><Chip size="small" label={prompt.labels.published ? 'Built in' : 'Live (built in)'} color={prompt.labels.published ? 'default' : 'primary'} variant={prompt.labels.published ? 'outlined' : 'filled'} /></TableCell>
                <TableCell><Typography variant="body2">Slatebox</Typography></TableCell>
                <TableCell>—</TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => { setBody(prompt.code.body); setWrap({}); setBasedOn(0); setTab('edit') }}>Edit from this</Button>
                  {prompt.labels.published && <Button size="small" color="error" onClick={() => setRolling(0)}>Return to the built-in text…</Button>}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
      {publishing && (
        <PublishDialog
          prompt={prompt}
          row={publishing}
          onClose={() => setPublishing(null)}
          onDone={async (text) => { setPublishing(null); setSaved(text); await load(); onChanged?.() }}
        />
      )}
      {serving && (
        <PublishDialog
          prompt={prompt}
          row={serving}
          rollback
          onClose={() => setServing(null)}
          onDone={async (text) => { setServing(null); setSaved(text); await load(); onChanged?.() }}
        />
      )}
      <ReasonDialog
        open={rolling !== null}
        title={`Return ${prompt.title} to the built-in text`}
        action="Return to the built-in text"
        body={<Typography variant="body2">Every server uses the text Slatebox ships with within seconds. Saved versions stay.</Typography>}
        onClose={() => setRolling(null)}
        onConfirm={async (reason) => {
          const out = await Meteor.callAsync('ai.prompts.rollback', { id, toVersion: 0, reason })
          setRolling(null)
          setSaved(liveText(out, prompt.title))
          await load()
          onChanged?.()
        }}
      />
    </Dialog>
  )
}
