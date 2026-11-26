import React from 'react'
import PropTypes from 'prop-types'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import { AccountSection, FinePrint, SPACE } from '../common/AccountLayout'
import AppPage from '../common/AppPage'
import LibraryPreview from '../components/library/LibraryPreview'
import libraryApi from '../../api/client/library'
import { INTEGRATION_CONSENT_LINE, categoryLabel } from '../../api/common/library-model.mjs'
import { KindTitle, authorActions, authorStatus, diffLines, eventLine, groupMine } from '../components/library/libraryCopy.mjs'

// My library (/library/mine): what you saved or sent to the shared library, grouped by where each
// stands (drafts, waiting, needs changes, published, not accepted), with each one's thread with the
// reviewer. Send again, withdraw or discard, and reply here.
export default function MyLibrary() {
  const [answer, setAnswer] = React.useState(null)
  const [problem, setProblem] = React.useState('')
  const [refresh, setRefresh] = React.useState(0)
  React.useEffect(() => {
    let live = true
    libraryApi.mine().then((next) => { if (live) setAnswer(next) }, (error) => {
      if (live) { setAnswer({ items: [] }); setProblem(error?.reason || 'Your library could not be read.') }
    })
    return () => { live = false }
  }, [refresh])
  const groups = groupMine(answer?.items || [])
  return (
    <AppPage title="My library"
      subtitle="Smart components, slates and presentations you saved or sent to the library. An administrator reviews each one before anyone else sees it.">
      {problem && <Alert severity="error" sx={{ mb: SPACE.text }}>{problem}</Alert>}
      {answer === null && <Typography color="text.secondary">Loading…</Typography>}
      {answer && groups.length === 0 && (
        <Box sx={{ display: 'grid', gap: SPACE.text, justifyItems: 'start' }} data-testid="mine-empty">
          <Typography>Nothing here yet.</Typography>
          <Typography variant="body2" color="text.secondary">
            Publish a slate from Share, or a presentation from its settings. Build a smart component of your own from Ask Slatebox › Add to this slate.
          </Typography>
          <Button variant="outlined" component={RouterLink} to="/library">Browse the library</Button>
        </Box>
      )}
      <Box sx={{ display: 'grid', gap: SPACE.section }}>
        {groups.map((group) => (
          <AccountSection key={group.id} title={`${group.title} (${group.items.length})`} data-testid={`mine-group-${group.id}`}>
            {group.items.map((item) => <MineRow key={item.id} item={item} onChanged={() => setRefresh((n) => n + 1)} />)}
          </AccountSection>
        ))}
      </Box>
    </AppPage>
  )
}

