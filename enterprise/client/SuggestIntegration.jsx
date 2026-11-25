// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// "Suggest for the Slatebox library": a custom MCP server the person connected and that works,
// offered to everyone for free (owner, 2026-11-25). It goes to the same review queue as every other
// library submission (library.submit kind integration, /admin/library): an administrator checks the
// server again, may refine the words, and approves it (a Community card under Existing in Connect an
// integration), asks for changes or turns it down; the person hears back in the bell and by email.
// Nothing is published without that review. Only the address and these words travel, never a sign-in.
import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Link } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import {
  INTEGRATION_AUTH, INTEGRATION_AUTH_LABELS, INTEGRATION_CATEGORIES, INTEGRATION_CATEGORY_LABELS, INTEGRATION_CONSENT_LINE, INTEGRATION_LIMITS, LIBRARY_LIMITS,
} from '/imports/api/common/library-model.mjs'

/** The form's starting fields for one of the person's integrations. */
export function suggestDefaults(integration = {}) {
  const kind = integration.auth?.kind
  return {
    title: String(integration.name || '').slice(0, INTEGRATION_LIMITS.name),
    summary: '',
    category: '',
    homepage: '',
    auth: kind === 'key' ? 'key' : kind ? 'oauth' : 'none',
    consent: false,
  }
}

export default function SuggestIntegration({ open, integration, onClose, onSent = null }) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const [form, setForm] = useState(() => suggestDefaults(integration))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(null)
  useEffect(() => {
    if (open) {
      setForm(suggestDefaults(integration))
      setError('')
      setSent(null)
    }
  }, [open, integration?.integrationId]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (field) => (event) => setForm({ ...form, [field]: field === 'consent' ? event.target.checked : event.target.value })
  const ready = form.title.trim() && form.summary.trim() && form.category && form.consent && !sending

  async function send(event) {
    event?.preventDefault()
    if (!ready) return
    setSending(true)
    setError('')
    try {
      const answer = await Meteor.callAsync('library.submit', {
        kind: 'integration', integrationId: integration.integrationId, title: form.title.trim(), summary: form.summary.trim(), category: form.category,
        ...(form.homepage.trim() && { homepage: form.homepage.trim() }), auth: form.auth, consent: true,
      })
      setSent(answer)
      onSent?.(answer)
    } catch (e) {
      setError(e?.reason || e?.message || 'It could not be sent. Try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onClose={sending ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={phone} aria-labelledby="suggest-integration-title" data-suggest-integration="">
      <DialogTitle id="suggest-integration-title">Suggest {integration?.name || 'it'} for the Slatebox library</DialogTitle>
      <DialogContent>
        {sent ? (
          <Box role="status" data-suggest-sent="" sx={{ display: 'grid', gap: 1 }}>
            <Typography variant="body1" sx={{ fontWeight: 650 }}>Sent for review. Thank you.</Typography>
            <Typography variant="body2">An administrator checks the server and your words. You hear back in your notifications, and by email. Follow it in <Link to="/library/mine">My library</Link>.</Typography>
          </Box>
        ) : (
          <Box component="form" id="suggest-integration-form" onSubmit={send} sx={{ display: 'grid', gap: 2, pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Free. Slatebox reviews every suggestion before anyone sees it. Approved, it is listed under Existing in Connect an integration, marked Community{integration?.host ? ` (${integration.host})` : ''}.
            </Typography>
            <TextField label="Name" value={form.title} onChange={set('title')} required inputProps={{ maxLength: INTEGRATION_LIMITS.name, 'data-suggest-title': '' }}
              helperText="What people see on its card. No web addresses." />
            <TextField label="One line about what it does" value={form.summary} onChange={set('summary')} required multiline inputProps={{ maxLength: LIBRARY_LIMITS.summary, 'data-suggest-summary': '' }}
              helperText="For example: Finds flights and adds the best ones as notes." />
            <TextField select label="Category" value={form.category} onChange={set('category')} required SelectProps={{ inputProps: { 'data-suggest-category': '' } }}>
              {INTEGRATION_CATEGORIES.map((id) => <MenuItem key={id} value={id}>{INTEGRATION_CATEGORY_LABELS[id]}</MenuItem>)}
            </TextField>
            <TextField label="Homepage or docs (optional)" value={form.homepage} onChange={set('homepage')} placeholder="https://" inputProps={{ maxLength: INTEGRATION_LIMITS.homepage, inputMode: 'url', 'data-suggest-homepage': '' }} />
            <Box>
              <Typography component="div" variant="body2" sx={{ fontWeight: 650, mb: 0.5 }} id="suggest-auth-label">How people sign in</Typography>
              <RadioGroup value={form.auth} onChange={set('auth')} aria-labelledby="suggest-auth-label">
                {INTEGRATION_AUTH.map((id) => <FormControlLabel key={id} value={id} control={<Radio size="small" />} label={INTEGRATION_AUTH_LABELS[id]} data-suggest-auth={id} />)}
              </RadioGroup>
            </Box>
            <FormControlLabel sx={{ alignItems: 'flex-start', m: 0 }} data-suggest-consent=""
              control={<Checkbox checked={form.consent} onChange={set('consent')} sx={{ pt: 0.25 }} inputProps={{ 'aria-describedby': 'suggest-consent-line' }} />}
              label={<Typography variant="body2" id="suggest-consent-line">{INTEGRATION_CONSENT_LINE}</Typography>} />
            {error && <Typography role="alert" color="error" variant="body2" data-suggest-error="">{error}</Typography>}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: { xs: 'max(12px, env(safe-area-inset-bottom))', sm: 2 } }}>
        {sent ? <Button variant="contained" onClick={onClose}>Done</Button> : (
          <>
            <Button onClick={onClose} disabled={sending}>Cancel</Button>
            <Button type="submit" form="suggest-integration-form" variant="contained" disabled={!ready} data-suggest-send="">{sending ? 'Sending…' : 'Send for review'}</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}

SuggestIntegration.propTypes = {
  open: PropTypes.bool.isRequired,
  integration: PropTypes.shape({ integrationId: PropTypes.string, name: PropTypes.string, host: PropTypes.string, auth: PropTypes.shape({ kind: PropTypes.string }) }),
  onClose: PropTypes.func.isRequired,
  onSent: PropTypes.func,
}
