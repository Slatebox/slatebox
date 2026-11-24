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
import { AccountPage, AccountSection, FinePrint, SPACE } from '../common/AccountLayout'
import LibraryPreview from '../components/library/LibraryPreview'
import libraryApi from '../../api/client/library'
import { categoryLabel } from '../../api/common/library-model.mjs'
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
    <AccountPage title="My library">
      <Typography color="text.secondary">
        Smart components, slates and presentations you saved or sent to the library. An administrator reviews each one before anyone else sees it.
      </Typography>
      {problem && <Alert severity="error" sx={{ mt: SPACE.text }}>{problem}</Alert>}
      {answer === null && <Typography color="text.secondary" sx={{ mt: SPACE.block }}>Loading…</Typography>}
      {answer && groups.length === 0 && (
        <Box sx={{ mt: SPACE.block, display: 'grid', gap: SPACE.text, justifyItems: 'start' }} data-testid="mine-empty">
          <Typography>Nothing here yet.</Typography>
          <Typography variant="body2" color="text.secondary">
            Publish a slate from Share, or a presentation from its settings. Build a smart component of your own from Ask Slatebox › Add to this slate.
          </Typography>
          <Button variant="outlined" component={RouterLink} to="/library">Browse the library</Button>
        </Box>
      )}
      <Box sx={{ display: 'grid', gap: SPACE.section, mt: SPACE.block }}>
        {groups.map((group) => (
          <AccountSection key={group.id} title={`${group.title} (${group.items.length})`} data-testid={`mine-group-${group.id}`}>
            {group.items.map((item) => <MineRow key={item.id} item={item} onChanged={() => setRefresh((n) => n + 1)} />)}
          </AccountSection>
        ))}
      </Box>
    </AccountPage>
  )
}

function MineRow({ item, onChanged }) {
  const [open, setOpen] = React.useState(false)
  const [reply, setReply] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [problem, setProblem] = React.useState('')
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
  const submitAgain = () => act(() => libraryApi.submit(item.kind === 'component'
    ? { kind: 'component', itemId: item.id }
    : { kind: item.kind, shareId: item.sourceShareId }))

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
          {item.provenance?.forkedFrom ? ` · based on ${item.provenance.forkedFrom.title}` : ''}
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
          {item.status === 'published' && <Button size="small" component={RouterLink} to={`/library/${item.slug}`}>See it in the library</Button>}
          {can.submit && (item.status !== 'draft' || item.kind === 'component') && <Button size="small" variant="contained" onClick={submitAgain} disabled={busy} data-testid="mine-submit">
            {item.status === 'published' ? 'Send the update' : item.status === 'draft' ? 'Submit for review' : 'Send it again'}
          </Button>}
          {can.withdraw && <Button size="small" onClick={() => act(() => libraryApi.withdraw({ itemId: item.id }))} disabled={busy}>
            {item.status === 'published' ? (item.reviewStatus ? 'Withdraw the update' : 'Take it out of the library') : 'Withdraw'}
          </Button>}
          {can.discard && <Button size="small" color="error" onClick={() => act(() => libraryApi.discard({ itemId: item.id }))} disabled={busy}>Discard</Button>}
          {item.events?.length > 0 && <Button size="small" onClick={() => setOpen((now) => !now)} aria-expanded={open}>{open ? 'Hide the thread' : `Thread (${item.events.length})`}</Button>}
        </Box>
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
