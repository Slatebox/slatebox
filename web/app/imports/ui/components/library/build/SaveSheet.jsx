import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Box, Button, Chip, Link, TextField, Typography } from '@mui/material'
import LockIcon from '@mui/icons-material/LockOutlined'
import { CATEGORY_LABELS, CREDIT_HELP, CREDIT_QUESTION, LIBRARY_CATEGORIES, LIBRARY_LICENSE_LINE, categoryLabel, readSaveSheet } from './buildTurns.mjs'

/**
 * Save, or Submit to the library (library spec §4.2): a sheet under the build bar, never a modal. A name, one line,
 * a category (five chips, or a branch's locked line), words people might search for and, to submit, a note for the
 * reviewer and the licence line. Escape or Cancel closes it; nothing is saved until Save or Submit is pressed.
 */
export default function SaveSheet({ submitting, defaults, locked, parentTitle, busy, error, guest, askName, onSave, onCancel }) {
  const [title, setTitle] = useState(defaults.title)
  const [summary, setSummary] = useState(defaults.summary)
  const [category, setCategory] = useState(locked ?? defaults.category)
  const [synonyms, setSynonyms] = useState(defaults.synonyms)
  const [note, setNote] = useState('')
  const [credit, setCredit] = useState('')
  const [problem, setProblem] = useState(null)
  const first = useRef(null)
  useEffect(() => { first.current?.focus() }, [])
  const send = (event) => {
    event.preventDefault()
    const read = readSaveSheet({ title, summary, category, synonyms, note, credit }, { locked, submitting, askName })
    if (read.problem) { setProblem(read); return }
    setProblem(null)
    onSave(read.input, read.note, read.credit)
  }
  const said = (field) => (problem?.field === field ? problem.problem : undefined)
  return <Box component="form" aria-label={submitting ? 'Submit to the library' : 'Save to your library'} onSubmit={send}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onCancel() } }}
    sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
    <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>{submitting ? 'Submit to the library' : 'Save to your library'}</Typography>
    <TextField inputRef={first} label="Name" size="small" value={title} onChange={(e) => setTitle(e.target.value)} error={Boolean(said('title'))} helperText={said('title')}
      slotProps={{ htmlInput: { maxLength: 80 } }} />
    <TextField label="What it does, in one line" size="small" value={summary} onChange={(e) => setSummary(e.target.value)} error={Boolean(said('summary'))}
      helperText={said('summary') ?? 'For example: Ideas go in piles; each pile holds up to five.'} slotProps={{ htmlInput: { maxLength: 160 } }} />
    <Box role="group" aria-label="Category">
      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: .5 }}>Category</Typography>
      {locked
        ? <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: .5 }} data-category-locked={locked}>
          <LockIcon fontSize="inherit" aria-hidden="true" />{categoryLabel(locked)}{parentTitle ? ` (from ${parentTitle})` : ''}: a branch stays in its parent’s category.
        </Typography>
        : <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: .5 }}>
          {LIBRARY_CATEGORIES.map((id) => <Chip key={id} label={CATEGORY_LABELS[id]} clickable size="medium" aria-pressed={category === id}
            color={category === id ? 'primary' : 'default'} variant={category === id ? 'filled' : 'outlined'} onClick={() => setCategory(category === id ? null : id)}
            sx={{ minHeight: 36 }} />)}
        </Box>}
      {said('category') && <Typography variant="caption" color="error" role="alert">{said('category')}</Typography>}
    </Box>
    <TextField label="Words people might search for (optional)" size="small" value={synonyms} onChange={(e) => setSynonyms(e.target.value)}
      helperText="Separate them with commas: standup, sprint, to do" />
    {submitting && askName && <TextField label={CREDIT_QUESTION} size="small" value={credit} onChange={(e) => setCredit(e.target.value)} required
      error={Boolean(said('credit'))} helperText={said('credit') ?? CREDIT_HELP} slotProps={{ htmlInput: { maxLength: 80, 'data-credit-name': '' } }} />}
    {submitting && <>
      <TextField label="Note for the reviewer (optional)" size="small" multiline minRows={2} maxRows={5} value={note} onChange={(e) => setNote(e.target.value)}
        slotProps={{ htmlInput: { maxLength: 2000 }, inputLabel: { shrink: true } }} />
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{LIBRARY_LICENSE_LINE}</Typography>
    </>}
    {error && <Typography variant="body2" color="error" role="alert">{String(error.reason ?? '').replace(/\s*\(\/signup\)/, '')}
      {error.code === 'sign_in_to_publish' && <> <Link href="/signup">Sign up</Link></>}</Typography>}
    {submitting && guest && !error && <Typography variant="body2" role="note">Sign up to publish: your slates come with you. <Link href="/signup">Sign up</Link></Typography>}
    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
      <Button onClick={onCancel} disabled={Boolean(busy)}>Cancel</Button>
      <Button type="submit" variant="contained" disabled={Boolean(busy)}>
        {busy === 'saving' ? 'Saving…' : busy === 'submitting' ? 'Submitting…' : submitting ? 'Submit for review' : 'Save'}
      </Button>
    </Box>
  </Box>
}

SaveSheet.propTypes = {
  submitting: PropTypes.bool,
  defaults: PropTypes.shape({ title: PropTypes.string, summary: PropTypes.string, category: PropTypes.string, synonyms: PropTypes.string }).isRequired,
  locked: PropTypes.string,
  parentTitle: PropTypes.string,
  busy: PropTypes.string,
  error: PropTypes.shape({ code: PropTypes.string, reason: PropTypes.string }),
  guest: PropTypes.bool,
  askName: PropTypes.bool,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
}
SaveSheet.defaultProps = { submitting: false, locked: null, parentTitle: null, busy: null, error: null, guest: false, askName: false }
