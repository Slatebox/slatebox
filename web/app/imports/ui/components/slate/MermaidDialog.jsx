// Mermaid, on every slate: the slate as Mermaid text to copy or download (.mmd, or a Markdown
// code block), and Mermaid pasted or opened from a file drawn as real notes and lines, on this
// slate or a new one. Loaded only when opened (React.lazy in Canvas.jsx): the Mermaid code is
// never in the main bundle, and no Mermaid renderer is ever loaded.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, Dialog, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem,
  Switch, Tab, Tabs, TextField, Typography, useMediaQuery,
} from '@mui/material'
import Close from '@mui/icons-material/Close'
import ContentCopy from '@mui/icons-material/ContentCopy'
import Download from '@mui/icons-material/Download'
import UploadFile from '@mui/icons-material/UploadFile'
import { slateToMermaid, parseMermaid, diagramPlans } from '../../../api/common/mermaid/index.mjs'

const FORMAT_NAMES = { auto: 'Automatic', flowchart: 'Flowchart', mindmap: 'Mind map', gantt: 'Gantt chart' }
const KIND_NAMES = { flowchart: 'flowchart', mindmap: 'mind map', gantt: 'Gantt chart' }
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

const fileName = (name, ext) => `${(name || 'slate').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'slate'}.${ext}`

function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// The slate as stored, from the canvas as it is now; a workshop's lanes and cards come from its model.
function storedSlate(slate, row) {
  const engine = slate?.exportJSON ? slate : null
  const live = engine ? JSON.parse(engine.exportJSON()) : { options: {}, nodes: [] }
  return { ...live, options: { ...(row?.options || {}), ...live.options }, creative: row?.creative }
}