function MineRow({ item, onChanged }) {
  const [open, setOpen] = React.useState(false)
  const [reply, setReply] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [problem, setProblem] = React.useState('')
  // An integration sent again is agreed to again: its address or name may have changed since.
  const [consenting, setConsenting] = React.useState(false)
  const [agreed, setAgreed] = React.useState(false)
  const status = authorStatus(item)
  const can = authorActions(item)
  const shown = { ...item, ...(item.pendingMeta || {}), ...(item.draftMeta || {}) }

  async function act(run) {
    setBusy(true)
    setProblem('')
    try {
      await run()
      onChanged()
    } catch (error) {
      setProblem(error?.reason || 'That could not be done.')
    } finally {
      setBusy(false)
    }
  }
  // An integration is sent again from the connection it came from, with the words it was sent with,
  // once its author agrees again (consenting: the dialog below; consent is true only from its checkbox).
  const integration = item.pendingIntegration || item.integration
  const send = (consent = false) => act(() => libraryApi.submit(item.kind === 'component'
    ? { kind: 'component', itemId: item.id }
    : item.kind === 'integration'
      ? { kind: 'integration', integrationId: item.integrationId, ...(integration?.homepage && { homepage: integration.homepage }), auth: integration?.auth || 'none', consent }
      : { kind: item.kind, shareId: item.sourceShareId }))
  const submitAgain = () => {
    if (item.kind !== 'integration') return send()
    setAgreed(false)
    setConsenting(true)
  }
  const sendAgreed = async () => {
    setConsenting(false)
    await send(true)
  }

  return (
    <Box data-testid="mine-row" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '140px 1fr' }, gap: SPACE.group, p: SPACE.text, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <LibraryPreview itemId={item.id} title={shown.title} height={96} />
      <Box sx={{ minWidth: 0, display: 'grid', gap: SPACE.hair, alignContent: 'start' }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 650, overflowWrap: 'anywhere' }}>{shown.title}</Typography>
          <Chip size="small" label={status.label} color={status.tone === 'default' ? 'default' : status.tone} data-testid="mine-status" />
        </Box>
        <Typography variant="body2" color="text.secondary">
          {KindTitle(item.kind)}{shown.category ? ` · ${categoryLabel(shown.category)}` : ''}
          {item.provenance?.branchedFrom ? ` · branched from ${item.provenance.branchedFrom.title}` : ''}
          {item.provenance?.forkedFrom ? ` · copy of ${item.provenance.forkedFrom.title}` : ''}
        </Typography>
        <Typography variant="body2">{shown.summary}</Typography>
        {item.lastMessage && (
          <Typography variant="body2" sx={{ color: item.lastMessage.by === 'reviewer' ? 'warning.main' : 'text.secondary' }} data-testid="mine-last-message">
            {item.lastMessage.by === 'reviewer' ? 'Reviewer' : 'You'}: {item.lastMessage.text}
          </Typography>
        )}
        {problem && <Alert severity="error">{problem}</Alert>}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, pt: SPACE.hair }}>
          {item.sourceShareId && <Button size="small" component={RouterLink} to={`/canvas/${item.sourceShareId}`}>Open the slate</Button>}
          {item.status === 'published' && <Button size="small" component={RouterLink} to={item.kind === 'integration' ? '/integrations' : `/library/${item.slug}`}>{item.kind === 'integration' ? 'See it in Connect an integration' : 'See it in the library'}</Button>}
          {can.submit && (item.status !== 'draft' || item.kind === 'component') && <Button size="small" variant="contained" onClick={submitAgain} disabled={busy} data-testid="mine-submit">
            {item.status === 'published' ? 'Send the update' : item.status === 'draft' ? 'Submit for review' : 'Send it again'}
          </Button>}
          {can.withdraw && <Button size="small" onClick={() => act(() => libraryApi.withdraw({ itemId: item.id }))} disabled={busy}>
            {item.status === 'published' ? (item.reviewStatus ? 'Withdraw the update' : 'Take it out of the library') : 'Withdraw'}
          </Button>}
          {can.discard && <Button size="small" color="error" onClick={() => act(() => libraryApi.discard({ itemId: item.id }))} disabled={busy}>Discard</Button>}
          {item.events?.length > 0 && <Button size="small" onClick={() => setOpen((now) => !now)} aria-expanded={open}>{open ? 'Hide the thread' : `Thread (${item.events.length})`}</Button>}
        </Box>
        {item.kind === 'integration' && (
          <Dialog open={consenting} onClose={() => setConsenting(false)} maxWidth="xs" fullWidth aria-labelledby={`mine-consent-${item.id}`} data-testid="mine-consent">
            <DialogTitle id={`mine-consent-${item.id}`}>Send {shown.title} again?</DialogTitle>
            <DialogContent>
              <Typography variant="body2" sx={{ mb: 1.5 }}>It is sent from your connection as it is now{integration?.host ? `, at ${integration.host}` : ''}. Slatebox checks the server again before anyone sees it.</Typography>
              <FormControlLabel sx={{ alignItems: 'flex-start', m: 0 }}
                control={<Checkbox checked={agreed} onChange={(event) => setAgreed(event.target.checked)} sx={{ pt: 0.25 }} inputProps={{ 'aria-describedby': `mine-consent-line-${item.id}`, 'data-testid': 'mine-consent-check' }} />}
                label={<Typography variant="body2" id={`mine-consent-line-${item.id}`}>{INTEGRATION_CONSENT_LINE}</Typography>} />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConsenting(false)}>Cancel</Button>
              <Button variant="contained" disabled={!agreed || busy} onClick={sendAgreed} data-testid="mine-consent-send">Send for review</Button>
            </DialogActions>
          </Dialog>
        )}
        <Collapse in={open} unmountOnExit>
          <Box sx={{ display: 'grid', gap: 0.75, pt: SPACE.text }} data-testid="mine-thread">
            {(item.events || []).map((event) => (
              <Box key={event.id} sx={{ borderLeft: 2, borderColor: event.actor?.kind === 'reviewer' ? 'warning.main' : 'divider', pl: 1 }}>
                <FinePrint>{new Date(event.at).toLocaleString()}</FinePrint>
                <Typography variant="body2">{eventLine(event)}</Typography>
                {event.message && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>{event.message}</Typography>}
                {diffLines(event.diff).map((line) => <Typography key={line} variant="caption" component="div" sx={{ fontFamily: 'monospace' }}>{line}</Typography>)}
              </Box>
            ))}
            {can.reply && (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
                <TextField size="small" fullWidth multiline maxRows={4} placeholder="Write to the reviewer…" value={reply} onChange={(event) => setReply(event.target.value)}
                  inputProps={{ 'aria-label': 'Write to the reviewer', maxLength: 2000 }} />
                <Button disabled={!reply.trim() || busy} onClick={() => act(async () => { await libraryApi.comment({ itemId: item.id, message: reply.trim() }); setReply('') })}>Send</Button>
              </Box>
            )}
          </Box>
        </Collapse>
      </Box>
    </Box>
  )
}

MineRow.propTypes = {
  item: PropTypes.object.isRequired,
  onChanged: PropTypes.func.isRequired,
}