export default function MermaidDialog({ open, onClose, slate, row, canEdit, initialTab = 'export' }) {
  const narrow = useMediaQuery('(max-width:599.98px)')
  const navigate = useNavigate()
  const [tab, setTab] = useState(initialTab)
  const [format, setFormat] = useState('auto')
  const [styles, setStyles] = useState(false)
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const file = useRef(null)

  useEffect(() => {
    if (open) {
      setTab(initialTab)
      setStatus('')
      setFailure('')
    }
  }, [open, initialTab])

  const exported = useMemo(() => {
    if (!open || tab !== 'export') return null
    try {
      return { ok: true, ...slateToMermaid(storedSlate(slate, row), { format, styles }) }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  }, [open, tab, format, styles, slate, row])

  // What the pasted text would draw, read once typing pauses (the reader refuses anything past a
  // slate's limits early, so even a large paste is read in moments).
  const [settled, setSettled] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSettled(source), 250)
    return () => clearTimeout(timer)
  }, [source])
  const reading = useMemo(() => {
    if (!settled.trim()) return null
    try {
      const drawn = diagramPlans(parseMermaid(settled))
      return { ok: true, drawn }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  }, [settled])

  const name = row?.options?.name || slate?.options?.name || 'slate'
  const isPublic = row?.options?.isPublic === true
  const publicUrl = row?.shareId ? `${window.location.origin}/slates/${row.shareId}.mmd` : ''

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus(`${what} copied.`)
    } catch {
      setStatus(`Copying was blocked by the browser. Select the text and copy it instead.`)
    }
  }

  const openFile = async (event) => {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (!chosen) return
    if (chosen.size > 400000) {
      setFailure('That file is too large for a Mermaid import (up to 100,000 characters).')
      return
    }
    setFailure('')
    setSource(await chosen.text())
  }

  const importInto = async (here) => {
    setBusy(true)
    setFailure('')
    try {
      const result = await Meteor.callAsync('slates.importMermaid', {
        mermaid: source,
        ...(here ? { shareId: row.shareId } : {}),
      })
      if (!here) {
        onClose()
        navigate(`/canvas/${result.shareId}`)
        return
      }
      setStatus(result.message)
      setSource('')
      onClose(result)
    } catch (error) {
      setFailure(error.reason || error.message || 'The diagram could not be drawn.')
    } finally {
      setBusy(false)
    }
  }

  const formats = exported?.formats || ['flowchart', 'mindmap']
  return (
    <Dialog open={open} onClose={() => onClose()} fullScreen={narrow} fullWidth maxWidth="md"
      slotProps={{ paper: { 'aria-label': 'Mermaid' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
          Mermaid
          <Typography component="span" variant="body2" sx={{ ml: 1, color: 'text.secondary' }}>free on every slate</Typography>
        </Box>
        <IconButton aria-label="Close" onClick={() => onClose()}><Close /></IconButton>
      </DialogTitle>
      <Tabs value={tab} onChange={(_e, next) => { setTab(next); setStatus(''); setFailure('') }} sx={{ px: 2 }}
        aria-label="Mermaid export or import">
        <Tab value="export" label="Export" id="mermaid-tab-export" aria-controls="mermaid-panel-export" />
        <Tab value="import" label="Import" id="mermaid-tab-import" aria-controls="mermaid-panel-import" />
      </Tabs>
      <DialogContent dividers sx={{ minWidth: 0 }}>
        {tab === 'export' && (
          <Box role="tabpanel" id="mermaid-panel-export" aria-labelledby="mermaid-tab-export" sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
              <TextField select size="small" label="Format" value={format} onChange={(e) => setFormat(e.target.value)} sx={{ minWidth: 180 }}>
                {['auto', ...formats].map((key) => <MenuItem key={key} value={key}>{FORMAT_NAMES[key]}</MenuItem>)}
              </TextField>
              <FormControlLabel control={<Switch checked={styles} onChange={(e) => setStyles(e.target.checked)} />} label="Include colours" />
            </Box>
            {exported && !exported.ok && <Alert severity="info">{exported.message}</Alert>}
            {exported?.ok && (
              <>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {`A ${KIND_NAMES[exported.format]}: ${plural(exported.notes, 'note')}, ${plural(exported.lines, 'line')}${exported.subgraphs ? `, ${plural(exported.subgraphs, 'subgraph')}` : ''}.`}
                </Typography>
                {exported.warnings.map((warning) => <Alert key={warning} severity="warning" sx={{ py: 0 }}>{warning}</Alert>)}
                <Box component="pre" tabIndex={0} aria-label="Mermaid text" data-testid="mermaid-text"
                  sx={{ m: 0, p: 1.5, maxHeight: narrow ? '45vh' : 360, overflow: 'auto', bgcolor: 'action.hover', borderRadius: 1,
                    fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre', minWidth: 0 }}>
                  {exported.mermaid}
                </Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  <Button variant="contained" startIcon={<ContentCopy />} onClick={() => copy(exported.mermaid, 'Mermaid')}>Copy Mermaid</Button>
                  <Button variant="outlined" startIcon={<ContentCopy />} onClick={() => copy(exported.markdown, 'Markdown')}>Copy as Markdown</Button>
                  <Button variant="outlined" startIcon={<Download />} onClick={() => download(exported.mermaid + '\n', fileName(name, 'mmd'), 'text/plain')}>Download .mmd</Button>
                  <Button variant="outlined" startIcon={<Download />} onClick={() => download(exported.markdown, fileName(name, 'md'), 'text/markdown')}>Download .md</Button>
                </Box>
                {isPublic && (
                  <TextField size="small" label="Public Mermaid address" value={publicUrl} fullWidth
                    slotProps={{ input: { readOnly: true, endAdornment: (
                      <IconButton aria-label="Copy public Mermaid address" onClick={() => copy(publicUrl, 'Address')}><ContentCopy /></IconButton>
                    ) } }}
                    helperText="Anyone can read this public slate's Mermaid here, for a README or a doc. It always shows the slate as it is now." />
                )}
              </>
            )}
          </Box>
        )}
        {tab === 'import' && (
          <Box role="tabpanel" id="mermaid-panel-import" aria-labelledby="mermaid-tab-import" sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Paste a flowchart, mind map or Gantt chart, or open a .mmd or Markdown file. It is drawn as notes and lines you can edit.
            </Typography>
            <TextField label="Mermaid to import" multiline minRows={narrow ? 6 : 9} maxRows={16} value={source}
              onChange={(e) => setSource(e.target.value)} placeholder={'flowchart LR\n  idea["An idea"] --> plan["A plan"]'}
              slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontSize: 13 } } }} />
            <Box>
              <input ref={file} type="file" accept=".mmd,.mermaid,.md,.markdown,.txt,text/plain,text/markdown" hidden
                onChange={openFile} aria-label="Mermaid file" data-testid="mermaid-file" />
              <Button variant="text" startIcon={<UploadFile />} onClick={() => file.current?.click()}>Open a file</Button>
            </Box>
            {reading?.ok && (
              <Alert severity="success" role="status">
                {`Ready: a ${KIND_NAMES[reading.drawn.kind]} of ${plural(reading.drawn.notes, 'note')} and ${plural(reading.drawn.lines, 'line')}${reading.drawn.frames ? `, in ${plural(reading.drawn.frames, 'frame')}` : ''}.`}
              </Alert>
            )}
            {reading && !reading.ok && <Alert severity="info">{reading.message}</Alert>}
            {failure && <Alert severity="error">{failure}</Alert>}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {canEdit && (
                <Button variant="contained" disabled={!reading?.ok || busy} onClick={() => importInto(true)}>Add to this slate</Button>
              )}
              <Button variant={canEdit ? 'outlined' : 'contained'} disabled={!reading?.ok || busy} onClick={() => importInto(false)}>Open as a new slate</Button>
            </Box>
          </Box>
        )}
        <Typography role="status" variant="body2" sx={{ mt: 1.5, minHeight: 20 }}>{status}</Typography>
      </DialogContent>
    </Dialog>
  )
}

MermaidDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  // eslint-disable-next-line react/forbid-prop-types
  slate: PropTypes.object,
  // eslint-disable-next-line react/forbid-prop-types
  row: PropTypes.object,
  canEdit: PropTypes.bool,
  initialTab: PropTypes.oneOf(['export', 'import']),
}
